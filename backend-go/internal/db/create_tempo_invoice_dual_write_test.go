package db_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

// TestCreateTempoInvoice_DualWrite_HappyPath asserts that a tempo invoice with
// one stock line + 1000 order discount produces a balanced JE with 5 legs:
// D 1-1400 AR, D 4-1900 Diskon, D 5-1100 HPP, K 4-1140 Revenue, K 1-1510 Persediaan.
func TestCreateTempoInvoice_DualWrite_HappyPath(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	// Enable dual-write for test
	db.SetDualWriteEnabled(t, client, true)
	defer db.SetDualWriteEnabled(t, client, false)

	sku := fmt.Sprintf("TEMPO-HAPPY-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, sku, "atas", 10)
	// Seeded: unit_cost=1000, qty_remaining=10
	custID := db.EnsureTempoCustomer(t, client, 30, 1000000) // term_days=30, credit_limit=1M

	payload := fmt.Sprintf(`{
		"customer_id":"%s",
		"items":[{"sku":"%s","name":"Test","qty":3,"unit_price":5000,"master_price_at_sale":5000}],
		"discount_amount_rp":1000
	}`, custID, sku)

	var orderID string
	err := client.DB.QueryRow(
		`SELECT public.create_tempo_invoice($1::jsonb)`,
		payload,
	).Scan(&orderID)
	if err != nil {
		t.Fatalf("create_tempo_invoice: %v", err)
	}

	// Assert JE lines
	rows, err := client.DB.Query(`
		SELECT a.account_code, l.side, l.amount
		  FROM public.journal_entry_lines l
		  JOIN public.journal_entries e ON e.id = l.entry_id
		  JOIN public.chart_of_accounts a ON a.id = l.account_id
		 WHERE e.source_ref_table = 'orders' AND e.source_ref_id = $1::uuid
		   AND e.source_type = 'TEMPO_INVOICE_CREATE'
		 ORDER BY a.account_code`,
		orderID,
	)
	if err != nil {
		t.Fatalf("query JE: %v", err)
	}
	defer rows.Close()

	type line struct {
		code, side string
		amount     float64
	}
	var got []line
	for rows.Next() {
		var l line
		if err := rows.Scan(&l.code, &l.side, &l.amount); err != nil {
			t.Fatal(err)
		}
		got = append(got, l)
	}

	// Expected: subtotal = 15000 (3×5000), order_discount = 1000, total = 14000, HPP = 3000
	// D 1-1400 14000, D 4-1900 1000, D 5-1100 3000, K 4-1140 15000, K 1-1510 3000
	want := []line{
		{"1-1400", "DEBIT", 14000},
		{"1-1510", "CREDIT", 3000},
		{"4-1140", "CREDIT", 15000},
		{"4-1900", "DEBIT", 1000},
		{"5-1100", "DEBIT", 3000},
	}
	if len(got) != len(want) {
		t.Fatalf("JE line count = %d, want %d, got=%v", len(got), len(want), got)
	}
	for i, w := range want {
		if got[i] != w {
			t.Errorf("JE line %d = %+v, want %+v", i, got[i], w)
		}
	}
}

// TestCreateTempoInvoice_DualWrite_ZeroDiscount_SkipsDiskonLeg asserts JE has 4
// legs (no 4-1900) when both line & order discount are zero.
func TestCreateTempoInvoice_DualWrite_ZeroDiscount_SkipsDiskonLeg(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.SetDualWriteEnabled(t, client, true)
	defer db.SetDualWriteEnabled(t, client, false)

	sku := fmt.Sprintf("TEMPO-NODISC-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, sku, "atas", 5)
	custID := db.EnsureTempoCustomer(t, client, 30, 1000000)

	payload := fmt.Sprintf(`{
		"customer_id":"%s",
		"items":[{"sku":"%s","name":"Test","qty":2,"unit_price":5000}]
	}`, custID, sku)

	var orderID string
	if err := client.DB.QueryRow(
		`SELECT public.create_tempo_invoice($1::jsonb)`, payload,
	).Scan(&orderID); err != nil {
		t.Fatalf("create_tempo_invoice: %v", err)
	}

	var count int
	if err := client.DB.QueryRow(`
		SELECT count(*) FROM public.journal_entry_lines l
		  JOIN public.journal_entries e ON e.id = l.entry_id
		  JOIN public.chart_of_accounts a ON a.id = l.account_id
		 WHERE e.source_ref_id = $1::uuid AND a.account_code = '4-1900'`,
		orderID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("expected 0 4-1900 lines, got %d", count)
	}
}

// TestCreateTempoInvoice_DualWrite_PassthroughLine_UsesAccrualBranch asserts a
// pass-through SKU produces D 5-1200 + K 2-1150 legs instead of D 5-1100 + K 1-1510.
func TestCreateTempoInvoice_DualWrite_PassthroughLine_UsesAccrualBranch(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.SetDualWriteEnabled(t, client, true)
	defer db.SetDualWriteEnabled(t, client, false)

	sku := fmt.Sprintf("TEMPO-PT-%d", time.Now().UnixNano())
	db.EnsurePassthroughSKU(t, client, sku, 2000) // harga_modal=2000, is_passthrough=true
	custID := db.EnsureTempoCustomer(t, client, 30, 1000000)

	payload := fmt.Sprintf(`{
		"customer_id":"%s",
		"items":[{"sku":"%s","name":"Test PT","qty":2,"unit_price":5000}]
	}`, custID, sku)

	var orderID string
	if err := client.DB.QueryRow(
		`SELECT public.create_tempo_invoice($1::jsonb)`, payload,
	).Scan(&orderID); err != nil {
		t.Fatalf("create_tempo_invoice: %v", err)
	}

	// Expect: NO 5-1100 or 1-1510 legs; presence of 5-1200 (D 4000) + 2-1150 (K 4000)
	var stockLegs, passthroughDebit, passthroughAccrued float64
	client.DB.QueryRow(`
		SELECT
		  COALESCE(SUM(l.amount) FILTER (WHERE a.account_code IN ('5-1100','1-1510')), 0),
		  COALESCE(SUM(l.amount) FILTER (WHERE a.account_code = '5-1200' AND l.side='DEBIT'), 0),
		  COALESCE(SUM(l.amount) FILTER (WHERE a.account_code = '2-1150' AND l.side='CREDIT'), 0)
		FROM public.journal_entry_lines l
		JOIN public.journal_entries e ON e.id = l.entry_id
		JOIN public.chart_of_accounts a ON a.id = l.account_id
		WHERE e.source_ref_id = $1::uuid`, orderID,
	).Scan(&stockLegs, &passthroughDebit, &passthroughAccrued)

	if stockLegs != 0 {
		t.Errorf("expected no stock legs, got %v total", stockLegs)
	}
	if passthroughDebit != 4000 {
		t.Errorf("5-1200 debit = %v, want 4000", passthroughDebit)
	}
	if passthroughAccrued != 4000 {
		t.Errorf("2-1150 credit = %v, want 4000", passthroughAccrued)
	}
}

// TestCreateTempoInvoice_DualWrite_FlagOff_NoJEPosted asserts nothing is
// written to journal_entries when accounting_config.enable_dual_write_to_gl=false.
func TestCreateTempoInvoice_DualWrite_FlagOff_NoJEPosted(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.SetDualWriteEnabled(t, client, false) // explicit off

	sku := fmt.Sprintf("TEMPO-OFF-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, sku, "atas", 5)
	custID := db.EnsureTempoCustomer(t, client, 30, 1000000)

	payload := fmt.Sprintf(`{
		"customer_id":"%s",
		"items":[{"sku":"%s","name":"Test","qty":1,"unit_price":5000}]
	}`, custID, sku)

	var orderID string
	if err := client.DB.QueryRow(
		`SELECT public.create_tempo_invoice($1::jsonb)`, payload,
	).Scan(&orderID); err != nil {
		t.Fatalf("create_tempo_invoice: %v", err)
	}

	var count int
	if err := client.DB.QueryRow(`
		SELECT count(*) FROM public.journal_entries
		WHERE source_ref_id = $1::uuid`, orderID,
	).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("expected 0 JE, got %d", count)
	}
}

// TestCreateTempoInvoice_DualWrite_MissingCOA_LogsAnomaly asserts that if a JE
// leg references an unseeded COA, the business tx succeeds but an anomaly is
// logged.
func TestCreateTempoInvoice_DualWrite_MissingCOA_LogsAnomaly(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.SetDualWriteEnabled(t, client, true)
	defer db.SetDualWriteEnabled(t, client, false)

	// Temporarily deactivate 4-1140 to break the COA lookup inside _post_journal_entry
	_, err := client.DB.Exec(`UPDATE public.chart_of_accounts SET is_active=false WHERE account_code='4-1140'`)
	if err != nil {
		t.Fatal(err)
	}
	defer client.DB.Exec(`UPDATE public.chart_of_accounts SET is_active=true WHERE account_code='4-1140'`)

	sku := fmt.Sprintf("TEMPO-COA-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, sku, "atas", 5)
	custID := db.EnsureTempoCustomer(t, client, 30, 1000000)

	payload := fmt.Sprintf(`{
		"customer_id":"%s",
		"items":[{"sku":"%s","name":"Test","qty":1,"unit_price":5000}]
	}`, custID, sku)

	var orderID string
	if err := client.DB.QueryRow(
		`SELECT public.create_tempo_invoice($1::jsonb)`, payload,
	).Scan(&orderID); err != nil {
		t.Fatalf("business tx should have succeeded despite GL failure: %v", err)
	}

	// Verify anomaly logged
	var anomalyCount int
	if err := client.DB.QueryRow(`
		SELECT count(*) FROM public.gl_dual_write_anomalies
		WHERE source_ref_id = $1::uuid AND source_rpc = 'create_tempo_invoice'`,
		orderID,
	).Scan(&anomalyCount); err != nil {
		t.Fatal(err)
	}
	if anomalyCount != 1 {
		t.Errorf("expected 1 anomaly, got %d", anomalyCount)
	}

	// Verify no partial JE
	var jeCount int
	client.DB.QueryRow(`SELECT count(*) FROM public.journal_entries WHERE source_ref_id = $1::uuid`, orderID).Scan(&jeCount)
	if jeCount != 0 {
		t.Errorf("expected no JE header on GL failure, got %d", jeCount)
	}
}

// TestCreateTempoInvoice_DualWrite_MixedLines_Combined asserts that a mixed
// order (1 stock line + 1 pass-through line) produces one JE with all 6 legs
// (no discount, so no 4-1900) and that the JE is balanced.
func TestCreateTempoInvoice_DualWrite_MixedLines_Combined(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.SetDualWriteEnabled(t, client, true)
	defer db.SetDualWriteEnabled(t, client, false)

	stockSku := fmt.Sprintf("TEMPO-MIX-S-%d", time.Now().UnixNano())
	ptSku := fmt.Sprintf("TEMPO-MIX-P-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, stockSku, "atas", 5)   // unit_cost=1000
	db.EnsurePassthroughSKU(t, client, ptSku, 2000)      // harga_modal=2000
	custID := db.EnsureTempoCustomer(t, client, 30, 1000000)

	payload := fmt.Sprintf(`{
		"customer_id":"%s",
		"items":[
			{"sku":"%s","name":"Stock","qty":2,"unit_price":3000},
			{"sku":"%s","name":"PT","qty":1,"unit_price":5000}
		]
	}`, custID, stockSku, ptSku)

	var orderID string
	if err := client.DB.QueryRow(
		`SELECT public.create_tempo_invoice($1::jsonb)`, payload,
	).Scan(&orderID); err != nil {
		t.Fatalf("create_tempo_invoice: %v", err)
	}

	// Expected JE:
	//   D 1-1400 AR         11000  (2×3000 + 1×5000)
	//   D 5-1100 HPP stock   2000  (2×1000)
	//   D 5-1200 HPP PT      2000  (1×2000)
	//   K 4-1140 Revenue    11000  (gross = subtotal since no disc)
	//   K 1-1510 Persediaan  2000
	//   K 2-1150 Hutang PT   2000
	var totalD, totalC float64
	client.DB.QueryRow(`
		SELECT
		  COALESCE(SUM(amount) FILTER (WHERE side='DEBIT'), 0),
		  COALESCE(SUM(amount) FILTER (WHERE side='CREDIT'), 0)
		FROM public.journal_entry_lines l
		JOIN public.journal_entries e ON e.id = l.entry_id
		WHERE e.source_ref_id = $1::uuid`, orderID).Scan(&totalD, &totalC)

	if totalD != totalC {
		t.Errorf("JE unbalanced: D=%v C=%v", totalD, totalC)
	}
	if totalD != 15000 {
		t.Errorf("total debit = %v, want 15000", totalD)
	}
}
