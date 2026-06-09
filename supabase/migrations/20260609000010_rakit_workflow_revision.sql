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
--    Actual signatures from migration 0009 all carry a trailing p_actor_role TEXT arg.
-- =====================================================================
DROP FUNCTION IF EXISTS public._rakit_audit(UUID, UUID, TEXT, TEXT, JSONB, JSONB, TEXT, UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.submit_rakit_lock(UUID, JSONB, UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.approve_rakit_lock(UUID, JSONB, UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.reject_rakit_lock(UUID, TEXT, UUID, TEXT) CASCADE;
-- Also try the 3-arg variants in case they differ on a fresh DB
DROP FUNCTION IF EXISTS public.submit_rakit_lock(UUID, JSONB, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.approve_rakit_lock(UUID, JSONB, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.reject_rakit_lock(UUID, TEXT, UUID) CASCADE;
DROP FUNCTION IF EXISTS public._rakit_audit(UUID, TEXT, JSONB, UUID) CASCADE;
-- Drop withdraw/cancel/material_edit so we can recreate with new signatures
DROP FUNCTION IF EXISTS public.withdraw_rakit_lock(UUID, UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.withdraw_rakit_lock(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.cancel_rakit(UUID, NUMERIC, TEXT, UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.cancel_rakit(UUID, NUMERIC, TEXT, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.material_edit_rakit(UUID, JSONB, UUID, TEXT) CASCADE;
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
