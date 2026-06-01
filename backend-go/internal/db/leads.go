package db

import (
	"time"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

// CreateLead inserts a new lead record linked to a customer and conversation.
// Lead ID format: GJP-LEAD-YYYYMMDD-XXXX (date from DB clock, sequence counter).
func (c *Client) CreateLead(customerID, conversationID, waNumber string) (*models.Lead, error) {
	var lead models.Lead
	err := c.DB.QueryRow(`
		INSERT INTO leads (id, customer_id, conversation_id, wa_number)
		VALUES (
			'GJP-LEAD-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('gjp_lead_seq')::text, 4, '0'),
			$1, $2, $3
		)
		RETURNING id, customer_id, conversation_id, wa_number, status,
		          COALESCE(confirmed_order_id, ''), created_at, updated_at
	`, customerID, conversationID, waNumber).Scan(
		&lead.ID, &lead.CustomerID, &lead.ConversationID, &lead.WANumber,
		&lead.Status, &lead.ConfirmedOrderID, &lead.CreatedAt, &lead.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &lead, nil
}

func (c *Client) UpdateLeadStatus(leadID string, status models.LeadStatus) error {
	_, err := c.DB.Exec(`
		UPDATE leads SET status = $1, updated_at = $2 WHERE id = $3
	`, string(status), time.Now(), leadID)
	return err
}
