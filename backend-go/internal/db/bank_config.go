package db

import (
	"database/sql"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

// GetActiveBankConfig returns the single active bank config row, or nil if none exists.
func (c *Client) GetActiveBankConfig() (*models.BankConfig, error) {
	var bc models.BankConfig
	err := c.DB.QueryRow(`
		SELECT id, bank_name, account_number, account_name, is_active, updated_at
		FROM bank_config WHERE is_active = true LIMIT 1
	`).Scan(&bc.ID, &bc.BankName, &bc.AccountNumber, &bc.AccountName, &bc.IsActive, &bc.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &bc, nil
}
