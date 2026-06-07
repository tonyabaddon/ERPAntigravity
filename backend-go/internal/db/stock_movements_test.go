package db_test

import (
	"encoding/json"
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

// TestReceivePO_WritesLedgerRowPerLine verifies Phase 1 Task 4: the wrapped
// receive_purchase_order RPC writes exactly one stock_movements row per line
// item that actually moves stock, inside the same transaction as the stock
// update. The row must have source='purchase_receive', warehouse matching the
// p_warehouse arg, and qty_delta equal to the received qty.
//
// Calls the canonical 6-arg overload (the one src/lib/pembelianService.ts
// uses). The conditions JSONB is keyed by purchase_order_items.id — same
// shape the frontend builds.
func TestReceivePO_WritesLedgerRowPerLine(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	po := db.SeedPurchaseOrder(t, client, []db.POLine{
		{SKU: "TEST-IMM", OrderedQty: 7, UnitPrice: 1000},
	})
	beforeRows := db.CountStockMovements(t, client, "TEST-IMM")

	// Build conditions JSONB keyed by the item id (RPC reads
	// p_conditions->(item.id::text); empty conditions = no-op loop).
	conditions := map[string]map[string]any{
		po.ItemIDs[0]: {"qty_received": 7, "qty_damaged": 0},
	}
	condJSON, err := json.Marshal(conditions)
	if err != nil {
		t.Fatalf("marshal conditions: %v", err)
	}

	// Canonical 6-arg signature: (p_po_id, p_received_at, p_payment_due_at,
	// p_invoice_url, p_conditions, p_warehouse). See migration
	// 20260605000002_warehouse_columns.sql lines 75-82 for the live shape.
	_, err = client.DB.Exec(
		`SELECT public.receive_purchase_order(
		   p_po_id          => $1::uuid,
		   p_received_at    => now(),
		   p_payment_due_at => CURRENT_DATE,
		   p_invoice_url    => NULL,
		   p_conditions     => $2::jsonb,
		   p_warehouse      => 'atas')`, po.ID, string(condJSON))
	if err != nil {
		t.Fatalf("receive_purchase_order failed: %v", err)
	}

	afterRows := db.CountStockMovements(t, client, "TEST-IMM")
	if afterRows-beforeRows != 1 {
		t.Fatalf("expected 1 new ledger row, got %d", afterRows-beforeRows)
	}

	var source, warehouse, relatedDocType, relatedDocID string
	var delta int
	err = client.DB.QueryRow(
		`SELECT source::text, warehouse, qty_delta,
		        related_doc_type, related_doc_id
		 FROM public.stock_movements
		 WHERE related_doc_type='purchase_order' AND related_doc_id=$1
		 ORDER BY id DESC LIMIT 1`, po.ID).Scan(
		&source, &warehouse, &delta, &relatedDocType, &relatedDocID)
	if err != nil {
		t.Fatalf("read ledger: %v", err)
	}
	if source != "purchase_receive" {
		t.Fatalf("source = %q, want purchase_receive", source)
	}
	if warehouse != "atas" {
		t.Fatalf("warehouse = %q, want atas", warehouse)
	}
	if delta != 7 {
		t.Fatalf("qty_delta = %d, want 7", delta)
	}
	if relatedDocType != "purchase_order" || relatedDocID != po.ID {
		t.Fatalf("related = %s/%s, want purchase_order/%s",
			relatedDocType, relatedDocID, po.ID)
	}
}

