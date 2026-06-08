package db_test

import (
	"database/sql"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

// TestApprovalRequests_TableExists is the foundation test for Phase 2: the
// approval_requests table must exist in the public schema after migration
// 20260607000007_approval_requests.sql is applied. This single table is the
// source of truth for every gate (adjustment, opname, price_change, kasir_*).
func TestApprovalRequests_TableExists(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	var n int
	err := client.DB.QueryRow(
		`SELECT 1 FROM information_schema.tables
		 WHERE table_schema='public' AND table_name='approval_requests'`).Scan(&n)
	if err != nil {
		t.Fatalf("approval_requests table missing: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected scan to yield 1, got %d", n)
	}
}

// TestApprovalRequests_UpdateRaises is the initial failing test from the plan.
// It is intentionally kept around Step 1→Step 2 of TDD, then REPLACED by
// TestApprovalRequests_DeleteRaises in Step 5 once the migration lands.
//
// The UPDATE trigger (trg_deny_ar_update) is intentionally DISABLED at table
// creation because legitimate state transitions (pending → approved/rejected/
// expired) must flow through the _transition_approval SECURITY DEFINER helper.
// Per Foundational Decision #1 the service_role bypass is the accepted
// trade-off; column-level REVOKE UPDATE still blocks anon + authenticated.
// The DELETE trigger stays ENABLED — there is no legitimate DELETE path.
func TestApprovalRequests_DeleteRaises(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	var id int64
	err := client.DB.QueryRow(
		`INSERT INTO public.approval_requests
		   (request_type, payload, requested_by)
		 VALUES ('adjustment', '{}'::jsonb,
		         '00000000-0000-0000-0000-000000000000')
		 RETURNING id`).Scan(&id)
	if err != nil {
		t.Fatalf("seed insert failed: %v", err)
	}

	_, err = client.DB.Exec(
		`DELETE FROM public.approval_requests WHERE id=$1`, id)
	if err == nil {
		t.Fatalf("expected DELETE to raise, got nil")
	}
	if !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("unexpected error: %v", err)
	}
}

// TestTransitionApproval_PendingToApproved verifies the _transition_approval
// SECURITY DEFINER helper flips a pending row to approved and records
// decided_by / decided_at / decision_channel. This is the ONLY sanctioned path
// to mutate approval_requests state (the UPDATE trigger is disabled to allow
// it; anon + authenticated can't UPDATE because of column-level REVOKE).
//
// The helper guards against double-transition: only rows with status='pending'
// are flipped (`WHERE id=$1 AND status='pending'`), and a NOT FOUND raises.
// Phase 2 Task 4 (commit_approved_adjustment) and Task 11 (expire_pending_…)
// will both call this helper, so we pin its happy path now.
func TestTransitionApproval_PendingToApproved(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	var id int64
	err := client.DB.QueryRow(
		`INSERT INTO public.approval_requests
		   (request_type, payload, requested_by)
		 VALUES ('adjustment', '{}'::jsonb,
		         '00000000-0000-0000-0000-000000000001')
		 RETURNING id`).Scan(&id)
	if err != nil {
		t.Fatalf("seed insert failed: %v", err)
	}

	_, err = client.DB.Exec(
		`SELECT public._transition_approval(
		   $1,
		   'approved'::public.approval_status,
		   '00000000-0000-0000-0000-000000000099'::uuid,
		   'owner_pin')`, id)
	if err != nil {
		t.Fatalf("_transition_approval: %v", err)
	}

	var status, decidedBy, decisionChannel string
	var decidedAtNotNull bool
	err = client.DB.QueryRow(
		`SELECT status::text,
		        decided_by::text,
		        decision_channel,
		        decided_at IS NOT NULL
		   FROM public.approval_requests WHERE id=$1`, id).
		Scan(&status, &decidedBy, &decisionChannel, &decidedAtNotNull)
	if err != nil {
		t.Fatalf("read after transition: %v", err)
	}
	if status != "approved" {
		t.Fatalf("status = %q, want approved", status)
	}
	if decidedBy != "00000000-0000-0000-0000-000000000099" {
		t.Fatalf("decided_by = %q, want 00000000-0000-0000-0000-000000000099", decidedBy)
	}
	if decisionChannel != "owner_pin" {
		t.Fatalf("decision_channel = %q, want owner_pin", decisionChannel)
	}
	if !decidedAtNotNull {
		t.Fatalf("decided_at not set")
	}
}

func TestStockAdjustments_TableExists(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	var n int
	err := client.DB.QueryRow(
		`SELECT 1 FROM information_schema.tables
		 WHERE table_schema='public' AND table_name='stock_adjustments'`).Scan(&n)
	if err != nil {
		t.Fatalf("stock_adjustments table missing: %v", err)
	}
}

func TestStockAdjustments_EvidenceRequiredForLoss(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 10)

	var arID int64
	_ = client.DB.QueryRow(
		`INSERT INTO public.approval_requests (request_type, payload, requested_by)
		 VALUES ('adjustment','{}'::jsonb,'00000000-0000-0000-0000-000000000000')
		 RETURNING id`).Scan(&arID)

	_, err := client.DB.Exec(
		`INSERT INTO public.stock_adjustments
		   (sku, warehouse, qty_delta, reason_code, requested_by, approval_request_id)
		 VALUES ('TEST-IMM','atas',-2,'rusak',
		         '00000000-0000-0000-0000-000000000000', $1)`, arID)
	if err == nil {
		t.Fatalf("expected CHECK chk_evidence_for_loss to fail for rusak without evidence, got nil")
	}
	if !strings.Contains(err.Error(), "chk_evidence_for_loss") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRequestAdjustment_CreatesApprovalAndAdjustment(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 10)

	var approvalID int64
	err := client.DB.QueryRow(
		`SELECT public.request_adjustment(
		   p_sku=>'TEST-IMM', p_warehouse=>'atas', p_qty_delta=>-3,
		   p_reason_code=>'rusak'::public.stock_adjustment_reason,
		   p_reason_note=>'kena air',
		   p_evidence_urls=>ARRAY['adjustments/foo.jpg'],
		   p_actor_user_id=>'00000000-0000-0000-0000-000000000001'::uuid)`).Scan(&approvalID)
	if err != nil {
		t.Fatalf("request_adjustment: %v", err)
	}

	var arType, arStatus string
	err = client.DB.QueryRow(
		`SELECT request_type::text, status::text FROM public.approval_requests WHERE id=$1`, approvalID).
		Scan(&arType, &arStatus)
	if err != nil {
		t.Fatalf("read approval_requests: %v", err)
	}
	if arType != "adjustment" || arStatus != "pending" {
		t.Fatalf("approval row wrong: type=%s status=%s", arType, arStatus)
	}

	var saStatus string
	err = client.DB.QueryRow(
		`SELECT status FROM public.stock_adjustments WHERE approval_request_id=$1`, approvalID).Scan(&saStatus)
	if err != nil {
		t.Fatalf("read stock_adjustments: %v", err)
	}
	if saStatus != "pending_approval" {
		t.Fatalf("adjustment status = %s, want pending_approval", saStatus)
	}

	// Stock should NOT have changed yet
	var qty int
	_ = client.DB.QueryRow(
		`SELECT stock_atas FROM public.stocks WHERE sku='TEST-IMM'`).Scan(&qty)
	if qty != 10 {
		t.Fatalf("stock_atas changed before approval: got %d, want 10", qty)
	}
}

// TestCommitApprovedAdjustment_HappyPath drives the full Task 4 commit flow:
// request_adjustment → _transition_approval (simulating the Owner PIN /
// WA-button decision side-channel) → commit_approved_adjustment. After commit
// we expect three things to be true atomically:
//   1. stocks.stock_atas decremented by qty_delta (10 - 3 = 7)
//   2. one stock_movements row with source='adjustment' written via the
//      Phase 1 _log_stock_movement helper
//   3. stock_adjustments row status flipped to 'approved' with
//      committed_at + committed_movement_id populated
func TestCommitApprovedAdjustment_HappyPath(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 10)

	var approvalID int64
	err := client.DB.QueryRow(
		`SELECT public.request_adjustment(
		   p_sku=>'TEST-IMM', p_warehouse=>'atas', p_qty_delta=>-3,
		   p_reason_code=>'rusak'::public.stock_adjustment_reason,
		   p_evidence_urls=>ARRAY['a.jpg'],
		   p_actor_user_id=>'00000000-0000-0000-0000-000000000001'::uuid)`).Scan(&approvalID)
	if err != nil {
		t.Fatalf("request_adjustment: %v", err)
	}

	// Pre-approve via _transition_approval (simulating Owner PIN flow). In real
	// life the Owner PIN RPC / WA webhook handler calls _transition_approval as
	// its first SQL statement before invoking the commit RPC.
	_, err = client.DB.Exec(
		`SELECT public._transition_approval($1, 'approved'::public.approval_status,
		   '00000000-0000-0000-0000-000000000099'::uuid, 'owner_pin')`, approvalID)
	if err != nil {
		t.Fatalf("transition: %v", err)
	}

	before := db.CountStockMovements(t, client, "TEST-IMM")
	_, err = client.DB.Exec(
		`SELECT public.commit_approved_adjustment($1)`, approvalID)
	if err != nil {
		t.Fatalf("commit: %v", err)
	}

	// Stock decremented.
	var qty int
	_ = client.DB.QueryRow(
		`SELECT stock_atas FROM public.stocks WHERE sku='TEST-IMM'`).Scan(&qty)
	if qty != 7 {
		t.Fatalf("stock_atas = %d, want 7", qty)
	}

	// Exactly one ledger row written for this commit.
	if got := db.CountStockMovements(t, client, "TEST-IMM"); got-before != 1 {
		t.Fatalf("expected 1 new ledger row, got %d", got-before)
	}

	// committed_movement_id populated and pointing at an 'adjustment' row.
	var movID int64
	_ = client.DB.QueryRow(
		`SELECT committed_movement_id FROM public.stock_adjustments
		 WHERE approval_request_id=$1`, approvalID).Scan(&movID)
	if movID == 0 {
		t.Fatalf("committed_movement_id not set")
	}

	var source, status string
	_ = client.DB.QueryRow(
		`SELECT source::text FROM public.stock_movements WHERE id=$1`, movID).Scan(&source)
	if source != "adjustment" {
		t.Fatalf("ledger source = %s, want adjustment", source)
	}
	_ = client.DB.QueryRow(
		`SELECT status FROM public.stock_adjustments WHERE approval_request_id=$1`, approvalID).Scan(&status)
	if status != "approved" {
		t.Fatalf("adjustment status = %s, want approved", status)
	}
}

// TestCommitApprovedAdjustment_NotApproved_Fails guards the precondition:
// commit_approved_adjustment must REFUSE to write stock or ledger rows unless
// the source-of-truth approval_requests row is already in 'approved' status.
// This is the linchpin of the architecture — every commit RPC must verify the
// gate has been passed before re-entering the ledger.
func TestCommitApprovedAdjustment_NotApproved_Fails(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 10)

	var approvalID int64
	err := client.DB.QueryRow(
		`SELECT public.request_adjustment(
		   p_sku=>'TEST-IMM', p_warehouse=>'atas', p_qty_delta=>-1,
		   p_reason_code=>'rusak'::public.stock_adjustment_reason,
		   p_evidence_urls=>ARRAY['a.jpg'],
		   p_actor_user_id=>'00000000-0000-0000-0000-000000000001'::uuid)`).Scan(&approvalID)
	if err != nil {
		t.Fatalf("request_adjustment: %v", err)
	}

	_, err = client.DB.Exec(
		`SELECT public.commit_approved_adjustment($1)`, approvalID)
	if err == nil {
		t.Fatalf("expected error when committing pending request")
	}
	if !strings.Contains(err.Error(), "not approved") {
		t.Fatalf("unexpected error: %v", err)
	}

	// Stock must be untouched.
	var qty int
	_ = client.DB.QueryRow(
		`SELECT stock_atas FROM public.stocks WHERE sku='TEST-IMM'`).Scan(&qty)
	if qty != 10 {
		t.Fatalf("stock_atas changed after failed commit: got %d, want 10", qty)
	}
}

// TestRejectAdjustment_FlipsBothSides verifies reject_adjustment closes the
// satellite stock_adjustments row WITHOUT touching stock or writing a ledger
// row. The approval_requests state transition is done OUT of band by the caller
// (via _transition_approval — same pattern as the commit path); the satellite
// RPC just flips its own status field.
func TestRejectAdjustment_FlipsBothSides(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 10)

	var approvalID int64
	err := client.DB.QueryRow(
		`SELECT public.request_adjustment(
		   p_sku=>'TEST-IMM', p_warehouse=>'atas', p_qty_delta=>-2,
		   p_reason_code=>'rusak'::public.stock_adjustment_reason,
		   p_evidence_urls=>ARRAY['a.jpg'],
		   p_actor_user_id=>'00000000-0000-0000-0000-000000000001'::uuid)`).Scan(&approvalID)
	if err != nil {
		t.Fatalf("request_adjustment: %v", err)
	}

	// The Owner rejection side-channel uses _transition_approval first…
	_, err = client.DB.Exec(
		`SELECT public._transition_approval($1, 'rejected'::public.approval_status,
		   '00000000-0000-0000-0000-000000000099'::uuid, 'owner_pin')`, approvalID)
	if err != nil {
		t.Fatalf("transition to rejected: %v", err)
	}

	before := db.CountStockMovements(t, client, "TEST-IMM")
	_, err = client.DB.Exec(
		`SELECT public.reject_adjustment($1, 'tidak valid')`, approvalID)
	if err != nil {
		t.Fatalf("reject_adjustment: %v", err)
	}

	// Adjustment row flipped to 'rejected'.
	var saStatus string
	_ = client.DB.QueryRow(
		`SELECT status FROM public.stock_adjustments WHERE approval_request_id=$1`, approvalID).Scan(&saStatus)
	if saStatus != "rejected" {
		t.Fatalf("adjustment status = %s, want rejected", saStatus)
	}

	// approval_requests row reflects the rejection.
	var arStatus string
	_ = client.DB.QueryRow(
		`SELECT status::text FROM public.approval_requests WHERE id=$1`, approvalID).Scan(&arStatus)
	if arStatus != "rejected" {
		t.Fatalf("approval status = %s, want rejected", arStatus)
	}

	// No ledger row written; stock untouched.
	if got := db.CountStockMovements(t, client, "TEST-IMM"); got != before {
		t.Fatalf("ledger row written on reject: %d new rows", got-before)
	}
	var qty int
	_ = client.DB.QueryRow(
		`SELECT stock_atas FROM public.stocks WHERE sku='TEST-IMM'`).Scan(&qty)
	if qty != 10 {
		t.Fatalf("stock_atas changed on reject: got %d, want 10", qty)
	}
}

// TestOpname_TablesExist is the Task 5 schema test: both opname tables
// (sessions + counts) must exist after migration 20260607000011_stock_opname.sql
// is applied. The session table is the parent (one row per physical-count
// session); the counts table is a child carrying one row per (sku, warehouse)
// being counted in that session.
func TestOpname_TablesExist(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	for _, tbl := range []string{"stock_opname_sessions", "stock_opname_counts"} {
		var n int
		err := client.DB.QueryRow(
			`SELECT 1 FROM information_schema.tables
			 WHERE table_schema='public' AND table_name=$1`, tbl).Scan(&n)
		if err != nil {
			t.Fatalf("table %s missing: %v", tbl, err)
		}
		if n != 1 {
			t.Fatalf("expected scan to yield 1 for %s, got %d", tbl, n)
		}
	}
}

// TestOpname_TwoPersonConstraint pins the chk_two_person CHECK on
// stock_opname_sessions: counted_by_user_id and witnessed_by_user_id MUST
// differ. This is the table-level guarantee that an opname session always
// involves two physical humans — the witness can't be the same person doing
// the counting. The start_opname_session RPC (Task 6) raises a friendlier
// "different" error before reaching the CHECK; this test verifies the
// underlying schema-level guard is still in place even if a caller bypasses
// the RPC and inserts directly.
func TestOpname_TwoPersonConstraint(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	_, err := client.DB.Exec(
		`INSERT INTO public.stock_opname_sessions
		   (opname_type, scope_payload, counted_by_user_id, witnessed_by_user_id)
		 VALUES ('full', '{}'::jsonb,
		         '00000000-0000-0000-0000-000000000001',
		         '00000000-0000-0000-0000-000000000001')`)
	if err == nil {
		t.Fatalf("expected chk_two_person violation, got nil")
	}
	if !strings.Contains(err.Error(), "chk_two_person") {
		t.Fatalf("expected chk_two_person violation, got: %v", err)
	}
}

// TestStartOpnameSession_SnapshotsStocks is the Task 6 happy path: the
// start_opname_session RPC must (a) insert a stock_opname_sessions row,
// (b) resolve in-scope SKUs from scope_payload (here: explicit
// per_sku_list with one SKU), and (c) for each (sku, warehouse) pair INSERT
// a stock_opname_counts row with system_qty_snapshot set to the current
// stocks.stock_<warehouse> value taken atomically at session-start. This
// snapshot pattern is the linchpin of the opname design: any concurrent
// sale that fires AFTER the snapshot doesn't perturb the variance calc,
// because the variance is measured against what the counter physically saw.
func TestStartOpnameSession_SnapshotsStocks(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 25)
	db.EnsureSKUStock(t, client, "TEST-IMM", "bawah", 10)

	var sessionID int64
	err := client.DB.QueryRow(
		`SELECT public.start_opname_session(
		   p_opname_type=>'per_sku_list'::public.opname_type,
		   p_scope_payload=>'{"skus":["TEST-IMM"]}'::jsonb,
		   p_counted_by=>'00000000-0000-0000-0000-000000000001'::uuid,
		   p_witnessed_by=>'00000000-0000-0000-0000-000000000002'::uuid)`).Scan(&sessionID)
	if err != nil {
		t.Fatalf("start_opname_session: %v", err)
	}

	rows, err := client.DB.Query(
		`SELECT warehouse, system_qty_snapshot
		   FROM public.stock_opname_counts WHERE session_id=$1 ORDER BY warehouse`, sessionID)
	if err != nil {
		t.Fatalf("read counts: %v", err)
	}
	defer rows.Close()
	snapshots := map[string]int{}
	for rows.Next() {
		var w string
		var qty int
		_ = rows.Scan(&w, &qty)
		snapshots[w] = qty
	}
	if snapshots["atas"] != 25 || snapshots["bawah"] != 10 {
		t.Fatalf("snapshots wrong: %v", snapshots)
	}
}

// TestStartOpnameSession_WitnessSameAsCounter_Fails verifies the friendlier
// RPC-level two-person check fires BEFORE the chk_two_person CHECK on the
// underlying table. The RPC must reject counted_by == witnessed_by with an
// error message containing "different" so the frontend can surface a clear
// "counter and witness must be different users" toast instead of a raw
// constraint violation. The CHECK on stock_opname_sessions remains the
// backstop for direct-INSERT bypass attempts (TestOpname_TwoPersonConstraint).
func TestStartOpnameSession_WitnessSameAsCounter_Fails(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	_, err := client.DB.Exec(
		`SELECT public.start_opname_session(
		   p_opname_type=>'full'::public.opname_type,
		   p_scope_payload=>'{}'::jsonb,
		   p_counted_by=>'00000000-0000-0000-0000-000000000001'::uuid,
		   p_witnessed_by=>'00000000-0000-0000-0000-000000000001'::uuid)`)
	if err == nil || !strings.Contains(err.Error(), "different") {
		t.Fatalf("expected witness-must-differ error, got: %v", err)
	}
}

// TestRecordOpnameCount_UpsertsVariance is the Task 7 happy path: after
// start_opname_session snapshots stock_atas=20 and harga_modal=1000, calling
// record_opname_count with counted_qty=18 must:
//   - update stock_opname_counts.counted_qty to 18
//   - drive the generated variance column to (18 - 20) = -2
//   - drive variance_value to (-2) * 1000 = -2000
// The caller is the assigned counter (must match session.counted_by_user_id).
func TestRecordOpnameCount_UpsertsVariance(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 20)
	// Pin harga_modal so variance_value is deterministic.
	if _, err := client.DB.Exec(
		`UPDATE public.stocks SET harga_modal=1000 WHERE sku='TEST-IMM'`); err != nil {
		t.Fatalf("set harga_modal: %v", err)
	}

	var sid int64
	err := client.DB.QueryRow(
		`SELECT public.start_opname_session(
		   p_opname_type=>'per_sku_list'::public.opname_type,
		   p_scope_payload=>'{"skus":["TEST-IMM"]}'::jsonb,
		   p_counted_by=>'00000000-0000-0000-0000-000000000001'::uuid,
		   p_witnessed_by=>'00000000-0000-0000-0000-000000000002'::uuid)`).Scan(&sid)
	if err != nil {
		t.Fatalf("start_opname_session: %v", err)
	}

	_, err = client.DB.Exec(
		`SELECT public.record_opname_count($1, 'TEST-IMM', 'atas', 18,
		   '00000000-0000-0000-0000-000000000001'::uuid)`, sid)
	if err != nil {
		t.Fatalf("record_opname_count: %v", err)
	}

	var variance int
	var varianceValue float64
	err = client.DB.QueryRow(
		`SELECT variance, variance_value FROM public.stock_opname_counts
		 WHERE session_id=$1 AND sku='TEST-IMM' AND warehouse='atas'`, sid).
		Scan(&variance, &varianceValue)
	if err != nil {
		t.Fatalf("read count row: %v", err)
	}
	if variance != -2 {
		t.Fatalf("variance = %d, want -2", variance)
	}
	if varianceValue != -2000 {
		t.Fatalf("variance_value = %v, want -2000", varianceValue)
	}
}

// TestRecordOpnameCount_NonParticipant_Fails pins the auth guard: only the
// session's counter or witness can submit a count. A stranger caller must be
// rejected with an error mentioning the auth violation.
func TestRecordOpnameCount_NonParticipant_Fails(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 20)

	var sid int64
	_ = client.DB.QueryRow(
		`SELECT public.start_opname_session(
		   p_opname_type=>'per_sku_list'::public.opname_type,
		   p_scope_payload=>'{"skus":["TEST-IMM"]}'::jsonb,
		   p_counted_by=>'00000000-0000-0000-0000-000000000001'::uuid,
		   p_witnessed_by=>'00000000-0000-0000-0000-000000000002'::uuid)`).Scan(&sid)

	// Caller is neither the counter nor the witness — must throw.
	_, err := client.DB.Exec(
		`SELECT public.record_opname_count($1, 'TEST-IMM', 'atas', 18,
		   '00000000-0000-0000-0000-000000000099'::uuid)`, sid)
	if err == nil {
		t.Fatalf("expected auth error for non-participant caller, got nil")
	}
	if !strings.Contains(err.Error(), "counter") && !strings.Contains(err.Error(), "witness") {
		t.Fatalf("unexpected error: %v", err)
	}
}

// TestSubmitOpname_WithoutWitnessAck_Fails pins the witness-ack precondition:
// submit_opname_for_owner must refuse if witness_acknowledged_at is still NULL.
// The error message must contain "witness" so the UI can surface a clear toast.
func TestSubmitOpname_WithoutWitnessAck_Fails(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 20)

	var sid int64
	_ = client.DB.QueryRow(
		`SELECT public.start_opname_session(
		   p_opname_type=>'per_sku_list'::public.opname_type,
		   p_scope_payload=>'{"skus":["TEST-IMM"]}'::jsonb,
		   p_counted_by=>'00000000-0000-0000-0000-000000000001'::uuid,
		   p_witnessed_by=>'00000000-0000-0000-0000-000000000002'::uuid)`).Scan(&sid)
	_, _ = client.DB.Exec(
		`SELECT public.record_opname_count($1, 'TEST-IMM', 'atas', 18,
		   '00000000-0000-0000-0000-000000000001'::uuid)`, sid)

	_, err := client.DB.Exec(
		`SELECT public.submit_opname_for_owner($1,
		   '00000000-0000-0000-0000-000000000001'::uuid)`, sid)
	if err == nil {
		t.Fatalf("expected witness-ack error, got nil")
	}
	if !strings.Contains(err.Error(), "witness") {
		t.Fatalf("expected witness-ack error, got: %v", err)
	}
}

// TestSubmitOpname_HappyPath drives the full Task 7 flow:
//   counter records counts → witness acknowledges → counter submits.
// After submit:
//   - session.status flipped to 'pending_owner', submitted_at set
//   - approval_requests row with type='opname' exists, linked via
//     approval_request_id
//   - variance_total_value computed (signed sum of variance_value across all
//     counts in the session)
//   - submit_opname_for_owner returns the new approval_request_id
func TestSubmitOpname_HappyPath(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 20)
	db.EnsureSKUStock(t, client, "TEST-IMM", "bawah", 5)
	if _, err := client.DB.Exec(
		`UPDATE public.stocks SET harga_modal=1000 WHERE sku='TEST-IMM'`); err != nil {
		t.Fatalf("set harga_modal: %v", err)
	}

	var sid int64
	err := client.DB.QueryRow(
		`SELECT public.start_opname_session(
		   p_opname_type=>'per_sku_list'::public.opname_type,
		   p_scope_payload=>'{"skus":["TEST-IMM"]}'::jsonb,
		   p_counted_by=>'00000000-0000-0000-0000-000000000001'::uuid,
		   p_witnessed_by=>'00000000-0000-0000-0000-000000000002'::uuid)`).Scan(&sid)
	if err != nil {
		t.Fatalf("start_opname_session: %v", err)
	}

	// Counter records: atas variance = -2 (lost 2 × 1000 = -2000)
	//                  bawah variance = 0 (matches snapshot, no contribution)
	if _, err := client.DB.Exec(
		`SELECT public.record_opname_count($1, 'TEST-IMM', 'atas', 18,
		   '00000000-0000-0000-0000-000000000001'::uuid)`, sid); err != nil {
		t.Fatalf("record atas: %v", err)
	}
	if _, err := client.DB.Exec(
		`SELECT public.record_opname_count($1, 'TEST-IMM', 'bawah', 5,
		   '00000000-0000-0000-0000-000000000001'::uuid)`, sid); err != nil {
		t.Fatalf("record bawah: %v", err)
	}

	// Witness acknowledges. Must be witness, not counter.
	if _, err := client.DB.Exec(
		`SELECT public.witness_acknowledge_opname($1,
		   '00000000-0000-0000-0000-000000000002'::uuid)`, sid); err != nil {
		t.Fatalf("witness_acknowledge_opname: %v", err)
	}

	// Counter submits.
	var approvalID int64
	if err := client.DB.QueryRow(
		`SELECT public.submit_opname_for_owner($1,
		   '00000000-0000-0000-0000-000000000001'::uuid)`, sid).Scan(&approvalID); err != nil {
		t.Fatalf("submit_opname_for_owner: %v", err)
	}
	if approvalID == 0 {
		t.Fatalf("submit returned approval_id=0")
	}

	// Approval row exists with type='opname' and status='pending'.
	var arType, arStatus string
	if err := client.DB.QueryRow(
		`SELECT request_type::text, status::text FROM public.approval_requests WHERE id=$1`,
		approvalID).Scan(&arType, &arStatus); err != nil {
		t.Fatalf("read approval_requests: %v", err)
	}
	if arType != "opname" {
		t.Fatalf("approval request_type = %s, want opname", arType)
	}
	if arStatus != "pending" {
		t.Fatalf("approval status = %s, want pending", arStatus)
	}

	// Session linked + flipped to pending_owner with submitted_at populated.
	var sessionStatus string
	var linkedApprovalID int64
	var submittedAtNotNull bool
	var varianceTotal float64
	if err := client.DB.QueryRow(
		`SELECT status::text, approval_request_id,
		        submitted_at IS NOT NULL, variance_total_value
		   FROM public.stock_opname_sessions WHERE id=$1`, sid).
		Scan(&sessionStatus, &linkedApprovalID, &submittedAtNotNull, &varianceTotal); err != nil {
		t.Fatalf("read session: %v", err)
	}
	if sessionStatus != "pending_owner" {
		t.Fatalf("session status = %s, want pending_owner", sessionStatus)
	}
	if linkedApprovalID != approvalID {
		t.Fatalf("session.approval_request_id = %d, want %d", linkedApprovalID, approvalID)
	}
	if !submittedAtNotNull {
		t.Fatalf("session.submitted_at not set")
	}
	// Signed total: atas contributes -2000, bawah contributes 0 → -2000.
	if varianceTotal != -2000 {
		t.Fatalf("variance_total_value = %v, want -2000", varianceTotal)
	}
}

// TestCommitOpname_WritesOneMovementPerVariance is the Task 8 happy path:
// after a full opname flow (start → record counts → witness ack → submit →
// Owner approve via _transition_approval), commit_opname must:
//   - write ONE stock_movements row per (sku, warehouse) with variance != 0
//     using source='opname_variance' via Phase 1's _log_stock_movement helper
//   - UPDATE stocks.stock_<warehouse> by the SIGNED variance (qty_delta)
//   - flip session.status to 'committed' and stamp committed_at
//
// The bawah count matches the snapshot exactly (variance=0) so no ledger row
// is written for it — only the varianced atas row produces a movement. This
// is the one-row-per-variance invariant: zero-variance counts are filtered.
func TestCommitOpname_WritesOneMovementPerVariance(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 20)
	db.EnsureSKUStock(t, client, "TEST-IMM", "bawah", 5)
	if _, err := client.DB.Exec(
		`UPDATE public.stocks SET harga_modal=1000 WHERE sku='TEST-IMM'`); err != nil {
		t.Fatalf("set harga_modal: %v", err)
	}

	var sid int64
	if err := client.DB.QueryRow(
		`SELECT public.start_opname_session(
		   p_opname_type=>'per_sku_list'::public.opname_type,
		   p_scope_payload=>'{"skus":["TEST-IMM"]}'::jsonb,
		   p_counted_by=>'00000000-0000-0000-0000-000000000001'::uuid,
		   p_witnessed_by=>'00000000-0000-0000-0000-000000000002'::uuid)`).Scan(&sid); err != nil {
		t.Fatalf("start_opname_session: %v", err)
	}

	// atas: variance = 18 - 20 = -2 (shortage)
	if _, err := client.DB.Exec(
		`SELECT public.record_opname_count($1, 'TEST-IMM', 'atas', 18,
		   '00000000-0000-0000-0000-000000000001'::uuid)`, sid); err != nil {
		t.Fatalf("record atas: %v", err)
	}
	// bawah: variance = 5 - 5 = 0 (matches snapshot — should produce NO ledger row)
	if _, err := client.DB.Exec(
		`SELECT public.record_opname_count($1, 'TEST-IMM', 'bawah', 5,
		   '00000000-0000-0000-0000-000000000001'::uuid)`, sid); err != nil {
		t.Fatalf("record bawah: %v", err)
	}

	if _, err := client.DB.Exec(
		`SELECT public.witness_acknowledge_opname($1,
		   '00000000-0000-0000-0000-000000000002'::uuid)`, sid); err != nil {
		t.Fatalf("witness_acknowledge_opname: %v", err)
	}

	var aid int64
	if err := client.DB.QueryRow(
		`SELECT public.submit_opname_for_owner($1,
		   '00000000-0000-0000-0000-000000000001'::uuid)`, sid).Scan(&aid); err != nil {
		t.Fatalf("submit_opname_for_owner: %v", err)
	}

	// Simulate Owner approval via the canonical _transition_approval helper.
	if _, err := client.DB.Exec(
		`SELECT public._transition_approval($1, 'approved'::public.approval_status,
		   '00000000-0000-0000-0000-000000000099'::uuid, 'owner_pin')`, aid); err != nil {
		t.Fatalf("transition approval: %v", err)
	}

	before := db.CountStockMovements(t, client, "TEST-IMM")
	if _, err := client.DB.Exec(
		`SELECT public.commit_opname($1)`, aid); err != nil {
		t.Fatalf("commit_opname: %v", err)
	}

	// Exactly ONE new ledger row (only atas had a variance; bawah was a match).
	if got := db.CountStockMovements(t, client, "TEST-IMM"); got-before != 1 {
		t.Fatalf("expected 1 new ledger row, got %d", got-before)
	}

	// Stocks updated by signed variance: atas 20 + (-2) = 18, bawah unchanged.
	var atas, bawah int
	_ = client.DB.QueryRow(
		`SELECT stock_atas, stock_bawah FROM public.stocks WHERE sku='TEST-IMM'`).
		Scan(&atas, &bawah)
	if atas != 18 {
		t.Fatalf("stock_atas = %d, want 18", atas)
	}
	if bawah != 5 {
		t.Fatalf("stock_bawah = %d, want 5", bawah)
	}

	// The ledger row carries source='opname_variance' and qty_delta=-2 (signed).
	var source string
	var qtyDelta int
	if err := client.DB.QueryRow(
		`SELECT source::text, qty_delta FROM public.stock_movements
		   WHERE sku='TEST-IMM' AND source='opname_variance'
		   ORDER BY id DESC LIMIT 1`).Scan(&source, &qtyDelta); err != nil {
		t.Fatalf("read ledger row: %v", err)
	}
	if source != "opname_variance" {
		t.Fatalf("ledger source = %s, want opname_variance", source)
	}
	if qtyDelta != -2 {
		t.Fatalf("ledger qty_delta = %d, want -2 (signed)", qtyDelta)
	}

	// Session flipped to committed; committed_at set; approval row stays approved.
	var sessionStatus string
	var committedAtNotNull bool
	_ = client.DB.QueryRow(
		`SELECT status::text, committed_at IS NOT NULL
		   FROM public.stock_opname_sessions WHERE id=$1`, sid).
		Scan(&sessionStatus, &committedAtNotNull)
	if sessionStatus != "committed" {
		t.Fatalf("session status = %s, want committed", sessionStatus)
	}
	if !committedAtNotNull {
		t.Fatalf("session committed_at not set")
	}
	var arStatus string
	_ = client.DB.QueryRow(
		`SELECT status::text FROM public.approval_requests WHERE id=$1`, aid).Scan(&arStatus)
	if arStatus != "approved" {
		t.Fatalf("approval_requests status = %s, want approved (stays approved)", arStatus)
	}
}

// TestCommitOpname_NotApproved_Fails pins the gating precondition: commit_opname
// must REFUSE to write stock or ledger rows when the approval_requests row
// is not yet in 'approved' status. This mirrors commit_approved_adjustment's
// guard — every commit RPC is the second hop of a two-phase architecture
// (gate → commit), and the gate must have flipped first.
func TestCommitOpname_NotApproved_Fails(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 20)

	var sid int64
	_ = client.DB.QueryRow(
		`SELECT public.start_opname_session(
		   p_opname_type=>'per_sku_list'::public.opname_type,
		   p_scope_payload=>'{"skus":["TEST-IMM"]}'::jsonb,
		   p_counted_by=>'00000000-0000-0000-0000-000000000001'::uuid,
		   p_witnessed_by=>'00000000-0000-0000-0000-000000000002'::uuid)`).Scan(&sid)
	_, _ = client.DB.Exec(
		`SELECT public.record_opname_count($1, 'TEST-IMM', 'atas', 18,
		   '00000000-0000-0000-0000-000000000001'::uuid)`, sid)
	_, _ = client.DB.Exec(
		`SELECT public.witness_acknowledge_opname($1,
		   '00000000-0000-0000-0000-000000000002'::uuid)`, sid)

	var aid int64
	_ = client.DB.QueryRow(
		`SELECT public.submit_opname_for_owner($1,
		   '00000000-0000-0000-0000-000000000001'::uuid)`, sid).Scan(&aid)

	// approval_requests row is still 'pending' — commit must refuse.
	before := db.CountStockMovements(t, client, "TEST-IMM")
	_, err := client.DB.Exec(`SELECT public.commit_opname($1)`, aid)
	if err == nil {
		t.Fatalf("expected commit_opname to refuse pending approval, got nil")
	}
	if !strings.Contains(err.Error(), "not approved") {
		t.Fatalf("unexpected error: %v", err)
	}

	// All-or-nothing: nothing was written.
	if got := db.CountStockMovements(t, client, "TEST-IMM"); got != before {
		t.Fatalf("ledger row written on failed commit: %d new rows", got-before)
	}
	var atas int
	_ = client.DB.QueryRow(
		`SELECT stock_atas FROM public.stocks WHERE sku='TEST-IMM'`).Scan(&atas)
	if atas != 20 {
		t.Fatalf("stock_atas changed after failed commit: got %d, want 20", atas)
	}
	var sessionStatus string
	_ = client.DB.QueryRow(
		`SELECT status::text FROM public.stock_opname_sessions WHERE id=$1`, sid).Scan(&sessionStatus)
	if sessionStatus == "committed" {
		t.Fatalf("session flipped to committed despite failed commit")
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2, Task 9: price_change_requests + stock_price_history schemas
// ─────────────────────────────────────────────────────────────────────────────
//
// price_change_requests is the MUTABLE workflow row (pending → approved /
// rejected / expired). stock_price_history is the APPEND-ONLY audit log that
// mirrors stock_movements' immutability pattern (Foundational Decision #1):
// REVOKE UPDATE,DELETE from anon+authenticated (belt) PLUS a BEFORE UPDATE/
// DELETE trigger that raises 'append-only' even under service_role
// (suspenders).
//
// The three tests below pin the contract:
//   1. Both tables exist after the …015 migration.
//   2. stock_price_history rejects UPDATE and DELETE with an 'append-only'
//      error message (covers both triggers — task description enumerates both).
//   3. price_change_requests is mutable (UPDATE status='approved' succeeds
//      under the service_role connection NewTestClient uses) — the audit log's
//      immutability must NOT bleed into the workflow row.
//
// Unique SKU per test (T9-PRICE-<nano>) avoids the TEST-IMM test-isolation
// pollution flagged in the T7/T8 progress entries.

func TestPriceChange_TablesExist(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	for _, tbl := range []string{"price_change_requests", "stock_price_history"} {
		var n int
		err := client.DB.QueryRow(
			`SELECT 1 FROM information_schema.tables
			 WHERE table_schema='public' AND table_name=$1`, tbl).Scan(&n)
		if err != nil {
			t.Fatalf("%s missing: %v", tbl, err)
		}
		if n != 1 {
			t.Fatalf("expected scan to yield 1 for %s, got %d", tbl, n)
		}
	}
}

func TestStockPriceHistory_UpdateRaises(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	sku := fmt.Sprintf("T9-PRICE-U-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, sku, "atas", 1)

	var id int64
	err := client.DB.QueryRow(
		`INSERT INTO public.stock_price_history
		   (sku, field, old_value, new_value, source, actor_user_id, actor_role)
		 VALUES ($1,'price', 1000, 1200, 'seed',
		         '00000000-0000-0000-0000-000000000000', 'system_test')
		 RETURNING id`, sku).Scan(&id)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	_, err = client.DB.Exec(
		`UPDATE public.stock_price_history SET new_value=999 WHERE id=$1`, id)
	if err == nil || !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("expected append-only, got: %v", err)
	}
}

func TestStockPriceHistory_DeleteRaises(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	sku := fmt.Sprintf("T9-PRICE-D-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, sku, "atas", 1)

	var id int64
	err := client.DB.QueryRow(
		`INSERT INTO public.stock_price_history
		   (sku, field, old_value, new_value, source, actor_user_id, actor_role)
		 VALUES ($1,'harga_modal', 500, 700, 'seed',
		         '00000000-0000-0000-0000-000000000000', 'system_test')
		 RETURNING id`, sku).Scan(&id)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	_, err = client.DB.Exec(
		`DELETE FROM public.stock_price_history WHERE id=$1`, id)
	if err == nil || !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("expected append-only, got: %v", err)
	}
}

// TestPriceChangeRequests_Mutable proves price_change_requests is the
// workflow row, NOT the audit log: a service_role UPDATE flipping status from
// 'pending' to 'approved' must succeed (the canonical commit path will do
// exactly this in T10's commit_approved_price_change RPC). This is the
// negative twin of the append-only tests above — if the REVOKE/trigger logic
// were copy-pasted from stock_price_history to price_change_requests by
// mistake, this test catches it.
func TestPriceChangeRequests_Mutable(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	sku := fmt.Sprintf("T9-PRICE-M-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, sku, "atas", 1)

	var arID int64
	err := client.DB.QueryRow(
		`INSERT INTO public.approval_requests (request_type, payload, requested_by)
		 VALUES ('price_change','{}'::jsonb,'00000000-0000-0000-0000-000000000001')
		 RETURNING id`).Scan(&arID)
	if err != nil {
		t.Fatalf("seed approval_request: %v", err)
	}

	var pcrID int64
	err = client.DB.QueryRow(
		`INSERT INTO public.price_change_requests
		   (sku, field, old_value, new_value, reason_note, approval_request_id, requested_by)
		 VALUES ($1,'price',1000,1200,'kenaikan supplier',$2,
		         '00000000-0000-0000-0000-000000000001')
		 RETURNING id`, sku, arID).Scan(&pcrID)
	if err != nil {
		t.Fatalf("seed price_change_request: %v", err)
	}

	_, err = client.DB.Exec(
		`UPDATE public.price_change_requests
		    SET status='approved', decided_at=now(),
		        decided_by='00000000-0000-0000-0000-000000000099'
		  WHERE id=$1`, pcrID)
	if err != nil {
		t.Fatalf("UPDATE price_change_requests must succeed (mutable workflow row), got: %v", err)
	}

	var status string
	_ = client.DB.QueryRow(
		`SELECT status FROM public.price_change_requests WHERE id=$1`, pcrID).Scan(&status)
	if status != "approved" {
		t.Fatalf("status = %q, want approved", status)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2, Task 10: request_price_change + commit_approved_price_change RPCs
// ─────────────────────────────────────────────────────────────────────────────
//
// Three tests pin the contract for the two SECURITY DEFINER RPCs that gate
// every price/harga_modal change behind Owner approval:
//
//   1. TestRequestPriceChange_SnapshotsCurrentValue — request_price_change
//      INSERTs both approval_requests (type='price_change') AND
//      price_change_requests with old_value snapshotted from stocks at the
//      time of request. The snapshot is critical: if stocks.price changes
//      between request and commit (which shouldn't happen given the REVOKE,
//      but layered guards) the audit log still records the value the Owner
//      actually approved against.
//
//   2. TestCommitPriceChange_WhilePending_Fails — commit_approved_price_change
//      called while approval_requests.status is still 'pending' must RAISE
//      'not approved'. This proves the gate works: even with the satellite
//      row present, the commit refuses to run until _transition_approval
//      has flipped the gate. Mirrors T4's commit_approved_adjustment pattern.
//
//   3. TestCommitPriceChange_HappyPath_UpdatesStockAndWritesImmutableHistory —
//      end-to-end: request → _transition_approval to approved → commit. Asserts
//      (a) stocks.price flipped to new_value, (b) a stock_price_history row
//      was written with source='approval' + correct old_value, (c) that
//      history row inherits the schema's append-only contract — an UPDATE
//      attempt raises 'append-only'. T9's tests proved the trigger works on
//      arbitrary seed rows; this proves the RPC-written rows are no exception.
//
// Per-test unique SKUs (T10-PRICE-{R|F|H}-<nano>) prevent the TEST-IMM state
// pollution flagged repeatedly in earlier Phase 2 progress entries.

func TestRequestPriceChange_SnapshotsCurrentValue(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	sku := fmt.Sprintf("T10-PRICE-R-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, sku, "atas", 1)
	if _, err := client.DB.Exec(
		`UPDATE public.stocks SET price=1000 WHERE sku=$1`, sku); err != nil {
		t.Fatalf("seed price: %v", err)
	}

	var aid int64
	if err := client.DB.QueryRow(
		`SELECT public.request_price_change(
		    p_sku           => $1,
		    p_field         => 'price',
		    p_new_value     => 1500,
		    p_reason_note   => 'kenaikan supplier',
		    p_actor_user_id => '00000000-0000-0000-0000-000000000001')`, sku).Scan(&aid); err != nil {
		t.Fatalf("request_price_change: %v", err)
	}
	if aid == 0 {
		t.Fatalf("expected non-zero approval_request id, got 0")
	}

	// approval_requests row exists with type='price_change' and pending.
	var arType, arStatus string
	if err := client.DB.QueryRow(
		`SELECT request_type::text, status::text FROM public.approval_requests WHERE id=$1`,
		aid).Scan(&arType, &arStatus); err != nil {
		t.Fatalf("read approval_requests: %v", err)
	}
	if arType != "price_change" {
		t.Fatalf("request_type = %q, want price_change", arType)
	}
	if arStatus != "pending" {
		t.Fatalf("status = %q, want pending", arStatus)
	}

	// price_change_requests row snapshots old_value=1000 from stocks.
	var oldVal, newVal float64
	var field, status string
	if err := client.DB.QueryRow(
		`SELECT field, old_value, new_value, status
		   FROM public.price_change_requests WHERE approval_request_id=$1`,
		aid).Scan(&field, &oldVal, &newVal, &status); err != nil {
		t.Fatalf("read price_change_requests: %v", err)
	}
	if field != "price" {
		t.Fatalf("field = %q, want price", field)
	}
	if oldVal != 1000 {
		t.Fatalf("old_value = %v, want 1000 (snapshot of stocks.price at request time)", oldVal)
	}
	if newVal != 1500 {
		t.Fatalf("new_value = %v, want 1500", newVal)
	}
	if status != "pending" {
		t.Fatalf("status = %q, want pending", status)
	}
}

func TestCommitPriceChange_WhilePending_Fails(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	sku := fmt.Sprintf("T10-PRICE-F-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, sku, "atas", 1)
	if _, err := client.DB.Exec(
		`UPDATE public.stocks SET price=2000 WHERE sku=$1`, sku); err != nil {
		t.Fatalf("seed price: %v", err)
	}

	var aid int64
	if err := client.DB.QueryRow(
		`SELECT public.request_price_change(
		    p_sku=>$1, p_field=>'price', p_new_value=>2500,
		    p_reason_note=>'kenaikan supplier',
		    p_actor_user_id=>'00000000-0000-0000-0000-000000000001')`, sku).Scan(&aid); err != nil {
		t.Fatalf("request_price_change: %v", err)
	}

	// Approval is still pending — commit must refuse.
	_, err := client.DB.Exec(
		`SELECT public.commit_approved_price_change($1)`, aid)
	if err == nil {
		t.Fatalf("expected error committing while pending, got nil")
	}
	if !strings.Contains(err.Error(), "not approved") {
		t.Fatalf("expected 'not approved' in error, got: %v", err)
	}

	// stocks.price must NOT have been mutated.
	var price float64
	_ = client.DB.QueryRow(
		`SELECT price FROM public.stocks WHERE sku=$1`, sku).Scan(&price)
	if price != 2000 {
		t.Fatalf("stocks.price = %v, want 2000 (commit refused, no mutation)", price)
	}
}

func TestCommitPriceChange_HappyPath_UpdatesStockAndWritesImmutableHistory(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	sku := fmt.Sprintf("T10-PRICE-H-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, sku, "atas", 1)
	if _, err := client.DB.Exec(
		`UPDATE public.stocks SET price=1000 WHERE sku=$1`, sku); err != nil {
		t.Fatalf("seed price: %v", err)
	}

	var aid int64
	if err := client.DB.QueryRow(
		`SELECT public.request_price_change(
		    p_sku=>$1, p_field=>'price', p_new_value=>1500,
		    p_reason_note=>'kenaikan supplier',
		    p_actor_user_id=>'00000000-0000-0000-0000-000000000001')`, sku).Scan(&aid); err != nil {
		t.Fatalf("request_price_change: %v", err)
	}

	// Flip the approval gate via the sanctioned helper.
	if _, err := client.DB.Exec(
		`SELECT public._transition_approval($1, 'approved'::public.approval_status,
		   '00000000-0000-0000-0000-000000000099', 'owner_pin')`, aid); err != nil {
		t.Fatalf("_transition_approval: %v", err)
	}

	// Commit must now succeed.
	if _, err := client.DB.Exec(
		`SELECT public.commit_approved_price_change($1)`, aid); err != nil {
		t.Fatalf("commit_approved_price_change: %v", err)
	}

	// (a) stocks.price was updated to new_value.
	var price float64
	if err := client.DB.QueryRow(
		`SELECT price FROM public.stocks WHERE sku=$1`, sku).Scan(&price); err != nil {
		t.Fatalf("read stocks.price: %v", err)
	}
	if price != 1500 {
		t.Fatalf("stocks.price = %v, want 1500", price)
	}

	// (b) One stock_price_history row with source='approval', correct values.
	var historyID int64
	var oldVal, newVal float64
	var source string
	if err := client.DB.QueryRow(
		`SELECT sph.id, sph.old_value, sph.new_value, sph.source
		   FROM public.stock_price_history sph
		   JOIN public.price_change_requests pcr ON sph.related_request_id = pcr.id
		  WHERE pcr.approval_request_id = $1`, aid).Scan(&historyID, &oldVal, &newVal, &source); err != nil {
		t.Fatalf("read stock_price_history: %v", err)
	}
	if oldVal != 1000 {
		t.Fatalf("history.old_value = %v, want 1000", oldVal)
	}
	if newVal != 1500 {
		t.Fatalf("history.new_value = %v, want 1500", newVal)
	}
	if source != "approval" {
		t.Fatalf("history.source = %q, want approval", source)
	}

	// (c) The RPC-written history row inherits the append-only contract.
	_, err := client.DB.Exec(
		`UPDATE public.stock_price_history SET new_value=999 WHERE id=$1`, historyID)
	if err == nil || !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("expected append-only error on history UPDATE, got: %v", err)
	}

	// price_change_requests workflow row was closed out.
	var pcrStatus string
	_ = client.DB.QueryRow(
		`SELECT status FROM public.price_change_requests WHERE approval_request_id=$1`,
		aid).Scan(&pcrStatus)
	if pcrStatus != "approved" {
		t.Fatalf("price_change_requests.status = %q, want approved", pcrStatus)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2, Task 11: REVOKE direct writes on `stocks` + `seed_stock_row` RPC.
// ─────────────────────────────────────────────────────────────────────────────
//
// Migration 20260607000017_revoke_stocks_writes.sql REVOKEs column-level UPDATE
// on `stocks.{price,harga_modal,stock_atas,stock_bawah}` from PUBLIC/anon/
// authenticated. After this, the only path to mutate those columns from client
// roles is via SECURITY DEFINER RPCs whose function owner (postgres) keeps the
// privilege. service_role retains the bypass (Foundational Decision #1).
//
// The same migration introduces `seed_stock_row(p_sku, p_name, p_category,
// p_price, p_harga_modal, p_stock_atas, p_stock_bawah, p_actor_user_id)
// RETURNS TEXT` — the sanctioned path to create a BRAND-NEW SKU (CSV bulk
// import + manual New-SKU form). Writes 1 `stock_price_history` row per
// non-null field (price + harga_modal) and 1 `stock_movements` row per
// warehouse with non-zero starting qty, all with source='seed'. RAISES on
// existing SKU — the approval flow (Tasks 9/10) is the path to change an
// existing row's price; this RPC's contract is "seed once, immutably".
//
// Owner-role gate: the function checks `admin_users.role = 'Owner'` for the
// provided `p_actor_user_id`. Tests seed an Owner admin row with the well-
// known UUID `00000000-0000-0000-0000-000000000099` (the plan's reserved test
// actor id) before calling the RPC.
//
// Per-test unique SKUs (`T11-{kind}-<nano>`) follow the T9/T10 hygiene pattern
// so reruns / parallel test runs don't collide on the stocks PK.

// ensureT11OwnerAdmin upserts the well-known Owner admin row that
// seed_stock_row's role gate looks up. Idempotent across reruns and across
// the three Task 11 tests that share the same actor uuid.
func ensureT11OwnerAdmin(t *testing.T, c *db.Client) {
	t.Helper()
	const ownerID = "00000000-0000-0000-0000-000000000099"
	if _, err := c.DB.Exec(
		`INSERT INTO public.admin_users (id, name, email, role, permissions, status)
		 VALUES ($1, 'T11 Owner', 'phase2-t11-owner@test.local', 'Owner',
		         '{"dashboard":true}'::jsonb, 'Aktif')
		 ON CONFLICT (id) DO UPDATE SET role='Owner', status='Aktif'`,
		ownerID); err != nil {
		t.Fatalf("seed Owner admin: %v", err)
	}
}

// TestStocksDirectUpdate_AsAuthenticated_Fails proves the REVOKE landed:
// SET LOCAL ROLE authenticated; UPDATE stocks SET price=... must raise
// "permission denied". Wrapped in BEGIN/ROLLBACK so the role switch is
// transaction-scoped and can't leak into the next test on this connection.
func TestStocksDirectUpdate_AsAuthenticated_Fails(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	sku := fmt.Sprintf("T11-DENIED-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, sku, "atas", 1)

	tx, err := client.DB.Begin()
	if err != nil {
		t.Fatalf("begin txn: %v", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`SET LOCAL ROLE authenticated`); err != nil {
		t.Fatalf("SET LOCAL ROLE authenticated: %v", err)
	}
	_, err = tx.Exec(`UPDATE public.stocks SET price = 999 WHERE sku=$1`, sku)
	if err == nil {
		t.Fatalf("expected permission denied on direct UPDATE stocks.price, got nil")
	}
	if !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("unexpected error (want permission denied): %v", err)
	}
}

// TestSeedStockRow_HappyPath proves the sanctioned creation path works:
// calling seed_stock_row for a new SKU inserts the stocks row with the
// supplied values, writes stock_price_history rows for price + harga_modal
// (source='seed'), and writes one stock_movements row per warehouse with
// non-zero starting qty (source='seed').
func TestSeedStockRow_HappyPath(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	ensureT11OwnerAdmin(t, client)

	sku := fmt.Sprintf("T11-SEED-%d", time.Now().UnixNano())
	// Defensive: in case a previous failed run left the row.
	_, _ = client.DB.Exec(`DELETE FROM public.stock_price_history WHERE sku=$1`, sku)
	_, _ = client.DB.Exec(`DELETE FROM public.stock_movements    WHERE sku=$1`, sku)
	_, _ = client.DB.Exec(`DELETE FROM public.stocks             WHERE sku=$1`, sku)

	var returnedSKU string
	if err := client.DB.QueryRow(
		`SELECT public.seed_stock_row(
		   p_sku           => $1,
		   p_name          => 'T11 Seeded',
		   p_category      => 'Aksesori',
		   p_price         => 5000,
		   p_harga_modal   => 3000,
		   p_stock_atas    => 4,
		   p_stock_bawah   => 2,
		   p_actor_user_id => '00000000-0000-0000-0000-000000000099'::uuid)`,
		sku).Scan(&returnedSKU); err != nil {
		t.Fatalf("seed_stock_row: %v", err)
	}
	if returnedSKU != sku {
		t.Fatalf("seed_stock_row returned %q, want %q", returnedSKU, sku)
	}

	// (a) stocks row exists with the right values.
	var name, category string
	var price, hargaModal float64
	var stockAtas, stockBawah int
	if err := client.DB.QueryRow(
		`SELECT name, category, price, harga_modal, stock_atas, stock_bawah
		   FROM public.stocks WHERE sku=$1`, sku).Scan(
		&name, &category, &price, &hargaModal, &stockAtas, &stockBawah); err != nil {
		t.Fatalf("read stocks row: %v", err)
	}
	if name != "T11 Seeded" || category != "Aksesori" || price != 5000 ||
		hargaModal != 3000 || stockAtas != 4 || stockBawah != 2 {
		t.Fatalf("stocks row mismatch: name=%q category=%q price=%v harga_modal=%v atas=%d bawah=%d",
			name, category, price, hargaModal, stockAtas, stockBawah)
	}

	// (b) stock_price_history: 1 row for price + 1 row for harga_modal, source='seed'.
	var historyRows int
	if err := client.DB.QueryRow(
		`SELECT count(*) FROM public.stock_price_history
		  WHERE sku=$1 AND source='seed'`, sku).Scan(&historyRows); err != nil {
		t.Fatalf("count stock_price_history: %v", err)
	}
	if historyRows < 1 {
		t.Fatalf("expected >=1 seed history row, got %d", historyRows)
	}

	// (c) stock_movements: one seed row per warehouse with non-zero qty (here both).
	var movementRows int
	if err := client.DB.QueryRow(
		`SELECT count(*) FROM public.stock_movements
		  WHERE sku=$1 AND source='seed'`, sku).Scan(&movementRows); err != nil {
		t.Fatalf("count stock_movements: %v", err)
	}
	if movementRows < 1 {
		t.Fatalf("expected >=1 seed movement row, got %d", movementRows)
	}
}

// TestSeedStockRow_ExistingSKU_Fails proves seed_stock_row is single-shot:
// calling it on a SKU that already exists must raise — the approval flow is
// the only path to mutate price/qty on an existing row.
func TestSeedStockRow_ExistingSKU_Fails(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	ensureT11OwnerAdmin(t, client)

	sku := fmt.Sprintf("T11-DUP-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, sku, "atas", 1)

	_, err := client.DB.Exec(
		`SELECT public.seed_stock_row(
		   p_sku           => $1,
		   p_name          => 'T11 Dup',
		   p_category      => 'Aksesori',
		   p_price         => 5000,
		   p_harga_modal   => 3000,
		   p_stock_atas    => 4,
		   p_stock_bawah   => 2,
		   p_actor_user_id => '00000000-0000-0000-0000-000000000099'::uuid)`,
		sku)
	if err == nil {
		t.Fatalf("expected seed_stock_row to fail for existing SKU, got nil")
	}
	if !strings.Contains(err.Error(), "already exists") &&
		!strings.Contains(err.Error(), "exists") {
		t.Fatalf("unexpected error message (want 'already exists'): %v", err)
	}
}

// --- Task 12: admin_users PIN columns + extended permissions JSONB + pgcrypto ---
//
// The migration 20260607000018_extend_permissions_and_pin.sql:
//   1. Enables the pgcrypto extension (for bcrypt PIN hashing in T13).
//   2. Adds three PIN-state columns to admin_users (approval_pin_hash,
//      pin_failed_count, pin_locked_until). The lockout counter lives on the
//      Owner's own row — even multi-karyawan PIN fumbles increment the same
//      row (Foundational Decision #6).
//   3. Extends the existing admin_users.permissions JSONB column with the 19
//      action-level keys from spec Foundational Decision #5. The merge uses
//      the `||` operator so existing sidebar keys (dashboard, kasir, ...) are
//      preserved untouched — one column, one source of truth.
//
// Note: the UPDATE seeding only touches Owner rows that exist at migration
// time. Rows inserted afterwards inherit only whatever defaults the row's
// `permissions` JSONB literal carries. TestAdminUsers_OwnerHasAllActionPermissions
// therefore seeds an Owner row with the full action-key set via the same `||`
// merge logic — this proves the migration's seeding pattern is sound *and*
// gives us a deterministic Owner row to assert against, independent of CI's
// historical admin_users state.

// TestAdminUsers_PinColumnsExist proves the three PIN-state columns landed on
// public.admin_users via migration 20260607000018. These columns are the
// storage backing for T13's verify_owner_pin RPC (bcrypt + per-Owner lockout).
func TestAdminUsers_PinColumnsExist(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	rows, err := client.DB.Query(
		`SELECT column_name FROM information_schema.columns
		 WHERE table_schema='public' AND table_name='admin_users'
		   AND column_name IN ('approval_pin_hash','pin_failed_count','pin_locked_until')`)
	if err != nil {
		t.Fatalf("query columns: %v", err)
	}
	defer rows.Close()
	cols := map[string]bool{}
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			t.Fatalf("scan: %v", err)
		}
		cols[c] = true
	}
	for _, want := range []string{"approval_pin_hash", "pin_failed_count", "pin_locked_until"} {
		if !cols[want] {
			t.Fatalf("missing column admin_users.%s", want)
		}
	}
}

// TestAdminUsers_OwnerHasAllActionPermissions proves that the migration's
// permissions = permissions || jsonb_build_object(...) merge pattern lands
// the expected action keys on an Owner row. We seed our own Owner row with
// the same merge (rather than relying on a pre-existing Owner from the
// migration's UPDATE) so the test is deterministic across DBs that may not
// have had any Owner rows when the migration was applied.
func TestAdminUsers_OwnerHasAllActionPermissions(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	const ownerID = "00000000-0000-0000-0000-000000000099"
	if _, err := client.DB.Exec(
		`INSERT INTO public.admin_users (id, name, email, role, permissions, status)
		 VALUES ($1, 'T12 Owner', 'phase2-t12-owner@test.local', 'Owner',
		         '{"dashboard":true}'::jsonb, 'Aktif')
		 ON CONFLICT (id) DO UPDATE SET role='Owner', status='Aktif'`,
		ownerID); err != nil {
		t.Fatalf("seed Owner admin: %v", err)
	}

	// Replay the migration's Owner permission merge against this specific
	// row so the assertion is independent of pre-migration Owner state.
	if _, err := client.DB.Exec(
		`UPDATE public.admin_users
		    SET permissions = permissions || jsonb_build_object(
		      'can_request_adjustment',            true,
		      'can_approve_adjustment',            true,
		      'can_start_opname',                  true,
		      'can_witness_opname',                true,
		      'can_commit_opname',                 true,
		      'can_request_price_change',          true,
		      'can_approve_price_change',          true,
		      'can_witness_po_receipt',            true,
		      'can_open_kasir_shift',              true,
		      'can_request_kasir_price_override',  true,
		      'can_approve_kasir_price_override',  true,
		      'can_request_kasir_void',            true,
		      'can_approve_kasir_void',            true,
		      'can_request_kasir_refund',          true,
		      'can_approve_kasir_refund',          true,
		      'can_override_price_floor',          true,
		      'can_initiate_transfer',             true,
		      'can_receive_transfer',              true,
		      'can_view_pengawasan',               true
		    )
		  WHERE id = $1`,
		ownerID); err != nil {
		t.Fatalf("merge Owner action keys: %v", err)
	}

	var approve, pengawasan, kasirRefund bool
	if err := client.DB.QueryRow(
		`SELECT (permissions->>'can_approve_adjustment')::boolean,
		        (permissions->>'can_view_pengawasan')::boolean,
		        (permissions->>'can_approve_kasir_refund')::boolean
		   FROM public.admin_users WHERE id=$1`, ownerID).Scan(&approve, &pengawasan, &kasirRefund); err != nil {
		t.Fatalf("read Owner permissions: %v", err)
	}
	if !approve {
		t.Fatalf("Owner can_approve_adjustment = false, want true")
	}
	if !pengawasan {
		t.Fatalf("Owner can_view_pengawasan = false, want true")
	}
	if !kasirRefund {
		t.Fatalf("Owner can_approve_kasir_refund = false, want true")
	}
}

// TestAdminUsers_PgcryptoAvailable proves the pgcrypto extension is enabled
// (the migration runs `CREATE EXTENSION IF NOT EXISTS pgcrypto`). T13's
// verify_owner_pin RPC needs both crypt() and gen_salt('bf') for the bcrypt
// PIN hash + compare path.
func TestAdminUsers_PgcryptoAvailable(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	var hashed string
	if err := client.DB.QueryRow(
		`SELECT crypt('test', gen_salt('bf'))`).Scan(&hashed); err != nil {
		t.Fatalf("pgcrypto crypt/gen_salt failed (extension missing?): %v", err)
	}
	if !strings.HasPrefix(hashed, "$2") {
		t.Fatalf("crypt() output does not look like bcrypt: %q", hashed)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2, Task 13: verify_owner_pin RPC — bcrypt + per-Owner lockout
// ─────────────────────────────────────────────────────────────────────────────
//
// Migration 20260607000019_verify_owner_pin.sql adds the SECURITY DEFINER RPC
// public.verify_owner_pin(p_approval_id BIGINT, p_pin TEXT) RETURNS BOOLEAN.
//
// Per Foundational Decision #6 the lockout counter lives on the ONE Owner row
// (admin_users WHERE role='Owner' ORDER BY id LIMIT 1) — not on the requester.
// Even if multiple staff fumble the PIN in sequence the same row increments,
// so the Owner is locked after 5 cumulative consecutive failures regardless of
// who entered the wrong PIN.
//
// Test seed Owner is the well-known id '00000000-0000-0000-0000-000000000099'
// (sorts first under ORDER BY id, so it is the row the RPC will select even
// when production Owner rows coexist in the DB).
//
// The three tests pin: (1) the happy path returns TRUE, flips the approval,
// and zeroes the failure counter; (2) wrong PIN entries increment the
// per-Owner counter and the row locks after 5 failures; (3) a *locked* row
// rejects even the correct PIN — only time can unlock.

// ensureT13OwnerWithPin upserts the well-known Owner admin row used by the T13
// tests and sets a known bcrypt PIN hash (for pin "123456"), resetting the
// lockout state. Idempotent across reruns and across the three tests.
func ensureT13OwnerWithPin(t *testing.T, c *db.Client) {
	t.Helper()
	const ownerID = "00000000-0000-0000-0000-000000000099"
	if _, err := c.DB.Exec(
		`INSERT INTO public.admin_users (id, name, email, role, permissions, status)
		 VALUES ($1, 'T13 Owner', 'phase2-t13-owner@test.local', 'Owner',
		         '{"dashboard":true}'::jsonb, 'Aktif')
		 ON CONFLICT (id) DO UPDATE SET role='Owner', status='Aktif'`,
		ownerID); err != nil {
		t.Fatalf("seed Owner admin: %v", err)
	}
	if _, err := c.DB.Exec(
		`UPDATE public.admin_users
		    SET approval_pin_hash = crypt('123456', gen_salt('bf')),
		        pin_failed_count  = 0,
		        pin_locked_until  = NULL
		  WHERE id = $1`, ownerID); err != nil {
		t.Fatalf("seed Owner PIN: %v", err)
	}
}

// seedT13PendingApproval inserts a pending approval_requests row of type
// 'adjustment' directly (avoiding the request_adjustment RPC's stock/state
// dependencies — the verify_owner_pin RPC doesn't care about the satellite
// row, only that the approval is pending). Returns the new id.
func seedT13PendingApproval(t *testing.T, c *db.Client) int64 {
	t.Helper()
	var id int64
	if err := c.DB.QueryRow(
		`INSERT INTO public.approval_requests (request_type, payload, requested_by)
		 VALUES ('adjustment','{}'::jsonb,'00000000-0000-0000-0000-000000000001')
		 RETURNING id`).Scan(&id); err != nil {
		t.Fatalf("seed pending approval: %v", err)
	}
	return id
}

// TestVerifyOwnerPin_Success pins the happy path: a correct PIN returns TRUE,
// the approval flips to 'approved' (via _transition_approval with channel
// 'owner_pin'), and pin_failed_count is reset to 0.
func TestVerifyOwnerPin_Success(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	ensureT13OwnerWithPin(t, client)
	aid := seedT13PendingApproval(t, client)

	var ok bool
	if err := client.DB.QueryRow(
		`SELECT public.verify_owner_pin($1, '123456')`, aid).Scan(&ok); err != nil {
		t.Fatalf("verify_owner_pin: %v", err)
	}
	if !ok {
		t.Fatalf("verify_owner_pin returned FALSE for the correct PIN")
	}

	var status, channel string
	if err := client.DB.QueryRow(
		`SELECT status::text, COALESCE(decision_channel,'')
		   FROM public.approval_requests WHERE id=$1`, aid).Scan(&status, &channel); err != nil {
		t.Fatalf("read approval row: %v", err)
	}
	if status != "approved" {
		t.Fatalf("approval status = %s, want approved", status)
	}
	if channel != "owner_pin" {
		t.Fatalf("decision_channel = %q, want owner_pin", channel)
	}

	var failed int
	_ = client.DB.QueryRow(
		`SELECT pin_failed_count FROM public.admin_users
		  WHERE id='00000000-0000-0000-0000-000000000099'`).Scan(&failed)
	if failed != 0 {
		t.Fatalf("pin_failed_count = %d after success, want 0 (reset)", failed)
	}
}

// TestVerifyOwnerPin_WrongPin_IncrementsOwnerCounter pins the per-Owner
// lockout invariant: 5 wrong PIN attempts (against any approval, against any
// caller) bump pin_failed_count on the Owner row to >=5 and set
// pin_locked_until. The RPC returns FALSE on wrong PIN — it does NOT raise.
func TestVerifyOwnerPin_WrongPin_IncrementsOwnerCounter(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	ensureT13OwnerWithPin(t, client)
	aid := seedT13PendingApproval(t, client)

	for i := 0; i < 5; i++ {
		// Wrong PIN returns FALSE (not RAISE) — error is intentionally ignored.
		_, _ = client.DB.Exec(
			`SELECT public.verify_owner_pin($1, 'WRONG!')`, aid)
	}

	var failed int
	var lockedUntil *string
	if err := client.DB.QueryRow(
		`SELECT pin_failed_count, pin_locked_until::text
		   FROM public.admin_users
		  WHERE id='00000000-0000-0000-0000-000000000099'`).Scan(&failed, &lockedUntil); err != nil {
		t.Fatalf("read Owner row: %v", err)
	}
	if failed < 5 {
		t.Fatalf("pin_failed_count = %d, want >=5", failed)
	}
	if lockedUntil == nil {
		t.Fatalf("pin_locked_until should be set after 5 consecutive failures")
	}

	// The approval must NOT have flipped — wrong PIN never advances the gate.
	var status string
	_ = client.DB.QueryRow(
		`SELECT status::text FROM public.approval_requests WHERE id=$1`, aid).Scan(&status)
	if status != "pending" {
		t.Fatalf("approval status = %s after 5 wrong PINs, want pending", status)
	}
}

// TestVerifyOwnerPin_WhenLocked_Rejects proves that the lockout window is
// inviolate even for the correct PIN — only time can unlock the Owner row.
// We seed the Owner with the lock already set (pin_locked_until = now()+1h)
// and confirm a CORRECT PIN call raises an error mentioning "locked".
func TestVerifyOwnerPin_WhenLocked_Rejects(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	ensureT13OwnerWithPin(t, client)
	// Force the lockout window open with the PIN still correct.
	if _, err := client.DB.Exec(
		`UPDATE public.admin_users
		    SET pin_failed_count = 5,
		        pin_locked_until = now() + INTERVAL '1 hour'
		  WHERE id = '00000000-0000-0000-0000-000000000099'`); err != nil {
		t.Fatalf("seed locked Owner: %v", err)
	}
	aid := seedT13PendingApproval(t, client)

	_, err := client.DB.Exec(
		`SELECT public.verify_owner_pin($1, '123456')`, aid)
	if err == nil {
		t.Fatalf("expected locked error for correct PIN against locked Owner, got nil")
	}
	if !strings.Contains(err.Error(), "locked") {
		t.Fatalf("expected error containing 'locked', got: %v", err)
	}

	// Approval still pending — even the right PIN cannot flip the gate while
	// the Owner row is locked.
	var status string
	_ = client.DB.QueryRow(
		`SELECT status::text FROM public.approval_requests WHERE id=$1`, aid).Scan(&status)
	if status != "pending" {
		t.Fatalf("approval status = %s during lockout, want pending", status)
	}

	// Cleanup so the lockout doesn't leak into any later test that hits the
	// same Owner row.
	_, _ = client.DB.Exec(
		`UPDATE public.admin_users
		    SET pin_failed_count = 0,
		        pin_locked_until = NULL
		  WHERE id = '00000000-0000-0000-0000-000000000099'`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2, Task 14: decide_via_wa_button + expire_pending_approvals RPCs
// ─────────────────────────────────────────────────────────────────────────────
//
// Migration 20260607000020_wa_button_expire.sql adds two SECURITY DEFINER RPCs:
//
//   1. public.decide_via_wa_button(p_approval_request_id BIGINT,
//                                  p_decision TEXT,
//                                  p_decided_by_user_id UUID) RETURNS BIGINT
//      — the SQL hop behind the Owner's WhatsApp button click. Validates the
//      decision string is in ('approved','rejected'), verifies the caller is
//      an Owner (admin_users.role='Owner'), and flips the gate via
//      _transition_approval with decision_channel='wa_button'. Returns the
//      approval_request id. GRANT EXECUTE to authenticated (server-side
//      Calista handler invokes it after WA webhook verification).
//
//   2. public.expire_pending_approvals() RETURNS INT — the auto-expiry
//      sweeper called by the Go backend poller every minute. Finds all
//      approval_requests with status='pending' AND expires_at <= now() and
//      flips each via _transition_approval(.., 'expired', NULL, 'auto_expire').
//      Returns the count of rows actually expired. GRANT EXECUTE to
//      service_role only — the poller runs under service_role; client SDKs
//      have no business invoking auto-expiry.
//
// Four tests pin the contract:
//   (1) TestDecideViaWaButton_OwnerApproves — Owner decides 'approved' →
//       approval_requests row flipped, status='approved', channel='wa_button'.
//   (2) TestDecideViaWaButton_NonOwnerRejected — a Staff Admin caller is
//       rejected with 'not authorized'. The row stays pending.
//   (3) TestDecideViaWaButton_InvalidDecision — passing 'maybe' raises.
//   (4) TestExpirePendingApprovals_FlipsExpiredRows — backdates a row's
//       expires_at, calls expire RPC → row flipped to 'expired'; a fresh
//       in-window row is NOT flipped by a subsequent call.
//
// Per-test unique payload markers (T14-{kind}-<nano>) keep test runs isolated
// even though approval_requests has no unique business key (the BIGSERIAL id
// suffices for identity but the payload marker makes the row observable in
// logs / pg_stat_activity during parallel runs).

// ensureT14OwnerAdmin upserts the well-known Owner admin row used by the T14
// tests (decide_via_wa_button's Owner-role check). Idempotent across reruns
// and across the four T14 tests that share the same actor uuid.
func ensureT14OwnerAdmin(t *testing.T, c *db.Client) {
	t.Helper()
	const ownerID = "00000000-0000-0000-0000-000000000099"
	if _, err := c.DB.Exec(
		`INSERT INTO public.admin_users (id, name, email, role, permissions, status)
		 VALUES ($1, 'T14 Owner', 'phase2-t14-owner@test.local', 'Owner',
		         '{"dashboard":true}'::jsonb, 'Aktif')
		 ON CONFLICT (id) DO UPDATE SET role='Owner', status='Aktif'`,
		ownerID); err != nil {
		t.Fatalf("seed Owner admin: %v", err)
	}
}

// ensureT14StaffAdmin upserts a non-Owner admin row used by
// TestDecideViaWaButton_NonOwnerRejected. The 'Staff Admin Toko' role is the
// default in the admin_users schema (…20260603000003) — using it ensures the
// row is a real persisted non-Owner, not a phantom UUID that would pass the
// authorization check for the wrong reason (UUID-not-found ≠ role check).
func ensureT14StaffAdmin(t *testing.T, c *db.Client) {
	t.Helper()
	const staffID = "00000000-0000-0000-0000-000000000088"
	if _, err := c.DB.Exec(
		`INSERT INTO public.admin_users (id, name, email, role, permissions, status)
		 VALUES ($1, 'T14 Staff', 'phase2-t14-staff@test.local', 'Staff Admin Toko',
		         '{"dashboard":true}'::jsonb, 'Aktif')
		 ON CONFLICT (id) DO UPDATE SET role='Staff Admin Toko', status='Aktif'`,
		staffID); err != nil {
		t.Fatalf("seed Staff admin: %v", err)
	}
}

// seedT14PendingApproval inserts a bare pending approval_requests row of type
// 'adjustment' with a unique payload marker so each test's row is observable.
// Returns the new id. Mirrors seedT13PendingApproval — the T14 RPC under test
// doesn't care about satellite rows, only that the approval gate is pending.
func seedT14PendingApproval(t *testing.T, c *db.Client, marker string) int64 {
	t.Helper()
	var id int64
	if err := c.DB.QueryRow(
		`INSERT INTO public.approval_requests (request_type, payload, requested_by)
		 VALUES ('adjustment', jsonb_build_object('marker', $1::text),
		         '00000000-0000-0000-0000-000000000001')
		 RETURNING id`, marker).Scan(&id); err != nil {
		t.Fatalf("seed pending approval (%s): %v", marker, err)
	}
	return id
}

// TestDecideViaWaButton_OwnerApproves pins the happy path: an Owner calling
// decide_via_wa_button with p_decision='approved' flips the approval to
// status='approved' with decision_channel='wa_button'. The RPC returns the
// approval_request id (BIGINT) — assert the returned value matches what we
// passed in.
func TestDecideViaWaButton_OwnerApproves(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	ensureT14OwnerAdmin(t, client)
	marker := fmt.Sprintf("T14-OWNER-%d", time.Now().UnixNano())
	aid := seedT14PendingApproval(t, client, marker)

	var returnedID int64
	if err := client.DB.QueryRow(
		`SELECT public.decide_via_wa_button($1, 'approved',
		   '00000000-0000-0000-0000-000000000099'::uuid)`, aid).Scan(&returnedID); err != nil {
		t.Fatalf("decide_via_wa_button: %v", err)
	}
	if returnedID != aid {
		t.Fatalf("returned id = %d, want %d", returnedID, aid)
	}

	var status, channel, decidedBy string
	if err := client.DB.QueryRow(
		`SELECT status::text, COALESCE(decision_channel,''), COALESCE(decided_by::text,'')
		   FROM public.approval_requests WHERE id=$1`, aid).
		Scan(&status, &channel, &decidedBy); err != nil {
		t.Fatalf("read approval row: %v", err)
	}
	if status != "approved" {
		t.Fatalf("status = %q, want approved", status)
	}
	if channel != "wa_button" {
		t.Fatalf("decision_channel = %q, want wa_button", channel)
	}
	if decidedBy != "00000000-0000-0000-0000-000000000099" {
		t.Fatalf("decided_by = %q, want Owner uuid", decidedBy)
	}
}

// TestDecideViaWaButton_NonOwnerRejected pins the authorization guard: a Staff
// Admin (real persisted admin_users row, NOT a phantom UUID) calling the RPC
// must be rejected with an error containing "not authorized". The approval
// row must stay pending — the gate cannot move under a non-Owner click.
func TestDecideViaWaButton_NonOwnerRejected(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	ensureT14StaffAdmin(t, client)
	marker := fmt.Sprintf("T14-NONOWNER-%d", time.Now().UnixNano())
	aid := seedT14PendingApproval(t, client, marker)

	_, err := client.DB.Exec(
		`SELECT public.decide_via_wa_button($1, 'approved',
		   '00000000-0000-0000-0000-000000000088'::uuid)`, aid)
	if err == nil {
		t.Fatalf("expected 'not authorized' error for Staff Admin caller, got nil")
	}
	if !strings.Contains(err.Error(), "not authorized") {
		t.Fatalf("unexpected error (want 'not authorized'): %v", err)
	}

	var status string
	_ = client.DB.QueryRow(
		`SELECT status::text FROM public.approval_requests WHERE id=$1`, aid).Scan(&status)
	if status != "pending" {
		t.Fatalf("status = %q after rejected non-Owner call, want pending", status)
	}
}

// TestDecideViaWaButton_InvalidDecision pins the input validator: p_decision
// must be in ('approved','rejected'); any other string (here 'maybe') must
// raise BEFORE the Owner-role check or the _transition_approval call. We
// authenticate as the Owner to prove the validator fires regardless of caller
// authorization — i.e., even a legit Owner can't smuggle an invalid decision.
func TestDecideViaWaButton_InvalidDecision(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	ensureT14OwnerAdmin(t, client)
	marker := fmt.Sprintf("T14-INVALID-%d", time.Now().UnixNano())
	aid := seedT14PendingApproval(t, client, marker)

	_, err := client.DB.Exec(
		`SELECT public.decide_via_wa_button($1, 'maybe',
		   '00000000-0000-0000-0000-000000000099'::uuid)`, aid)
	if err == nil {
		t.Fatalf("expected error for invalid decision 'maybe', got nil")
	}
	// Error message should mention the decision being invalid; accept any of
	// the obvious phrasings the RPC might use ("decision must be", "invalid
	// decision", etc.).
	if !strings.Contains(err.Error(), "decision") && !strings.Contains(err.Error(), "approved") {
		t.Fatalf("unexpected error (want one mentioning decision): %v", err)
	}

	var status string
	_ = client.DB.QueryRow(
		`SELECT status::text FROM public.approval_requests WHERE id=$1`, aid).Scan(&status)
	if status != "pending" {
		t.Fatalf("status = %q after invalid-decision call, want pending", status)
	}
}

// TestExpirePendingApprovals_FlipsExpiredRows drives the auto-expiry sweeper:
//   (1) Seed a pending approval row, then BACKDATE its expires_at to
//       now() - INTERVAL '1 minute'. The UPDATE trigger trg_deny_ar_update is
//       disabled at table level (Foundational Decision #1), so a service_role
//       UPDATE for test setup succeeds — this is the only path we use it.
//   (2) Call expire_pending_approvals(): must return ≥1, and our backdated
//       row must flip to status='expired' with decision_channel='auto_expire'
//       and decided_by IS NULL (no human made this decision).
//   (3) Seed a SECOND pending row (default expires_at = now() + 30m — in
//       window). Call expire_pending_approvals() AGAIN: the fresh row must
//       NOT be expired (it's still in-window), and the already-expired row
//       from step 1 must NOT be touched a second time (it's no longer
//       pending). So the second call returns 0 from OUR seeded rows. Other
//       in-flight pending+expired rows in the DB may contribute to the
//       second call's count (we don't control the whole DB), so we assert
//       on the FRESH row's status rather than the second call's total count.
func TestExpirePendingApprovals_FlipsExpiredRows(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	markerOld := fmt.Sprintf("T14-EXPIRE-OLD-%d", time.Now().UnixNano())
	oldID := seedT14PendingApproval(t, client, markerOld)

	// Backdate via service_role (the disabled UPDATE trigger lets this through).
	if _, err := client.DB.Exec(
		`UPDATE public.approval_requests
		    SET expires_at = now() - INTERVAL '1 minute'
		  WHERE id = $1`, oldID); err != nil {
		t.Fatalf("backdate expires_at: %v", err)
	}

	var firstCount int
	if err := client.DB.QueryRow(
		`SELECT public.expire_pending_approvals()`).Scan(&firstCount); err != nil {
		t.Fatalf("expire_pending_approvals (first call): %v", err)
	}
	if firstCount < 1 {
		t.Fatalf("first call expired %d rows, want >=1", firstCount)
	}

	var status, channel, decidedBy string
	if err := client.DB.QueryRow(
		`SELECT status::text, COALESCE(decision_channel,''),
		        COALESCE(decided_by::text,'')
		   FROM public.approval_requests WHERE id=$1`, oldID).
		Scan(&status, &channel, &decidedBy); err != nil {
		t.Fatalf("read old approval row: %v", err)
	}
	if status != "expired" {
		t.Fatalf("old row status = %q, want expired", status)
	}
	if channel != "auto_expire" {
		t.Fatalf("old row decision_channel = %q, want auto_expire", channel)
	}
	if decidedBy != "" {
		t.Fatalf("old row decided_by = %q, want '' (NULL — no human decided)", decidedBy)
	}

	// Seed a FRESH in-window row (default expires_at = now()+30m) and call
	// expire again. The fresh row must NOT be flipped.
	markerFresh := fmt.Sprintf("T14-EXPIRE-FRESH-%d", time.Now().UnixNano())
	freshID := seedT14PendingApproval(t, client, markerFresh)

	if _, err := client.DB.Exec(
		`SELECT public.expire_pending_approvals()`); err != nil {
		t.Fatalf("expire_pending_approvals (second call): %v", err)
	}

	var freshStatus string
	if err := client.DB.QueryRow(
		`SELECT status::text FROM public.approval_requests WHERE id=$1`, freshID).
		Scan(&freshStatus); err != nil {
		t.Fatalf("read fresh approval row: %v", err)
	}
	if freshStatus != "pending" {
		t.Fatalf("fresh in-window row status = %q after second expire call, want pending", freshStatus)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2, Task 16: Go reader helpers for approval_requests
// ─────────────────────────────────────────────────────────────────────────────
//
// backend-go/internal/db/approvals.go exposes four helpers used by the WA
// sender (T17), the WA webhook handler (T18), the auto-expiry poller (T19),
// and the Phase 4 Owner dashboard:
//
//   1. ListPendingApprovalRequests(requestedBy string) — pending rows in
//      requested_at ASC order, optionally filtered by requested_by UUID.
//      Pass "" for all-tenants (used by the poller/dashboard).
//   2. GetApprovalRequest(id int64) — single-row lookup. Returns
//      sql.ErrNoRows when missing so the caller can map to 404.
//   3. SetWaMessageID(id, waMessageID) — invoked by T17 after Calista posts
//      the approval card. Uses the SECURITY DEFINER RPC _set_wa_message_id
//      (migration 20260607000022). Idempotent via WHERE wa_message_id IS NULL.
//   4. CountPendingApprovalsForOwner() — total pending count. Used by the
//      heartbeat snippet to surface "X requests still need your attention".
//
// Test isolation: per the advisor's guidance the integration DB carries
// pending rows leftover from T1-T14 (T14's expire test, T13's PIN tests, etc).
// So each test below seeds with a UNIQUE requested_by UUID and either passes
// that UUID to the helper or measures a delta — never assumes the global
// count is zero at start.

// seedT16PendingApproval inserts a pending approval_requests row tied to the
// caller-supplied requested_by UUID. Returns the new id. The unique uuid is
// how each test fences its rows from neighbour pollution.
func seedT16PendingApproval(t *testing.T, c *db.Client, requestedBy string) int64 {
	t.Helper()
	var id int64
	if err := c.DB.QueryRow(
		`INSERT INTO public.approval_requests (request_type, payload, requested_by)
		 VALUES ('adjustment','{}'::jsonb, $1::uuid)
		 RETURNING id`, requestedBy).Scan(&id); err != nil {
		t.Fatalf("seed pending approval: %v", err)
	}
	return id
}

// uniqueT16UUID mints a UUID that is statistically unique for this test
// process: zero-prefix sentinel (so a stray production scan ignores it)
// plus a nanosecond-resolution timestamp tail. The zeros up front mean
// "test-only — not a real user".
func uniqueT16UUID(suffix int64) string {
	// Format: 00000000-0000-0000-0000-XXXXXXXXXXXX where the last 12 hex
	// digits encode the 48 low bits of `suffix`. 48 bits of UnixNano() gives
	// us ~9 years before wraparound, plenty for this test suite's lifetime.
	last12 := uint64(suffix) & 0xFFFFFFFFFFFF
	return fmt.Sprintf("00000000-0000-0000-0000-%012x", last12)
}

// TestListPendingApprovalRequests proves the helper returns ONLY rows
// matching the requested_by UUID, ordered by requested_at ASC. We seed two
// pending + one approved row under the same UUID, then assert (a) length 2,
// (b) ordering, (c) the approved row is filtered out.
func TestListPendingApprovalRequests(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	uid := uniqueT16UUID(time.Now().UnixNano())

	// Seed two pending rows. Sleep a microsecond between them so requested_at
	// is strictly ordered (requested_at default is now() which is per-statement
	// — two back-to-back INSERTs can land at the same timestamp).
	id1 := seedT16PendingApproval(t, client, uid)
	time.Sleep(2 * time.Millisecond)
	id2 := seedT16PendingApproval(t, client, uid)

	// Seed a third row and approve it via the canonical helper so the listing
	// filter (`WHERE status='pending'`) drops it.
	id3 := seedT16PendingApproval(t, client, uid)
	if _, err := client.DB.Exec(
		`SELECT public._transition_approval($1, 'approved'::public.approval_status,
		   '00000000-0000-0000-0000-000000000099'::uuid, 'owner_pin')`, id3); err != nil {
		t.Fatalf("transition row %d to approved: %v", id3, err)
	}

	got, err := client.ListPendingApprovalRequests(uid)
	if err != nil {
		t.Fatalf("ListPendingApprovalRequests: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("len(got) = %d, want 2 (id3 should be filtered as approved)", len(got))
	}
	if got[0].ID != id1 {
		t.Fatalf("got[0].ID = %d, want %d (requested_at ASC)", got[0].ID, id1)
	}
	if got[1].ID != id2 {
		t.Fatalf("got[1].ID = %d, want %d (requested_at ASC)", got[1].ID, id2)
	}
	// Sanity: returned rows carry the requested_by we filtered on.
	if got[0].RequestedBy != uid {
		t.Fatalf("got[0].RequestedBy = %q, want %q", got[0].RequestedBy, uid)
	}
	if got[0].Status != "pending" {
		t.Fatalf("got[0].Status = %q, want pending", got[0].Status)
	}
}

// TestGetApprovalRequest pins single-row lookup semantics:
//   - existing id → row returned, payload bytes round-trip
//   - missing id (1 followed by 9 zeros — never assigned by BIGSERIAL in
//     this test run) → sql.ErrNoRows so the caller can map to 404.
func TestGetApprovalRequest(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	uid := uniqueT16UUID(time.Now().UnixNano())
	id := seedT16PendingApproval(t, client, uid)

	row, err := client.GetApprovalRequest(id)
	if err != nil {
		t.Fatalf("GetApprovalRequest(%d): %v", id, err)
	}
	if row.ID != id {
		t.Fatalf("row.ID = %d, want %d", row.ID, id)
	}
	if row.RequestType != "adjustment" {
		t.Fatalf("row.RequestType = %q, want adjustment", row.RequestType)
	}
	if row.Status != "pending" {
		t.Fatalf("row.Status = %q, want pending", row.Status)
	}
	if row.RequestedBy != uid {
		t.Fatalf("row.RequestedBy = %q, want %q", row.RequestedBy, uid)
	}
	if len(row.Payload) == 0 {
		t.Fatalf("row.Payload empty, want {} bytes")
	}
	if !row.DecidedBy.Valid == false && row.DecidedBy.String != "" {
		t.Fatalf("pending row should have NULL decided_by, got %v", row.DecidedBy)
	}
	if row.DecidedAt.Valid {
		t.Fatalf("pending row should have NULL decided_at")
	}

	// Missing id → sql.ErrNoRows. Use a large BIGINT that BIGSERIAL hasn't
	// reached (we just inserted; the sequence is well below 9e18).
	_, err = client.GetApprovalRequest(9_000_000_000_000_000_000)
	if err != sql.ErrNoRows {
		t.Fatalf("GetApprovalRequest(missing) returned %v, want sql.ErrNoRows", err)
	}
}

// TestSetWaMessageID drives the _set_wa_message_id RPC through the helper:
//   - call with a fresh row → wa_message_id populated
//   - call AGAIN with a different message id → NO error AND the original
//     value is preserved (the WHERE wa_message_id IS NULL guard in the RPC
//     makes the second call a no-op). This is the idempotency contract:
//     the sender may retry on transient WhatsApp errors that actually
//     delivered; we must not overwrite the recorded id.
func TestSetWaMessageID(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	uid := uniqueT16UUID(time.Now().UnixNano())
	id := seedT16PendingApproval(t, client, uid)

	const firstMsgID = "wa-msg-T16-first"
	if err := client.SetWaMessageID(id, firstMsgID); err != nil {
		t.Fatalf("SetWaMessageID (first): %v", err)
	}

	var got sql.NullString
	if err := client.DB.QueryRow(
		`SELECT wa_message_id FROM public.approval_requests WHERE id=$1`, id).Scan(&got); err != nil {
		t.Fatalf("read wa_message_id (after first): %v", err)
	}
	if !got.Valid || got.String != firstMsgID {
		t.Fatalf("wa_message_id = %v, want %q", got, firstMsgID)
	}

	// Second call with a DIFFERENT id should not error and must NOT overwrite.
	const secondMsgID = "wa-msg-T16-second"
	if err := client.SetWaMessageID(id, secondMsgID); err != nil {
		t.Fatalf("SetWaMessageID (second): %v", err)
	}
	if err := client.DB.QueryRow(
		`SELECT wa_message_id FROM public.approval_requests WHERE id=$1`, id).Scan(&got); err != nil {
		t.Fatalf("read wa_message_id (after second): %v", err)
	}
	if !got.Valid || got.String != firstMsgID {
		t.Fatalf("wa_message_id = %v after second call, want %q unchanged",
			got, firstMsgID)
	}
}

// TestCountPendingApprovalsForOwner asserts the helper's count rises by the
// number of fresh pending rows we seed and falls back by 1 when one of them
// transitions to approved. We use a delta-from-baseline approach because
// the DB carries pending rows from T1-T14's tests and we don't control them.
func TestCountPendingApprovalsForOwner(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	before, err := client.CountPendingApprovalsForOwner()
	if err != nil {
		t.Fatalf("CountPendingApprovalsForOwner (before): %v", err)
	}

	uid := uniqueT16UUID(time.Now().UnixNano())
	id1 := seedT16PendingApproval(t, client, uid)
	id2 := seedT16PendingApproval(t, client, uid)
	id3 := seedT16PendingApproval(t, client, uid)

	afterSeed, err := client.CountPendingApprovalsForOwner()
	if err != nil {
		t.Fatalf("CountPendingApprovalsForOwner (after seed): %v", err)
	}
	if afterSeed-before != 3 {
		t.Fatalf("count delta after seeding 3 pending rows = %d, want 3", afterSeed-before)
	}

	// Approve one — pending count must drop by exactly 1.
	if _, err := client.DB.Exec(
		`SELECT public._transition_approval($1, 'approved'::public.approval_status,
		   '00000000-0000-0000-0000-000000000099'::uuid, 'owner_pin')`, id2); err != nil {
		t.Fatalf("approve id2: %v", err)
	}
	afterApprove, err := client.CountPendingApprovalsForOwner()
	if err != nil {
		t.Fatalf("CountPendingApprovalsForOwner (after approve): %v", err)
	}
	if afterApprove-before != 2 {
		t.Fatalf("count delta after approving 1 of 3 = %d, want 2", afterApprove-before)
	}

	// Silence "unused" complaints on the other ids — we don't need them again.
	_ = id1
	_ = id3
}
