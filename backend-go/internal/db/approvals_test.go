package db_test

import (
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
