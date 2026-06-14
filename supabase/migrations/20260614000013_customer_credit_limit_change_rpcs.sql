-- supabase/migrations/20260614000013_customer_credit_limit_change_rpcs.sql
-- Phase 1A: request + approve for changing credit_limit on an already-activated customer.

CREATE OR REPLACE FUNCTION public.request_customer_credit_limit_change(
  p_customer_id   text,
  p_new_limit     numeric,
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

  IF p_new_limit <= 0 THEN
    RAISE EXCEPTION 'credit_limit_must_be_positive' USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(length(p_reason), 0) < 5 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.approval_requests (
    request_type, payload, requested_by
  ) VALUES (
    'customer_credit_limit_change',
    jsonb_build_object(
      'customer_id', p_customer_id,
      'new_limit',   p_new_limit,
      'reason',      p_reason
    ),
    v_actor
  )
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_customer_credit_limit_change(text, numeric, text, uuid)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.approve_customer_credit_limit_change(
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
  v_new_limit numeric;
BEGIN
  SELECT request_type, status, payload INTO v_type, v_status, v_payload
    FROM public.approval_requests
    WHERE id = p_request_id;

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_type <> 'customer_credit_limit_change' THEN
    RAISE EXCEPTION 'wrong_request_type: % (expected customer_credit_limit_change)', v_type
      USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'request_not_pending' USING ERRCODE = 'P0001';
  END IF;

  -- verify_owner_pin handles both PIN check and _transition_approval call.
  IF NOT public.verify_owner_pin(p_request_id, p_owner_pin) THEN
    RAISE EXCEPTION 'pin_invalid' USING ERRCODE = 'P0001';
  END IF;

  v_customer_id := v_payload->>'customer_id';
  v_new_limit   := (v_payload->>'new_limit')::numeric;

  PERFORM 1 FROM public.customers WHERE id = v_customer_id FOR UPDATE;

  UPDATE public.customers
     SET credit_limit = v_new_limit
   WHERE id = v_customer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_customer_credit_limit_change(bigint, text)
  TO anon, authenticated;
