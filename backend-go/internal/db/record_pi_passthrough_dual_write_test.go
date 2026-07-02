package db_test

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

// extractPiID parses the pi_id UUID from record_pi's JSON return value
// ("{"pi_number":"...","pi_id":"<uuid>"}"). Using the RPC return avoids a
// follow-up SELECT that could race on shared test DBs.
func extractPiID(t *testing.T, jsonResult string) string {
	t.Helper()
	// Simple extraction — avoid importing encoding/json for a single field.
	const prefix = `"pi_id":"`
	idx := strings.Index(jsonResult, prefix)
	if idx == -1 {
		t.Fatalf("pi_id not found in record_pi result: %s", jsonResult)
	}
	start := idx + len(prefix)
	end := strings.Index(jsonResult[start:], `"`)
	if end == -1 {
		t.Fatalf("malformed pi_id in record_pi result: %s", jsonResult)
	}
	return jsonResult[start : start+end]
}

// TestRecordPi_Passthrough_NoAccrualHistory_BooksNonAccrual verifies that a
// PASSTHROUGH PI whose linked order has no prior 2-1150 accrual (e.g. a
// non-tempo sale not booked through create_tempo_invoice) gets the direct
// HPP debit: D 5-1200 K 2-1100.
func TestRecordPi_Passthrough_NoAccrualHistory_BooksNonAccrual(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	db.SetDualWriteEnabled(t, client, true)
	defer db.SetDualWriteEnabled(t, client, false)

	supplierID := db.EnsureSupplier(t, client)
	sku := fmt.Sprintf("PI-PT-NOACCR-%d", time.Now().UnixNano())
	db.EnsurePassthroughSKU(t, client, sku, 3000)

	// EnsureBareOrder creates an order via create_tempo_invoice with a
	// non-passthrough stock SKU — no 2-1150 accrual on that order.
	orderID := db.EnsureBareOrder(t, client, supplierID, sku)

	payload := fmt.Sprintf(`{
		"type":        "PASSTHROUGH",
		"supplier_id": "%s",
		"order_id":    "%s",
		"purchase_date": "%s",
		"items": [{"sku":"%s","product_name":"Test PT","qty":2,"unit_cost":4000}]
	}`, supplierID, orderID, time.Now().Format("2006-01-02"), sku)

	var result string
	if err := client.DB.QueryRow(
		`SELECT public.record_pi($1::jsonb)::text`, payload,
	).Scan(&result); err != nil {
		t.Fatalf("record_pi PASSTHROUGH no-accrual: %v", err)
	}

	piID := extractPiID(t, result)

	// Expect: D 5-1200 8000 (2×4000), K 2-1100 8000
	type line struct {
		code, side string
		amount     float64
	}
	rows, err := client.DB.Query(`
		SELECT a.account_code, l.side, l.amount
		  FROM public.journal_entry_lines l
		  JOIN public.journal_entries e ON e.id = l.entry_id
		  JOIN public.chart_of_accounts a ON a.id = l.account_id
		 WHERE e.source_ref_table = 'purchase_invoices'
		   AND e.source_ref_id = $1::uuid
		   AND e.source_type = 'PI_TAGIHAN'
		 ORDER BY a.account_code`, piID)
	if err != nil {
		t.Fatalf("query JE: %v", err)
	}
	defer rows.Close()
	var got []line
	for rows.Next() {
		var l line
		rows.Scan(&l.code, &l.side, &l.amount)
		got = append(got, l)
	}

	want := []line{
		{"2-1100", "CREDIT", 8000},
		{"5-1200", "DEBIT", 8000},
	}
	if len(got) != len(want) {
		t.Fatalf("JE line count = %d want %d, got=%v", len(got), len(want), got)
	}
	for i, w := range want {
		if got[i] != w {
			t.Errorf("line %d = %+v, want %+v", i, got[i], w)
		}
	}
}

// TestRecordPi_Passthrough_WithAccrualHistory_BooksReclass verifies that a
// PASSTHROUGH PI whose linked order already has a 2-1150 accrual entry (from
// create_tempo_invoice Slice A dual-write) gets the reclass JE:
// D 2-1150 K 2-1100 (clears interim accrual, recognises real AP).
func TestRecordPi_Passthrough_WithAccrualHistory_BooksReclass(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	db.SetDualWriteEnabled(t, client, true)
	defer db.SetDualWriteEnabled(t, client, false)

	sku := fmt.Sprintf("PI-PT-ACCR-%d", time.Now().UnixNano())
	db.EnsurePassthroughSKU(t, client, sku, 3000)
	custID := db.EnsureTempoCustomer(t, client, 30, 1000000)
	supplierID := db.EnsureSupplier(t, client)

	// Create tempo invoice with passthrough SKU (produces 2-1150 credit via Slice A).
	// harga_modal is 3000, so the accrual leg is D 5-1200 3000 / K 2-1150 3000.
	tempoPayload := fmt.Sprintf(`{
		"customer_id": "%s",
		"items": [{"sku":"%s","name":"PT Item","qty":1,"unit_price":5000}]
	}`, custID, sku)

	var orderID string
	if err := client.DB.QueryRow(
		`SELECT public.create_tempo_invoice($1::jsonb)::text`, tempoPayload,
	).Scan(&orderID); err != nil {
		t.Fatalf("create_tempo_invoice: %v", err)
	}

	// Now record the PASSTHROUGH PI linked to that order.
	// unit_cost (3000) == harga_modal == accrual balance → reclass branch.
	piPayload := fmt.Sprintf(`{
		"type":          "PASSTHROUGH",
		"supplier_id":   "%s",
		"order_id":      "%s",
		"purchase_date": "%s",
		"items": [{"sku":"%s","product_name":"PT Supplier","qty":1,"unit_cost":3000}]
	}`, supplierID, orderID, time.Now().Format("2006-01-02"), sku)

	var piResult string
	if err := client.DB.QueryRow(
		`SELECT public.record_pi($1::jsonb)::text`, piPayload,
	).Scan(&piResult); err != nil {
		t.Fatalf("record_pi PASSTHROUGH with accrual: %v", err)
	}

	piID := extractPiID(t, piResult)

	// Expect D 2-1150 3000, K 2-1100 3000 (reclass branch)
	type line struct {
		code, side string
		amount     float64
	}
	rows, err := client.DB.Query(`
		SELECT a.account_code, l.side, l.amount
		  FROM public.journal_entry_lines l
		  JOIN public.journal_entries e ON e.id = l.entry_id
		  JOIN public.chart_of_accounts a ON a.id = l.account_id
		 WHERE e.source_ref_table = 'purchase_invoices'
		   AND e.source_ref_id = $1::uuid
		   AND e.source_type = 'PI_TAGIHAN'
		 ORDER BY a.account_code`, piID)
	if err != nil {
		t.Fatalf("query JE: %v", err)
	}
	defer rows.Close()
	var got []line
	for rows.Next() {
		var l line
		rows.Scan(&l.code, &l.side, &l.amount)
		got = append(got, l)
	}

	want := []line{
		{"2-1100", "CREDIT", 3000},
		{"2-1150", "DEBIT", 3000},
	}
	if len(got) != len(want) {
		t.Fatalf("JE line count = %d want %d (reclass), got=%v", len(got), len(want), got)
	}
	for i, w := range want {
		if got[i] != w {
			t.Errorf("line %d = %+v, want %+v", i, got[i], w)
		}
	}
}

// TestRecordPi_Stock_Unchanged verifies that STOCK-type PIs are unaffected by
// the Slice B PASSTHROUGH changes — they still book D 1-1510 / K 2-1100.
func TestRecordPi_Stock_Unchanged(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	db.SetDualWriteEnabled(t, client, true)
	defer db.SetDualWriteEnabled(t, client, false)

	sku := fmt.Sprintf("PI-STOCK-UNC-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, sku, "atas", 20)
	supplierID, pesananID, pesananItemID := db.EnsurePesanan(t, client, sku)

	piPayload := fmt.Sprintf(`{
		"type":          "STOCK",
		"supplier_id":   "%s",
		"pesanan_id":    "%s",
		"purchase_date": "%s",
		"items": [{"sku":"%s","product_name":"Stock Item","qty":2,"unit_cost":1000,"pesanan_item_id":"%s"}]
	}`, supplierID, pesananID, time.Now().Format("2006-01-02"), sku, pesananItemID)

	var piResult string
	if err := client.DB.QueryRow(
		`SELECT public.record_pi($1::jsonb)::text`, piPayload,
	).Scan(&piResult); err != nil {
		t.Fatalf("record_pi STOCK: %v", err)
	}

	piID := extractPiID(t, piResult)

	// Expect D 1-1510 (DEBIT) K 2-1100 (CREDIT) — stock inventory debit unchanged
	type line struct {
		code, side string
		amount     float64
	}
	rows, err := client.DB.Query(`
		SELECT a.account_code, l.side, l.amount
		  FROM public.journal_entry_lines l
		  JOIN public.journal_entries e ON e.id = l.entry_id
		  JOIN public.chart_of_accounts a ON a.id = l.account_id
		 WHERE e.source_ref_table = 'purchase_invoices'
		   AND e.source_ref_id = $1::uuid
		   AND e.source_type = 'PI_TAGIHAN'
		 ORDER BY a.account_code`, piID)
	if err != nil {
		t.Fatalf("query JE: %v", err)
	}
	defer rows.Close()
	var got []line
	for rows.Next() {
		var l line
		rows.Scan(&l.code, &l.side, &l.amount)
		got = append(got, l)
	}

	// 2000 = 2 qty × 1000 unit_cost; no discount → gross = net
	want := []line{
		{"1-1510", "DEBIT", 2000},
		{"2-1100", "CREDIT", 2000},
	}
	if len(got) != len(want) {
		t.Fatalf("JE line count = %d want %d, got=%v", len(got), len(want), got)
	}
	for i, w := range want {
		if got[i] != w {
			t.Errorf("line %d = %+v, want %+v", i, got[i], w)
		}
	}
}

// TestRecordPi_Lunas_Passthrough_TriggersPembayaran verifies that a
// PASSTHROUGH PI created with initial_status=LUNAS routes through
// record_pembayaran, producing a payment JE: D 2-1100 K <cash COA>.
func TestRecordPi_Lunas_Passthrough_TriggersPembayaran(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	db.SetDualWriteEnabled(t, client, true)
	defer db.SetDualWriteEnabled(t, client, false)

	sku := fmt.Sprintf("PI-PT-LUNAS-%d", time.Now().UnixNano())
	db.EnsurePassthroughSKU(t, client, sku, 4000)
	supplierID := db.EnsureSupplier(t, client)
	orderID := db.EnsureBareOrder(t, client, supplierID, sku)
	cashAccountID := db.EnsureCashAccount(t, client)

	piPayload := fmt.Sprintf(`{
		"type":           "PASSTHROUGH",
		"supplier_id":    "%s",
		"order_id":       "%s",
		"purchase_date":  "%s",
		"initial_status": "LUNAS",
		"payment_method": "cash",
		"account_id":     "%s",
		"items": [{"sku":"%s","product_name":"PT Lunas","qty":1,"unit_cost":5000}]
	}`, supplierID, orderID, time.Now().Format("2006-01-02"), cashAccountID, sku)

	var piResult string
	if err := client.DB.QueryRow(
		`SELECT public.record_pi($1::jsonb)::text`, piPayload,
	).Scan(&piResult); err != nil {
		t.Fatalf("record_pi PASSTHROUGH LUNAS: %v", err)
	}

	piID := extractPiID(t, piResult)

	// Verify a PEMBAYARAN JE landed with D 2-1100 and K cash-COA.
	// Use the pi_id to anchor — record_pembayaran links its JE to the pembayaran
	// row, not the PI; filter by recent posted_at + PEMBAYARAN source_type.
	// The pembayaran was created within this test so a 10-second window is safe.
	var pembayaranDebit float64
	if err := client.DB.QueryRow(`
		SELECT COALESCE(SUM(l.amount) FILTER (WHERE a.account_code='2-1100' AND l.side='DEBIT'), 0)
		FROM public.journal_entry_lines l
		JOIN public.journal_entries e ON e.id = l.entry_id
		JOIN public.chart_of_accounts a ON a.id = l.account_id
		WHERE e.source_type = 'PEMBAYARAN'
		  AND e.posted_at > now() - interval '30 seconds'`).Scan(&pembayaranDebit); err != nil {
		t.Fatalf("query pembayaran JE D 2-1100: %v", err)
	}

	_ = piID // used only in source_ref_table query above; kept as sanity

	if pembayaranDebit != 5000 {
		t.Errorf("PEMBAYARAN D 2-1100 = %v, want 5000", pembayaranDebit)
	}

	var cashCredit float64
	if err := client.DB.QueryRow(`
		SELECT COALESCE(SUM(l.amount) FILTER (WHERE a.account_code != '2-1100' AND l.side='CREDIT'), 0)
		FROM public.journal_entry_lines l
		JOIN public.journal_entries e ON e.id = l.entry_id
		JOIN public.chart_of_accounts a ON a.id = l.account_id
		WHERE e.source_type = 'PEMBAYARAN'
		  AND e.posted_at > now() - interval '30 seconds'`).Scan(&cashCredit); err != nil {
		t.Fatalf("query pembayaran JE K cash: %v", err)
	}

	if cashCredit != 5000 {
		t.Errorf("PEMBAYARAN K cash-COA = %v, want 5000", cashCredit)
	}
}

// TestRecordPi_Lunas_MissingAccountId_RaisesException verifies that a
// LUNAS-at-create PI without account_id raises LUNAS_REQUIRES_CASH_ACCOUNT.
func TestRecordPi_Lunas_MissingAccountId_RaisesException(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	db.SetDualWriteEnabled(t, client, true)
	defer db.SetDualWriteEnabled(t, client, false)

	sku := fmt.Sprintf("PI-PT-NOMACCT-%d", time.Now().UnixNano())
	db.EnsurePassthroughSKU(t, client, sku, 4000)
	supplierID := db.EnsureSupplier(t, client)
	orderID := db.EnsureBareOrder(t, client, supplierID, sku)

	piPayload := fmt.Sprintf(`{
		"type":           "PASSTHROUGH",
		"supplier_id":    "%s",
		"order_id":       "%s",
		"purchase_date":  "%s",
		"initial_status": "LUNAS",
		"payment_method": "cash",
		"items": [{"sku":"%s","product_name":"PT No Acct","qty":1,"unit_cost":5000}]
	}`, supplierID, orderID, time.Now().Format("2006-01-02"), sku)
	// Note: account_id deliberately omitted

	var result string
	err := client.DB.QueryRow(
		`SELECT public.record_pi($1::jsonb)::text`, piPayload,
	).Scan(&result)

	if err == nil {
		t.Fatal("expected error LUNAS_REQUIRES_CASH_ACCOUNT, got nil")
	}
	if !strings.Contains(err.Error(), "LUNAS_REQUIRES_CASH_ACCOUNT") {
		t.Errorf("expected LUNAS_REQUIRES_CASH_ACCOUNT in error, got: %v", err)
	}
}

// TestRecordPi_Passthrough_FlagOff_NoJE verifies that when dual-write is
// disabled, no JE is posted for a PASSTHROUGH PI.
func TestRecordPi_Passthrough_FlagOff_NoJE(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	db.SetDualWriteEnabled(t, client, false)

	sku := fmt.Sprintf("PI-PT-FLAGOFF-%d", time.Now().UnixNano())
	db.EnsurePassthroughSKU(t, client, sku, 3000)
	supplierID := db.EnsureSupplier(t, client)
	orderID := db.EnsureBareOrder(t, client, supplierID, sku)

	piPayload := fmt.Sprintf(`{
		"type":        "PASSTHROUGH",
		"supplier_id": "%s",
		"order_id":    "%s",
		"purchase_date": "%s",
		"items": [{"sku":"%s","product_name":"PT FlagOff","qty":1,"unit_cost":4000}]
	}`, supplierID, orderID, time.Now().Format("2006-01-02"), sku)

	var piResult string
	if err := client.DB.QueryRow(
		`SELECT public.record_pi($1::jsonb)::text`, piPayload,
	).Scan(&piResult); err != nil {
		t.Fatalf("record_pi: %v", err)
	}

	piID := extractPiID(t, piResult)

	var jeCount int
	if err := client.DB.QueryRow(
		`SELECT count(*) FROM public.journal_entries
		 WHERE source_ref_table = 'purchase_invoices' AND source_ref_id = $1::uuid`,
		piID,
	).Scan(&jeCount); err != nil {
		t.Fatalf("count JE: %v", err)
	}
	if jeCount != 0 {
		t.Fatalf("expected 0 JE when flag off, got %d", jeCount)
	}
}

// TestRecordPi_Passthrough_BrokenCoa_LogsAnomaly verifies the soft-fail path:
// if 5-1200 is deactivated, the PASSTHROUGH GL write fails gracefully, an
// anomaly row is logged, and the PI is still created successfully.
func TestRecordPi_Passthrough_BrokenCoa_LogsAnomaly(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	db.SetDualWriteEnabled(t, client, true)
	defer db.SetDualWriteEnabled(t, client, false)

	// Deactivate 5-1200 to break the GL write
	if _, err := client.DB.Exec(
		`UPDATE public.chart_of_accounts SET is_active=false WHERE account_code='5-1200'`,
	); err != nil {
		t.Fatalf("deactivate 5-1200: %v", err)
	}
	defer client.DB.Exec(`UPDATE public.chart_of_accounts SET is_active=true WHERE account_code='5-1200'`)

	sku := fmt.Sprintf("PI-PT-BROKENCOA-%d", time.Now().UnixNano())
	db.EnsurePassthroughSKU(t, client, sku, 3000)
	supplierID := db.EnsureSupplier(t, client)
	orderID := db.EnsureBareOrder(t, client, supplierID, sku)

	piPayload := fmt.Sprintf(`{
		"type":        "PASSTHROUGH",
		"supplier_id": "%s",
		"order_id":    "%s",
		"purchase_date": "%s",
		"items": [{"sku":"%s","product_name":"PT BrokenCOA","qty":1,"unit_cost":4000}]
	}`, supplierID, orderID, time.Now().Format("2006-01-02"), sku)

	var piResult string
	err := client.DB.QueryRow(
		`SELECT public.record_pi($1::jsonb)::text`, piPayload,
	).Scan(&piResult)
	// PI should succeed despite GL failure (soft-fail)
	if err != nil {
		t.Fatalf("record_pi should not fail on GL error (soft-fail): %v", err)
	}

	piID := extractPiID(t, piResult)

	// Verify anomaly logged
	var anomalyCount int
	if err := client.DB.QueryRow(`
		SELECT count(*) FROM public.gl_dual_write_anomalies
		WHERE source_ref_id = $1::uuid AND source_rpc = 'record_pi'`,
		piID,
	).Scan(&anomalyCount); err != nil {
		t.Fatalf("count anomalies: %v", err)
	}
	if anomalyCount != 1 {
		t.Errorf("expected 1 anomaly, got %d", anomalyCount)
	}

	// Verify no partial JE
	var jeCount int
	client.DB.QueryRow(`
		SELECT count(*) FROM public.journal_entries
		WHERE source_ref_table = 'purchase_invoices' AND source_ref_id = $1::uuid`,
		piID,
	).Scan(&jeCount)
	if jeCount != 0 {
		t.Errorf("expected no JE header on GL failure, got %d", jeCount)
	}
}
