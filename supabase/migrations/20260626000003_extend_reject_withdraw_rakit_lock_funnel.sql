-- 20260626000003_extend_reject_withdraw_rakit_lock_funnel.sql
-- Phase 1B follow-up: keeps Sales funnel position in sync on the two
-- "walk-back to 3f" paths.
--
-- reject_rakit_lock  : Owner rejects from inbox → funnel resets to 3f.
--                       Also adds audit_log entry (per PR #25 precedent:
--                       no untracked mutations on Owner decisions).
-- withdraw_rakit_lock: Admin withdraws own pending request → funnel resets to 3f.
--
-- Source bodies copied byte-for-byte from:
--   reject_rakit_lock   → 20260609000011_rakit_workflow_fixes.sql
--   withdraw_rakit_lock → 20260609000010_rakit_workflow_revision.sql
-- Only changes are the appended INSERT/UPDATE blocks before END.

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

  -- Phase 1B integration: audit log first (per precedent), then funnel walk-back.
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

  UPDATE public.kasir_transactions
     SET funnel_sub_stage = '3f'
   WHERE id = v_rr.transaction_id;
END $$;
GRANT EXECUTE ON FUNCTION public.reject_rakit_lock(BIGINT, TEXT, UUID) TO authenticated;

COMMENT ON FUNCTION public.reject_rakit_lock(BIGINT, TEXT, UUID) IS
  'Owner rejects rakit_lock approval. Logs to audit_log and resets funnel to 3f for admin revision.';

-- ---------------------------------------------------------------------

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

  -- Phase 1B integration: walk funnel back to 3f on admin withdraw.
  UPDATE public.kasir_transactions
     SET funnel_sub_stage = '3f'
   WHERE id = v_rr.transaction_id;
END $$;
GRANT EXECUTE ON FUNCTION public.withdraw_rakit_lock(BIGINT, UUID) TO authenticated;

COMMENT ON FUNCTION public.withdraw_rakit_lock(BIGINT, UUID) IS
  'Admin withdraws own pending rakit_lock approval. Resets Sales funnel to 3f.';
