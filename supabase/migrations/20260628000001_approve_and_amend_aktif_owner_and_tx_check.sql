-- 20260628000001_approve_and_amend_aktif_owner_and_tx_check.sql
--
-- Two correctness gaps in `approve_and_amend_rakit_lock`, both flagged by
-- the post-PR-#28 review.
--
-- 1) AKTIF OWNER ONLY. Migration 20260626000006 explicitly dropped the
--    `status='active'` check (the value was wrong — Indonesian convention is
--    'Aktif') and deferred the hardening to a "cross-cutting fix". PR #34
--    (20260626000010) landed that cross-cutting fix for `verify_owner_pin`
--    but did NOT propagate it to this RPC. Result: a deactivated Owner
--    (status='Tidak Aktif') can still Edit-and-Approve a rakit lock; stock
--    movements + HPP locks get attributed to a disabled account.
--
--    Fix mirrors PR #34: resolve the caller via auth.uid -> auth.users.email
--    -> admin_users(email, role='Owner', status='Aktif'). The previous
--    `admin_users.id = auth.uid()` lookup also had a latent bug — per the
--    PR #34 migration comment, admin_users.id is NOT the auth uid for every
--    Owner (Jenny's row was provisioned without id-match), so id-based
--    lookup locked her out. Email is the only invariant across Owners.
--
-- 2) PER-ORDER LINE GUARD. The amend loop did
--      UPDATE rakit_job_lines WHERE id = v_line_id
--    without constraining to the target order. A malicious client could
--    submit p_amended_lines with line UUIDs from a different order and the
--    RPC would happily update them. We now require
--    `transaction_id = v_rr.transaction_id` and raise if the line is not
--    found (zero rows updated).
--
-- Same SECURITY DEFINER / SET search_path discipline as before. No public
-- grant changes.

CREATE OR REPLACE FUNCTION public.approve_and_amend_rakit_lock(
  p_approval_id    BIGINT,
  p_amended_lines  JSONB
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_caller        UUID;
  v_caller_email  TEXT;
  v_owner_id      UUID;
  v_owner_count   INT;
  v_ar            RECORD;
  v_rr            RECORD;
  v_admin_snap    JSONB;
  v_owner_snap    JSONB;
  v_diff_keys     TEXT[];
  v_first_line    JSONB;
  v_line          JSONB;
  v_line_id       UUID;
  v_comp          JSONB;
  v_rows_updated  INT;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'OWNER_ONLY: no authenticated user';
  END IF;

  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller;
  IF v_caller_email IS NULL OR v_caller_email = '' THEN
    RAISE EXCEPTION 'OWNER_ONLY: caller has no auth email';
  END IF;

  -- Aktif Owner gate (mirrors verify_owner_pin in 20260626000010). Defensive
  -- multiplicity check: zero or > 1 active Owner rows per email are both
  -- failures — duplicates make the resolved row arbitrary.
  SELECT COUNT(*) INTO v_owner_count
    FROM public.admin_users
   WHERE lower(email) = lower(v_caller_email)
     AND role = 'Owner'
     AND status = 'Aktif';
  IF v_owner_count = 0 THEN
    RAISE EXCEPTION 'OWNER_ONLY: caller is not an active Owner';
  ELSIF v_owner_count > 1 THEN
    RAISE EXCEPTION 'OWNER_AMBIGUOUS: % active Owner rows match caller email', v_owner_count;
  END IF;

  SELECT id INTO v_owner_id
    FROM public.admin_users
   WHERE lower(email) = lower(v_caller_email)
     AND role = 'Owner'
     AND status = 'Aktif';

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

  SELECT * INTO v_rr FROM public.rakit_lock_requests WHERE approval_request_id = p_approval_id;
  IF v_rr.id IS NULL THEN
    RAISE EXCEPTION 'RAKIT_LOCK_REQUEST_NOT_FOUND for approval %', p_approval_id;
  END IF;

  v_admin_snap := v_ar.payload;
  v_owner_snap := jsonb_build_object('amended_lines', p_amended_lines);

  -- Best-effort diff_keys from the first line's keys (lines payload is a
  -- JSONB array, so we can't call jsonb_object_keys on it directly).
  v_first_line := jsonb_array_element(p_amended_lines, 0);
  IF v_first_line IS NOT NULL AND jsonb_typeof(v_first_line) = 'object' THEN
    v_diff_keys := ARRAY(SELECT k FROM jsonb_object_keys(v_first_line) k);
  ELSE
    v_diff_keys := ARRAY[]::TEXT[];
  END IF;

  INSERT INTO public.audit_log(event_type, actor_user_id, payload)
  VALUES (
    'rakit_lock_approved_with_edit',
    v_caller,
    jsonb_build_object(
      'approval_id', p_approval_id,
      'order_id', v_rr.transaction_id,
      'admin_submitted', v_admin_snap,
      'owner_amended', v_owner_snap,
      'diff_keys', v_diff_keys,
      'owner_admin_user_id', v_owner_id
    )
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_amended_lines) LOOP
    v_line_id := (v_line->>'id')::UUID;
    UPDATE public.rakit_job_lines
       SET final_price   = (v_line->>'final_price')::NUMERIC,
           tracking_mode = v_line->>'tracking_mode',
           labor_cost    = COALESCE((v_line->>'labor_cost')::NUMERIC, 0),
           lump_sum_hpp  = COALESCE((v_line->>'lump_sum_hpp')::NUMERIC, 0),
           updated_at    = NOW()
     WHERE id = v_line_id
       AND transaction_id = v_rr.transaction_id;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    IF v_rows_updated = 0 THEN
      RAISE EXCEPTION 'RAKIT_LINE_NOT_IN_ORDER: line % does not belong to order %',
        v_line_id, v_rr.transaction_id;
    END IF;

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

  UPDATE public.approval_requests
     SET status = 'approved',
         decided_by = v_owner_id,
         decided_at = NOW(),
         decision_channel = 'owner_app_edit'
   WHERE id = p_approval_id;

  PERFORM public.commit_approved_rakit_lock(p_approval_id, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_and_amend_rakit_lock(BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_and_amend_rakit_lock(BIGINT, JSONB) TO authenticated;
