BEGIN;
SELECT plan(6);

-- ============================================================
-- Test 1: tenant_payments.status column exists
-- ============================================================
SELECT has_column(
  'public', 'tenant_payments', 'status',
  'tenant_payments.status column exists'
);

-- ============================================================
-- Test 2: Existing rows default to VERIFIED
-- (backward compat: Wave 5 rows must survive without change)
-- ============================================================
SELECT col_default_is(
  'public', 'tenant_payments', 'status', 'VERIFIED',
  'tenant_payments.status defaults to VERIFIED'
);

-- ============================================================
-- Test 3: View still returns total_paid_covering_current_subscription
-- (Wave 5 regression guard — column name must not change)
-- ============================================================
SELECT has_column(
  'public', 'v_tenant_payment_coverage', 'total_paid_covering_current_subscription',
  'view still exposes total_paid_covering_current_subscription (Wave 5 compat)'
);

-- ============================================================
-- Test 4: View returns new total_pending column
-- (Wave 6 addition)
-- ============================================================
SELECT has_column(
  'public', 'v_tenant_payment_coverage', 'total_pending',
  'view exposes total_pending column (Wave 6 addition)'
);

-- ============================================================
-- Test 5: LUNAS gate — VERIFIED payments >= price_annual → LUNAS
-- Seed: tenant + subscription + 2 VERIFIED payments summing to STARTER price
-- STARTER plan price_annual = 1_200_000; two payments of 600_000 each
-- ============================================================
DO $$
DECLARE
  v_tenant_id   UUID := gen_random_uuid();
  -- Use a real auth.users row to satisfy FK on recorded_by_admin
  v_admin_id    UUID := '22222222-aaaa-bbbb-cccc-000000000001';
  v_period_from DATE := CURRENT_DATE - INTERVAL '30 days';
  v_period_to   DATE := CURRENT_DATE + INTERVAL '335 days';
BEGIN
  -- slug: [a-z0-9][a-z0-9-]{2,29}, max 30 chars total
  INSERT INTO public.tenants (id, slug, name)
  VALUES (v_tenant_id, 'pgtap-lunas-t12', 'pgTAP LUNAS Test');

  INSERT INTO public.tenant_subscriptions (tenant_id, plan_code, activated_at, expires_at)
  VALUES (v_tenant_id, 'STARTER', v_period_from, v_period_to);

  -- Two VERIFIED payments, each 600_000 — sum = 1_200_000 = STARTER price_annual
  -- CASH avoids bank_name NOT NULL constraint (payment_bank_required CHECK)
  INSERT INTO public.tenant_payments
    (tenant_id, amount, status, period_from, period_to, payment_method, payment_date, recorded_by_admin)
  VALUES
    (v_tenant_id, 600000.00, 'VERIFIED', v_period_from, v_period_to, 'CASH', CURRENT_DATE, v_admin_id),
    (v_tenant_id, 600000.00, 'VERIFIED', v_period_from, v_period_to, 'CASH', CURRENT_DATE, v_admin_id);
END;
$$;

SELECT is(
  (SELECT coverage_status
   FROM public.v_tenant_payment_coverage
   WHERE tenant_slug = 'pgtap-lunas-t12'),
  'LUNAS',
  'two VERIFIED payments summing to price_annual → coverage_status = LUNAS'
);

-- ============================================================
-- Test 6: PENDING does NOT count toward LUNAS
-- Seed: tenant + subscription + 1 large PENDING_VERIFICATION payment
-- → total_paid remains 0 → coverage_status = UNPAID
-- ============================================================
DO $$
DECLARE
  v_tenant_id   UUID := gen_random_uuid();
  v_admin_id    UUID := '22222222-aaaa-bbbb-cccc-000000000001';
  v_period_from DATE := CURRENT_DATE - INTERVAL '30 days';
  v_period_to   DATE := CURRENT_DATE + INTERVAL '335 days';
BEGIN
  INSERT INTO public.tenants (id, slug, name)
  VALUES (v_tenant_id, 'pgtap-pend-t12', 'pgTAP PENDING Test');

  INSERT INTO public.tenant_subscriptions (tenant_id, plan_code, activated_at, expires_at)
  VALUES (v_tenant_id, 'STARTER', v_period_from, v_period_to);

  -- One large PENDING payment that would cover full annual price if verified
  -- CASH avoids bank_name NOT NULL constraint (payment_bank_required CHECK)
  INSERT INTO public.tenant_payments
    (tenant_id, amount, status, period_from, period_to, payment_method, payment_date, recorded_by_admin)
  VALUES
    (v_tenant_id, 1200000.00, 'PENDING_VERIFICATION', v_period_from, v_period_to, 'CASH', CURRENT_DATE, v_admin_id);
END;
$$;

SELECT is(
  (SELECT coverage_status
   FROM public.v_tenant_payment_coverage
   WHERE tenant_slug = 'pgtap-pend-t12'),
  'UNPAID',
  'large PENDING_VERIFICATION payment does not count toward LUNAS → coverage_status = UNPAID'
);

SELECT * FROM finish();
ROLLBACK;
