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
