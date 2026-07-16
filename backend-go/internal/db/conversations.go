package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

// GetOrCreateConversation returns (conversation, created, error).
// created=true means a new conversation row was just inserted.
func (c *Client) GetOrCreateConversation(customerPhone, waNumberID string) (*models.Conversation, bool, error) {
	conv, err := c.findActiveConversation(customerPhone, waNumberID)
	if err == sql.ErrNoRows {
		conv, err = c.createConversation(customerPhone, waNumberID)
		return conv, true, err
	}
	if err != nil {
		return nil, false, err
	}
	return conv, false, nil
}

func (c *Client) findActiveConversation(phone, waNumberID string) (*models.Conversation, error) {
	var conv models.Conversation
	var dataJSON []byte
	var lastAIAt sql.NullTime
	var lastFollowupDate sql.NullTime
	var stateLockedUntil sql.NullTime
	err := c.DB.QueryRow(`
		SELECT id, wa_number_id, customer_phone, state, language,
		       collected_data, clarification_round, ai_active, created_at, updated_at,
		       last_ai_message_at, followup_count_today, last_followup_date,
		       state_locked_until
		FROM conversations
		WHERE customer_phone = $1 AND wa_number_id = $2
		  AND state NOT IN ('CANCELLED','COMPLETED')
		ORDER BY created_at DESC LIMIT 1
	`, phone, waNumberID).Scan(
		&conv.ID, &conv.WANumberID, &conv.CustomerPhone, &conv.State,
		&conv.Language, &dataJSON, &conv.ClarificationRound,
		&conv.AIActive, &conv.CreatedAt, &conv.UpdatedAt,
		&lastAIAt, &conv.FollowupCountToday, &lastFollowupDate,
		&stateLockedUntil,
	)
	if err != nil {
		return nil, err
	}
	json.Unmarshal(dataJSON, &conv.CollectedData)
	if lastAIAt.Valid {
		conv.LastAIMessageAt = &lastAIAt.Time
	}
	if lastFollowupDate.Valid {
		conv.LastFollowupDate = &lastFollowupDate.Time
	}
	if stateLockedUntil.Valid {
		conv.StateLockedUntil = &stateLockedUntil.Time
	}
	return &conv, nil
}

func (c *Client) createConversation(phone, waNumberID string) (*models.Conversation, error) {
	var conv models.Conversation
	var dataJSON []byte
	var lastAIAt sql.NullTime
	var lastFollowupDate sql.NullTime
	var stateLockedUntil sql.NullTime
	err := c.DB.QueryRow(`
		INSERT INTO conversations (wa_number_id, customer_phone, state, language, collected_data, clarification_round)
		VALUES ($1, $2, 'GREETING', 'id', '{}', 0)
		RETURNING id, wa_number_id, customer_phone, state, language,
		          collected_data, clarification_round, ai_active, created_at, updated_at,
		          last_ai_message_at, followup_count_today, last_followup_date,
		          state_locked_until
	`, waNumberID, phone).Scan(
		&conv.ID, &conv.WANumberID, &conv.CustomerPhone, &conv.State,
		&conv.Language, &dataJSON, &conv.ClarificationRound,
		&conv.AIActive, &conv.CreatedAt, &conv.UpdatedAt,
		&lastAIAt, &conv.FollowupCountToday, &lastFollowupDate,
		&stateLockedUntil,
	)
	if err != nil {
		return nil, err
	}
	json.Unmarshal(dataJSON, &conv.CollectedData)
	if lastAIAt.Valid {
		conv.LastAIMessageAt = &lastAIAt.Time
	}
	if lastFollowupDate.Valid {
		conv.LastFollowupDate = &lastFollowupDate.Time
	}
	if stateLockedUntil.Valid {
		conv.StateLockedUntil = &stateLockedUntil.Time
	}
	return &conv, nil
}

func (c *Client) UpdateConversationState(id string, state models.ConversationState) error {
	result, err := c.DB.Exec(`
		UPDATE conversations SET state = $1, updated_at = $2
		WHERE id = $3
		  AND (state_locked_until IS NULL OR state_locked_until < NOW())
	`, string(state), time.Now(), id)
	if err != nil {
		return err
	}
	rows, raErr := result.RowsAffected()
	if raErr == nil && rows == 0 {
		slog.Info("[HANDLER] UpdateConversationState skipped", slog.String("conv_id", id), slog.String("reason", "state_locked_until active or row missing"))
	}
	return nil
}

func (c *Client) UpdateCollectedData(id string, data models.CollectedData, clarificationRound int) error {
	dataJSON, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = c.DB.Exec(`
		UPDATE conversations SET collected_data = $1, clarification_round = $2, updated_at = $3 WHERE id = $4
	`, dataJSON, clarificationRound, time.Now(), id)
	return err
}

func (c *Client) UpdateLanguage(id, language string) error {
	_, err := c.DB.Exec(`
		UPDATE conversations SET language = $1, updated_at = $2 WHERE id = $3
	`, language, time.Now(), id)
	return err
}

func (c *Client) ListConversationsByPhone(phone string) ([]*models.Conversation, error) {
	rows, err := c.DB.Query(`
		SELECT id, wa_number_id, customer_phone, state, language,
		       collected_data, clarification_round, ai_active, created_at, updated_at,
		       state_locked_until
		FROM conversations WHERE customer_phone = $1 ORDER BY created_at DESC
	`, phone)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []*models.Conversation
	for rows.Next() {
		var conv models.Conversation
		var dataJSON []byte
		var stateLockedUntil sql.NullTime
		if err := rows.Scan(
			&conv.ID, &conv.WANumberID, &conv.CustomerPhone, &conv.State,
			&conv.Language, &dataJSON, &conv.ClarificationRound,
			&conv.AIActive, &conv.CreatedAt, &conv.UpdatedAt,
			&stateLockedUntil,
		); err != nil {
			return nil, err
		}
		json.Unmarshal(dataJSON, &conv.CollectedData)
		if stateLockedUntil.Valid {
			conv.StateLockedUntil = &stateLockedUntil.Time
		}
		result = append(result, &conv)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

// AutoResumeConv flips ai_active=true + clears lock for a single conversation.
// Used as defense-in-depth saat pg_cron telat / failed.
// The WHERE guard ensures we only touch rows where the lock has actually expired.
func (c *Client) AutoResumeConv(ctx context.Context, convID string) error {
	_, err := c.DB.ExecContext(ctx, `
		UPDATE conversations SET
		    ai_active = true,
		    state_locked_until = NULL,
		    state_locked_by_admin_id = NULL,
		    updated_at = NOW()
		WHERE id = $1
		  AND state_locked_until IS NOT NULL
		  AND state_locked_until < NOW()
	`, convID)
	return err
}
