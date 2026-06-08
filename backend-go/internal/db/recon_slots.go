// backend-go/internal/db/recon_slots.go
package db

import (
	"context"
	"time"
)

type PayableSlot struct {
	ID             string
	OrderID        string
	SlotType       string
	ExpectedAmount float64
	CustomerName   string
	OrderCreatedAt time.Time
	Status         string
}

func (c *Client) ListOpenSlotsForDate(ctx context.Context, txnDate time.Time, backDays, forwardDays int) ([]PayableSlot, error) {
	rows, err := c.DB.QueryContext(ctx, `
		SELECT ps.id::text, ps.order_id::text, ps.slot_type, ps.expected_amount,
		       o.customer_name, o.created_at, ps.status
		FROM payable_slots ps JOIN orders o ON o.id = ps.order_id
		WHERE ps.status = 'OPEN'
		  AND o.created_at BETWEEN $1::timestamptz - ($2 || ' days')::interval
		                      AND $1::timestamptz + ($3 || ' days')::interval`,
		txnDate, backDays, forwardDays,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PayableSlot
	for rows.Next() {
		var s PayableSlot
		if err := rows.Scan(&s.ID, &s.OrderID, &s.SlotType, &s.ExpectedAmount, &s.CustomerName, &s.OrderCreatedAt, &s.Status); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (c *Client) InsertAllocation(ctx context.Context, bankLineID, slotID string, amount float64) error {
	_, err := c.DB.ExecContext(ctx, `INSERT INTO bank_line_allocations (bank_line_id, slot_id, amount) VALUES ($1,$2,$3)`, bankLineID, slotID, amount)
	return err
}

type Settings struct {
	ThresholdGreen, ThresholdYellow, ThresholdOrange float64
	AmountTolerancePct                               float64
	DateWindowBackDays, DateWindowForwardDays        int
	EDCMDRMinPct, EDCMDRMaxPct                       float64
	FirstEligibleDate                                time.Time
}

func (c *Client) GetSettings(ctx context.Context) (Settings, error) {
	var s Settings
	err := c.DB.QueryRowContext(ctx, `SELECT threshold_green, threshold_yellow, threshold_orange,
		amount_tolerance_pct, date_window_back_days, date_window_forward_days,
		edc_mdr_min_pct, edc_mdr_max_pct, first_eligible_period_start
		FROM reconciliation_settings WHERE id='singleton'`).Scan(
		&s.ThresholdGreen, &s.ThresholdYellow, &s.ThresholdOrange,
		&s.AmountTolerancePct, &s.DateWindowBackDays, &s.DateWindowForwardDays,
		&s.EDCMDRMinPct, &s.EDCMDRMaxPct, &s.FirstEligibleDate,
	)
	return s, err
}

type Supplier struct {
	ID   string
	Name string
}

func (c *Client) ListSuppliers(ctx context.Context) ([]Supplier, error) {
	rows, err := c.DB.QueryContext(ctx, `SELECT id::text, name FROM suppliers`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Supplier
	for rows.Next() {
		var s Supplier
		if err := rows.Scan(&s.ID, &s.Name); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
