package db

import (
	"database/sql"
	"encoding/json"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

func (c *Client) GetOrCreateConversation(customerPhone, waNumberID string) (*models.Conversation, error) {
	conv, err := c.findActiveConversation(customerPhone, waNumberID)
	if err == sql.ErrNoRows {
		return c.createConversation(customerPhone, waNumberID)
	}
	return conv, err
}

func (c *Client) findActiveConversation(phone, waNumberID string) (*models.Conversation, error) {
	var conv models.Conversation
	var dataJSON []byte
	err := c.DB.QueryRow(`
		SELECT id, wa_number_id, customer_phone, state, language,
		       collected_data, clarification_round, created_at, updated_at
		FROM conversations
		WHERE customer_phone = $1 AND wa_number_id = $2
		  AND state NOT IN ('CANCELLED','COMPLETED','ESCALATED_ADMIN','ESCALATED_WIRING')
		ORDER BY created_at DESC LIMIT 1
	`, phone, waNumberID).Scan(
		&conv.ID, &conv.WANumberID, &conv.CustomerPhone, &conv.State,
		&conv.Language, &dataJSON, &conv.ClarificationRound,
		&conv.CreatedAt, &conv.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	json.Unmarshal(dataJSON, &conv.CollectedData)
	return &conv, nil
}

func (c *Client) createConversation(phone, waNumberID string) (*models.Conversation, error) {
	var conv models.Conversation
	var dataJSON []byte
	err := c.DB.QueryRow(`
		INSERT INTO conversations (wa_number_id, customer_phone, state, language, collected_data, clarification_round)
		VALUES ($1, $2, 'GREETING', 'id', '{}', 0)
		RETURNING id, wa_number_id, customer_phone, state, language,
		          collected_data, clarification_round, created_at, updated_at
	`, waNumberID, phone).Scan(
		&conv.ID, &conv.WANumberID, &conv.CustomerPhone, &conv.State,
		&conv.Language, &dataJSON, &conv.ClarificationRound,
		&conv.CreatedAt, &conv.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	json.Unmarshal(dataJSON, &conv.CollectedData)
	return &conv, nil
}

func (c *Client) UpdateConversationState(id string, state models.ConversationState) error {
	_, err := c.DB.Exec(`
		UPDATE conversations SET state = $1, updated_at = $2 WHERE id = $3
	`, string(state), time.Now(), id)
	return err
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
		       collected_data, clarification_round, created_at, updated_at
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
		rows.Scan(
			&conv.ID, &conv.WANumberID, &conv.CustomerPhone, &conv.State,
			&conv.Language, &dataJSON, &conv.ClarificationRound,
			&conv.CreatedAt, &conv.UpdatedAt,
		)
		json.Unmarshal(dataJSON, &conv.CollectedData)
		result = append(result, &conv)
	}
	return result, nil
}
