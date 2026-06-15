-- supabase/migrations/20260614000012_customer_credit_activate_rpcs.sql
-- Phase 1A: request + approve RPCs for activating tempo on a customer.
-- Pattern mirrors request_adjustment / approve_adjustment from
-- 20260607000009 / 20260607000010.

-- ── request: admin (or anyone with permission) inserts an approval_requests row.
CREATE OR REPLACE FUNCTION public.request_customer_credit_activate(
  p_customer_id    text,
  p_term_days      int,
  p_credit_limit   numeric,
  p_reason         text DEFAULT NULL,
  p_actor_user_id  uuid DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public._resolve_tenant_id();
  v_allowed int[];
  v_request_id bigint;
  v_actor uuid;
BEGIN
  -- Actor resolution follows the project convention from request_adjustment
  -- (20260607000009): explicit arg → auth.uid() → system sentinel UUID.
  v_actor := COALESCE(p_actor_user_id, auth.uid(),
    '00000000-0000-0000-0000-000000000000'::uuid);

  -- Validate customer exists
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Validate term_days against tenant's allowed list
  SELECT term_days_allowed INTO v_allowed
    FROM public.piutang_settings
    WHERE tenant_id = v_tenant;
  IF v_allowed IS NULL THEN
    -- Defensive: sentinel row missing. Fall back to project-wide default.
    v_allowed := ARRAY[7, 14, 30, 60, 90];
  END IF;
  IF NOT (p_term_days = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'term_days_not_allowed: % (allowed: %)', p_term_days, v_allowed
      USING ERRCODE = 'P0001';
  END IF;

  IF p_credit_limit <= 0 THEN
    RAISE EXCEPTION 'credit_limit_must_be_positive' USING ERRCODE = 'P0001';
  END IF;

  -- Block if customer is already activated (deactivate first to re-issue).
  IF EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND allows_tempo = true) THEN
    RAISE EXCEPTION 'customer_already_activated' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.approval_requests (
    request_type, payload, requested_by
  ) VALUES (
    'customer_credit_activate',
    jsonb_build_object(
      'customer_id', p_customer_id,
      'term_days',   p_term_days,
      'credit_limit', p_credit_limit,
      'reason',      p_reason
    ),
    v_actor
  )
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_customer_credit_activate(text, int, numeric, text, uuid)
  TO anon, authenticated;

-- ── approve: owner enters PIN; verify_owner_pin handles both PIN check + approval transition.
CREATE OR REPLACE FUNCTION public.approve_customer_credit_activate(
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
  v_owner_id uuid;
  v_customer_id text;
  v_term_days int;
  v_credit_limit numeric;
BEGIN
  -- 1. Read payload + type BEFORE PIN check (we need payload after the
  -- helper flips the row to 'approved'; reading by id is allowed even when
  -- status != pending).
  SELECT request_type, status, payload INTO v_type, v_status, v_payload
    FROM public.approval_requests
    WHERE id = p_request_id;

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Type guard: prevent caller from passing an approval_id of a different
  -- request_type (e.g. an adjustment id) to this RPC and tricking it into
  -- applying customer credit changes from a foreign payload.
  IF v_type <> 'customer_credit_activate' THEN
    RAISE EXCEPTION 'wrong_request_type: % (expected customer_credit_activate)', v_type
      USING ERRCODE = 'P0001';
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'request_not_pending' USING ERRCODE = 'P0001';
  END IF;

  -- 3. PIN verification. verify_owner_pin both validates the PIN and (on
  -- success) atomically calls _transition_approval(.., 'approved', owner_id,
  -- 'owner_pin'). It RETURNS FALSE on PIN mismatch (does NOT raise) and
  -- RAISES on lockout / missing-owner / row-not-pending. See
  -- 20260607000019_verify_owner_pin.sql.
  IF NOT public.verify_owner_pin(p_request_id, p_owner_pin) THEN
    RAISE EXCEPTION 'pin_invalid' USING ERRCODE = 'P0001';
  END IF;

  -- 4. Extract payload fields and apply mutation under a row lock.
  v_customer_id  := v_payload->>'customer_id';
  v_term_days    := (v_payload->>'term_days')::int;
  v_credit_limit := (v_payload->>'credit_limit')::numeric;

  -- Determine the Owner uuid so we can attribute the customer write to them
  -- (matches who actually approved, not the admin who requested).
  SELECT id INTO v_owner_id
    FROM public.admin_users
    WHERE role = 'Owner'
    ORDER BY id
    LIMIT 1;

  PERFORM 1 FROM public.customers WHERE id = v_customer_id FOR UPDATE;

  UPDATE public.customers
     SET allows_tempo       = true,
         term_days          = v_term_days,
         credit_limit       = v_credit_limit,
         tempo_activated_at = now(),
         tempo_activated_by = v_owner_id
   WHERE id = v_customer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_customer_credit_activate(bigint, text)
  TO anon, authenticated;
