-- 20260626000021_request_tempo_write_off_rpc.sql
-- Phase 1C task 2 — admin requests write-off of a tempo invoice.
-- Caller can be any authenticated user (admin or owner). Validates the order
-- is INVOICE_TEMPO; rejects with prefixed errors so the modal can pattern-match.

CREATE OR REPLACE FUNCTION public.request_tempo_write_off(
  p_order_id UUID,
  p_reason   TEXT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_caller   UUID;
  v_order    RECORD;
  v_approval BIGINT;
  -- Founder explicitly chose no-expiry for write-off approvals. The
  -- approval_requests.expires_at column is NOT NULL with a 30-min default, so
  -- we override here with a far-future value. The periodic expire_approval_requests
  -- job (20260607000020) only flips rows where expires_at <= now(); 9999 keeps
  -- the row alive indefinitely while preserving the NOT NULL invariant.
  v_no_expiry CONSTANT TIMESTAMPTZ := '9999-12-31 23:59:59+00';
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'OWNER_ONLY: no authenticated user';
  END IF;

  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  SELECT id, status, customer_id, total
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: %', p_order_id;
  END IF;
  IF v_order.status <> 'INVOICE_TEMPO' THEN
    RAISE EXCEPTION 'ORDER_NOT_TEMPO: cannot write off status=%', v_order.status;
  END IF;

  INSERT INTO public.approval_requests
    (request_type, payload, requested_by, expires_at)
  VALUES
    ('piutang_write_off'::public.approval_request_type,
     jsonb_build_object('order_id', p_order_id::text),
     v_caller,
     v_no_expiry)
  RETURNING id INTO v_approval;

  BEGIN
    INSERT INTO public.piutang_write_off_requests
      (approval_id, order_id, reason)
    VALUES (v_approval, p_order_id, btrim(p_reason));
  EXCEPTION WHEN unique_violation THEN
    -- Trigger guard hit — another pending request already exists.
    -- Surface a typed prefix the client can match.
    RAISE EXCEPTION 'WRITE_OFF_ALREADY_PENDING: order=%', p_order_id;
  END;

  INSERT INTO public.audit_log (event_type, actor_user_id, payload)
  VALUES (
    'tempo_write_off_requested',
    v_caller,
    jsonb_build_object(
      'approval_id', v_approval,
      'order_id', p_order_id,
      'customer_id', v_order.customer_id,
      'amount', v_order.total,
      'reason', btrim(p_reason)
    )
  );

  RETURN v_approval;
END $$;

GRANT EXECUTE ON FUNCTION public.request_tempo_write_off(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.request_tempo_write_off IS
  'Phase 1C task 2: admin requests Owner approval to write off an INVOICE_TEMPO order. Returns approval_id.';
