package db

import (
	"fmt"
	"testing"
	"time"
)

// SetDualWriteEnabled sets accounting_config.enable_dual_write_to_gl. Tests
// that enable dual-write should defer a call with enabled=false to restore the
// default after the test completes.
func SetDualWriteEnabled(t *testing.T, c *Client, enabled bool) {
	t.Helper()
	if _, err := c.DB.Exec(`UPDATE public.accounting_config SET enable_dual_write_to_gl = $1`, enabled); err != nil {
		t.Fatal(err)
	}
}

// EnsureTempoCustomer inserts a minimal customers row eligible for tempo
// invoices and returns the customer's id (TEXT, not UUID — matches the
// legacy GJP-CUST-XXXX id system used by the RPC).
//
// Schema notes:
//   - customers.id is TEXT PRIMARY KEY (not UUID)
//   - customers.wa_number is NOT NULL
//   - allows_tempo (not is_tempo) is the column gating tempo eligibility
//   - term_days + credit_limit must be > 0 for the RPC's validation to pass
func EnsureTempoCustomer(t *testing.T, c *Client, termDays int, creditLimit int) string {
	t.Helper()
	// Use a nanosecond-suffixed text id to guarantee uniqueness across parallel
	// test runs on the shared DB. Format mimics legacy GJP-CUST-XXXX style.
	id := fmt.Sprintf("TEST-CUST-%d", time.Now().UnixNano())
	name := fmt.Sprintf("Test Tempo %s", id)
	waNumber := fmt.Sprintf("+62811%d", time.Now().UnixNano()%100000000)
	_, err := c.DB.Exec(`
		INSERT INTO public.customers (id, name, wa_number, allows_tempo, term_days, credit_limit)
		VALUES ($1, $2, $3, true, $4, $5)
		ON CONFLICT (id) DO NOTHING`,
		id, name, waNumber, termDays, creditLimit)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// EnsurePassthroughSKU inserts a stocks row flagged as pass-through (no FIFO
// inventory) with a known harga_modal. Mirrors EnsureSKUStock column list to
// satisfy NOT NULL constraints (category, stock, status, specs).
func EnsurePassthroughSKU(t *testing.T, c *Client, sku string, hargaModal int) {
	t.Helper()
	_, err := c.DB.Exec(`
		INSERT INTO public.stocks (sku, name, category, price, harga_modal, is_passthrough, stock, status, specs)
		VALUES ($1, $1, 'Aksesori', $2 * 2, $2, true, 0, 'Sinkron', '{}'::jsonb)
		ON CONFLICT (sku) DO UPDATE
		SET is_passthrough = true, harga_modal = EXCLUDED.harga_modal`,
		sku, hargaModal)
	if err != nil {
		t.Fatal(err)
	}
}
