-- pgTAP: verify_payment + reject_payment RPCs
-- Wave 6 Task 14
-- plan(5): verify happy, verify P0403, verify P0409, reject happy, reject P0403

BEGIN;

SELECT plan(5);

-- ─── Seed ────────────────────────────────────────────────────────────────────

-- Fake auth user for super_admin
INSERT INTO auth.users (id, email)
VALUES ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', 'superadmin_test@test.com')
ON CONFLICT (id) DO NOTHING;

-- Register as super_admin in platform_admins
INSERT INTO public.platform_admins (user_id, email, role)
VALUES ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', 'superadmin_test@test.com', 'super_admin')
ON CONFLICT (user_id) DO NOTHING;

-- Ensure a tenant exists
INSERT INTO public.tenants (id, slug, name)
VALUES ('bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', 'test-tenant-t14', 'Test Tenant T14')
ON CONFLICT (id) DO NOTHING;

-- ─── Helpers ─────────────────────────────────────────────────────────────────

-- Set super_admin JWT claims
CREATE OR REPLACE FUNCTION _set_super_admin_jwt() RETURNS void AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub',                 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
    'is_platform_admin',   true,
    'platform_admin_role', 'super_admin'
  )::text, true);
END;
$$ LANGUAGE plpgsql;

-- Set non-admin JWT claims
CREATE OR REPLACE FUNCTION _set_sales_rep_jwt() RETURNS void AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub',               gen_random_uuid(),
    'is_platform_admin', false
  )::text, true);
END;
$$ LANGUAGE plpgsql;

-- ─── Test 1: verify happy path ────────────────────────────────────────────────

DO $$
DECLARE
  v_payment_id uuid;
  v_result jsonb;
BEGIN
  PERFORM _set_super_admin_jwt();

  INSERT INTO public.tenant_payments (
    tenant_id, amount, payment_method, payment_date,
    period_from, period_to, recorded_by_admin, status
  ) VALUES (
    'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb',
    1000000, 'CASH', CURRENT_DATE,
    CURRENT_DATE, CURRENT_DATE + 365,
    'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
    'PENDING_VERIFICATION'
  ) RETURNING id INTO v_payment_id;

  SELECT public.verify_payment(v_payment_id) INTO v_result;
  -- Store result for assertion
  PERFORM set_config('test.t1_result', v_result::text, true);
  PERFORM set_config('test.t1_payment_id', v_payment_id::text, true);
END;
$$;

SELECT ok(
  (current_setting('test.t1_result', true)::jsonb ->> 'status') = 'VERIFIED',
  'Test 1: verify_payment returns status=VERIFIED'
);

-- ─── Test 2: verify P0403 (non-super_admin) ───────────────────────────────────

DO $$
DECLARE
  v_got_p0403 boolean := false;
BEGIN
  PERFORM _set_sales_rep_jwt();
  BEGIN
    PERFORM public.verify_payment(gen_random_uuid());
  EXCEPTION
    WHEN SQLSTATE 'P0403' THEN
      v_got_p0403 := true;
    WHEN OTHERS THEN
      NULL;
  END;
  PERFORM set_config('test.t2_got_p0403', v_got_p0403::text, true);
END;
$$;

SELECT ok(
  current_setting('test.t2_got_p0403', true)::boolean,
  'Test 2: verify_payment raises P0403 for non-super_admin'
);

-- ─── Test 3: verify P0409 (already VERIFIED) ─────────────────────────────────

DO $$
DECLARE
  v_payment_id uuid;
  v_got_p0409 boolean := false;
BEGIN
  PERFORM _set_super_admin_jwt();

  -- payment already VERIFIED
  INSERT INTO public.tenant_payments (
    tenant_id, amount, payment_method, payment_date,
    period_from, period_to, recorded_by_admin, status
  ) VALUES (
    'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb',
    500000, 'CASH', CURRENT_DATE,
    CURRENT_DATE, CURRENT_DATE + 365,
    'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
    'VERIFIED'
  ) RETURNING id INTO v_payment_id;

  BEGIN
    PERFORM public.verify_payment(v_payment_id);
  EXCEPTION
    WHEN SQLSTATE 'P0409' THEN
      v_got_p0409 := true;
    WHEN OTHERS THEN
      NULL;
  END;
  PERFORM set_config('test.t3_got_p0409', v_got_p0409::text, true);
END;
$$;

SELECT ok(
  current_setting('test.t3_got_p0409', true)::boolean,
  'Test 3: verify_payment raises P0409 for already-VERIFIED payment'
);

-- ─── Test 4: reject happy path ────────────────────────────────────────────────

DO $$
DECLARE
  v_payment_id uuid;
  v_result jsonb;
BEGIN
  PERFORM _set_super_admin_jwt();

  INSERT INTO public.tenant_payments (
    tenant_id, amount, payment_method, payment_date,
    period_from, period_to, recorded_by_admin, status
  ) VALUES (
    'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb',
    750000, 'CASH', CURRENT_DATE,
    CURRENT_DATE, CURRENT_DATE + 365,
    'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
    'PENDING_VERIFICATION'
  ) RETURNING id INTO v_payment_id;

  SELECT public.reject_payment(v_payment_id, 'Bukti tidak valid') INTO v_result;
  PERFORM set_config('test.t4_result', v_result::text, true);
END;
$$;

SELECT ok(
  (current_setting('test.t4_result', true)::jsonb ->> 'status') = 'REJECTED',
  'Test 4: reject_payment returns status=REJECTED'
);

-- ─── Test 5: reject P0403 (non-super_admin) ───────────────────────────────────

DO $$
DECLARE
  v_got_p0403 boolean := false;
BEGIN
  PERFORM _set_sales_rep_jwt();
  BEGIN
    PERFORM public.reject_payment(gen_random_uuid(), 'test');
  EXCEPTION
    WHEN SQLSTATE 'P0403' THEN
      v_got_p0403 := true;
    WHEN OTHERS THEN
      NULL;
  END;
  PERFORM set_config('test.t5_got_p0403', v_got_p0403::text, true);
END;
$$;

SELECT ok(
  current_setting('test.t5_got_p0403', true)::boolean,
  'Test 5: reject_payment raises P0403 for non-super_admin'
);

-- ─── Finish ───────────────────────────────────────────────────────────────────

SELECT * FROM finish();

ROLLBACK;
