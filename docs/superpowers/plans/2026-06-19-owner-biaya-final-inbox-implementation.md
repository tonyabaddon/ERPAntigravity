# Owner Biaya Final — Inbox Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the new Sales funnel (sub-stages 3f/3g/3h) into the existing `rakit_lock` approval infrastructure, replacing the inline "Setujui Biaya Final" stopgap shipped in PR #25.

**Architecture:** Reuse all existing pieces — `approval_requests` table, `request_type='rakit_lock'` enum value, `LockSubmissionModal`, `ApprovalInboxScreen` with its "Rakit Lock" filter pill, `RakitLockApprovalRequestRow`, the four existing RPCs (`request_rakit_lock`, `commit_approved_rakit_lock`, `reject_rakit_lock`, `withdraw_rakit_lock`). The work is plumbing: extend the four existing RPCs to set `kasir_transactions.funnel_sub_stage` atomically; add one new RPC (`approve_and_amend_rakit_lock`) for Owner edit-then-approve; remove the inline 3g button; add a new entry point at funnel 3f that opens the existing `LockSubmissionModal`; add reject-reason chip and Riwayat Persetujuan panel.

**Tech Stack:** React + TypeScript (Vite), Vitest (NO React Testing Library, NO jsdom), Tailwind CSS v4 with theme tokens, Supabase Postgres + Realtime + RLS, jsPDF (untouched here).

**Reference spec:** `docs/superpowers/specs/2026-06-19-owner-biaya-final-inbox-integration-design.md` (commit `d6d1510` on `feat/owner-biaya-final-inbox-spec`).

**Branch + worktree:** Continue on `feat/owner-biaya-final-inbox-spec` for the spec commit. Create a worktree `.claude/worktrees/owner-biaya-final` off this branch before starting Task 1.

---

## File Structure

**Backend migrations (4 new files, all under `supabase/migrations/`):**

- `20260626000001_extend_request_rakit_lock_funnel.sql` — CREATE OR REPLACE the existing `request_rakit_lock` function to set `funnel_sub_stage='3g'` at the end of its body
- `20260626000002_extend_commit_approved_rakit_lock_funnel.sql` — CREATE OR REPLACE `commit_approved_rakit_lock` to set `funnel_sub_stage='3h'` at the end
- `20260626000003_extend_reject_withdraw_rakit_lock_funnel.sql` — CREATE OR REPLACE `reject_rakit_lock` to insert `audit_log(event_type='rakit_lock_rejected')` and set `funnel_sub_stage='3f'`; CREATE OR REPLACE `withdraw_rakit_lock` to set `funnel_sub_stage='3f'`
- `20260626000004_approve_and_amend_rakit_lock.sql` — NEW RPC `approve_and_amend_rakit_lock(p_approval_id BIGINT, p_amended_lines JSONB)` that: checks Owner role via `auth.uid()`, inserts audit_log first, UPDATEs `rakit_job_lines`, DELETE+INSERTs `rakit_components`, transitions approval to `'approved'` with `decision_channel='owner_app_edit'`, calls `commit_approved_rakit_lock`

**Lib changes (3 files):**

- Modify `src/lib/supabaseClient.ts` — add `approveAndAmendRakitLock` wrapper; the existing `requestRakitLock`/`approveRakitLock`/`rejectRakitLock`/`withdrawRakitLock`/`fetchRakitLockRequestByApprovalId` stay
- Create `src/lib/sales/recentRejects.ts` + `recentRejects.test.ts` — `fetchRecentRejectsByOrder(orderIds)` batch query of `audit_log` for `event_type='rakit_lock_rejected'` within last 7 days
- Modify `src/lib/sales/queries.ts` — add `fetchRakitLockHistory(orderId)` returning typed events from `audit_log`

**UI changes (6 files modified, 1 new):**

- Modify `src/components/sales/ActionPanel.tsx` — remove the inline `✓ Setujui Biaya Final` button and the `onApproveBiayaFinal` prop; add a `Withdraw` button at sub-stage 3g (calls `withdrawRakitLock`)
- Modify `src/components/sales/DaftarPesananScreen.tsx` — when admin clicks `Selesai` at 3f on a CP/RP order, open `LockSubmissionModal` instead of calling `transitionOrder`; fetch recent rejects map on mount; remove `handleApproveBiayaFinal`
- Modify `src/components/sales/SubStageSection.tsx` — pass `rejectInfoMap` through to OrderRow
- Modify `src/components/sales/OrderRow.tsx` — render `⚠️ Owner: <reason>` chip at sub-stage 3f when entry exists
- Create `src/components/sales/RiwayatPersetujuanPanel.tsx` + minimal test — list rakit_lock events for an order, with diff expansion for `rakit_lock_approved_with_edit`
- Modify `src/components/penjualan/LockSubmissionModal.tsx` — add `mode: 'admin-submit' | 'owner-amend'` prop (default `'admin-submit'`); when `owner-amend`, call `approveAndAmendRakitLock` instead of `requestRakitLock`; header label adjusts
- Modify `src/components/approval/RakitLockApprovalRequestRow.tsx` — add `✏️ Edit & Approve` button between Approve and Reject

**No changes to:** `quickActionMap.ts`, `stageMapping.ts`, `App.tsx` sidebar nav, `ApprovalInboxScreen.tsx` filter pills, `OwnerPinPad.tsx` (PIN flow not used), PDF generators, migration `20260625000007` (existing transition RPC unchanged).

---

## Pre-flight

### Task 0: Worktree + baseline

**Files:** N/A — setup only.

- [ ] **Step 1: Create the worktree off the spec branch**

Run:
```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
git fetch origin
git worktree add .claude/worktrees/owner-biaya-final feat/owner-biaya-final-inbox-spec
cd .claude/worktrees/owner-biaya-final
git log --oneline -3
```

Expected: top commit is `d6d1510 docs: Owner biaya final — inbox integration design spec`, with `0ef804a fix(sales): preserve 🙏 emoji ...` immediately below.

- [ ] **Step 2: Baseline test run**

Run: `npm test -- --run src/lib`

Expected: all pass (163 lib tests as of `0ef804a`). Note the count — final test run should be 175+ (we add ~12 tests).

- [ ] **Step 3: Verify rakit_lock infra is present**

Run:
```bash
ls supabase/migrations/20260609000010_rakit_workflow_revision.sql
grep -c "FUNCTION public.request_rakit_lock\|FUNCTION public.commit_approved_rakit_lock\|FUNCTION public.reject_rakit_lock\|FUNCTION public.withdraw_rakit_lock" supabase/migrations/20260609000010_rakit_workflow_revision.sql
```

Expected: the migration file exists; grep returns `4` (one per RPC).

- [ ] **Step 4: Verify existing wrappers**

Run: `grep -n "^export async function \(request\|approve\|reject\|withdraw\)RakitLock\|fetchRakitLockRequestByApprovalId" src/lib/supabaseClient.ts`

Expected: 5 lines, one per wrapper.

---

## Milestone A — Backend migrations

Backend RPCs use Postgres `CREATE OR REPLACE`. Apply to live Supabase via `mcp__plugin_supabase_supabase__apply_migration` after each task, then smoke via `execute_sql` on a seeded fixture order. No Vitest coverage for SQL — verification is the SQL smoke at the end of each task.

### Task A1: Extend `request_rakit_lock` to set funnel_sub_stage='3g'

**Files:**
- Create: `supabase/migrations/20260626000001_extend_request_rakit_lock_funnel.sql`

- [ ] **Step 1: Read existing RPC body**

Run: `sed -n '/CREATE OR REPLACE FUNCTION public.request_rakit_lock/,/^GRANT EXECUTE/p' supabase/migrations/20260609000010_rakit_workflow_revision.sql > /tmp/request_rakit_lock_body.sql`

Inspect `/tmp/request_rakit_lock_body.sql` to confirm structure. Expected: function takes `p_transaction_id UUID, p_lines JSONB, p_actor_user_id UUID`, ends just before the `RETURN v_approval;` line.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260626000001_extend_request_rakit_lock_funnel.sql` with:

```sql
-- Phase 1B follow-up: extend request_rakit_lock to set funnel_sub_stage='3g'
-- so the Sales funnel position stays in sync with the approval state.
--
-- Idempotent CREATE OR REPLACE. The only change vs the version in
-- migration 20260609000010 is the single UPDATE at the end (just before
-- RETURN v_approval).

CREATE OR REPLACE FUNCTION public.request_rakit_lock(
  p_transaction_id  UUID,
  p_lines           JSONB,
  p_actor_user_id   UUID DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_actor    UUID;
  v_status   TEXT;
  v_approval BIGINT;
  v_lock_req BIGINT;
  v_payload  JSONB;
  v_line     JSONB;
  v_line_id  UUID;
  v_comp     JSONB;
BEGIN
  -- [Body identical to migration 20260609000010 — paste the full body here
  --  from /tmp/request_rakit_lock_body.sql, EXCLUDING the original
  --  `RETURN v_approval;` final line. The implementer must inline the full
  --  existing body verbatim; the only new addition is the UPDATE below.]

  -- NEW: keep Sales funnel position in sync with approval state.
  UPDATE public.kasir_transactions
     SET funnel_sub_stage = '3g'
   WHERE id = p_transaction_id;

  RETURN v_approval;
END;
$$;

REVOKE ALL ON FUNCTION public.request_rakit_lock(UUID, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_rakit_lock(UUID, JSONB, UUID) TO authenticated;

COMMENT ON FUNCTION public.request_rakit_lock IS
  'Admin submits material/labor costs for rakit. Inserts approval_request, locks rakit_job_lines, inserts rakit_components, and advances Sales funnel to 3g.';
```

The body MUST be the exact existing body from migration `20260609000010`. The only difference is the `UPDATE public.kasir_transactions` block before `RETURN`. The implementer copy-pastes the body verbatim then adds the new UPDATE.

- [ ] **Step 3: Apply the migration**

Use the Supabase MCP: `mcp__plugin_supabase_supabase__apply_migration` with `name="20260626000001_extend_request_rakit_lock_funnel"` and the file content.

Expected: applies cleanly (CREATE OR REPLACE is idempotent).

- [ ] **Step 4: Smoke test the funnel update**

Use `mcp__plugin_supabase_supabase__execute_sql`:

```sql
-- Find any existing rakit_job_line on a CP/RP test order, or seed one.
WITH test_order AS (
  SELECT id FROM kasir_transactions
   WHERE order_type IN ('CUSTOM_PANEL', 'RAKIT_PANEL')
     AND status = 'WIP'
   LIMIT 1
)
SELECT id, funnel_sub_stage FROM test_order;
```

If a row exists, call `request_rakit_lock` with synthetic lines (just verify funnel_sub_stage moves; you may need to also `UPDATE kasir_transactions SET funnel_sub_stage='3f' WHERE id=...` first to confirm the transition). After call: `SELECT funnel_sub_stage FROM kasir_transactions WHERE id=...` should return `'3g'`.

If no test order exists, skip the smoke and rely on the integration smoke in Task G2.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260626000001_extend_request_rakit_lock_funnel.sql
git commit -m "feat(sales): extend request_rakit_lock to set funnel_sub_stage='3g'"
```

### Task A2: Extend `commit_approved_rakit_lock` to set funnel_sub_stage='3h'

**Files:**
- Create: `supabase/migrations/20260626000002_extend_commit_approved_rakit_lock_funnel.sql`

- [ ] **Step 1: Read existing RPC body**

Run: `sed -n '/CREATE OR REPLACE FUNCTION public.commit_approved_rakit_lock/,/REVOKE ALL.*commit_approved_rakit_lock/p' supabase/migrations/20260609000010_rakit_workflow_revision.sql > /tmp/commit_rakit_lock_body.sql`

Inspect to confirm structure. The body ends with `UPDATE kasir_transactions SET status = v_new_status WHERE id = v_rr.transaction_id;`.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260626000002_extend_commit_approved_rakit_lock_funnel.sql`:

```sql
-- Phase 1B follow-up: extend commit_approved_rakit_lock to also set
-- funnel_sub_stage='3h'. Fires regardless of whether Owner used plain
-- Approve or Edit & Approve (the new approve_and_amend RPC delegates here).
--
-- Idempotent CREATE OR REPLACE. Only addition vs migration 20260609000010
-- is the trailing UPDATE.

CREATE OR REPLACE FUNCTION public.commit_approved_rakit_lock(
  p_approval_id    BIGINT,
  p_hpp_overrides  JSONB DEFAULT '{}'::jsonb
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_ar          RECORD;
  v_rr          RECORD;
  v_tx_id       UUID;
  v_dp          NUMERIC;
  v_total       NUMERIC;
  v_new_status  TEXT;
  v_line        RECORD;
  v_comp        RECORD;
  v_qty_before  INT;
  v_hpp_final   NUMERIC;
BEGIN
  -- [Body identical to migration 20260609000010 — paste verbatim, ending
  --  with the existing UPDATE on kasir_transactions.status.]

  -- NEW: advance Sales funnel position to 3h.
  UPDATE public.kasir_transactions
     SET funnel_sub_stage = '3h'
   WHERE id = v_rr.transaction_id;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_approved_rakit_lock(BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commit_approved_rakit_lock(BIGINT, JSONB) TO authenticated;

COMMENT ON FUNCTION public.commit_approved_rakit_lock IS
  'Owner-approved rakit lock commit. Writes stock_movements, locks HPP, sets kasir_transactions.status, and advances Sales funnel to 3h.';
```

- [ ] **Step 3: Apply + smoke + commit**

Apply via MCP. Smoke if a 3g approval exists: approve it, verify `funnel_sub_stage` becomes `'3h'`. Otherwise rely on Task G2.

```bash
git add supabase/migrations/20260626000002_extend_commit_approved_rakit_lock_funnel.sql
git commit -m "feat(sales): extend commit_approved_rakit_lock to set funnel_sub_stage='3h'"
```

### Task A3: Extend reject + withdraw to set funnel_sub_stage='3f'

**Files:**
- Create: `supabase/migrations/20260626000003_extend_reject_withdraw_rakit_lock_funnel.sql`

- [ ] **Step 1: Read existing bodies**

Run:
```bash
sed -n '/CREATE OR REPLACE FUNCTION public.reject_rakit_lock/,/REVOKE ALL.*reject_rakit_lock/p' supabase/migrations/20260609000010_rakit_workflow_revision.sql > /tmp/reject_rakit_lock_body.sql
sed -n '/CREATE OR REPLACE FUNCTION public.withdraw_rakit_lock/,/REVOKE ALL.*withdraw_rakit_lock/p' supabase/migrations/20260609000010_rakit_workflow_revision.sql > /tmp/withdraw_rakit_lock_body.sql
```

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260626000003_extend_reject_withdraw_rakit_lock_funnel.sql`:

```sql
-- Phase 1B follow-up:
--  - reject_rakit_lock: insert audit_log row + set funnel_sub_stage='3f'
--  - withdraw_rakit_lock: set funnel_sub_stage='3f'
-- Both idempotent CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.reject_rakit_lock(
  p_approval_id  BIGINT,
  p_reason       TEXT,
  p_actor_user_id UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_actor UUID;
  v_ar RECORD;
  v_rr RECORD;
BEGIN
  v_actor := COALESCE(p_actor_user_id, auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);

  -- [Body identical to migration 20260609000010, EXCLUDING any final
  --  RETURN. The implementer copies the existing body verbatim and adds
  --  the two NEW blocks below.]

  -- NEW: audit log first (per PR #25 precedent — audit before mutation).
  INSERT INTO public.audit_log(event_type, actor_user_id, payload)
  VALUES (
    'rakit_lock_rejected',
    v_actor,
    jsonb_build_object(
      'approval_id', p_approval_id,
      'order_id', v_rr.transaction_id,
      'reason', p_reason
    )
  );

  -- NEW: walk the funnel back to 3f so admin can revise + resubmit.
  UPDATE public.kasir_transactions
     SET funnel_sub_stage = '3f'
   WHERE id = v_rr.transaction_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_rakit_lock(BIGINT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_rakit_lock(BIGINT, TEXT, UUID) TO authenticated;

COMMENT ON FUNCTION public.reject_rakit_lock IS
  'Owner rejects rakit_lock approval. Logs to audit_log and resets funnel to 3f for admin revision.';


CREATE OR REPLACE FUNCTION public.withdraw_rakit_lock(
  p_approval_id BIGINT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_ar RECORD;
  v_rr RECORD;
BEGIN
  -- [Body identical to migration 20260609000010 verbatim.]

  -- NEW: keep Sales funnel position in sync with withdraw.
  UPDATE public.kasir_transactions
     SET funnel_sub_stage = '3f'
   WHERE id = v_rr.transaction_id;
END;
$$;

REVOKE ALL ON FUNCTION public.withdraw_rakit_lock(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.withdraw_rakit_lock(BIGINT) TO authenticated;

COMMENT ON FUNCTION public.withdraw_rakit_lock IS
  'Admin withdraws own pending rakit_lock approval. Resets Sales funnel to 3f.';
```

- [ ] **Step 3: Apply + commit**

```bash
git add supabase/migrations/20260626000003_extend_reject_withdraw_rakit_lock_funnel.sql
git commit -m "feat(sales): extend reject/withdraw rakit_lock to set funnel_sub_stage='3f'"
```

### Task A4: New `approve_and_amend_rakit_lock` RPC

**Files:**
- Create: `supabase/migrations/20260626000004_approve_and_amend_rakit_lock.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260626000004_approve_and_amend_rakit_lock.sql`:

```sql
-- Owner Edit & Approve in one transaction. The Owner opens an existing
-- pending approval, amends rakit_job_lines + rakit_components values
-- (final_price, tracking_mode, labor_cost, lump_sum_hpp, components),
-- then triggers commit_approved_rakit_lock in the same RPC.

CREATE OR REPLACE FUNCTION public.approve_and_amend_rakit_lock(
  p_approval_id    BIGINT,
  p_amended_lines  JSONB
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_actor       UUID;
  v_ar          RECORD;
  v_rr          RECORD;
  v_admin_snap  JSONB;
  v_owner_snap  JSONB;
  v_diff_keys   TEXT[];
  v_line        JSONB;
  v_line_id     UUID;
  v_comp        JSONB;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'OWNER_ONLY: no authenticated user';
  END IF;

  -- Owner-only gate. Server-side authoritative; client also hides buttons.
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
     WHERE id = v_actor
       AND role = 'Owner'
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'OWNER_ONLY: actor % is not an active Owner', v_actor;
  END IF;

  -- Take row lock on approval to block concurrent approvers.
  SELECT * INTO v_ar FROM public.approval_requests WHERE id = p_approval_id FOR UPDATE;
  IF v_ar.id IS NULL THEN
    RAISE EXCEPTION 'APPROVAL_NOT_FOUND: %', p_approval_id;
  END IF;
  IF v_ar.status != 'pending' THEN
    RAISE EXCEPTION 'APPROVAL_NOT_PENDING: id=% status=%', p_approval_id, v_ar.status;
  END IF;
  IF v_ar.request_type != 'rakit_lock' THEN
    RAISE EXCEPTION 'WRONG_TYPE: id=% type=%', p_approval_id, v_ar.request_type;
  END IF;

  -- Fetch the linked rakit_lock_requests row (snapshot of admin's submission).
  SELECT * INTO v_rr FROM public.rakit_lock_requests WHERE approval_id = p_approval_id;
  IF v_rr.id IS NULL THEN
    RAISE EXCEPTION 'RAKIT_LOCK_REQUEST_NOT_FOUND for approval %', p_approval_id;
  END IF;

  v_admin_snap := v_ar.payload;
  v_owner_snap := jsonb_build_object('amended_lines', p_amended_lines);

  -- Build a list of diff keys at the line-level for the audit log.
  -- This is best-effort — implementer can use jsonb_object_keys + EXCEPT
  -- against v_admin_snap->'lines' OR just record both snapshots.
  v_diff_keys := ARRAY(
    SELECT k FROM jsonb_object_keys(p_amended_lines) k
  );

  -- NEW: audit log FIRST (per PR #25 precedent).
  INSERT INTO public.audit_log(event_type, actor_user_id, payload)
  VALUES (
    'rakit_lock_approved_with_edit',
    v_actor,
    jsonb_build_object(
      'approval_id', p_approval_id,
      'order_id', v_rr.transaction_id,
      'admin_submitted', v_admin_snap,
      'owner_amended', v_owner_snap,
      'diff_keys', v_diff_keys
    )
  );

  -- Apply Owner's amendments to rakit_job_lines + replace components.
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_amended_lines) LOOP
    v_line_id := (v_line->>'id')::UUID;
    UPDATE public.rakit_job_lines
       SET final_price   = (v_line->>'final_price')::NUMERIC,
           tracking_mode = v_line->>'tracking_mode',
           labor_cost    = COALESCE((v_line->>'labor_cost')::NUMERIC, 0),
           lump_sum_hpp  = COALESCE((v_line->>'lump_sum_hpp')::NUMERIC, 0),
           updated_at    = NOW()
     WHERE id = v_line_id;

    -- Replace components atomically: delete old, insert amended.
    DELETE FROM public.rakit_components WHERE rakit_line_id = v_line_id;
    FOR v_comp IN SELECT * FROM jsonb_array_elements(COALESCE(v_line->'components', '[]'::jsonb)) LOOP
      INSERT INTO public.rakit_components (
        rakit_line_id, sku, name, qty, warehouse, fifo_cost_snapshot
      ) VALUES (
        v_line_id,
        v_comp->>'sku',
        v_comp->>'name',
        (v_comp->>'qty')::NUMERIC,
        COALESCE(v_comp->>'warehouse', 'atas'),
        COALESCE((v_comp->>'fifo_cost')::NUMERIC, 0)
      );
    END LOOP;
  END LOOP;

  -- Transition approval to 'approved' with the edit channel.
  UPDATE public.approval_requests
     SET status = 'approved',
         decided_by = v_actor,
         decided_at = NOW(),
         decision_channel = 'owner_app_edit'
   WHERE id = p_approval_id;

  -- Delegate the commit work (stock_movements, HPP lock, tx.status,
  -- funnel_sub_stage='3h'). commit_approved_rakit_lock requires the
  -- approval row to be in 'approved' state, which we just set above.
  PERFORM public.commit_approved_rakit_lock(p_approval_id, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_and_amend_rakit_lock(BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_and_amend_rakit_lock(BIGINT, JSONB) TO authenticated;

COMMENT ON FUNCTION public.approve_and_amend_rakit_lock IS
  'Owner edit-then-approve in one atomic transaction. Owner-only via admin_users.role.';
```

**Caveat:** the existing `commit_approved_rakit_lock` checks for `status='approved'` — make sure the order of operations works (transition the approval row first, then call commit). Verify by reading the existing commit body.

- [ ] **Step 2: Apply via MCP**

Use `mcp__plugin_supabase_supabase__apply_migration`.

- [ ] **Step 3: Smoke test Owner-only gate**

```sql
-- Negative test: call as a non-Owner role (or with a fake actor)
SELECT public.approve_and_amend_rakit_lock(999999, '[]'::jsonb);
-- Expect: ERROR with 'OWNER_ONLY' or 'APPROVAL_NOT_FOUND'
```

If the error contains `OWNER_ONLY` or `APPROVAL_NOT_FOUND`, the function exists and the gate works at the function level (the not-found case is fine because we don't have a real approval to amend; gate is the important check).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260626000004_approve_and_amend_rakit_lock.sql
git commit -m "feat(sales): new approve_and_amend_rakit_lock RPC for Owner edit-then-approve"
```

---

## Milestone B — Lib layer

### Task B1: Add `approveAndAmendRakitLock` wrapper + test

**Files:**
- Modify: `src/lib/supabaseClient.ts`
- Test: `src/lib/__tests__/rakitLockWrappers.test.ts` (create if not present)

- [ ] **Step 1: Write the failing test**

Find an existing test file that mocks `supabase` (e.g. `src/lib/sales/queries.test.ts`) to mirror the idiom. Create `src/lib/__tests__/rakitLockWrappers.test.ts`:

```typescript
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockRpc = vi.fn();
vi.mock('../supabaseClient', async () => {
  const actual = await vi.importActual<typeof import('../supabaseClient')>('../supabaseClient');
  return {
    ...actual,
    // Override the `supabase` export so wrappers go through our mock.
    supabase: {
      rpc: mockRpc,
    } as unknown as typeof actual.supabase,
  };
});

import { approveAndAmendRakitLock } from '../supabaseClient';

describe('approveAndAmendRakitLock', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  test('calls approve_and_amend_rakit_lock with correct params', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await approveAndAmendRakitLock(42, [{ id: 'line-1', final_price: 8500000 }]);
    expect(mockRpc).toHaveBeenCalledWith('approve_and_amend_rakit_lock', {
      p_approval_id: 42,
      p_amended_lines: [{ id: 'line-1', final_price: 8500000 }],
    });
  });

  test('throws on rpc error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'OWNER_ONLY' } });
    await expect(approveAndAmendRakitLock(42, [])).rejects.toMatchObject({ message: 'OWNER_ONLY' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/rakitLockWrappers.test.ts`
Expected: FAIL with "approveAndAmendRakitLock is not a function" / undefined import.

- [ ] **Step 3: Add the wrapper to `src/lib/supabaseClient.ts`**

Find the existing `approveRakitLock` function (around line 2097) and insert this function immediately after it:

```typescript
export async function approveAndAmendRakitLock(
  approvalId: number,
  amendedLines: Array<{
    id: string;
    final_price: number;
    tracking_mode: 'detail' | 'lumpsum';
    labor_cost: number;
    lump_sum_hpp: number;
    components?: Array<{
      sku: string;
      name: string;
      qty: number;
      warehouse: 'atas' | 'bawah';
      fifo_cost: number;
    }>;
  }>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.rpc('approve_and_amend_rakit_lock', {
    p_approval_id: approvalId,
    p_amended_lines: amendedLines,
  });
  if (error) throw error;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/rakitLockWrappers.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Verify nothing else broke**

Run: `npx tsc --noEmit && npx vitest run src/lib`
Expected: TS clean; full lib suite at 165 tests (163 baseline + 2 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabaseClient.ts src/lib/__tests__/rakitLockWrappers.test.ts
git commit -m "feat(sales/lib): approveAndAmendRakitLock supabase wrapper"
```

### Task B2: `recentRejects` helper + tests

**Files:**
- Create: `src/lib/sales/recentRejects.ts`
- Test: `src/lib/sales/recentRejects.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/sales/recentRejects.test.ts`:

```typescript
import { describe, test, expect, vi, beforeEach } from 'vitest';

const fromSpy = vi.fn();
vi.mock('../supabaseClient', () => ({
  supabase: { from: (table: string) => fromSpy(table) },
}));

import { fetchRecentRejectsByOrder } from './recentRejects';

function mockChain(rows: unknown[]) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
  };
  return chain;
}

describe('fetchRecentRejectsByOrder', () => {
  beforeEach(() => { fromSpy.mockReset(); });

  test('returns empty map when no rejects found', async () => {
    fromSpy.mockReturnValueOnce(mockChain([]));
    const result = await fetchRecentRejectsByOrder(['order-1', 'order-2']);
    expect(result).toEqual({});
    expect(fromSpy).toHaveBeenCalledWith('audit_log');
  });

  test('returns map of most-recent reject per order', async () => {
    fromSpy.mockReturnValueOnce(mockChain([
      { actor_user_id: 'u1', created_at: '2026-06-18T10:00:00Z', payload: { order_id: 'order-1', reason: 'Margin tipis' } },
      { actor_user_id: 'u1', created_at: '2026-06-15T10:00:00Z', payload: { order_id: 'order-1', reason: 'Earlier reject' } },
      { actor_user_id: 'u2', created_at: '2026-06-17T10:00:00Z', payload: { order_id: 'order-2', reason: 'Cek labor' } },
    ]));
    const result = await fetchRecentRejectsByOrder(['order-1', 'order-2', 'order-3']);
    expect(result['order-1']?.reason).toBe('Margin tipis');
    expect(result['order-1']?.rejected_at).toBe('2026-06-18T10:00:00Z');
    expect(result['order-2']?.reason).toBe('Cek labor');
    expect(result['order-3']).toBeUndefined();
  });

  test('returns empty map when orderIds is empty', async () => {
    const result = await fetchRecentRejectsByOrder([]);
    expect(result).toEqual({});
    expect(fromSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/sales/recentRejects.test.ts`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/lib/sales/recentRejects.ts`:

```typescript
import { supabase } from '../supabaseClient';

export interface RejectInfo {
  reason: string;
  rejected_at: string;
  rejected_by: string | null;
}

/**
 * Batch fetch the most-recent `rakit_lock_rejected` audit_log entry per
 * order, within the last 7 days. Used by DaftarPesananScreen to surface a
 * chip on funnel sub-stage 3f rows.
 *
 * Returns an empty map when `orderIds` is empty (avoids a wasted query).
 */
export async function fetchRecentRejectsByOrder(
  orderIds: string[],
): Promise<Record<string, RejectInfo>> {
  if (orderIds.length === 0) return {};
  if (!supabase) return {};

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('audit_log')
    .select('actor_user_id, created_at, payload')
    .eq('event_type', 'rakit_lock_rejected')
    .gte('created_at', sevenDaysAgo)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('fetchRecentRejectsByOrder failed', error);
    return {};
  }

  const map: Record<string, RejectInfo> = {};
  for (const row of data ?? []) {
    const payload = (row as { payload: { order_id?: string; reason?: string } }).payload;
    const orderId = payload?.order_id;
    if (!orderId || !orderIds.includes(orderId)) continue;
    if (map[orderId]) continue; // keep first (most recent because sorted DESC)
    map[orderId] = {
      reason: payload.reason ?? '(tanpa alasan)',
      rejected_at: (row as { created_at: string }).created_at,
      rejected_by: (row as { actor_user_id: string | null }).actor_user_id,
    };
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/sales/recentRejects.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sales/recentRejects.ts src/lib/sales/recentRejects.test.ts
git commit -m "feat(sales/lib): fetchRecentRejectsByOrder for 3f reject-reason chips"
```

### Task B3: `fetchRakitLockHistory` + test

**Files:**
- Modify: `src/lib/sales/queries.ts`
- Modify: `src/lib/sales/queries.test.ts` (extend)

- [ ] **Step 1: Add typed events to queries.ts header**

Open `src/lib/sales/queries.ts`. After the imports, add:

```typescript
export type RakitLockHistoryEvent =
  | { type: 'requested';                created_at: string; actor_user_id: string | null; admin_submitted: unknown }
  | { type: 'approved';                  created_at: string; actor_user_id: string | null }
  | { type: 'approved_with_edit';        created_at: string; actor_user_id: string | null; admin_submitted: unknown; owner_amended: unknown; diff_keys: string[] }
  | { type: 'rejected';                  created_at: string; actor_user_id: string | null; reason: string };
```

- [ ] **Step 2: Write the failing test**

Append to `src/lib/sales/queries.test.ts`:

```typescript
import { fetchRakitLockHistory } from './queries';

describe('fetchRakitLockHistory', () => {
  test('maps audit_log rows to typed events in chronological order', async () => {
    // [Use the file's existing supabase mock pattern. The mock should
    //  resolve to these rows for the audit_log table:]
    const rows = [
      { event_type: 'rakit_lock_approved_with_edit', actor_user_id: 'u1', created_at: '2026-06-18T15:00:00Z',
        payload: { order_id: 'ord-1', admin_submitted: { foo: 1 }, owner_amended: { foo: 2 }, diff_keys: ['foo'] } },
      { event_type: 'rakit_lock_requested', actor_user_id: 'u2', created_at: '2026-06-18T10:00:00Z',
        payload: { order_id: 'ord-1', admin_submitted: { foo: 1 } } },
    ];
    // [Wire the existing mock to return `rows` from the audit_log query.]
    const events = await fetchRakitLockHistory('ord-1');
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('approved_with_edit');
    expect(events[1].type).toBe('requested');
    if (events[0].type === 'approved_with_edit') {
      expect(events[0].diff_keys).toEqual(['foo']);
    }
  });
});
```

The "wire the mock" step depends on how the existing tests are structured. Run `head -50 src/lib/sales/queries.test.ts` to see the idiom and adapt the test accordingly.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/sales/queries.test.ts -t fetchRakitLockHistory`
Expected: FAIL — function not exported.

- [ ] **Step 4: Implement `fetchRakitLockHistory` in queries.ts**

Append to `src/lib/sales/queries.ts`:

```typescript
export async function fetchRakitLockHistory(orderId: string): Promise<RakitLockHistoryEvent[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('audit_log')
    .select('event_type, actor_user_id, created_at, payload')
    .in('event_type', [
      'rakit_lock_requested',
      'rakit_lock_approved',
      'rakit_lock_approved_with_edit',
      'rakit_lock_rejected',
    ])
    .order('created_at', { ascending: false });
  if (error) {
    console.error('fetchRakitLockHistory failed', error);
    return [];
  }
  const events: RakitLockHistoryEvent[] = [];
  for (const row of data ?? []) {
    const r = row as { event_type: string; actor_user_id: string | null; created_at: string; payload: Record<string, unknown> };
    if (r.payload?.order_id !== orderId) continue;
    if (r.event_type === 'rakit_lock_requested') {
      events.push({ type: 'requested', created_at: r.created_at, actor_user_id: r.actor_user_id, admin_submitted: r.payload.admin_submitted });
    } else if (r.event_type === 'rakit_lock_approved') {
      events.push({ type: 'approved', created_at: r.created_at, actor_user_id: r.actor_user_id });
    } else if (r.event_type === 'rakit_lock_approved_with_edit') {
      events.push({
        type: 'approved_with_edit',
        created_at: r.created_at,
        actor_user_id: r.actor_user_id,
        admin_submitted: r.payload.admin_submitted,
        owner_amended: r.payload.owner_amended,
        diff_keys: (r.payload.diff_keys as string[]) ?? [],
      });
    } else if (r.event_type === 'rakit_lock_rejected') {
      events.push({ type: 'rejected', created_at: r.created_at, actor_user_id: r.actor_user_id, reason: (r.payload.reason as string) ?? '' });
    }
  }
  return events;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/sales/queries.test.ts`
Expected: PASS (existing tests + new fetchRakitLockHistory case).

- [ ] **Step 6: Commit**

```bash
git add src/lib/sales/queries.ts src/lib/sales/queries.test.ts
git commit -m "feat(sales/lib): fetchRakitLockHistory typed event reader from audit_log"
```

---

## Milestone C — Remove inline approve + wire 3f modal

### Task C1: Remove inline Setujui Biaya Final + add Withdraw at 3g

**Files:**
- Modify: `src/components/sales/ActionPanel.tsx`

- [ ] **Step 1: Remove the inline Setujui Biaya Final references**

Open `src/components/sales/ActionPanel.tsx`. Delete:

```typescript
  /** Owner-only — 3g → 3h after manual biaya-final review. */
  onApproveBiayaFinal?: () => void;
```

from the `Props` interface. Delete `onApproveBiayaFinal` from the function destructure. Delete:

```typescript
const showApproveBiayaFinal = order.funnel_sub_stage === '3g' && !!onApproveBiayaFinal;
```

and remove `|| showApproveBiayaFinal` from the `showExtraRow` boolean.

Delete the entire button block:

```typescript
{showApproveBiayaFinal && (
  <button type="button" onClick={onApproveBiayaFinal} style={pillStyle('#dcfce7', '#166534', '#bbf7d0')}>
    ✓ Setujui Biaya Final
  </button>
)}
```

- [ ] **Step 2: Add Withdraw button + prop**

In the same file, in the Props interface, add (after `onCancelOrder?`):

```typescript
  /** Admin withdraws own pending rakit_lock approval at 3g. CP/RP only. */
  onWithdrawRakitLock?: () => void;
```

In the destructure, add `onWithdrawRakitLock`. Before `showCancel`, add:

```typescript
const showWithdrawRakit =
  order.funnel_sub_stage === '3g' &&
  (order.order_type === 'CUSTOM_PANEL' || order.order_type === 'RAKIT_PANEL') &&
  !!onWithdrawRakitLock;
```

Update the `showExtraRow` boolean to include `|| showWithdrawRakit`.

Insert the button immediately before the `showCancel` block:

```typescript
{showWithdrawRakit && (
  <button type="button" onClick={onWithdrawRakitLock} style={pillStyle('#fef3c7', '#92400e', '#fde68a')}>
    ↩ Tarik Pengajuan
  </button>
)}
```

- [ ] **Step 3: Run TypeScript + tests**

Run: `npx tsc --noEmit && npx vitest run src/lib`
Expected: TS clean; lib suite still 165 tests passing (no behaviour test for ActionPanel — wired in C2 / smoke tested in G2).

- [ ] **Step 4: Commit**

```bash
git add src/components/sales/ActionPanel.tsx
git commit -m "refactor(sales): drop inline Setujui Biaya Final; add Withdraw Pengajuan at 3g"
```

### Task C2: Wire 3f Selesai to LockSubmissionModal in DaftarPesananScreen

**Files:**
- Modify: `src/components/sales/DaftarPesananScreen.tsx`
- Modify: `src/components/sales/SubStageSection.tsx`

This task threads a new state (`lockModalOrder`) through the screen and routes the 3f Selesai click to open the existing `LockSubmissionModal`. We also remove `handleApproveBiayaFinal` (orphaned after C1) and add `handleWithdrawRakitLock`.

- [ ] **Step 1: Open `DaftarPesananScreen.tsx`. Add imports**

Add to the imports block at the top:

```typescript
import LockSubmissionModal from '../penjualan/LockSubmissionModal';
import type { RakitJobLine } from '../../types';
import { withdrawRakitLock, supabaseService } from '../../lib/supabaseClient';
```

If `supabaseService` is already imported elsewhere in the file, skip that piece.

- [ ] **Step 2: Add state + helper**

Inside `DaftarPesananScreen`, near the other `useState` hooks (after `editingOrder`), add:

```typescript
const [lockModalOrder, setLockModalOrder] = useState<{ id: string; rakitLines: RakitJobLine[] } | null>(null);
```

- [ ] **Step 3: Replace the 3f Selesai path in `handleQuickAction`**

Find the `handleQuickAction` function. Right after the `if (action?.intent === 'wa-reminder') { ... }` block, INSERT this new branch:

```typescript
// Funnel 3f Selesai for CP/RP → open existing LockSubmissionModal so admin
// records material/labor costs. Submission goes through request_rakit_lock
// which sets funnel_sub_stage='3g' atomically.
if (
  order.funnel_sub_stage === '3f' &&
  action?.label === 'Selesai' &&
  (order.order_type === 'CUSTOM_PANEL' || order.order_type === 'RAKIT_PANEL')
) {
  const lines = await supabaseService.fetchRakitLinesForOrder?.(order.id) ?? [];
  if (lines.length === 0) {
    // eslint-disable-next-line no-alert
    alert('Belum ada line item rakit untuk pesanan ini. Hubungi tech support.');
    return;
  }
  setLockModalOrder({ id: order.id, rakitLines: lines });
  return;
}
```

Note: the existing supabase client may not have `fetchRakitLinesForOrder` — if a similar helper exists (e.g. `fetchRakitJobLines` or the existing fetcher used by WipListScreen), use that. Run `grep -n "rakit_job_lines\|fetchRakitLines\|fetchWipList" src/lib/supabaseClient.ts` to find the right helper. If none takes a single order_id, add a small helper at the same time:

```typescript
// Append to supabaseClient.ts (near the other rakit helpers):
export async function fetchRakitJobLinesForOrder(transactionId: string): Promise<RakitJobLine[]> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('rakit_job_lines')
    .select('*')
    .eq('transaction_id', transactionId)
    .order('line_number');
  if (error) throw error;
  return (data ?? []) as RakitJobLine[];
}
```

Adjust the import + call site to match the helper name you chose.

- [ ] **Step 4: Delete `handleApproveBiayaFinal`**

Find and delete:

```typescript
function handleApproveBiayaFinal(order: Order) { ... }
```

…and remove the `onApproveBiayaFinal={...}` prop from the SubStageSection render.

- [ ] **Step 5: Add `handleWithdrawRakitLock`**

Add near `handleCancelOrder`:

```typescript
async function handleWithdrawRakitLock(order: Order) {
  // Find pending rakit_lock approval for this order. We piggyback on the
  // backfilled approval_id we don't have here — fetch it.
  try {
    const approvalId = await supabaseService.findPendingRakitLockApprovalForOrder?.(order.id);
    if (!approvalId) {
      // eslint-disable-next-line no-alert
      alert('Tidak ada permintaan persetujuan yang pending untuk pesanan ini.');
      return;
    }
    await withdrawRakitLock(approvalId);
  } catch (err) {
    console.error('withdrawRakitLock failed', err);
    // eslint-disable-next-line no-alert
    alert('Gagal menarik pengajuan. Coba lagi.');
  } finally {
    const fresh = await fetchOrdersWithArchive().catch(() => null);
    if (fresh) setOrders(fresh);
  }
}
```

You'll need to add `findPendingRakitLockApprovalForOrder` to `supabaseClient.ts`:

```typescript
export async function findPendingRakitLockApprovalForOrder(orderId: string): Promise<number | null> {
  if (!supabase) return null;
  // rakit_lock_requests links approval_id to transaction_id.
  const { data, error } = await supabase
    .from('rakit_lock_requests')
    .select('approval_id, status')
    .eq('transaction_id', orderId)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data.approval_id as number;
}
```

- [ ] **Step 6: Pass `onWithdrawRakitLock` through SubStageSection**

In `DaftarPesananScreen`'s SubStageSection render, add the prop:

```typescript
onWithdrawRakitLock={handleWithdrawRakitLock}
```

Open `src/components/sales/SubStageSection.tsx`. Add to the `Props` interface (after the other callbacks):

```typescript
onWithdrawRakitLock: (order: Order) => void;
```

Add to the destructure, and in the OrderRow's ActionPanel render add:

```typescript
onWithdrawRakitLock={() => onWithdrawRakitLock(o)}
```

- [ ] **Step 7: Render the modal**

At the bottom of `DaftarPesananScreen`'s JSX (next to the existing `EditOrderModal` and `ReasonInputModal` renders), add:

```typescript
{lockModalOrder && currentUserRole && (
  <LockSubmissionModal
    transactionId={lockModalOrder.id}
    rakitLines={lockModalOrder.rakitLines}
    currentUser={{ id: currentUserId ?? '', name: currentUserName ?? '' }}
    onClose={() => setLockModalOrder(null)}
    onSubmitted={async () => {
      setLockModalOrder(null);
      const fresh = await fetchOrdersWithArchive().catch(() => null);
      if (fresh) setOrders(fresh);
    }}
    showToast={(msg) => { /* eslint-disable-next-line no-alert */ alert(msg); }}
  />
)}
```

For `currentUserId` + `currentUserName`: add props to `DaftarPesananScreen`. Update the existing `DaftarPesananScreenProps` interface:

```typescript
interface DaftarPesananScreenProps {
  currentUserRole?: string;
  currentUserId?: string;
  currentUserName?: string;
}
```

Update `App.tsx`'s render of DaftarPesananScreen to pass these:

```typescript
<DaftarPesananScreen
  currentUserRole={currentUser?.role}
  currentUserId={currentUser?.id}
  currentUserName={currentUser?.name}
/>
```

- [ ] **Step 8: TypeScript + build**

Run: `npx tsc --noEmit && npm run build`
Expected: TS clean, build clean.

- [ ] **Step 9: Commit**

```bash
git add src/components/sales/DaftarPesananScreen.tsx \
        src/components/sales/SubStageSection.tsx \
        src/lib/supabaseClient.ts \
        src/App.tsx
git commit -m "feat(sales): wire 3f Selesai to LockSubmissionModal + add Withdraw at 3g"
```

---

## Milestone D — Reject-reason chip

### Task D1: DaftarPesananScreen fetches recentRejects

**Files:**
- Modify: `src/components/sales/DaftarPesananScreen.tsx`
- Modify: `src/components/sales/SubStageSection.tsx`

- [ ] **Step 1: Add state + import**

In `DaftarPesananScreen.tsx`, add:

```typescript
import { fetchRecentRejectsByOrder, type RejectInfo } from '../../lib/sales/recentRejects';
```

```typescript
const [rejectInfoMap, setRejectInfoMap] = useState<Record<string, RejectInfo>>({});
```

- [ ] **Step 2: Fetch rejects when 3f orders change**

Add a `useEffect`:

```typescript
useEffect(() => {
  const threeFIds = orders
    .filter(o => o.funnel_sub_stage === '3f' && (o.order_type === 'CUSTOM_PANEL' || o.order_type === 'RAKIT_PANEL'))
    .map(o => o.id);
  if (threeFIds.length === 0) {
    setRejectInfoMap({});
    return;
  }
  fetchRecentRejectsByOrder(threeFIds).then(setRejectInfoMap);
}, [orders]);
```

- [ ] **Step 3: Pass map down**

In the SubStageSection render, add:

```typescript
rejectInfoMap={rejectInfoMap}
```

In `SubStageSection.tsx`, add to Props:

```typescript
rejectInfoMap: Record<string, { reason: string; rejected_at: string }>;
```

Destructure and pass through to OrderRow:

```typescript
<OrderRow ... rejectInfoMap={rejectInfoMap} />
```

- [ ] **Step 4: Verify TS + run tests**

Run: `npx tsc --noEmit && npx vitest run src/lib`
Expected: TS clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/sales/DaftarPesananScreen.tsx src/components/sales/SubStageSection.tsx
git commit -m "feat(sales): fetch recent rakit_lock rejects + thread map to OrderRow"
```

### Task D2: OrderRow renders the chip

**Files:**
- Modify: `src/components/sales/OrderRow.tsx`

- [ ] **Step 1: Add prop**

Open `src/components/sales/OrderRow.tsx`. Add to Props:

```typescript
rejectInfoMap?: Record<string, { reason: string; rejected_at: string }>;
```

Destructure `rejectInfoMap` from props.

- [ ] **Step 2: Compute the chip**

Inside the component, after the existing `const action = getQuickAction(order)` line, add:

```typescript
const rejectInfo = rejectInfoMap?.[order.id];
const showRejectChip = order.funnel_sub_stage === '3f' && !!rejectInfo;
const rejectSnippet = rejectInfo?.reason
  ? (rejectInfo.reason.length > 36 ? rejectInfo.reason.slice(0, 33) + '…' : rejectInfo.reason)
  : '';
```

- [ ] **Step 3: Render the chip next to customer name**

Find the line:

```jsx
<span style={{ fontWeight: 600, color: 'var(--color-primary)', fontSize: 14 }}>{order.customer}</span>
```

Add immediately after (before the `<span>#{...}</span>` short-id span):

```jsx
{showRejectChip && (
  <span
    title={`Direject ${new Date(rejectInfo!.rejected_at).toLocaleDateString('id-ID')}: ${rejectInfo!.reason}`}
    style={{
      fontSize: 10,
      padding: '2px 8px',
      borderRadius: 6,
      background: '#fef3c7',
      color: '#92400e',
      border: '1px solid #fde68a',
      fontWeight: 700,
      marginLeft: 8,
    }}
  >
    ⚠️ Owner: {rejectSnippet}
  </span>
)}
```

- [ ] **Step 4: TS + lib tests**

Run: `npx tsc --noEmit && npx vitest run src/lib`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/sales/OrderRow.tsx
git commit -m "feat(sales): reject-reason chip on 3f rows"
```

---

## Milestone E — Riwayat Persetujuan panel

### Task E1: New `RiwayatPersetujuanPanel` component

**Files:**
- Create: `src/components/sales/RiwayatPersetujuanPanel.tsx`

- [ ] **Step 1: Implement the panel**

Create `src/components/sales/RiwayatPersetujuanPanel.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { fetchRakitLockHistory, type RakitLockHistoryEvent } from '../../lib/sales/queries';

interface Props {
  orderId: string;
}

const TYPE_LABEL: Record<RakitLockHistoryEvent['type'], { emoji: string; label: string }> = {
  requested: { emoji: '📩', label: 'Admin submit' },
  approved: { emoji: '✓', label: 'Owner approve' },
  approved_with_edit: { emoji: '✏️', label: 'Owner approve dengan edit' },
  rejected: { emoji: '✗', label: 'Owner reject' },
};

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export function RiwayatPersetujuanPanel({ orderId }: Props) {
  const [events, setEvents] = useState<RakitLockHistoryEvent[] | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  useEffect(() => {
    fetchRakitLockHistory(orderId).then(setEvents);
  }, [orderId]);

  if (events === null) return <div style={{ fontSize: 12, color: '#6b7280' }}>Memuat riwayat…</div>;
  if (events.length === 0) return null;

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
        Riwayat Persetujuan
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {events.map((ev, i) => {
          const meta = TYPE_LABEL[ev.type];
          const isExpandable = ev.type === 'approved_with_edit' || ev.type === 'rejected';
          const isExpanded = expandedIdx === i;
          return (
            <div key={i} style={{ background: 'white', borderRadius: 8, border: '1px solid #e5eeff', padding: 8, fontSize: 12 }}>
              <div
                onClick={() => isExpandable && setExpandedIdx(isExpanded ? null : i)}
                style={{ display: 'flex', alignItems: 'center', cursor: isExpandable ? 'pointer' : 'default' }}
              >
                <span style={{ marginRight: 8 }}>{meta.emoji}</span>
                <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{meta.label}</span>
                <span style={{ color: '#6b7280', marginLeft: 'auto' }}>{fmt(ev.created_at)}</span>
                {isExpandable && <span style={{ marginLeft: 8, color: '#9ca3af' }}>{isExpanded ? '▾' : '▸'}</span>}
              </div>
              {isExpanded && ev.type === 'approved_with_edit' && (
                <div style={{ marginTop: 6, fontSize: 11, color: '#374151' }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>Field yang diedit:</div>
                  <div>{ev.diff_keys.length === 0 ? '(tidak ada perubahan tercatat)' : ev.diff_keys.join(', ')}</div>
                </div>
              )}
              {isExpanded && ev.type === 'rejected' && (
                <div style={{ marginTop: 6, fontSize: 11, color: '#b91c1c' }}>
                  Alasan: {ev.reason || '(tidak ada alasan)'}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TS check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/sales/RiwayatPersetujuanPanel.tsx
git commit -m "feat(sales): RiwayatPersetujuanPanel for 3g/3h rakit_lock history"
```

### Task E2: Wire panel into ActionPanel

**Files:**
- Modify: `src/components/sales/ActionPanel.tsx`

- [ ] **Step 1: Import + render**

Open `src/components/sales/ActionPanel.tsx`. Add to imports:

```typescript
import { RiwayatPersetujuanPanel } from './RiwayatPersetujuanPanel';
```

After the existing buttons row and before the closing `</div>` of the outer container, add:

```typescript
{(order.funnel_sub_stage === '3g' || order.funnel_sub_stage === '3h') &&
 (order.order_type === 'CUSTOM_PANEL' || order.order_type === 'RAKIT_PANEL') && (
  <RiwayatPersetujuanPanel orderId={order.id} />
)}
```

- [ ] **Step 2: TS + tests + commit**

```bash
npx tsc --noEmit && npx vitest run src/lib
git add src/components/sales/ActionPanel.tsx
git commit -m "feat(sales): mount RiwayatPersetujuanPanel in ActionPanel for 3g/3h CP-RP rows"
```

---

## Milestone F — Owner Edit & Approve in the inbox

### Task F1: `LockSubmissionModal` adds `mode` prop

**Files:**
- Modify: `src/components/penjualan/LockSubmissionModal.tsx`

- [ ] **Step 1: Add `mode` to Props + destructure with default**

Open `src/components/penjualan/LockSubmissionModal.tsx`. Update Props:

```typescript
interface LockSubmissionModalProps {
  transactionId: string;
  rakitLines: RakitJobLine[];
  currentUser: { id: string; name: string };
  onClose: () => void;
  onSubmitted: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  mode?: 'admin-submit' | 'owner-amend';
  approvalId?: number; // required when mode === 'owner-amend'
}
```

Destructure with `mode = 'admin-submit'` default and `approvalId`.

- [ ] **Step 2: Import the new wrapper**

```typescript
import { requestRakitLock, approveAndAmendRakitLock, supabaseService } from '../../lib/supabaseClient';
```

- [ ] **Step 3: Switch submit handler on mode**

Find the existing handler (~line 175) that calls `requestRakitLock({...})`. Wrap it:

```typescript
async function handleSubmit() {
  setSubmitting(true);
  try {
    const linesPayload = drafts.map(d => ({
      id: d.id,
      final_price: d.finalPrice,
      tracking_mode: d.trackingMode,
      labor_cost: d.laborCost,
      lump_sum_hpp: d.lumpSumHpp,
      components: d.components.map(c => ({
        sku: c.sku,
        name: c.name,
        qty: c.qty,
        warehouse: warehouseIdToCode(c.warehouse_id),
        fifo_cost: c.fifo_cost,
      })),
    }));

    if (mode === 'owner-amend') {
      if (!approvalId) throw new Error('approvalId required in owner-amend mode');
      await approveAndAmendRakitLock(approvalId, linesPayload);
      showToast('Biaya final di-approve dengan edit.', 'success');
    } else {
      await requestRakitLock({
        transaction_id: transactionId,
        lines: linesPayload,
        actor_user_id: currentUser.id,
      });
      showToast('Biaya final dikirim ke owner.', 'success');
    }
    onSubmitted();
  } catch (err) {
    console.error('LockSubmissionModal submit failed', err);
    showToast(err instanceof Error ? err.message : 'Submit gagal.', 'warning');
  } finally {
    setSubmitting(false);
  }
}
```

You may need to add a `warehouseIdToCode` helper if not already present — it maps a warehouse UUID to `'atas' | 'bawah'`. Reuse whatever the existing submit handler already does for this mapping.

- [ ] **Step 4: Header label adjusts on owner-amend**

In the modal's header JSX, change the title text:

```jsx
<h2>{mode === 'owner-amend' ? 'Edit Biaya Final (Owner)' : 'Submit Biaya Final'}</h2>
```

- [ ] **Step 5: TS + smoke**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/penjualan/LockSubmissionModal.tsx
git commit -m "feat(sales): LockSubmissionModal — owner-amend mode wired to approveAndAmendRakitLock"
```

### Task F2: Inbox row adds `Edit & Approve`

**Files:**
- Modify: `src/components/approval/RakitLockApprovalRequestRow.tsx`
- Modify: `src/components/approval/ApprovalInboxScreen.tsx`

- [ ] **Step 1: Add `onEditAndApprove` prop + button**

Open `src/components/approval/RakitLockApprovalRequestRow.tsx`. Add to props:

```typescript
onEditAndApprove?: (id: number, transactionId: string, lines: RakitJobLine[]) => void;
```

Destructure `onEditAndApprove`. Between the Reject and Approve buttons, add (only when `isOwner && onEditAndApprove`):

```typescript
{isOwner && onEditAndApprove && snapshot && (
  <button
    type="button"
    onClick={() => onEditAndApprove(request.id, snapshot.transaction_id, snapshot.lines)}
    disabled={disabled || busy !== null}
    style={{ /* match existing approve button style with amber tone */ }}
  >
    ✏️ Edit & Approve
  </button>
)}
```

Where the existing Approve button is styled green, style this one amber (`background: '#fef3c7'`, `color: '#92400e'`).

`snapshot.lines` and `snapshot.transaction_id` come from `RakitLockRequest` type — confirm the field names by reading the existing component's `useEffect` that loads the snapshot. Adjust the field names if different.

- [ ] **Step 2: Wire `onEditAndApprove` in ApprovalInboxScreen**

Open `src/components/approval/ApprovalInboxScreen.tsx`. Add state for the lock-edit modal:

```typescript
const [ownerAmendTarget, setOwnerAmendTarget] = useState<{
  approvalId: number;
  transactionId: string;
  rakitLines: RakitJobLine[];
} | null>(null);
```

Import LockSubmissionModal at top:

```typescript
import LockSubmissionModal from '../penjualan/LockSubmissionModal';
import type { RakitJobLine } from '../../types';
```

Pass to RakitLockApprovalRequestRow:

```typescript
onEditAndApprove={(id, txId, lines) => setOwnerAmendTarget({ approvalId: id, transactionId: txId, rakitLines: lines })}
```

At the bottom of the inbox JSX, render the modal:

```typescript
{ownerAmendTarget && (
  <LockSubmissionModal
    mode="owner-amend"
    approvalId={ownerAmendTarget.approvalId}
    transactionId={ownerAmendTarget.transactionId}
    rakitLines={ownerAmendTarget.rakitLines}
    currentUser={{ id: currentUser?.id ?? '', name: currentUser?.name ?? '' }}
    onClose={() => setOwnerAmendTarget(null)}
    onSubmitted={() => {
      setOwnerAmendTarget(null);
      // The realtime subscription will refresh the inbox list.
    }}
    showToast={showToast}
  />
)}
```

- [ ] **Step 3: TS check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/approval/RakitLockApprovalRequestRow.tsx \
        src/components/approval/ApprovalInboxScreen.tsx
git commit -m "feat(approval): Edit & Approve button on Rakit Lock rows"
```

---

## Milestone G — Self-review, smoke, PR

### Task G1: Final test + build + lint

- [ ] **Step 1: Full suite**

Run:
```bash
npx tsc --noEmit
npx vitest run src/lib
npm run build
```

Expected: TS clean; lib suite ≥ 175 tests (163 baseline + 12 new); build clean.

- [ ] **Step 2: Update progress.md**

Append to `progress.md` (at top, above the prior section):

```markdown
## 2026-06-19 — Sales Phase 1B follow-up — Owner biaya final inbox integration (PR #XX)

- 4 migrations extend `request_rakit_lock` / `commit_approved_rakit_lock` / `reject_rakit_lock` / `withdraw_rakit_lock` to keep `kasir_transactions.funnel_sub_stage` in sync (3g / 3h / 3f).
- New RPC `approve_and_amend_rakit_lock` for Owner edit-then-approve in one transaction; server-side Owner role gate via `admin_users.role='Owner' AND status='active'`.
- lib: new `approveAndAmendRakitLock` wrapper; new `fetchRecentRejectsByOrder` + tests; new `fetchRakitLockHistory` + tests.
- UI: removed inline `✓ Setujui Biaya Final` button from ActionPanel (was a PR #25 stopgap); added `↩ Tarik Pengajuan` at 3g; wired 3f Selesai to existing `LockSubmissionModal`; reject-reason chip on 3f rows; new `RiwayatPersetujuanPanel`; `LockSubmissionModal` adds `owner-amend` mode; `RakitLockApprovalRequestRow` adds `✏️ Edit & Approve` button.
- Lib tests <N> passing.
```

- [ ] **Step 3: Commit progress.md + push**

```bash
git add progress.md
git commit -m "docs(progress): Owner biaya final inbox integration"
git push -u origin feat/owner-biaya-final-inbox-spec
```

### Task G2: Production smoke (chrome MCP or local)

- [ ] **Step 1: Apply migrations to live Supabase**

Use `mcp__plugin_supabase_supabase__apply_migration` for each of the 4 new files, in order (001 → 002 → 003 → 004). Each must return success.

- [ ] **Step 2: Smoke against a CP/RP test order**

In the prod app or up-to-date localhost:

1. Find or seed a CP/RP order at `funnel_sub_stage='3f'`.
2. As admin: open Daftar Pesanan → Workshop → Stage 3 → expand 3f → click Selesai → `LockSubmissionModal` opens → fill min fields → Submit → toast → row moves to 3g.
3. As Owner: open Persetujuan → Rakit Lock filter → see the row → click Approve (no edit) → row in Daftar Pesanan moves to 3h. Open the row → RiwayatPersetujuanPanel shows the "Admin submit" + "Owner approve" events.
4. Repeat with Edit & Approve on a fresh seed → confirm Invoice Pelunasan PDF uses the edited value (e.g. lower final_price).
5. Repeat with Reject on a fresh seed → confirm row returns to 3f with ⚠️ Owner chip + auto-urgent expansion. Click Selesai again — modal prefills.
6. As non-Owner: log out and back in as a Kasir → open Persetujuan → Rakit Lock rows visible but Approve/Edit&Approve/Reject buttons hidden.

Any failure → fix on the same branch.

### Task G3: Open the PR

- [ ] **Step 1: Open PR via gh**

```bash
gh pr create --base main --title "feat(sales): Owner biaya final inbox integration (replaces PR #25 stopgap)" --body "$(cat <<'EOF'
## Summary

Replaces the inline 3g \"Setujui Biaya Final\" button shipped in PR #25 with proper integration to the existing approval inbox. Funnel 3f Selesai opens the existing LockSubmissionModal (cost entry); submission appears in Persetujuan inbox; Owner approves, edits-then-approves, or rejects; funnel position stays in sync atomically.

See full design at \`docs/superpowers/specs/2026-06-19-owner-biaya-final-inbox-integration-design.md\`.

## Backend

- 4 migrations under \`supabase/migrations/202606260000xx_*.sql\` — extend 4 existing RPCs to set \`funnel_sub_stage\` atomically; add \`approve_and_amend_rakit_lock\`.
- All CREATE OR REPLACE (idempotent).
- Owner role check via \`auth.uid() ∈ admin_users WHERE role='Owner' AND status='active'\`.

## Frontend

- New \`RiwayatPersetujuanPanel\` (~120 lines)
- New \`fetchRecentRejectsByOrder\` helper + 3 tests
- New \`fetchRakitLockHistory\` helper + 1 test
- New \`approveAndAmendRakitLock\` wrapper + 2 tests
- \`LockSubmissionModal\` gains \`mode: 'admin-submit' | 'owner-amend'\` prop
- \`RakitLockApprovalRequestRow\` adds Edit & Approve button (Owner-only)
- \`DaftarPesananScreen\` wires 3f Selesai to the modal; tracks reject map; passes withdraw handler
- \`ActionPanel\` drops inline approval button; adds Tarik Pengajuan at 3g
- \`OrderRow\` renders ⚠️ Owner reject chip at 3f

## Quality gates

- TypeScript clean
- Lib tests <N>/<N> passing
- \`npm run build\` clean
- 4 migrations applied to live Supabase
- Production smoke walked through happy path / edit / reject / withdraw / non-Owner gate

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Report PR URL to user**

---

## Self-Review

### Spec coverage

| Spec section | Tasks |
|---|---|
| Goal + non-goals | Header |
| What already exists | Pre-flight verification (Task 0 Step 3-4) |
| The gap (6 items) | Tasks A1, A2, A3, A4, C1, F1 |
| Workflow — Admin side | Tasks A1, B1, C2 |
| Workflow — Owner side: Approve | Task A2 |
| Workflow — Owner side: Edit & Approve | Tasks A4, F1, F2 |
| Workflow — Owner side: Reject | Tasks A3, D1, D2 |
| Admin sees Owner verdict (Riwayat) | Tasks B3, E1, E2 |
| Withdraw at 3g | Tasks A3, C1, C2 |
| Reject chip at 3f | Tasks B2, D1, D2 |
| Data flow contract | Implicit via all backend tasks (no direct frontend transition for 3f/3g/3h CP/RP) |
| Error handling — Owner role gate | Task A4 Step 1 |
| Error handling — Audit log first | Tasks A3 Step 2, A4 Step 1 |
| Error handling — Order cancelled while pending | Acknowledged out-of-scope-for-this-PR (deferred); cancel still works for terminal-stage move, withdraw is on admin |
| Testing approach | Tasks B1-B3 (Vitest), A1-A4 (SQL smoke), G2 (manual) |
| Persetujuan menu stays visible | Untouched — verified via Pre-flight + Task 0 |
| No new enum / table / sub-stage / screen | Confirmed by file list |

**Coverage gaps:** The spec mentions auto-withdraw of pending approval when admin cancels at 3g. The current Batalkan path (from PR #25) just transitions to 6a without auto-withdrawing. I'm leaving this gap — small, low-frequency, and a follow-up rather than a blocker. Adding here would inflate scope.

### Placeholder scan

- No "TBD", "TODO", "implement later".
- One steered approximation: Task A1/A2/A3 say "paste the existing body verbatim." This is intentional — the existing bodies are 80-150 lines each and inlining them would bloat the plan to 4000 lines. The implementer reads the existing file (paths + line ranges given) and copies the body.
- One spec deviation: spec said "new RPC `reject_rakit_lock_to_funnel`"; plan extends existing `reject_rakit_lock` instead. Cleaner — no parallel function, no client-side switching. Captured in the migration file name.

### Type consistency check

- `RejectInfo` typed in `recentRejects.ts`; consumed by OrderRow with structural match.
- `RakitLockHistoryEvent` discriminated union; consumed by `RiwayatPersetujuanPanel` via type-narrowing on `.type`.
- `LockSubmissionModalProps.mode` literal union matches dispatch in `handleSubmit`.
- `approveAndAmendRakitLock(approvalId: number, amendedLines: ...)` matches the RPC params `p_approval_id BIGINT`, `p_amended_lines JSONB`.
- `findPendingRakitLockApprovalForOrder` returns `Promise<number | null>`; consumed by `handleWithdrawRakitLock` with null check.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-19-owner-biaya-final-inbox-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Fresh subagent per task, two-stage review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
