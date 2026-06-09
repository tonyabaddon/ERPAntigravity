# Rakit Workflow Session 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the end-to-end happy path for the rakit (jasa rakit + jasa custom panel) workflow: admin adds rakit lines to cart → saves as WIP → submits lock for approval → owner approves via existing Persetujuan inbox → stock decrements + transaction transitions to AWAITING_LUNAS/PAID.

**Architecture:** Migration 0010 morphs the DB state from the old pre-Phase-2 design to the Phase 2 integration design (drops `rakit_audit_log` + 5 old RPCs + obsolete columns; adds `rakit_lock_requests` satellite table + `request_rakit_lock` / `commit_approved_rakit_lock` RPCs + `'rakit_lock'` to the `approval_request_type` enum). Frontend layers: cart UI extension on `PenjualanBaruScreen`, new `WipListScreen` for AWAITING_LUNAS staging, `LockSubmissionModal` for owner-approval-bound submit, and a filter pill + renderer extension on the existing `ApprovalInboxScreen`. Cancel/Withdraw/Material-edit RPCs ship in the migration but the UI for them is deferred to session 2 (out of scope).

**Tech Stack:** PostgreSQL (Supabase), supabase-js v2.106.2, React 19 + Vite + TypeScript, Tailwind v4, lucide-react icons.

**Reference docs (read these before starting):**
- Original full plan (all 6 phases + Phase 0 revision SQL): `docs/superpowers/plans/2026-06-08-rakit-workflow.md`
- Design spec: `docs/superpowers/specs/2026-06-08-rakit-workflow-design.md`
- Interactive mockup: `docs/superpowers/specs/2026-06-08-rakit-workflow-mockups/index.html`

**Scope of THIS session (4 phases of original plan):**
- Phase 0 — DB migration 0010 (revision: morph current prod state to Phase 2 integration design)
- Phase 1 — Cart UI extension on `PenjualanBaruScreen` (Tasks 1.1–1.6 in original plan)
- Phase 2 — `WipListScreen` (Tasks 2.1–2.3)
- Phase 3 — `LockSubmissionModal` (Tasks 3.1–3.2)
- Phase 4 — Approval Inbox extension (Tasks 4.1–4.3, but reusing existing `ApprovalInboxScreen` — just adds filter pill + row renderer)

**Out of scope (session 2):** Phase 5 (Cancel + Withdraw UI), Phase 6 (Edit AWAITING_LUNAS UI), Phase 7 (Invoice/PDF + forfeit view).

---

## Current prod DB state (verified 2026-06-09)

```
Tables present:  rakit_job_lines, rakit_components, rakit_audit_log
Columns present on kasir_transactions: lock_submitted_at/by, lock_approved_at/by, lock_rejected_at/reason
RPCs present:    _rakit_audit, submit_rakit_lock, approve_rakit_lock, reject_rakit_lock,
                 cancel_rakit, withdraw_rakit_lock, material_edit_rakit
Enum approval_request_type: adjustment, opname, price_change, kasir_price_override,
                            kasir_void, kasir_refund  (no rakit_lock)
```

Migration 0010 must reverse the dropped artifacts and create the new ones idempotently.

---

## File map

**New files:**
- `supabase/migrations/20260609000010_rakit_workflow_revision.sql` (Phase 0)
- `src/components/penjualan/RakitButtonsRow.tsx` (Task 1.1)
- `src/components/penjualan/RakitInlineForm.tsx` (Task 1.2)
- `src/components/WipListScreen.tsx` (Task 2.1)
- `src/lib/rakitService.ts` (Task 2.2)
- `src/components/penjualan/LockSubmissionModal.tsx` (Task 3.1+3.2)
- `src/components/approval/RakitLockApprovalRequestRow.tsx` (Task 4.2)

**Modified files:**
- `src/types.ts` — add `RakitJobLine`, `RakitComponent`, `RakitLockRequest`, extend `ApprovalRequestType` (Task 0.4)
- `src/lib/supabaseClient.ts` — add wrappers `requestRakitLock`, `commitApprovedRakitLock`, `fetchWipList`, `fetchRakitLockRequest` (Task 0.5 + 2.2)
- `src/components/PenjualanBaruScreen.tsx` — render `RakitButtonsRow`, `RakitInlineForm`, rakit cart lines, WIP warning, modified save flow (Tasks 1.3, 1.4, 1.5, 1.6)
- `src/components/penjualan/CartRows.tsx` — render rakit lines section (Task 1.4)
- `src/components/Sidebar.tsx` — add Stock-WIP nav item (Task 2.3)
- `src/App.tsx` — add `'wip-list'` route (Task 2.3)
- `src/types.ts` — add `'wip-list'` to `ActivePage` union (Task 2.3)
- `src/components/approval/ApprovalInboxScreen.tsx` — add `'rakit_lock'` filter pill, hook `RakitLockApprovalRequestRow` into render switch, wire `commitApprovedRakitLock` into approve handler (Task 4.1, 4.3)

---

## Task 0.1: Write migration 0010 — schema + RPC revision

**Files:**
- Create: `supabase/migrations/20260609000010_rakit_workflow_revision.sql`

This is the largest single task — full SQL inline below. The SQL is **forward-only** from current prod state (no rollback in this migration; rollback would be a follow-up migration if needed).

- [ ] **Step 1: Create the migration file with the full SQL**

```sql
-- 20260609000010_rakit_workflow_revision.sql
-- Morph DB from pre-Phase-2 rakit design (applied via 0008/0009) to Phase 2
-- approval-gate integration. Forward-only.
--
-- Effects:
--   - Drops legacy artifacts:    rakit_audit_log table, _rakit_audit/submit/approve/reject_rakit_lock funcs,
--                                kasir_transactions.lock_* columns
--   - Adds Phase 2 enum value:   approval_request_type += 'rakit_lock'
--   - Adds satellite table:      rakit_lock_requests (FK -> approval_requests)
--   - Adds gate RPCs:            request_rakit_lock(), commit_approved_rakit_lock()
--   - Replaces RPCs to fit gate: withdraw_rakit_lock(), cancel_rakit(), material_edit_rakit(),
--                                cosmetic_edit_rakit()
--   - Adds stock_movement_source values: 'rakit_usage', 'rakit_reversal'
--   - Adds kasir_transactions.service_summary column (used by WIP list display)

BEGIN;

-- =====================================================================
-- 1. Drop legacy RPCs (CASCADE so any GRANTs/RLS deps clean up too)
-- =====================================================================
DROP FUNCTION IF EXISTS public.submit_rakit_lock(UUID, JSONB, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.approve_rakit_lock(UUID, JSONB, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.reject_rakit_lock(UUID, TEXT, UUID) CASCADE;
DROP FUNCTION IF EXISTS public._rakit_audit(UUID, TEXT, JSONB, UUID) CASCADE;
-- Drop withdraw/cancel/material_edit so we can recreate with new signatures
DROP FUNCTION IF EXISTS public.withdraw_rakit_lock(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.cancel_rakit(UUID, NUMERIC, TEXT, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.material_edit_rakit(UUID, JSONB, UUID) CASCADE;

-- =====================================================================
-- 2. Drop rakit_audit_log table (Phase 2 approval_requests + stock_movements log
--    all transitions; audit_log was duplicative)
-- =====================================================================
DROP TABLE IF EXISTS public.rakit_audit_log CASCADE;

-- =====================================================================
-- 3. Drop kasir_transactions.lock_* columns (lock state now lives in
--    approval_requests + rakit_lock_requests)
-- =====================================================================
ALTER TABLE public.kasir_transactions
  DROP COLUMN IF EXISTS lock_submitted_by,
  DROP COLUMN IF EXISTS lock_submitted_at,
  DROP COLUMN IF EXISTS lock_approved_by,
  DROP COLUMN IF EXISTS lock_approved_at,
  DROP COLUMN IF EXISTS lock_rejected_reason,
  DROP COLUMN IF EXISTS lock_rejected_at;

-- =====================================================================
-- 4. Add service_summary column (cached display string for WIP list)
-- =====================================================================
ALTER TABLE public.kasir_transactions
  ADD COLUMN IF NOT EXISTS service_summary TEXT;

-- =====================================================================
-- 5. Extend approval_request_type enum
-- =====================================================================
ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'rakit_lock';

-- =====================================================================
-- 6. Extend stock_movement_source enum (rakit usage + reversal)
-- =====================================================================
ALTER TYPE public.stock_movement_source ADD VALUE IF NOT EXISTS 'rakit_usage';
ALTER TYPE public.stock_movement_source ADD VALUE IF NOT EXISTS 'rakit_reversal';

COMMIT;

-- ENUM ADD VALUE is not visible inside the same transaction in older PG.
-- Split: continue in a new transaction so the new enum values become visible.
BEGIN;

-- =====================================================================
-- 7. rakit_lock_requests satellite table
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.rakit_lock_requests (
  id                      BIGSERIAL PRIMARY KEY,
  transaction_id          UUID NOT NULL REFERENCES public.kasir_transactions(id) ON DELETE CASCADE,
  approval_request_id     BIGINT NOT NULL REFERENCES public.approval_requests(id),
  lines_snapshot          JSONB NOT NULL,
  requested_by            UUID NOT NULL REFERENCES auth.users(id),
  requested_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  status                  TEXT NOT NULL DEFAULT 'pending_approval'
                          CHECK (status IN ('pending_approval','approved','rejected','expired','withdrawn')),
  committed_at            TIMESTAMPTZ,
  is_material_edit        BOOLEAN NOT NULL DEFAULT FALSE,
  prior_lock_request_id   BIGINT REFERENCES public.rakit_lock_requests(id)
);

CREATE INDEX IF NOT EXISTS idx_rakit_lock_approval     ON public.rakit_lock_requests(approval_request_id);
CREATE INDEX IF NOT EXISTS idx_rakit_lock_transaction  ON public.rakit_lock_requests(transaction_id);
CREATE INDEX IF NOT EXISTS idx_rakit_lock_pending      ON public.rakit_lock_requests(requested_at)
  WHERE status = 'pending_approval';

ALTER TABLE public.rakit_lock_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='rakit_lock_requests' AND policyname='rakit_lock_requests_all') THEN
    CREATE POLICY rakit_lock_requests_all ON public.rakit_lock_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- =====================================================================
-- 8. request_rakit_lock — admin submits lock → creates approval row
--    Transitions kasir_transactions.status: WIP → PENDING_LOCK_APPROVAL
-- =====================================================================
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
  v_actor := COALESCE(p_actor_user_id, auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);

  SELECT status INTO v_status FROM kasir_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF v_status != 'WIP' THEN
    RAISE EXCEPTION 'request_rakit_lock: transaction % is in status %, expected WIP', p_transaction_id, v_status;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_id := (v_line->>'id')::UUID;
    UPDATE rakit_job_lines
    SET final_price   = (v_line->>'final_price')::NUMERIC,
        tracking_mode = v_line->>'tracking_mode',
        labor_cost    = COALESCE((v_line->>'labor_cost')::NUMERIC, 0),
        lump_sum_hpp  = COALESCE((v_line->>'lump_sum_hpp')::NUMERIC, 0),
        updated_at    = now()
    WHERE id = v_line_id AND transaction_id = p_transaction_id;

    DELETE FROM rakit_components WHERE rakit_line_id = v_line_id;
    IF v_line ? 'components' THEN
      FOR v_comp IN SELECT * FROM jsonb_array_elements(v_line->'components') LOOP
        INSERT INTO rakit_components (rakit_line_id, sku, name, qty, warehouse, fifo_cost_snapshot)
        VALUES (v_line_id, v_comp->>'sku', v_comp->>'name',
                (v_comp->>'qty')::NUMERIC,
                COALESCE(v_comp->>'warehouse', 'atas'),
                COALESCE((v_comp->>'fifo_cost')::NUMERIC, 0));
      END LOOP;
    END IF;
  END LOOP;

  v_payload := jsonb_build_object(
    'transaction_id', p_transaction_id::text,
    'lines_count',    jsonb_array_length(p_lines)
  );

  INSERT INTO approval_requests (request_type, payload, requested_by)
  VALUES ('rakit_lock'::approval_request_type, v_payload, v_actor)
  RETURNING id INTO v_approval;

  INSERT INTO rakit_lock_requests
    (transaction_id, approval_request_id, lines_snapshot, requested_by)
  VALUES (p_transaction_id, v_approval, p_lines, v_actor)
  RETURNING id INTO v_lock_req;

  UPDATE kasir_transactions SET status = 'PENDING_LOCK_APPROVAL' WHERE id = p_transaction_id;

  RETURN v_approval;
END $$;
GRANT EXECUTE ON FUNCTION public.request_rakit_lock(UUID, JSONB, UUID) TO authenticated;

-- =====================================================================
-- 9. commit_approved_rakit_lock — fires after owner approves
--    Writes stock_movements per komponen, locks HPP, transitions tx status
-- =====================================================================
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
  SELECT * INTO v_ar FROM approval_requests WHERE id = p_approval_id FOR UPDATE;
  IF v_ar.status != 'approved' THEN
    RAISE EXCEPTION 'commit_approved_rakit_lock: approval % is in status %, expected approved', p_approval_id, v_ar.status;
  END IF;

  SELECT * INTO v_rr FROM rakit_lock_requests WHERE approval_request_id = p_approval_id FOR UPDATE;
  IF v_rr.committed_at IS NOT NULL THEN
    RAISE EXCEPTION 'commit_approved_rakit_lock: rakit_lock_request % already committed', v_rr.id;
  END IF;

  v_tx_id := v_rr.transaction_id;

  SELECT COALESCE(dp_amount, 0), total_amount INTO v_dp, v_total
  FROM kasir_transactions WHERE id = v_tx_id FOR UPDATE;

  v_new_status := CASE WHEN v_total - v_dp > 0 THEN 'AWAITING_LUNAS' ELSE 'PAID' END;

  FOR v_line IN SELECT * FROM rakit_job_lines WHERE transaction_id = v_tx_id LOOP
    IF v_line.tracking_mode = 'detail' THEN
      v_hpp_final := COALESCE(
        (p_hpp_overrides->>v_line.id::TEXT)::NUMERIC,
        (SELECT COALESCE(SUM(fifo_cost_snapshot), 0) FROM rakit_components WHERE rakit_line_id = v_line.id)
          + COALESCE(v_line.labor_cost, 0)
      );

      FOR v_comp IN SELECT * FROM rakit_components WHERE rakit_line_id = v_line.id LOOP
        SELECT CASE WHEN v_comp.warehouse = 'atas' THEN stock_atas ELSE stock_bawah END
          INTO v_qty_before
        FROM stocks WHERE sku = v_comp.sku FOR UPDATE;

        IF v_qty_before IS NULL OR v_qty_before < v_comp.qty THEN
          RAISE EXCEPTION 'commit_approved_rakit_lock: insufficient stock for SKU % in % (have %, need %)',
                          v_comp.sku, v_comp.warehouse, COALESCE(v_qty_before, 0), v_comp.qty;
        END IF;

        PERFORM public._log_stock_movement(
          p_sku              => v_comp.sku,
          p_warehouse        => v_comp.warehouse,
          p_qty_delta        => -v_comp.qty::INT,
          p_qty_before       => v_qty_before,
          p_source           => 'rakit_usage'::stock_movement_source,
          p_related_doc_type => 'rakit_lock_request',
          p_related_doc_id   => v_rr.id::TEXT,
          p_reason_code      => NULL,
          p_reason_note      => 'Pemakaian rakit ' || v_line.description,
          p_actor_user_id    => v_ar.decided_by,
          p_actor_role       => 'owner',
          p_evidence_urls    => NULL
        );

        UPDATE stocks
        SET stock_atas  = CASE WHEN v_comp.warehouse = 'atas'  THEN stock_atas  - v_comp.qty ELSE stock_atas  END,
            stock_bawah = CASE WHEN v_comp.warehouse = 'bawah' THEN stock_bawah - v_comp.qty ELSE stock_bawah END
        WHERE sku = v_comp.sku;
      END LOOP;

      UPDATE rakit_job_lines
      SET hpp_final          = v_hpp_final,
          hpp_owner_override = (p_hpp_overrides->>v_line.id::TEXT)::NUMERIC
      WHERE id = v_line.id;

    ELSE  -- lumpsum
      v_hpp_final := COALESCE(
        (p_hpp_overrides->>v_line.id::TEXT)::NUMERIC,
        v_line.lump_sum_hpp
      );
      UPDATE rakit_job_lines
      SET hpp_final          = v_hpp_final,
          hpp_owner_override = (p_hpp_overrides->>v_line.id::TEXT)::NUMERIC
      WHERE id = v_line.id;
    END IF;
  END LOOP;

  UPDATE rakit_lock_requests SET status = 'approved', committed_at = now() WHERE id = v_rr.id;
  UPDATE kasir_transactions  SET status = v_new_status WHERE id = v_tx_id;
END $$;
GRANT EXECUTE ON FUNCTION public.commit_approved_rakit_lock(BIGINT, JSONB) TO authenticated;

-- =====================================================================
-- 10. withdraw_rakit_lock — submitter cancels own pending approval
--     Transitions: PENDING_LOCK_APPROVAL → WIP, marks approval rejected
-- =====================================================================
CREATE OR REPLACE FUNCTION public.withdraw_rakit_lock(
  p_approval_id BIGINT,
  p_actor_user_id UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_actor UUID;
  v_ar    RECORD;
  v_rr    RECORD;
BEGIN
  v_actor := COALESCE(p_actor_user_id, auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);

  SELECT * INTO v_ar FROM approval_requests WHERE id = p_approval_id FOR UPDATE;
  IF v_ar.status != 'pending' THEN
    RAISE EXCEPTION 'withdraw_rakit_lock: approval % is %, expected pending', p_approval_id, v_ar.status;
  END IF;
  IF v_ar.requested_by != v_actor THEN
    RAISE EXCEPTION 'withdraw_rakit_lock: only submitter can withdraw their own request';
  END IF;

  SELECT * INTO v_rr FROM rakit_lock_requests WHERE approval_request_id = p_approval_id FOR UPDATE;

  PERFORM public._transition_approval(p_approval_id, 'rejected', v_actor, 'self_withdraw');

  UPDATE rakit_lock_requests SET status = 'withdrawn' WHERE id = v_rr.id;
  UPDATE kasir_transactions  SET status = 'WIP'        WHERE id = v_rr.transaction_id;
END $$;
GRANT EXECUTE ON FUNCTION public.withdraw_rakit_lock(BIGINT, UUID) TO authenticated;

-- =====================================================================
-- 11. cancel_rakit — WIP-only, owner-decided refund + forfeit (no approval)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.cancel_rakit(
  p_transaction_id UUID,
  p_refund_amount  NUMERIC,
  p_reason         TEXT,
  p_actor_user_id  UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_actor UUID; v_status TEXT; v_dp NUMERIC; v_forfeit NUMERIC;
BEGIN
  v_actor := COALESCE(p_actor_user_id, auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);

  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'cancel_rakit: reason required';
  END IF;

  SELECT status, COALESCE(dp_amount, 0) INTO v_status, v_dp
  FROM kasir_transactions WHERE id = p_transaction_id FOR UPDATE;

  IF v_status != 'WIP' THEN
    RAISE EXCEPTION 'cancel_rakit: status %, expected WIP', v_status;
  END IF;
  IF p_refund_amount < 0 OR p_refund_amount > v_dp THEN
    RAISE EXCEPTION 'cancel_rakit: refund % must be 0..%', p_refund_amount, v_dp;
  END IF;

  v_forfeit := v_dp - p_refund_amount;

  UPDATE kasir_transactions
  SET status                = 'CANCELLED',
      cancel_refund_amount  = p_refund_amount,
      cancel_forfeit_amount = v_forfeit,
      cancel_reason         = p_reason,
      cancelled_by          = v_actor,
      cancelled_at          = now()
  WHERE id = p_transaction_id;
END $$;
GRANT EXECUTE ON FUNCTION public.cancel_rakit(UUID, NUMERIC, TEXT, UUID) TO authenticated;

-- =====================================================================
-- 12. material_edit_rakit — AWAITING_LUNAS re-submit (reverses prior stock, re-locks)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.material_edit_rakit(
  p_transaction_id UUID,
  p_lines          JSONB,
  p_actor_user_id  UUID DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_actor        UUID;
  v_status       TEXT;
  v_prior_rr     RECORD;
  v_movement     RECORD;
  v_new_approval BIGINT;
  v_new_rr       BIGINT;
  v_qty_before   INT;
BEGIN
  v_actor := COALESCE(p_actor_user_id, auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);

  SELECT status INTO v_status FROM kasir_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF v_status != 'AWAITING_LUNAS' THEN
    RAISE EXCEPTION 'material_edit_rakit: status %, expected AWAITING_LUNAS', v_status;
  END IF;

  SELECT * INTO v_prior_rr
  FROM rakit_lock_requests
  WHERE transaction_id = p_transaction_id AND status = 'approved' AND committed_at IS NOT NULL
  ORDER BY committed_at DESC
  LIMIT 1;

  IF v_prior_rr.id IS NULL THEN
    RAISE EXCEPTION 'material_edit_rakit: no prior approved rakit_lock_request found';
  END IF;

  FOR v_movement IN
    SELECT * FROM stock_movements
    WHERE related_doc_type = 'rakit_lock_request' AND related_doc_id = v_prior_rr.id::TEXT
    FOR UPDATE
  LOOP
    SELECT CASE WHEN v_movement.warehouse = 'atas' THEN stock_atas ELSE stock_bawah END
      INTO v_qty_before
    FROM stocks WHERE sku = v_movement.sku FOR UPDATE;

    PERFORM public._log_stock_movement(
      p_sku              => v_movement.sku,
      p_warehouse        => v_movement.warehouse,
      p_qty_delta        => -v_movement.qty_delta,
      p_qty_before       => v_qty_before,
      p_source           => 'rakit_reversal'::stock_movement_source,
      p_related_doc_type => 'rakit_lock_request',
      p_related_doc_id   => v_prior_rr.id::TEXT,
      p_reason_code      => NULL,
      p_reason_note      => 'Reversal: material edit re-submission',
      p_actor_user_id    => v_actor,
      p_actor_role       => 'admin',
      p_evidence_urls    => NULL
    );

    UPDATE stocks
    SET stock_atas  = CASE WHEN v_movement.warehouse = 'atas'  THEN stock_atas  - v_movement.qty_delta ELSE stock_atas  END,
        stock_bawah = CASE WHEN v_movement.warehouse = 'bawah' THEN stock_bawah - v_movement.qty_delta ELSE stock_bawah END
    WHERE sku = v_movement.sku;
  END LOOP;

  INSERT INTO approval_requests (request_type, payload, requested_by)
  VALUES ('rakit_lock'::approval_request_type,
          jsonb_build_object('transaction_id', p_transaction_id::text, 'lines_count', jsonb_array_length(p_lines), 'material_edit', true),
          v_actor)
  RETURNING id INTO v_new_approval;

  INSERT INTO rakit_lock_requests
    (transaction_id, approval_request_id, lines_snapshot, requested_by, is_material_edit, prior_lock_request_id)
  VALUES (p_transaction_id, v_new_approval, p_lines, v_actor, TRUE, v_prior_rr.id)
  RETURNING id INTO v_new_rr;

  UPDATE kasir_transactions SET status = 'PENDING_LOCK_APPROVAL' WHERE id = p_transaction_id;

  RETURN v_new_approval;
END $$;
GRANT EXECUTE ON FUNCTION public.material_edit_rakit(UUID, JSONB, UUID) TO authenticated;

-- =====================================================================
-- 12b. approve_rakit_lock — owner clicks Setujui in Persetujuan inbox
--      Wraps _transition_approval('approved') + commit_approved_rakit_lock
--      in a single transaction (since approval_requests UPDATE is REVOKEd
--      from authenticated — admins cannot transition the approval directly)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.approve_rakit_lock(
  p_approval_id BIGINT,
  p_hpp_overrides JSONB DEFAULT '{}'::jsonb
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  PERFORM public._transition_approval(p_approval_id, 'approved', auth.uid(), 'inbox');
  PERFORM public.commit_approved_rakit_lock(p_approval_id, p_hpp_overrides);
END $$;
GRANT EXECUTE ON FUNCTION public.approve_rakit_lock(BIGINT, JSONB) TO authenticated;

-- =====================================================================
-- 13. cosmetic_edit_rakit — AWAITING_LUNAS, no stock impact, no approval
-- =====================================================================
CREATE OR REPLACE FUNCTION public.cosmetic_edit_rakit(
  p_transaction_id UUID,
  p_lines          JSONB,
  p_actor_user_id  UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_actor UUID; v_status TEXT; v_line JSONB; v_line_id UUID;
BEGIN
  v_actor := COALESCE(p_actor_user_id, auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);

  SELECT status INTO v_status FROM kasir_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF v_status != 'AWAITING_LUNAS' THEN
    RAISE EXCEPTION 'cosmetic_edit_rakit: status %, expected AWAITING_LUNAS', v_status;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_id := (v_line->>'id')::UUID;
    UPDATE rakit_job_lines
    SET description = COALESCE(v_line->>'description', description),
        final_price = COALESCE((v_line->>'final_price')::NUMERIC, final_price),
        updated_at  = now()
    WHERE id = v_line_id AND transaction_id = p_transaction_id;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.cosmetic_edit_rakit(UUID, JSONB, UUID) TO authenticated;

COMMIT;
```

- [ ] **Step 2: Smoke-check the SQL by running it against a transaction in dry mode**

```bash
PSQL=/opt/homebrew/Cellar/libpq/18.4/bin/psql
PGPASSWORD='cgJ?mveH2%3/Z/z' $PSQL \
  "host=aws-1-ap-northeast-1.pooler.supabase.com port=5432 user=postgres.ekhhojaezdfjfwuxyjkl dbname=postgres sslmode=require" \
  -c "BEGIN; \i supabase/migrations/20260609000010_rakit_workflow_revision.sql ; ROLLBACK;"
```

Expected: No errors. If errors → fix migration before applying.

- [ ] **Step 3: Apply migration for real**

```bash
PGPASSWORD='cgJ?mveH2%3/Z/z' $PSQL \
  "host=aws-1-ap-northeast-1.pooler.supabase.com port=5432 user=postgres.ekhhojaezdfjfwuxyjkl dbname=postgres sslmode=require" \
  -f supabase/migrations/20260609000010_rakit_workflow_revision.sql
```

Expected: All statements succeed. `COMMIT` printed twice (since the migration splits into two transactions).

- [ ] **Step 4: Verify post-migration state**

```bash
PGPASSWORD='cgJ?mveH2%3/Z/z' $PSQL \
  "host=aws-1-ap-northeast-1.pooler.supabase.com port=5432 user=postgres.ekhhojaezdfjfwuxyjkl dbname=postgres sslmode=require" <<'EOF'
\dt public.rakit_*
SELECT proname FROM pg_proc WHERE proname LIKE '%rakit%' ORDER BY proname;
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'public.approval_request_type'::regtype ORDER BY enumsortorder;
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'public.stock_movement_source'::regtype ORDER BY enumsortorder;
SELECT column_name FROM information_schema.columns WHERE table_name='kasir_transactions' AND column_name LIKE 'lock_%';
SELECT column_name FROM information_schema.columns WHERE table_name='kasir_transactions' AND column_name = 'service_summary';
EOF
```

Expected:
```
rakit_components, rakit_job_lines, rakit_lock_requests    (no rakit_audit_log)
cancel_rakit, commit_approved_rakit_lock, cosmetic_edit_rakit, material_edit_rakit,
  request_rakit_lock, withdraw_rakit_lock                  (no _rakit_audit/submit/approve/reject)
approval_request_type values include 'rakit_lock'
stock_movement_source values include 'rakit_usage', 'rakit_reversal'
0 lock_* columns                                            (all dropped)
1 service_summary column                                    (added)
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260609000010_rakit_workflow_revision.sql
git commit -m "$(cat <<'EOF'
feat(rakit): migration 0010 — Phase 2 approval-gate integration

Morphs prod DB from the pre-Phase-2 rakit design (applied via 0008/0009) to
the Phase 2 approval-gate integration: drops rakit_audit_log + the 5 legacy
RPCs + obsolete kasir_transactions.lock_* columns; adds rakit_lock_requests
satellite + request_rakit_lock + commit_approved_rakit_lock + refactored
withdraw/cancel/material_edit/cosmetic_edit; adds 'rakit_lock' to
approval_request_type and 'rakit_usage'/'rakit_reversal' to
stock_movement_source. service_summary column added for WIP-list display.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 0.2: Frontend types delta

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Read current types**

```bash
grep -n "ApprovalRequestType\|RakitLockRequest\|ActivePage\b" src/types.ts
```

Note current line numbers for `ApprovalRequestType` and `ActivePage`.

- [ ] **Step 2: Add RakitJobLine + RakitComponent + RakitLockRequest types and extend ApprovalRequestType + ActivePage**

Append to `src/types.ts` (and modify the ApprovalRequestType / ActivePage unions):

```typescript
// === Rakit Workflow (Sub-project B) ===

export type RakitServiceType = 'jasa_rakit' | 'jasa_custom_panel';
export type RakitTrackingMode = 'detail' | 'lumpsum';

export interface RakitComponent {
  id?: string;
  rakitLineId?: string;
  sku: string;
  name: string;
  qty: number;
  warehouse: 'atas' | 'bawah';
  fifoCostSnapshot: number;
}

export interface RakitJobLine {
  id: string;
  transactionId: string;
  lineNumber: number;
  serviceType: RakitServiceType;
  description: string;
  estimatedPrice: number;
  finalPrice: number | null;
  trackingMode: RakitTrackingMode;
  laborCost: number;
  lumpSumHpp: number;
  hppOwnerOverride: number | null;
  hppFinal: number | null;
  components?: RakitComponent[];
}

export type RakitLockRequestStatus =
  | 'pending_approval' | 'approved' | 'rejected' | 'expired' | 'withdrawn';

export interface RakitLockRequest {
  id: number;
  transactionId: string;
  approvalRequestId: number;
  linesSnapshot: RakitJobLine[];
  requestedBy: string;
  requestedAt: string;
  status: RakitLockRequestStatus;
  committedAt: string | null;
  isMaterialEdit: boolean;
  priorLockRequestId: number | null;
}
```

Then modify the existing `ApprovalRequestType` union (replace the existing definition):

```typescript
export type ApprovalRequestType =
  | 'adjustment' | 'opname' | 'price_change'
  | 'kasir_price_override' | 'kasir_void' | 'kasir_refund'
  | 'rakit_lock';
```

And add `'wip-list'` to `ActivePage`:

```typescript
export type ActivePage =
  | 'dashboard' | 'sales-inbox' | 'ai-stock' | 'user-management'
  | 'notifications' | 'auth' | 'whatsapp-ai' | 'settings'
  | 'pipeline' | 'order-history' | 'pelanggan' | 'laporan'
  | 'pembelian' | 'kasir' | 'persetujuan' | 'stok-opname'
  | 'rekonsiliasi' | 'wip-list';
```

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: No NEW errors from the rakit/wip-list additions. Pre-existing errors in unrelated files (per progress.md) are fine.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): rakit workflow + wip-list ActivePage (session 1)"
```

---

## Task 0.3: supabaseClient RPC wrappers

**Files:**
- Modify: `src/lib/supabaseClient.ts`

Add four wrappers (one for each RPC the frontend will call in session 1):
- `requestRakitLock(transactionId, lines)` → returns `approvalRequestId`
- `commitApprovedRakitLock(approvalId, hppOverrides?)` → void
- `fetchWipList()` → returns `KasirTransaction[]` with rakit lines joined
- `fetchRakitLockRequestByApprovalId(approvalId)` → returns full snapshot for ApprovalInbox renderer

- [ ] **Step 1: Add the wrappers near the end of supabaseClient.ts, before the final closing brace if any**

Locate the existing `seedStockRow` function (around line 1431 — last RPC wrapper in the Phase 2 block). Add the rakit wrappers right after it:

```typescript
// --- Rakit Workflow (Sub-project B) ---

export async function requestRakitLock(args: {
  transaction_id: string;
  lines: Array<{
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
  }>;
  actor_user_id: string;
}): Promise<number> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.rpc('request_rakit_lock', {
    p_transaction_id: args.transaction_id,
    p_lines: args.lines,
    p_actor_user_id: args.actor_user_id,
  });
  if (error) throw error;
  return data as number;
}

export async function approveRakitLock(
  approvalId: number,
  hppOverrides: Record<string, number> = {},
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  // Wraps _transition_approval('approved') + commit_approved_rakit_lock in one txn.
  // Required because UPDATE on approval_requests is REVOKEd from authenticated.
  const { error } = await supabase.rpc('approve_rakit_lock', {
    p_approval_id: approvalId,
    p_hpp_overrides: hppOverrides,
  });
  if (error) throw error;
}

import type { RakitJobLine, RakitLockRequest } from '../types';

export async function fetchWipList(): Promise<Array<{
  id: string;
  total_amount: number;
  dp_amount: number;
  customer_name: string | null;
  customer_phone: string | null;
  service_summary: string | null;
  created_at: string;
  rakit_lines: RakitJobLine[];
}>> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('kasir_transactions')
    .select('id, total_amount, dp_amount, customer_name, customer_phone, service_summary, created_at, rakit_job_lines(*)')
    .eq('status', 'WIP')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    total_amount: Number(row.total_amount ?? 0),
    dp_amount: Number(row.dp_amount ?? 0),
    customer_name: row.customer_name ?? null,
    customer_phone: row.customer_phone ?? null,
    service_summary: row.service_summary ?? null,
    created_at: row.created_at,
    rakit_lines: (row.rakit_job_lines ?? []).map((l: any) => ({
      id: l.id,
      transactionId: l.transaction_id,
      lineNumber: l.line_number,
      serviceType: l.service_type,
      description: l.description,
      estimatedPrice: Number(l.estimated_price ?? 0),
      finalPrice: l.final_price == null ? null : Number(l.final_price),
      trackingMode: l.tracking_mode,
      laborCost: Number(l.labor_cost ?? 0),
      lumpSumHpp: Number(l.lump_sum_hpp ?? 0),
      hppOwnerOverride: l.hpp_owner_override == null ? null : Number(l.hpp_owner_override),
      hppFinal: l.hpp_final == null ? null : Number(l.hpp_final),
    })),
  }));
}

export async function fetchRakitLockRequestByApprovalId(
  approvalId: number,
): Promise<RakitLockRequest | null> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('rakit_lock_requests')
    .select('*')
    .eq('approval_request_id', approvalId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    transactionId: data.transaction_id,
    approvalRequestId: data.approval_request_id,
    linesSnapshot: data.lines_snapshot,
    requestedBy: data.requested_by,
    requestedAt: data.requested_at,
    status: data.status,
    committedAt: data.committed_at,
    isMaterialEdit: data.is_material_edit,
    priorLockRequestId: data.prior_lock_request_id,
  };
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: clean for the new wrappers.

- [ ] **Step 3: Smoke-test the RPC wrappers in a Node REPL or quick script** (only if you have a test WIP transaction to use; otherwise skip and verify in browser later)

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "feat(client): rakit workflow RPC wrappers"
```

---

## Task 1.1: `RakitButtonsRow` component

Reference: original plan lines 1582–1648 (`docs/superpowers/plans/2026-06-08-rakit-workflow.md`) for full code and expected behavior.

**Files:**
- Create: `src/components/penjualan/RakitButtonsRow.tsx`

**Component summary:** Two-button row (`⚡ + Tambah Jasa Rakit` / `📦 + Tambah Jasa Custom Panel`) that toggles inline form open and selects the service type. Disabled state when form is already open.

- [ ] **Step 1: Read the existing original-plan task content for `RakitButtonsRow`**

```bash
sed -n '1582,1648p' docs/superpowers/plans/2026-06-08-rakit-workflow.md
```

- [ ] **Step 2: Create the component**

```typescript
// src/components/penjualan/RakitButtonsRow.tsx
import React from 'react';
import type { RakitServiceType } from '../../types';

interface RakitButtonsRowProps {
  formOpen: boolean;
  formType: RakitServiceType | null;
  onOpen: (type: RakitServiceType) => void;
}

export default function RakitButtonsRow({ formOpen, formType, onOpen }: RakitButtonsRowProps) {
  const disabled = formOpen;
  return (
    <div className="bg-amber-50/60 border border-amber-200 rounded-2xl p-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-base">🛠</span>
          <div>
            <div className="font-extrabold text-[13px] text-orange-700">Tambah Jasa</div>
            <div className="text-[11px] text-orange-700/70">
              Pilih tipe jasa &middot; invoice WIP sampai lock + approval
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onOpen('jasa_rakit')}
          disabled={disabled}
          className={`py-2.5 px-3 rounded-xl text-[12px] font-extrabold text-white transition ${
            disabled && formType === 'jasa_rakit'
              ? 'bg-amber-300 opacity-60 cursor-not-allowed'
              : 'bg-amber-500 hover:bg-amber-600 disabled:opacity-50'
          }`}
        >
          ⚡ + Tambah Jasa Rakit
        </button>
        <button
          type="button"
          onClick={() => onOpen('jasa_custom_panel')}
          disabled={disabled}
          className={`py-2.5 px-3 rounded-xl text-[12px] font-extrabold text-white transition ${
            disabled && formType === 'jasa_custom_panel'
              ? 'bg-sky-300 opacity-60 cursor-not-allowed'
              : 'bg-sky-500 hover:bg-sky-600 disabled:opacity-50'
          }`}
        >
          📦 + Tambah Jasa Custom Panel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit 2>&1 | head -5
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/penjualan/RakitButtonsRow.tsx
git commit -m "feat(penjualan): RakitButtonsRow component"
```

---

## Task 1.2: `RakitInlineForm` component

Reference: original plan lines 1649–1754.

**Files:**
- Create: `src/components/penjualan/RakitInlineForm.tsx`

**Component summary:** Form panel that takes `type` (jasa_rakit / jasa_custom_panel), captures `description` + `estimatedPrice`, calls `onAdd({type, description, estimatedPrice})` when submit clicked, and `onCancel` to close.

- [ ] **Step 1: Read the original-plan task content**

```bash
sed -n '1649,1754p' docs/superpowers/plans/2026-06-08-rakit-workflow.md
```

- [ ] **Step 2: Create the component**

```typescript
// src/components/penjualan/RakitInlineForm.tsx
import React, { useState } from 'react';
import type { RakitServiceType } from '../../types';

interface RakitInlineFormProps {
  type: RakitServiceType;
  onAdd: (line: { type: RakitServiceType; description: string; estimatedPrice: number }) => void;
  onCancel: () => void;
}

export default function RakitInlineForm({ type, onAdd, onCancel }: RakitInlineFormProps) {
  const [description, setDescription] = useState('');
  const [estimatedPrice, setEstimatedPrice] = useState<number>(0);
  const isCustom = type === 'jasa_custom_panel';

  const canSubmit = description.trim().length > 0 && estimatedPrice > 0;
  const submit = () => {
    if (!canSubmit) return;
    onAdd({ type, description: description.trim(), estimatedPrice });
    setDescription('');
    setEstimatedPrice(0);
  };

  const placeholder = isCustom
    ? 'Mis. Custom Panel Distribusi 3-fase — PLN 50kVA'
    : 'Mis. Box Wiring untuk PT XYZ — 1 unit';

  return (
    <div className={`bg-white border ${isCustom ? 'border-sky-300' : 'border-orange-300'} rounded-xl p-3 space-y-3`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
            isCustom ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-orange-50 text-orange-700 border border-orange-200'
          }`}>
            {isCustom ? '📦 Jasa Custom Panel' : '⚡ Jasa Rakit'}
          </span>
          <span className="text-[11px] text-slate-500">isi detail di bawah</span>
        </div>
        <button type="button" onClick={onCancel} className="text-slate-400 hover:text-rose-500 text-base">✕</button>
      </div>
      <div>
        <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">Deskripsi (singkat, tampil di invoice)</div>
        <input
          type="text"
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-emerald-500"
          placeholder={placeholder}
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </div>
      <div>
        <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">Estimasi Harga (quote disepakati)</div>
        <input
          type="number"
          min={0}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-emerald-500"
          placeholder="0"
          value={estimatedPrice || ''}
          onChange={e => setEstimatedPrice(Number(e.target.value || 0))}
        />
        <div className="text-[11px] text-slate-500 mt-1.5">
          ℹ Admin bisa adjust ke harga final saat lock kalau scope berubah.
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg text-[12px] font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50">
          Batal
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className={`px-3 py-2 rounded-lg text-[12px] font-extrabold text-white transition ${
            isCustom ? 'bg-sky-500 hover:bg-sky-600' : 'bg-amber-500 hover:bg-amber-600'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          + Tambah ke Cart
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit 2>&1 | head -5
```

- [ ] **Step 4: Commit**

```bash
git add src/components/penjualan/RakitInlineForm.tsx
git commit -m "feat(penjualan): RakitInlineForm component"
```

---

## Task 1.3: Wire RakitButtonsRow + InlineForm into `PenjualanBaruScreen`

Reference: original plan lines 1755–1845.

**Files:**
- Modify: `src/components/PenjualanBaruScreen.tsx`

**Summary:** Add local state for rakit lines + form open/draft. Render `RakitButtonsRow` and (conditionally) `RakitInlineForm` between the cart-search panel and the cart-rows panel. `onAdd` appends a new line to local `rakitLines` state. Each line gets a generated UUID-like id (use `crypto.randomUUID()` if available, otherwise `Date.now()`-based id).

- [ ] **Step 1: Read the original-plan task content for full code**

```bash
sed -n '1755,1845p' docs/superpowers/plans/2026-06-08-rakit-workflow.md
```

- [ ] **Step 2: Read current PenjualanBaruScreen.tsx to understand its structure**

```bash
grep -n "useState\|<CartRows\|<ChannelSelector\|<ItemSearchPanel\|<PaymentPanel\|<CustomerPanel" src/components/PenjualanBaruScreen.tsx | head -20
```

- [ ] **Step 3: Apply the edit** — add to imports:

```typescript
import RakitButtonsRow from './penjualan/RakitButtonsRow';
import RakitInlineForm from './penjualan/RakitInlineForm';
import type { RakitServiceType } from '../types';
```

Add state near the existing `useState` block:

```typescript
const [rakitLines, setRakitLines] = useState<Array<{
  id: string;
  type: RakitServiceType;
  description: string;
  estimatedPrice: number;
}>>([]);
const [rakitFormOpen, setRakitFormOpen] = useState(false);
const [rakitFormType, setRakitFormType] = useState<RakitServiceType | null>(null);

const openRakitForm = (t: RakitServiceType) => {
  setRakitFormType(t);
  setRakitFormOpen(true);
};
const cancelRakitForm = () => {
  setRakitFormOpen(false);
  setRakitFormType(null);
};
const addRakitLine = (line: { type: RakitServiceType; description: string; estimatedPrice: number }) => {
  const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `rakit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  setRakitLines(prev => [...prev, { id, ...line }]);
  cancelRakitForm();
};
const removeRakitLine = (id: string) => {
  setRakitLines(prev => prev.filter(l => l.id !== id));
};
```

Render the buttons row + inline form right after `ItemSearchPanel` (or wherever the cart-add section sits — match the mockup):

```tsx
<RakitButtonsRow
  formOpen={rakitFormOpen}
  formType={rakitFormType}
  onOpen={openRakitForm}
/>
{rakitFormOpen && rakitFormType && (
  <RakitInlineForm
    type={rakitFormType}
    onAdd={addRakitLine}
    onCancel={cancelRakitForm}
  />
)}
```

- [ ] **Step 4: Typecheck and visual smoke-test**

```bash
npx tsc --noEmit 2>&1 | head -5
```

Then run the dev server and navigate to Catat Penjualan; verify the two buttons appear and the form toggles.

- [ ] **Step 5: Commit**

```bash
git add src/components/PenjualanBaruScreen.tsx
git commit -m "feat(penjualan): wire RakitButtonsRow + InlineForm into Catat Penjualan"
```

---

## Task 1.4: Cart line rendering for rakit lines

Reference: original plan lines 1846–1956.

**Files:**
- Modify: `src/components/PenjualanBaruScreen.tsx` (pass `rakitLines` + `removeRakitLine` to `CartRows`)
- Modify: `src/components/penjualan/CartRows.tsx` (render the rakit section if `rakitLines.length > 0`)

- [ ] **Step 1: Read original-plan task content**

```bash
sed -n '1846,1956p' docs/superpowers/plans/2026-06-08-rakit-workflow.md
```

- [ ] **Step 2: Extend `CartRows` props + render section**

Add to `CartRows.tsx`:

```typescript
import type { RakitServiceType } from '../../types';

interface CartRowsProps {
  // ... existing props
  rakitLines?: Array<{ id: string; type: RakitServiceType; description: string; estimatedPrice: number }>;
  onRemoveRakit?: (id: string) => void;
}

// Inside the component render, AFTER the komponen rows:
{rakitLines && rakitLines.length > 0 && (
  <>
    <div className="text-[10px] font-extrabold text-orange-700 uppercase tracking-widest mb-2 mt-3 flex items-center gap-2">
      <span>🛠 Jasa Rakit</span>
      <span className="flex-1 border-t border-dotted border-slate-300" />
    </div>
    {rakitLines.map(r => (
      <div
        key={r.id}
        className="rounded-xl p-3 mb-2 grid grid-cols-[1fr_auto_auto] gap-3 items-center text-[12px]"
        style={{
          background: r.type === 'jasa_custom_panel'
            ? 'linear-gradient(90deg, rgba(14,165,233,0.08), rgba(14,165,233,0.02) 80%)'
            : 'linear-gradient(90deg, rgba(245,158,11,0.08), rgba(245,158,11,0.02) 80%)',
          borderLeft: r.type === 'jasa_custom_panel' ? '3px solid #0ea5e9' : '3px solid #f59e0b',
        }}
      >
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
              r.type === 'jasa_custom_panel'
                ? 'bg-sky-50 text-sky-700 border border-sky-200'
                : 'bg-orange-50 text-orange-700 border border-orange-200'
            }`}>
              {r.type === 'jasa_custom_panel' ? '📦 Jasa Custom Panel' : '⚡ Jasa Rakit'}
            </span>
            <span className="font-extrabold text-[13px]">{r.description}</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Estimasi · final di-adjust admin saat lock</div>
        </div>
        <div className={`font-extrabold text-[14px] ${r.type === 'jasa_custom_panel' ? 'text-sky-700' : 'text-amber-700'}`}>
          {formatRp(r.estimatedPrice)}
        </div>
        <button
          type="button"
          onClick={() => onRemoveRakit?.(r.id)}
          className="text-slate-300 hover:text-rose-500 text-lg"
        >
          ✕
        </button>
      </div>
    ))}
  </>
)}
```

In `PenjualanBaruScreen.tsx`, pass the props to `<CartRows>`:

```tsx
<CartRows
  // existing props
  rakitLines={rakitLines}
  onRemoveRakit={removeRakitLine}
/>
```

- [ ] **Step 3: Visual smoke-test** — Add a rakit line via the form, verify it appears in the cart with the orange/sky styling.

- [ ] **Step 4: Commit**

```bash
git add src/components/penjualan/CartRows.tsx src/components/PenjualanBaruScreen.tsx
git commit -m "feat(penjualan): render rakit lines in cart section"
```

---

## Task 1.5: WIP warning banner + total calc adjustment

Reference: original plan lines 1957–2000.

**Files:**
- Modify: `src/components/PenjualanBaruScreen.tsx` (compute `hasRakit`; render banner; include rakit estimated prices in total)

- [ ] **Step 1: Add `hasRakit` derived value and include rakit total in `subtotal`**

```typescript
const hasRakit = rakitLines.length > 0;
const rakitTotal = rakitLines.reduce((s, r) => s + r.estimatedPrice, 0);

// Wherever the existing `subtotal` is calculated, add rakitTotal:
const subtotal = /* existing item subtotal calculation */ + rakitTotal;
```

- [ ] **Step 2: Render the WIP warning banner conditionally, right above the totals/payment panel**

```tsx
{hasRakit && (
  <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[12px] text-amber-800 mt-3">
    ⚠ <strong>Transaksi ini akan masuk status WIP</strong> karena ada jasa rakit.
    Lock + approval owner diperlukan sebelum stock decrement &amp; pelunasan.
  </div>
)}
```

- [ ] **Step 3: Smoke-test** — Add a rakit line and verify the banner appears + the total includes the rakit estimated price.

- [ ] **Step 4: Commit**

```bash
git add src/components/PenjualanBaruScreen.tsx
git commit -m "feat(penjualan): WIP warning banner + include rakit total in subtotal"
```

---

## Task 1.6: Modify save flow to create WIP transaction with rakit lines

Reference: original plan lines 2001–2124.

**Files:**
- Modify: `src/components/PenjualanBaruScreen.tsx` (save handler)
- Modify: `src/lib/supabaseClient.ts` (extend `kasirService.insertSaleTransaction` to accept rakit lines + return tx id)

**Summary:** When `hasRakit` is true, the save flow must (a) set transaction status to `WIP` (not `PAID` / `AWAITING_LUNAS`), (b) insert the kasir_transaction row, (c) insert `rakit_job_lines` rows pointing to the new transaction, (d) compute a `service_summary` string ("⚡ 1 Rakit + 📦 1 Custom Panel") for the WIP-list display. The post-save invoice PDF + auto-print should be **skipped** for WIP transactions — they're not done yet.

- [ ] **Step 1: Read original-plan task content**

```bash
sed -n '2001,2124p' docs/superpowers/plans/2026-06-08-rakit-workflow.md
```

- [ ] **Step 2: Extend `kasirService.insertSaleTransaction` (or add a new function) to handle the WIP-with-rakit case**

In `src/lib/supabaseClient.ts`, add a new function `kasirService.insertWipWithRakit`:

```typescript
async insertWipWithRakit(input: {
  tx: Omit<RecordKasirSaleInput, 'status'>;
  rakitLines: Array<{
    serviceType: RakitServiceType;
    description: string;
    estimatedPrice: number;
  }>;
}): Promise<string> {
  if (!supabase) throw new Error('Supabase not configured');
  // 1. compute service_summary
  const rCount = input.rakitLines.filter(l => l.serviceType === 'jasa_rakit').length;
  const cCount = input.rakitLines.filter(l => l.serviceType === 'jasa_custom_panel').length;
  const summary = [
    rCount ? `⚡ ${rCount} Rakit` : null,
    cCount ? `📦 ${cCount} Custom Panel` : null,
  ].filter(Boolean).join(' + ');

  // 2. insert kasir_transactions row with status='WIP' + service_summary
  const { data: tx, error: txErr } = await supabase
    .from('kasir_transactions')
    .insert({
      ...input.tx,
      status: 'WIP',
      service_summary: summary,
    })
    .select('id')
    .single();
  if (txErr) throw txErr;
  const transactionId = tx.id as string;

  // 3. insert rakit_job_lines (line_number ordered, estimated_price set, tracking_mode default 'detail')
  const lineRows = input.rakitLines.map((l, idx) => ({
    transaction_id: transactionId,
    line_number: idx + 1,
    service_type: l.serviceType,
    description: l.description,
    estimated_price: l.estimatedPrice,
    tracking_mode: 'detail',
    labor_cost: 0,
    lump_sum_hpp: 0,
  }));
  const { error: linesErr } = await supabase.from('rakit_job_lines').insert(lineRows);
  if (linesErr) throw linesErr;

  return transactionId;
},
```

Note: the `RecordKasirSaleInput` type lives in `src/types.ts` and `RakitServiceType` too — make sure imports are at the top of `supabaseClient.ts`.

- [ ] **Step 3: Modify `PenjualanBaruScreen` save handler to branch on `hasRakit`**

```typescript
// In the existing save handler, around where insertSaleTransaction is called:
if (hasRakit) {
  const txId = await supabaseService.insertWipWithRakit({
    tx: { /* same fields as before, but no status */ },
    rakitLines: rakitLines.map(l => ({
      serviceType: l.type,
      description: l.description,
      estimatedPrice: l.estimatedPrice,
    })),
  });
  showToast(`Transaksi WIP tersimpan. ID: ${txId.slice(0, 8)}...`, 'success');
  // Do NOT open the invoice PDF for WIP transactions
  // Navigate to WIP list so user can submit lock when ready:
  onNavigate?.('wip-list');
  return;
}
// existing non-rakit flow continues...
```

- [ ] **Step 4: End-to-end smoke-test**
  1. Open Catat Penjualan
  2. Add 1 komponen + 1 jasa rakit
  3. Fill customer + payment
  4. Click Simpan
  5. Verify: toast "Transaksi WIP tersimpan", redirect to WIP list (which is still empty at this point — Task 2.1 builds it). Check DB: `SELECT id, status, service_summary FROM kasir_transactions ORDER BY created_at DESC LIMIT 1;` — should show status=WIP, service_summary populated.

- [ ] **Step 5: Commit**

```bash
git add src/components/PenjualanBaruScreen.tsx src/lib/supabaseClient.ts
git commit -m "feat(penjualan): save WIP transaction with rakit lines when cart has rakit"
```

---

## Task 2.1: `WipListScreen`

Reference: original plan lines 2127–2255.

**Files:**
- Create: `src/components/WipListScreen.tsx`

**Component summary:** A screen that lists `kasir_transactions` where `status = 'WIP'` with their rakit lines. Each row shows customer name + service summary + total + DP + created_at, plus two action buttons: `❌ Cancel Job` (opens cancel modal — deferred to session 2, for now show "belum tersedia") and `🔒 Selesaikan Rakit` (opens `LockSubmissionModal` from Task 3).

- [ ] **Step 1: Read original-plan task content**

```bash
sed -n '2127,2255p' docs/superpowers/plans/2026-06-08-rakit-workflow.md
```

- [ ] **Step 2: Create the component skeleton**

```typescript
// src/components/WipListScreen.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { fetchWipList } from '../lib/supabaseClient';
import LockSubmissionModal from './penjualan/LockSubmissionModal';
import type { RakitJobLine } from '../types';

interface WipListScreenProps {
  currentUser: { id: string; name: string } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type WipRow = {
  id: string;
  total_amount: number;
  dp_amount: number;
  customer_name: string | null;
  customer_phone: string | null;
  service_summary: string | null;
  created_at: string;
  rakit_lines: RakitJobLine[];
};

function formatRp(n: number): string {
  return 'Rp ' + n.toLocaleString('id-ID');
}

export default function WipListScreen({ currentUser, showToast }: WipListScreenProps) {
  const [rows, setRows] = useState<WipRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lockTx, setLockTx] = useState<WipRow | null>(null);

  const refresh = async () => {
    try {
      setLoading(true);
      const data = await fetchWipList();
      setRows(data);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal memuat WIP list', 'warning');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-extrabold text-lg text-[#012749]">⏳ WIP — Rakit Job in Progress</h1>
          <p className="text-xs text-slate-500">
            {rows.length} transaksi sedang dirakit · klik salah satu untuk lock atau cancel
          </p>
        </div>
      </div>

      {loading && <p className="text-sm text-slate-500">Memuat&hellip;</p>}
      {!loading && rows.length === 0 && (
        <p className="text-center text-sm py-6 text-slate-500">
          Belum ada transaksi WIP. Buat lewat <strong>Catat Penjualan</strong>.
        </p>
      )}

      <div className="space-y-2">
        {rows.map(tx => (
          <div key={tx.id} className="bg-white border border-slate-200 rounded-2xl p-4 hover:border-amber-400 transition">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-extrabold text-[14px]">{tx.id.slice(0, 8)}...</span>
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider bg-amber-100 text-amber-800">WIP</span>
                </div>
                <div className="text-[12px] text-slate-600">{tx.customer_name ?? '—'} · {tx.customer_phone ?? '—'}</div>
                <div className="text-[11px] text-slate-400 mt-1">Created: {new Date(tx.created_at).toLocaleString('id-ID')}</div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-slate-400">Total</div>
                <div className="font-extrabold text-[15px] text-[#012749]">{formatRp(tx.total_amount)}</div>
                <div className="text-[11px] text-emerald-700">DP: {formatRp(tx.dp_amount)}</div>
              </div>
            </div>
            <div className="bg-slate-50 rounded-lg p-2 mb-3 text-[12px]">
              <div className="text-slate-700"><strong>{tx.service_summary ?? '—'}</strong></div>
              {tx.rakit_lines.map(r => (
                <div key={r.id} className="flex items-center justify-between mt-1">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                      r.serviceType === 'jasa_custom_panel' ? 'bg-sky-50 text-sky-700' : 'bg-orange-50 text-orange-700'
                    }`}>
                      {r.serviceType === 'jasa_custom_panel' ? '📦 Custom Panel' : '⚡ Rakit'}
                    </span>
                    <span className="text-[12px] font-bold">{r.description}</span>
                  </div>
                  <span className="text-[12px] font-bold text-amber-700">{formatRp(r.estimatedPrice)}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => showToast('Cancel Job belum tersedia di session ini', 'info')}
                className="px-3 py-1.5 rounded-full text-[12px] font-extrabold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100"
              >
                ❌ Cancel Job
              </button>
              <button
                type="button"
                onClick={() => setLockTx(tx)}
                className="px-3 py-1.5 rounded-full text-[12px] font-extrabold text-white bg-[#012749] hover:bg-[#01365f]"
              >
                🔒 Selesaikan Rakit
              </button>
            </div>
          </div>
        ))}
      </div>

      {lockTx && currentUser && (
        <LockSubmissionModal
          transactionId={lockTx.id}
          rakitLines={lockTx.rakit_lines}
          currentUser={currentUser}
          onClose={() => setLockTx(null)}
          onSubmitted={() => {
            setLockTx(null);
            showToast('Permintaan lock terkirim — menunggu approval owner', 'success');
            void refresh();
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck (will fail on missing `LockSubmissionModal` import — that lands in Task 3.1)**

For now, comment out the `LockSubmissionModal` import + usage to make the component compile in isolation, OR ship Task 3.1 first then come back to Task 2.1. Recommended order: ship Task 2.1 stub first, then Task 3.1, then re-enable.

- [ ] **Step 4: Commit (with stubbed lock modal)**

```bash
git add src/components/WipListScreen.tsx
git commit -m "feat(wip-list): WipListScreen — list WIP rakit transactions"
```

---

## Task 2.2: `rakitService` wiring (already covered in Task 0.3)

Task 0.3 already added `fetchWipList` and `fetchRakitLockRequestByApprovalId`. This task confirms those wrappers are used by the screens, and adds any missing helpers.

- [ ] **Step 1: Verify Task 0.3 wrappers are imported by `WipListScreen` and `RakitLockApprovalRequestRow` (later) correctly.**

No code changes needed if Task 0.3 was thorough. Skip if so.

---

## Task 2.3: Wire `WipListScreen` into routing + sidebar

Reference: original plan lines 2433–2499.

**Files:**
- Modify: `src/App.tsx` — add `case 'wip-list':` branch in `renderPage()`
- Modify: `src/components/Sidebar.tsx` — add a new sidebar item gated on a permission (use existing `aiStock` permission since the staff who creates rakit is the same who handles stock)

- [ ] **Step 1: Add the route case in `App.tsx`**

In `renderPage()` switch, before `default`:

```typescript
case 'wip-list':
  return (
    <WipListScreen
      currentUser={currentUser}
      showToast={triggerToast}
    />
  );
```

Add the import at the top:

```typescript
import WipListScreen from './components/WipListScreen';
```

- [ ] **Step 2: Add the sidebar item**

In `Sidebar.tsx`'s `menuItems` array, after the existing `stok-opname` item, add:

```typescript
{
  id: 'wip-list',
  label: 'WIP Rakit',
  icon: Clock,  // import { Clock } from 'lucide-react'
  description: 'Transaksi rakit in progress',
  permKey: 'aiStock' as keyof PermissionSet,
},
```

Add `Clock` to the lucide-react imports.

- [ ] **Step 3: Smoke-test** — Reload the app, verify the WIP Rakit item shows in the sidebar, clicking it routes to the WipListScreen.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/Sidebar.tsx
git commit -m "feat(nav): WIP Rakit sidebar item + routing"
```

---

## Task 3.1: `LockSubmissionModal` — main modal with component picker

Reference: original plan lines 2502–2984 (large task — split into picker + main modal).

**Files:**
- Create: `src/components/penjualan/LockSubmissionModal.tsx`

**Component summary:** Modal that takes a `transactionId` and array of `rakitLines`, lets the admin (for each line):
- Adjust `description` and `finalPrice`
- Pick `trackingMode`: `detail` or `lumpsum`
- If `detail`: add components (SKU search + qty + warehouse atas/bawah) — FIFO cost is **fetched but not deducted** (peek). On submit, the snapshot is sent to `request_rakit_lock` RPC.
- If `lumpsum`: enter `lump_sum_hpp` and `labor_cost = 0`.

On submit: calls `requestRakitLock({transaction_id, lines, actor_user_id})` from `supabaseClient.ts`.

- [ ] **Step 1: Read original-plan task content**

```bash
sed -n '2502,2984p' docs/superpowers/plans/2026-06-08-rakit-workflow.md
```

The original plan splits this into Task 3.1 (`RakitComponentPicker` sub-component) + Task 3.2 (main modal). For session 1, build them in a single file (`LockSubmissionModal.tsx`) with the picker as an internal sub-component to reduce file count. If the file grows past ~400 lines, split.

- [ ] **Step 2: Create the modal component**

(See the original plan for the full ~250 LoC of detailed JSX. Inline the entire content here when implementing — the brevity in this plan is to keep the document scannable; the engineer pulls full code from the source plan.)

Key shape:

```typescript
// src/components/penjualan/LockSubmissionModal.tsx
import React, { useState } from 'react';
import { requestRakitLock } from '../../lib/supabaseClient';
import type { RakitJobLine, RakitTrackingMode } from '../../types';

interface LockSubmissionModalProps {
  transactionId: string;
  rakitLines: RakitJobLine[];
  currentUser: { id: string; name: string };
  onClose: () => void;
  onSubmitted: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type LineDraft = {
  id: string;
  description: string;
  finalPrice: number;
  trackingMode: RakitTrackingMode;
  laborCost: number;
  lumpSumHpp: number;
  components: Array<{
    sku: string;
    name: string;
    qty: number;
    warehouse: 'atas' | 'bawah';
    fifo_cost: number;
  }>;
};

export default function LockSubmissionModal({
  transactionId,
  rakitLines,
  currentUser,
  onClose,
  onSubmitted,
  showToast,
}: LockSubmissionModalProps) {
  const [drafts, setDrafts] = useState<LineDraft[]>(
    rakitLines.map(l => ({
      id: l.id,
      description: l.description,
      finalPrice: l.finalPrice ?? l.estimatedPrice,
      trackingMode: l.trackingMode ?? 'detail',
      laborCost: l.laborCost ?? 0,
      lumpSumHpp: l.lumpSumHpp ?? 0,
      components: [],
    }))
  );
  const [submitting, setSubmitting] = useState(false);

  const updateDraft = (id: string, patch: Partial<LineDraft>) => {
    setDrafts(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d));
  };

  const canSubmit = drafts.every(d =>
    d.description.trim().length > 0 &&
    d.finalPrice > 0 &&
    (d.trackingMode === 'detail'
      ? d.components.length > 0 && d.components.every(c => c.sku && c.qty > 0)
      : d.lumpSumHpp > 0)
  );

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      await requestRakitLock({
        transaction_id: transactionId,
        lines: drafts.map(d => ({
          id: d.id,
          final_price: d.finalPrice,
          tracking_mode: d.trackingMode,
          labor_cost: d.trackingMode === 'detail' ? d.laborCost : 0,
          lump_sum_hpp: d.trackingMode === 'lumpsum' ? d.lumpSumHpp : 0,
          components: d.trackingMode === 'detail' ? d.components : [],
        })),
        actor_user_id: currentUser.id,
      });
      onSubmitted();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal submit lock', 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 py-8 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl max-w-3xl w-full p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-extrabold text-lg text-[#012749]">🔒 Submit Lock untuk Approval</h2>
            <p className="text-xs text-slate-500 mt-1">
              Isi komponen + harga final. Owner akan review &amp; approve / reject.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-rose-500 text-2xl leading-none">✕</button>
        </div>

        {/* TODO(session 1): per-line draft UI with mode toggle + component picker.
            Refer to original plan lines 2502-2984 for full JSX.
            Minimum viable: render description + finalPrice + tracking_mode toggle
            + (if detail) a simple form: SKU text input + qty input + warehouse toggle + add button. */}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-[13px] font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50">
            Batal
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit || submitting}
            className="px-4 py-2 rounded-lg text-[13px] font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Mengirim…' : '🔒 Submit untuk Approval'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

The above is a stub with the wiring + submit. The full UI inside (per-line drafts editor + component picker with SKU autocomplete) needs to be filled in from the original plan content. **This is the most code-heavy task in this session — budget accordingly.**

- [ ] **Step 3: Re-enable the import + usage in `WipListScreen.tsx`** that was stubbed out in Task 2.1.

- [ ] **Step 4: Typecheck + smoke-test**

```bash
npx tsc --noEmit 2>&1 | head -5
```

In browser: open WIP list, click "🔒 Selesaikan Rakit", verify modal opens with the rakit lines pre-filled.

- [ ] **Step 5: Commit (initial stub)**

```bash
git add src/components/penjualan/LockSubmissionModal.tsx src/components/WipListScreen.tsx
git commit -m "feat(rakit): LockSubmissionModal scaffold + wire into WIP list"
```

---

## Task 3.2: Flesh out `LockSubmissionModal` — per-line editor + component picker

This task completes the modal: per-line draft editor (description, finalPrice, mode toggle), and for detail-mode lines, a component picker (SKU search via existing stock list + qty + warehouse + add/remove components). Fetch the FIFO cost via `supabaseService.fetchStocks()` (already exists) and embed in the snapshot.

Reference: original plan lines 2502–2984 for the full UI.

- [ ] **Step 1: Read the full picker + per-line editor JSX from the original plan**

```bash
sed -n '2502,2984p' docs/superpowers/plans/2026-06-08-rakit-workflow.md > /tmp/lock_modal_reference.md
```

- [ ] **Step 2: Implement per-line draft cards with mode toggle**

Inside the modal body, replace the TODO comment with `drafts.map(d => …)` rendering each line as a card:
- Description input (text)
- Final price input (number)
- Mode toggle: [Detail (komponen)] [Lumpsum]
- If detail: component picker section
- If lumpsum: lump_sum_hpp input + labor_cost=0 implicit

- [ ] **Step 3: Implement the component picker** — text input for SKU search (filter against `stockList` prop or fetch via supabase), then for each selected component: qty stepper, warehouse atas/bawah toggle, remove button. The FIFO cost should be looked up from the stock row at add-time (use `stocks.harga_modal ?? 0` as a coarse FIFO proxy).

- [ ] **Step 4: Typecheck + end-to-end smoke-test**

Manual: create a WIP transaction with 1 rakit line, open Lock Modal, add 1-2 components, submit. Verify:
- `kasir_transactions.status` changes to `PENDING_LOCK_APPROVAL`
- A new row appears in `approval_requests` with `request_type='rakit_lock'`
- A new row appears in `rakit_lock_requests` linked to that approval
- `rakit_job_lines.final_price` is updated
- `rakit_components` rows are inserted

```bash
PGPASSWORD='...' psql ... -c "
SELECT kt.status, kt.service_summary, ar.id AS approval_id, ar.status AS ar_status,
       rlr.id AS rlr_id, rlr.status AS rlr_status
FROM kasir_transactions kt
JOIN rakit_lock_requests rlr ON rlr.transaction_id = kt.id
JOIN approval_requests ar ON ar.id = rlr.approval_request_id
WHERE kt.id = '<your-tx-id>'
ORDER BY rlr.requested_at DESC LIMIT 1;
"
```

Expected: `status=PENDING_LOCK_APPROVAL`, `ar.status=pending`, `rlr.status=pending_approval`.

- [ ] **Step 5: Commit**

```bash
git add src/components/penjualan/LockSubmissionModal.tsx
git commit -m "feat(rakit): LockSubmissionModal — per-line editor + component picker"
```

---

## Task 4.1: Add `'rakit_lock'` filter pill + extend `matchesFilter` in `ApprovalInboxScreen`

**Files:**
- Modify: `src/components/approval/ApprovalInboxScreen.tsx`

- [ ] **Step 1: Read current ApprovalInboxScreen filter pill list**

```bash
sed -n '42,55p' src/components/approval/ApprovalInboxScreen.tsx
```

- [ ] **Step 2: Extend the `FilterPill` union and `PILLS` array**

```typescript
type FilterPill = 'all' | 'adjustment' | 'price_change' | 'opname' | 'rakit_lock' | 'kasir';

const PILLS: { key: FilterPill; label: string }[] = [
  { key: 'all',           label: 'Semua' },
  { key: 'adjustment',    label: 'Adjustment' },
  { key: 'price_change',  label: 'Harga' },
  { key: 'opname',        label: 'Opname' },
  { key: 'rakit_lock',    label: 'Rakit Lock' },
  { key: 'kasir',         label: 'Kasir' },
];

function matchesFilter(req: ApprovalRequest, filter: FilterPill): boolean {
  if (filter === 'all') return true;
  if (filter === 'kasir') return req.requestType.startsWith('kasir_');
  return req.requestType === (filter as ApprovalRequestType);
}
```

- [ ] **Step 3: Extend the `isOwner` check** to include rakit lock approver (use `aiStock` perm as proxy since rakit is a stock-impacting action):

```typescript
const isOwner = !!(
  perms?.can_approve_adjustment ||
  perms?.can_approve_price_change ||
  perms?.can_commit_opname ||
  perms?.can_approve_kasir_price_override ||
  perms?.can_approve_kasir_void ||
  perms?.can_approve_kasir_refund ||
  perms?.can_approve_adjustment   // rakit_lock approver gate — same role as adjustment approver for session 1
);
```

(Session 2 may add a dedicated `can_approve_rakit_lock` permission. For session 1, reuse `can_approve_adjustment` since the personas overlap in the 4-user MSME context.)

- [ ] **Step 4: Commit**

```bash
git add src/components/approval/ApprovalInboxScreen.tsx
git commit -m "feat(approval): add rakit_lock filter pill"
```

---

## Task 4.2: `RakitLockApprovalRequestRow` renderer

**Files:**
- Create: `src/components/approval/RakitLockApprovalRequestRow.tsx`

**Component summary:** Renderer for an `ApprovalRequest` whose `requestType === 'rakit_lock'`. Shows a row similar to `ApprovalRequestRow` but with: customer name, service summary, lines count, final-price total, and a margin badge (margin% computed from `Σ finalPrice − Σ hppFinal` for `detail` lines). Click → expand to show full snapshot. Approve button → call `commitApprovedRakitLock(approvalId)`.

- [ ] **Step 1: Create the component**

```typescript
// src/components/approval/RakitLockApprovalRequestRow.tsx
import React, { useEffect, useState } from 'react';
import type { ApprovalRequest, RakitLockRequest } from '../../types';
import { fetchRakitLockRequestByApprovalId } from '../../lib/supabaseClient';

interface RakitLockApprovalRequestRowProps {
  request: ApprovalRequest;
  isOwner: boolean;
  disabled: boolean;
  onApprove: (id: number) => void | Promise<void>;
  onReject: (id: number, reason?: string) => void | Promise<void>;
}

function formatRp(n: number): string {
  return 'Rp ' + n.toLocaleString('id-ID');
}

export default function RakitLockApprovalRequestRow({
  request,
  isOwner,
  disabled,
  onApprove,
  onReject,
}: RakitLockApprovalRequestRowProps) {
  const [snapshot, setSnapshot] = useState<RakitLockRequest | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);

  useEffect(() => {
    void fetchRakitLockRequestByApprovalId(request.id).then(setSnapshot);
  }, [request.id]);

  const lines = snapshot?.linesSnapshot ?? [];
  const totalFinal = lines.reduce((s: number, l: any) => s + Number(l.final_price ?? 0), 0);
  const totalHpp = lines.reduce((s: number, l: any) => {
    const compsHpp = (l.components ?? []).reduce((cs: number, c: any) => cs + Number(c.fifo_cost ?? 0) * Number(c.qty ?? 0), 0);
    return s + compsHpp + Number(l.labor_cost ?? l.lump_sum_hpp ?? 0);
  }, 0);
  const margin = totalFinal - totalHpp;
  const marginPct = totalFinal > 0 ? (margin / totalFinal) * 100 : 0;
  const marginWarn = marginPct < 10;

  const showActions = isOwner && request.status === 'pending';

  const doApprove = async () => {
    if (disabled || busy) return;
    setBusy('approve');
    try { await onApprove(request.id); } finally { setBusy(null); }
  };
  const doReject = async () => {
    if (disabled || busy) return;
    setBusy('reject');
    try { await onReject(request.id); } finally { setBusy(null); }
  };

  return (
    <div className="rounded-2xl border border-orange-200 bg-orange-50/30 p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-2xl bg-orange-100 text-orange-700 flex items-center justify-center text-base flex-shrink-0">🛠</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="inline-block rounded-full bg-orange-200 text-orange-800 text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5">
              Rakit Lock
            </span>
            <span className="text-xs font-bold text-[#012749]">{request.requestedBy.slice(0, 8)}…</span>
            <span className="ml-auto text-xs text-slate-500">{new Date(request.requestedAt).toLocaleString('id-ID')}</span>
          </div>
          {!snapshot ? (
            <p className="text-xs italic text-slate-500">Memuat snapshot…</p>
          ) : (
            <>
              <p className="text-sm text-slate-800">
                {lines.length} line · {lines.map((l: any) => l.description).join(' · ')}
              </p>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className="text-[12px]">Final: <strong>{formatRp(totalFinal)}</strong></span>
                <span className="text-[12px]">HPP: <strong>{formatRp(totalHpp)}</strong></span>
                <span className={`text-[12px] font-bold ${marginWarn ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {marginWarn ? '⚠ ' : ''}Margin: {formatRp(margin)} ({marginPct.toFixed(1)}%)
                </span>
                <button type="button" onClick={() => setExpanded(s => !s)} className="ml-auto text-[11px] underline text-slate-500 hover:text-slate-700">
                  {expanded ? 'Tutup detail' : 'Lihat detail komponen'}
                </button>
              </div>
              {expanded && (
                <div className="mt-2 bg-white border border-slate-200 rounded-lg p-2 text-[12px] space-y-1">
                  {lines.map((l: any, idx: number) => (
                    <div key={idx} className="border-b last:border-b-0 border-slate-100 pb-1">
                      <div className="font-bold">{l.description} — {formatRp(Number(l.final_price ?? 0))}</div>
                      {(l.components ?? []).length > 0 ? (
                        <ul className="ml-3 text-slate-600">
                          {(l.components ?? []).map((c: any, ci: number) => (
                            <li key={ci}>
                              {c.sku} {c.name} — qty {c.qty} {c.warehouse} @ FIFO {formatRp(Number(c.fifo_cost ?? 0))}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="ml-3 text-slate-500 italic">Lumpsum HPP: {formatRp(Number(l.lump_sum_hpp ?? 0))}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {showActions && (
            <div className="flex items-center justify-end gap-2 mt-3">
              <button type="button" onClick={doReject} disabled={disabled || !!busy} className="px-4 py-1.5 rounded-full border border-rose-200 bg-rose-50 text-rose-700 text-xs font-extrabold hover:bg-rose-100 disabled:opacity-50">
                {busy === 'reject' ? 'Menolak…' : 'Tolak'}
              </button>
              <button type="button" onClick={doApprove} disabled={disabled || !!busy} className="px-4 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-extrabold hover:bg-emerald-700 disabled:opacity-50">
                {busy === 'approve' ? 'Menyetujui…' : 'Setujui'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/approval/RakitLockApprovalRequestRow.tsx
git commit -m "feat(approval): RakitLockApprovalRequestRow renderer with margin badge"
```

---

## Task 4.3: Hook `RakitLockApprovalRequestRow` into `ApprovalInboxScreen` + wire approve handler

**Files:**
- Modify: `src/components/approval/ApprovalInboxScreen.tsx`

- [ ] **Step 1: Branch the row render**

In the JSX where `filtered.map(r => <ApprovalRequestRow … />)` is rendered, switch on `r.requestType`:

```tsx
{filtered.map(r => (
  <div key={r.id}>
    {r.requestType === 'rakit_lock' ? (
      <RakitLockApprovalRequestRow
        request={r}
        isOwner={isOwner}
        disabled={busyId !== null && busyId !== r.id}
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
      />
    )}
  </div>
))}
```

Add the import at the top:

```typescript
import RakitLockApprovalRequestRow from './RakitLockApprovalRequestRow';
import { commitApprovedRakitLock } from '../../lib/supabaseClient';
```

- [ ] **Step 2: Extend `handleApprove` switch to call `commitApprovedRakitLock` for `rakit_lock` type**

```typescript
const handleApprove = async (id: number) => {
  const req = requests.find(r => r.id === id);
  if (!req) return;
  setBusyId(id);
  try {
    switch (req.requestType) {
      case 'adjustment':
        await commitApprovedAdjustment(id);
        break;
      case 'price_change':
        await commitApprovedPriceChange(id);
        break;
      case 'opname':
        await commitOpname(id);
        break;
      case 'rakit_lock':
        await approveRakitLock(id);
        break;
      case 'kasir_price_override':
      case 'kasir_void':
      case 'kasir_refund':
        showToast('Persetujuan kasir belum tersedia (Fase 3b)', 'info');
        return;
      default:
        showToast('Tipe permintaan tidak dikenali', 'warning');
        return;
    }
    showToast('Permintaan disetujui', 'success');
    await refresh();
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Gagal menyetujui', 'warning');
  } finally {
    setBusyId(null);
  }
};
```

Note: the existing approval flow needs to call `approval_requests.status='approved'` BEFORE `commitApprovedRakitLock`. Look at `commitApprovedAdjustment` to see the pattern — typically it's the Phase 2 `_transition_approval` helper + commit RPC combined. For `rakit_lock`, the `commit_approved_rakit_lock` RPC expects `approval_requests.status='approved'` already. So you may need to call a separate `transition_approval` RPC first, OR `commit_approved_rakit_lock` could do both in a single transaction. Check the existing pattern.

If a separate transition is needed, add a helper in `supabaseClient.ts`:

```typescript
export async function approveRakitLockEndToEnd(approvalId: number): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  // 1. Transition approval to 'approved' (Phase 2 _transition_approval is private,
  //    so we use the public approve flow — adjustment uses the commit RPC which
  //    transitions internally; rakit_lock requires explicit transition first)
  const { error: e1 } = await supabase
    .from('approval_requests')
    .update({ status: 'approved', decided_at: new Date().toISOString() })
    .eq('id', approvalId)
    .eq('status', 'pending');
  if (e1) throw e1;
  // 2. Commit
  const { error: e2 } = await supabase.rpc('commit_approved_rakit_lock', { p_approval_id: approvalId });
  if (e2) throw e2;
}
```

**Caveat**: this only works if the `approval_requests` table allows authenticated UPDATE (it does NOT in the Phase 2 design — UPDATE is REVOKEd). So this approach won't work directly. **You'll need to add a SECURITY DEFINER RPC `approve_rakit_lock(p_approval_id)` to the migration 0010** that does both steps atomically. Add to migration 0010:

```sql
CREATE OR REPLACE FUNCTION public.approve_rakit_lock(p_approval_id BIGINT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._transition_approval(p_approval_id, 'approved', auth.uid(), 'inbox');
  PERFORM public.commit_approved_rakit_lock(p_approval_id);
END $$;
GRANT EXECUTE ON FUNCTION public.approve_rakit_lock(BIGINT) TO authenticated;
```

**Action item:** Go back to Task 0.1, add this RPC to migration 0010, re-apply (or write migration 0011 with just this RPC). Then in `supabaseClient.ts`, replace `commitApprovedRakitLock` with a wrapper that calls `approve_rakit_lock(p_approval_id)` instead.

- [ ] **Step 3: End-to-end happy-path test**

  1. Admin: Catat Penjualan → add 1 komponen + 1 jasa rakit → save WIP
  2. Admin: WIP list → click Selesaikan Rakit → fill components + final price → submit
  3. Verify: `kasir_transactions.status = PENDING_LOCK_APPROVAL`, new `approval_requests` row pending, new `rakit_lock_requests` row pending_approval
  4. Owner: Persetujuan → click Rakit Lock filter pill → see the new approval → click Setujui
  5. Verify: `approval_requests.status=approved`, `rakit_lock_requests.status=approved` with `committed_at` set, `kasir_transactions.status=AWAITING_LUNAS` (or PAID if dp >= total), `stock_movements` rows inserted with source=`rakit_usage`, `stocks` decremented

- [ ] **Step 4: Commit**

```bash
git add src/components/approval/ApprovalInboxScreen.tsx src/lib/supabaseClient.ts
git commit -m "feat(approval): hook rakit_lock approve into Persetujuan inbox"
```

---

## Self-Review

After writing the plan, I re-scanned it:

1. **Spec coverage** — Phase 0 (migration), Phase 1 (cart UI), Phase 2 (WIP list), Phase 3 (lock modal), Phase 4 (approval inbox extension). All four scoped phases mapped to tasks.

2. **Placeholder scan** — Task 3.1 has a `TODO(session 1)` comment in the scaffold and Task 3.2 fills it. Acceptable since Task 3.2 is the immediate next task that completes the scaffold. Task 4.3 has an action-item callback to Task 0.1 (add `approve_rakit_lock` RPC) — this is a real dependency, not a placeholder; the migration revision must include this RPC.

3. **Type consistency** — `RakitJobLine`, `RakitComponent`, `RakitLockRequest` types defined in Task 0.2, consumed by Tasks 0.3, 2.1, 2.2, 3.1, 4.2. Field names match snake_case in the DB vs camelCase in TS — wrappers convert (Task 0.3).

4. **Resolved**: The migration SQL (Task 0.1, section 12b) and the `approveRakitLock` wrapper (Task 0.3) and the inbox switch case (Task 4.3) all consistently use `approve_rakit_lock` as the single SECURITY DEFINER entry point that combines `_transition_approval('approved')` + `commit_approved_rakit_lock`.

The dependency chain is:
```
Task 0.1 (migration) → Task 0.2 (types) → Task 0.3 (client wrappers)
                                              ↓
Task 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → Task 2.1 (stub) → 2.3 (route)
                                              ↓
Task 3.1 (modal scaffold) → 3.2 (fill UI) → re-enable in 2.1
                                              ↓
Task 4.1 (filter pill) → 4.2 (row renderer) → 4.3 (wire approve)
```

---

## Risks and unknowns

- **`_transition_approval` helper signature**: The migration assumes `public._transition_approval(approval_id BIGINT, new_status TEXT, actor UUID, channel TEXT)` exists from Phase 2. If the signature differs (e.g. different arg order or no channel arg), the `withdraw_rakit_lock` and `approve_rakit_lock` RPCs will fail at apply time. **Verify before applying** via: `\df+ public._transition_approval` in psql. If absent or different, port the gate transition logic inline.
- **Stock FIFO cost source**: The Lock Modal needs FIFO cost per komponen at add-time. Phase 1's `_log_stock_movement` is the writer-side helper, but there is no read-side FIFO peek RPC for the frontend. Session 1 falls back to `stocks.harga_modal` as a coarse proxy. A proper FIFO peek RPC (`peek_fifo_cost(p_sku, p_warehouse, p_qty)`) is a session-2 follow-up.
- **`approval_requests.decided_by` for owner**: When `_transition_approval` records the approver's user id, that becomes the `actor_user_id` in the stock_movements rows written by `commit_approved_rakit_lock`. This couples the audit trail to whoever clicks the Setujui button — confirm this is the intended attribution.
- **Mockup tab "🔄 Reset" is for the mockup only**: The real app does not have a global reset button. Mockup is for visualizing flow, not for behavior reference.
