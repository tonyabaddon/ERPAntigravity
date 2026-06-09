-- 20260609000011_rakit_workflow_fixes.sql
-- Two fixes to 0010 surfaced by code review:
--   C1: Add reject_rakit_lock RPC (owner-reject from Persetujuan inbox)
--       Without this, clicking Tolak left the transaction permanently stuck in
--       PENDING_LOCK_APPROVAL with no recovery path.
--   C2: Add 'superseded' to rakit_lock_requests.status CHECK + mark prior row
--       superseded in material_edit_rakit to prevent double-reversal on a
--       second material_edit call on the same transaction.

BEGIN;

-- =====================================================================
-- C2.a: Replace CHECK constraint to allow 'superseded'
-- =====================================================================
ALTER TABLE public.rakit_lock_requests DROP CONSTRAINT IF EXISTS rakit_lock_requests_status_check;
ALTER TABLE public.rakit_lock_requests ADD CONSTRAINT rakit_lock_requests_status_check
  CHECK (status IN ('pending_approval','approved','rejected','expired','withdrawn','superseded'));

-- =====================================================================
-- C1: Create reject_rakit_lock RPC
--     Owner clicks "Tolak" in Persetujuan inbox.
--     Mirrors withdraw_rakit_lock but uses channel='owner_reject' and
--     resets transaction to WIP so admin can re-submit.
--
--     _transition_approval signature confirmed:
--       (p_id BIGINT, p_new_status approval_status, p_decided_by UUID, p_channel TEXT)
--     It does NOT accept a reason/note arg, so the reject reason is stored
--     in approval_requests.payload via the UPDATE below.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.reject_rakit_lock(
  p_approval_id    BIGINT,
  p_reason         TEXT,
  p_actor_user_id  UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_actor UUID;
  v_ar    RECORD;
  v_rr    RECORD;
BEGIN
  v_actor := COALESCE(p_actor_user_id, auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);

  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reject_rakit_lock: reason required';
  END IF;

  SELECT * INTO v_ar FROM approval_requests WHERE id = p_approval_id FOR UPDATE;
  IF v_ar.status != 'pending' THEN
    RAISE EXCEPTION 'reject_rakit_lock: approval % is %, expected pending', p_approval_id, v_ar.status;
  END IF;
  IF v_ar.request_type != 'rakit_lock' THEN
    RAISE EXCEPTION 'reject_rakit_lock: approval % type is %, expected rakit_lock', p_approval_id, v_ar.request_type;
  END IF;

  SELECT * INTO v_rr FROM rakit_lock_requests WHERE approval_request_id = p_approval_id FOR UPDATE;

  -- Transition the approval row (sets status='rejected', decided_by, decided_at, decision_channel)
  PERFORM public._transition_approval(p_approval_id, 'rejected', v_actor, 'owner_reject');

  -- Store the reject reason in payload since _transition_approval has no reason/note arg
  UPDATE approval_requests
     SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('reject_reason', p_reason)
   WHERE id = p_approval_id;

  -- Mark satellite row + reset transaction so admin can re-submit
  UPDATE rakit_lock_requests SET status = 'rejected'  WHERE id = v_rr.id;
  UPDATE kasir_transactions  SET status = 'WIP'        WHERE id = v_rr.transaction_id;
END $$;
GRANT EXECUTE ON FUNCTION public.reject_rakit_lock(BIGINT, TEXT, UUID) TO authenticated;

-- =====================================================================
-- C2.b: Rewrite material_edit_rakit to mark prior row superseded
--       Adds: UPDATE rakit_lock_requests SET status = 'superseded'
--       after the stock reversal loop and before the new INSERT.
--       Also adds FOR UPDATE on the prior_rr SELECT for safety.
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
  LIMIT 1
  FOR UPDATE;

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

  -- C2 fix: mark the prior rakit_lock_request as superseded so future
  -- material_edit calls don't re-pick it as the "latest approved" prior row
  -- (query filters status = 'approved', so superseded rows are invisible to it)
  UPDATE rakit_lock_requests SET status = 'superseded' WHERE id = v_prior_rr.id;

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

COMMIT;
