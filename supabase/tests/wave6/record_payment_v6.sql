BEGIN;
SELECT plan(3);

-- ============================================================
-- record_payment Wave 6 tests
-- Tests: proof check, PENDING status insert, anomaly flag
-- Setup: uses STARTER plan (price_annual = 1_200_000)
-- Admin user: seed into auth.users + platform_admins with fake JWT
-- ============================================================

-- Shared setup: create a platform admin user for RPC invocation
DO $$
BEGIN
  -- seed admin user (idempotent)
  INSERT INTO auth.users (id, email)
  VALUES ('33333333-aaaa-bbbb-cccc-000000000013', 'pgtap-t13@test.com')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.platform_admins (user_id, email, role)
  VALUES ('33333333-aaaa-bbbb-cccc-000000000013', 'pgtap-t13@test.com', 'super_admin')
  ON CONFLICT DO NOTHING;
END;
$$;

-- Fake JWT claiming platform_admin for the test session
SELECT set_config('request.jwt.claims',
  '{"sub":"33333333-aaaa-bbbb-cccc-000000000013","role":"authenticated","is_platform_admin":true}',
  true);

-- ============================================================
-- Test 1: Non-CASH without proof_object_key → 22023 PROOF_REQUIRED_FOR_NON_CASH
-- ============================================================
DO $$
DECLARE
  v_tid  uuid := gen_random_uuid();
  v_result jsonb;
BEGIN
  INSERT INTO public.tenants (id, name, slug, status)
  VALUES (v_tid, 'pgTAP T13 Proof', 'pgtap-t13-proof', 'ACTIVE');

  INSERT INTO public.tenant_subscriptions (tenant_id, plan_code, activated_at, expires_at)
  VALUES (v_tid, 'STARTER', '2026-01-01', '2026-12-31');

  BEGIN
    SELECT public.record_payment(jsonb_build_object(
      'tenant_id',      v_tid,
      'amount',         1200000,
      'payment_method', 'TRANSFER',
      'payment_date',   CURRENT_DATE,
      'period_from',    '2026-01-01',
      'period_to',      '2026-12-31'
      -- proof_object_key intentionally omitted
    )) INTO v_result;
    RAISE EXCEPTION 'expected_no_error';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      IF SQLERRM != 'PROOF_REQUIRED_FOR_NON_CASH' THEN
        RAISE EXCEPTION 'wrong_message: %', SQLERRM;
      END IF;
    WHEN OTHERS THEN
      RAISE EXCEPTION 'wrong_error: % %', SQLSTATE, SQLERRM;
  END;
END;
$$;

SELECT pass('non-CASH without proof_object_key raises PROOF_REQUIRED_FOR_NON_CASH (22023)');

-- ============================================================
-- Test 2: Valid CASH payment inserts row with status='PENDING_VERIFICATION'
-- ============================================================
DO $$
DECLARE
  v_tid        uuid := gen_random_uuid();
  v_result     jsonb;
  v_payment_id uuid;
  v_status     text;
BEGIN
  INSERT INTO public.tenants (id, name, slug, status)
  VALUES (v_tid, 'pgTAP T13 Pending', 'pgtap-t13-pending', 'ACTIVE');

  INSERT INTO public.tenant_subscriptions (tenant_id, plan_code, activated_at, expires_at)
  VALUES (v_tid, 'STARTER', '2026-01-01', '2026-12-31');

  SELECT public.record_payment(jsonb_build_object(
    'tenant_id',      v_tid,
    'amount',         1200000,
    'payment_method', 'CASH',
    'payment_date',   CURRENT_DATE,
    'period_from',    '2026-01-01',
    'period_to',      '2026-12-31'
  )) INTO v_result;

  v_payment_id := (v_result->>'payment_id')::uuid;

  SELECT status INTO v_status
  FROM public.tenant_payments WHERE id = v_payment_id;

  IF v_status != 'PENDING_VERIFICATION' THEN
    RAISE EXCEPTION 'FAIL: expected PENDING_VERIFICATION, got %', v_status;
  END IF;
END;
$$;

SELECT pass('record_payment inserts tenant_payments row with status=PENDING_VERIFICATION');

-- ============================================================
-- Test 3: Amount 200% of plan price → amount_anomaly=true in audit detail
-- ============================================================
DO $$
DECLARE
  v_tid         uuid := gen_random_uuid();
  v_result      jsonb;
  v_payment_id  uuid;
  v_anomaly     boolean;
BEGIN
  INSERT INTO public.tenants (id, name, slug, status)
  VALUES (v_tid, 'pgTAP T13 Anomaly', 'pgtap-t13-anomaly', 'ACTIVE');

  INSERT INTO public.tenant_subscriptions (tenant_id, plan_code, activated_at, expires_at)
  VALUES (v_tid, 'STARTER', '2026-01-01', '2026-12-31');

  -- 2400000 = 200% of STARTER (1200000), deviation = 100% > 10% threshold
  SELECT public.record_payment(jsonb_build_object(
    'tenant_id',      v_tid,
    'amount',         2400000,
    'payment_method', 'CASH',
    'payment_date',   CURRENT_DATE,
    'period_from',    '2026-01-01',
    'period_to',      '2026-12-31'
  )) INTO v_result;

  v_payment_id := (v_result->>'payment_id')::uuid;

  SELECT (paa.detail->>'amount_anomaly')::boolean INTO v_anomaly
  FROM public.platform_admin_audit paa
  JOIN public.tenant_payments tp ON tp.audit_id = paa.id
  WHERE tp.id = v_payment_id;

  IF v_anomaly IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: expected amount_anomaly=true in audit detail, got %', v_anomaly;
  END IF;
END;
$$;

SELECT pass('amount 200%% of plan price → amount_anomaly=true in platform_admin_audit.detail');

SELECT * FROM finish();
ROLLBACK;
