package db

import (
	"fmt"
	"testing"
	"time"
)

// EnsureSupplier inserts a supplier with a unique name and returns its UUID.
// The id is DB-generated (gen_random_uuid), so this is always safe regardless
// of the suppliers table's id column type.
func EnsureSupplier(t *testing.T, c *Client) string {
	t.Helper()
	supplierName := fmt.Sprintf("Test Supplier %d", time.Now().UnixNano())
	var id string
	if err := c.DB.QueryRow(
		`INSERT INTO public.suppliers (name) VALUES ($1) RETURNING id::text`,
		supplierName,
	).Scan(&id); err != nil {
		t.Fatalf("EnsureSupplier: %v", err)
	}
	return id
}

// EnsureCashAccount returns the UUID of an active KAS cash_account. The Kas
// Toko row is seeded by migration 20260720000001. If none exists the test
// is fatally failed — it should never happen on the shared Supabase test DB.
func EnsureCashAccount(t *testing.T, c *Client) string {
	t.Helper()
	var id string
	if err := c.DB.QueryRow(
		`SELECT id::text FROM public.cash_accounts
		 WHERE account_type = 'KAS' AND is_active = true LIMIT 1`,
	).Scan(&id); err != nil {
		t.Fatalf("EnsureCashAccount: no active KAS cash_account seeded: %v", err)
	}
	return id
}

// EnsureBareOrder creates an orders row via create_tempo_invoice using a
// non-passthrough (stock) SKU, and returns the order's UUID as a string.
// The resulting order has no 2-1150 accrual in journal_entries because the
// SKU is a stock item (not passthrough) — only 5-1100 / 1-1510 legs are
// written. This lets tests exercise the "no prior accrual" path in Slice B.
//
// The supplierID and sku parameters are kept for API parity with callers;
// supplierID is unused here (create_tempo_invoice is a sales RPC, not
// purchasing). sku must be pre-seeded via EnsurePassthroughSKU or
// EnsureSKUStock.
//
// A stock SKU is seeded internally to avoid disturbing the passthrough
// is_passthrough flag on the caller's sku.
func EnsureBareOrder(t *testing.T, c *Client, supplierID, sku string) string {
	t.Helper()
	// Use a separate stock SKU for the order so we don't contaminate sku.
	stockSku := fmt.Sprintf("BARE-STOCK-%d", time.Now().UnixNano())
	EnsureSKUStock(t, c, stockSku, "atas", 50)

	custID := EnsureTempoCustomer(t, c, 30, 1000000)

	payload := fmt.Sprintf(`{
		"customer_id": "%s",
		"items": [{"sku":"%s","name":"Bare Stock","qty":1,"unit_price":5000}]
	}`, custID, stockSku)

	var orderID string
	if err := c.DB.QueryRow(
		`SELECT public.create_tempo_invoice($1::jsonb)::text`, payload,
	).Scan(&orderID); err != nil {
		t.Fatalf("EnsureBareOrder via create_tempo_invoice: %v", err)
	}
	return orderID
}

// EnsurePesanan inserts a supplier, a pesanan in ORDERED status, and one
// pesanan_items row for the given sku. Returns (supplierID, pesananID,
// pesananItemID) as UUID strings. Used by STOCK-type record_pi tests which
// require pesanan_id + pesanan_item_id.
func EnsurePesanan(t *testing.T, c *Client, sku string) (string, string, string) {
	t.Helper()
	supplierID := EnsureSupplier(t, c)

	pesananNumber := fmt.Sprintf("PES-TEST-%d", time.Now().UnixNano())
	var pesananID string
	if err := c.DB.QueryRow(`
		INSERT INTO public.pesanan (pesanan_number, supplier_id, status, subtotal, total)
		VALUES ($1, $2::uuid, 'ORDERED', 2000, 2000)
		RETURNING id::text`, pesananNumber, supplierID,
	).Scan(&pesananID); err != nil {
		t.Fatalf("EnsurePesanan (pesanan): %v", err)
	}

	var pesananItemID string
	if err := c.DB.QueryRow(`
		INSERT INTO public.pesanan_items (pesanan_id, sku, product_name, qty, unit_cost, subtotal)
		VALUES ($1::uuid, $2, 'Test Item', 10, 1000, 10000)
		RETURNING id::text`, pesananID, sku,
	).Scan(&pesananItemID); err != nil {
		t.Fatalf("EnsurePesanan (items): %v", err)
	}

	return supplierID, pesananID, pesananItemID
}

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
