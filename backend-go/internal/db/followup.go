package db

import (
	"database/sql"
	"encoding/json"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

// GetEligibleForFollowup returns conversations where Calista has sent at least one
// message, the customer has not replied in 4+ hours, and the daily WIB quota
// (max 2 follow-ups) is not exhausted.
func (c *Client) GetEligibleForFollowup() ([]*models.Conversation, error) {
	rows, err := c.DB.Query(`
		SELECT id, customer_phone, language, state, collected_data, clarification_round,
		       ai_active, last_ai_message_at, followup_count_today, last_followup_date
		FROM conversations
		WHERE ai_active = true
		  AND state NOT IN ('CANCELLED', 'COMPLETED', 'ESCALATED_ADMIN', 'ESCALATED_WIRING')
		  AND last_ai_message_at IS NOT NULL
		  AND last_ai_message_at < NOW() - INTERVAL '4 hours'
		  AND (
		    last_followup_date IS NULL
		    OR last_followup_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date
		    OR followup_count_today < 2
		  )
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*models.Conversation
	for rows.Next() {
		var conv models.Conversation
		var dataJSON []byte
		var lastAIAt, lastFollowupDate sql.NullTime
		if err := rows.Scan(
			&conv.ID, &conv.CustomerPhone, &conv.Language, &conv.State,
			&dataJSON, &conv.ClarificationRound, &conv.AIActive,
			&lastAIAt, &conv.FollowupCountToday, &lastFollowupDate,
		); err != nil {
			return nil, err
		}
		json.Unmarshal(dataJSON, &conv.CollectedData)
		if lastAIAt.Valid {
			conv.LastAIMessageAt = &lastAIAt.Time
		}
		if lastFollowupDate.Valid {
			conv.LastFollowupDate = &lastFollowupDate.Time
		}
		result = append(result, &conv)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

// IncrementFollowup records a follow-up send. If it is a new WIB day since the
// last follow-up, the count resets to 1 rather than incrementing.
// After 6 cumulative sends (3 days × 2/day) with no customer reply,
// ai_active is set to false to stop further follow-ups automatically.
func (c *Client) IncrementFollowup(convID string) error {
	_, err := c.DB.Exec(`
		UPDATE conversations SET
		  followup_count_today = CASE
		    WHEN last_followup_date IS NULL
		      OR last_followup_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date
		    THEN 1
		    ELSE followup_count_today + 1
		  END,
		  last_followup_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date,
		  followup_sends_total = followup_sends_total + 1,
		  ai_active = CASE
		    WHEN followup_sends_total + 1 >= 6 THEN false
		    ELSE ai_active
		  END
		WHERE id = $1
	`, convID)
	return err
}

// ResetFollowupCounter clears follow-up tracking when the customer replies.
// Called at the start of processMessage so any customer reply resets the state,
// including the cumulative sends counter so the 3-day auto-disable window restarts.
func (c *Client) ResetFollowupCounter(convID string) error {
	_, err := c.DB.Exec(`
		UPDATE conversations
		SET followup_count_today = 0,
		    last_followup_date = NULL,
		    followup_sends_total = 0
		WHERE id = $1
	`, convID)
	return err
}
