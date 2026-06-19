-- 20260626000004_approve_and_amend_rakit_lock.sql
-- Phase 1B follow-up: Owner Edit & Approve in one atomic transaction.
-- The Owner amends rakit_job_lines + rakit_components values then triggers
-- commit_approved_rakit_lock within the same RPC. Server-side Owner role
-- gate via admin_users.role='Owner' AND status='active'.
--
-- No PIN check (deferred). No expiry check (admin can withdraw + resubmit).

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

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
     WHERE id = v_actor
       AND role = 'Owner'
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'OWNER_ONLY: actor % is not an active Owner', v_actor;
  END IF;

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

  SELECT * INTO v_rr FROM public.rakit_lock_requests WHERE approval_id = p_approval_id;
  IF v_rr.id IS NULL THEN
    RAISE EXCEPTION 'RAKIT_LOCK_REQUEST_NOT_FOUND for approval %', p_approval_id;
  END IF;

  v_admin_snap := v_ar.payload;
  v_owner_snap := jsonb_build_object('amended_lines', p_amended_lines);

  v_diff_keys := ARRAY(
    SELECT k FROM jsonb_object_keys(p_amended_lines) k
  );

  -- Audit log FIRST (PR #25 precedent: no untracked mutations).
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

  -- Apply Owner's amendments to rakit_job_lines + replace components atomically.
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_amended_lines) LOOP
    v_line_id := (v_line->>'id')::UUID;
    UPDATE public.rakit_job_lines
       SET final_price   = (v_line->>'final_price')::NUMERIC,
           tracking_mode = v_line->>'tracking_mode',
           labor_cost    = COALESCE((v_line->>'labor_cost')::NUMERIC, 0),
           lump_sum_hpp  = COALESCE((v_line->>'lump_sum_hpp')::NUMERIC, 0),
           updated_at    = NOW()
     WHERE id = v_line_id;

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

  -- Transition approval to 'approved' with the edit channel. Reading the
  -- existing approval_requests UPDATE pattern, the table has REVOKE on
  -- UPDATE — but SECURITY DEFINER functions bypass that; see migration
  -- 20260607000007 header.
  UPDATE public.approval_requests
     SET status = 'approved',
         decided_by = v_actor,
         decided_at = NOW(),
         decision_channel = 'owner_app_edit'
   WHERE id = p_approval_id;

  -- Delegate the commit work (stock_movements, HPP lock, tx.status,
  -- funnel_sub_stage='3h'). commit_approved_rakit_lock requires the
  -- approval row in 'approved' state, which we just set above.
  PERFORM public.commit_approved_rakit_lock(p_approval_id, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_and_amend_rakit_lock(BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_and_amend_rakit_lock(BIGINT, JSONB) TO authenticated;

COMMENT ON FUNCTION public.approve_and_amend_rakit_lock IS
  'Owner edit-then-approve in one atomic transaction. Owner-only via admin_users.role.';
