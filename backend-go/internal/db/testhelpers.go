package db

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/joho/godotenv"
)

// NewTestClient returns a *Client connected to the database identified by
// SUPABASE_DB_CONNECTION. It is the standard helper for integration tests in
// internal/db. If the env var is missing the test is skipped — tests should
// not be a noisy failure when run on a workstation without the connection
// string exported.
//
// The helper walks up the directory tree looking for a .env file (so that
// running `go test ./internal/db/...` from the repository root or from
// backend-go/ both work without extra setup).
func NewTestClient(t testing.TB) *Client {
	t.Helper()

	conn := os.Getenv("SUPABASE_DB_CONNECTION")
	if conn == "" {
		if path, ok := findEnvFile(); ok {
			_ = godotenv.Load(path)
			conn = os.Getenv("SUPABASE_DB_CONNECTION")
		}
	}
	if conn == "" {
		t.Skip("SUPABASE_DB_CONNECTION not set; skipping integration test")
	}

	client, err := NewClientWithoutListener(conn)
	if err != nil {
		t.Fatalf("connect to test DB: %v", err)
	}
	return client
}

// findEnvFile walks up from the current working directory looking for the
// nearest .env file. Returns the absolute path and true if found.
func findEnvFile() (string, bool) {
	dir, err := os.Getwd()
	if err != nil {
		return "", false
	}
	for {
		candidate := filepath.Join(dir, ".env")
		if _, err := os.Stat(candidate); err == nil {
			return candidate, true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}

// POLine is a minimal description of a purchase_order_items row used by
// SeedPurchaseOrder. OrderedQty becomes purchase_order_items.qty; UnitPrice
// becomes unit_cost. The SKU must already exist in stocks (the FK is enforced).
type POLine struct {
	SKU        string
	OrderedQty int
	UnitPrice  int
}

// SeededPO is the return value from SeedPurchaseOrder. It carries the PO id
// plus the generated item ids — the latter are needed to construct the
// p_conditions JSONB argument that receive_purchase_order expects (the RPC
// keys conditions by purchase_order_items.id).
type SeededPO struct {
	ID      string
	ItemIDs []string
}

// SeedPurchaseOrder inserts a supplier (if needed), a purchase_order in
// ORDERED status, and one purchase_order_items row per line. Returns the PO
// id and per-line item ids so callers can build a conditions JSONB.
//
// Side effects:
//   - Ensures each line's SKU exists in public.stocks (idempotent ON CONFLICT).
//   - Inserts a test supplier with a unique name per call.
//   - Inserts the PO with status='ORDERED' (the only status from which
//     receive_purchase_order accepts a transition; see migration
//     20260605000002_warehouse_columns.sql line 94).
func SeedPurchaseOrder(t testing.TB, c *Client, lines []POLine) SeededPO {
	t.Helper()

	// 1. Ensure every line's SKU exists in stocks (FK target).
	for _, line := range lines {
		if _, err := c.DB.Exec(
			`INSERT INTO public.stocks (sku, name, category, price, stock, status, specs)
			 VALUES ($1, $2, 'Aksesori', 1000, 0, 'Sinkron', '{}'::jsonb)
			 ON CONFLICT (sku) DO NOTHING`,
			line.SKU, "Test SKU "+line.SKU); err != nil {
			t.Fatalf("seed stocks for %s failed: %v", line.SKU, err)
		}
	}

	// 2. Insert a supplier with a unique name (no UNIQUE constraint on
	// suppliers.name — collisions are harmless, but uniqueness keeps test
	// state observable).
	supplierName := fmt.Sprintf("Test Supplier %d", time.Now().UnixNano())
	var supplierID string
	if err := c.DB.QueryRow(
		`INSERT INTO public.suppliers (name) VALUES ($1) RETURNING id`,
		supplierName).Scan(&supplierID); err != nil {
		t.Fatalf("seed supplier failed: %v", err)
	}

	// 3. Insert the PO in ORDERED status with a unique PO number.
	poNumber := fmt.Sprintf("PO-TEST-%d", time.Now().UnixNano())
	var poID string
	if err := c.DB.QueryRow(
		`INSERT INTO public.purchase_orders
		   (po_number, supplier_id, status, ordered_at, subtotal, total)
		 VALUES ($1, $2, 'ORDERED', now(), 0, 0)
		 RETURNING id`,
		poNumber, supplierID).Scan(&poID); err != nil {
		t.Fatalf("seed PO failed: %v", err)
	}

	// 4. Insert one purchase_order_items row per line, collecting item ids.
	itemIDs := make([]string, 0, len(lines))
	for _, line := range lines {
		var itemID string
		subtotal := line.OrderedQty * line.UnitPrice
		if err := c.DB.QueryRow(
			`INSERT INTO public.purchase_order_items
			   (po_id, sku, product_name, qty, unit_cost, subtotal)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 RETURNING id`,
			poID, line.SKU, "Item "+line.SKU,
			line.OrderedQty, line.UnitPrice, subtotal).Scan(&itemID); err != nil {
			t.Fatalf("seed PO line for %s failed: %v", line.SKU, err)
		}
		itemIDs = append(itemIDs, itemID)
	}

	return SeededPO{ID: poID, ItemIDs: itemIDs}
}

// EnsureSKUStock seeds a SKU into public.stocks (if absent) and sets the
// stock_<warehouse> column to qty. Also ensures at least one stock_lot row
// with qty_remaining > 0 exists so the FIFO walk in deduct_stock_fifo has
// inventory to consume.
//
// Idempotent: re-running with the same args is a no-op on the lots side
// (NOT EXISTS guard) and a simple overwrite on the stocks column.
//
// Used by tests that need a deterministic starting stock state (e.g.
// TestDeductFIFO_*). warehouse must be "atas" or "bawah" — anything else is
// a test programmer error and fails fast.
func EnsureSKUStock(t testing.TB, c *Client, sku, warehouse string, qty int) {
	t.Helper()
	if warehouse != "atas" && warehouse != "bawah" {
		t.Fatalf("warehouse must be atas|bawah, got %q", warehouse)
	}

	if _, err := c.DB.Exec(
		`INSERT INTO public.stocks (sku, name, category, price, stock, status, specs)
		 VALUES ($1, 'Test SKU', 'Aksesori', 1000, 0, 'Sinkron', '{}'::jsonb)
		 ON CONFLICT (sku) DO NOTHING`, sku); err != nil {
		t.Fatalf("seed sku %s: %v", sku, err)
	}

	col := "stock_atas"
	if warehouse == "bawah" {
		col = "stock_bawah"
	}
	if _, err := c.DB.Exec(
		`UPDATE public.stocks SET `+col+` = $1, updated_at = now() WHERE sku=$2`,
		qty, sku); err != nil {
		t.Fatalf("set %s for %s: %v", col, sku, err)
	}

	// Ensure at least one stock_lot exists with qty_remaining > 0 so FIFO has
	// something to consume. po_id is NULL (no PO context); unit_cost is a
	// throwaway. The NOT EXISTS guard makes this idempotent across re-runs.
	if _, err := c.DB.Exec(
		`INSERT INTO public.stock_lots (sku, po_id, unit_cost, qty_received, qty_remaining, received_at)
		 SELECT $1::varchar, NULL, 1000, $2, $2, now() - INTERVAL '10 years'
		 WHERE NOT EXISTS (
		   SELECT 1 FROM public.stock_lots WHERE sku=$1::varchar AND qty_remaining > 0
		 )`, sku, qty); err != nil {
		t.Fatalf("seed stock_lot for %s: %v", sku, err)
	}
}

// CountStockMovements returns the current number of stock_movements rows for
// the given SKU. Used by tests to assert how many ledger rows a single RPC
// call produced.
func CountStockMovements(t testing.TB, c *Client, sku string) int {
	t.Helper()
	var n int
	if err := c.DB.QueryRow(
		`SELECT COUNT(*) FROM public.stock_movements WHERE sku=$1`, sku).Scan(&n); err != nil {
		t.Fatalf("count stock_movements for %s: %v", sku, err)
	}
	return n
}

// SeedStockWithHPP creates a SKU with a known harga_modal so the Phase 4
// pengawasan views compute a deterministic value_rp (= ABS(qty_delta) *
// harga_modal). Idempotent via ON CONFLICT — re-running with the same SKU
// rewrites harga_modal so individual tests stay independent.
func SeedStockWithHPP(t testing.TB, c *Client, sku string, hargaModal int) {
	t.Helper()
	_, err := c.DB.Exec(
		`INSERT INTO public.stocks (sku, name, category, price, harga_modal, stock, status, specs)
		 VALUES ($1, 'Pengawasan Test SKU', 'Aksesori', $2 * 2, $2, 0, 'Sinkron', '{}'::jsonb)
		 ON CONFLICT (sku) DO UPDATE SET harga_modal = EXCLUDED.harga_modal`,
		sku, hargaModal)
	if err != nil {
		t.Fatalf("seed sku with hpp: %v", err)
	}
}

// SeedCommittedAdjustment creates a stock_adjustments row in 'approved' state
// with committed_at set + a paired stock_movements row. Mimics what the
// commit_approved_adjustment RPC would produce in production, so the Phase 4
// v_pengawasan_top_adjustments view (which filters on committed_at IS NOT NULL)
// returns the row.
//
// reason_code must be one of the stock_adjustment_reason enum values. For
// 'rusak' or 'hilang' the chk_evidence_for_loss CHECK requires at least one
// evidence URL, so this helper injects a placeholder for those cases.
func SeedCommittedAdjustment(t testing.TB, c *Client, sku, warehouse string, qtyDelta int, reasonCode string) {
	t.Helper()

	// 1. Need an approval_request first (FK target on stock_adjustments). Use
	//    'approved' status directly — we are simulating the post-commit state.
	var approvalID int64
	err := c.DB.QueryRow(
		`INSERT INTO public.approval_requests (request_type, payload, requested_by, status)
		 VALUES ('adjustment', '{}'::jsonb, '00000000-0000-0000-0000-000000000001', 'approved')
		 RETURNING id`).Scan(&approvalID)
	if err != nil {
		t.Fatalf("seed approval: %v", err)
	}

	// 2. Insert the paired stock_movements ledger row first so we can pin
	//    committed_movement_id on the adjustment row. chk_qty_math requires
	//    qty_before + qty_delta = qty_after — pick 100 as the baseline so both
	//    positive and negative deltas satisfy the constraint.
	var moveID int64
	err = c.DB.QueryRow(
		`INSERT INTO public.stock_movements
		   (sku, warehouse, qty_delta, qty_before, qty_after, source,
		    related_doc_type, related_doc_id, reason_code,
		    actor_user_id, actor_role)
		 VALUES ($1, $2, $3, 100, 100 + $3, 'adjustment',
		         'stock_adjustment', $4::text, $5,
		         '00000000-0000-0000-0000-000000000001', 'system_test')
		 RETURNING id`,
		sku, warehouse, qtyDelta, approvalID, reasonCode).Scan(&moveID)
	if err != nil {
		t.Fatalf("seed movement: %v", err)
	}

	// 3. Insert the stock_adjustments row pinned to both the approval and the
	//    ledger row. Evidence is required for rusak/hilang per chk_evidence_for_loss.
	evidence := "{}"
	if reasonCode == "rusak" || reasonCode == "hilang" {
		evidence = `{"stock-evidence/test.jpg"}`
	}

	_, err = c.DB.Exec(
		`INSERT INTO public.stock_adjustments
		   (sku, warehouse, qty_delta, reason_code, evidence_urls,
		    requested_by, approval_request_id, status,
		    committed_at, committed_movement_id)
		 VALUES ($1, $2, $3, $4::public.stock_adjustment_reason, $5::text[],
		         '00000000-0000-0000-0000-000000000001', $6, 'approved',
		         now(), $7)`,
		sku, warehouse, qtyDelta, reasonCode, evidence, approvalID, moveID)
	if err != nil {
		t.Fatalf("seed adjustment: %v", err)
	}
}

// SeedPendingAdjustment creates a stock_adjustments row in 'pending_approval'
// state — no committed_at, no movement row. Used to verify that the Phase 4
// v_pengawasan_top_adjustments view filters out pending rows.
func SeedPendingAdjustment(t testing.TB, c *Client, sku, warehouse string, qtyDelta int, reasonCode string) {
	t.Helper()

	var approvalID int64
	err := c.DB.QueryRow(
		`INSERT INTO public.approval_requests (request_type, payload, requested_by, status)
		 VALUES ('adjustment', '{}'::jsonb, '00000000-0000-0000-0000-000000000001', 'pending')
		 RETURNING id`).Scan(&approvalID)
	if err != nil {
		t.Fatalf("seed approval: %v", err)
	}

	evidence := "{}"
	if reasonCode == "rusak" || reasonCode == "hilang" {
		evidence = `{"stock-evidence/test.jpg"}`
	}

	_, err = c.DB.Exec(
		`INSERT INTO public.stock_adjustments
		   (sku, warehouse, qty_delta, reason_code, evidence_urls,
		    requested_by, approval_request_id, status)
		 VALUES ($1, $2, $3, $4::public.stock_adjustment_reason, $5::text[],
		         '00000000-0000-0000-0000-000000000001', $6, 'pending_approval')`,
		sku, warehouse, qtyDelta, reasonCode, evidence, approvalID)
	if err != nil {
		t.Fatalf("seed pending adjustment: %v", err)
	}
}
