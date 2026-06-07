package db_test

import (
	"strings"
	"testing"

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
