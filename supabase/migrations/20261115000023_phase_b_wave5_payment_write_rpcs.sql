BEGIN;

-- ============================================================
-- Phase B Wave 5 — Task 4
-- record_payment + update_payment + delete_payment SECDEF RPCs
--
-- All three owned by postgres — they call auth.uid() + SELECT
-- platform_admins + INSERT platform_admin_audit.
-- vosi_rpc_owner cannot access the auth schema; postgres is the
-- only role that can. Pattern established by Wave 1 Task 12 +
-- Wave 4a Tasks 1-3.
--
-- Schema facts verified before writing:
--   • platform_admin_audit.id is BIGINT (Wave 1 Task 3 finding)
--   • audit action CHECK includes RECORD_PAYMENT, UPDATE_PAYMENT,
--     DELETE_PAYMENT (added by Wave 5 Task 2)
--   • tenant_payments.audit_id is BIGINT FK to platform_admin_audit(id)
--   • tenant_payments.proof_url stores the object key / URL
--   • tenant_subscriptions has NO status column; active = expires_at >= CURRENT_DATE
--   • plans.price_annual: STARTER=1.2M, PRO=3.6M, PREMIUM=9M
-- ============================================================

-- ── coverage_status formula (§15.5) ─────────────────────────────────────────
--   LUNAS   : amount_paid_ytd >= price_annual
--   DP_60   : amount_paid_ytd >= 0.6 × price_annual AND < price_annual
--   DP_30   : amount_paid_ytd >= 0.3 × price_annual AND < 0.6 × price_annual
--   OVERDUE : amount_paid_ytd > 0 AND < 0.3 × price_annual
--   UNPAID  : amount_paid_ytd = 0 (or no payments this year)
-- coverage_ok = (amount_paid_ytd >= price_annual)
-- If price_annual IS NULL → coverage_ok=false, coverage_status='UNKNOWN'

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. record_payment(p_payload jsonb) → jsonb
-- ═══════════════════════════════════════════════════════════════════════════

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
  -- Method-specific CHECK constraints (payment_bank_required,
  -- payment_ewallet_required) will raise 23514 if the bank_name /
  -- ewallet_provider combination is invalid — that's intentional.
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
  SELECT p.price_annual INTO v_price_annual
  FROM public.tenant_subscriptions ts
  JOIN public.plans p ON p.code = ts.plan_code
  WHERE ts.tenant_id = v_tenant_id;

  IF v_price_annual IS NULL THEN
    v_coverage_ok     := false;
    v_coverage_status := 'UNKNOWN';
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
  'category=P; Wave 5 Task 4. Records a tenant payment. '
  'Platform-admin gated (P0403). Validates key whitelist (22023 UNKNOWN_FIELD), '
  'amount>0 (22023 INVALID_AMOUNT), period_to>=period_from (22023 INVALID_PERIOD), '
  'tenant exists (P0404). Inserts audit row (RECORD_PAYMENT) + tenant_payments row. '
  'Method-specific CHECK constraints (23514) enforce bank_name/ewallet_provider. '
  'Returns {payment_id, amount_paid_ytd, coverage_ok, coverage_status}. '
  'Owned by postgres (calls auth.uid() + platform_admins).';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. update_payment(p_payment_id uuid, p_updates jsonb) → jsonb
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_payment(
  p_payment_id uuid,
  p_updates    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_admin_email  text;
  v_unknown_keys text[];
  v_allowed_keys text[] := ARRAY[
    'amount', 'payment_method', 'payment_date',
    'period_from', 'period_to', 'bank_name', 'ewallet_provider',
    'bank_reference', 'notes', 'proof_object_key'
  ];
  v_tenant_id    uuid;
BEGIN
  -- ── Gate: platform admin only ─────────────────────────────────────────────
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
  END IF;

  -- ── Validate: key whitelist ───────────────────────────────────────────────
  SELECT ARRAY_AGG(k)
  INTO v_unknown_keys
  FROM jsonb_object_keys(p_updates) AS k
  WHERE k <> ALL(v_allowed_keys);

  IF v_unknown_keys IS NOT NULL AND array_length(v_unknown_keys, 1) > 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'UNKNOWN_FIELD';
  END IF;

  -- ── Validate: payment exists; capture tenant_id for audit ─────────────────
  SELECT tenant_id INTO v_tenant_id
  FROM public.tenant_payments
  WHERE id = p_payment_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING errcode = 'P0404', message = 'PAYMENT_NOT_FOUND';
  END IF;

  -- ── Resolve admin email ───────────────────────────────────────────────────
  SELECT email INTO v_admin_email
  FROM public.platform_admins
  WHERE user_id = auth.uid();

  -- ── UPDATE tenant_payments — per-key CASE-WHEN, no dynamic SQL ───────────
  UPDATE public.tenant_payments
  SET
    amount           = CASE WHEN p_updates ? 'amount'
                             THEN (p_updates ->>'amount')::numeric
                             ELSE amount END,
    payment_method   = CASE WHEN p_updates ? 'payment_method'
                             THEN p_updates ->>'payment_method'
                             ELSE payment_method END,
    payment_date     = CASE WHEN p_updates ? 'payment_date'
                             THEN (p_updates ->>'payment_date')::date
                             ELSE payment_date END,
    period_from      = CASE WHEN p_updates ? 'period_from'
                             THEN (p_updates ->>'period_from')::date
                             ELSE period_from END,
    period_to        = CASE WHEN p_updates ? 'period_to'
                             THEN (p_updates ->>'period_to')::date
                             ELSE period_to END,
    bank_name        = CASE WHEN p_updates ? 'bank_name'
                             THEN p_updates ->>'bank_name'
                             ELSE bank_name END,
    ewallet_provider = CASE WHEN p_updates ? 'ewallet_provider'
                             THEN p_updates ->>'ewallet_provider'
                             ELSE ewallet_provider END,
    bank_reference   = CASE WHEN p_updates ? 'bank_reference'
                             THEN p_updates ->>'bank_reference'
                             ELSE bank_reference END,
    notes            = CASE WHEN p_updates ? 'notes'
                             THEN p_updates ->>'notes'
                             ELSE notes END,
    proof_url        = CASE WHEN p_updates ? 'proof_object_key'
                             THEN p_updates ->>'proof_object_key'
                             ELSE proof_url END,
    updated_at       = now()
  WHERE id = p_payment_id;

  -- ── INSERT audit row ──────────────────────────────────────────────────────
  INSERT INTO public.platform_admin_audit
    (admin_user_id, admin_email, tenant_id, action, detail)
  VALUES (
    auth.uid(),
    v_admin_email,
    v_tenant_id,
    'UPDATE_PAYMENT',
    jsonb_build_object(
      'payment_id', p_payment_id,
      'updates',    p_updates
    )
  );

  -- ── Return ────────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'ok',           true,
    'payment_id',   p_payment_id,
    'updated_keys', ARRAY(SELECT jsonb_object_keys(p_updates))
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.update_payment(uuid, jsonb) FROM PUBLIC;
ALTER FUNCTION  public.update_payment(uuid, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.update_payment(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.update_payment(uuid, jsonb) IS
  'category=P; Wave 5 Task 4. Updates a tenant payment row. '
  'Platform-admin gated (P0403). Validates key whitelist (22023 UNKNOWN_FIELD), '
  'payment exists (P0404 PAYMENT_NOT_FOUND). Per-key CASE-WHEN UPDATE. '
  'proof_object_key key maps to proof_url column. '
  'Inserts UPDATE_PAYMENT audit row. '
  'Returns {ok, payment_id, updated_keys}. '
  'Owned by postgres (calls auth.uid() + platform_admins).';


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. delete_payment(p_payment_id uuid, p_reason text) → jsonb
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.delete_payment(
  p_payment_id uuid,
  p_reason     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_admin_email text;
  v_tenant_id   uuid;
  v_snapshot    jsonb;
BEGIN
  -- ── Gate: platform admin only ─────────────────────────────────────────────
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
  END IF;

  -- ── Validate: reason non-empty ────────────────────────────────────────────
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'REASON_REQUIRED';
  END IF;

  -- ── Read payment row; capture snapshot + tenant_id ────────────────────────
  SELECT
    tp.tenant_id,
    jsonb_build_object(
      'id',                tp.id,
      'tenant_id',         tp.tenant_id,
      'amount',            tp.amount,
      'currency',          tp.currency,
      'payment_method',    tp.payment_method,
      'bank_name',         tp.bank_name,
      'ewallet_provider',  tp.ewallet_provider,
      'payment_date',      tp.payment_date,
      'period_from',       tp.period_from,
      'period_to',         tp.period_to,
      'proof_url',         tp.proof_url,
      'bank_reference',    tp.bank_reference,
      'notes',             tp.notes,
      'recorded_by_admin', tp.recorded_by_admin,
      'audit_id',          tp.audit_id,
      'created_at',        tp.created_at,
      'updated_at',        tp.updated_at
    )
  INTO v_tenant_id, v_snapshot
  FROM public.tenant_payments tp
  WHERE tp.id = p_payment_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING errcode = 'P0404', message = 'PAYMENT_NOT_FOUND';
  END IF;

  -- ── Resolve admin email ───────────────────────────────────────────────────
  SELECT email INTO v_admin_email
  FROM public.platform_admins
  WHERE user_id = auth.uid();

  -- ── INSERT audit row (before DELETE so row still exists if needed) ─────────
  INSERT INTO public.platform_admin_audit
    (admin_user_id, admin_email, tenant_id, action, detail)
  VALUES (
    auth.uid(),
    v_admin_email,
    v_tenant_id,
    'DELETE_PAYMENT',
    jsonb_build_object(
      'reason',   p_reason,
      'snapshot', v_snapshot
    )
  );

  -- ── Hard DELETE ───────────────────────────────────────────────────────────
  DELETE FROM public.tenant_payments WHERE id = p_payment_id;

  -- ── Return ────────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'ok',         true,
    'payment_id', p_payment_id
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_payment(uuid, text) FROM PUBLIC;
ALTER FUNCTION  public.delete_payment(uuid, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.delete_payment(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.delete_payment(uuid, text) IS
  'category=P; Wave 5 Task 4. Hard-deletes a tenant payment (audit-logged). '
  'Platform-admin gated (P0403). Validates reason non-empty (22023 REASON_REQUIRED), '
  'payment exists (P0404 PAYMENT_NOT_FOUND). '
  'Captures full payment snapshot, inserts DELETE_PAYMENT audit row, then DELETE. '
  'Returns {ok, payment_id}. '
  'Owned by postgres (calls auth.uid() + platform_admins).';

COMMIT;
