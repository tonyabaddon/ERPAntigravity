-- =============================================================================
-- Migration: 20261115000039_payment_verification_workflow.sql
-- Wave 6 Task 12: Payment verification schema (columns + coverage view rebuild)
--
-- THIS FILE WILL BE EXTENDED BY:
--   Task 13 — appends updated record_payment RPC (PENDING_VERIFICATION default)
--   Task 14 — appends verify_payment + reject_payment RPCs
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Part 1: Add verification columns to tenant_payments
-- ---------------------------------------------------------------------------
-- status: PENDING_VERIFICATION | VERIFIED | REJECTED
-- Default VERIFIED so all existing Wave 5 rows remain valid with no regression.
-- Between Task 12 apply and Task 13 apply, new payments auto-VERIFIED (acceptable
-- transition state — see Note G).
ALTER TABLE public.tenant_payments
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'VERIFIED'
    CHECK (status IN ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED'));

-- verified_by: optional FK to the platform_admin who approved this payment
ALTER TABLE public.tenant_payments
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES auth.users(id);

-- verified_at: timestamp when the payment was verified or rejected
ALTER TABLE public.tenant_payments
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- rejection_reason: free-text note from platform_admin when status='REJECTED'
ALTER TABLE public.tenant_payments
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- ---------------------------------------------------------------------------
-- Part 2: Rebuild v_tenant_payment_coverage
-- Wave 5 shape fully preserved; Wave 6 adds:
--   * VERIFIED filter on the coverage SUM
--   * total_pending column (PENDING_VERIFICATION payments, unfiltered by period)
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_tenant_payment_coverage CASCADE;

CREATE VIEW public.v_tenant_payment_coverage
  WITH (security_invoker = true) AS
WITH paid AS (
  SELECT t.id AS tenant_id,
         -- Wave 6: only VERIFIED payments contribute to coverage; PENDING and REJECTED do not
         COALESCE(SUM(tp.amount) FILTER (
           WHERE tp.status      = 'VERIFIED'
             AND tp.period_from <= ts.expires_at
             AND tp.period_to   >= ts.activated_at
         ), 0::numeric) AS total_paid,
         -- Wave 6: expose pending revenue separately (no period filter — all PENDING rows)
         COALESCE(SUM(tp.amount) FILTER (WHERE tp.status = 'PENDING_VERIFICATION'), 0::numeric)
           AS total_pending,
         t.slug AS tenant_slug,
         t.name AS tenant_name,
         ts.plan_code
  FROM tenants t
  LEFT JOIN tenant_subscriptions ts ON ts.tenant_id = t.id
  LEFT JOIN tenant_payments tp ON tp.tenant_id = t.id
  GROUP BY t.id, t.slug, t.name, ts.activated_at, ts.expires_at, ts.plan_code
)
SELECT t.id AS tenant_id,
       paid.total_paid AS total_paid_covering_current_subscription,
       paid.total_pending,
       COALESCE(p.price_annual, 0::numeric) AS expected,
       CASE
         WHEN COALESCE(p.price_annual, 0::numeric) = 0 THEN 'UNPAID'
         WHEN paid.total_paid = 0                       THEN 'UNPAID'
         WHEN paid.total_paid >= p.price_annual         THEN 'LUNAS'
         WHEN paid.total_paid >= p.price_annual * 0.6   THEN 'DP_60'
         WHEN paid.total_paid >= p.price_annual * 0.3   THEN 'DP_30'
         ELSE 'OVERDUE'
       END AS coverage_status,
       paid.tenant_slug,
       paid.tenant_name,
       paid.plan_code
FROM tenants t
LEFT JOIN tenant_subscriptions ts ON ts.tenant_id = t.id
LEFT JOIN plans p ON p.code = ts.plan_code
LEFT JOIN paid ON paid.tenant_id = t.id;

-- Re-issue GRANTs (DROP VIEW loses them)
GRANT SELECT ON public.v_tenant_payment_coverage TO authenticated, vosi_rpc_owner;

-- ==== Task 13: record_payment (PENDING + fraud checks) ====
-- Applied to prod via execute_sql (slot 000039 already applied by Task 12).
-- Changes vs Wave 5 body:
--   1. New DECLARE vars: v_amount_anomaly boolean, v_plan_price numeric
--   2. Anti-fraud #1: proof required for non-CASH (after TENANT_NOT_FOUND check)
--   3. Anti-fraud #2: amount anomaly flag (>10% deviation vs plan price_annual)
--   4. Audit INSERT: detail = p_payload || jsonb_build_object('amount_anomaly', v_amount_anomaly)
--   5. tenant_payments INSERT: adds status='PENDING_VERIFICATION' to column list + VALUES
--   6. Coverage SUM: adds AND status='VERIFIED' (PENDING doesn't inflate coverage)

CREATE OR REPLACE FUNCTION public.record_payment(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
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
  -- Wave 6 additions
  v_amount_anomaly   boolean := false;
  v_plan_price       numeric;
BEGIN
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
  END IF;

  SELECT ARRAY_AGG(k)
  INTO v_unknown_keys
  FROM jsonb_object_keys(p_payload) AS k
  WHERE k <> ALL(v_allowed_keys);

  IF v_unknown_keys IS NOT NULL AND array_length(v_unknown_keys, 1) > 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'UNKNOWN_FIELD';
  END IF;

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

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_AMOUNT';
  END IF;

  IF v_period_from IS NULL OR v_period_to IS NULL OR v_period_to < v_period_from THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_PERIOD';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_tenant_id) THEN
    RAISE EXCEPTION USING errcode = 'P0404', message = 'TENANT_NOT_FOUND';
  END IF;

  -- Wave 6 Anti-fraud #1: proof required for non-cash
  IF v_payment_method != 'CASH'
     AND (v_proof_url IS NULL OR v_proof_url = '') THEN
    RAISE EXCEPTION USING errcode = '22023',
      message = 'PROOF_REQUIRED_FOR_NON_CASH';
  END IF;

  -- Wave 6 Anti-fraud #2: amount anomaly (>10% deviation vs plan price)
  SELECT p.price_annual INTO v_plan_price
  FROM public.plans p
  JOIN public.tenant_subscriptions ts ON ts.plan_code = p.code
  WHERE ts.tenant_id = v_tenant_id;

  IF v_plan_price IS NOT NULL AND v_plan_price > 0
     AND ABS(v_amount - v_plan_price) > (v_plan_price * 0.1) THEN
    v_amount_anomaly := true;
  END IF;

  SELECT email INTO v_admin_email
  FROM public.platform_admins
  WHERE user_id = auth.uid();

  -- Wave 6: extend audit detail with amount_anomaly flag
  INSERT INTO public.platform_admin_audit
    (admin_user_id, admin_email, tenant_id, action, detail)
  VALUES (
    auth.uid(),
    v_admin_email,
    v_tenant_id,
    'RECORD_PAYMENT',
    p_payload || jsonb_build_object('amount_anomaly', v_amount_anomaly)
  )
  RETURNING id INTO v_audit_id;

  -- Wave 6: insert with PENDING_VERIFICATION status (two-step workflow)
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
    audit_id,
    status
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
    v_audit_id,
    'PENDING_VERIFICATION'
  )
  RETURNING id INTO v_payment_id;

  -- Wave 6: coverage sum counts only VERIFIED payments (PENDING doesn't inflate)
  SELECT COALESCE(SUM(amount), 0)
  INTO v_amount_paid_ytd
  FROM public.tenant_payments
  WHERE tenant_id = v_tenant_id
    AND status = 'VERIFIED'
    AND EXTRACT(year FROM payment_date) = EXTRACT(year FROM CURRENT_DATE);

  SELECT p.price_annual INTO v_price_annual
  FROM public.tenant_subscriptions ts
  JOIN public.plans p ON p.code = ts.plan_code
  WHERE ts.tenant_id = v_tenant_id;

  IF v_price_annual IS NULL THEN
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

  RETURN jsonb_build_object(
    'payment_id',       v_payment_id,
    'amount_paid_ytd',  v_amount_paid_ytd,
    'coverage_ok',      v_coverage_ok,
    'coverage_status',  v_coverage_status
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$function$;

ALTER FUNCTION public.record_payment(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_payment(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_payment(jsonb) TO authenticated;

-- ==== Task 14: verify_payment + reject_payment RPCs ====
-- Applied to prod via execute_sql (slot 000039 already applied by Task 12).
-- Both RPCs: super_admin only; raise P0409 for wrong state, P0002 for unknown payment.
-- Audit: INSERT into platform_admin_audit (VERIFY_PAYMENT / REJECT_PAYMENT).

CREATE OR REPLACE FUNCTION public.verify_payment(p_payment_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_amount    numeric;
  v_admin_email text;
BEGIN
  -- Auth gate: super_admin ONLY
  IF NOT public._is_super_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'SUPER_ADMIN_REQUIRED';
  END IF;

  -- Fetch payment context BEFORE the update (Note B)
  SELECT tenant_id, amount
    INTO v_tenant_id, v_amount
  FROM public.tenant_payments
  WHERE id = p_payment_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'PAYMENT_NOT_FOUND';
  END IF;

  -- Update: only if PENDING_VERIFICATION (Note C)
  UPDATE public.tenant_payments
  SET
    status      = 'VERIFIED',
    verified_by = auth.uid(),
    verified_at = now()
  WHERE id = p_payment_id
    AND status = 'PENDING_VERIFICATION';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0409', message = 'PAYMENT_NOT_PENDING';
  END IF;

  -- Audit INSERT (Note A)
  SELECT email INTO v_admin_email
  FROM public.platform_admins
  WHERE user_id = auth.uid();

  INSERT INTO public.platform_admin_audit
    (admin_user_id, admin_email, tenant_id, action, detail)
  VALUES (
    auth.uid(),
    v_admin_email,
    v_tenant_id,
    'VERIFY_PAYMENT',
    jsonb_build_object(
      'payment_id', p_payment_id,
      'amount',     v_amount
    )
  );

  RETURN jsonb_build_object(
    'payment_id', p_payment_id,
    'status',     'VERIFIED'
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$function$;

ALTER FUNCTION public.verify_payment(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.verify_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_payment(uuid) TO authenticated;

-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reject_payment(p_payment_id UUID, p_reason TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_amount    numeric;
  v_admin_email text;
BEGIN
  -- Auth gate: super_admin ONLY
  IF NOT public._is_super_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'SUPER_ADMIN_REQUIRED';
  END IF;

  -- Fetch payment context BEFORE the update (Note B)
  SELECT tenant_id, amount
    INTO v_tenant_id, v_amount
  FROM public.tenant_payments
  WHERE id = p_payment_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'PAYMENT_NOT_FOUND';
  END IF;

  -- Update: only if PENDING_VERIFICATION (Note C)
  UPDATE public.tenant_payments
  SET
    status           = 'REJECTED',
    verified_by      = auth.uid(),
    verified_at      = now(),
    rejection_reason = p_reason
  WHERE id = p_payment_id
    AND status = 'PENDING_VERIFICATION';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0409', message = 'PAYMENT_NOT_PENDING';
  END IF;

  -- Audit INSERT (Note A)
  SELECT email INTO v_admin_email
  FROM public.platform_admins
  WHERE user_id = auth.uid();

  INSERT INTO public.platform_admin_audit
    (admin_user_id, admin_email, tenant_id, action, detail)
  VALUES (
    auth.uid(),
    v_admin_email,
    v_tenant_id,
    'REJECT_PAYMENT',
    jsonb_build_object(
      'payment_id',       p_payment_id,
      'amount',           v_amount,
      'rejection_reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'payment_id', p_payment_id,
    'status',     'REJECTED'
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$function$;

ALTER FUNCTION public.reject_payment(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reject_payment(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_payment(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- list_pending_payments() SECDEF RPC
-- Used by paymentVerificationApi.listPending() — direct SELECT on
-- platform_admin_audit is blocked for authenticated role (RLS gap).
-- Returns: tenant_payments joined with tenants + amount_anomaly flag from audit.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_pending_payments()
RETURNS TABLE (
  id               uuid,
  tenant_id        uuid,
  tenant_slug      text,
  tenant_name      text,
  amount           numeric,
  payment_method   text,
  payment_date     date,
  proof_url        text,
  bank_reference   text,
  notes            text,
  amount_anomaly   boolean,
  created_at       timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  -- Auth gate: platform_admin minimum (super_admin also qualifies)
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
  END IF;

  RETURN QUERY
  SELECT
    tp.id,
    tp.tenant_id,
    t.slug   AS tenant_slug,
    t.name   AS tenant_name,
    tp.amount,
    tp.payment_method,
    tp.payment_date,
    tp.proof_url,
    tp.bank_reference,
    tp.notes,
    COALESCE(
      (paa.detail ->> 'amount_anomaly')::boolean,
      false
    )        AS amount_anomaly,
    tp.created_at
  FROM public.tenant_payments tp
  JOIN public.tenants t ON t.id = tp.tenant_id
  LEFT JOIN public.platform_admin_audit paa ON paa.id = tp.audit_id
  WHERE tp.status = 'PENDING_VERIFICATION'
  ORDER BY tp.created_at DESC;
END;
$function$;

ALTER FUNCTION public.list_pending_payments() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_pending_payments() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_pending_payments() TO authenticated;
