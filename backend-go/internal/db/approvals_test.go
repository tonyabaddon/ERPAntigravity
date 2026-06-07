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
