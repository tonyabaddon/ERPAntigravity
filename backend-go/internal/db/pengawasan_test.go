package db_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

// TestPengawasanView_TopAdjustments_OrdersByValueDesc pins the contract of the
// v_pengawasan_top_adjustments view (Phase 4 Task 1): rows are ranked by
// absolute rupiah value, defined as ABS(qty_delta) * COALESCE(harga_modal,0).
//
// Seed strategy:
//   - SKU-A: qty_delta=-10, harga_modal=5000 → value_rp = 50000.
//   - SKU-B: qty_delta=-1,  harga_modal=100  → value_rp = 100.
//
// Per-test unique SKUs (nano-suffix) prevent collisions against the shared
// Supabase test database when adjacent tests seed adjustments.
func TestPengawasanView_TopAdjustments_OrdersByValueDesc(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	nano := time.Now().UnixNano()
	skuA := fmt.Sprintf("T1-PENG-A-%d", nano)
	skuB := fmt.Sprintf("T1-PENG-B-%d", nano)

	db.SeedStockWithHPP(t, client, skuA, 5000)
	db.SeedStockWithHPP(t, client, skuB, 100)
	db.SeedCommittedAdjustment(t, client, skuA, "atas", -10, "rusak")
	db.SeedCommittedAdjustment(t, client, skuB, "atas", -1, "rusak")

	rows, err := client.DB.Query(
		`SELECT sku, value_rp
		   FROM public.v_pengawasan_top_adjustments
		  WHERE sku IN ($1, $2)
		  ORDER BY value_rp DESC`, skuA, skuB)
	if err != nil {
		t.Fatalf("query view: %v", err)
	}
	defer rows.Close()

	type row struct {
		SKU string
		Val float64
	}
	var got []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.SKU, &r.Val); err != nil {
			t.Fatalf("scan: %v", err)
		}
		got = append(got, r)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows iter: %v", err)
	}

	if len(got) != 2 {
		t.Fatalf("expected 2 rows, got %d: %+v", len(got), got)
	}
	if got[0].SKU != skuA || got[1].SKU != skuB {
		t.Fatalf("expected %s first then %s, got %+v", skuA, skuB, got)
	}
	if got[0].Val != 50000 {
		t.Fatalf("expected value_rp=50000 for %s, got %v", skuA, got[0].Val)
	}
	if got[1].Val != 100 {
		t.Fatalf("expected value_rp=100 for %s, got %v", skuB, got[1].Val)
	}
}

// TestPengawasanView_TopAdjustments_OnlyShowsCommitted verifies the view's
// WHERE clause: pending_approval rows (committed_at IS NULL) are filtered out
// because they do not represent realized stock movement.
func TestPengawasanView_TopAdjustments_OnlyShowsCommitted(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	nano := time.Now().UnixNano()
	skuCommitted := fmt.Sprintf("T1-PENG-C-%d", nano)
	skuPending := fmt.Sprintf("T1-PENG-P-%d", nano)

	db.SeedStockWithHPP(t, client, skuCommitted, 2000)
	db.SeedStockWithHPP(t, client, skuPending, 2000)
	db.SeedCommittedAdjustment(t, client, skuCommitted, "atas", -3, "rusak")
	db.SeedPendingAdjustment(t, client, skuPending, "atas", -3, "rusak")

	var n int
	err := client.DB.QueryRow(
		`SELECT COUNT(*) FROM public.v_pengawasan_top_adjustments
		  WHERE sku IN ($1, $2)`, skuCommitted, skuPending).Scan(&n)
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected exactly 1 row (committed only), got %d", n)
	}

	// And confirm it is the committed SKU that appears.
	var seenSKU string
	err = client.DB.QueryRow(
		`SELECT sku FROM public.v_pengawasan_top_adjustments
		  WHERE sku IN ($1, $2) LIMIT 1`, skuCommitted, skuPending).Scan(&seenSKU)
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if seenSKU != skuCommitted {
		t.Fatalf("expected committed sku %s, got %s", skuCommitted, seenSKU)
	}
}
