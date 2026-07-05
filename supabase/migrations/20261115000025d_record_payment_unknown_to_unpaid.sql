BEGIN;

-- ============================================================
-- Phase B Wave 5 — Task 11 fix I2
-- record_payment: return 'UNPAID' (not 'UNKNOWN') when
-- plans.price_annual IS NULL.
--
-- Bug: when a tenant has no subscription / plan with NULL
-- price_annual, record_payment returned coverage_status='UNKNOWN',
-- which is not a member of the CoverageStatus union type
-- (LUNAS | DP_60 | DP_30 | OVERDUE | UNPAID). TypeScript treats
-- this as an unknown string, breaking badge rendering.
--
-- Fix: change the NULL price_annual branch from 'UNKNOWN' to
-- 'UNPAID', aligning with the view's behavior (which returns
-- 'UNPAID' when price_annual=0) and the CoverageStatus union.
--
-- Unlikely in prod (all 3 plans are seeded with price_annual),
-- but defensive for edge cases (deleted plan, orphaned
-- subscription, test tenants with no subscription row).
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_payment(
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_admin_email      text;
  v_unknown_keys     text[];
  v_allowed_keys     text[] := ARRAY[
    'tenant_id', 'amount', 'payment_method', 'payment_date',
    'period_from', 'period_to', 'bank_name', 'ewallet_provider',
    'proof_object_key', 'bank_reference', 'notes'
  ];
  v_tenant_id        uuid;
  v_amount           numeric;
  v_payment_method   text;
  v_payment_date     date;
  v_period_from      date;
  v_period_to        date;
  v_bank_name        text;
  v_ewallet_provider text;
  v_proof_url        text;
  v_bank_reference   text;
  v_notes            text;
  v_audit_id         bigint;
  v_payment_id       uuid;
  v_amount_paid_ytd  numeric;
  v_price_annual     numeric;
  v_coverage_ok      boolean;
  v_coverage_status  text;
BEGIN
  -- ── Gate: platform admin only ─────────────────────────────────────────────
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
  END IF;

  -- ── Validate: key whitelist ───────────────────────────────────────────────
  SELECT ARRAY_AGG(k)
  INTO v_unknown_keys
  FROM jsonb_object_keys(p_payload) AS k
  WHERE k <> ALL(v_allowed_keys);

  IF v_unknown_keys IS NOT NULL AND array_length(v_unknown_keys, 1) > 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'UNKNOWN_FIELD';
  END IF;

  -- ── Extract required fields ───────────────────────────────────────────────
  v_tenant_id        := (p_payload ->>'tenant_id')::uuid;
  v_amount           := (p_payload ->>'amount')::numeric;
  v_payment_method   := p_payload ->>'payment_method';
  v_payment_date     := (p_payload ->>'payment_date')::date;
  v_period_from      := (p_payload ->>'period_from')::date;
  v_period_to        := (p_payload ->>'period_to')::date;
  v_bank_name        := p_payload ->>'bank_name';
  v_ewallet_provider := p_payload ->>'ewallet_provider';
  v_proof_url        := p_payload ->>'proof_object_key';
  v_bank_reference   := p_payload ->>'bank_reference';
  v_notes            := p_payload ->>'notes';

  -- ── Validate: amount > 0 ─────────────────────────────────────────────────
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_AMOUNT';
  END IF;

  -- ── Validate: period_to >= period_from ───────────────────────────────────
  IF v_period_from IS NULL OR v_period_to IS NULL OR v_period_to < v_period_from THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_PERIOD';
  END IF;

  -- ── Validate: tenant exists ───────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_tenant_id) THEN
    RAISE EXCEPTION USING errcode = 'P0404', message = 'TENANT_NOT_FOUND';
  END IF;

  -- ── Resolve admin email ───────────────────────────────────────────────────
  SELECT email INTO v_admin_email
  FROM public.platform_admins
  WHERE user_id = auth.uid();

  -- ── INSERT audit row first; capture id ───────────────────────────────────
  INSERT INTO public.platform_admin_audit
    (admin_user_id, admin_email, tenant_id, action, detail)
  VALUES (
    auth.uid(),
    v_admin_email,
    v_tenant_id,
    'RECORD_PAYMENT',
    p_payload
  )
  RETURNING id INTO v_audit_id;

  -- ── INSERT tenant_payments row ────────────────────────────────────────────
  INSERT INTO public.tenant_payments (
    tenant_id,
    amount,
    payment_method,
    payment_date,
    period_from,
    period_to,
    bank_name,
    ewallet_provider,
    proof_url,
    bank_reference,
    notes,
    recorded_by_admin,
    audit_id
  ) VALUES (
    v_tenant_id,
    v_amount,
    v_payment_method,
    v_payment_date,
    v_period_from,
    v_period_to,
    v_bank_name,
    v_ewallet_provider,
    v_proof_url,
    v_bank_reference,
    v_notes,
    auth.uid(),
    v_audit_id
  )
  RETURNING id INTO v_payment_id;

  -- ── Compute amount_paid_ytd (includes this row — same-txn visibility) ─────
  SELECT COALESCE(SUM(amount), 0)
  INTO v_amount_paid_ytd
  FROM public.tenant_payments
  WHERE tenant_id = v_tenant_id
    AND EXTRACT(year FROM payment_date) = EXTRACT(year FROM CURRENT_DATE);

  -- ── Compute coverage_status from tenant's current plan price_annual ───────
  -- coverage_status formula (spec §15.5):
  --   LUNAS   : amount_paid_ytd >= price_annual
  --   DP_60   : amount_paid_ytd >= 0.6 × price_annual
  --   DP_30   : amount_paid_ytd >= 0.3 × price_annual
  --   OVERDUE : amount_paid_ytd > 0 AND < 0.3 × price_annual
  --   UNPAID  : amount_paid_ytd = 0, OR price_annual is NULL/0
  SELECT p.price_annual INTO v_price_annual
  FROM public.tenant_subscriptions ts
  JOIN public.plans p ON p.code = ts.plan_code
  WHERE ts.tenant_id = v_tenant_id;

  IF v_price_annual IS NULL THEN
    -- No subscription / NULL price_annual: treat as UNPAID (aligns with view)
    v_coverage_ok     := false;
    v_coverage_status := 'UNPAID';
  ELSIF v_amount_paid_ytd >= v_price_annual THEN
    v_coverage_ok     := true;
    v_coverage_status := 'LUNAS';
  ELSIF v_amount_paid_ytd >= v_price_annual * 0.6 THEN
    v_coverage_ok     := false;
    v_coverage_status := 'DP_60';
  ELSIF v_amount_paid_ytd >= v_price_annual * 0.3 THEN
    v_coverage_ok     := false;
    v_coverage_status := 'DP_30';
  ELSIF v_amount_paid_ytd > 0 THEN
    v_coverage_ok     := false;
    v_coverage_status := 'OVERDUE';
  ELSE
    v_coverage_ok     := false;
    v_coverage_status := 'UNPAID';
  END IF;

  -- ── Return ────────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'payment_id',       v_payment_id,
    'amount_paid_ytd',  v_amount_paid_ytd,
    'coverage_ok',      v_coverage_ok,
    'coverage_status',  v_coverage_status
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.record_payment(jsonb) FROM PUBLIC;
ALTER FUNCTION  public.record_payment(jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.record_payment(jsonb) TO authenticated;

COMMENT ON FUNCTION public.record_payment(jsonb) IS
  'category=P; Wave 5 Task 4 (fixed Task 11 I2). Records a tenant payment. '
  'Platform-admin gated (P0403). Validates key whitelist (22023 UNKNOWN_FIELD), '
  'amount>0 (22023 INVALID_AMOUNT), period_to>=period_from (22023 INVALID_PERIOD), '
  'tenant exists (P0404). Inserts audit row (RECORD_PAYMENT) + tenant_payments row. '
  'Returns {payment_id, amount_paid_ytd, coverage_ok, coverage_status}. '
  'coverage_status enum: LUNAS|DP_60|DP_30|OVERDUE|UNPAID (I2 fix: NULL price_annual → UNPAID, not UNKNOWN).';

COMMIT;
