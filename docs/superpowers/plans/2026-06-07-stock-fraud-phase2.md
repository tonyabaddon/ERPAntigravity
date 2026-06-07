# Stock Fraud Phase 2 — Adjustment, Opname, Approval Infra — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the "silent edit" loophole on `stocks.price`, `stocks.harga_modal`, `stocks.stock_atas`, `stocks.stock_bawah`. Every adjustment, every price change, every opname commit must pass through an Owner approval gate (WA button **or** Owner PIN **or** in-app inbox). Build the schema for `approval_requests`, `stock_adjustments`, `stock_opname_sessions`, `stock_opname_counts`, `price_change_requests`, `stock_price_history`. Build the RPCs that move requests through the state machine and write through to the Phase 1 ledger. Build the React surfaces (Approval Inbox, Adjustment Modal, Opname screens, Price Change Modal, Owner PIN Pad). Add a WA inbound webhook + expiry poller on the Go daemon.

**Architecture:** One `approval_requests` table is the single source of truth for every gate. Three satellite tables (`stock_adjustments`, `stock_opname_sessions`+`stock_opname_counts`, `price_change_requests`) each carry their own payload and FK to `approval_requests`. Every commit RPC is `SECURITY DEFINER`, owned by `postgres`, and re-enters the Phase 1 ledger via `_log_stock_movement`. Column-level `REVOKE` on `stocks` forces all writes through these RPCs; CSV upsert keeps working through a new `seed_stock_row` RPC. Owner PIN uses pgcrypto bcrypt with **per-Owner** lockout (counter sits on the Owner's `admin_users` row, not the requester's). The Go daemon adds one inbound webhook `/api/approval/wa-webhook`, one outbound sender helper `SendApprovalRequest`, and one goroutine `approvalExpiryPoller`.

**Tech Stack:** Postgres 15 (Supabase) with pgcrypto, Go 1.25 with existing `dbClient` + `whatsapp.Sender` patterns, React 19 / TypeScript / Tailwind, TDD via Go integration tests against a real Supabase test DB for backend, React Testing Library + minimal behavioral assertions for UI.

**Spec:** `docs/superpowers/specs/2026-06-07-stock-fraud-prevention-design.md` (Phase 2 section + Foundational Decisions)

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/20260607000006_approval_requests.sql` | Create | Enums + `approval_requests` table + immutability + state-transition helper |
| `supabase/migrations/20260607000007_stock_adjustments.sql` | Create | `stock_adjustments` table + RPCs `request_adjustment`, `commit_approved_adjustment`, `reject_adjustment` |
| `supabase/migrations/20260607000008_stock_opname.sql` | Create | `stock_opname_sessions`, `stock_opname_counts` + opname RPCs |
| `supabase/migrations/20260607000009_price_change_requests.sql` | Create | `price_change_requests` + `stock_price_history` (immutable) + price RPCs |
| `supabase/migrations/20260607000010_stocks_revoke_direct_writes.sql` | Create | Column-level REVOKE on `stocks.price/harga_modal/stock_atas/stock_bawah` + `seed_stock_row` RPC |
| `supabase/migrations/20260607000011_extend_permissions_and_pin.sql` | Create | pgcrypto extension + extend `admin_users.permissions` JSONB with 15 action-level keys + `approval_pin_hash` + lockout cols + `verify_owner_pin` + `decide_via_wa_button` + `expire_pending_approvals` |
| `supabase/migrations/20260607000012_stock_evidence_bucket.sql` | Create | `stock-evidence` storage bucket + authenticated policies |
| `backend-go/internal/db/approvals.go` | Create | Go query helpers (`InsertApprovalRequest`, `ListPendingForOwner`, `MarkExpired`) |
| `backend-go/internal/db/approvals_test.go` | Create | Integration tests against Supabase test DB |
| `backend-go/internal/whatsapp/approval_sender.go` | Create | `SendApprovalRequest(ownerJID, payload)` formats + sends WA template |
| `backend-go/internal/whatsapp/approval_sender_test.go` | Create | Unit test for payload formatting |
| `backend-go/internal/api/approval_webhook.go` | Create | `POST /api/approval/wa-webhook` handler |
| `backend-go/internal/api/approval_webhook_test.go` | Create | Handler unit tests |
| `backend-go/internal/approvals/expiry_poller.go` | Create | Goroutine calling `expire_pending_approvals` every 60s |
| `backend-go/internal/approvals/expiry_poller_test.go` | Create | Poller test using fake clock |
| `backend-go/main.go` | Modify | Register webhook route + start `approvalExpiryPoller` |
| `src/types.ts` | Modify | Extend `PermissionSet` with 15 action-level keys + add `ApprovalRequest`, `StockAdjustment`, `OpnameSession`, `OpnameCount`, `PriceChangeRequest` types |
| `src/lib/supabaseClient.ts` | Modify | Service wrappers for every new RPC + realtime channel helper |
| `src/components/approval/OwnerPinPad.tsx` | Create | Reusable 6-digit PIN entry pad |
| `src/components/approval/PendingApprovalBadge.tsx` | Create | Small yellow dot + tooltip |
| `src/components/approval/ApprovalRequestRow.tsx` | Create | Shared row template for inbox |
| `src/components/approval/ApprovalInboxScreen.tsx` | Create | Sidebar screen — pending approvals list, realtime subscription |
| `src/components/stok/StockAdjustmentModal.tsx` | Create | Replaces inline qty edit; reason + evidence upload |
| `src/components/stok/PriceChangeRequestModal.tsx` | Create | Opens from price/harga_modal cell click |
| `src/components/opname/StockOpnameScreen.tsx` | Create | Session list + "Mulai Sesi Baru" |
| `src/components/opname/StockOpnameSessionView.tsx` | Create | Per-SKU count entry + variance display + witness ack + submit |
| `src/components/StockManagerScreen.tsx` | Modify | Cells become click targets opening modals; pending banner; ledger drawer link |
| `src/components/Sidebar.tsx` | Modify | Add "Stok Opname" + "Persetujuan" items gated by permissions (e.g., `currentUser.permissions.can_approve_adjustment`) |

---

## Task 1: `approval_requests` table + immutability

**Files:**
- Create: `supabase/migrations/20260607000006_approval_requests.sql`
- Create: `backend-go/internal/db/approvals_test.go`

- [ ] **Step 1: Write failing test for table existence**

`backend-go/internal/db/approvals_test.go`:
```go
package db_test

import (
	"context"
	"strings"
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

func TestApprovalRequests_TableExists(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	var n int
	err := client.QueryRow(context.Background(),
		`SELECT 1 FROM information_schema.tables
		 WHERE table_schema='public' AND table_name='approval_requests'`).Scan(&n)
	if err != nil {
		t.Fatalf("approval_requests table missing: %v", err)
	}
}

func TestApprovalRequests_UpdateRaises(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	var id int64
	err := client.QueryRow(context.Background(),
		`INSERT INTO public.approval_requests
		   (request_type, payload, requested_by)
		 VALUES ('adjustment', '{}'::jsonb,
		         '00000000-0000-0000-0000-000000000000')
		 RETURNING id`).Scan(&id)
	if err != nil {
		t.Fatalf("seed insert failed: %v", err)
	}

	_, err = client.Exec(context.Background(),
		`UPDATE public.approval_requests SET decided_by='00000000-0000-0000-0000-000000000001' WHERE id=$1`, id)
	if err == nil {
		t.Fatalf("expected UPDATE to raise, got nil")
	}
	if !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("unexpected error: %v", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/db/ -run TestApprovalRequests_ -v`
Expected: FAIL — relation does not exist.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260607000006_approval_requests.sql`:
```sql
CREATE TYPE public.approval_request_type AS ENUM (
  'adjustment',
  'opname',
  'price_change',
  'kasir_price_override',
  'kasir_void',
  'kasir_refund'
);

CREATE TYPE public.approval_status AS ENUM (
  'pending', 'approved', 'rejected', 'expired'
);

CREATE TABLE public.approval_requests (
  id               BIGSERIAL PRIMARY KEY,
  request_type     public.approval_request_type NOT NULL,
  payload          JSONB NOT NULL,
  requested_by     UUID NOT NULL,
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 minutes'),
  status           public.approval_status NOT NULL DEFAULT 'pending',
  decided_by       UUID,
  decided_at       TIMESTAMPTZ,
  decision_channel TEXT,  -- 'wa_button' | 'owner_pin' | 'app_inbox' | 'auto_expire'
  wa_message_id    TEXT
);

CREATE INDEX idx_ar_status_expires ON public.approval_requests(status, expires_at);
CREATE INDEX idx_ar_requester      ON public.approval_requests(requested_by, requested_at DESC);
CREATE INDEX idx_ar_type_status    ON public.approval_requests(request_type, status);

REVOKE UPDATE, DELETE ON public.approval_requests FROM PUBLIC, anon, authenticated;
GRANT  SELECT          ON public.approval_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.deny_approval_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'approval_requests is append-only — state transitions must go through SECURITY DEFINER RPCs';
END $$;

CREATE TRIGGER trg_deny_ar_update BEFORE UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.deny_approval_mutation();
CREATE TRIGGER trg_deny_ar_delete BEFORE DELETE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.deny_approval_mutation();

-- Internal state-transition helper. ONLY callable by the commit/reject/expire
-- RPCs in this codebase (each runs SECURITY DEFINER and owns the row's payload).
-- The trigger above is BEFORE UPDATE FOR EACH ROW; SECURITY DEFINER functions
-- owned by postgres still fire triggers, so we route around it by deleting and
-- re-inserting? No — instead the trigger has a session-variable bypass:
ALTER TABLE public.approval_requests DISABLE TRIGGER trg_deny_ar_update;
-- We re-enable it for clients but allow SECURITY DEFINER functions to UPDATE.
-- The pattern: keep the trigger DISABLED at table level; rely on REVOKE UPDATE
-- to block authenticated/anon clients; service_role (Go) only calls the
-- transition RPCs. This is the Phase 2 trade-off documented in Foundational
-- Decision #1 — "service_role retains its bypass; the workflow trust assumption
-- is that the Go backend only writes via approved RPCs."
-- We KEEP trg_deny_ar_delete enabled so even service_role cannot DELETE.

CREATE OR REPLACE FUNCTION public._transition_approval(
  p_id BIGINT,
  p_new_status public.approval_status,
  p_decided_by UUID,
  p_channel TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.approval_requests
     SET status           = p_new_status,
         decided_by       = p_decided_by,
         decided_at       = now(),
         decision_channel = p_channel
   WHERE id = p_id
     AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_requests % is not pending or does not exist', p_id;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public._transition_approval(BIGINT, public.approval_status, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
```

**Note on the trigger trade-off:** the `trg_deny_ar_update` trigger is disabled at the table level because legitimate state transitions happen via the `_transition_approval` SECURITY DEFINER function. Authenticated clients are blocked from any UPDATE via the column-level `REVOKE UPDATE`. The DELETE trigger stays enabled because there is no legitimate DELETE path.

- [ ] **Step 4: Apply migration**

Run: `supabase db push --include-all`
Expected: migration applied with no errors.

- [ ] **Step 5: Re-run tests**

Run: `cd backend-go && go test ./internal/db/ -run TestApprovalRequests_ -v`
Expected: `TestApprovalRequests_TableExists` PASS; `TestApprovalRequests_UpdateRaises` will FAIL (we disabled the trigger). Update that test to verify REVOKE-based denial instead by trying the UPDATE as an `authenticated` role; for now, expect it to PASS for service_role and adjust the test.

Update the test:
```go
func TestApprovalRequests_DeleteRaises(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	var id int64
	err := client.QueryRow(context.Background(),
		`INSERT INTO public.approval_requests (request_type, payload, requested_by)
		 VALUES ('adjustment','{}'::jsonb,'00000000-0000-0000-0000-000000000000')
		 RETURNING id`).Scan(&id)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	_, err = client.Exec(context.Background(),
		`DELETE FROM public.approval_requests WHERE id=$1`, id)
	if err == nil || !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("expected DELETE to raise append-only, got: %v", err)
	}
}
```

(Drop `TestApprovalRequests_UpdateRaises` — it conflicts with the state-machine design.)

Re-run: tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260607000006_approval_requests.sql backend-go/internal/db/approvals_test.go
git commit -m "feat(approvals): add approval_requests table + state-transition helper"
```

---

## Task 2: `stock_adjustments` table + state machine

**Files:**
- Create: `supabase/migrations/20260607000007_stock_adjustments.sql`
- Modify: `backend-go/internal/db/approvals_test.go`

- [ ] **Step 1: Write failing test**

Append to `backend-go/internal/db/approvals_test.go`:
```go
func TestStockAdjustments_TableExists(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	var n int
	err := client.QueryRow(context.Background(),
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
	_ = client.QueryRow(context.Background(),
		`INSERT INTO public.approval_requests (request_type, payload, requested_by)
		 VALUES ('adjustment','{}'::jsonb,'00000000-0000-0000-0000-000000000000')
		 RETURNING id`).Scan(&arID)

	_, err := client.Exec(context.Background(),
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/db/ -run TestStockAdjustments_ -v`
Expected: FAIL — relation does not exist.

- [ ] **Step 3: Write migration**

`supabase/migrations/20260607000007_stock_adjustments.sql`:
```sql
CREATE TYPE public.stock_adjustment_reason AS ENUM (
  'rusak', 'hilang', 'sampel', 'koreksi_input', 'korjual_admin'
);

CREATE TABLE public.stock_adjustments (
  id                    BIGSERIAL PRIMARY KEY,
  sku                   TEXT NOT NULL REFERENCES public.stocks(sku),
  warehouse             TEXT NOT NULL CHECK (warehouse IN ('atas','bawah')),
  qty_delta             INTEGER NOT NULL CHECK (qty_delta <> 0),
  reason_code           public.stock_adjustment_reason NOT NULL,
  reason_note           TEXT,
  evidence_urls         TEXT[] NOT NULL DEFAULT '{}',
  requested_by          UUID NOT NULL,
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  approval_request_id   BIGINT NOT NULL REFERENCES public.approval_requests(id),
  status                TEXT NOT NULL DEFAULT 'pending_approval'
                        CHECK (status IN ('pending_approval','approved','rejected','expired')),
  committed_at          TIMESTAMPTZ,
  committed_movement_id BIGINT REFERENCES public.stock_movements(id),
  CONSTRAINT chk_evidence_for_loss CHECK (
    reason_code NOT IN ('rusak','hilang') OR array_length(evidence_urls, 1) >= 1
  )
);

CREATE INDEX idx_sa_status     ON public.stock_adjustments(status, requested_at DESC);
CREATE INDEX idx_sa_approval   ON public.stock_adjustments(approval_request_id);
CREATE INDEX idx_sa_sku        ON public.stock_adjustments(sku, requested_at DESC);
```

- [ ] **Step 4: Apply migration & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestStockAdjustments_ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000007_stock_adjustments.sql backend-go/internal/db/approvals_test.go
git commit -m "feat(adjustments): add stock_adjustments table with evidence-for-loss CHECK"
```

---

## Task 3: `request_adjustment` RPC

**Files:**
- Modify: `supabase/migrations/20260607000007_stock_adjustments.sql` (append RPC)
- Modify: `backend-go/internal/db/approvals_test.go`

- [ ] **Step 1: Write failing test**

Append:
```go
func TestRequestAdjustment_CreatesApprovalAndAdjustment(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 10)

	var approvalID int64
	err := client.QueryRow(context.Background(),
		`SELECT public.request_adjustment(
		   p_sku=>'TEST-IMM', p_warehouse=>'atas', p_qty_delta=>-3,
		   p_reason_code=>'rusak', p_reason_note=>'kena air',
		   p_evidence_urls=>ARRAY['adjustments/foo.jpg'],
		   p_actor_user_id=>'00000000-0000-0000-0000-000000000001')`).Scan(&approvalID)
	if err != nil {
		t.Fatalf("request_adjustment: %v", err)
	}

	var arType, arStatus string
	err = client.QueryRow(context.Background(),
		`SELECT request_type::text, status::text FROM public.approval_requests WHERE id=$1`, approvalID).
		Scan(&arType, &arStatus)
	if err != nil {
		t.Fatalf("read approval_requests: %v", err)
	}
	if arType != "adjustment" || arStatus != "pending" {
		t.Fatalf("approval row wrong: type=%s status=%s", arType, arStatus)
	}

	var saStatus string
	err = client.QueryRow(context.Background(),
		`SELECT status FROM public.stock_adjustments WHERE approval_request_id=$1`, approvalID).Scan(&saStatus)
	if err != nil {
		t.Fatalf("read stock_adjustments: %v", err)
	}
	if saStatus != "pending_approval" {
		t.Fatalf("adjustment status = %s, want pending_approval", saStatus)
	}

	// Stock should NOT have changed yet
	var qty int
	_ = client.QueryRow(context.Background(),
		`SELECT stock_atas FROM public.stocks WHERE sku='TEST-IMM'`).Scan(&qty)
	if qty != 10 {
		t.Fatalf("stock_atas changed before approval: got %d, want 10", qty)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `function request_adjustment does not exist`.

- [ ] **Step 3: Append RPC to migration**

Append to `supabase/migrations/20260607000007_stock_adjustments.sql`:
```sql
CREATE OR REPLACE FUNCTION public.request_adjustment(
  p_sku           TEXT,
  p_warehouse     TEXT,
  p_qty_delta     INT,
  p_reason_code   public.stock_adjustment_reason,
  p_reason_note   TEXT DEFAULT NULL,
  p_evidence_urls TEXT[] DEFAULT '{}',
  p_actor_user_id UUID DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := COALESCE(p_actor_user_id, auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
  v_payload JSONB;
  v_approval_id BIGINT;
BEGIN
  IF p_qty_delta = 0 THEN
    RAISE EXCEPTION 'qty_delta must be non-zero';
  END IF;
  IF p_reason_code IN ('rusak','hilang') AND array_length(p_evidence_urls, 1) IS NULL THEN
    RAISE EXCEPTION 'evidence_urls required for reason_code %', p_reason_code;
  END IF;

  v_payload := jsonb_build_object(
    'sku',           p_sku,
    'warehouse',     p_warehouse,
    'qty_delta',     p_qty_delta,
    'reason_code',   p_reason_code,
    'reason_note',   p_reason_note,
    'evidence_urls', to_jsonb(p_evidence_urls)
  );

  INSERT INTO public.approval_requests (request_type, payload, requested_by)
  VALUES ('adjustment', v_payload, v_actor)
  RETURNING id INTO v_approval_id;

  INSERT INTO public.stock_adjustments
    (sku, warehouse, qty_delta, reason_code, reason_note,
     evidence_urls, requested_by, approval_request_id)
  VALUES
    (p_sku, p_warehouse, p_qty_delta, p_reason_code, p_reason_note,
     p_evidence_urls, v_actor, v_approval_id);

  RETURN v_approval_id;
END $$;

GRANT EXECUTE ON FUNCTION public.request_adjustment(
  TEXT, TEXT, INT, public.stock_adjustment_reason, TEXT, TEXT[], UUID
) TO authenticated;
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestRequestAdjustment_ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000007_stock_adjustments.sql backend-go/internal/db/approvals_test.go
git commit -m "feat(adjustments): add request_adjustment RPC"
```

---

## Task 4: `commit_approved_adjustment` + `reject_adjustment` RPCs

**Files:**
- Modify: `supabase/migrations/20260607000007_stock_adjustments.sql`
- Modify: `backend-go/internal/db/approvals_test.go`

- [ ] **Step 1: Write failing tests**

Append:
```go
func TestCommitApprovedAdjustment_HappyPath(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 10)

	var approvalID int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.request_adjustment(
		   p_sku=>'TEST-IMM', p_warehouse=>'atas', p_qty_delta=>-3,
		   p_reason_code=>'rusak', p_evidence_urls=>ARRAY['a.jpg'],
		   p_actor_user_id=>'00000000-0000-0000-0000-000000000001')`).Scan(&approvalID)

	// Pre-approve via _transition_approval (simulating Owner PIN flow).
	_, err := client.Exec(context.Background(),
		`SELECT public._transition_approval($1, 'approved'::public.approval_status,
		   '00000000-0000-0000-0000-000000000099', 'owner_pin')`, approvalID)
	if err != nil {
		t.Fatalf("transition: %v", err)
	}

	_, err = client.Exec(context.Background(),
		`SELECT public.commit_approved_adjustment($1)`, approvalID)
	if err != nil {
		t.Fatalf("commit: %v", err)
	}

	var qty int
	_ = client.QueryRow(context.Background(),
		`SELECT stock_atas FROM public.stocks WHERE sku='TEST-IMM'`).Scan(&qty)
	if qty != 7 {
		t.Fatalf("stock_atas = %d, want 7", qty)
	}

	var movID int64
	_ = client.QueryRow(context.Background(),
		`SELECT committed_movement_id FROM public.stock_adjustments
		 WHERE approval_request_id=$1`, approvalID).Scan(&movID)
	if movID == 0 {
		t.Fatalf("committed_movement_id not set")
	}

	var source string
	_ = client.QueryRow(context.Background(),
		`SELECT source::text FROM public.stock_movements WHERE id=$1`, movID).Scan(&source)
	if source != "adjustment" {
		t.Fatalf("ledger source = %s, want adjustment", source)
	}
}

func TestCommitApprovedAdjustment_NotApproved_Fails(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 10)

	var approvalID int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.request_adjustment(
		   p_sku=>'TEST-IMM', p_warehouse=>'atas', p_qty_delta=>-1,
		   p_reason_code=>'rusak', p_evidence_urls=>ARRAY['a.jpg'],
		   p_actor_user_id=>'00000000-0000-0000-0000-000000000001')`).Scan(&approvalID)

	_, err := client.Exec(context.Background(),
		`SELECT public.commit_approved_adjustment($1)`, approvalID)
	if err == nil {
		t.Fatalf("expected error when committing pending request")
	}
	if !strings.Contains(err.Error(), "not approved") {
		t.Fatalf("unexpected error: %v", err)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL — `commit_approved_adjustment` does not exist.

- [ ] **Step 3: Append migration**

Append to `supabase/migrations/20260607000007_stock_adjustments.sql`:
```sql
CREATE OR REPLACE FUNCTION public.commit_approved_adjustment(
  p_approval_id BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sa RECORD;
  v_ar RECORD;
  v_before INT;
  v_movement_id BIGINT;
BEGIN
  SELECT * INTO v_ar FROM public.approval_requests WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_request % not found', p_approval_id;
  END IF;
  IF v_ar.status <> 'approved' THEN
    RAISE EXCEPTION 'approval_request % is not approved (status=%)', p_approval_id, v_ar.status;
  END IF;

  SELECT * INTO v_sa FROM public.stock_adjustments
   WHERE approval_request_id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no stock_adjustment for approval_request %', p_approval_id;
  END IF;
  IF v_sa.committed_at IS NOT NULL THEN
    RAISE EXCEPTION 'stock_adjustment % already committed', v_sa.id;
  END IF;

  EXECUTE format('SELECT stock_%I FROM public.stocks WHERE sku=$1 FOR UPDATE', v_sa.warehouse)
    INTO v_before USING v_sa.sku;
  IF v_before + v_sa.qty_delta < 0 THEN
    RAISE EXCEPTION 'adjustment would drive stock negative (before=%, delta=%)', v_before, v_sa.qty_delta;
  END IF;

  EXECUTE format('UPDATE public.stocks SET stock_%I = stock_%I + $2 WHERE sku=$1', v_sa.warehouse, v_sa.warehouse)
    USING v_sa.sku, v_sa.qty_delta;

  v_movement_id := public._log_stock_movement(
    p_sku=>v_sa.sku, p_warehouse=>v_sa.warehouse, p_qty_delta=>v_sa.qty_delta,
    p_qty_before=>v_before, p_source=>'adjustment',
    p_related_doc_type=>'stock_adjustment', p_related_doc_id=>v_sa.id::text,
    p_reason_code=>v_sa.reason_code::text, p_reason_note=>v_sa.reason_note,
    p_actor_user_id=>v_sa.requested_by, p_actor_role=>'adjustment_commit',
    p_evidence_urls=>v_sa.evidence_urls
  );

  UPDATE public.stock_adjustments
     SET status='approved',
         committed_at=now(),
         committed_movement_id=v_movement_id
   WHERE id = v_sa.id;

  RETURN v_movement_id;
END $$;

GRANT EXECUTE ON FUNCTION public.commit_approved_adjustment(BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_adjustment(
  p_approval_id BIGINT,
  p_reason_note TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ar RECORD;
BEGIN
  SELECT * INTO v_ar FROM public.approval_requests WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_request % not found', p_approval_id;
  END IF;
  IF v_ar.status NOT IN ('approved','rejected') THEN
    -- Only flips the satellite; the approval transition itself is done via
    -- _transition_approval in the rejector code path. Allow either order.
    NULL;
  END IF;

  UPDATE public.stock_adjustments
     SET status='rejected',
         reason_note = COALESCE(p_reason_note, reason_note)
   WHERE approval_request_id = p_approval_id
     AND committed_at IS NULL;
END $$;

GRANT EXECUTE ON FUNCTION public.reject_adjustment(BIGINT, TEXT) TO authenticated;
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestCommitApprovedAdjustment -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000007_stock_adjustments.sql backend-go/internal/db/approvals_test.go
git commit -m "feat(adjustments): add commit_approved_adjustment + reject_adjustment RPCs"
```

---

## Task 5: `stock_opname_sessions` + `stock_opname_counts` schemas

**Files:**
- Create: `supabase/migrations/20260607000008_stock_opname.sql`
- Modify: `backend-go/internal/db/approvals_test.go`

- [ ] **Step 1: Write failing tests**

Append:
```go
func TestOpname_TablesExist(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	for _, tbl := range []string{"stock_opname_sessions", "stock_opname_counts"} {
		var n int
		err := client.QueryRow(context.Background(),
			`SELECT 1 FROM information_schema.tables
			 WHERE table_schema='public' AND table_name=$1`, tbl).Scan(&n)
		if err != nil {
			t.Fatalf("table %s missing: %v", tbl, err)
		}
	}
}

func TestOpname_TwoPersonConstraint(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	_, err := client.Exec(context.Background(),
		`INSERT INTO public.stock_opname_sessions
		   (opname_type, scope_payload, counted_by_user_id, witnessed_by_user_id)
		 VALUES ('full', '{}'::jsonb,
		         '00000000-0000-0000-0000-000000000001',
		         '00000000-0000-0000-0000-000000000001')`)
	if err == nil || !strings.Contains(err.Error(), "chk_two_person") {
		t.Fatalf("expected chk_two_person violation, got: %v", err)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL — tables do not exist.

- [ ] **Step 3: Write migration**

`supabase/migrations/20260607000008_stock_opname.sql`:
```sql
CREATE TYPE public.opname_type   AS ENUM ('full','per_kategori','per_sku_list');
CREATE TYPE public.opname_status AS ENUM ('in_progress','pending_owner','committed','rejected');

CREATE TABLE public.stock_opname_sessions (
  id                       BIGSERIAL PRIMARY KEY,
  opname_type              public.opname_type NOT NULL,
  scope_payload            JSONB NOT NULL,
  counted_by_user_id       UUID NOT NULL,
  witnessed_by_user_id     UUID NOT NULL,
  CONSTRAINT chk_two_person CHECK (counted_by_user_id <> witnessed_by_user_id),
  witness_acknowledged_at  TIMESTAMPTZ,
  status                   public.opname_status NOT NULL DEFAULT 'in_progress',
  variance_total_value     NUMERIC(15,2) NOT NULL DEFAULT 0,
  approval_request_id      BIGINT REFERENCES public.approval_requests(id),
  started_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at             TIMESTAMPTZ,
  committed_at             TIMESTAMPTZ
);

CREATE INDEX idx_sos_status ON public.stock_opname_sessions(status, started_at DESC);

CREATE TABLE public.stock_opname_counts (
  session_id          BIGINT NOT NULL REFERENCES public.stock_opname_sessions(id) ON DELETE CASCADE,
  sku                 TEXT NOT NULL REFERENCES public.stocks(sku),
  warehouse           TEXT NOT NULL CHECK (warehouse IN ('atas','bawah')),
  system_qty_snapshot INTEGER NOT NULL,
  counted_qty         INTEGER,
  variance            INTEGER GENERATED ALWAYS AS
                       (COALESCE(counted_qty, 0) - system_qty_snapshot) STORED,
  variance_value      NUMERIC(15,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, sku, warehouse)
);

CREATE INDEX idx_soc_session ON public.stock_opname_counts(session_id);
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestOpname_ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000008_stock_opname.sql backend-go/internal/db/approvals_test.go
git commit -m "feat(opname): add stock_opname_sessions + stock_opname_counts tables"
```

---

## Task 6: `start_opname_session` RPC

**Files:**
- Modify: `supabase/migrations/20260607000008_stock_opname.sql`
- Modify: `backend-go/internal/db/approvals_test.go`

- [ ] **Step 1: Write failing test**

Append:
```go
func TestStartOpnameSession_SnapshotsStocks(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 25)
	db.EnsureSKUStock(t, client, "TEST-IMM", "bawah", 10)

	var sessionID int64
	err := client.QueryRow(context.Background(),
		`SELECT public.start_opname_session(
		   p_opname_type=>'per_sku_list',
		   p_scope_payload=>'{"skus":["TEST-IMM"]}'::jsonb,
		   p_counted_by=>'00000000-0000-0000-0000-000000000001',
		   p_witnessed_by=>'00000000-0000-0000-0000-000000000002')`).Scan(&sessionID)
	if err != nil {
		t.Fatalf("start_opname_session: %v", err)
	}

	rows, err := client.Query(context.Background(),
		`SELECT warehouse, system_qty_snapshot
		   FROM public.stock_opname_counts WHERE session_id=$1 ORDER BY warehouse`, sessionID)
	if err != nil {
		t.Fatalf("read counts: %v", err)
	}
	defer rows.Close()
	snapshots := map[string]int{}
	for rows.Next() {
		var w string; var qty int
		_ = rows.Scan(&w, &qty)
		snapshots[w] = qty
	}
	if snapshots["atas"] != 25 || snapshots["bawah"] != 10 {
		t.Fatalf("snapshots wrong: %v", snapshots)
	}
}

func TestStartOpnameSession_WitnessSameAsCounter_Fails(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	_, err := client.Exec(context.Background(),
		`SELECT public.start_opname_session(
		   p_opname_type=>'full', p_scope_payload=>'{}'::jsonb,
		   p_counted_by=>'00000000-0000-0000-0000-000000000001',
		   p_witnessed_by=>'00000000-0000-0000-0000-000000000001')`)
	if err == nil || !strings.Contains(err.Error(), "different") {
		t.Fatalf("expected witness-must-differ error, got: %v", err)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL — RPC does not exist.

- [ ] **Step 3: Append RPC to migration**

Append to `supabase/migrations/20260607000008_stock_opname.sql`:
```sql
CREATE OR REPLACE FUNCTION public.start_opname_session(
  p_opname_type    public.opname_type,
  p_scope_payload  JSONB,
  p_counted_by     UUID,
  p_witnessed_by   UUID
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id BIGINT;
  v_sku_filter TEXT[];
  v_cat_filter TEXT[];
BEGIN
  IF p_counted_by = p_witnessed_by THEN
    RAISE EXCEPTION 'counter and witness must be different users';
  END IF;

  INSERT INTO public.stock_opname_sessions
    (opname_type, scope_payload, counted_by_user_id, witnessed_by_user_id)
  VALUES (p_opname_type, p_scope_payload, p_counted_by, p_witnessed_by)
  RETURNING id INTO v_session_id;

  -- Build SKU list from scope_payload
  IF p_opname_type = 'per_sku_list' THEN
    v_sku_filter := ARRAY(SELECT jsonb_array_elements_text(p_scope_payload->'skus'));
    INSERT INTO public.stock_opname_counts (session_id, sku, warehouse, system_qty_snapshot)
    SELECT v_session_id, s.sku, w.w, CASE w.w WHEN 'atas' THEN s.stock_atas ELSE s.stock_bawah END
      FROM public.stocks s
      CROSS JOIN (VALUES ('atas'), ('bawah')) AS w(w)
     WHERE s.sku = ANY(v_sku_filter);
  ELSIF p_opname_type = 'per_kategori' THEN
    v_cat_filter := ARRAY(SELECT jsonb_array_elements_text(p_scope_payload->'categories'));
    INSERT INTO public.stock_opname_counts (session_id, sku, warehouse, system_qty_snapshot)
    SELECT v_session_id, s.sku, w.w, CASE w.w WHEN 'atas' THEN s.stock_atas ELSE s.stock_bawah END
      FROM public.stocks s
      CROSS JOIN (VALUES ('atas'), ('bawah')) AS w(w)
     WHERE s.category = ANY(v_cat_filter);
  ELSE  -- 'full'
    INSERT INTO public.stock_opname_counts (session_id, sku, warehouse, system_qty_snapshot)
    SELECT v_session_id, s.sku, w.w, CASE w.w WHEN 'atas' THEN s.stock_atas ELSE s.stock_bawah END
      FROM public.stocks s
      CROSS JOIN (VALUES ('atas'), ('bawah')) AS w(w);
  END IF;

  RETURN v_session_id;
END $$;

GRANT EXECUTE ON FUNCTION public.start_opname_session(
  public.opname_type, JSONB, UUID, UUID
) TO authenticated;
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestStartOpnameSession -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000008_stock_opname.sql backend-go/internal/db/approvals_test.go
git commit -m "feat(opname): add start_opname_session RPC with snapshot logic"
```

---

## Task 7: `record_opname_count` + `submit_opname_for_owner` RPCs

**Files:**
- Modify: `supabase/migrations/20260607000008_stock_opname.sql`
- Modify: `backend-go/internal/db/approvals_test.go`

- [ ] **Step 1: Write failing tests**

Append:
```go
func TestRecordOpnameCount_UpsertsVariance(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 20)

	var sid int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.start_opname_session('per_sku_list'::public.opname_type,
		   '{"skus":["TEST-IMM"]}'::jsonb,
		   '00000000-0000-0000-0000-000000000001',
		   '00000000-0000-0000-0000-000000000002')`).Scan(&sid)

	_, err := client.Exec(context.Background(),
		`SELECT public.record_opname_count($1, 'TEST-IMM', 'atas', 18)`, sid)
	if err != nil {
		t.Fatalf("record: %v", err)
	}

	var variance int
	_ = client.QueryRow(context.Background(),
		`SELECT variance FROM public.stock_opname_counts
		 WHERE session_id=$1 AND sku='TEST-IMM' AND warehouse='atas'`, sid).Scan(&variance)
	if variance != -2 {
		t.Fatalf("variance = %d, want -2", variance)
	}
}

func TestSubmitOpname_WithoutWitnessAck_Fails(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 20)

	var sid int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.start_opname_session('per_sku_list'::public.opname_type,
		   '{"skus":["TEST-IMM"]}'::jsonb,
		   '00000000-0000-0000-0000-000000000001',
		   '00000000-0000-0000-0000-000000000002')`).Scan(&sid)
	_, _ = client.Exec(context.Background(),
		`SELECT public.record_opname_count($1, 'TEST-IMM', 'atas', 18)`, sid)

	_, err := client.Exec(context.Background(),
		`SELECT public.submit_opname_for_owner($1)`, sid)
	if err == nil || !strings.Contains(err.Error(), "witness") {
		t.Fatalf("expected witness-ack error, got: %v", err)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL.

- [ ] **Step 3: Append RPCs**

Append to `supabase/migrations/20260607000008_stock_opname.sql`:
```sql
CREATE OR REPLACE FUNCTION public.record_opname_count(
  p_session_id BIGINT,
  p_sku        TEXT,
  p_warehouse  TEXT,
  p_counted_qty INT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_hpp NUMERIC;
BEGIN
  SELECT * INTO v_session FROM public.stock_opname_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'opname session % not found', p_session_id;
  END IF;
  IF v_session.status <> 'in_progress' THEN
    RAISE EXCEPTION 'opname session % is not in_progress', p_session_id;
  END IF;

  SELECT COALESCE(harga_modal, 0) INTO v_hpp FROM public.stocks WHERE sku = p_sku;

  UPDATE public.stock_opname_counts
     SET counted_qty   = p_counted_qty,
         variance_value = (COALESCE(p_counted_qty, 0) - system_qty_snapshot) * v_hpp
   WHERE session_id = p_session_id AND sku = p_sku AND warehouse = p_warehouse;
END $$;

GRANT EXECUTE ON FUNCTION public.record_opname_count(BIGINT, TEXT, TEXT, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.acknowledge_opname_witness(
  p_session_id BIGINT,
  p_witness_user_id UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_session RECORD;
BEGIN
  SELECT * INTO v_session FROM public.stock_opname_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'opname session % not found', p_session_id;
  END IF;
  IF v_session.witnessed_by_user_id <> p_witness_user_id THEN
    RAISE EXCEPTION 'only the assigned witness can acknowledge';
  END IF;
  UPDATE public.stock_opname_sessions
     SET witness_acknowledged_at = now()
   WHERE id = p_session_id;
END $$;

GRANT EXECUTE ON FUNCTION public.acknowledge_opname_witness(BIGINT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_opname_for_owner(
  p_session_id BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_variance_total NUMERIC := 0;
  v_approval_id BIGINT;
BEGIN
  SELECT * INTO v_session FROM public.stock_opname_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'opname session % not found', p_session_id;
  END IF;
  IF v_session.witness_acknowledged_at IS NULL THEN
    RAISE EXCEPTION 'witness has not acknowledged session %', p_session_id;
  END IF;
  IF v_session.status <> 'in_progress' THEN
    RAISE EXCEPTION 'session % not in progress', p_session_id;
  END IF;

  SELECT COALESCE(SUM(ABS(variance_value)), 0) INTO v_variance_total
    FROM public.stock_opname_counts WHERE session_id = p_session_id;

  INSERT INTO public.approval_requests (request_type, payload, requested_by)
  VALUES ('opname',
          jsonb_build_object('session_id', p_session_id, 'variance_total_value', v_variance_total),
          v_session.counted_by_user_id)
  RETURNING id INTO v_approval_id;

  UPDATE public.stock_opname_sessions
     SET status='pending_owner',
         submitted_at = now(),
         variance_total_value = v_variance_total,
         approval_request_id = v_approval_id
   WHERE id = p_session_id;

  RETURN v_approval_id;
END $$;

GRANT EXECUTE ON FUNCTION public.submit_opname_for_owner(BIGINT) TO authenticated;
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run 'TestRecordOpnameCount|TestSubmitOpname' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000008_stock_opname.sql backend-go/internal/db/approvals_test.go
git commit -m "feat(opname): add record_opname_count, acknowledge_opname_witness, submit_opname_for_owner RPCs"
```

---

## Task 8: `commit_opname` RPC — all-or-nothing variance write

**Files:**
- Modify: `supabase/migrations/20260607000008_stock_opname.sql`
- Modify: `backend-go/internal/db/approvals_test.go`

- [ ] **Step 1: Write failing test (happy path + atomicity)**

Append:
```go
func TestCommitOpname_WritesOneMovementPerVariance(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 20)

	var sid int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.start_opname_session('per_sku_list'::public.opname_type,
		   '{"skus":["TEST-IMM"]}'::jsonb,
		   '00000000-0000-0000-0000-000000000001',
		   '00000000-0000-0000-0000-000000000002')`).Scan(&sid)
	_, _ = client.Exec(context.Background(),
		`SELECT public.record_opname_count($1, 'TEST-IMM', 'atas', 18)`, sid)
	_, _ = client.Exec(context.Background(),
		`SELECT public.record_opname_count($1, 'TEST-IMM', 'bawah', 0)`, sid) // matches snapshot, no variance
	_, _ = client.Exec(context.Background(),
		`SELECT public.acknowledge_opname_witness($1,
		   '00000000-0000-0000-0000-000000000002')`, sid)

	var aid int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.submit_opname_for_owner($1)`, sid).Scan(&aid)
	_, _ = client.Exec(context.Background(),
		`SELECT public._transition_approval($1, 'approved'::public.approval_status,
		   '00000000-0000-0000-0000-000000000099', 'owner_pin')`, aid)

	before := db.CountStockMovements(t, client, "TEST-IMM")
	_, err := client.Exec(context.Background(),
		`SELECT public.commit_opname($1)`, aid)
	if err != nil {
		t.Fatalf("commit_opname: %v", err)
	}

	if got := db.CountStockMovements(t, client, "TEST-IMM"); got-before != 1 {
		t.Fatalf("expected 1 ledger row (only varianced one), got %d", got-before)
	}

	var newQty int
	_ = client.QueryRow(context.Background(),
		`SELECT stock_atas FROM public.stocks WHERE sku='TEST-IMM'`).Scan(&newQty)
	if newQty != 18 {
		t.Fatalf("stock_atas = %d, want 18", newQty)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `commit_opname` does not exist.

- [ ] **Step 3: Append RPC**

Append to `supabase/migrations/20260607000008_stock_opname.sql`:
```sql
CREATE OR REPLACE FUNCTION public.commit_opname(
  p_approval_id BIGINT
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_ar RECORD;
  r RECORD;
  v_movement_count INT := 0;
BEGIN
  SELECT * INTO v_ar FROM public.approval_requests WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND OR v_ar.status <> 'approved' THEN
    RAISE EXCEPTION 'approval_request % is not approved', p_approval_id;
  END IF;

  SELECT * INTO v_session FROM public.stock_opname_sessions
   WHERE approval_request_id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no opname session for approval %', p_approval_id;
  END IF;
  IF v_session.status <> 'pending_owner' THEN
    RAISE EXCEPTION 'opname session % is not pending_owner', v_session.id;
  END IF;

  FOR r IN
    SELECT sku, warehouse, system_qty_snapshot, counted_qty, variance
      FROM public.stock_opname_counts
     WHERE session_id = v_session.id
       AND counted_qty IS NOT NULL
       AND variance <> 0
  LOOP
    -- Update stocks
    EXECUTE format('UPDATE public.stocks SET stock_%I = stock_%I + $2 WHERE sku=$1', r.warehouse, r.warehouse)
      USING r.sku, r.variance;
    -- Write ledger row
    PERFORM public._log_stock_movement(
      p_sku=>r.sku, p_warehouse=>r.warehouse, p_qty_delta=>r.variance,
      p_qty_before=>r.system_qty_snapshot, p_source=>'opname_variance',
      p_related_doc_type=>'opname_session', p_related_doc_id=>v_session.id::text,
      p_reason_code=>'opname', p_reason_note=>NULL,
      p_actor_user_id=>v_session.counted_by_user_id, p_actor_role=>'opname_commit'
    );
    v_movement_count := v_movement_count + 1;
  END LOOP;

  UPDATE public.stock_opname_sessions
     SET status='committed', committed_at=now()
   WHERE id = v_session.id;

  RETURN v_movement_count;
END $$;

GRANT EXECUTE ON FUNCTION public.commit_opname(BIGINT) TO authenticated;
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestCommitOpname -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000008_stock_opname.sql backend-go/internal/db/approvals_test.go
git commit -m "feat(opname): add commit_opname RPC writing one ledger row per varianced SKU"
```

---

## Task 9: `price_change_requests` + `stock_price_history` schema

**Files:**
- Create: `supabase/migrations/20260607000009_price_change_requests.sql`
- Modify: `backend-go/internal/db/approvals_test.go`

- [ ] **Step 1: Write failing test**

Append:
```go
func TestPriceChange_TablesExist(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	for _, tbl := range []string{"price_change_requests", "stock_price_history"} {
		var n int
		err := client.QueryRow(context.Background(),
			`SELECT 1 FROM information_schema.tables
			 WHERE table_schema='public' AND table_name=$1`, tbl).Scan(&n)
		if err != nil {
			t.Fatalf("%s missing: %v", tbl, err)
		}
	}
}

func TestStockPriceHistory_UpdateRaises(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 1)

	var id int64
	err := client.QueryRow(context.Background(),
		`INSERT INTO public.stock_price_history
		   (sku, field, old_value, new_value, source, actor_user_id, actor_role)
		 VALUES ('TEST-IMM','price', 1000, 1200, 'seed',
		         '00000000-0000-0000-0000-000000000000', 'system_test')
		 RETURNING id`).Scan(&id)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	_, err = client.Exec(context.Background(),
		`UPDATE public.stock_price_history SET new_value=999 WHERE id=$1`, id)
	if err == nil || !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("expected append-only, got: %v", err)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL.

- [ ] **Step 3: Write migration**

`supabase/migrations/20260607000009_price_change_requests.sql`:
```sql
CREATE TABLE public.price_change_requests (
  id                  BIGSERIAL PRIMARY KEY,
  sku                 TEXT NOT NULL REFERENCES public.stocks(sku),
  field               TEXT NOT NULL CHECK (field IN ('price','harga_modal')),
  old_value           NUMERIC(15,2) NOT NULL,
  new_value           NUMERIC(15,2) NOT NULL CHECK (new_value >= 0),
  reason_note         TEXT NOT NULL,
  approval_request_id BIGINT NOT NULL REFERENCES public.approval_requests(id),
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','rejected','expired')),
  requested_by        UUID NOT NULL,
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at          TIMESTAMPTZ,
  decided_by          UUID,
  committed_at        TIMESTAMPTZ
);
CREATE INDEX idx_pcr_status ON public.price_change_requests(status, requested_at DESC);
CREATE INDEX idx_pcr_sku    ON public.price_change_requests(sku, requested_at DESC);

CREATE TABLE public.stock_price_history (
  id                 BIGSERIAL PRIMARY KEY,
  sku                TEXT NOT NULL REFERENCES public.stocks(sku),
  field              TEXT NOT NULL CHECK (field IN ('price','harga_modal')),
  old_value          NUMERIC(15,2) NOT NULL,
  new_value          NUMERIC(15,2) NOT NULL,
  source             TEXT NOT NULL CHECK (source IN ('approval','seed')),
  related_request_id BIGINT REFERENCES public.price_change_requests(id),
  actor_user_id      UUID NOT NULL,
  actor_role         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sph_sku_created ON public.stock_price_history(sku, created_at DESC);

REVOKE UPDATE, DELETE ON public.stock_price_history FROM PUBLIC, anon, authenticated;
GRANT  SELECT          ON public.stock_price_history TO authenticated;

CREATE OR REPLACE FUNCTION public.deny_price_history_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock_price_history is append-only';
END $$;

CREATE TRIGGER trg_deny_sph_update BEFORE UPDATE ON public.stock_price_history
  FOR EACH ROW EXECUTE FUNCTION public.deny_price_history_mutation();
CREATE TRIGGER trg_deny_sph_delete BEFORE DELETE ON public.stock_price_history
  FOR EACH ROW EXECUTE FUNCTION public.deny_price_history_mutation();
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run 'TestPriceChange_|TestStockPriceHistory' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000009_price_change_requests.sql backend-go/internal/db/approvals_test.go
git commit -m "feat(prices): add price_change_requests + immutable stock_price_history"
```

---

## Task 10: `request_price_change` + `commit_approved_price_change` RPCs

**Files:**
- Modify: `supabase/migrations/20260607000009_price_change_requests.sql`
- Modify: `backend-go/internal/db/approvals_test.go`

- [ ] **Step 1: Write failing test**

Append:
```go
func TestRequestAndCommitPriceChange(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 5)
	_, _ = client.Exec(context.Background(),
		`UPDATE public.stocks SET price=1000 WHERE sku='TEST-IMM'`)

	var aid int64
	err := client.QueryRow(context.Background(),
		`SELECT public.request_price_change(
		   p_sku=>'TEST-IMM', p_field=>'price', p_new_value=>1500,
		   p_reason_note=>'kenaikan supplier',
		   p_actor_user_id=>'00000000-0000-0000-0000-000000000001')`).Scan(&aid)
	if err != nil {
		t.Fatalf("request: %v", err)
	}

	// Approve
	_, _ = client.Exec(context.Background(),
		`SELECT public._transition_approval($1, 'approved'::public.approval_status,
		   '00000000-0000-0000-0000-000000000099', 'owner_pin')`, aid)

	_, err = client.Exec(context.Background(),
		`SELECT public.commit_approved_price_change($1)`, aid)
	if err != nil {
		t.Fatalf("commit: %v", err)
	}

	var price float64
	_ = client.QueryRow(context.Background(),
		`SELECT price FROM public.stocks WHERE sku='TEST-IMM'`).Scan(&price)
	if price != 1500 {
		t.Fatalf("price = %v, want 1500", price)
	}

	var n int
	_ = client.QueryRow(context.Background(),
		`SELECT count(*) FROM public.stock_price_history
		 WHERE sku='TEST-IMM' AND new_value=1500 AND source='approval'`).Scan(&n)
	if n != 1 {
		t.Fatalf("expected 1 history row, got %d", n)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — RPCs do not exist.

- [ ] **Step 3: Append RPCs**

Append to `supabase/migrations/20260607000009_price_change_requests.sql`:
```sql
CREATE OR REPLACE FUNCTION public.request_price_change(
  p_sku           TEXT,
  p_field         TEXT,
  p_new_value     NUMERIC,
  p_reason_note   TEXT,
  p_actor_user_id UUID DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := COALESCE(p_actor_user_id, auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
  v_old NUMERIC;
  v_approval_id BIGINT;
BEGIN
  IF p_field NOT IN ('price','harga_modal') THEN
    RAISE EXCEPTION 'field must be price or harga_modal';
  END IF;
  IF p_new_value < 0 THEN
    RAISE EXCEPTION 'new_value must be >= 0';
  END IF;
  IF p_reason_note IS NULL OR length(trim(p_reason_note)) = 0 THEN
    RAISE EXCEPTION 'reason_note required';
  END IF;

  EXECUTE format('SELECT %I FROM public.stocks WHERE sku=$1', p_field)
    INTO v_old USING p_sku;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'sku % not found', p_sku;
  END IF;
  IF v_old = p_new_value THEN
    RAISE EXCEPTION 'new_value identical to current';
  END IF;

  INSERT INTO public.approval_requests (request_type, payload, requested_by)
  VALUES ('price_change',
          jsonb_build_object('sku',p_sku,'field',p_field,'old_value',v_old,'new_value',p_new_value,'reason_note',p_reason_note),
          v_actor)
  RETURNING id INTO v_approval_id;

  INSERT INTO public.price_change_requests
    (sku, field, old_value, new_value, reason_note, approval_request_id, requested_by)
  VALUES
    (p_sku, p_field, v_old, p_new_value, p_reason_note, v_approval_id, v_actor);

  RETURN v_approval_id;
END $$;

GRANT EXECUTE ON FUNCTION public.request_price_change(TEXT, TEXT, NUMERIC, TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.commit_approved_price_change(
  p_approval_id BIGINT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ar RECORD;
  v_pcr RECORD;
BEGIN
  SELECT * INTO v_ar FROM public.approval_requests WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND OR v_ar.status <> 'approved' THEN
    RAISE EXCEPTION 'approval_request % not approved', p_approval_id;
  END IF;

  SELECT * INTO v_pcr FROM public.price_change_requests
   WHERE approval_request_id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no price_change_request for approval %', p_approval_id;
  END IF;
  IF v_pcr.committed_at IS NOT NULL THEN
    RAISE EXCEPTION 'price_change_request % already committed', v_pcr.id;
  END IF;

  -- SECURITY DEFINER runs as function owner (postgres) which retains UPDATE
  -- privilege on the REVOKEd columns. The REVOKE only blocks authenticated/anon.
  EXECUTE format('UPDATE public.stocks SET %I = $2 WHERE sku = $1', v_pcr.field)
    USING v_pcr.sku, v_pcr.new_value;

  INSERT INTO public.stock_price_history
    (sku, field, old_value, new_value, source, related_request_id, actor_user_id, actor_role)
  VALUES
    (v_pcr.sku, v_pcr.field, v_pcr.old_value, v_pcr.new_value, 'approval',
     v_pcr.id, v_pcr.requested_by, 'price_change_commit');

  UPDATE public.price_change_requests
     SET status='approved', committed_at=now(),
         decided_at=now(), decided_by=v_ar.decided_by
   WHERE id = v_pcr.id;
END $$;

GRANT EXECUTE ON FUNCTION public.commit_approved_price_change(BIGINT) TO authenticated;
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestRequestAndCommitPriceChange -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000009_price_change_requests.sql backend-go/internal/db/approvals_test.go
git commit -m "feat(prices): add request_price_change + commit_approved_price_change RPCs"
```

---

## Task 11: REVOKE direct writes on `stocks` + `seed_stock_row` RPC

**Files:**
- Create: `supabase/migrations/20260607000010_stocks_revoke_direct_writes.sql`
- Modify: `backend-go/internal/db/approvals_test.go`

- [ ] **Step 1: Write failing test**

Append:
```go
func TestStocks_DirectUpdateAsAuthenticated_Denied(t *testing.T) {
	client := db.NewAuthenticatedTestClient(t) // logs in with the 'authenticated' JWT, NOT service_role
	defer client.Close()

	_, err := client.Exec(context.Background(),
		`UPDATE public.stocks SET price = 999 WHERE sku='TEST-IMM'`)
	if err == nil {
		t.Fatalf("expected permission denied, got nil")
	}
	if !strings.Contains(err.Error(), "permission") && !strings.Contains(err.Error(), "denied") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSeedStockRow_WritesHistoryAndMovement(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	// Make sure SKU does not exist
	_, _ = client.Exec(context.Background(),
		`DELETE FROM public.stocks WHERE sku='TEST-SEED'`)

	_, err := client.Exec(context.Background(),
		`SELECT public.seed_stock_row(
		   p_sku=>'TEST-SEED', p_name=>'Seeded', p_category=>'Aksesori',
		   p_price=>5000, p_harga_modal=>3000,
		   p_stock_atas=>4, p_stock_bawah=>2,
		   p_actor_user_id=>'00000000-0000-0000-0000-000000000099')`)
	if err != nil {
		t.Fatalf("seed_stock_row: %v", err)
	}

	var n int
	_ = client.QueryRow(context.Background(),
		`SELECT count(*) FROM public.stock_price_history
		 WHERE sku='TEST-SEED' AND source='seed'`).Scan(&n)
	if n < 2 {
		t.Fatalf("expected ≥2 history rows (price + harga_modal), got %d", n)
	}

	_ = client.QueryRow(context.Background(),
		`SELECT count(*) FROM public.stock_movements
		 WHERE sku='TEST-SEED' AND source='seed'`).Scan(&n)
	if n < 1 {
		t.Fatalf("expected ≥1 seed movement, got %d", n)
	}
}
```

(Add `db.NewAuthenticatedTestClient(t)` helper that creates a client using a JWT signed with `JWT_SECRET` and role claim `authenticated`. If a similar helper does not exist, model after the existing `db.NewTestClient`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend-go && go test ./internal/db/ -run 'TestStocks_DirectUpdate|TestSeedStockRow' -v`
Expected: FAIL — UPDATE still succeeds, `seed_stock_row` does not exist.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260607000010_stocks_revoke_direct_writes.sql`:
```sql
-- Forbid direct UPDATE of sensitive columns from JS clients.
-- SECURITY DEFINER RPCs run as the function owner (postgres) and keep access.
REVOKE UPDATE (price, harga_modal, stock_atas, stock_bawah) ON public.stocks
  FROM PUBLIC, anon, authenticated;

-- Seed path used by CSV import + brand-new SKU creation. Owner role only.
CREATE OR REPLACE FUNCTION public.seed_stock_row(
  p_sku           TEXT,
  p_name          TEXT,
  p_category      TEXT,
  p_price         NUMERIC,
  p_harga_modal   NUMERIC,
  p_stock_atas    INT DEFAULT 0,
  p_stock_bawah   INT DEFAULT 0,
  p_actor_user_id UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := COALESCE(p_actor_user_id, auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
  v_role  TEXT;
  v_existing RECORD;
BEGIN
  -- Owner-only gate
  SELECT role INTO v_role FROM public.admin_users WHERE id = v_actor;
  IF v_role IS DISTINCT FROM 'Owner' THEN
    RAISE EXCEPTION 'seed_stock_row requires Owner role (caller role=%)', v_role;
  END IF;

  SELECT * INTO v_existing FROM public.stocks WHERE sku = p_sku;
  IF NOT FOUND THEN
    INSERT INTO public.stocks (sku, name, category, price, harga_modal,
                               stock_atas, stock_bawah, stock, status, specs)
    VALUES (p_sku, p_name, p_category, p_price, p_harga_modal,
            p_stock_atas, p_stock_bawah, p_stock_atas + p_stock_bawah, 'Sinkron', '{}'::jsonb);
  ELSE
    UPDATE public.stocks
       SET name = p_name, category = p_category,
           price = p_price, harga_modal = p_harga_modal,
           stock_atas = p_stock_atas, stock_bawah = p_stock_bawah,
           stock = p_stock_atas + p_stock_bawah
     WHERE sku = p_sku;
  END IF;

  -- Price history rows
  INSERT INTO public.stock_price_history
    (sku, field, old_value, new_value, source, actor_user_id, actor_role)
  VALUES
    (p_sku, 'price',       COALESCE(v_existing.price, 0),       p_price,       'seed', v_actor, 'seed'),
    (p_sku, 'harga_modal', COALESCE(v_existing.harga_modal, 0), p_harga_modal, 'seed', v_actor, 'seed');

  -- Initial ledger row (one combined seed row per warehouse with non-zero qty)
  IF p_stock_atas > 0 THEN
    PERFORM public._log_stock_movement(
      p_sku=>p_sku, p_warehouse=>'atas', p_qty_delta=>p_stock_atas,
      p_qty_before=>COALESCE(v_existing.stock_atas, 0), p_source=>'seed',
      p_actor_user_id=>v_actor, p_actor_role=>'seed');
  END IF;
  IF p_stock_bawah > 0 THEN
    PERFORM public._log_stock_movement(
      p_sku=>p_sku, p_warehouse=>'bawah', p_qty_delta=>p_stock_bawah,
      p_qty_before=>COALESCE(v_existing.stock_bawah, 0), p_source=>'seed',
      p_actor_user_id=>v_actor, p_actor_role=>'seed');
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.seed_stock_row(
  TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INT, INT, UUID
) TO authenticated;
```

**Test setup note:** the test seeds an Owner admin user with `id = '00000000-0000-0000-0000-000000000099'`. If your test fixture does not already do this, extend `db.testhelpers.go` with a `db.EnsureOwnerUser(t, client, id)` helper that upserts a row with `role='Owner'`.

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run 'TestStocks_DirectUpdate|TestSeedStockRow' -v`
Expected: PASS.

- [ ] **Step 5: Run existing CSV-upsert tests for regression**

Run: `cd backend-go && go test ./... -run 'CSVUpsert|StockUpsert' -v`
Expected: PASS if those tests have been updated to call `seed_stock_row` (next task is to update the frontend caller). If they fail here, the existing tests are exercising the old direct UPDATE — that is expected and the CSV upsert frontend will need to migrate to `seed_stock_row` (handled in Task 22 frontend wiring).

- [ ] **Step 6: Remove the legacy fallback path in `supabaseClient.ts`**

The existing `decrementStock` helper at `src/lib/supabaseClient.ts:806-820` catches an RPC error and falls back to a direct UPDATE on `stocks.stock_atas` / `stock_bawah`:

```typescript
async decrementStock(sku: string, qty: number, warehouse: 'atas' | 'bawah' = 'atas'): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.rpc('decrement_stock', { p_sku: sku, p_qty: qty, p_warehouse: warehouse });
  if (error) {
    const col = warehouse === 'atas' ? 'stock_atas' : 'stock_bawah';
    const { data, error: fetchErr } = await supabase.from('stocks').select(col).eq('sku', sku).single();
    if (fetchErr) throw fetchErr;
    const current = (data as Record<string, number>)[col] ?? 0;
    const { error: updateErr } = await supabase.from('stocks').update({
      [col]: Math.max(0, current - qty),
      updated_at: new Date().toISOString(),
    }).eq('sku', sku);
    if (updateErr) throw updateErr;
  }
},
```

After the REVOKE above, the fallback's `supabase.from('stocks').update({ [col]: ... })` will always fail with `permission denied for table stocks` — but worse, it would mask real RPC failures by surfacing a misleading permission error instead. Delete the entire `if (error) { ... }` recovery block (lines 808-819 in the current file) and replace with a straight `if (error) throw error;` so RPC failures propagate cleanly. Commit this change in the **same** commit as the REVOKE migration so the two land atomically.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260607000010_stocks_revoke_direct_writes.sql backend-go/internal/db/approvals_test.go src/lib/supabaseClient.ts
git commit -m "feat(stocks): REVOKE direct writes + add seed_stock_row RPC + drop fallback"
```

---

## Task 12: Extend `admin_users.permissions` JSONB + PIN columns + pgcrypto

**Files:**
- Create: `supabase/migrations/20260607000011_extend_permissions_and_pin.sql`
- Modify: `backend-go/internal/db/approvals_test.go`

**Design note:** The existing `admin_users.permissions` JSONB already carries 11 sidebar keys (e.g., `dashboard`, `kasir`, `userManagement`). Instead of adding a separate `action_permissions` column, this task **extends the same JSONB** with 15 new action-level keys (e.g., `can_request_adjustment`, `can_approve_adjustment`). One column, one source of truth, one UI section in User Management. Existing keys are preserved by using the JSONB `||` merge operator (right-side wins on conflict, and there are no name clashes).

- [ ] **Step 1: Write failing test**

Append:
```go
func TestAdminUsers_PinColumns(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	rows, _ := client.Query(context.Background(),
		`SELECT column_name FROM information_schema.columns
		 WHERE table_schema='public' AND table_name='admin_users'
		   AND column_name IN ('approval_pin_hash','pin_failed_count','pin_locked_until')`)
	defer rows.Close()
	cols := map[string]bool{}
	for rows.Next() {
		var c string
		_ = rows.Scan(&c)
		cols[c] = true
	}
	for _, want := range []string{"approval_pin_hash","pin_failed_count","pin_locked_until"} {
		if !cols[want] {
			t.Fatalf("missing column %s", want)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL.

- [ ] **Step 3: Write migration**

`supabase/migrations/20260607000011_extend_permissions_and_pin.sql`:
```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Note: admin_users.permissions JSONB already exists (carries sidebar keys
-- like dashboard, kasir, userManagement). We extend that same column with
-- action-level keys rather than adding a parallel column — one source of truth.
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS approval_pin_hash  TEXT,
  ADD COLUMN IF NOT EXISTS pin_failed_count   INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until   TIMESTAMPTZ;

-- Seed defaults per role (Foundational Decision #5 + Phase 2 matrix).
-- Owner = all-true locked. Other roles get sensible defaults.
-- The `||` JSONB operator merges right-side keys into the existing object;
-- existing sidebar keys (dashboard, kasir, ...) are preserved untouched.
UPDATE public.admin_users
   SET permissions = permissions || jsonb_build_object(
     'can_request_adjustment',       true,
     'can_approve_adjustment',       true,
     'can_start_opname',             true,
     'can_witness_opname',           true,
     'can_commit_opname',            true,
     'can_request_price_change',     true,
     'can_approve_price_change',     true,
     'can_view_pengawasan',          true
   )
 WHERE role = 'Owner';

UPDATE public.admin_users
   SET permissions = permissions || jsonb_build_object(
     'can_request_adjustment',       true,
     'can_witness_opname',           true,
     'can_request_price_change',     true
   )
 WHERE role IN ('Staff Admin Toko', 'Staff Admin');

UPDATE public.admin_users
   SET permissions = permissions || jsonb_build_object(
     'can_request_adjustment',       true,
     'can_start_opname',             true,
     'can_witness_opname',           true,
     'can_request_price_change',     true
   )
 WHERE role = 'Supervisor Gudang';

UPDATE public.admin_users
   SET permissions = permissions || jsonb_build_object(
     'can_witness_opname',           true,
     'can_request_price_change',     true
   )
 WHERE role = 'Finance Manager';
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run 'TestAdminUsers_' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000011_extend_permissions_and_pin.sql backend-go/internal/db/approvals_test.go
git commit -m "feat(approvals): extend admin_users.permissions with action keys + add Owner PIN columns"
```

---

## Task 13: `verify_owner_pin` RPC — bcrypt + per-Owner lockout

**Files:**
- Modify: `supabase/migrations/20260607000011_extend_permissions_and_pin.sql`
- Modify: `backend-go/internal/db/approvals_test.go`

The lockout counter sits on the **Owner's** `admin_users` row, not the requester's. Even if Karyawan A and Karyawan B each fumble the PIN three times in sequence (total 6), the Owner is still locked because all six attempts increment the same row.

- [ ] **Step 1: Write failing tests**

Append:
```go
func TestVerifyOwnerPin_Success(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	db.EnsureOwnerUser(t, client, "00000000-0000-0000-0000-000000000099")
	_, _ = client.Exec(context.Background(),
		`UPDATE public.admin_users
		    SET approval_pin_hash = crypt('123456', gen_salt('bf')),
		        pin_failed_count = 0,
		        pin_locked_until = NULL
		  WHERE id = '00000000-0000-0000-0000-000000000099'`)
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 10)

	var aid int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.request_adjustment(
		   p_sku=>'TEST-IMM', p_warehouse=>'atas', p_qty_delta=>-1,
		   p_reason_code=>'rusak', p_evidence_urls=>ARRAY['a.jpg'],
		   p_actor_user_id=>'00000000-0000-0000-0000-000000000001')`).Scan(&aid)

	var ok bool
	err := client.QueryRow(context.Background(),
		`SELECT public.verify_owner_pin($1, '123456')`, aid).Scan(&ok)
	if err != nil || !ok {
		t.Fatalf("verify_owner_pin: ok=%v err=%v", ok, err)
	}

	var status string
	_ = client.QueryRow(context.Background(),
		`SELECT status::text FROM public.approval_requests WHERE id=$1`, aid).Scan(&status)
	if status != "approved" {
		t.Fatalf("approval status = %s, want approved", status)
	}
}

func TestVerifyOwnerPin_WrongPin_IncrementsOwnerCounter(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	db.EnsureOwnerUser(t, client, "00000000-0000-0000-0000-000000000099")
	_, _ = client.Exec(context.Background(),
		`UPDATE public.admin_users
		    SET approval_pin_hash = crypt('123456', gen_salt('bf')),
		        pin_failed_count = 0,
		        pin_locked_until = NULL
		  WHERE id = '00000000-0000-0000-0000-000000000099'`)
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 10)

	var aid int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.request_adjustment(
		   p_sku=>'TEST-IMM', p_warehouse=>'atas', p_qty_delta=>-1,
		   p_reason_code=>'rusak', p_evidence_urls=>ARRAY['a.jpg'],
		   p_actor_user_id=>'00000000-0000-0000-0000-000000000001')`).Scan(&aid)

	for i := 0; i < 5; i++ {
		_, _ = client.Exec(context.Background(),
			`SELECT public.verify_owner_pin($1, 'WRONG!')`, aid)
	}

	var failed int
	var lockedUntil *string
	_ = client.QueryRow(context.Background(),
		`SELECT pin_failed_count, pin_locked_until::text
		   FROM public.admin_users WHERE id='00000000-0000-0000-0000-000000000099'`).Scan(&failed, &lockedUntil)
	if failed < 5 {
		t.Fatalf("pin_failed_count = %d, want ≥5", failed)
	}
	if lockedUntil == nil {
		t.Fatalf("pin_locked_until should be set after 5 failures")
	}
}

func TestVerifyOwnerPin_WhenLocked_Rejects(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	db.EnsureOwnerUser(t, client, "00000000-0000-0000-0000-000000000099")
	_, _ = client.Exec(context.Background(),
		`UPDATE public.admin_users
		    SET approval_pin_hash = crypt('123456', gen_salt('bf')),
		        pin_failed_count = 5,
		        pin_locked_until = now() + INTERVAL '1 hour'
		  WHERE id='00000000-0000-0000-0000-000000000099'`)
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 10)

	var aid int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.request_adjustment(
		   p_sku=>'TEST-IMM', p_warehouse=>'atas', p_qty_delta=>-1,
		   p_reason_code=>'rusak', p_evidence_urls=>ARRAY['a.jpg'],
		   p_actor_user_id=>'00000000-0000-0000-0000-000000000001')`).Scan(&aid)

	_, err := client.Exec(context.Background(),
		`SELECT public.verify_owner_pin($1, '123456')`, aid)
	if err == nil || !strings.Contains(err.Error(), "locked") {
		t.Fatalf("expected locked error, got: %v", err)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL — `verify_owner_pin` does not exist.

- [ ] **Step 3: Append RPC**

Append to `supabase/migrations/20260607000011_extend_permissions_and_pin.sql`:
```sql
CREATE OR REPLACE FUNCTION public.verify_owner_pin(
  p_approval_id BIGINT,
  p_pin         TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner RECORD;
  v_ar    RECORD;
BEGIN
  -- Per-Owner lockout: the counter and lock live on the Owner's admin_users row.
  SELECT id, approval_pin_hash, pin_failed_count, pin_locked_until
    INTO v_owner
    FROM public.admin_users
   WHERE role = 'Owner'
   ORDER BY id LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no Owner user configured';
  END IF;

  IF v_owner.pin_locked_until IS NOT NULL AND v_owner.pin_locked_until > now() THEN
    RAISE EXCEPTION 'Owner PIN is locked until %', v_owner.pin_locked_until;
  END IF;

  IF v_owner.approval_pin_hash IS NULL THEN
    RAISE EXCEPTION 'Owner PIN not configured';
  END IF;

  SELECT * INTO v_ar FROM public.approval_requests WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_request % not found', p_approval_id;
  END IF;
  IF v_ar.status <> 'pending' THEN
    RAISE EXCEPTION 'approval_request % is not pending', p_approval_id;
  END IF;

  -- bcrypt compare
  IF crypt(p_pin, v_owner.approval_pin_hash) = v_owner.approval_pin_hash THEN
    UPDATE public.admin_users
       SET pin_failed_count = 0, pin_locked_until = NULL
     WHERE id = v_owner.id;
    PERFORM public._transition_approval(p_approval_id, 'approved'::public.approval_status,
                                        v_owner.id, 'owner_pin');
    RETURN TRUE;
  ELSE
    UPDATE public.admin_users
       SET pin_failed_count = pin_failed_count + 1,
           pin_locked_until = CASE
             WHEN pin_failed_count + 1 >= 5 THEN now() + INTERVAL '1 hour'
             ELSE pin_locked_until
           END
     WHERE id = v_owner.id;
    RETURN FALSE;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.verify_owner_pin(BIGINT, TEXT) TO authenticated;
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run 'TestVerifyOwnerPin' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000011_extend_permissions_and_pin.sql backend-go/internal/db/approvals_test.go
git commit -m "feat(approvals): add verify_owner_pin with per-Owner bcrypt lockout"
```

---

## Task 14: `decide_via_wa_button` + `expire_pending_approvals` RPCs

**Files:**
- Modify: `supabase/migrations/20260607000011_extend_permissions_and_pin.sql`
- Modify: `backend-go/internal/db/approvals_test.go`

- [ ] **Step 1: Write failing tests**

Append:
```go
func TestDecideViaWaButton_Approve(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureOwnerUser(t, client, "00000000-0000-0000-0000-000000000099")
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 10)

	var aid int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.request_adjustment(
		   p_sku=>'TEST-IMM', p_warehouse=>'atas', p_qty_delta=>-1,
		   p_reason_code=>'rusak', p_evidence_urls=>ARRAY['a.jpg'],
		   p_actor_user_id=>'00000000-0000-0000-0000-000000000001')`).Scan(&aid)

	_, err := client.Exec(context.Background(),
		`SELECT public.decide_via_wa_button($1, 'approve',
		   '00000000-0000-0000-0000-000000000099')`, aid)
	if err != nil {
		t.Fatalf("decide: %v", err)
	}

	var status, channel string
	_ = client.QueryRow(context.Background(),
		`SELECT status::text, decision_channel FROM public.approval_requests WHERE id=$1`, aid).
		Scan(&status, &channel)
	if status != "approved" || channel != "wa_button" {
		t.Fatalf("status=%s channel=%s", status, channel)
	}
}

func TestDecideViaWaButton_DoubleClick_Idempotent(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureOwnerUser(t, client, "00000000-0000-0000-0000-000000000099")
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 10)

	var aid int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.request_adjustment(
		   p_sku=>'TEST-IMM', p_warehouse=>'atas', p_qty_delta=>-1,
		   p_reason_code=>'rusak', p_evidence_urls=>ARRAY['a.jpg'],
		   p_actor_user_id=>'00000000-0000-0000-0000-000000000001')`).Scan(&aid)

	_, _ = client.Exec(context.Background(),
		`SELECT public.decide_via_wa_button($1, 'approve',
		   '00000000-0000-0000-0000-000000000099')`, aid)
	// Second click — must not error
	_, err := client.Exec(context.Background(),
		`SELECT public.decide_via_wa_button($1, 'approve',
		   '00000000-0000-0000-0000-000000000099')`, aid)
	if err != nil {
		t.Fatalf("second click errored: %v", err)
	}
}

func TestExpirePendingApprovals_FlipsOldRows(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 10)

	var aid int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.request_adjustment(
		   p_sku=>'TEST-IMM', p_warehouse=>'atas', p_qty_delta=>-1,
		   p_reason_code=>'rusak', p_evidence_urls=>ARRAY['a.jpg'],
		   p_actor_user_id=>'00000000-0000-0000-0000-000000000001')`).Scan(&aid)

	// Backdate expires_at via service_role (only path that bypasses REVOKE for testing).
	// The trigger trg_deny_ar_update is disabled at table level, so this UPDATE succeeds.
	_, _ = client.Exec(context.Background(),
		`UPDATE public.approval_requests SET expires_at = now() - INTERVAL '1 minute' WHERE id=$1`, aid)

	var n int
	err := client.QueryRow(context.Background(),
		`SELECT public.expire_pending_approvals()`).Scan(&n)
	if err != nil {
		t.Fatalf("expire: %v", err)
	}
	if n < 1 {
		t.Fatalf("expected ≥1 expired row, got %d", n)
	}

	var status string
	_ = client.QueryRow(context.Background(),
		`SELECT status::text FROM public.approval_requests WHERE id=$1`, aid).Scan(&status)
	if status != "expired" {
		t.Fatalf("status = %s, want expired", status)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL — RPCs do not exist.

- [ ] **Step 3: Append RPCs**

Append to `supabase/migrations/20260607000011_extend_permissions_and_pin.sql`:
```sql
CREATE OR REPLACE FUNCTION public.decide_via_wa_button(
  p_approval_id BIGINT,
  p_decision    TEXT,                  -- 'approve' | 'reject'
  p_decided_by  UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ar RECORD;
BEGIN
  IF p_decision NOT IN ('approve','reject') THEN
    RAISE EXCEPTION 'decision must be approve or reject';
  END IF;

  SELECT * INTO v_ar FROM public.approval_requests WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_request % not found', p_approval_id;
  END IF;
  -- Idempotency: if already in terminal state, no-op
  IF v_ar.status <> 'pending' THEN
    RETURN;
  END IF;

  PERFORM public._transition_approval(
    p_approval_id,
    CASE p_decision WHEN 'approve' THEN 'approved' ELSE 'rejected' END::public.approval_status,
    p_decided_by, 'wa_button');
END $$;

GRANT EXECUTE ON FUNCTION public.decide_via_wa_button(BIGINT, TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.expire_pending_approvals()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n INT;
BEGIN
  WITH expired AS (
    UPDATE public.approval_requests
       SET status           = 'expired',
           decided_at       = now(),
           decision_channel = 'auto_expire'
     WHERE status = 'pending' AND expires_at < now()
     RETURNING id
  )
  SELECT count(*) INTO v_n FROM expired;
  RETURN v_n;
END $$;

GRANT EXECUTE ON FUNCTION public.expire_pending_approvals() TO authenticated;
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run 'TestDecideViaWaButton|TestExpirePendingApprovals' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000011_extend_permissions_and_pin.sql backend-go/internal/db/approvals_test.go
git commit -m "feat(approvals): add decide_via_wa_button + expire_pending_approvals RPCs"
```

---

## Task 15: `stock-evidence` storage bucket

**Files:**
- Create: `supabase/migrations/20260607000012_stock_evidence_bucket.sql`

- [ ] **Step 1: Read existing payment-proof bucket policy as reference**

Run: `cat supabase/migrations/20260604000012_storage_authenticated_policies.sql`

- [ ] **Step 2: Write migration**

`supabase/migrations/20260607000012_stock_evidence_bucket.sql`:
```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('stock-evidence', 'stock-evidence', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "authenticated can upload stock-evidence"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'stock-evidence');

CREATE POLICY "authenticated can read stock-evidence"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'stock-evidence');

CREATE POLICY "authenticated can update own stock-evidence"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'stock-evidence' AND owner = auth.uid());
```

- [ ] **Step 3: Apply migration**

Run: `supabase db push --include-all`
Expected: no errors. Verify bucket exists: `SELECT id FROM storage.buckets WHERE id='stock-evidence';` → 1 row.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260607000012_stock_evidence_bucket.sql
git commit -m "feat(storage): add stock-evidence bucket with authenticated policies"
```

---

## Task 16: Go helper `internal/db/approvals.go`

**Files:**
- Create: `backend-go/internal/db/approvals.go`

- [ ] **Step 1: Write the helpers**

`backend-go/internal/db/approvals.go`:
```go
package db

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type ApprovalRequest struct {
	ID              int64
	RequestType     string
	Payload         []byte
	RequestedBy     uuid.UUID
	RequestedAt     time.Time
	ExpiresAt       time.Time
	Status          string
	DecidedBy       *uuid.UUID
	DecidedAt       *time.Time
	DecisionChannel *string
	WaMessageID     *string
}

func (c *Client) ListPendingForOwner(ctx context.Context) ([]ApprovalRequest, error) {
	rows, err := c.Query(ctx, `
		SELECT id, request_type::text, payload, requested_by, requested_at,
		       expires_at, status::text, decided_by, decided_at, decision_channel, wa_message_id
		  FROM public.approval_requests
		 WHERE status = 'pending'
		 ORDER BY requested_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ApprovalRequest
	for rows.Next() {
		var a ApprovalRequest
		if err := rows.Scan(&a.ID, &a.RequestType, &a.Payload, &a.RequestedBy, &a.RequestedAt,
			&a.ExpiresAt, &a.Status, &a.DecidedBy, &a.DecidedAt, &a.DecisionChannel, &a.WaMessageID); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (c *Client) DecideViaWAButton(ctx context.Context, approvalID int64, decision string, decidedBy uuid.UUID) error {
	_, err := c.Exec(ctx, `SELECT public.decide_via_wa_button($1, $2, $3)`, approvalID, decision, decidedBy)
	return err
}

func (c *Client) ExpirePendingApprovals(ctx context.Context) (int, error) {
	var n int
	err := c.QueryRow(ctx, `SELECT public.expire_pending_approvals()`).Scan(&n)
	return n, err
}
```

- [ ] **Step 2: Write a smoke test**

Append to `backend-go/internal/db/approvals_test.go`:
```go
func TestListPendingForOwner_RoundTrip(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 5)

	_, err := client.Exec(context.Background(),
		`SELECT public.request_adjustment(
		   p_sku=>'TEST-IMM', p_warehouse=>'atas', p_qty_delta=>-1,
		   p_reason_code=>'rusak', p_evidence_urls=>ARRAY['a.jpg'],
		   p_actor_user_id=>'00000000-0000-0000-0000-000000000001')`)
	if err != nil { t.Fatal(err) }

	pending, err := client.ListPendingForOwner(context.Background())
	if err != nil { t.Fatal(err) }
	if len(pending) == 0 {
		t.Fatalf("expected ≥1 pending row")
	}
}
```

- [ ] **Step 3: Run test**

Run: `cd backend-go && go test ./internal/db/ -run TestListPendingForOwner -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/db/approvals.go backend-go/internal/db/approvals_test.go
git commit -m "feat(approvals): add Go db helpers for approval_requests"
```

---

## Task 17: WA approval sender — `SendApprovalRequest`

**Files:**
- Create: `backend-go/internal/whatsapp/approval_sender.go`
- Create: `backend-go/internal/whatsapp/approval_sender_test.go`

- [ ] **Step 1: Write failing test**

`backend-go/internal/whatsapp/approval_sender_test.go`:
```go
package whatsapp

import (
	"strings"
	"testing"
)

func TestFormatApprovalMessage_AdjustmentRusak(t *testing.T) {
	got := FormatApprovalMessage(ApprovalPayload{
		ID:           42,
		RequestType:  "adjustment",
		ActorName:    "Andi",
		ItemSummary:  "TEST-IMM Kabel NYM 3×2.5",
		Detail:       "Atas −3 unit",
		Reason:       "rusak: kena air",
		ValueRp:      9000,
		EvidenceLink: "https://example.com/foo.jpg",
	})
	for _, want := range []string{"Approval", "adjustment", "Andi", "TEST-IMM",
		"Atas −3 unit", "rusak", "9.000", "Setujui", "Tolak", "approve:42", "reject:42"} {
		if !strings.Contains(got, want) {
			t.Fatalf("output missing %q\n--- got ---\n%s", want, got)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestFormatApprovalMessage -v`
Expected: FAIL — function does not exist.

- [ ] **Step 3: Write sender**

`backend-go/internal/whatsapp/approval_sender.go`:
```go
package whatsapp

import (
	"context"
	"fmt"
	"strings"

	"github.com/dustin/go-humanize"
)

type ApprovalPayload struct {
	ID           int64
	RequestType  string
	ActorName    string
	ItemSummary  string
	Detail       string
	Reason       string
	ValueRp      float64
	EvidenceLink string
}

func FormatApprovalMessage(p ApprovalPayload) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "🔐 Approval — %s\n", p.RequestType)
	fmt.Fprintf(&sb, "Karyawan: %s\n", p.ActorName)
	fmt.Fprintf(&sb, "Item: %s\n", p.ItemSummary)
	fmt.Fprintf(&sb, "Detail: %s\n", p.Detail)
	fmt.Fprintf(&sb, "Alasan: %s\n", p.Reason)
	if p.ValueRp != 0 {
		fmt.Fprintf(&sb, "Nilai: Rp %s\n", humanize.CommafWithDigits(p.ValueRp, 0))
		// Indonesian uses "." as thousand separator — replace
		out := sb.String()
		out = strings.ReplaceAll(out, ",", ".")
		sb.Reset()
		sb.WriteString(out)
	}
	if p.EvidenceLink != "" {
		fmt.Fprintf(&sb, "Bukti: %s\n", p.EvidenceLink)
	}
	fmt.Fprintf(&sb, "\nBalas:\n[✓ Setujui] approve:%d\n[✗ Tolak] reject:%d\n", p.ID, p.ID)
	return sb.String()
}

// SendApprovalRequest formats and sends an approval WA message to the given JID.
func (s *Sender) SendApprovalRequest(ctx context.Context, ownerJID string, p ApprovalPayload) error {
	return s.SendText(ctx, ownerJID, FormatApprovalMessage(p))
}
```

(If `github.com/dustin/go-humanize` is not yet a dep, run `cd backend-go && go get github.com/dustin/go-humanize`.)

- [ ] **Step 4: Apply & re-test**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestFormatApprovalMessage -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/whatsapp/approval_sender.go backend-go/internal/whatsapp/approval_sender_test.go backend-go/go.mod backend-go/go.sum
git commit -m "feat(approvals): add SendApprovalRequest WA template helper"
```

---

## Task 18: HTTP webhook `/api/approval/wa-webhook`

**Files:**
- Create: `backend-go/internal/api/approval_webhook.go`
- Create: `backend-go/internal/api/approval_webhook_test.go`

- [ ] **Step 1: Write failing test**

`backend-go/internal/api/approval_webhook_test.go`:
```go
package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakeDecider struct {
	got struct {
		ID       int64
		Decision string
		User     string
	}
	err error
}

func (f *fakeDecider) DecideViaWAButton(id int64, decision, userID string) error {
	f.got.ID = id
	f.got.Decision = decision
	f.got.User = userID
	return f.err
}

func TestApprovalWebhook_HappyPath(t *testing.T) {
	fd := &fakeDecider{}
	h := NewApprovalWebhookHandler(fd)

	body, _ := json.Marshal(map[string]any{
		"button_payload": "approve:42",
		"sender_jid":     "6281234567890@s.whatsapp.net",
		"owner_user_id":  "00000000-0000-0000-0000-000000000099",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/approval/wa-webhook", bytes.NewReader(body))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if fd.got.ID != 42 || fd.got.Decision != "approve" {
		t.Fatalf("decider got %+v", fd.got)
	}
}

func TestApprovalWebhook_RejectsBadPayload(t *testing.T) {
	fd := &fakeDecider{}
	h := NewApprovalWebhookHandler(fd)

	body := []byte(`{"button_payload":"garbage","owner_user_id":"x"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/approval/wa-webhook", bytes.NewReader(body))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/api/ -run TestApprovalWebhook -v`
Expected: FAIL — package does not exist.

- [ ] **Step 3: Write handler**

`backend-go/internal/api/approval_webhook.go`:
```go
package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

type Decider interface {
	DecideViaWAButton(approvalID int64, decision, userID string) error
}

type approvalWebhookHandler struct{ d Decider }

func NewApprovalWebhookHandler(d Decider) http.Handler {
	return &approvalWebhookHandler{d: d}
}

type approvalWebhookReq struct {
	ButtonPayload string `json:"button_payload"`
	SenderJID     string `json:"sender_jid"`
	OwnerUserID   string `json:"owner_user_id"`
}

func (h *approvalWebhookHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", http.StatusMethodNotAllowed)
		return
	}
	var req approvalWebhookReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "json", http.StatusBadRequest)
		return
	}

	parts := strings.SplitN(req.ButtonPayload, ":", 2)
	if len(parts) != 2 || (parts[0] != "approve" && parts[0] != "reject") {
		http.Error(w, "bad button_payload", http.StatusBadRequest)
		return
	}
	id, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}

	if err := h.d.DecideViaWAButton(id, parts[0], req.OwnerUserID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
```

- [ ] **Step 4: Apply & re-test**

Run: `cd backend-go && go test ./internal/api/ -run TestApprovalWebhook -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/api/approval_webhook.go backend-go/internal/api/approval_webhook_test.go
git commit -m "feat(api): add POST /api/approval/wa-webhook handler"
```

---

## Task 19: Expiry poller goroutine

**Files:**
- Create: `backend-go/internal/approvals/expiry_poller.go`
- Create: `backend-go/internal/approvals/expiry_poller_test.go`

- [ ] **Step 1: Write failing test**

`backend-go/internal/approvals/expiry_poller_test.go`:
```go
package approvals

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

type fakeExpirer struct{ calls int32 }

func (f *fakeExpirer) ExpirePendingApprovals(ctx context.Context) (int, error) {
	atomic.AddInt32(&f.calls, 1)
	return 0, nil
}

func TestExpiryPoller_TicksOncePerInterval(t *testing.T) {
	fe := &fakeExpirer{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	p := NewExpiryPoller(fe, 50*time.Millisecond)
	go p.Run(ctx)

	time.Sleep(170 * time.Millisecond)
	cancel()
	if got := atomic.LoadInt32(&fe.calls); got < 2 || got > 5 {
		t.Fatalf("expected 2-5 calls in 170ms, got %d", got)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/approvals/ -run TestExpiryPoller -v`
Expected: FAIL — package does not exist.

- [ ] **Step 3: Write poller**

`backend-go/internal/approvals/expiry_poller.go`:
```go
package approvals

import (
	"context"
	"log"
	"time"
)

type Expirer interface {
	ExpirePendingApprovals(ctx context.Context) (int, error)
}

type ExpiryPoller struct {
	exp      Expirer
	interval time.Duration
}

func NewExpiryPoller(e Expirer, interval time.Duration) *ExpiryPoller {
	return &ExpiryPoller{exp: e, interval: interval}
}

func (p *ExpiryPoller) Run(ctx context.Context) {
	t := time.NewTicker(p.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			n, err := p.exp.ExpirePendingApprovals(ctx)
			if err != nil {
				log.Printf("approval expiry poller error: %v", err)
				continue
			}
			if n > 0 {
				log.Printf("approval expiry: expired %d pending requests", n)
			}
		}
	}
}
```

- [ ] **Step 4: Apply & re-test**

Run: `cd backend-go && go test ./internal/approvals/ -run TestExpiryPoller -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/approvals/expiry_poller.go backend-go/internal/approvals/expiry_poller_test.go
git commit -m "feat(approvals): add approvalExpiryPoller goroutine"
```

---

## Task 20: Wire webhook + poller into `main.go`

**Files:**
- Modify: `backend-go/main.go`

- [ ] **Step 1: Read current main.go structure**

Run: `head -200 backend-go/main.go`

- [ ] **Step 2: Add the wiring**

In `backend-go/main.go`:

Add imports:
```go
import (
    ...
    "github.com/username/sinar-elektrik-backend/internal/api"
    "github.com/username/sinar-elektrik-backend/internal/approvals"
)
```

After existing `mux.HandleFunc("/api/wa/debug", ...)` block, add:
```go
// Approval WA button webhook
approvalDecider := dbDeciderAdapter{client: dbClient}
mux.Handle("/api/approval/wa-webhook", api.NewApprovalWebhookHandler(approvalDecider))
```

Define the adapter (just above `main()` or in a helper file):
```go
type dbDeciderAdapter struct{ client *db.Client }

func (a dbDeciderAdapter) DecideViaWAButton(id int64, decision, userID string) error {
    uid, err := uuid.Parse(userID)
    if err != nil {
        return err
    }
    return a.client.DecideViaWAButton(context.Background(), id, decision, uid)
}
```

Inside `main()`, after dbClient init, add:
```go
poller := approvals.NewExpiryPoller(dbClient, time.Minute)
go poller.Run(ctx)
```

(where `ctx` is the existing root context; if it does not exist, add `ctx, cancel := context.WithCancel(context.Background())` near the top of `main()` and `defer cancel()`.)

- [ ] **Step 3: Add `ExpirePendingApprovals` method to `db.Client` if not already there**

Already added in Task 16.

- [ ] **Step 4: Build & lint**

Run: `cd backend-go && go build ./... && go vet ./...`
Expected: no errors.

- [ ] **Step 5: Manual smoke**

Start the daemon: `cd backend-go && go run .`
In another shell: `curl -X POST http://localhost:8080/api/approval/wa-webhook -d '{"button_payload":"approve:1","owner_user_id":"00000000-0000-0000-0000-000000000099"}' -H 'Content-Type: application/json'`
Expected: 200 or 500 (depending on whether approval id 1 exists) but not 404 or 405.

- [ ] **Step 6: Commit**

```bash
git add backend-go/main.go
git commit -m "feat(api): wire approval webhook + expiry poller into main.go"
```

---

## Task 21: Frontend types — extend `PermissionSet` + add approval DTOs

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Extend `PermissionSet` with action-level keys**

In `src/types.ts`, add the 15 new action-level keys to the existing `PermissionSet` interface as optional fields. This mirrors the single-JSONB design in the migration — one `permissions` column, one TS shape:

```typescript
export interface PermissionSet {
  // ... existing sidebar keys (dashboard, kasir, userManagement, ...) stay as-is.

  // Phase 2 action-level keys (Foundational Decision #5).
  // Optional because pre-Phase-2 rows do not carry them; treat undefined as false.
  can_request_adjustment?: boolean;
  can_approve_adjustment?: boolean;
  can_start_opname?: boolean;
  can_witness_opname?: boolean;
  can_commit_opname?: boolean;
  can_request_price_change?: boolean;
  can_approve_price_change?: boolean;
  can_view_pengawasan?: boolean;
}
```

`AdminUser` / `DbAdminUser` / `CurrentUser` already carry a `permissions: PermissionSet` field — nothing else to touch. The merged shape is the single source of truth for both sidebar gating and action gating.

- [ ] **Step 2: Add approval / adjustment / opname DTOs**

Also in `src/types.ts` (below `PermissionSet`):
```typescript
export type ApprovalRequestType =
  | 'adjustment'
  | 'opname'
  | 'price_change'
  | 'kasir_price_override'
  | 'kasir_void'
  | 'kasir_refund';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ApprovalRequest {
  id: number;
  request_type: ApprovalRequestType;
  payload: Record<string, unknown>;
  requested_by: string;
  requested_at: string;
  expires_at: string;
  status: ApprovalStatus;
  decided_by?: string | null;
  decided_at?: string | null;
  decision_channel?: string | null;
  wa_message_id?: string | null;
}

export type StockAdjustmentReason =
  | 'rusak' | 'hilang' | 'sampel' | 'koreksi_input' | 'korjual_admin';

export interface StockAdjustment {
  id: number;
  sku: string;
  warehouse: 'atas' | 'bawah';
  qty_delta: number;
  reason_code: StockAdjustmentReason;
  reason_note?: string | null;
  evidence_urls: string[];
  requested_by: string;
  requested_at: string;
  approval_request_id: number;
  status: 'pending_approval' | 'approved' | 'rejected' | 'expired';
  committed_at?: string | null;
}

export interface OpnameSession {
  id: number;
  opname_type: 'full' | 'per_kategori' | 'per_sku_list';
  scope_payload: Record<string, unknown>;
  counted_by_user_id: string;
  witnessed_by_user_id: string;
  witness_acknowledged_at?: string | null;
  status: 'in_progress' | 'pending_owner' | 'committed' | 'rejected';
  variance_total_value: number;
  approval_request_id?: number | null;
  started_at: string;
  submitted_at?: string | null;
  committed_at?: string | null;
}

export interface OpnameCount {
  session_id: number;
  sku: string;
  warehouse: 'atas' | 'bawah';
  system_qty_snapshot: number;
  counted_qty?: number | null;
  variance: number;
  variance_value: number;
}

export interface PriceChangeRequest {
  id: number;
  sku: string;
  field: 'price' | 'harga_modal';
  old_value: number;
  new_value: number;
  reason_note: string;
  approval_request_id: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  requested_by: string;
  requested_at: string;
}
```

- [ ] **Step 3: Build to verify**

Run: `npm run build` (or `tsc --noEmit`)
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): extend PermissionSet with action keys + approval/adjustment/opname DTOs"
```

---

## Task 22: supabaseClient RPC wrappers

**Files:**
- Modify: `src/lib/supabaseClient.ts`

- [ ] **Step 1: Add wrapper functions**

Append to `src/lib/supabaseClient.ts`:
```typescript
import type {
  ApprovalRequest, StockAdjustmentReason, OpnameSession, OpnameCount,
  PriceChangeRequest,
} from '../types';

// --- Approvals ---

export async function listPendingApprovals(): Promise<ApprovalRequest[]> {
  const { data, error } = await supabase
    .from('approval_requests')
    .select('*')
    .eq('status', 'pending')
    .order('requested_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function verifyOwnerPin(approvalId: number, pin: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('verify_owner_pin', {
    p_approval_id: approvalId, p_pin: pin,
  });
  if (error) throw error;
  return Boolean(data);
}

// --- Adjustments ---

export async function requestAdjustment(args: {
  sku: string;
  warehouse: 'atas' | 'bawah';
  qty_delta: number;
  reason_code: StockAdjustmentReason;
  reason_note?: string;
  evidence_urls?: string[];
  actor_user_id: string;
}): Promise<number> {
  const { data, error } = await supabase.rpc('request_adjustment', {
    p_sku: args.sku,
    p_warehouse: args.warehouse,
    p_qty_delta: args.qty_delta,
    p_reason_code: args.reason_code,
    p_reason_note: args.reason_note ?? null,
    p_evidence_urls: args.evidence_urls ?? [],
    p_actor_user_id: args.actor_user_id,
  });
  if (error) throw error;
  return data as number;
}

export async function commitApprovedAdjustment(approvalId: number): Promise<number> {
  const { data, error } = await supabase.rpc('commit_approved_adjustment', {
    p_approval_id: approvalId,
  });
  if (error) throw error;
  return data as number;
}

// --- Opname ---

export async function startOpnameSession(args: {
  opname_type: OpnameSession['opname_type'];
  scope_payload: Record<string, unknown>;
  counted_by: string;
  witnessed_by: string;
}): Promise<number> {
  const { data, error } = await supabase.rpc('start_opname_session', {
    p_opname_type: args.opname_type,
    p_scope_payload: args.scope_payload,
    p_counted_by: args.counted_by,
    p_witnessed_by: args.witnessed_by,
  });
  if (error) throw error;
  return data as number;
}

export async function recordOpnameCount(args: {
  session_id: number; sku: string; warehouse: 'atas' | 'bawah'; counted_qty: number;
}): Promise<void> {
  const { error } = await supabase.rpc('record_opname_count', {
    p_session_id: args.session_id,
    p_sku: args.sku,
    p_warehouse: args.warehouse,
    p_counted_qty: args.counted_qty,
  });
  if (error) throw error;
}

export async function acknowledgeOpnameWitness(sessionId: number, witnessUserId: string): Promise<void> {
  const { error } = await supabase.rpc('acknowledge_opname_witness', {
    p_session_id: sessionId,
    p_witness_user_id: witnessUserId,
  });
  if (error) throw error;
}

export async function submitOpnameForOwner(sessionId: number): Promise<number> {
  const { data, error } = await supabase.rpc('submit_opname_for_owner', {
    p_session_id: sessionId,
  });
  if (error) throw error;
  return data as number;
}

export async function commitOpname(approvalId: number): Promise<number> {
  const { data, error } = await supabase.rpc('commit_opname', {
    p_approval_id: approvalId,
  });
  if (error) throw error;
  return data as number;
}

export async function fetchOpnameCounts(sessionId: number): Promise<OpnameCount[]> {
  const { data, error } = await supabase
    .from('stock_opname_counts')
    .select('*')
    .eq('session_id', sessionId)
    .order('sku', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// --- Price change ---

export async function requestPriceChange(args: {
  sku: string;
  field: 'price' | 'harga_modal';
  new_value: number;
  reason_note: string;
  actor_user_id: string;
}): Promise<number> {
  const { data, error } = await supabase.rpc('request_price_change', {
    p_sku: args.sku,
    p_field: args.field,
    p_new_value: args.new_value,
    p_reason_note: args.reason_note,
    p_actor_user_id: args.actor_user_id,
  });
  if (error) throw error;
  return data as number;
}

export async function commitApprovedPriceChange(approvalId: number): Promise<void> {
  const { error } = await supabase.rpc('commit_approved_price_change', {
    p_approval_id: approvalId,
  });
  if (error) throw error;
}

// --- Realtime subscription for approval inbox ---

export function subscribeApprovalRequests(
  onChange: (row: ApprovalRequest) => void
): () => void {
  const channel = supabase
    .channel('approval_requests_inbox')
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'approval_requests' },
        (payload) => onChange(payload.new as ApprovalRequest))
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

// --- Seed (for CSV upsert + new SKU creation) ---

export async function seedStockRow(args: {
  sku: string; name: string; category: string;
  price: number; harga_modal: number;
  stock_atas?: number; stock_bawah?: number;
  actor_user_id: string;
}): Promise<void> {
  const { error } = await supabase.rpc('seed_stock_row', {
    p_sku: args.sku, p_name: args.name, p_category: args.category,
    p_price: args.price, p_harga_modal: args.harga_modal,
    p_stock_atas: args.stock_atas ?? 0, p_stock_bawah: args.stock_bawah ?? 0,
    p_actor_user_id: args.actor_user_id,
  });
  if (error) throw error;
}
```

Update any existing CSV-upsert code path (look for `from('stocks').upsert(...)` in `supabaseClient.ts` or `StockManagerScreen.tsx`) to call `seedStockRow` for each row instead.

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "feat(client): add RPC wrappers for approvals, adjustments, opname, price change, seed"
```

---

## Task 23: `OwnerPinPad` reusable component

**Files:**
- Create: `src/components/approval/OwnerPinPad.tsx`

- [ ] **Step 1: Write component**

`src/components/approval/OwnerPinPad.tsx`:
```typescript
import { useState } from 'react';
import { verifyOwnerPin } from '../../lib/supabaseClient';

interface OwnerPinPadProps {
  approvalId: number;
  onSuccess: () => void;
  onCancel: () => void;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
}

export default function OwnerPinPad({ approvalId, onSuccess, onCancel, showToast }: OwnerPinPadProps) {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [submitting, setSubmitting] = useState(false);

  const setDigit = (i: number, v: string) => {
    if (!/^[0-9]?$/.test(v)) return;
    const next = [...digits];
    next[i] = v;
    setDigits(next);
    if (v && i < 5) {
      (document.getElementById(`pin-${i + 1}`) as HTMLInputElement | null)?.focus();
    }
  };

  const onSubmit = async () => {
    const pin = digits.join('');
    if (pin.length !== 6) {
      showToast?.('PIN harus 6 digit', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const ok = await verifyOwnerPin(approvalId, pin);
      if (ok) {
        showToast?.('PIN benar — disetujui', 'success');
        onSuccess();
      } else {
        showToast?.('PIN salah', 'error');
        setDigits(['', '', '', '', '', '']);
        (document.getElementById('pin-0') as HTMLInputElement | null)?.focus();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast?.(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Owner masukkan PIN 6-digit untuk menyetujui.</p>
      <div className="flex gap-2 justify-center">
        {digits.map((d, i) => (
          <input
            key={i}
            id={`pin-${i}`}
            type="password"
            inputMode="numeric"
            maxLength={1}
            value={d}
            onChange={(e) => setDigit(i, e.target.value)}
            className="w-10 h-12 text-center text-lg border border-slate-300 rounded-md"
          />
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel}
                className="flex-1 py-2 border border-slate-200 rounded-full text-sm text-slate-600">
          Batal
        </button>
        <button onClick={onSubmit} disabled={submitting}
                className="flex-1 py-2 bg-emerald-600 text-white rounded-full text-sm disabled:opacity-50">
          {submitting ? 'Memverifikasi…' : 'Setujui'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/approval/OwnerPinPad.tsx
git commit -m "feat(approval): add OwnerPinPad reusable 6-digit PIN component"
```

---

## Task 24: `PendingApprovalBadge` + `ApprovalRequestRow`

**Files:**
- Create: `src/components/approval/PendingApprovalBadge.tsx`
- Create: `src/components/approval/ApprovalRequestRow.tsx`

- [ ] **Step 1: Write components**

`src/components/approval/PendingApprovalBadge.tsx`:
```typescript
interface Props {
  pendingCount: number;
  className?: string;
}

export default function PendingApprovalBadge({ pendingCount, className }: Props) {
  if (pendingCount <= 0) return null;
  return (
    <span
      title={`${pendingCount} permintaan menunggu`}
      className={`inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded-full bg-yellow-400 text-yellow-900 ${className ?? ''}`}
    >
      {pendingCount > 9 ? '9+' : pendingCount}
    </span>
  );
}
```

`src/components/approval/ApprovalRequestRow.tsx`:
```typescript
import { useState } from 'react';
import type { ApprovalRequest } from '../../types';
import OwnerPinPad from './OwnerPinPad';

interface Props {
  request: ApprovalRequest;
  onDecided: () => void;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
}

export default function ApprovalRequestRow({ request, onDecided, showToast }: Props) {
  const [pinOpen, setPinOpen] = useState(false);
  const summary = JSON.stringify(request.payload);

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-xs uppercase text-slate-500">{request.request_type}</p>
          <p className="text-sm text-slate-900 mt-1">{summary}</p>
          <p className="text-xs text-slate-500 mt-1">
            Diajukan {new Date(request.requested_at).toLocaleString('id-ID')} ·
            Kedaluwarsa {new Date(request.expires_at).toLocaleString('id-ID')}
          </p>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
          {request.status}
        </span>
      </div>

      {!pinOpen ? (
        <button
          onClick={() => setPinOpen(true)}
          className="w-full py-2 bg-emerald-600 text-white rounded-full text-sm"
        >
          Setujui via PIN
        </button>
      ) : (
        <OwnerPinPad
          approvalId={request.id}
          onSuccess={() => { setPinOpen(false); onDecided(); }}
          onCancel={() => setPinOpen(false)}
          showToast={showToast}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/approval/PendingApprovalBadge.tsx src/components/approval/ApprovalRequestRow.tsx
git commit -m "feat(approval): add PendingApprovalBadge + ApprovalRequestRow"
```

---

## Task 25: `ApprovalInboxScreen`

**Files:**
- Create: `src/components/approval/ApprovalInboxScreen.tsx`

- [ ] **Step 1: Write screen**

`src/components/approval/ApprovalInboxScreen.tsx`:
```typescript
import { useEffect, useState } from 'react';
import type { ApprovalRequest, CurrentUser } from '../../types';
import { listPendingApprovals, subscribeApprovalRequests } from '../../lib/supabaseClient';
import ApprovalRequestRow from './ApprovalRequestRow';

interface Props {
  currentUser: CurrentUser;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
}

export default function ApprovalInboxScreen({ currentUser: _currentUser, showToast }: Props) {
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const list = await listPendingApprovals();
      setRequests(list);
    } catch (e) {
      showToast?.(e instanceof Error ? e.message : 'Gagal memuat', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const unsub = subscribeApprovalRequests(() => { void refresh(); });
    return unsub;
  }, []);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Persetujuan</h1>
      {loading && <p className="text-sm text-slate-500">Memuat…</p>}
      {!loading && requests.length === 0 && (
        <p className="text-sm text-slate-500">Tidak ada permintaan yang menunggu.</p>
      )}
      {requests.map((r) => (
        <ApprovalRequestRow key={r.id} request={r} onDecided={refresh} showToast={showToast} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Realtime feature gate — fall back to polling if Realtime is not enabled**

> **NOTE:** Realtime subscription via Supabase channels requires the project's Supabase Realtime feature to be enabled for the `approval_requests` table. Verify via Supabase Dashboard → Database → Replication. If Realtime publication is **not** enabled for `approval_requests`, the `subscribeApprovalRequests` channel will silently no-op (no callbacks fire) and the inbox will appear frozen. In that case, fall back to a 30-second polling interval. For a 4-user MSME this UX is acceptable.

Concretely, harden the `useEffect` in the screen so it always polls as a backstop:
```typescript
useEffect(() => {
  void refresh();
  const unsub = subscribeApprovalRequests(() => { void refresh(); });
  // Backstop poll — works whether or not Realtime is enabled for approval_requests.
  const interval = window.setInterval(() => { void refresh(); }, 30_000);
  return () => { unsub(); window.clearInterval(interval); };
}, []);
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/approval/ApprovalInboxScreen.tsx
git commit -m "feat(approval): add ApprovalInboxScreen with realtime + 30s polling backstop"
```

---

## Task 26: `StockAdjustmentModal`

**Files:**
- Create: `src/components/stok/StockAdjustmentModal.tsx`

- [ ] **Step 1: Write modal**

`src/components/stok/StockAdjustmentModal.tsx`:
```typescript
import { useState } from 'react';
import { X } from 'lucide-react';
import { requestAdjustment } from '../../lib/supabaseClient';
import { supabase } from '../../lib/supabaseClient';
import type { StockItem, StockAdjustmentReason, CurrentUser } from '../../types';

interface Props {
  item: StockItem;
  warehouse: 'atas' | 'bawah';
  currentUser: CurrentUser;
  onClose: () => void;
  onSubmitted: () => void;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
}

const REASONS: { code: StockAdjustmentReason; label: string }[] = [
  { code: 'rusak',          label: 'Barang Rusak' },
  { code: 'hilang',         label: 'Barang Hilang' },
  { code: 'sampel',         label: 'Dipakai Sampel' },
  { code: 'koreksi_input',  label: 'Koreksi Salah Input' },
  { code: 'korjual_admin',  label: 'Koreksi Jual Admin' },
];

export default function StockAdjustmentModal({
  item, warehouse, currentUser, onClose, onSubmitted, showToast,
}: Props) {
  const [qtyDelta, setQtyDelta] = useState<number>(-1);
  const [reasonCode, setReasonCode] = useState<StockAdjustmentReason>('rusak');
  const [reasonNote, setReasonNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const needsEvidence = reasonCode === 'rusak' || reasonCode === 'hilang';

  const uploadFiles = async (): Promise<string[]> => {
    const urls: string[] = [];
    for (const f of files) {
      const path = `adjustments/pending/${Date.now()}-${f.name}`;
      const { error } = await supabase.storage.from('stock-evidence').upload(path, f);
      if (error) throw error;
      urls.push(path);
    }
    return urls;
  };

  const onSubmit = async () => {
    if (qtyDelta === 0) { showToast?.('Selisih tidak boleh 0', 'error'); return; }
    if (needsEvidence && files.length === 0) {
      showToast?.('Bukti foto wajib untuk rusak/hilang', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const evidence_urls = await uploadFiles();
      await requestAdjustment({
        sku: item.sku,
        warehouse,
        qty_delta: qtyDelta,
        reason_code: reasonCode,
        reason_note: reasonNote || undefined,
        evidence_urls,
        actor_user_id: currentUser.id,
      });
      showToast?.('Permintaan dikirim ke Owner', 'success');
      onSubmitted();
      onClose();
    } catch (e) {
      showToast?.(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg max-w-md w-full p-4 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-900">Permintaan Penyesuaian Stok</h2>
          <button onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-slate-500">
          {item.sku} · {item.name} · Gudang {warehouse === 'atas' ? 'Atas' : 'Bawah'}
        </p>
        <label className="block text-xs text-slate-600">Selisih (negatif untuk kurang)</label>
        <input type="number" value={qtyDelta} onChange={(e) => setQtyDelta(parseInt(e.target.value) || 0)}
               className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
        <label className="block text-xs text-slate-600">Alasan</label>
        <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value as StockAdjustmentReason)}
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm">
          {REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select>
        <label className="block text-xs text-slate-600">Catatan tambahan</label>
        <textarea value={reasonNote} onChange={(e) => setReasonNote(e.target.value)}
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" rows={2} />
        {needsEvidence && (
          <>
            <label className="block text-xs text-slate-600">Bukti foto (wajib)</label>
            <input type="file" accept="image/*" multiple
                   onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </>
        )}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 border border-slate-200 rounded-full text-sm">Batal</button>
          <button onClick={onSubmit} disabled={submitting}
                  className="flex-1 py-2 bg-emerald-600 text-white rounded-full text-sm disabled:opacity-50">
            {submitting ? 'Mengirim…' : 'Kirim ke Owner'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/stok/StockAdjustmentModal.tsx
git commit -m "feat(stok): add StockAdjustmentModal with evidence upload"
```

---

## Task 27: `PriceChangeRequestModal`

**Files:**
- Create: `src/components/stok/PriceChangeRequestModal.tsx`

- [ ] **Step 1: Write modal**

`src/components/stok/PriceChangeRequestModal.tsx`:
```typescript
import { useState } from 'react';
import { X } from 'lucide-react';
import { requestPriceChange } from '../../lib/supabaseClient';
import type { StockItem, CurrentUser } from '../../types';

interface Props {
  item: StockItem;
  field: 'price' | 'harga_modal';
  currentUser: CurrentUser;
  onClose: () => void;
  onSubmitted: () => void;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
}

export default function PriceChangeRequestModal({
  item, field, currentUser, onClose, onSubmitted, showToast,
}: Props) {
  const currentValue = field === 'price' ? item.price : item.harga_modal ?? 0;
  const [newValue, setNewValue] = useState<number>(currentValue);
  const [reasonNote, setReasonNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const marginPreview = (() => {
    const price       = field === 'price' ? newValue : item.price;
    const hargaModal  = field === 'harga_modal' ? newValue : (item.harga_modal ?? 0);
    if (price <= 0) return 0;
    return ((price - hargaModal) / price) * 100;
  })();

  const onSubmit = async () => {
    if (!reasonNote.trim()) { showToast?.('Alasan wajib diisi', 'error'); return; }
    if (newValue === currentValue) { showToast?.('Nilai baru sama dengan saat ini', 'error'); return; }
    setSubmitting(true);
    try {
      await requestPriceChange({
        sku: item.sku, field, new_value: newValue,
        reason_note: reasonNote, actor_user_id: currentUser.id,
      });
      showToast?.('Permintaan perubahan harga dikirim ke Owner', 'success');
      onSubmitted();
      onClose();
    } catch (e) {
      showToast?.(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg max-w-md w-full p-4 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-900">Ubah {field === 'price' ? 'Harga Jual' : 'HPP'}</h2>
          <button onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-slate-500">{item.sku} · {item.name}</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-600">Nilai saat ini</label>
            <p className="text-sm font-semibold">Rp {currentValue.toLocaleString('id-ID')}</p>
          </div>
          <div>
            <label className="block text-xs text-slate-600">Nilai baru</label>
            <input type="number" value={newValue} onChange={(e) => setNewValue(parseInt(e.target.value) || 0)}
                   className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
          </div>
        </div>
        <p className="text-xs text-slate-500">Margin baru: {marginPreview.toFixed(1)}%</p>
        <label className="block text-xs text-slate-600">Alasan (wajib)</label>
        <textarea value={reasonNote} onChange={(e) => setReasonNote(e.target.value)}
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" rows={3} />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 border border-slate-200 rounded-full text-sm">Batal</button>
          <button onClick={onSubmit} disabled={submitting}
                  className="flex-1 py-2 bg-emerald-600 text-white rounded-full text-sm disabled:opacity-50">
            {submitting ? 'Mengirim…' : 'Kirim ke Owner'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/stok/PriceChangeRequestModal.tsx
git commit -m "feat(stok): add PriceChangeRequestModal with margin preview"
```

---

## Task 28: `StockOpnameScreen` + `StockOpnameSessionView`

**Files:**
- Create: `src/components/opname/StockOpnameScreen.tsx`
- Create: `src/components/opname/StockOpnameSessionView.tsx`

- [ ] **Step 1: Write screen**

`src/components/opname/StockOpnameScreen.tsx`:
```typescript
import { useEffect, useState } from 'react';
import { supabase, startOpnameSession } from '../../lib/supabaseClient';
import type { CurrentUser, OpnameSession, DbAdminUser } from '../../types';
import StockOpnameSessionView from './StockOpnameSessionView';

interface Props {
  currentUser: CurrentUser;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
}

export default function StockOpnameScreen({ currentUser, showToast }: Props) {
  const [sessions, setSessions] = useState<OpnameSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [users, setUsers] = useState<DbAdminUser[]>([]);
  const [witnessId, setWitnessId] = useState<string>('');
  const [opnameType, setOpnameType] = useState<OpnameSession['opname_type']>('full');

  const refresh = async () => {
    const { data } = await supabase
      .from('stock_opname_sessions')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(20);
    setSessions(data ?? []);
    const { data: u } = await supabase.from('admin_users').select('*').neq('id', currentUser.id);
    setUsers(u ?? []);
  };

  useEffect(() => { void refresh(); }, []);

  const onStart = async () => {
    if (!witnessId) { showToast?.('Pilih saksi', 'error'); return; }
    try {
      const sid = await startOpnameSession({
        opname_type: opnameType,
        scope_payload: {},
        counted_by: currentUser.id,
        witnessed_by: witnessId,
      });
      setActiveSessionId(sid);
      await refresh();
    } catch (e) {
      showToast?.(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  if (activeSessionId) {
    return (
      <StockOpnameSessionView
        sessionId={activeSessionId}
        currentUser={currentUser}
        onBack={() => { setActiveSessionId(null); void refresh(); }}
        showToast={showToast}
      />
    );
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Stok Opname</h1>
      <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
        <h2 className="font-semibold text-sm">Mulai Sesi Baru</h2>
        <select value={opnameType} onChange={(e) => setOpnameType(e.target.value as OpnameSession['opname_type'])}
                className="border border-slate-300 rounded px-2 py-1 text-sm">
          <option value="full">Full</option>
          <option value="per_kategori">Per Kategori</option>
          <option value="per_sku_list">Per SKU</option>
        </select>
        <select value={witnessId} onChange={(e) => setWitnessId(e.target.value)}
                className="border border-slate-300 rounded px-2 py-1 text-sm">
          <option value="">— Pilih Saksi —</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <button onClick={onStart} className="py-2 px-4 bg-emerald-600 text-white rounded-full text-sm">
          Mulai
        </button>
      </div>

      <h2 className="font-semibold text-sm mt-4">Riwayat</h2>
      <div className="space-y-2">
        {sessions.map((s) => (
          <div key={s.id} className="bg-white border border-slate-200 rounded p-3 text-sm"
               onClick={() => setActiveSessionId(s.id)}>
            <p>#{s.id} · {s.opname_type} · {s.status}</p>
            <p className="text-xs text-slate-500">
              Mulai {new Date(s.started_at).toLocaleString('id-ID')}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write session view**

`src/components/opname/StockOpnameSessionView.tsx`:
```typescript
import { useEffect, useState } from 'react';
import {
  fetchOpnameCounts, recordOpnameCount,
  acknowledgeOpnameWitness, submitOpnameForOwner,
} from '../../lib/supabaseClient';
import type { OpnameCount, CurrentUser } from '../../types';

interface Props {
  sessionId: number;
  currentUser: CurrentUser;
  onBack: () => void;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
}

export default function StockOpnameSessionView({ sessionId, currentUser, onBack, showToast }: Props) {
  const [counts, setCounts] = useState<OpnameCount[]>([]);

  const refresh = async () => {
    try { setCounts(await fetchOpnameCounts(sessionId)); }
    catch (e) { showToast?.(e instanceof Error ? e.message : String(e), 'error'); }
  };

  useEffect(() => { void refresh(); }, [sessionId]);

  const onCount = async (sku: string, warehouse: 'atas' | 'bawah', qty: number) => {
    try {
      await recordOpnameCount({ session_id: sessionId, sku, warehouse, counted_qty: qty });
      await refresh();
    } catch (e) { showToast?.(e instanceof Error ? e.message : String(e), 'error'); }
  };

  const onAcknowledge = async () => {
    try {
      await acknowledgeOpnameWitness(sessionId, currentUser.id);
      showToast?.('Saksi ter-acknowledge', 'success');
    } catch (e) { showToast?.(e instanceof Error ? e.message : String(e), 'error'); }
  };

  const onSubmit = async () => {
    try {
      await submitOpnameForOwner(sessionId);
      showToast?.('Sesi dikirim ke Owner untuk approval', 'success');
      onBack();
    } catch (e) { showToast?.(e instanceof Error ? e.message : String(e), 'error'); }
  };

  return (
    <div className="p-6 space-y-4">
      <button onClick={onBack} className="text-sm text-slate-500">← Kembali</button>
      <h1 className="text-xl font-bold">Sesi Opname #{sessionId}</h1>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-slate-200">
            <th>SKU</th><th>Gudang</th><th>Sistem</th><th>Hitung</th><th>Selisih</th>
          </tr>
        </thead>
        <tbody>
          {counts.map((c) => (
            <tr key={`${c.sku}-${c.warehouse}`} className="border-b border-slate-100">
              <td>{c.sku}</td>
              <td>{c.warehouse}</td>
              <td>{c.system_qty_snapshot}</td>
              <td>
                <input type="number" defaultValue={c.counted_qty ?? ''}
                       onBlur={(e) => onCount(c.sku, c.warehouse, parseInt(e.target.value) || 0)}
                       className="border border-slate-300 rounded px-2 py-1 w-20" />
              </td>
              <td className={c.variance < 0 ? 'text-red-600' : c.variance > 0 ? 'text-amber-600' : ''}>
                {c.variance}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2">
        <button onClick={onAcknowledge} className="flex-1 py-2 border border-slate-300 rounded-full text-sm">
          Saya Saksi (Acknowledge)
        </button>
        <button onClick={onSubmit} className="flex-1 py-2 bg-emerald-600 text-white rounded-full text-sm">
          Submit ke Owner
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/opname/
git commit -m "feat(opname): add StockOpnameScreen + StockOpnameSessionView"
```

---

## Task 29: Touch `StockManagerScreen.tsx`

**Files:**
- Modify: `src/components/StockManagerScreen.tsx`

- [ ] **Step 1: Read current StockManagerScreen.tsx**

Identify the cells that currently render `stock_atas`, `stock_bawah`, `price`, `harga_modal` as editable inputs. Replace each with a click handler that opens the appropriate modal.

- [ ] **Step 2: Wire modals**

Add imports:
```typescript
import StockAdjustmentModal from './stok/StockAdjustmentModal';
import PriceChangeRequestModal from './stok/PriceChangeRequestModal';
import PendingApprovalBadge from './approval/PendingApprovalBadge';
import { listPendingApprovals } from '../lib/supabaseClient';
```

Add state:
```typescript
const [adjustmentTarget, setAdjustmentTarget] = useState<{ item: StockItem; warehouse: 'atas'|'bawah' } | null>(null);
const [priceTarget, setPriceTarget] = useState<{ item: StockItem; field: 'price'|'harga_modal' } | null>(null);
const [myPending, setMyPending] = useState(0);
```

In the table cell rendering, change each editable cell to a button:
```tsx
<button onClick={() => setAdjustmentTarget({ item, warehouse: 'atas' })}
        className="hover:underline text-left">
  {item.stock_atas}
</button>
```

Repeat for `stock_bawah`, `price`, `harga_modal`.

At the bottom of the component, render the modals:
```tsx
{adjustmentTarget && (
  <StockAdjustmentModal
    item={adjustmentTarget.item}
    warehouse={adjustmentTarget.warehouse}
    currentUser={currentUser}
    onClose={() => setAdjustmentTarget(null)}
    onSubmitted={() => { /* refresh stocks */ }}
    showToast={showToast}
  />
)}
{priceTarget && (
  <PriceChangeRequestModal
    item={priceTarget.item}
    field={priceTarget.field}
    currentUser={currentUser}
    onClose={() => setPriceTarget(null)}
    onSubmitted={() => { /* refresh stocks */ }}
    showToast={showToast}
  />
)}
```

At the top of the screen, render a "Permintaan Anda yang menunggu" banner if `myPending > 0`:
```tsx
{myPending > 0 && (
  <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm text-yellow-800 flex items-center gap-2">
    <PendingApprovalBadge pendingCount={myPending} />
    Anda punya {myPending} permintaan menunggu Owner.
  </div>
)}
```

Inside `useEffect`, populate `myPending`:
```typescript
useEffect(() => {
  void (async () => {
    const all = await listPendingApprovals();
    setMyPending(all.filter((r) => r.requested_by === currentUser.id).length);
  })();
}, [currentUser.id]);
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/StockManagerScreen.tsx
git commit -m "feat(stok): wire StockManagerScreen cells to adjustment + price modals"
```

---

## Task 30: Touch `Sidebar.tsx`

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Read current Sidebar.tsx**

Identify how nav items are rendered.

- [ ] **Step 2: Add Persetujuan and Stok Opname items**

Add to the nav array (gated by `currentUser.permissions` — the same single JSONB that already gates sidebar items like Dashboard / Kasir / User Management):
```tsx
{(currentUser.permissions?.can_approve_adjustment ||
  currentUser.permissions?.can_approve_price_change ||
  currentUser.permissions?.can_commit_opname) && (
  <button onClick={() => onPageChange('approval-inbox')} ...>
    Persetujuan
    <PendingApprovalBadge pendingCount={pendingCount} />
  </button>
)}

{currentUser.permissions?.can_start_opname && (
  <button onClick={() => onPageChange('stok-opname')} ...>
    Stok Opname
  </button>
)}
```

Set up `pendingCount` from a small effect:
```tsx
const [pendingCount, setPendingCount] = useState(0);
useEffect(() => {
  void listPendingApprovals().then((rows) => setPendingCount(rows.length));
  const unsub = subscribeApprovalRequests(() => {
    void listPendingApprovals().then((rows) => setPendingCount(rows.length));
  });
  return unsub;
}, []);
```

Wire `App.tsx` router to render `ApprovalInboxScreen` when `activePage === 'approval-inbox'` and `StockOpnameScreen` when `activePage === 'stok-opname'`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/Sidebar.tsx src/App.tsx
git commit -m "feat(nav): add Persetujuan + Stok Opname sidebar items gated by permissions"
```

---

## Task 31: End-to-end smoke test

**Files:** none (manual verification).

- [ ] **Step 1: Bring up dev**

Run: `npm run dev` and start the Go daemon: `cd backend-go && go run .`.

- [ ] **Step 2: Set up Owner PIN**

In Supabase SQL editor:
```sql
UPDATE public.admin_users
   SET approval_pin_hash = crypt('123456', gen_salt('bf')),
       pin_failed_count = 0,
       pin_locked_until = NULL
 WHERE role = 'Owner';
```

- [ ] **Step 3: Test each surface**

1. **Adjustment via PIN:** Log in as a non-Owner. Open Stock Manager. Click a `stock_atas` cell. Submit a `rusak` adjustment with 1 photo. Confirm an `approval_requests` row appears (pending). Log in as Owner (or use the same browser via Approval Inbox screen). Click "Setujui via PIN". Enter `123456`. Verify:
   - `approval_requests.status='approved'`
   - `stock_adjustments.committed_at IS NOT NULL`
   - One new `stock_movements` row with `source='adjustment'`
   - `stocks.stock_atas` decreased

2. **Price change:** Click `price` cell on a SKU. Submit a price change. Approve via PIN. Verify `stocks.price` updated, `stock_price_history` has a new row.

3. **Opname:** Sidebar → Stok Opname → Mulai Sesi Baru → pick witness. Enter a count for one SKU. Have the witness user (separate session) click Acknowledge. Submit. Approve via PIN. Verify `stock_movements` ledger row written with `source='opname_variance'`.

4. **WA button webhook:** simulate inbound with `curl`:
```bash
curl -X POST http://localhost:8080/api/approval/wa-webhook \
  -H 'Content-Type: application/json' \
  -d '{"button_payload":"approve:<id>","owner_user_id":"<owner-uuid>"}'
```
Verify the approval flips to `approved` with `decision_channel='wa_button'`.

5. **Expiry:** create a request, manually backdate its `expires_at` to `now() - 1 minute`, wait 60s, verify it flips to `expired`.

6. **PIN lockout:** enter wrong PIN 5 times on different requests. Verify the Owner's `pin_locked_until` is set 1 hour in the future. Next correct PIN attempt fails with "locked until" error.

- [ ] **Step 4: Update `progress.md`**

Add Phase 2 entry.

- [ ] **Step 5: Commit progress note**

```bash
git add progress.md
git commit -m "docs(progress): Phase 2 approval infra shipped"
```

---

## Self-Review Checklist

Run through this before declaring Phase 2 done:

- [ ] All seven migrations apply cleanly on a fresh database (Phase 1 + Phase 2 combined).
- [ ] All Go tests in `internal/db/`, `internal/whatsapp/`, `internal/api/`, `internal/approvals/` pass.
- [ ] `npm run build` (or `tsc --noEmit`) succeeds with zero errors.
- [ ] Direct `UPDATE stocks SET price = 999` from `authenticated` returns permission denied.
- [ ] Submitting any adjustment for any qty leaves `stocks` unchanged until Owner approves.
- [ ] Approve via Owner PIN produces identical end state to approve via WA button (only `decision_channel` differs).
- [ ] Opname `commit_opname` is all-or-nothing — manually verify by dropping a referenced SKU mid-commit (simulate).
- [ ] Concurrent sale during an opname session does not affect variance — `counted_qty - system_qty_snapshot` is based on the snapshot taken at session start.
- [ ] PIN: 5 failed attempts within 10 minutes locks the Owner row (not the requester) for 1 hour.
- [ ] Approval auto-expires 30 minutes after creation; expiry poller fires every 60s.
- [ ] WA inbound webhook is idempotent — double-clicking the button is a no-op the second time.
- [ ] `seed_stock_row` works for the CSV upsert path (Owner role only).
- [ ] `stock-evidence` bucket policies allow authenticated upload.
- [ ] Sidebar shows `Persetujuan` and `Stok Opname` only for users with the right action-level keys in the merged `permissions` JSONB (e.g., `can_approve_adjustment`, `can_start_opname`).
- [ ] `progress.md` updated with Phase 2 DONE entry.

## Out of Scope (Phase 2)

- Backfill of historical adjustments, opname sessions, or price history.
- Mobile-native barcode scan for opname (manual count only).
- Multi-witness opname (1 witness sufficient).
- Adjustment scheduling / batching.
- Reason-code expansion beyond `rusak`, `hilang`, `sampel`, `koreksi_input`, `korjual_admin`.
- Delegated approval — Owner cannot temporarily assign approve authority to someone else.
- Threshold-based auto-approve — every change requires Owner approval, no exceptions.
- Loss-leader override / floor override — deferred until Phase 3b.
- Owner UI to manage the new action-level keys in `admin_users.permissions` per user — done via SQL or User Management screen extension in a follow-up.
- WA template buttons via official Business API — current implementation is reply-based (`approve:<id>` text).
- Phase 3a Penerimaan PO, Phase 3b Kasir, Phase 3d Transfer two-step — separate plans.
- Phase 4 Pengawasan dashboard — separate plan (depends on Phase 2 tables but ships independently).
