# Piutang Write-Off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a two-step Owner-approved write-off flow for uncollectible tempo (credit) invoices, plus a one-click Owner revert path.

**Architecture:** Mirror the existing `rakit_lock` approval workflow. 4 SQL migrations register a new `piutang_write_off` request type into the existing `approval_requests` framework with a satellite table for narrative reason, then ship request/approve/reject/revert RPCs (all `SECURITY DEFINER`, `auth.uid()` bound, Owner+`Aktif` filter). Frontend adds 4 thin lib wrappers, extends `fetchPiutangRows` for the new `Tulis-off` filter pill, adds 2 new components (WriteOffRequestModal + TempoWriteOffApprovalRequestRow), and extends PiutangScreen + ApprovalInboxScreen dispatch.

**Tech Stack:** React + TypeScript (Vite); Vitest only (no RTL, no jsdom); Tailwind v4 theme tokens in `src/index.css`; Supabase (Postgres + RLS + Realtime); migration slot range claimed `20260626000020-023`; backend SQL smoke via Supabase MCP `apply_migration` + `execute_sql` with `set_config('request.jwt.claims', …)` to simulate caller identity (PR #34 pattern).

**Working dir:** `/Users/tonywei/IdeaProjects/ERPAntigravity`
**Worktree:** `.claude/worktrees/piutang-write-off` (already created off `origin/main`)
**Branch:** `feat/piutang-write-off`

---

## File Structure

| Layer | File | Status |
|---|---|---|
| Migration | `supabase/migrations/20260626000020_extend_approval_for_piutang_write_off.sql` | NEW |
| Migration | `supabase/migrations/20260626000021_request_tempo_write_off_rpc.sql` | NEW |
| Migration | `supabase/migrations/20260626000022_approve_reject_tempo_write_off_rpcs.sql` | NEW |
| Migration | `supabase/migrations/20260626000023_revert_tempo_write_off_rpc.sql` | NEW |
| Types | `src/types.ts` | MODIFY (extend `ApprovalRequestType` union; add `DbPiutangWriteOffRequest`) |
| Lib | `src/lib/piutang/writeOff.ts` | NEW (4 wrappers — kept in sibling module like `rakitLockOwnerEdit.ts` so `vi.mock('../supabaseClient')` works) |
| Lib | `src/lib/piutangService.ts` | MODIFY (extend `fetchPiutangRows`) |
| Lib test | `src/lib/__tests__/piutangWriteOffWrappers.test.ts` | NEW |
| Lib test | `src/lib/__tests__/piutangService.writeOff.test.ts` | NEW (only the `includeWrittenOff` extension) |
| Component | `src/components/piutang/WriteOffRequestModal.tsx` | NEW |
| Component | `src/components/piutang/RevertWriteOffConfirmModal.tsx` | NEW (small destructive confirm) |
| Component | `src/components/piutang/PiutangScreen.tsx` | MODIFY (6th pill, two new buttons, modal wires) |
| Component | `src/components/approval/TempoWriteOffApprovalRequestRow.tsx` | NEW |
| Component | `src/components/approval/ApprovalInboxScreen.tsx` | MODIFY (dispatch + reject branch) |
| Docs | `progress.md` | MODIFY (per CLAUDE.md gotcha) |

---

## Milestone Pre-flight

### Task 0: Verify worktree + baseline green

**Files:** none (just verification)

- [ ] **Step 1: Confirm worktree state**

Run: `cd /Users/tonywei/IdeaProjects/ERPAntigravity/.claude/worktrees/piutang-write-off && git status --short && git rev-parse --abbrev-ref HEAD`
Expected: clean working tree, branch `feat/piutang-write-off`, HEAD at spec commit `c591292`.

- [ ] **Step 2: Baseline vitest + tsc + build**

Run: `npm test -- --run`
Expected: all tests pass (current baseline before any changes).

Run: `npx tsc --noEmit`
Expected: no output (zero errors).

Run: `npm run build`
Expected: `✓ built in …s` line; no errors.

If any of these fail before changes are made, STOP and surface to the user — the worktree is in a bad state.

---

## Milestone A — Backend migrations

### Task 1: Migration 020 — extend enum + satellite table

**Files:**
- Create: `supabase/migrations/20260626000020_extend_approval_for_piutang_write_off.sql`

- [ ] **Step 1: Write the migration**

Write to `supabase/migrations/20260626000020_extend_approval_for_piutang_write_off.sql`:

```sql
-- 20260626000020_extend_approval_for_piutang_write_off.sql
-- Phase 1C task 2 — Piutang write-off groundwork.
-- (a) Register new approval_request_type value.
-- (b) Create satellite table holding the narrative reason.
-- (c) Partial unique index: at most one PENDING write-off per order.

ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'piutang_write_off';

CREATE TABLE IF NOT EXISTS public.piutang_write_off_requests (
  approval_id BIGINT PRIMARY KEY
              REFERENCES public.approval_requests(id) ON DELETE CASCADE,
  order_id    UUID NOT NULL REFERENCES public.orders(id),
  reason      TEXT NOT NULL CHECK (length(btrim(reason)) >= 10),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Find-by-order is the common access pattern (e.g., race check in approve RPC,
-- duplicate guard in request RPC). Btree on order_id covers both.
CREATE INDEX IF NOT EXISTS idx_piutang_write_off_requests_order
  ON public.piutang_write_off_requests(order_id);

-- Enforce "at most one pending write-off request per order". Plain UNIQUE on
-- order_id would block resubmission after rejection. Partial unique on the
-- subset of rows whose approval is still 'pending' allows admin to retry after
-- a reject.
CREATE UNIQUE INDEX IF NOT EXISTS uq_piutang_write_off_pending_order
  ON public.piutang_write_off_requests(order_id)
  WHERE approval_id IN (
    SELECT id FROM public.approval_requests WHERE status = 'pending'
  );

GRANT SELECT, INSERT ON public.piutang_write_off_requests TO authenticated;

COMMENT ON TABLE public.piutang_write_off_requests IS
  'Satellite for approval_requests of type piutang_write_off. Carries the narrative reason.';
```

- [ ] **Step 2: Apply via Supabase MCP**

Use the Supabase MCP `apply_migration` tool with name `extend_approval_for_piutang_write_off` and the SQL body above.
Expected: `{"success":true}`.

If the partial unique index complains about the subquery (Postgres rejects subqueries in index predicates), fall back to enforcing the constraint via a BEFORE INSERT trigger on `piutang_write_off_requests` that raises `WRITE_OFF_ALREADY_PENDING` when a row already exists for the same `order_id` whose `approval_id` resolves to status='pending'. Document the fallback in the migration body and re-apply.

- [ ] **Step 3: Smoke-verify via execute_sql**

Use Supabase MCP `execute_sql`:

```sql
-- Enum value present?
SELECT 'piutang_write_off'::public.approval_request_type AS ok;

-- Table present?
SELECT to_regclass('public.piutang_write_off_requests') AS table_oid;

-- CHECK enforces reason length?
DO $$ BEGIN
  PERFORM 1; -- placeholder; the next test is a controlled negative
END $$;
```

Then run this negative smoke (expects raise):

```sql
SELECT public._smoke_piutang_writeoff_check();
-- not present yet — instead try a direct INSERT in a rolled-back tx:
BEGIN;
  INSERT INTO public.approval_requests (request_type, payload, requested_by)
  VALUES ('piutang_write_off', '{}'::jsonb, '00000000-0000-0000-0000-000000000099'::uuid)
  RETURNING id \gset
  -- Try short reason — should raise CHECK violation
  INSERT INTO public.piutang_write_off_requests (approval_id, order_id, reason)
  VALUES (:id, gen_random_uuid(), 'short');
ROLLBACK;
```

Expected: enum select returns `ok=piutang_write_off`; table_oid non-null; CHECK violation raised on the short-reason INSERT.

- [ ] **Step 4: Commit**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity/.claude/worktrees/piutang-write-off
git add supabase/migrations/20260626000020_extend_approval_for_piutang_write_off.sql
git commit -m "feat(piutang): migration 020 — extend approval_request_type + write-off satellite table

Adds 'piutang_write_off' enum value + piutang_write_off_requests satellite
(approval_id PK FK, order_id FK, reason TEXT CHECK len>=10, created_at).
Partial unique index enforces at most one PENDING write-off request per
order so admin can resubmit after a reject.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 2: Migration 021 — `request_tempo_write_off` RPC

**Files:**
- Create: `supabase/migrations/20260626000021_request_tempo_write_off_rpc.sql`

- [ ] **Step 1: Write the migration**

Write to `supabase/migrations/20260626000021_request_tempo_write_off_rpc.sql`:

```sql
-- 20260626000021_request_tempo_write_off_rpc.sql
-- Phase 1C task 2 — admin requests write-off of a tempo invoice.
-- Caller can be any authenticated user (admin or owner). Validates the order
-- is INVOICE_TEMPO; rejects with prefixed errors so the modal can pattern-match.

CREATE OR REPLACE FUNCTION public.request_tempo_write_off(
  p_order_id UUID,
  p_reason   TEXT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_caller   UUID;
  v_order    RECORD;
  v_approval BIGINT;
  -- Founder explicitly chose no-expiry for write-off approvals. The
  -- approval_requests.expires_at column is NOT NULL with a 30-min default, so
  -- we override here with a far-future value. The periodic expire_approval_requests
  -- job (20260607000020) only flips rows where expires_at <= now(); 9999 keeps
  -- the row alive indefinitely while preserving the NOT NULL invariant.
  v_no_expiry CONSTANT TIMESTAMPTZ := '9999-12-31 23:59:59+00';
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'OWNER_ONLY: no authenticated user';
  END IF;

  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  SELECT id, status, customer_id, total
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: %', p_order_id;
  END IF;
  IF v_order.status <> 'INVOICE_TEMPO' THEN
    RAISE EXCEPTION 'ORDER_NOT_TEMPO: cannot write off status=%', v_order.status;
  END IF;

  INSERT INTO public.approval_requests
    (request_type, payload, requested_by, expires_at)
  VALUES
    ('piutang_write_off'::public.approval_request_type,
     jsonb_build_object('order_id', p_order_id::text),
     v_caller,
     v_no_expiry)
  RETURNING id INTO v_approval;

  BEGIN
    INSERT INTO public.piutang_write_off_requests
      (approval_id, order_id, reason)
    VALUES (v_approval, p_order_id, btrim(p_reason));
  EXCEPTION WHEN unique_violation THEN
    -- Partial unique index hit — another pending request already exists.
    -- Surface a typed prefix the client can match.
    RAISE EXCEPTION 'WRITE_OFF_ALREADY_PENDING: order=%', p_order_id;
  END;

  INSERT INTO public.audit_log (event_type, actor_user_id, payload)
  VALUES (
    'tempo_write_off_requested',
    v_caller,
    jsonb_build_object(
      'approval_id', v_approval,
      'order_id', p_order_id,
      'customer_id', v_order.customer_id,
      'amount', v_order.total,
      'reason', btrim(p_reason)
    )
  );

  RETURN v_approval;
END $$;

GRANT EXECUTE ON FUNCTION public.request_tempo_write_off(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.request_tempo_write_off IS
  'Phase 1C task 2: admin requests Owner approval to write off an INVOICE_TEMPO order. Returns approval_id.';
```

- [ ] **Step 2: Apply via Supabase MCP**

Use Supabase MCP `apply_migration` with name `request_tempo_write_off_rpc`.
Expected: `{"success":true}`.

- [ ] **Step 3: Smoke test (3 cases)**

Use Supabase MCP `execute_sql`. Wrap in DO blocks that capture SQLERRM so the result is visible.

Helper (create then drop after smoke):
```sql
CREATE OR REPLACE FUNCTION public._smoke_request_writeoff(
  p_jwt_sub UUID, p_order_id UUID, p_reason TEXT
) RETURNS TEXT LANGUAGE plpgsql AS $body$
DECLARE v_id BIGINT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_jwt_sub::text, 'role', 'authenticated')::text, true);
  v_id := public.request_tempo_write_off(p_order_id, p_reason);
  RETURN 'ok approval_id=' || v_id;
EXCEPTION WHEN OTHERS THEN
  RETURN 'raised: ' || SQLERRM;
END $body$;
```

Then for each smoke case, BEGIN; … ROLLBACK; — inside the txn, set up an order in the desired status and call the helper.

Case A — Happy (returns approval_id):
```sql
BEGIN;
  -- Seed minimal INVOICE_TEMPO order
  WITH ins AS (
    INSERT INTO public.orders (id, status, payment_type, customer_id, customer_name, total, created_at, due_date)
    VALUES (gen_random_uuid(), 'INVOICE_TEMPO', 'TEMPO', NULL, 'Smoke Co', 1000000, now(), CURRENT_DATE + INTERVAL '7 days')
    RETURNING id
  )
  SELECT public._smoke_request_writeoff(
    '227c28f4-09f6-4dc9-af7a-01b0feb2c194'::uuid, -- Tony's auth.uid (existing)
    (SELECT id FROM ins),
    'Customer bankrupt per Pengadilan Niaga 2026-06-15'
  ) AS result;
ROLLBACK;
```
Expected: `result = 'ok approval_id=<bigint>'`.

Case B — Wrong status (raises ORDER_NOT_TEMPO):
```sql
BEGIN;
  WITH ins AS (
    INSERT INTO public.orders (id, status, payment_type, customer_name, total, created_at)
    VALUES (gen_random_uuid(), 'PAYMENT_VERIFIED', 'TEMPO', 'Smoke Co', 1000000, now())
    RETURNING id
  )
  SELECT public._smoke_request_writeoff(
    '227c28f4-09f6-4dc9-af7a-01b0feb2c194'::uuid,
    (SELECT id FROM ins),
    'Customer bankrupt per Pengadilan Niaga 2026-06-15'
  ) AS result;
ROLLBACK;
```
Expected: `result LIKE 'raised: ORDER_NOT_TEMPO:%'`.

Case C — Duplicate pending (raises WRITE_OFF_ALREADY_PENDING):
```sql
BEGIN;
  WITH ins AS (
    INSERT INTO public.orders (id, status, payment_type, customer_name, total, created_at, due_date)
    VALUES (gen_random_uuid(), 'INVOICE_TEMPO', 'TEMPO', 'Smoke Co', 1000000, now(), CURRENT_DATE + INTERVAL '7 days')
    RETURNING id
  ),
  first_call AS (
    SELECT public._smoke_request_writeoff(
      '227c28f4-09f6-4dc9-af7a-01b0feb2c194'::uuid,
      (SELECT id FROM ins),
      'Customer bankrupt per Pengadilan Niaga 2026-06-15'
    ) AS r
  )
  SELECT
    (SELECT r FROM first_call) AS first_result,
    public._smoke_request_writeoff(
      '227c28f4-09f6-4dc9-af7a-01b0feb2c194'::uuid,
      (SELECT id FROM ins),
      'Second attempt should fail'
    ) AS second_result;
ROLLBACK;
```
Expected: `first_result LIKE 'ok approval_id=%'`, `second_result LIKE 'raised: WRITE_OFF_ALREADY_PENDING:%'`.

Cleanup helper:
```sql
DROP FUNCTION public._smoke_request_writeoff(UUID, UUID, TEXT);
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260626000021_request_tempo_write_off_rpc.sql
git commit -m "feat(piutang): migration 021 — request_tempo_write_off RPC

Admin RPC that creates a pending piutang_write_off approval_request +
satellite row + audit event. Validates order is INVOICE_TEMPO and reason
length>=10. Far-future expires_at (no auto-expire — founder choice).
Duplicate guard via satellite partial unique index.

Smoke: happy / ORDER_NOT_TEMPO / WRITE_OFF_ALREADY_PENDING — all green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 3: Migration 022 — `approve_tempo_write_off` + `reject_tempo_write_off`

**Files:**
- Create: `supabase/migrations/20260626000022_approve_reject_tempo_write_off_rpcs.sql`

- [ ] **Step 1: Write the migration**

Write to `supabase/migrations/20260626000022_approve_reject_tempo_write_off_rpcs.sql`:

```sql
-- 20260626000022_approve_reject_tempo_write_off_rpcs.sql
-- Phase 1C task 2 — Owner approves or rejects a pending write-off request.
-- Owner identity bound via auth.uid() + admin_users.role='Owner' AND
-- status='Aktif' (PR #34 lesson: deactivated Owners must not approve,
-- audit attribution must reflect the actual caller).
--
-- NOTE: admin_users.id is not always the auth uid in current data (PR #34
-- migration 20260626000010 documented this). Map auth user → admin_users via
-- email match.

CREATE OR REPLACE FUNCTION public._piutang_write_off_resolve_owner(
  OUT v_caller       UUID,
  OUT v_admin_id     UUID
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_email TEXT;
  v_owner_count INT;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'OWNER_ONLY: no authenticated user';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_caller;
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'OWNER_ONLY: caller has no auth email';
  END IF;

  SELECT COUNT(*) INTO v_owner_count
    FROM public.admin_users
   WHERE lower(email) = lower(v_email)
     AND role = 'Owner'
     AND status = 'Aktif';
  IF v_owner_count = 0 THEN
    RAISE EXCEPTION 'OWNER_ONLY: caller is not an active Owner';
  ELSIF v_owner_count > 1 THEN
    RAISE EXCEPTION 'OWNER_AMBIGUOUS: % active Owner rows match caller email', v_owner_count;
  END IF;

  SELECT id INTO v_admin_id
    FROM public.admin_users
   WHERE lower(email) = lower(v_email)
     AND role = 'Owner'
     AND status = 'Aktif';
END $$;

CREATE OR REPLACE FUNCTION public.approve_tempo_write_off(p_approval_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_caller   UUID;
  v_admin_id UUID;
  v_ar       RECORD;
  v_satellite RECORD;
  v_order    RECORD;
BEGIN
  -- Resolve + verify Aktif Owner caller
  SELECT * INTO v_caller, v_admin_id FROM public._piutang_write_off_resolve_owner();

  -- Lock the approval row and validate
  SELECT * INTO v_ar FROM public.approval_requests
   WHERE id = p_approval_id FOR UPDATE;
  IF v_ar.id IS NULL THEN
    RAISE EXCEPTION 'APPROVAL_NOT_FOUND: %', p_approval_id;
  END IF;
  IF v_ar.request_type <> 'piutang_write_off' THEN
    RAISE EXCEPTION 'WRONG_TYPE: id=% type=%', p_approval_id, v_ar.request_type;
  END IF;
  IF v_ar.status <> 'pending' THEN
    RAISE EXCEPTION 'APPROVAL_NOT_PENDING: id=% status=%', p_approval_id, v_ar.status;
  END IF;

  -- Fetch satellite + order
  SELECT * INTO v_satellite FROM public.piutang_write_off_requests
   WHERE approval_id = p_approval_id;
  IF v_satellite.approval_id IS NULL THEN
    RAISE EXCEPTION 'SATELLITE_NOT_FOUND for approval %', p_approval_id;
  END IF;

  SELECT id, status, customer_id, total INTO v_order
    FROM public.orders WHERE id = v_satellite.order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: %', v_satellite.order_id;
  END IF;

  -- Race: customer paid between request and approve. Auto-reject + raise.
  IF v_order.status <> 'INVOICE_TEMPO' THEN
    PERFORM public._transition_approval(
      p_approval_id, 'rejected'::public.approval_status, v_admin_id,
      'race: order status changed to ' || v_order.status
    );
    INSERT INTO public.audit_log (event_type, actor_user_id, payload)
    VALUES (
      'tempo_write_off_rejected',
      v_caller,
      jsonb_build_object(
        'approval_id', p_approval_id,
        'order_id', v_order.id,
        'reject_reason', 'race: order status changed to ' || v_order.status,
        'auto', true
      )
    );
    RAISE EXCEPTION 'ORDER_NO_LONGER_TEMPO: status=%', v_order.status;
  END IF;

  -- Flip order to INVOICE_WRITTEN_OFF + stamp metadata
  UPDATE public.orders
     SET status = 'INVOICE_WRITTEN_OFF',
         written_off_at = now(),
         written_off_by = v_admin_id,
         write_off_reason = v_satellite.reason
   WHERE id = v_order.id;

  -- Mark approval approved via the sole sanctioned helper
  PERFORM public._transition_approval(
    p_approval_id, 'approved'::public.approval_status, v_admin_id,
    'piutang_write_off_approve'
  );

  INSERT INTO public.audit_log (event_type, actor_user_id, payload)
  VALUES (
    'tempo_write_off_approved',
    v_caller,
    jsonb_build_object(
      'approval_id', p_approval_id,
      'order_id', v_order.id,
      'customer_id', v_order.customer_id,
      'amount', v_order.total,
      'reason', v_satellite.reason
    )
  );
END $$;

CREATE OR REPLACE FUNCTION public.reject_tempo_write_off(
  p_approval_id BIGINT,
  p_reason      TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_caller    UUID;
  v_admin_id  UUID;
  v_ar        RECORD;
  v_satellite RECORD;
  v_reason    TEXT;
BEGIN
  SELECT * INTO v_caller, v_admin_id FROM public._piutang_write_off_resolve_owner();

  SELECT * INTO v_ar FROM public.approval_requests
   WHERE id = p_approval_id FOR UPDATE;
  IF v_ar.id IS NULL THEN
    RAISE EXCEPTION 'APPROVAL_NOT_FOUND: %', p_approval_id;
  END IF;
  IF v_ar.request_type <> 'piutang_write_off' THEN
    RAISE EXCEPTION 'WRONG_TYPE: id=% type=%', p_approval_id, v_ar.request_type;
  END IF;
  IF v_ar.status <> 'pending' THEN
    RAISE EXCEPTION 'APPROVAL_NOT_PENDING: id=% status=%', p_approval_id, v_ar.status;
  END IF;

  SELECT * INTO v_satellite FROM public.piutang_write_off_requests
   WHERE approval_id = p_approval_id;

  v_reason := COALESCE(NULLIF(btrim(p_reason), ''), 'no reason given');

  PERFORM public._transition_approval(
    p_approval_id, 'rejected'::public.approval_status, v_admin_id, v_reason
  );

  INSERT INTO public.audit_log (event_type, actor_user_id, payload)
  VALUES (
    'tempo_write_off_rejected',
    v_caller,
    jsonb_build_object(
      'approval_id', p_approval_id,
      'order_id', v_satellite.order_id,
      'reject_reason', v_reason,
      'auto', false
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.approve_tempo_write_off(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_tempo_write_off(BIGINT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.approve_tempo_write_off IS
  'Owner approves a piutang write-off request. Flips order to INVOICE_WRITTEN_OFF.';
COMMENT ON FUNCTION public.reject_tempo_write_off IS
  'Owner rejects a piutang write-off request with a reason. Order untouched.';
```

- [ ] **Step 2: Apply via Supabase MCP**

`apply_migration` with name `approve_reject_tempo_write_off_rpcs`.
Expected: `{"success":true}`.

- [ ] **Step 3: Smoke test (5 cases)**

Reuse the smoke helper pattern from Task 2 but for `approve_tempo_write_off`. Cases (each in `BEGIN; … ROLLBACK;`):

| # | Setup | Authed caller | Expected |
|---|---|---|---|
| A | Seed INVOICE_TEMPO order + request approval (Tony auth.uid as admin) | non-existent uid `00000000-0000-0000-0000-deadbeef0000` | raises `OWNER_ONLY: caller has no auth email` |
| B | Same seed; pending approval | Tony1993 (deactivated Owner) `651e9d0d-034d-48d2-8897-09c64e78f5d0` | raises `OWNER_ONLY: caller is not an active Owner` |
| C | Same seed; pending approval | Tony Aktif Owner `227c28f4-09f6-4dc9-af7a-01b0feb2c194` | success; order status='INVOICE_WRITTEN_OFF'; written_off_* stamped; audit row `tempo_write_off_approved` present |
| D | Seed INVOICE_TEMPO order + request approval, then flip order to PAYMENT_VERIFIED before approve | Tony Aktif | raises `ORDER_NO_LONGER_TEMPO:`; approval auto-marked rejected; audit row `tempo_write_off_rejected` with auto=true |
| E | Seed pending approval | Tony Aktif calls `reject_tempo_write_off(id, 'reason')` | approval status='rejected'; order untouched; audit row `tempo_write_off_rejected` with auto=false |

Implementation: extend the smoke helper to take a function-call mode parameter so it can call either `approve_tempo_write_off(p_approval_id)` or `reject_tempo_write_off(p_approval_id, p_reason)`.

```sql
CREATE OR REPLACE FUNCTION public._smoke_approve_writeoff(
  p_jwt_sub UUID, p_approval_id BIGINT
) RETURNS TEXT LANGUAGE plpgsql AS $body$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_jwt_sub::text, 'role', 'authenticated')::text, true);
  PERFORM public.approve_tempo_write_off(p_approval_id);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN 'raised: ' || SQLERRM;
END $body$;

CREATE OR REPLACE FUNCTION public._smoke_reject_writeoff(
  p_jwt_sub UUID, p_approval_id BIGINT, p_reason TEXT
) RETURNS TEXT LANGUAGE plpgsql AS $body$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_jwt_sub::text, 'role', 'authenticated')::text, true);
  PERFORM public.reject_tempo_write_off(p_approval_id, p_reason);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN 'raised: ' || SQLERRM;
END $body$;
```

After all 5 cases pass:

```sql
DROP FUNCTION public._smoke_approve_writeoff(UUID, BIGINT);
DROP FUNCTION public._smoke_reject_writeoff(UUID, BIGINT, TEXT);
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260626000022_approve_reject_tempo_write_off_rpcs.sql
git commit -m "feat(piutang): migration 022 — approve + reject tempo_write_off RPCs

Owner approves (flips order INVOICE_TEMPO → INVOICE_WRITTEN_OFF + stamps
written_off_* columns) or rejects (records reason, order untouched). Both
gated by auth.uid()-bound + role='Owner' AND status='Aktif' lookup
(PR #34 lesson; mapped via email since admin_users.id != auth uid for
some Owners). Race-on-approve auto-rejects approval and raises
ORDER_NO_LONGER_TEMPO.

Smoke: non-Owner / Tidak Aktif / happy / race / reject — all green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 4: Migration 023 — `revert_tempo_write_off` RPC

**Files:**
- Create: `supabase/migrations/20260626000023_revert_tempo_write_off_rpc.sql`

- [ ] **Step 1: Write the migration**

Write to `supabase/migrations/20260626000023_revert_tempo_write_off_rpc.sql`:

```sql
-- 20260626000023_revert_tempo_write_off_rpc.sql
-- Phase 1C task 2 — Owner reverts a previously written-off order back to
-- INVOICE_TEMPO. Single-step (no inbox cycle) because it's restoring a
-- state the Owner already approved as undoable. Owner-only by auth.uid().

CREATE OR REPLACE FUNCTION public.revert_tempo_write_off(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_caller   UUID;
  v_admin_id UUID;
  v_order    RECORD;
BEGIN
  SELECT * INTO v_caller, v_admin_id FROM public._piutang_write_off_resolve_owner();

  SELECT id, status, written_off_at, written_off_by, write_off_reason
    INTO v_order
    FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: %', p_order_id;
  END IF;
  IF v_order.status <> 'INVOICE_WRITTEN_OFF' THEN
    RAISE EXCEPTION 'NOT_WRITTEN_OFF: status=%', v_order.status;
  END IF;

  -- Capture previous values for audit forensics
  INSERT INTO public.audit_log (event_type, actor_user_id, payload)
  VALUES (
    'tempo_write_off_reverted',
    v_caller,
    jsonb_build_object(
      'order_id', v_order.id,
      'previous_written_off_at', v_order.written_off_at,
      'previous_written_off_by', v_order.written_off_by,
      'previous_reason', v_order.write_off_reason
    )
  );

  UPDATE public.orders
     SET status = 'INVOICE_TEMPO',
         written_off_at = NULL,
         written_off_by = NULL,
         write_off_reason = NULL
   WHERE id = p_order_id;
END $$;

GRANT EXECUTE ON FUNCTION public.revert_tempo_write_off(UUID) TO authenticated;

COMMENT ON FUNCTION public.revert_tempo_write_off IS
  'Owner reverts a written-off order back to INVOICE_TEMPO. Owner-only via auth.uid().';
```

- [ ] **Step 2: Apply via Supabase MCP**

`apply_migration` with name `revert_tempo_write_off_rpc`.
Expected: `{"success":true}`.

- [ ] **Step 3: Smoke test (3 cases)**

Helper:
```sql
CREATE OR REPLACE FUNCTION public._smoke_revert_writeoff(
  p_jwt_sub UUID, p_order_id UUID
) RETURNS TEXT LANGUAGE plpgsql AS $body$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_jwt_sub::text, 'role', 'authenticated')::text, true);
  PERFORM public.revert_tempo_write_off(p_order_id);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN 'raised: ' || SQLERRM;
END $body$;
```

| # | Setup | Caller | Expected |
|---|---|---|---|
| A | Seed INVOICE_WRITTEN_OFF order with written_off_* stamped | Tony Aktif Owner | ok; order status='INVOICE_TEMPO'; written_off_* all NULL; audit `tempo_write_off_reverted` with previous_reason populated |
| B | Seed INVOICE_TEMPO order | Tony Aktif Owner | raises `NOT_WRITTEN_OFF:` |
| C | Seed INVOICE_WRITTEN_OFF order | Tony1993 (Tidak Aktif) | raises `OWNER_ONLY: caller is not an active Owner` |

After all green:
```sql
DROP FUNCTION public._smoke_revert_writeoff(UUID, UUID);
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260626000023_revert_tempo_write_off_rpc.sql
git commit -m "feat(piutang): migration 023 — revert_tempo_write_off RPC

Owner single-action revert that restores INVOICE_WRITTEN_OFF → INVOICE_TEMPO
and clears written_off_* columns. Captures previous values into audit_log
payload for forensics. Owner-only via auth.uid() (PR #34 lesson).

Smoke: happy / NOT_WRITTEN_OFF / non-Owner — all green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

## Milestone B — Types + Lib wrappers

### Task 5: Extend types

**Files:**
- Modify: `src/types.ts` — find and extend `ApprovalRequestType` union; add `DbPiutangWriteOffRequest`.

- [ ] **Step 1: Read current ApprovalRequestType union**

Run: `grep -n "ApprovalRequestType" src/types.ts | head -10`
Expected: find a line like `export type ApprovalRequestType = 'adjustment' | 'price_change' | 'opname' | … ;`.

- [ ] **Step 2: Extend the union + add row type**

Add `| 'piutang_write_off'` to the existing `ApprovalRequestType` union (preserve all current members).

Append (in a logical near-neighbour block where other `Db*` row types live):

```ts
export interface DbPiutangWriteOffRequest {
  approval_id: number;
  order_id: string;
  reason: string;
  created_at: string;
}
```

- [ ] **Step 3: Verify tsc**

Run: `npx tsc --noEmit`
Expected: zero errors. (No code uses the new union value yet, so the union extension is purely additive.)

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "types(piutang): extend ApprovalRequestType + add DbPiutangWriteOffRequest

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 6: Lib wrappers (TDD)

**Files:**
- Create: `src/lib/piutang/writeOff.ts`
- Create: `src/lib/__tests__/piutangWriteOffWrappers.test.ts`

- [ ] **Step 1: Write the failing test**

Write `src/lib/__tests__/piutangWriteOffWrappers.test.ts`:

```ts
import { describe, test, expect, vi, beforeEach } from 'vitest';

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));
vi.mock('../supabaseClient', () => ({
  supabase: { rpc: mockRpc },
}));

import {
  requestTempoWriteOff,
  approveTempoWriteOff,
  rejectTempoWriteOff,
  revertTempoWriteOff,
} from '../piutang/writeOff';

describe('requestTempoWriteOff', () => {
  beforeEach(() => mockRpc.mockReset());

  test('calls request_tempo_write_off with correct params', async () => {
    mockRpc.mockResolvedValueOnce({ data: 42, error: null });
    const result = await requestTempoWriteOff('order-1', 'Customer bankrupt 2026-06-15');
    expect(mockRpc).toHaveBeenCalledWith('request_tempo_write_off', {
      p_order_id: 'order-1',
      p_reason: 'Customer bankrupt 2026-06-15',
    });
    expect(result).toEqual({ approval_id: 42 });
  });

  test('throws on RPC error preserving prefix', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'ORDER_NOT_TEMPO: cannot write off status=PAYMENT_VERIFIED' } });
    await expect(requestTempoWriteOff('order-1', 'reason here long enough'))
      .rejects.toMatchObject({ message: 'ORDER_NOT_TEMPO: cannot write off status=PAYMENT_VERIFIED' });
  });
});

describe('approveTempoWriteOff', () => {
  beforeEach(() => mockRpc.mockReset());

  test('calls approve_tempo_write_off with approval id', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await approveTempoWriteOff(99);
    expect(mockRpc).toHaveBeenCalledWith('approve_tempo_write_off', { p_approval_id: 99 });
  });

  test('throws on OWNER_ONLY', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'OWNER_ONLY: caller is not an active Owner' } });
    await expect(approveTempoWriteOff(99)).rejects.toMatchObject({ message: 'OWNER_ONLY: caller is not an active Owner' });
  });
});

describe('rejectTempoWriteOff', () => {
  beforeEach(() => mockRpc.mockReset());

  test('calls reject_tempo_write_off with id + reason', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await rejectTempoWriteOff(99, 'still trying to collect');
    expect(mockRpc).toHaveBeenCalledWith('reject_tempo_write_off', {
      p_approval_id: 99,
      p_reason: 'still trying to collect',
    });
  });
});

describe('revertTempoWriteOff', () => {
  beforeEach(() => mockRpc.mockReset());

  test('calls revert_tempo_write_off with order id', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await revertTempoWriteOff('order-1');
    expect(mockRpc).toHaveBeenCalledWith('revert_tempo_write_off', { p_order_id: 'order-1' });
  });

  test('throws on NOT_WRITTEN_OFF', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'NOT_WRITTEN_OFF: status=INVOICE_TEMPO' } });
    await expect(revertTempoWriteOff('order-1')).rejects.toMatchObject({ message: 'NOT_WRITTEN_OFF: status=INVOICE_TEMPO' });
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npm test -- --run src/lib/__tests__/piutangWriteOffWrappers.test.ts`
Expected: all 6 tests FAIL with "Cannot find module '../piutang/writeOff'".

- [ ] **Step 3: Implement the wrappers**

Write `src/lib/piutang/writeOff.ts`:

```ts
import { supabase } from '../supabaseClient';

/**
 * Phase 1C task 2 — Piutang write-off RPC wrappers.
 *
 * Kept in a sibling module (rather than supabaseClient.ts) so the standard
 * `vi.mock('../supabaseClient')` test idiom can intercept the `supabase`
 * import. Mirrors src/lib/sales/rakitLockOwnerEdit.ts.
 *
 * All four wrappers re-throw RPC errors with the raised prefix intact so
 * consumers can pattern-match on prefixes like `ORDER_NOT_TEMPO:`,
 * `OWNER_ONLY:`, `WRITE_OFF_ALREADY_PENDING:`, `NOT_WRITTEN_OFF:`.
 */

export async function requestTempoWriteOff(
  orderId: string,
  reason: string,
): Promise<{ approval_id: number }> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.rpc('request_tempo_write_off', {
    p_order_id: orderId,
    p_reason: reason,
  });
  if (error) throw error;
  return { approval_id: data as number };
}

export async function approveTempoWriteOff(approvalId: number): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.rpc('approve_tempo_write_off', {
    p_approval_id: approvalId,
  });
  if (error) throw error;
}

export async function rejectTempoWriteOff(
  approvalId: number,
  reason: string,
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.rpc('reject_tempo_write_off', {
    p_approval_id: approvalId,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function revertTempoWriteOff(orderId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.rpc('revert_tempo_write_off', {
    p_order_id: orderId,
  });
  if (error) throw error;
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npm test -- --run src/lib/__tests__/piutangWriteOffWrappers.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/piutang/writeOff.ts src/lib/__tests__/piutangWriteOffWrappers.test.ts
git commit -m "feat(piutang): lib wrappers for write-off RPCs

requestTempoWriteOff / approveTempoWriteOff / rejectTempoWriteOff /
revertTempoWriteOff — thin Supabase RPC wrappers that re-throw errors
with prefix intact so consumers can pattern-match. Sibling-module
pattern mirrors src/lib/sales/rakitLockOwnerEdit.ts for vi.mock
interception.

6 vitest cases (call shape + error passthrough for each wrapper).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 7: Extend `fetchPiutangRows` for write-off inclusion (TDD)

**Files:**
- Modify: `src/lib/piutangService.ts` — extend `fetchPiutangRows` signature.
- Create: `src/lib/__tests__/piutangService.writeOff.test.ts`

- [ ] **Step 1: Write the failing test**

Write `src/lib/__tests__/piutangService.writeOff.test.ts`:

```ts
import { describe, test, expect, vi, beforeEach } from 'vitest';

const { fromMock, eqMock, inMock, orderMock } = vi.hoisted(() => {
  const eqMock = vi.fn();
  const inMock = vi.fn();
  const orderMock = vi.fn();
  const fromMock = vi.fn();
  return { fromMock, eqMock, inMock, orderMock };
});

vi.mock('../supabaseClient', () => ({
  supabase: {
    from: fromMock,
  },
}));

import { fetchPiutangRows } from '../piutangService';

describe('fetchPiutangRows includeWrittenOff', () => {
  beforeEach(() => {
    fromMock.mockReset(); eqMock.mockReset(); inMock.mockReset(); orderMock.mockReset();
  });

  test('default (no opts) filters to INVOICE_TEMPO only', async () => {
    // Build a chained mock that resolves to empty rows on the final await.
    const select = vi.fn().mockReturnValue({
      eq: (col: string, val: unknown) => {
        eqMock(col, val);
        return {
          eq: (col2: string, val2: unknown) => {
            eqMock(col2, val2);
            return {
              order: () => Promise.resolve({ data: [], error: null }),
            };
          },
        };
      },
    });
    fromMock.mockReturnValue({ select });
    await fetchPiutangRows();
    // Two .eq calls expected: payment_type=TEMPO, status=INVOICE_TEMPO
    expect(eqMock).toHaveBeenCalledWith('payment_type', 'TEMPO');
    expect(eqMock).toHaveBeenCalledWith('status', 'INVOICE_TEMPO');
  });

  test('includeWrittenOff=true uses .in() with both statuses', async () => {
    const select = vi.fn().mockReturnValue({
      eq: (col: string, val: unknown) => {
        eqMock(col, val);
        return {
          in: (col2: string, vals: unknown[]) => {
            inMock(col2, vals);
            return {
              order: () => Promise.resolve({ data: [], error: null }),
            };
          },
        };
      },
    });
    fromMock.mockReturnValue({ select });
    await fetchPiutangRows({ includeWrittenOff: true });
    expect(eqMock).toHaveBeenCalledWith('payment_type', 'TEMPO');
    expect(inMock).toHaveBeenCalledWith('status', ['INVOICE_TEMPO', 'INVOICE_WRITTEN_OFF']);
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npm test -- --run src/lib/__tests__/piutangService.writeOff.test.ts`
Expected: second test FAILS — current `fetchPiutangRows` doesn't take options.

- [ ] **Step 3: Modify `fetchPiutangRows`**

In `src/lib/piutangService.ts`, change the function signature and body. Replace:

```ts
// ── Query: outstanding tempo orders + their customers ──
export async function fetchPiutangRows(): Promise<PiutangRow[]> {
  if (!supabase) return [];
  // Fetch open tempo orders. Customer joined via a 2nd query keyed by id (since
  // orders.customer_id is text, not always uuid-clean; we fetch all referenced
  // customers in a single IN query).
  const { data: orders, error: oErr } = await supabase
    .from('orders')
    .select('*')
    .eq('payment_type', 'TEMPO')
    .eq('status', 'INVOICE_TEMPO')
    .order('due_date', { ascending: true });
```

with:

```ts
// ── Query: outstanding tempo orders + their customers ──
export async function fetchPiutangRows(
  opts?: { includeWrittenOff?: boolean },
): Promise<PiutangRow[]> {
  if (!supabase) return [];
  // Fetch tempo orders. Default to open-only (INVOICE_TEMPO). When opts.includeWrittenOff
  // is set, also pull INVOICE_WRITTEN_OFF so the Tulis-off filter pill in
  // PiutangScreen can show history + offer the Owner-only Batal Tulis-off action.
  const baseSelect = supabase
    .from('orders')
    .select('*')
    .eq('payment_type', 'TEMPO');
  const filtered = opts?.includeWrittenOff
    ? baseSelect.in('status', ['INVOICE_TEMPO', 'INVOICE_WRITTEN_OFF'])
    : baseSelect.eq('status', 'INVOICE_TEMPO');
  const { data: orders, error: oErr } = await filtered.order('due_date', { ascending: true });
```

(Leave the rest of the function — `if (oErr) throw oErr;` and the customer-join logic and the `return` — unchanged.)

- [ ] **Step 4: Run test, expect pass**

Run: `npm test -- --run src/lib/__tests__/piutangService.writeOff.test.ts`
Expected: both tests PASS.

- [ ] **Step 5: Confirm full suite still green**

Run: `npm test -- --run`
Expected: all prior tests still pass; total count includes the 2 new tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/piutangService.ts src/lib/__tests__/piutangService.writeOff.test.ts
git commit -m "feat(piutang): fetchPiutangRows accepts includeWrittenOff opt

Default behaviour unchanged (INVOICE_TEMPO only). Opt-in extends the
status filter to (INVOICE_TEMPO, INVOICE_WRITTEN_OFF) for the new
Tulis-off filter pill in PiutangScreen.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

## Milestone C — UI components

### Task 8: `WriteOffRequestModal` component

**Files:**
- Create: `src/components/piutang/WriteOffRequestModal.tsx`

- [ ] **Step 1: Write the component**

Write `src/components/piutang/WriteOffRequestModal.tsx`:

```tsx
import { useState } from 'react';
import type { PiutangRow } from '../../types';
import { requestTempoWriteOff } from '../../lib/piutang/writeOff';

interface WriteOffRequestModalProps {
  row: PiutangRow;
  onClose: () => void;
  onSubmitted: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

const MIN_REASON_LEN = 10;

function fmtRp(n: number): string {
  return 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n));
}

function mapErrorToToast(msg: string): string {
  if (msg.startsWith('ORDER_NOT_TEMPO:')) return 'Invoice tidak bisa di-tulis-off (sudah lunas / sudah ditulis-off)';
  if (msg.startsWith('WRITE_OFF_ALREADY_PENDING:')) return 'Tulis-off untuk invoice ini sudah diajukan';
  if (msg.startsWith('REASON_REQUIRED')) return 'Alasan wajib diisi (min 10 karakter)';
  if (msg.startsWith('ORDER_NOT_FOUND:')) return 'Invoice tidak ditemukan';
  if (msg.startsWith('OWNER_ONLY:')) return 'Sesi habis, login ulang';
  return msg || 'Gagal mengajukan tulis-off';
}

export default function WriteOffRequestModal({ row, onClose, onSubmitted, showToast }: WriteOffRequestModalProps) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const trimmed = reason.trim();
  const reasonOk = trimmed.length >= MIN_REASON_LEN;
  const canSubmit = reasonOk && !submitting;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await requestTempoWriteOff(row.order.id, trimmed);
      showToast('Tulis-off diajukan ke Owner', 'success');
      onSubmitted();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(mapErrorToToast(msg), 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200">
          <h2 className="font-extrabold text-base text-[#012749]">Ajukan Tulis-off</h2>
          <p className="text-xs text-gray-500 mt-0.5">Perlu persetujuan Owner.</p>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="text-xs space-y-1">
            <div><span className="text-gray-500">Customer:</span> <span className="font-semibold">{row.customer?.name ?? row.order.customer_name}</span></div>
            <div><span className="text-gray-500">Invoice:</span> <span className="font-mono">{row.order.id.slice(0, 8)}</span></div>
            <div><span className="text-gray-500">Total:</span> <span className="font-bold" style={{ color: '#012749' }}>{fmtRp(row.order.total)}</span></div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Alasan <span className="text-red-600">*</span>
            </label>
            <textarea
              autoFocus
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Jelaskan kenapa invoice ini tidak bisa ditagih lagi (min 10 karakter)..."
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className={`text-[11px] mt-1 ${reasonOk ? 'text-gray-500' : 'text-red-600'}`}>
              {trimmed.length} / {MIN_REASON_LEN} karakter minimum
            </div>
          </div>
        </div>

        <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-semibold rounded-lg text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#012749] text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Mengajukan...' : 'Ajukan Tulis-off'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/piutang/WriteOffRequestModal.tsx
git commit -m "feat(piutang): WriteOffRequestModal — reason input + RPC submit

Customer/invoice/total summary + required reason textarea (min 10 chars,
live counter). Ajukan disabled until reason valid. Error→toast mapping
for ORDER_NOT_TEMPO / WRITE_OFF_ALREADY_PENDING / OWNER_ONLY / etc.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 9: `RevertWriteOffConfirmModal` component

**Files:**
- Create: `src/components/piutang/RevertWriteOffConfirmModal.tsx`

- [ ] **Step 1: Write the component**

Write `src/components/piutang/RevertWriteOffConfirmModal.tsx`:

```tsx
import { useState } from 'react';
import type { PiutangRow } from '../../types';
import { revertTempoWriteOff } from '../../lib/piutang/writeOff';

interface RevertWriteOffConfirmModalProps {
  row: PiutangRow;
  onClose: () => void;
  onReverted: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function fmtRp(n: number): string {
  return 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n));
}

function mapErrorToToast(msg: string): string {
  if (msg.startsWith('NOT_WRITTEN_OFF:')) return 'Invoice tidak dalam status tulis-off';
  if (msg.startsWith('OWNER_ONLY:')) return 'Hanya Owner aktif yang bisa batalkan tulis-off';
  if (msg.startsWith('ORDER_NOT_FOUND:')) return 'Invoice tidak ditemukan';
  return msg || 'Gagal batalkan tulis-off';
}

export default function RevertWriteOffConfirmModal({
  row, onClose, onReverted, showToast,
}: RevertWriteOffConfirmModalProps) {
  const [submitting, setSubmitting] = useState(false);

  const onConfirm = async () => {
    setSubmitting(true);
    try {
      await revertTempoWriteOff(row.order.id);
      showToast('Tulis-off dibatalkan', 'success');
      onReverted();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(mapErrorToToast(msg), 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl overflow-hidden border-2 border-red-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-red-100 bg-red-50">
          <h2 className="font-extrabold text-base text-red-800">Batalkan Tulis-off?</h2>
          <p className="text-xs text-red-700 mt-0.5">Invoice akan kembali ke status piutang aktif.</p>
        </div>

        <div className="px-5 py-4 space-y-2">
          <div className="text-xs space-y-1">
            <div><span className="text-gray-500">Customer:</span> <span className="font-semibold">{row.customer?.name ?? row.order.customer_name}</span></div>
            <div><span className="text-gray-500">Invoice:</span> <span className="font-mono">{row.order.id.slice(0, 8)}</span></div>
            <div><span className="text-gray-500">Total:</span> <span className="font-bold" style={{ color: '#012749' }}>{fmtRp(row.order.total)}</span></div>
            {row.order.write_off_reason && (
              <div><span className="text-gray-500">Alasan tulis-off:</span> <span className="italic">{row.order.write_off_reason}</span></div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-semibold rounded-lg text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            Tidak
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {submitting ? 'Membatalkan...' : 'Ya, Batalkan'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: zero errors.

(`DbOrder.write_off_reason` is already in `src/types.ts` per migration `20260615000010` — verify with `grep -n write_off_reason src/types.ts`.)

- [ ] **Step 3: Commit**

```bash
git add src/components/piutang/RevertWriteOffConfirmModal.tsx
git commit -m "feat(piutang): RevertWriteOffConfirmModal — destructive confirm + RPC

Owner-only modal with red destructive styling. Shows customer/invoice/total
+ original write_off_reason (forensics) so the Owner sees why it was
written off before restoring.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 10: Wire PiutangScreen — 6th pill + two new buttons + modal hooks

**Files:**
- Modify: `src/components/piutang/PiutangScreen.tsx`

- [ ] **Step 1: Read current PiutangScreen to find anchor points**

Run: `grep -n "FilterKey\|setPayTarget\|payTarget\|CatatBayarModal\|'all', 'overdue'" src/components/piutang/PiutangScreen.tsx`
Expected: line numbers for the FilterKey type definition (~around line 50-80), the pills map (~line 117), the buttons block (~line 190-202), and the modal rendering (~line 212+).

- [ ] **Step 2: Extend FilterKey + filter logic**

In `src/components/piutang/PiutangScreen.tsx`:

(a) Find the `FilterKey` type alias and extend it. Replace the line like:

```ts
type FilterKey = 'all' | 'overdue' | 'today' | 'h3' | 'future';
```

with:

```ts
type FilterKey = 'all' | 'overdue' | 'today' | 'h3' | 'future' | 'written_off';
```

(b) In the same file, find imports — extend the existing imports to include:

```ts
import WriteOffRequestModal from './WriteOffRequestModal';
import RevertWriteOffConfirmModal from './RevertWriteOffConfirmModal';
```

(c) Add new state hooks alongside existing `payTarget` / `filter` state:

```ts
const [writeOffTarget, setWriteOffTarget] = useState<PiutangRow | null>(null);
const [revertTarget, setRevertTarget] = useState<PiutangRow | null>(null);
```

(d) Find the `reload` / fetch effect that calls `fetchPiutangRows()`. Change the call to pass the opt:

```ts
const data = await fetchPiutangRows({ includeWrittenOff: filter === 'written_off' });
```

(If `filter` is captured in the closure, ensure the effect dependency array includes `filter` so switching the pill triggers a re-fetch.)

(e) In the filter pill map, add `'written_off'` to the `(['all', 'overdue', 'today', 'h3', 'future'] as FilterKey[])` array → new value: `(['all', 'overdue', 'today', 'h3', 'future', 'written_off'] as FilterKey[])`.

(f) Find the `label` ternary inside the pill loop:

```ts
const label = k === 'all' ? 'Semua' : tier!.label;
```

Change to:

```ts
const label = k === 'all' ? 'Semua' : k === 'written_off' ? 'Tulis-off' : tier!.label;
```

(g) Find the `count` ternary:

```ts
const count = k === 'all' ? rows.length :
  k === 'overdue' ? kpi.overdueCount :
  k === 'today' ? kpi.todayCount :
  k === 'h3' ? kpi.h3Count :
  rows.filter(r => r.tier === 'future').length;
```

Change the final fallback chain (after `h3`) to:

```ts
const count = k === 'all' ? rows.filter(r => r.order.status === 'INVOICE_TEMPO').length :
  k === 'overdue' ? kpi.overdueCount :
  k === 'today' ? kpi.todayCount :
  k === 'h3' ? kpi.h3Count :
  k === 'written_off' ? rows.filter(r => r.order.status === 'INVOICE_WRITTEN_OFF').length :
  rows.filter(r => r.tier === 'future' && r.order.status === 'INVOICE_TEMPO').length;
```

(h) For `tier` lookup when k = `'written_off'`, the existing code does `const tier = k === 'all' ? null : PIUTANG_TIERS[k];` which will fail because `PIUTANG_TIERS` has no `written_off` key. Update to:

```ts
const tier = (k === 'all' || k === 'written_off') ? null : PIUTANG_TIERS[k];
```

(i) Update the `filtered` computation to handle written_off filter. Find the existing client-side filter logic (around `setFilter` use). If the existing code does:

```ts
const filtered = filter === 'all' ? rows : rows.filter(r => r.tier === filter);
```

extend to:

```ts
const filtered = filter === 'all'
  ? rows.filter(r => r.order.status === 'INVOICE_TEMPO')
  : filter === 'written_off'
    ? rows.filter(r => r.order.status === 'INVOICE_WRITTEN_OFF')
    : rows.filter(r => r.tier === filter && r.order.status === 'INVOICE_TEMPO');
```

- [ ] **Step 3: Add per-row buttons + modal renders**

Find the existing per-row Aksi cell (around line 190 — contains `<button disabled>WA</button>` and `<button onClick={() => setPayTarget(r)}>✓ Catat Bayar</button>`).

Replace that `<div className="inline-flex gap-1">` block with:

```tsx
<div className="inline-flex gap-1">
  {r.order.status === 'INVOICE_TEMPO' ? (
    <>
      <button
        disabled
        title="Phase 1C — WA reminder otomatis"
        className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-gray-50 text-gray-400 border border-gray-200 inline-flex items-center gap-1 cursor-not-allowed">
        <MessageSquare className="w-3 h-3" /> WA
      </button>
      <button
        onClick={() => setPayTarget(r)}
        className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-green-50 text-green-700 border border-green-200 hover:bg-green-100">
        ✓ Catat Bayar
      </button>
      <button
        onClick={() => setWriteOffTarget(r)}
        className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100">
        Tulis-off
      </button>
    </>
  ) : r.order.status === 'INVOICE_WRITTEN_OFF' && isOwner ? (
    <button
      onClick={() => setRevertTarget(r)}
      className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-red-50 text-red-700 border border-red-200 hover:bg-red-100">
      Batal Tulis-off
    </button>
  ) : null}
</div>
```

**Plumb `isOwner` from App.tsx:** PiutangScreen currently doesn't accept `isOwner`. Make these two edits in addition:

(j) In `src/components/piutang/PiutangScreen.tsx`, extend the `Props` interface (around line 32-34):

```ts
interface Props {
  currentUserId: string;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  isOwner?: boolean;
}

export default function PiutangScreen({ currentUserId, showToast, isOwner = false }: Props) {
```

(k) In `src/App.tsx`, find the `<PiutangScreen currentUserId={currentUser?.id ?? ''} showToast={triggerToast} />` call (around line 466). Extend it:

```tsx
<PiutangScreen
  currentUserId={currentUser?.id ?? ''}
  showToast={triggerToast}
  isOwner={!!(currentUser?.permissions?.can_approve_adjustment
    || currentUser?.permissions?.can_approve_price_change
    || currentUser?.permissions?.can_commit_opname
    || currentUser?.permissions?.can_approve_kasir_price_override
    || currentUser?.permissions?.can_approve_kasir_void
    || currentUser?.permissions?.can_approve_kasir_refund)}
/>
```

This mirrors the `isOwner` derivation pattern used by `ApprovalInboxScreen` so behaviour is consistent across screens.

- [ ] **Step 4: Wire modal renders**

After the existing `{payTarget && <CatatBayarModal ... />}` render at the bottom of the component, add:

```tsx
{writeOffTarget && (
  <WriteOffRequestModal
    row={writeOffTarget}
    onClose={() => setWriteOffTarget(null)}
    onSubmitted={() => { setWriteOffTarget(null); reload(); }}
    showToast={showToast}
  />
)}
{revertTarget && (
  <RevertWriteOffConfirmModal
    row={revertTarget}
    onClose={() => setRevertTarget(null)}
    onReverted={() => { setRevertTarget(null); reload(); }}
    showToast={showToast}
  />
)}
```

- [ ] **Step 5: Add written_off_reason secondary line on Tulis-off pill**

In the table row's Customer/Invoice cells, add a written-off hint when on the `written_off` filter. Find the existing Invoice cell (around line 175):

```tsx
<td className="px-5 py-3">
  <div className="font-mono text-[11px] text-gray-700">{r.order.id.slice(0, 8)}</div>
  <div className="text-[11px] text-gray-500">Dibuat {fmtDate(r.order.created_at)}</div>
</td>
```

Extend the second `<div>` to optionally show write-off info:

```tsx
<td className="px-5 py-3">
  <div className="font-mono text-[11px] text-gray-700">{r.order.id.slice(0, 8)}</div>
  <div className="text-[11px] text-gray-500">Dibuat {fmtDate(r.order.created_at)}</div>
  {r.order.status === 'INVOICE_WRITTEN_OFF' && (
    <div className="text-[11px] text-red-700 italic mt-0.5" title={r.order.write_off_reason ?? undefined}>
      Tulis-off {r.order.written_off_at ? fmtDate(r.order.written_off_at) : ''} · {r.order.write_off_reason ?? '—'}
    </div>
  )}
</td>
```

- [ ] **Step 6: Verify tsc + build**

Run: `npx tsc --noEmit`
Expected: zero errors.

Run: `npm run build`
Expected: `✓ built in …s`.

- [ ] **Step 7: Run full test suite**

Run: `npm test -- --run`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/piutang/PiutangScreen.tsx
git commit -m "feat(piutang): PiutangScreen — Tulis-off pill + Tulis-off + Batal Tulis-off buttons

(a) New 6th filter pill 'Tulis-off' with count of INVOICE_WRITTEN_OFF.
    Switching to it re-fetches with includeWrittenOff=true.
(b) Per-row Tulis-off button on INVOICE_TEMPO rows opens
    WriteOffRequestModal.
(c) Per-row Batal Tulis-off button (Owner-only) on INVOICE_WRITTEN_OFF
    rows opens RevertWriteOffConfirmModal.
(d) Tulis-off rows show written_off_at + write_off_reason inline.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 11: `TempoWriteOffApprovalRequestRow` component

**Files:**
- Create: `src/components/approval/TempoWriteOffApprovalRequestRow.tsx`

- [ ] **Step 1: Read sibling for shape reference**

Run: `wc -l src/components/approval/RakitLockApprovalRequestRow.tsx`
Expected: a line count (the sibling). You don't need to read the whole file — just mirror its prop shape and styling.

- [ ] **Step 2: Write the component**

Write `src/components/approval/TempoWriteOffApprovalRequestRow.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { ApprovalRequest } from '../../types';
import { supabase } from '../../lib/supabaseClient';

interface Props {
  request: ApprovalRequest;
  isOwner: boolean;
  disabled: boolean;
  actorName?: string;
  onApprove: (id: number) => void;
  onReject: (id: number, reason?: string) => void;
}

interface SatelliteSnap {
  reason: string;
  order_id: string;
  customer_name?: string;
  amount?: number;
  invoice_short?: string;
}

function fmtRp(n: number | undefined): string {
  if (n == null) return '—';
  return 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n));
}

export default function TempoWriteOffApprovalRequestRow({
  request, isOwner, disabled, actorName, onApprove, onReject,
}: Props) {
  const [snap, setSnap] = useState<SatelliteSnap | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      // Fetch satellite + a tiny order summary in one round-trip
      const { data: sat } = await supabase
        .from('piutang_write_off_requests')
        .select('reason, order_id')
        .eq('approval_id', request.id)
        .single();
      if (!sat) return;
      const { data: ord } = await supabase
        .from('orders')
        .select('id, total, customer_name')
        .eq('id', sat.order_id)
        .single();
      setSnap({
        reason: sat.reason,
        order_id: sat.order_id,
        customer_name: ord?.customer_name ?? undefined,
        amount: ord?.total ?? undefined,
        invoice_short: ord?.id?.slice(0, 8),
      });
    })();
  }, [request.id]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-extrabold uppercase tracking-wider">
              Tulis-off
            </span>
            <span className="text-slate-500">#{request.id}</span>
            {actorName && <span className="text-slate-500">oleh <span className="font-semibold">{actorName}</span></span>}
          </div>
          <div className="text-sm">
            {snap?.customer_name ?? '—'}
            {snap?.invoice_short && <span className="text-slate-400 font-mono ml-2">{snap.invoice_short}</span>}
          </div>
          <div className="text-sm font-bold" style={{ color: '#012749' }}>{fmtRp(snap?.amount)}</div>
          {snap?.reason && (
            <div className="text-xs text-slate-700 italic max-w-md">
              "{snap.reason}"
            </div>
          )}
        </div>

        {isOwner && (
          <div className="flex gap-2 flex-shrink-0">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setRejectOpen(true)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50"
            >
              Tolak
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onApprove(request.id)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              ✓ Setujui Tulis-off
            </button>
          </div>
        )}
      </div>

      {rejectOpen && (
        <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
          <label className="block text-xs font-semibold text-slate-700">Alasan penolakan</label>
          <textarea
            rows={2}
            autoFocus
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            placeholder="Mis: belum coba semua channel collection..."
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setRejectOpen(false); setRejectReason(''); }}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-700 hover:bg-slate-100"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={() => {
                onReject(request.id, rejectReason.trim() || undefined);
                setRejectOpen(false);
                setRejectReason('');
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700"
            >
              Konfirmasi Tolak
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify tsc**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/approval/TempoWriteOffApprovalRequestRow.tsx
git commit -m "feat(approval): TempoWriteOffApprovalRequestRow component

Mirrors RakitLockApprovalRequestRow shape. Loads satellite reason +
order summary via piutang_write_off_requests/orders. Inline reject
reason textarea (no separate modal). Owner-only action buttons.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 12: Wire ApprovalInboxScreen dispatch + reject branch

**Files:**
- Modify: `src/components/approval/ApprovalInboxScreen.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/components/approval/ApprovalInboxScreen.tsx`, add:

```ts
import TempoWriteOffApprovalRequestRow from './TempoWriteOffApprovalRequestRow';
import { approveTempoWriteOff, rejectTempoWriteOff } from '../../lib/piutang/writeOff';
```

- [ ] **Step 2: Extend PILLS + filter union**

Find `type FilterPill = 'all' | 'adjustment' | 'price_change' | 'opname' | 'rakit_lock' | 'kasir';` and extend to:

```ts
type FilterPill = 'all' | 'adjustment' | 'price_change' | 'opname' | 'rakit_lock' | 'kasir' | 'piutang_write_off';
```

Then add to the `PILLS` array (append):

```ts
{ key: 'piutang_write_off', label: 'Tulis-off' },
```

- [ ] **Step 3: Extend handleApprove dispatch**

Find the existing handleApprove block. Right BEFORE the `if (req.requestType === 'rakit_lock')` branch, insert:

```ts
if (req.requestType === 'piutang_write_off') {
  setBusyId(id);
  try {
    await approveTempoWriteOff(id);
    showToast('Tulis-off disetujui', 'success');
    await refresh();
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Gagal menyetujui', 'warning');
  } finally {
    setBusyId(null);
  }
  return;
}
```

- [ ] **Step 4: Extend handleReject dispatch**

Find the `if (req.requestType === 'adjustment')` ... `else if (req.requestType === 'rakit_lock')` ... `else` chain. Insert before the rakit_lock branch:

```ts
} else if (req.requestType === 'piutang_write_off') {
  await rejectTempoWriteOff(id, reason ?? 'Owner reject from Persetujuan inbox');
  showToast('Tulis-off ditolak', 'info');
  await refresh();
```

(Pattern matches the existing `else if`s — keep the closing braces intact.)

- [ ] **Step 5: Extend the row render**

Find the existing render block (around line 305):

```tsx
{r.requestType === 'rakit_lock' ? (
  <RakitLockApprovalRequestRow ... />
) : (
  <ApprovalRequestRow ... />
)}
```

Change to:

```tsx
{r.requestType === 'rakit_lock' ? (
  <RakitLockApprovalRequestRow
    request={r}
    isOwner={isOwner}
    disabled={busyId !== null && busyId !== r.id}
    onApprove={handleApprove}
    onReject={handleReject}
    onEditAndApprove={(id, txId, lines) =>
      setOwnerAmendTarget({ approvalId: id, transactionId: txId, rakitLines: lines })
    }
  />
) : r.requestType === 'piutang_write_off' ? (
  <TempoWriteOffApprovalRequestRow
    request={r}
    isOwner={isOwner}
    disabled={busyId !== null && busyId !== r.id}
    actorName={actorNames[r.requestedBy]}
    onApprove={handleApprove}
    onReject={handleReject}
  />
) : (
  <ApprovalRequestRow
    request={r}
    isOwner={isOwner}
    disabled={busyId !== null && busyId !== r.id}
    onApprove={handleApprove}
    onReject={handleReject}
    actorName={actorNames[r.requestedBy]}
  />
)}
```

- [ ] **Step 6: Verify tsc + build**

Run: `npx tsc --noEmit`
Expected: zero errors.

Run: `npm run build`
Expected: `✓ built in …s`.

- [ ] **Step 7: Run full test suite**

Run: `npm test -- --run`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/approval/ApprovalInboxScreen.tsx
git commit -m "feat(approval): wire piutang_write_off into ApprovalInboxScreen

Add Tulis-off filter pill. Dispatch handleApprove/handleReject to
approveTempoWriteOff / rejectTempoWriteOff. Render new
TempoWriteOffApprovalRequestRow for matching request type.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

## Milestone D — Final validation + PR

### Task 13: Full vitest + tsc + build + progress.md

**Files:**
- Modify: `progress.md` (per CLAUDE.md gotcha — every finished task updates progress doc)

- [ ] **Step 1: Run full test suite**

Run: `npm test -- --run 2>&1 | tail -10`
Expected: `Tests  <N> passed (<N>)` with N greater than baseline (we added 8 new vitest cases: 6 wrapper + 2 fetchPiutangRows).

- [ ] **Step 2: Run tsc**

Run: `npx tsc --noEmit`
Expected: zero output.

- [ ] **Step 3: Run build**

Run: `npm run build 2>&1 | tail -5`
Expected: `✓ built in …s`.

- [ ] **Step 4: Update progress.md**

Prepend a new section at the top of `progress.md` (under the H1 title, above the most recent existing section). Insert this section:

```markdown
## 2026-06-19 — Piutang Phase 1C task 2: write-off RPC + UI

Closes the "no write-off flow" gap. Mirror of rakit_lock approval workflow: admin Tulis-off → modal collects required reason → request_tempo_write_off creates pending approval + satellite → Owner opens Persetujuan inbox → approve flips order to INVOICE_WRITTEN_OFF (schema columns already exist per migration 20260615000010) or reject closes it with a reason. Owner-only revert_tempo_write_off restores INVOICE_TEMPO in one click.

**Migrations applied to live Supabase:**
- 20260626000020: extend approval_request_type + create piutang_write_off_requests satellite + partial unique index (one pending write-off per order)
- 20260626000021: request_tempo_write_off RPC (admin)
- 20260626000022: approve_tempo_write_off + reject_tempo_write_off RPCs (Owner)
- 20260626000023: revert_tempo_write_off RPC (Owner)

**Frontend:**
- `src/lib/piutang/writeOff.ts` (new) — 4 thin RPC wrappers
- `src/lib/piutangService.ts` — `fetchPiutangRows` accepts `{ includeWrittenOff?: boolean }`
- `src/components/piutang/WriteOffRequestModal.tsx` (new) — reason + Ajukan
- `src/components/piutang/RevertWriteOffConfirmModal.tsx` (new) — destructive confirm
- `src/components/piutang/PiutangScreen.tsx` — Tulis-off filter pill (6th), per-row Tulis-off + Batal Tulis-off buttons, written_off line on Tulis-off rows
- `src/components/approval/TempoWriteOffApprovalRequestRow.tsx` (new) — Owner inbox row with inline reject-reason
- `src/components/approval/ApprovalInboxScreen.tsx` — Tulis-off pill + dispatch
- `src/types.ts` — `ApprovalRequestType` extended; `DbPiutangWriteOffRequest` added

**Security:** All RPCs `SECURITY DEFINER` with `auth.uid()` binding + Owner+Aktif filter mapped via email (PR #34 lesson: admin_users.id != auth uid for some Owners; status='Aktif' filter blocks deactivated Owners; OWNER_AMBIGUOUS guard).

**Verification:** 195+8=203 vitest pass, tsc clean, build clean. SQL smoke: 11 scenarios green (request happy/wrong-status/duplicate; approve non-Owner/Tidak-Aktif/happy/race/reject; revert happy/wrong-status/non-Owner).

**Deferred (per spec non-goals):** Bad Debt YTD KPI card; auto-write-off policy; bulk write-off; WA notification to customer.

---
```

- [ ] **Step 5: Commit progress.md**

```bash
git add progress.md
git commit -m "docs(progress): Piutang Phase 1C task 2 — write-off RPC + UI

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 14: Push branch + open PR

**Files:** none (git ops)

- [ ] **Step 1: Push**

Run: `git push -u origin feat/piutang-write-off 2>&1 | tail -5`
Expected: branch creates on remote; gh URL in output.

- [ ] **Step 2: Open PR**

Run:

```bash
gh pr create --title "feat(piutang): Phase 1C task 2 — write-off RPC + UI" --body "$(cat <<'EOF'
## Summary

Adds a two-step Owner-approved write-off flow for uncollectible tempo (credit) invoices, plus a one-click Owner revert path. Closes the "no write-off flow" gap that was distorting AR aging buckets.

Mirrors the rakit_lock approval workflow precedent (PR #27). All RPCs `SECURITY DEFINER` with `auth.uid()` binding and Owner+Aktif filter mapped via email (PR #34 security lesson preserved).

## Migrations (applied to live Supabase via MCP)

- `20260626000020` — extend `approval_request_type` enum + create `piutang_write_off_requests` satellite + partial unique index (one pending write-off per order so admin can resubmit after a reject)
- `20260626000021` — `request_tempo_write_off(p_order_id, p_reason)` (admin)
- `20260626000022` — `approve_tempo_write_off(p_approval_id)` + `reject_tempo_write_off(p_approval_id, p_reason)` (Owner)
- `20260626000023` — `revert_tempo_write_off(p_order_id)` (Owner)

## Frontend

- New: `src/lib/piutang/writeOff.ts` (4 thin RPC wrappers)
- New: `src/components/piutang/WriteOffRequestModal.tsx` (reason + Ajukan)
- New: `src/components/piutang/RevertWriteOffConfirmModal.tsx` (destructive confirm)
- New: `src/components/approval/TempoWriteOffApprovalRequestRow.tsx` (Owner inbox row with inline reject-reason)
- Modify: `src/components/piutang/PiutangScreen.tsx` — 6th 'Tulis-off' filter pill + Tulis-off / Batal Tulis-off buttons + written_off inline display
- Modify: `src/components/approval/ApprovalInboxScreen.tsx` — Tulis-off filter pill + dispatch wiring
- Modify: `src/lib/piutangService.ts` — `fetchPiutangRows({ includeWrittenOff?: boolean })`
- Modify: `src/types.ts` — `ApprovalRequestType` extended + `DbPiutangWriteOffRequest`

## Test Plan

**Already done locally:**

- [x] 203/203 vitest pass (8 new cases: 6 wrapper + 2 fetchPiutangRows extension)
- [x] `npx tsc --noEmit` clean
- [x] `npm run build` clean
- [x] SQL smoke (11 scenarios) — all green: request happy / wrong-status / duplicate; approve non-Owner / Tidak Aktif / happy / race / reject; revert happy / wrong-status / non-Owner

**To verify in production after merge (Chrome DevTools MCP):**

- [ ] Open Piutang, click Tulis-off on a row, enter reason ≥ 10 chars, submit → toast "Tulis-off diajukan ke Owner"; row stays in original bucket
- [ ] Open Persetujuan inbox as Owner → see Tulis-off request → Setujui Tulis-off → row leaves inbox
- [ ] Switch to PiutangScreen Tulis-off pill → row appears with reason inline
- [ ] Click Batal Tulis-off → destructive confirm → Ya → toast "Tulis-off dibatalkan"; row returns to its aging bucket pill
- [ ] Negative: click Tulis-off on a PAYMENT_VERIFIED invoice (button shouldn't show); submit reason < 10 chars (Ajukan stays disabled); rejected request — admin can re-submit (partial unique index allows it)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" 2>&1 | tail -3
```

Expected: PR URL prints.

- [ ] **Step 3: Output PR URL to the user**

Print the PR URL plain so the user can click through.

---

## Self-Review Checklist (run by the implementer before declaring done)

1. **All 4 migration slots present** (`020`, `021`, `022`, `023`) and named exactly per the spec.
2. **`status = 'Aktif'`** (capital A, Indonesian) — NOT `'active'`. The existing `approve_and_amend_rakit_lock` migration uses `'active'` (pre-PR-#34 bug in another RPC); the new RPCs in this PR must use `'Aktif'` to match live data.
3. **`auth.uid()` binding** in approve / reject / revert RPCs — never `ORDER BY id LIMIT 1` or any other heuristic owner-pick.
4. **Email-based mapping** in `_piutang_write_off_resolve_owner` (because admin_users.id != auth.uid for Jenny).
5. **`expires_at` set to far-future** (`'9999-12-31'`) in `request_tempo_write_off` so the no-expiry founder decision survives the NOT NULL default.
6. **Partial unique index** uses subquery-on-pending-approval; if Postgres rejects subqueries in index predicates, the fallback BEFORE INSERT trigger raises `WRITE_OFF_ALREADY_PENDING:` with the same shape.
7. **Audit events** emitted on EVERY transition: `tempo_write_off_requested`, `tempo_write_off_approved`, `tempo_write_off_rejected` (auto AND manual), `tempo_write_off_reverted`.
8. **TempoWriteOffApprovalRequestRow** loads satellite + order in `useEffect`; if either fetch fails the row still renders with placeholders (never crashes the inbox).
9. **`actorName` lookup** in ApprovalInboxScreen render block — same `actorNames[r.requestedBy]` pattern as other types.
10. **Progress.md** prepended (not appended) per repo convention (newest first).

If any of these are wrong, fix before declaring complete and re-run vitest + tsc + build.
