// backend-go/internal/db/recon_lines.go
package db

import (
	"context"
	"time"
)

type BankStatementLine struct {
	ID              string
	ImportID        string
	BankAccountID   string
	TxnDate         time.Time
	Amount          float64
	Direction       string
	Description     string
	Counterparty    string
	LineKind        string
	Lane            string
	MatchConfidence *float64
	MatchReason     string
	DedupHash       string
}

func (c *Client) InsertBankLine(ctx context.Context, l BankStatementLine) (string, error) {
	var id string
	err := c.DB.QueryRowContext(ctx, `
		INSERT INTO bank_statement_lines
			(import_id, bank_account_id, txn_date, amount, direction, description,
			 counterparty, line_kind, lane, match_confidence, match_reason, dedup_hash)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT (bank_account_id, dedup_hash) DO NOTHING
		RETURNING id::text`,
		l.ImportID, l.BankAccountID, l.TxnDate, l.Amount, l.Direction, l.Description,
		l.Counterparty, l.LineKind, l.Lane, l.MatchConfidence, l.MatchReason, l.DedupHash,
	).Scan(&id)
	return id, err
}

func (c *Client) UpdateLineLane(ctx context.Context, lineID, lane, reason string, confidence float64) error {
	_, err := c.DB.ExecContext(ctx, `UPDATE bank_statement_lines SET lane=$2, match_reason=$3, match_confidence=$4 WHERE id=$1`, lineID, lane, reason, confidence)
	return err
}
