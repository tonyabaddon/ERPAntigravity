package db_test

import (
	"database/sql"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

// SKU price used by Phase 4 Task 2 tests for the kasir-discount view. Picked
// large enough that "discount = stocks.price - unit_price" stays comfortably
// non-zero in arithmetic without overflowing numeric.
const kasirDiscountTestPrice = 10000

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

// TestPengawasanView_KasirDiscount_7d_AggregatesCorrectly pins the contract of
// v_pengawasan_kasir_discount_7d (Phase 4 Task 2). For one cashier with two
// recent income kasir transactions:
//   - line 1: 1× SKU at list price (10_000) → no discount.
//   - line 2: 2× SKU at 7_000 (3_000 below list) → discount = 6_000.
//
// Expected aggregate:
//   - total_revenue_rp        = 10_000 + 2*7_000 = 24_000
//   - total_discount_rp       = 0       + 2*3_000 = 6_000
//   - discount_pct_of_revenue = 6_000 / 24_000 = 0.25
//
// We use a fresh admin user per test (unique name) and unique SKU so adjacent
// runs against the shared Supabase test DB do not contaminate each other.
func TestPengawasanView_KasirDiscount_7d_AggregatesCorrectly(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	nano := time.Now().UnixNano()
	sku := fmt.Sprintf("T2-KD-%d", nano)
	cashierName := fmt.Sprintf("Test Kasir %d", nano)

	cashierID := db.SeedAdminUser(t, client, cashierName, "Staff Admin Toko")
	db.SeedStockWithPrice(t, client, sku, kasirDiscountTestPrice)

	// Full-price sale: 1 × 10_000.
	db.SeedKasirTransaction(t, client, db.KasirTxSeed{
		CreatedBy: cashierID,
		Status:    "PAID",
		CreatedAt: time.Now(), // recent — within 7d window
		Items: []db.KasirTxItem{
			{SKU: sku, UnitPrice: 10000, Qty: 1},
		},
	})
	// Discounted sale: 2 × 7_000 (3_000 discount per unit).
	db.SeedKasirTransaction(t, client, db.KasirTxSeed{
		CreatedBy: cashierID,
		Status:    "PAID",
		CreatedAt: time.Now(),
		Items: []db.KasirTxItem{
			{SKU: sku, UnitPrice: 7000, Qty: 2},
		},
	})

	var disc, rev, pct float64
	err := client.DB.QueryRow(
		`SELECT total_discount_rp, total_revenue_rp, discount_pct_of_revenue
		   FROM public.v_pengawasan_kasir_discount_7d
		  WHERE cashier_user_id = $1`, cashierID).Scan(&disc, &rev, &pct)
	if err != nil {
		t.Fatalf("query view: %v", err)
	}

	if disc != 6000 {
		t.Fatalf("expected total_discount_rp=6000, got %v", disc)
	}
	if rev != 24000 {
		t.Fatalf("expected total_revenue_rp=24000, got %v", rev)
	}
	if pct < 0.249 || pct > 0.251 {
		t.Fatalf("expected discount_pct_of_revenue ~ 0.25, got %v", pct)
	}
}

// TestPengawasanView_KasirDiscount_7d_FiltersOutOlder verifies the 7-day window
// is enforced. We seed one recent discounted sale (in window) and one identical
// sale dated 8 days ago (outside window). Only the recent one must contribute
// to the cashier's totals.
func TestPengawasanView_KasirDiscount_7d_FiltersOutOlder(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	nano := time.Now().UnixNano()
	sku := fmt.Sprintf("T2-KD-OLD-%d", nano)
	cashierName := fmt.Sprintf("Test Kasir Old %d", nano)

	cashierID := db.SeedAdminUser(t, client, cashierName, "Staff Admin Toko")
	db.SeedStockWithPrice(t, client, sku, kasirDiscountTestPrice)

	// Recent: 1 × 7000 → discount=3000, revenue=7000.
	db.SeedKasirTransaction(t, client, db.KasirTxSeed{
		CreatedBy: cashierID,
		Status:    "PAID",
		CreatedAt: time.Now(),
		Items: []db.KasirTxItem{
			{SKU: sku, UnitPrice: 7000, Qty: 1},
		},
	})
	// Old: 1 × 7000 from 8 days ago — must be filtered out.
	db.SeedKasirTransaction(t, client, db.KasirTxSeed{
		CreatedBy: cashierID,
		Status:    "PAID",
		CreatedAt: time.Now().Add(-8 * 24 * time.Hour),
		Items: []db.KasirTxItem{
			{SKU: sku, UnitPrice: 7000, Qty: 1},
		},
	})

	var disc, rev float64
	err := client.DB.QueryRow(
		`SELECT total_discount_rp, total_revenue_rp
		   FROM public.v_pengawasan_kasir_discount_7d
		  WHERE cashier_user_id = $1`, cashierID).Scan(&disc, &rev)
	if err != nil {
		t.Fatalf("query view: %v", err)
	}

	if disc != 3000 {
		t.Fatalf("expected total_discount_rp=3000 (only recent row), got %v", disc)
	}
	if rev != 7000 {
		t.Fatalf("expected total_revenue_rp=7000 (only recent row), got %v", rev)
	}
}

// TestPengawasanView_OutflowOutliers_FlagsHotSKU pins the contract of
// v_pengawasan_outflow_outliers (Phase 4 Task 3): SKUs whose last-7-day outflow
// exceeds 3× their 90-day daily-average × 7 surface as outliers.
//
// Seed strategy:
//   - 80 historical outflows of -1 each, scheduled days_ago = 8..87 (outside the
//     7-day window, inside the 90-day window).
//   - 1 surge outflow of -50 today (inside the 7-day window).
//
// Math:
//   - sum_7d            = 50
//   - sum_90d           = 80 + 50 = 130
//   - avg_daily_90d     = 130 / 90 ≈ 1.444
//   - threshold (3×avg×7) ≈ 30.3
//   - multiplier        = 50 / (1.444 × 7) ≈ 4.94 > 3 → flagged.
//
// Per-test unique SKU prevents collisions on the shared Supabase test DB
// (stock_movements is append-only — rerunning with a fixed SKU would compound).
func TestPengawasanView_OutflowOutliers_FlagsHotSKU(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	nano := time.Now().UnixNano()
	sku := fmt.Sprintf("T3-OUT-HOT-%d", nano)

	db.SeedStockWithHPP(t, client, sku, 1000)

	// 80-day baseline: -1 per day at days_ago = 8..87.
	now := time.Now()
	for daysAgo := 8; daysAgo <= 87; daysAgo++ {
		db.SeedStockMovement(t, client, sku, "atas", -1,
			now.Add(-time.Duration(daysAgo)*24*time.Hour))
	}
	// Surge: -50 today (well inside the 7-day window).
	db.SeedStockMovement(t, client, sku, "atas", -50, now)

	var mult float64
	err := client.DB.QueryRow(
		`SELECT multiplier
		   FROM public.v_pengawasan_outflow_outliers
		  WHERE sku = $1`, sku).Scan(&mult)
	if err != nil {
		t.Fatalf("query view: %v — expected %s to surface as outlier", err, sku)
	}
	if mult <= 3 {
		t.Fatalf("multiplier=%v want > 3", mult)
	}
}

// TestPengawasanView_OutflowOutliers_ExcludesNormalSKU verifies the threshold's
// negative case: a SKU with steady, non-surging outflow must NOT appear in the
// view. Seeding -1 per day for the last 90 days yields:
//   - sum_7d        = 7
//   - avg_daily_90d = 1.0
//   - threshold     = 3 × 1.0 × 7 = 21
//   - 7 is not > 21 → excluded.
func TestPengawasanView_OutflowOutliers_ExcludesNormalSKU(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	nano := time.Now().UnixNano()
	sku := fmt.Sprintf("T3-OUT-NORMAL-%d", nano)

	db.SeedStockWithHPP(t, client, sku, 1000)

	// Steady 1/day outflow for the last 90 days (days_ago = 0..89).
	now := time.Now()
	for daysAgo := 0; daysAgo < 90; daysAgo++ {
		db.SeedStockMovement(t, client, sku, "atas", -1,
			now.Add(-time.Duration(daysAgo)*24*time.Hour))
	}

	var mult float64
	err := client.DB.QueryRow(
		`SELECT multiplier
		   FROM public.v_pengawasan_outflow_outliers
		  WHERE sku = $1`, sku).Scan(&mult)
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("expected %s excluded (sql.ErrNoRows), got err=%v multiplier=%v",
			sku, err, mult)
	}
}
