// backend-go/internal/db/recon_accounts.go
package db

import (
	"context"
	"time"
)

type BankAccount struct {
	ID            string
	BankCode      string
	AccountNumber string
	AccountLabel  string
	Purpose       string
	IsActive      bool
}

func (c *Client) ListBankAccounts(ctx context.Context) ([]BankAccount, error) {
	rows, err := c.DB.QueryContext(ctx, `SELECT id::text, bank_code, account_number, account_label, purpose, is_active FROM bank_accounts WHERE is_active=true`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BankAccount
	for rows.Next() {
		var a BankAccount
		if err := rows.Scan(&a.ID, &a.BankCode, &a.AccountNumber, &a.AccountLabel, &a.Purpose, &a.IsActive); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

type BankImport struct {
	ID            string
	BankAccountID string
	PeriodStart   time.Time
	PeriodEnd     time.Time
	Filename      string
	StoragePath   string
	Status        string
}

func (c *Client) CreateBankImport(ctx context.Context, im BankImport) (string, error) {
	var id string
	err := c.DB.QueryRowContext(ctx, `
		INSERT INTO bank_imports (bank_account_id, period_start, period_end, filename, storage_path, status)
		VALUES ($1,$2,$3,$4,$5,'PROCESSING') RETURNING id::text`,
		im.BankAccountID, im.PeriodStart, im.PeriodEnd, im.Filename, im.StoragePath).Scan(&id)
	return id, err
}

func (c *Client) UpdateBankImportReady(ctx context.Context, importID string, lineCount, matchedCount, inTokens, outTokens int) error {
	_, err := c.DB.ExecContext(ctx, `
		UPDATE bank_imports SET status='READY', line_count=$2, matched_count=$3,
		       gemini_input_tokens=$4, gemini_output_tokens=$5
		WHERE id=$1`, importID, lineCount, matchedCount, inTokens, outTokens)
	return err
}

func (c *Client) UpdateBankImportFailed(ctx context.Context, importID, errMsg string) error {
	_, err := c.DB.ExecContext(ctx, `UPDATE bank_imports SET status='FAILED', error_message=$2 WHERE id=$1`, importID, errMsg)
	return err
}
