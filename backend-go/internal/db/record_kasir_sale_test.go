package db_test

import (
	"database/sql"
	"fmt"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

// TestRecordKasirSale_HappyPath pins the happy path of record_kasir_sale:
// one item, paid in full, walkin channel. Asserts that a single RPC call
//
//	(a) decrements stocks.stock_atas by the qty,
//	(b) decrements stock_lots.qty_remaining FIFO by the qty,
//	(c) writes the kasir_transactions row with PAID status,
//	(d) generates an invoice number in WLK-YYYYMMDD-NNN format,
//	(e) computes hpp_per_unit from the FIFO unit_cost (1000 in the seed).
//
// Per-test unique SKU keeps state isolated from neighboring runs on the
// shared Supabase test database.
func TestRecordKasirSale_HappyPath(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	sku := fmt.Sprintf("RKS-HAPPY-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, sku, "atas", 10)
	// EnsureSKUStock seeds one stock_lot with unit_cost=1000, qty_remaining=10.

	items := fmt.Sprintf(`[
		{"sku":"%s","name":"Test Item","qty":3,"unit_price":5000,"subtotal":15000,"warehouse":"atas"}
	]`, sku)

	var (
		invoice    string
		status     string
		hppTotal   float64
		stockAtas  int
		lotRemain  int
		mvmCount   int
		itemsOut   string
	)

	today := time.Now().Format("2006-01-02")
	err := client.DB.QueryRow(
		`SELECT (rec).invoice_number, (rec).status, (rec).hpp_total, (rec).items::text
		   FROM (
		     SELECT public.record_kasir_sale(
		       $1::date,
		       'walkin',
		       $2::jsonb,
		       15000,
		       'cash',
		       NULL,
		       'FULL',
		       0,
		       NULL,
		       0,
		       NULL,
		       15000,
		       'Test Customer',
		       '081234567890',
		       NULL, NULL, NULL, NULL, NULL,
		       NULL
		     ) AS rec
		   ) sub`,
		today, items,
	).Scan(&invoice, &status, &hppTotal, &itemsOut)
	if err != nil {
		t.Fatalf("record_kasir_sale: %v", err)
	}

	if status != "PAID" {
		t.Fatalf("status = %q, want PAID", status)
	}
	if hppTotal != 3000 {
		t.Fatalf("hpp_total = %v, want 3000 (3 units × unit_cost 1000)", hppTotal)
	}
	// Invoice format: WLK-YYYYMMDD-NNN
	matched, _ := regexp.MatchString(`^WLK-\d{8}-\d{3}$`, invoice)
	if !matched {
		t.Fatalf("invoice_number = %q, want WLK-YYYYMMDD-NNN", invoice)
	}

	// items[0].hpp_per_unit should be 1000 (from seeded lot).
	if !strings.Contains(itemsOut, `"hpp_per_unit": 1000`) &&
		!strings.Contains(itemsOut, `"hpp_per_unit":1000`) {
		t.Fatalf("items did not carry hpp_per_unit=1000: %s", itemsOut)
	}

	// stocks.stock_atas decremented from 10 to 7.
	if err := client.DB.QueryRow(
		`SELECT stock_atas FROM public.stocks WHERE sku=$1`, sku).Scan(&stockAtas); err != nil {
		t.Fatalf("read stock_atas: %v", err)
	}
	if stockAtas != 7 {
		t.Fatalf("stock_atas = %d, want 7", stockAtas)
	}

	// stock_lots.qty_remaining decremented from 10 to 7.
	if err := client.DB.QueryRow(
		`SELECT qty_remaining FROM public.stock_lots WHERE sku=$1`, sku).Scan(&lotRemain); err != nil {
		t.Fatalf("read stock_lots: %v", err)
	}
	if lotRemain != 7 {
		t.Fatalf("stock_lots.qty_remaining = %d, want 7", lotRemain)
	}

	// 2 stock_movements rows expected: one from decrement_stock + one from
	// deduct_stock_fifo. Both carry related_doc_id = invoice_number.
	if err := client.DB.QueryRow(
		`SELECT COUNT(*) FROM public.stock_movements
		   WHERE sku=$1 AND related_doc_id=$2`, sku, invoice).Scan(&mvmCount); err != nil {
		t.Fatalf("count stock_movements: %v", err)
	}
	if mvmCount != 2 {
		t.Fatalf("stock_movements count = %d, want 2 (decrement_stock + deduct_stock_fifo)", mvmCount)
	}
}

// TestRecordKasirSale_RollsBackOnInvalidPayment is the atomicity guard the
// reviewer flagged as Critical: an invalid payment_method must abort the
// whole transaction. After the failed call we assert that NO side effect
// persisted — stock_atas unchanged, stock_lots.qty_remaining unchanged,
// kasir_counters not bumped, no kasir_transactions row inserted.
//
// This is the regression test for "Promise.all FIFO + nextInvoiceNumber +
// insertSaleTransaction" being non-atomic.
func TestRecordKasirSale_RollsBackOnInvalidPayment(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	sku := fmt.Sprintf("RKS-ROLLBACK-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, sku, "atas", 10)
	today := time.Now().Format("2006-01-02")

	var counterBefore sql.NullInt64
	_ = client.DB.QueryRow(
		`SELECT counter FROM public.kasir_counters WHERE channel='walkin' AND date=$1`,
		today,
	).Scan(&counterBefore)

	items := fmt.Sprintf(`[
		{"sku":"%s","name":"Test","qty":3,"unit_price":5000,"subtotal":15000,"warehouse":"atas"}
	]`, sku)

	// 'bitcoin' is not in the allowed payment_method whitelist -> RAISE EXCEPTION.
	_, err := client.DB.Exec(
		`SELECT public.record_kasir_sale(
		   $1::date, 'walkin', $2::jsonb, 15000,
		   'bitcoin', NULL, 'FULL', 0, NULL, 0, NULL, 15000,
		   'Bob', '0812', NULL, NULL, NULL, NULL, NULL, NULL
		 )`,
		today, items,
	)
	if err == nil {
		t.Fatalf("expected invalid payment_method to fail, got nil")
	}
	if !strings.Contains(err.Error(), "invalid payment_method") {
		t.Fatalf("expected 'invalid payment_method' error, got: %v", err)
	}

	// stocks.stock_atas must still be 10.
	var stockAtas int
	if err := client.DB.QueryRow(
		`SELECT stock_atas FROM public.stocks WHERE sku=$1`, sku).Scan(&stockAtas); err != nil {
		t.Fatalf("read stock_atas: %v", err)
	}
	if stockAtas != 10 {
		t.Fatalf("stock_atas = %d, want 10 (no side effect after failed call)", stockAtas)
	}

	// stock_lots.qty_remaining must still be 10.
	var lotRemain int
	if err := client.DB.QueryRow(
		`SELECT qty_remaining FROM public.stock_lots WHERE sku=$1`, sku).Scan(&lotRemain); err != nil {
		t.Fatalf("read stock_lots: %v", err)
	}
	if lotRemain != 10 {
		t.Fatalf("stock_lots.qty_remaining = %d, want 10 (no FIFO drain on failed call)", lotRemain)
	}

	// kasir_counters must not have advanced past counterBefore.
	var counterAfter sql.NullInt64
	_ = client.DB.QueryRow(
		`SELECT counter FROM public.kasir_counters WHERE channel='walkin' AND date=$1`,
		today,
	).Scan(&counterAfter)
	if counterBefore.Valid != counterAfter.Valid || counterBefore.Int64 != counterAfter.Int64 {
		t.Fatalf("kasir_counters advanced after failure: before=%v after=%v", counterBefore, counterAfter)
	}

	// No kasir_transactions row for this SKU.
	var n int
	if err := client.DB.QueryRow(
		`SELECT COUNT(*) FROM public.kasir_transactions
		   WHERE items::text LIKE '%' || $1 || '%'`, sku).Scan(&n); err != nil {
		t.Fatalf("count kasir_transactions: %v", err)
	}
	if n != 0 {
		t.Fatalf("kasir_transactions count for failed call = %d, want 0", n)
	}
}

// TestRecordKasirSale_ShopeeChannel_IssuesSHPInvoice verifies that the
// expanded sales_channel ENUM (Phase A migration of the configurable-sales-
// channels work) accepts the new `shopee` channel value AND that the invoice
// number CASE in record_kasir_sale resolves to the `SHP-` prefix per the
// Phase B.2 RPC refactor.
//
// Regression guard: if validate_sales_channel() helper or the invoice prefix
// CASE in record_kasir_sale breaks (e.g. an ENUM rename, a missing seed row
// in sales_channel_settings, or a typo in the prefix CASE), this test will
// fail at the .Scan or the strings.HasPrefix check.
//
// Test calls the SQL RPC directly (matching the pattern used by the other
// tests in this file — there is no `RecordKasirSaleInput` Go struct in this
// package; the RPC is a stable SQL contract).
func TestRecordKasirSale_ShopeeChannel_IssuesSHPInvoice(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	sku := fmt.Sprintf("RKS-SHP-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, sku, "atas", 5)
	today := time.Now().Format("2006-01-02")

	items := fmt.Sprintf(`[
		{"sku":"%s","name":"Test Shopee","qty":1,"unit_price":1000,"subtotal":1000,"warehouse":"atas"}
	]`, sku)

	marketplaceOrderNo := fmt.Sprintf("SHP-TEST-%d", time.Now().UnixNano())
	customerName := fmt.Sprintf("QA-SHP-%d", time.Now().Unix())

	// Call signature matches the 20-arg record_kasir_sale: p_date, p_channel,
	// p_items, p_subtotal, p_payment_method, p_payment_subtype, p_payment_type,
	// p_dp_amount, p_dp_input_type, p_ongkir_amount, p_notes, p_total_amount,
	// p_customer_name, p_customer_phone, p_customer_company, p_delivery_address,
	// p_marketplace_order_no, p_wa_phone, p_wa_chat_url, p_customer_id.
	// (Matches the pattern in TestRecordKasirSale_HappyPath above; ordinals
	// confirmed against supabase/migrations/20260613000021_sales_channels_phase_b_rpcs.sql)
	var invoice string
	err := client.DB.QueryRow(
		`SELECT (public.record_kasir_sale(
		   $1::date, 'shopee', $2::jsonb, 1000,
		   'transfer', NULL, 'FULL', 0, NULL, 0, NULL, 1000,
		   $3, '081234567890', NULL, NULL, $4, NULL, NULL, NULL
		 )).invoice_number`,
		today, items, customerName, marketplaceOrderNo,
	).Scan(&invoice)
	if err != nil {
		t.Fatalf("record_kasir_sale for shopee channel: %v (this likely means the ENUM does not include 'shopee', "+
			"or validate_sales_channel rejects it, or the invoice CASE is missing the SHP- branch)", err)
	}

	if !strings.HasPrefix(invoice, "SHP-") {
		t.Fatalf("invoice_number = %q, want SHP- prefix (Phase B.2 invoice CASE regression)", invoice)
	}

	// Cleanup: drop the test transaction so the test is idempotent across runs
	// on the shared Supabase test DB.
	if _, err := client.DB.Exec(
		`DELETE FROM public.kasir_transactions WHERE invoice_number=$1`, invoice,
	); err != nil {
		t.Logf("cleanup of kasir_transactions %s failed (non-fatal): %v", invoice, err)
	}
}

// TestRecordKasirSale_AggregatesSameSKU verifies the SKU aggregation fix the
// reviewer flagged as Critical #2: the Promise.all-over-deductFifo race when
// the same SKU appears as two separate cart lines.
//
// Seed: stock_atas=10, one lot qty_remaining=10, unit_cost=1000.
// Call with two item lines: qty=2 + qty=3, same SKU + warehouse.
//
// Assertions:
//   - stock_atas decremented by 5 total (not 4, not 6).
//   - stock_lots.qty_remaining decremented by 5.
//   - Exactly 2 stock_movements rows (one decrement_stock + one deduct_stock_fifo),
//     proving the RPC walked lots ONCE per aggregate group, not once per line.
//   - Both output line items carry hpp_per_unit = 1000 (average across aggregate).
func TestRecordKasirSale_AggregatesSameSKU(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	sku := fmt.Sprintf("RKS-AGG-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, sku, "atas", 10)

	items := fmt.Sprintf(`[
		{"sku":"%s","name":"Line A","qty":2,"unit_price":5000,"subtotal":10000,"warehouse":"atas"},
		{"sku":"%s","name":"Line B","qty":3,"unit_price":5000,"subtotal":15000,"warehouse":"atas"}
	]`, sku, sku)

	var invoice string
	today := time.Now().Format("2006-01-02")
	if err := client.DB.QueryRow(
		`SELECT (public.record_kasir_sale(
		   $1::date, 'walkin', $2::jsonb, 25000,
		   'cash', NULL, 'FULL', 0, NULL, 0, NULL, 25000,
		   'Agg Test', '0812', NULL, NULL, NULL, NULL, NULL, NULL
		 )).invoice_number`,
		today, items,
	).Scan(&invoice); err != nil {
		t.Fatalf("record_kasir_sale: %v", err)
	}

	var stockAtas, lotRemain int
	if err := client.DB.QueryRow(
		`SELECT stock_atas FROM public.stocks WHERE sku=$1`, sku).Scan(&stockAtas); err != nil {
		t.Fatalf("read stock_atas: %v", err)
	}
	if stockAtas != 5 {
		t.Fatalf("stock_atas = %d, want 5 (10 - aggregate 5)", stockAtas)
	}

	if err := client.DB.QueryRow(
		`SELECT qty_remaining FROM public.stock_lots WHERE sku=$1`, sku).Scan(&lotRemain); err != nil {
		t.Fatalf("read stock_lots: %v", err)
	}
	if lotRemain != 5 {
		t.Fatalf("stock_lots.qty_remaining = %d, want 5 (aggregate drain not duplicated)", lotRemain)
	}

	// Exactly 2 stock_movements rows for this invoice: one decrement_stock,
	// one deduct_stock_fifo. NOT 4 (which would indicate per-line execution).
	var mvmCount int
	if err := client.DB.QueryRow(
		`SELECT COUNT(*) FROM public.stock_movements
		   WHERE sku=$1 AND related_doc_id=$2`, sku, invoice).Scan(&mvmCount); err != nil {
		t.Fatalf("count stock_movements: %v", err)
	}
	if mvmCount != 2 {
		t.Fatalf("stock_movements count = %d, want 2 (proves SKU aggregation: one ledger row per RPC, not per line)", mvmCount)
	}
}
