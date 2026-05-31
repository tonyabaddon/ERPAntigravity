package db

import "github.com/username/sinar-elektrik-backend/internal/models"

func (c *Client) InsertMessage(conversationID string, sender models.MessageSender, text string) (*models.Message, error) {
	var msg models.Message
	err := c.DB.QueryRow(`
		INSERT INTO messages (conversation_id, sender, text)
		VALUES ($1, $2, $3)
		RETURNING id, conversation_id, sender, text, created_at
	`, conversationID, string(sender), text).Scan(
		&msg.ID, &msg.ConversationID, &msg.Sender, &msg.Text, &msg.CreatedAt,
	)
	return &msg, err
}

func (c *Client) InsertMediaMessage(conversationID string, sender models.MessageSender, mediaURL, mediaType string) (*models.Message, error) {
	var msg models.Message
	err := c.DB.QueryRow(`
		INSERT INTO messages (conversation_id, sender, text, media_url, media_type)
		VALUES ($1, $2, '', $3, $4)
		RETURNING id, conversation_id, sender, text, media_url, media_type, created_at
	`, conversationID, string(sender), mediaURL, mediaType).Scan(
		&msg.ID, &msg.ConversationID, &msg.Sender, &msg.Text,
		&msg.MediaURL, &msg.MediaType, &msg.CreatedAt,
	)
	return &msg, err
}

func (c *Client) GetMessageByID(messageID string) (*models.Message, error) {
	var msg models.Message
	err := c.DB.QueryRow(`
		SELECT id, conversation_id, sender, text,
		       COALESCE(media_url,''), COALESCE(media_type,''), created_at
		FROM messages WHERE id = $1
	`, messageID).Scan(
		&msg.ID, &msg.ConversationID, &msg.Sender, &msg.Text,
		&msg.MediaURL, &msg.MediaType, &msg.CreatedAt,
	)
	return &msg, err
}

func (c *Client) ListLast10Messages(conversationID string) ([]models.Message, error) {
	rows, err := c.DB.Query(`
		SELECT id, conversation_id, sender, text, created_at
		FROM (
			SELECT id, conversation_id, sender, text, created_at
			FROM messages WHERE conversation_id = $1
			ORDER BY created_at DESC LIMIT 10
		) sub ORDER BY created_at ASC
	`, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var msgs []models.Message
	for rows.Next() {
		var m models.Message
		rows.Scan(&m.ID, &m.ConversationID, &m.Sender, &m.Text, &m.CreatedAt)
		msgs = append(msgs, m)
	}
	return msgs, nil
}
