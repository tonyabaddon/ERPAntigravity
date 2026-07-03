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

// OwnerUUID returns the UUID of an active Owner from admin_users. It looks up
// the first active Owner by email match against auth.users. If no matching row
// exists the test is fatally skipped — deployment-configuration issue.
//
// Note: approve_tempo_write_off internally calls _piutang_write_off_resolve_owner()
// which derives the caller via auth.uid() → auth.users.email → admin_users.
// Tests must set request.jwt.claim.sub to this UUID before calling the RPC.
// See AsOwnerExec for the combined helper.
func OwnerUUID(t *testing.T, c *Client) string {
	t.Helper()
	// Look for an active Owner row that also has a matching auth.users entry.
	var uid string
	err := c.DB.QueryRow(`
		SELECT au.id::text
		  FROM auth.users au
		  JOIN public.admin_users a ON lower(a.email) = lower(au.email)
		 WHERE a.role = 'Owner'
		   AND a.status = 'Aktif'
		 ORDER BY au.created_at ASC
		 LIMIT 1`).Scan(&uid)
	if err != nil {
		t.Skipf("OwnerUUID: no active Owner with matching auth.users row — skip: %v", err)
	}
	return uid
}

// EnsureOwnerAdminUser ensures an admin_users row with role='Owner' and
// status='Aktif' exists for the given auth user email. If the row already
// exists it is left unchanged. Returns the admin_users.id UUID (NOT the
// auth.users.id — these are separate PKs in this schema).
//
// This is needed for tests that call RPCs gated by _piutang_write_off_resolve_owner,
// which checks: auth.uid() → auth.users.email → admin_users (role='Owner', status='Aktif').
func EnsureOwnerAdminUser(t *testing.T, c *Client, ownerEmail string) {
	t.Helper()
	_, err := c.DB.Exec(`
		INSERT INTO public.admin_users (name, email, role, status)
		VALUES ('Test Owner', $1, 'Owner', 'Aktif')
		ON CONFLICT DO NOTHING`,
		ownerEmail)
	if err != nil {
		t.Fatalf("EnsureOwnerAdminUser: %v", err)
	}
}

// SeedTempoWriteOffRequest creates an INVOICE_TEMPO order with the given total
// and a pending piutang_write_off approval_request. Returns (approvalID, orderID)
// so callers can drive either approve_tempo_write_off(approvalID) or directly
// query the JE by orderID.
//
// All seeding is done via direct SQL under service_role; no auth gate. The order
// is NOT created via create_tempo_invoice because we need to control the exact
// total amount independently of stock/HPP logic.
func SeedTempoWriteOffRequest(t *testing.T, c *Client, total int) (int64, string) {
	t.Helper()

	// 1. Seed a minimal INVOICE_TEMPO order (service_role can INSERT directly).
	custID := EnsureTempoCustomer(t, c, 30, 10000000)
	stockSku := fmt.Sprintf("WO-SEED-%d", time.Now().UnixNano())
	EnsureSKUStock(t, c, stockSku, "atas", 50)

	var orderID string
	if err := c.DB.QueryRow(`
		INSERT INTO public.orders (
		  customer_id, customer_name, customer_phone,
		  items, subtotal, total, hpp_total,
		  payment_type, channel, sales_channel, status, due_date, delivery_type,
		  booking_expires_at, created_at, updated_at
		) VALUES (
		  $1, 'Test WO Customer', '+628110000001',
		  '[]'::jsonb, $2, $2, 0,
		  'TEMPO', 'walkin', 'walkin', 'INVOICE_TEMPO',
		  CURRENT_DATE + 30, 'PICKUP',
		  now() + interval '90 days', now(), now()
		) RETURNING id::text`, custID, total,
	).Scan(&orderID); err != nil {
		t.Fatalf("SeedTempoWriteOffRequest INSERT order: %v", err)
	}

	// 2. Create approval_request of type piutang_write_off.
	var approvalID int64
	if err := c.DB.QueryRow(`
		INSERT INTO public.approval_requests
		  (request_type, payload, requested_by, expires_at)
		VALUES (
		  'piutang_write_off'::public.approval_request_type,
		  jsonb_build_object('order_id', $1::text),
		  '00000000-0000-0000-0000-000000000001'::uuid,
		  '9999-12-31 23:59:59+00'
		) RETURNING id`, orderID,
	).Scan(&approvalID); err != nil {
		t.Fatalf("SeedTempoWriteOffRequest INSERT approval_requests: %v", err)
	}

	// 3. Create satellite piutang_write_off_requests row.
	if _, err := c.DB.Exec(`
		INSERT INTO public.piutang_write_off_requests (approval_id, order_id, reason)
		VALUES ($1, $2::uuid, 'Test write-off reason (automated)')`,
		approvalID, orderID,
	); err != nil {
		t.Fatalf("SeedTempoWriteOffRequest INSERT piutang_write_off_requests: %v", err)
	}

	return approvalID, orderID
}

// AsOwnerExec executes a SQL statement with auth.uid() set to ownerUID for the
// duration of the call. Both set_config and the statement are executed in a
// single round-trip using a transaction-local config to avoid connection-pool
// interleaving issues.
//
// Use this for any RPC that calls _piutang_write_off_resolve_owner() internally,
// such as approve_tempo_write_off and revert_tempo_write_off.
func AsOwnerExec(t *testing.T, c *Client, ownerUID, sql string, args ...interface{}) error {
	t.Helper()
	// Execute inside an explicit transaction so the set_config (is_local=true)
	// persists across the two statements on the same connection.
	tx, err := c.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	if _, err := tx.Exec(
		`SELECT set_config('request.jwt.claim.sub', $1, true)`, ownerUID,
	); err != nil {
		return fmt.Errorf("set_config: %w", err)
	}
	if _, err := tx.Exec(sql, args...); err != nil {
		return err
	}
	return tx.Commit()
}
