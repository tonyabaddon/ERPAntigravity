package db_test

// TestRevertTempoWriteOff_* — Slice D2 dual-write Go tests.
//
// These tests exercise the GL dual-write block added to revert_tempo_write_off
// by migration 20260910000014. They are FAILING before that migration is applied
// and PASS after.
//
// Design notes:
//   - revert_tempo_write_off(UUID) is Owner-gated via _piutang_write_off_resolve_owner().
//     Tests use AsOwnerExec() which sets request.jwt.claim.sub in the DB session.
//   - D2 manually composes swapped lines: D 1-1400 / K 5-3100.
//     _post_journal_entry.p_reverses_entry_id only links reversed_by_entry_id;
//     it does NOT auto-swap D/C. The migration composes the reversal explicitly.
//   - The revert JE is only written when a prior TEMPO_WRITEOFF JE exists for
//     the order and has not yet been reversed (reversed_by_entry_id IS NULL).
//   - source_ref_id = order UUID; source_ref_table = 'orders'.

import (
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

// SeedApprovedWriteOff creates a fully approved write-off: seeded pending
// request → approve → order in INVOICE_WRITTEN_OFF state with a TEMPO_WRITEOFF JE.
// Returns orderID so callers can drive revert_tempo_write_off(orderID).
func SeedApprovedWriteOff(t *testing.T, client *db.Client, total int) (string, string) {
	t.Helper()
	db.SetDualWriteEnabled(t, client, true)

	ownerUID := db.OwnerUUID(t, client)
	approvalID, orderID := db.SeedTempoWriteOffRequest(t, client, total)

	if err := db.AsOwnerExec(t, client, ownerUID,
		`SELECT public.approve_tempo_write_off($1)`, approvalID,
	); err != nil {
		t.Fatalf("SeedApprovedWriteOff approve: %v", err)
	}

	return ownerUID, orderID
}

// TestRevertTempoWriteOff_HappyPath verifies that revert composes swapped lines
// D 1-1400 / K 5-3100 and links reversed_by_entry_id on the original TEMPO_WRITEOFF JE.
func TestRevertTempoWriteOff_HappyPath(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	db.SetDualWriteEnabled(t, client, true)
	defer db.SetDualWriteEnabled(t, client, false)

	ownerUID, orderID := SeedApprovedWriteOff(t, client, 40000)

	if err := db.AsOwnerExec(t, client, ownerUID,
		`SELECT public.revert_tempo_write_off($1::uuid)`, orderID,
	); err != nil {
		t.Fatalf("revert_tempo_write_off: %v", err)
	}

	// Verify REVERT JE totals: D 1-1400 40000, K 5-3100 40000.
	var totalD, totalC float64
	if err := client.DB.QueryRow(`
		SELECT
		  COALESCE(SUM(l.amount) FILTER (WHERE l.side='DEBIT'), 0),
		  COALESCE(SUM(l.amount) FILTER (WHERE l.side='CREDIT'), 0)
		FROM public.journal_entry_lines l
		JOIN public.journal_entries e ON e.id = l.entry_id
		WHERE e.source_ref_table = 'orders'
		  AND e.source_ref_id    = $1::uuid
		  AND e.source_type      = 'TEMPO_WRITEOFF_REVERT'`,
		orderID,
	).Scan(&totalD, &totalC); err != nil {
		t.Fatal(err)
	}
	if totalD != 40000 || totalC != 40000 {
		t.Errorf("revert JE D=%v C=%v, want both 40000", totalD, totalC)
	}

	// Verify specific accounts: D 1-1400, K 5-3100.
	type line struct {
		code, side string
		amount     float64
	}
	rows, err := client.DB.Query(`
		SELECT a.account_code, l.side, l.amount
		  FROM public.journal_entry_lines l
		  JOIN public.journal_entries e ON e.id = l.entry_id
		  JOIN public.chart_of_accounts a ON a.id = l.account_id
		 WHERE e.source_ref_table = 'orders'
		   AND e.source_ref_id    = $1::uuid
		   AND e.source_type      = 'TEMPO_WRITEOFF_REVERT'
		 ORDER BY a.account_code`, orderID)
	if err != nil {
		t.Fatalf("query revert JE: %v", err)
	}
	defer rows.Close()
	var got []line
	for rows.Next() {
		var l line
		rows.Scan(&l.code, &l.side, &l.amount)
		got = append(got, l)
	}
	want := []line{
		{"1-1400", "DEBIT", 40000},
		{"5-3100", "CREDIT", 40000},
	}
	if len(got) != len(want) {
		t.Fatalf("revert JE line count = %d want %d; got %v", len(got), len(want), got)
	}
	for i, w := range want {
		if got[i] != w {
			t.Errorf("line %d = %+v, want %+v", i, got[i], w)
		}
	}

	// Verify reversed_by_entry_id is populated on the original TEMPO_WRITEOFF entry.
	var linkedCount int
	if err := client.DB.QueryRow(`
		SELECT count(*)
		  FROM public.journal_entries
		 WHERE source_ref_table     = 'orders'
		   AND source_ref_id        = $1::uuid
		   AND source_type          = 'TEMPO_WRITEOFF'
		   AND reversed_by_entry_id IS NOT NULL`,
		orderID,
	).Scan(&linkedCount); err != nil {
		t.Fatal(err)
	}
	if linkedCount != 1 {
		t.Errorf("expected 1 TEMPO_WRITEOFF entry with reversed_by_entry_id set, got %d", linkedCount)
	}
}

// TestRevertTempoWriteOff_NoPriorApproval_NoJE verifies that revert on an order
// that was never written off via GL (no TEMPO_WRITEOFF JE) does not fail —
// the soft-fail block simply skips JE posting (v_orig_entry_id IS NULL branch).
// The business side (NOT_WRITTEN_OFF check) is exercised separately.
func TestRevertTempoWriteOff_NoPriorGL_SkipsJE(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	// Seed a WRITTEN_OFF order WITHOUT dual-write (no JE exists).
	db.SetDualWriteEnabled(t, client, false)
	ownerUID, orderID := SeedApprovedWriteOff(t, client, 20000)

	// Now enable dual-write for the revert call.
	db.SetDualWriteEnabled(t, client, true)
	defer db.SetDualWriteEnabled(t, client, false)

	// Revert should succeed (business side: order back to INVOICE_TEMPO).
	if err := db.AsOwnerExec(t, client, ownerUID,
		`SELECT public.revert_tempo_write_off($1::uuid)`, orderID,
	); err != nil {
		t.Fatalf("revert_tempo_write_off (no prior GL): %v", err)
	}

	// No TEMPO_WRITEOFF_REVERT JE should exist (no original to link to).
	var count int
	if err := client.DB.QueryRow(`
		SELECT count(*) FROM public.journal_entries
		 WHERE source_ref_table = 'orders'
		   AND source_ref_id    = $1::uuid
		   AND source_type      = 'TEMPO_WRITEOFF_REVERT'`, orderID,
	).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Errorf("expected 0 REVERT JE when no prior GL, got %d", count)
	}

	// Order restored to INVOICE_TEMPO.
	var status string
	if err := client.DB.QueryRow(
		`SELECT status::text FROM public.orders WHERE id = $1::uuid`, orderID,
	).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "INVOICE_TEMPO" {
		t.Errorf("order status = %q, want INVOICE_TEMPO", status)
	}
}

// TestRevertTempoWriteOff_NotWrittenOff_RaisesException verifies the RPC
// raises NOT_WRITTEN_OFF when the order status is not INVOICE_WRITTEN_OFF.
func TestRevertTempoWriteOff_NotWrittenOff_RaisesException(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	db.SetDualWriteEnabled(t, client, true)
	defer db.SetDualWriteEnabled(t, client, false)

	ownerUID := db.OwnerUUID(t, client)

	// Create a fresh INVOICE_TEMPO order (not written off).
	_, orderID := db.SeedTempoWriteOffRequest(t, client, 10000)
	// At this point order is INVOICE_TEMPO — revert should refuse.

	err := db.AsOwnerExec(t, client, ownerUID,
		`SELECT public.revert_tempo_write_off($1::uuid)`, orderID,
	)
	if err == nil {
		t.Fatal("expected NOT_WRITTEN_OFF error, got nil")
	}
	if errStr := err.Error(); !(contains(errStr, "NOT_WRITTEN_OFF") || contains(errStr, "written_off")) {
		t.Errorf("expected NOT_WRITTEN_OFF error, got: %v", err)
	}
}

// TestRevertTempoWriteOff_FlagOff_NoJE verifies that when enable_dual_write_to_gl
// is false the business transaction (order back to INVOICE_TEMPO) still succeeds
// but no TEMPO_WRITEOFF_REVERT JE is written.
func TestRevertTempoWriteOff_FlagOff_NoJE(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	// Approve with flag ON (to get the TEMPO_WRITEOFF JE seeded).
	db.SetDualWriteEnabled(t, client, true)
	ownerUID, orderID := SeedApprovedWriteOff(t, client, 15000)

	// Turn flag OFF before revert.
	db.SetDualWriteEnabled(t, client, false)

	if err := db.AsOwnerExec(t, client, ownerUID,
		`SELECT public.revert_tempo_write_off($1::uuid)`, orderID,
	); err != nil {
		t.Fatalf("revert_tempo_write_off (flag off): %v", err)
	}

	// Business succeeded: order restored.
	var status string
	if err := client.DB.QueryRow(
		`SELECT status::text FROM public.orders WHERE id = $1::uuid`, orderID,
	).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "INVOICE_TEMPO" {
		t.Errorf("order status = %q, want INVOICE_TEMPO", status)
	}

	// No REVERT JE written (flag was off).
	var count int
	if err := client.DB.QueryRow(`
		SELECT count(*) FROM public.journal_entries
		 WHERE source_ref_table = 'orders'
		   AND source_ref_id    = $1::uuid
		   AND source_type      = 'TEMPO_WRITEOFF_REVERT'`, orderID,
	).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Errorf("expected 0 REVERT JE when flag off, got %d", count)
	}
}

// contains is a string helper to avoid importing strings in this file.
func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 ||
		func() bool {
			for i := 0; i <= len(s)-len(sub); i++ {
				if s[i:i+len(sub)] == sub {
					return true
				}
			}
			return false
		}())
}
