package db_test

import (
	"strings"
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

// TestStockMovements_TableExists is the foundation test for Phase 1: the
// immutable stock_movements ledger must exist in the public schema after
// migration 20260607000001_stock_movements.sql is applied.
func TestStockMovements_TableExists(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	var n int
	err := client.DB.QueryRow(
		`SELECT 1 FROM information_schema.tables
		 WHERE table_schema = 'public' AND table_name = 'stock_movements'`).Scan(&n)
	if err != nil {
		t.Fatalf("stock_movements table missing: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected scan to yield 1, got %d", n)
	}
}

// TestLogStockMovement_HappyPath verifies the _log_stock_movement helper RPC
// correctly inserts a row with qty_after = qty_before + qty_delta. This is the
// single chokepoint that every wrapper RPC (receive_purchase_order, deduct_*,
// transfer_*) calls inside its transaction in Tasks 4-7.
func TestLogStockMovement_HappyPath(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	// Defensive seed: when running with `-run TestLogStockMovement` the
	// immutability tests don't fire, so TEST-IMM may not yet exist in stocks.
	// seedOneRow is idempotent (ON CONFLICT DO NOTHING).
	_ = seedOneRow(t, client)

	var id int64
	err := client.DB.QueryRow(
		`SELECT public._log_stock_movement(
		   p_sku=>'TEST-IMM', p_warehouse=>'atas', p_qty_delta=>3,
		   p_qty_before=>5, p_source=>'adjustment'::public.stock_movement_source,
		   p_related_doc_type=>'test', p_related_doc_id=>'test-1',
		   p_reason_code=>'koreksi_input', p_reason_note=>'unit test',
		   p_actor_user_id=>'00000000-0000-0000-0000-000000000001'::uuid,
		   p_actor_role=>'system_test')`).Scan(&id)
	if err != nil {
		t.Fatalf("helper failed: %v", err)
	}

	var qtyAfter int
	err = client.DB.QueryRow(
		`SELECT qty_after FROM public.stock_movements WHERE id=$1`, id).Scan(&qtyAfter)
	if err != nil {
		t.Fatalf("read failed: %v", err)
	}
	if qtyAfter != 8 {
		t.Fatalf("qty_after = %d, want 8", qtyAfter)
	}
}

// TestLogStockMovement_QtyMathViolation verifies chk_qty_math rejects rows
// whose qty_before + qty_delta != qty_after. The CHECK was installed in
// Task 1's migration; this test guards against accidental removal.
func TestLogStockMovement_QtyMathViolation(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	_ = seedOneRow(t, client)

	// Direct INSERT with broken math — must be rejected by chk_qty_math
	_, err := client.DB.Exec(
		`INSERT INTO public.stock_movements
		   (sku, warehouse, qty_delta, qty_before, qty_after, source, actor_user_id, actor_role)
		 VALUES ('TEST-IMM','atas', 3, 5, 99, 'adjustment',
		         '00000000-0000-0000-0000-000000000001', 'system_test')`)
	if err == nil {
		t.Fatalf("expected CHECK violation, got nil")
	}
	if !strings.Contains(err.Error(), "chk_qty_math") {
		t.Fatalf("unexpected error: %v", err)
	}
}
