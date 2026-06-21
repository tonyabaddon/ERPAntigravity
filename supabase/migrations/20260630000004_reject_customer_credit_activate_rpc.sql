-- 20260630000004_reject_customer_credit_activate_rpc.sql
-- Phase Catat Penjualan wizard prereq. Owner can now reject (not just
-- approve) customer_credit_activate requests. Mirrors the Aktif-Owner
-- auth.uid pattern from PR #34 (verify_owner_pin fix).

CREATE OR REPLACE FUNCTION public.reject_customer_credit_activate(
  p_request_id BIGINT,
  p_reason     TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_caller       UUID;
  v_caller_email TEXT;
  v_admin_id     UUID;
  v_owner_count  INT;
  v_ar           RECORD;
  v_reason       TEXT;
  v_satellite_payload JSONB;
BEGIN
  -- Caller must be Aktif Owner (PR #34 pattern: auth.uid → email → admin_users)
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'OWNER_ONLY: no authenticated user';
  END IF;

  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller;
  IF v_caller_email IS NULL OR v_caller_email = '' THEN
    RAISE EXCEPTION 'OWNER_ONLY: caller has no auth email';
  END IF;

  SELECT COUNT(*) INTO v_owner_count
    FROM public.admin_users
   WHERE lower(email) = lower(v_caller_email)
     AND role = 'Owner'
     AND status = 'Aktif';
  IF v_owner_count = 0 THEN
    RAISE EXCEPTION 'OWNER_ONLY: caller is not an active Owner';
  ELSIF v_owner_count > 1 THEN
    RAISE EXCEPTION 'OWNER_AMBIGUOUS: % active Owner rows', v_owner_count;
  END IF;

  SELECT id INTO v_admin_id
    FROM public.admin_users
   WHERE lower(email) = lower(v_caller_email)
     AND role = 'Owner' AND status = 'Aktif';

  -- Lock + validate approval row
  SELECT * INTO v_ar FROM public.approval_requests
   WHERE id = p_request_id FOR UPDATE;
  IF v_ar.id IS NULL THEN
    RAISE EXCEPTION 'APPROVAL_NOT_FOUND: %', p_request_id;
  END IF;
  IF v_ar.request_type <> 'customer_credit_activate' THEN
    RAISE EXCEPTION 'WRONG_TYPE: id=% type=%', p_request_id, v_ar.request_type;
  END IF;
  IF v_ar.status <> 'pending' THEN
    RAISE EXCEPTION 'APPROVAL_NOT_PENDING: id=% status=%', p_request_id, v_ar.status;
  END IF;

  v_reason := COALESCE(NULLIF(btrim(p_reason), ''), 'no reason given');
  v_satellite_payload := v_ar.payload;

  PERFORM public._transition_approval(
    p_request_id, 'rejected'::public.approval_status, v_admin_id, v_reason
  );

  INSERT INTO public.audit_log (event_type, actor_user_id, payload)
  VALUES (
    'customer_credit_activate_rejected',
    v_caller,
    jsonb_build_object(
      'request_id', p_request_id,
      'reject_reason', v_reason,
      'customer_id', v_satellite_payload->>'customer_id',
      'requested_limit', (v_satellite_payload->>'credit_limit')::numeric,
      'requested_term', (v_satellite_payload->>'term_days')::int
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.reject_customer_credit_activate(BIGINT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.reject_customer_credit_activate IS
  'Owner rejects a pending customer_credit_activate request. Mirrors the Aktif-Owner pattern from PR #34.';
