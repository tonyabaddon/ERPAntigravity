package db

import (
	"github.com/google/uuid"
	"github.com/username/sinar-elektrik-backend/internal/models"
)

// GetOrCreateCustomer finds the customer by (tenant_id, wa_number) or creates
// a new one with a random UUID. Uses INSERT ... ON CONFLICT DO UPDATE so
// RETURNING always returns a row.
//
// F5-05 (2026-07-20): tenant-scoped uniqueness. Previously used
// gjp_cust_seq (Garindo-hardcoded) + ON CONFLICT (wa_number) alone which
// blocked legitimate customer creation across tenants. Now uses
// gen_random_uuid() + composite (tenant_id, wa_number) conflict target.
//
// gjp_cust_seq deprecated; sequence remains in DB for backward safety but
// no code path calls it.
func (c *Client) GetOrCreateCustomer(tenantID uuid.UUID, waNumber string) (*models.Customer, error) {
	var cust models.Customer
	err := c.DB.QueryRow(`
		INSERT INTO customers (id, tenant_id, wa_number)
		VALUES (gen_random_uuid()::text, $1, $2)
		ON CONFLICT (tenant_id, wa_number) DO UPDATE
			SET wa_number = EXCLUDED.wa_number
		RETURNING id, tenant_id, wa_number, name, company, created_at
	`, tenantID, waNumber).Scan(
		&cust.ID, &cust.TenantID, &cust.WANumber, &cust.Name, &cust.Company, &cust.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &cust, nil
}
