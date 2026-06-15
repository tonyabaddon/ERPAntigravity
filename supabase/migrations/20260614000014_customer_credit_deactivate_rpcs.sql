-- supabase/migrations/20260614000014_customer_credit_deactivate_rpcs.sql
-- Phase 1A: request + approve for deactivating tempo on a customer.
-- Deactivation does NOT touch existing open INVOICE_TEMPO orders — those
-- remain open until paid or written off. Deactivation only blocks NEW
-- tempo invoices going forward.

CREATE OR REPLACE FUNCTION public.request_customer_credit_deactivate(
  p_customer_id   text,
  p_reason        text,
  p_actor_user_id uuid DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id bigint;
  v_actor uuid := COALESCE(p_actor_user_id, auth.uid(),
    '00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND allows_tempo = true) THEN
    RAISE EXCEPTION 'customer_not_activated' USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(length(p_reason), 0) < 5 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.approval_requests (
    request_type, payload, requested_by
  ) VALUES (
    'customer_credit_deactivate',
    jsonb_build_object('customer_id', p_customer_id, 'reason', p_reason),
    v_actor
  )
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_customer_credit_deactivate(text, text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.approve_customer_credit_deactivate(
  p_request_id bigint,
  p_owner_pin  text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
  v_type public.approval_request_type;
  v_status public.approval_status;
  v_customer_id text;
BEGIN
  SELECT request_type, status, payload INTO v_type, v_status, v_payload
    FROM public.approval_requests
    WHERE id = p_request_id;

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_type <> 'customer_credit_deactivate' THEN
    RAISE EXCEPTION 'wrong_request_type: % (expected customer_credit_deactivate)', v_type
      USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'request_not_pending' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.verify_owner_pin(p_request_id, p_owner_pin) THEN
    RAISE EXCEPTION 'pin_invalid' USING ERRCODE = 'P0001';
  END IF;

  v_customer_id := v_payload->>'customer_id';

  PERFORM 1 FROM public.customers WHERE id = v_customer_id FOR UPDATE;

  UPDATE public.customers
     SET allows_tempo = false
   WHERE id = v_customer_id;
  -- intentionally NOT resetting term_days/credit_limit — re-activation
  -- starts from a fresh request so these last-known values stay as audit.
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_customer_credit_deactivate(bigint, text) TO anon, authenticated;
