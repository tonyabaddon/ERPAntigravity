package db

import "github.com/username/sinar-elektrik-backend/internal/models"

// GetOrCreateCustomer finds the customer by WA number or creates a new one.
// Uses INSERT ... ON CONFLICT DO UPDATE so RETURNING always returns a row.
// The sequence nextval advances on every call (gaps are acceptable).
func (c *Client) GetOrCreateCustomer(waNumber string) (*models.Customer, error) {
	var cust models.Customer
	err := c.DB.QueryRow(`
		INSERT INTO customers (id, wa_number)
		VALUES (
			'GJP-CUST-' || lpad(nextval('gjp_cust_seq')::text, 4, '0'),
			$1
		)
		ON CONFLICT (wa_number) DO UPDATE
			SET wa_number = EXCLUDED.wa_number
		RETURNING id, wa_number, name, company, created_at
	`, waNumber).Scan(
		&cust.ID, &cust.WANumber, &cust.Name, &cust.Company, &cust.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &cust, nil
}
