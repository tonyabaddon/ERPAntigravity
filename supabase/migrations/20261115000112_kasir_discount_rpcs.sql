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

-- =========================================================
-- Part B (rev 2): request_kasir_discount_approval
-- =========================================================
-- Design pivot per spec §3.2 rev 2: NO p_sale_draft_id.
-- Sale data stays in browser during approval. On approve, frontend calls
-- existing record_kasir_sale + link_kasir_sale_to_approval (Task 4 REDO).
-- expires_at inherits DB default (now() + 30 min); admin can cancel via
-- cancel_kasir_discount_request (Task 5).

CREATE OR REPLACE FUNCTION public.request_kasir_discount_approval(
  p_discount_amount_rp NUMERIC,
  p_discount_type      TEXT,
  p_discount_value     NUMERIC,
  p_subtotal_rp        NUMERIC,
  p_reason             TEXT
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant       UUID;
  v_user_id      UUID;
  v_gate         JSONB;
  v_settings     RECORD;
  v_caller_role  TEXT;
  v_req_id       BIGINT;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_user_id := public._current_user_id();
  IF v_user_id IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- Re-check gate server-side (defense against setting change mid-flow)
  v_gate := public.check_kasir_discount_gate(p_discount_amount_rp, p_subtotal_rp);
  IF NOT (v_gate->>'gate_triggered')::BOOLEAN THEN
    RAISE EXCEPTION 'gate not triggered — should not request approval';
  END IF;

  SELECT * INTO v_settings FROM public.approval_settings
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no approval_settings row for kasir_discount in tenant';
  END IF;

  -- Reason validation
  IF v_settings.reason_required THEN
    IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
      RAISE EXCEPTION 'reason required (min 3 chars)';
    END IF;
  END IF;

  -- Bypass self: caller with approver role → auto-approve, no request row
  IF v_settings.requestor_bypass_self THEN
    SELECT role INTO v_caller_role FROM public.admin_users WHERE id = v_user_id;
    IF v_caller_role = v_settings.approver_role THEN
      RETURN -1;
    END IF;
  END IF;

  -- Insert approval request (expires_at inherits DB default)
  INSERT INTO public.approval_requests (
    tenant_id, request_type, payload,
    requested_by, requested_at, status
  ) VALUES (
    v_tenant, 'kasir_discount',
    jsonb_build_object(
      'discount_type', p_discount_type,
      'discount_value', p_discount_value,
      'discount_amount_rp', p_discount_amount_rp,
      'subtotal_rp', p_subtotal_rp,
      'reason', p_reason,
      'admin_user_id', v_user_id,
      'trigger_reason', v_gate->>'trigger_reason'
    ),
    v_user_id, now(), 'pending'
  ) RETURNING id INTO v_req_id;

  RETURN v_req_id;
END $$;

ALTER FUNCTION public.request_kasir_discount_approval(NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.request_kasir_discount_approval(NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_kasir_discount_approval(NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT) TO authenticated;
