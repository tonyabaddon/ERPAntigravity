package db_test

import (
	"strings"
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

// seedOneRow inserts a stock_movements row directly via service_role for
// test setup, returning the id. It also ensures the TEST-IMM SKU exists in
// the stocks table (FK requirement). Both inserts are idempotent — the SKU
// and any leftover seed rows persist between runs without harm.
func seedOneRow(t *testing.T, client *db.Client) int64 {
	t.Helper()

	if _, err := client.DB.Exec(
		`INSERT INTO public.stocks (sku, name, category, price, stock, status, specs)
		 VALUES ('TEST-IMM', 'Test SKU', 'Aksesori', 1000, 0, 'Sinkron', '{}'::jsonb)
		 ON CONFLICT (sku) DO NOTHING`); err != nil {
		t.Fatalf("seed stocks failed: %v", err)
	}

	var id int64
	err := client.DB.QueryRow(
		`INSERT INTO public.stock_movements
		   (sku, warehouse, qty_delta, qty_before, qty_after, source, actor_user_id, actor_role)
		 VALUES ('TEST-IMM','atas', 5, 0, 5, 'seed',
		         '00000000-0000-0000-0000-000000000000', 'system_test')
		 RETURNING id`).Scan(&id)
	if err != nil {
		t.Fatalf("seed insert failed: %v", err)
	}
	return id
}

// TestStockMovements_UpdateRaises verifies the BEFORE UPDATE trigger blocks
// modifications even when connected as service_role — the belt-and-suspenders
// guarantee from spec Foundational Decision #1.
func TestStockMovements_UpdateRaises(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	id := seedOneRow(t, client)

	_, err := client.DB.Exec(
		`UPDATE public.stock_movements SET reason_note='hacked' WHERE id=$1`, id)
	if err == nil {
		t.Fatalf("expected UPDATE to raise, got nil")
	}
	if !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("unexpected error: %v", err)
	}
}

// TestStockMovements_DeleteRaises verifies the BEFORE DELETE trigger blocks
// row removal even as service_role.
func TestStockMovements_DeleteRaises(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	id := seedOneRow(t, client)

	_, err := client.DB.Exec(
		`DELETE FROM public.stock_movements WHERE id=$1`, id)
	if err == nil {
		t.Fatalf("expected DELETE to raise, got nil")
	}
	if !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("unexpected error: %v", err)
	}
}
