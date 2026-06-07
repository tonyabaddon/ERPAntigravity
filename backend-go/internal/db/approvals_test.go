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
