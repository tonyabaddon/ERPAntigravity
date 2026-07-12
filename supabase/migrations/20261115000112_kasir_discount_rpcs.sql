-- Migration: kasir_discount approval RPCs (Item #4, slot 112)
-- Tasks 3-5 will continue appending RPCs to this file.

-- 2A: check_kasir_discount_gate
CREATE OR REPLACE FUNCTION public.check_kasir_discount_gate(
  p_discount_amount_rp NUMERIC,
  p_subtotal_rp        NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant           UUID;
  v_settings         RECORD;
  v_computed_percent NUMERIC;
  v_exceeds_amt      BOOLEAN := false;
  v_exceeds_pct      BOOLEAN := false;
  v_reason           TEXT;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT approval_required, verification_method, threshold_amount, threshold_percent
    INTO v_settings
    FROM public.approval_settings
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';

  -- Missing settings row = fall back to opt-out defaults (safe)
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'gate_triggered', false,
      'trigger_reason', NULL,
      'threshold_amount', NULL,
      'threshold_percent', NULL,
      'approval_required', false,
      'verification_method', 'NONE'
    );
  END IF;

  IF NOT v_settings.approval_required THEN
    RETURN jsonb_build_object(
      'gate_triggered', false,
      'trigger_reason', NULL,
      'threshold_amount', v_settings.threshold_amount,
      'threshold_percent', v_settings.threshold_percent,
      'approval_required', false,
      'verification_method', v_settings.verification_method
    );
  END IF;

  -- Zero-guard: no meaningful discount possible on zero subtotal
  IF p_subtotal_rp <= 0 OR p_discount_amount_rp <= 0 THEN
    RETURN jsonb_build_object(
      'gate_triggered', false,
      'trigger_reason', NULL,
      'threshold_amount', v_settings.threshold_amount,
      'threshold_percent', v_settings.threshold_percent,
      'approval_required', true,
      'verification_method', v_settings.verification_method
    );
  END IF;

  v_computed_percent := p_discount_amount_rp / p_subtotal_rp * 100;

  IF v_settings.threshold_amount IS NOT NULL AND p_discount_amount_rp > v_settings.threshold_amount THEN
    v_exceeds_amt := true;
  END IF;
  IF v_settings.threshold_percent IS NOT NULL AND v_computed_percent > v_settings.threshold_percent THEN
    v_exceeds_pct := true;
  END IF;

  v_reason := CASE
    WHEN v_exceeds_amt AND v_exceeds_pct THEN 'both'
    WHEN v_exceeds_amt THEN 'exceeds_amount'
    WHEN v_exceeds_pct THEN 'exceeds_percent'
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'gate_triggered', (v_exceeds_amt OR v_exceeds_pct),
    'trigger_reason', v_reason,
    'threshold_amount', v_settings.threshold_amount,
    'threshold_percent', v_settings.threshold_percent,
    'approval_required', true,
    'verification_method', v_settings.verification_method
  );
END $$;

ALTER FUNCTION public.check_kasir_discount_gate(NUMERIC, NUMERIC) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.check_kasir_discount_gate(NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_kasir_discount_gate(NUMERIC, NUMERIC) TO authenticated;

-- 2B: request_kasir_discount_approval
-- Schema note: kasir_transactions.id is UUID; spec brief used BIGINT which was stale.
-- Columns: subtotal (not subtotal_rp), total_amount (not total_rp), date (not sold_at).
-- status CHECK does not include 'draft' — caller may pass any valid status row.
CREATE OR REPLACE FUNCTION public.request_kasir_discount_approval(
  p_sale_draft_id      UUID,
  p_discount_amount_rp NUMERIC,
  p_discount_type      TEXT,
  p_discount_value     NUMERIC,
  p_subtotal_rp        NUMERIC,
  p_reason             TEXT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant       UUID;
  v_user_id      UUID;
  v_txn          RECORD;
  v_settings     RECORD;
  v_req_id       BIGINT;
  v_gate_result  JSONB;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_user_id := public._current_user_id();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_txn FROM public.kasir_transactions
   WHERE id = p_sale_draft_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale draft % not found in tenant', p_sale_draft_id; END IF;

  -- Idempotent: existing awaiting approval
  IF v_txn.discount_approval_status = 'awaiting'
     AND v_txn.discount_approval_request_id IS NOT NULL THEN
    RETURN v_txn.discount_approval_request_id;
  END IF;

  -- Re-check gate server-side (protects against setting changes during input)
  v_gate_result := public.check_kasir_discount_gate(p_discount_amount_rp, p_subtotal_rp);
  IF NOT (v_gate_result->>'gate_triggered')::BOOL THEN
    RAISE EXCEPTION 'gate not triggered — should not request approval';
  END IF;

  SELECT * INTO v_settings FROM public.approval_settings
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';

  -- Reason validation
  IF v_settings.reason_required THEN
    IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
      RAISE EXCEPTION 'reason required (min 3 chars)';
    END IF;
  END IF;

  -- Owner bypass self: if requestor_bypass_self=true AND caller has the approver role
  IF v_settings.requestor_bypass_self THEN
    IF EXISTS (SELECT 1 FROM public.admin_users
                WHERE id = v_user_id AND role = v_settings.approver_role) THEN
      -- Bypass: mark auto-approved, no approval_requests row
      UPDATE public.kasir_transactions
         SET discount_approval_status = 'approved',
             discount_type            = p_discount_type,
             discount_value           = p_discount_value,
             discount_amount_rp       = p_discount_amount_rp
       WHERE id = p_sale_draft_id;
      RETURN -1;  -- sentinel: no request created
    END IF;
  END IF;

  -- Insert approval request
  INSERT INTO public.approval_requests (
    tenant_id, request_type, payload,
    requested_by, requested_at, expires_at, status
  ) VALUES (
    v_tenant,
    'kasir_discount',
    jsonb_build_object(
      'sale_draft_id',      p_sale_draft_id,
      'discount_type',      p_discount_type,
      'discount_value',     p_discount_value,
      'discount_amount_rp', p_discount_amount_rp,
      'subtotal_rp',        p_subtotal_rp,
      'reason',             p_reason,
      'admin_user_id',      v_user_id,
      'trigger_reason',     v_gate_result->>'trigger_reason'
    ),
    v_user_id,
    now(),
    now() + interval '100 years',  -- no auto-expire per spec; far-future sentinel satisfies NOT NULL
    'pending'
  ) RETURNING id INTO v_req_id;

  -- Update kasir_transaction to awaiting state
  UPDATE public.kasir_transactions
     SET discount_approval_request_id = v_req_id,
         discount_approval_status     = 'awaiting',
         discount_type                = p_discount_type,
         discount_value               = p_discount_value,
         discount_amount_rp           = p_discount_amount_rp
   WHERE id = p_sale_draft_id;

  RETURN v_req_id;
END $$;

ALTER FUNCTION public.request_kasir_discount_approval(UUID, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.request_kasir_discount_approval(UUID, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_kasir_discount_approval(UUID, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT) TO authenticated;
