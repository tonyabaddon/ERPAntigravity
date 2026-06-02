package db

import "github.com/username/sinar-elektrik-backend/internal/models"

// GetActiveRecipients returns all active admin and owner WA numbers.
// Called when sending payment notifications and order approval notifications.
func (c *Client) GetActiveRecipients() ([]*models.WaRecipient, error) {
	rows, err := c.DB.Query(`
		SELECT id, role, name, wa_number, is_active, created_at
		FROM wa_recipients
		WHERE is_active = true
		ORDER BY role, id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*models.WaRecipient
	for rows.Next() {
		var r models.WaRecipient
		if err := rows.Scan(&r.ID, &r.Role, &r.Name, &r.WANumber, &r.IsActive, &r.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, &r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}
