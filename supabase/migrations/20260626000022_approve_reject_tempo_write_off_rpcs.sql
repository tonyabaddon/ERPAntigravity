-- 20260626000022_approve_reject_tempo_write_off_rpcs.sql
-- Phase 1C task 2 — Owner approves or rejects a pending write-off request.
-- Owner identity bound via auth.uid() + admin_users.role='Owner' AND
-- status='Aktif' (PR #34 lesson: deactivated Owners must not approve,
-- audit attribution must reflect the actual caller).
--
-- approve returns a discriminated JSONB result. We DO NOT raise on the race
-- branch because PL/pgSQL rolls back all in-function writes when the function
-- raises (subtransaction semantics). Returning a status code keeps the
-- auto-reject + audit writes committed atomically with the race detection.

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
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_caller   UUID;
  v_admin_id UUID;
  v_ar       RECORD;
  v_satellite RECORD;
  v_order    RECORD;
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
  IF v_satellite.approval_id IS NULL THEN
    RAISE EXCEPTION 'SATELLITE_NOT_FOUND for approval %', p_approval_id;
  END IF;

  SELECT id, status, customer_id, total INTO v_order
    FROM public.orders WHERE id = v_satellite.order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: %', v_satellite.order_id;
  END IF;

  -- Race: customer paid between request and approve. Atomically auto-reject
  -- + return a status code; DO NOT raise — raising would roll back the
  -- auto-reject (PL/pgSQL subtransaction semantics).
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
    RETURN jsonb_build_object(
      'status', 'auto_rejected_race',
      'new_order_status', v_order.status::text
    );
  END IF;

  UPDATE public.orders
     SET status = 'INVOICE_WRITTEN_OFF',
         written_off_at = now(),
         written_off_by = v_admin_id,
         write_off_reason = v_satellite.reason
   WHERE id = v_order.id;

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

  RETURN jsonb_build_object('status', 'approved');
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
  'Owner approves a piutang write-off request. Returns JSONB {status:approved} or {status:auto_rejected_race, new_order_status}. Flips order to INVOICE_WRITTEN_OFF on approval.';
COMMENT ON FUNCTION public.reject_tempo_write_off IS
  'Owner rejects a piutang write-off request with a reason. Order untouched.';
