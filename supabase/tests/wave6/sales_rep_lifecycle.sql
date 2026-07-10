-- supabase/tests/wave6/sales_rep_lifecycle.sql
-- pgTAP test: create_sales_rep + deactivate_sales_rep
-- Run inside a transaction that rolls back — no prod side-effects.
BEGIN;
SELECT plan(6);

-- ── Seed auth.users for BOTH the acting super_admin and the target rep ────────
-- platform_admins has FK platform_admins_user_id_fkey → auth.users(id).
-- Done BEFORE SET LOCAL role so we have postgres-level access.
INSERT INTO auth.users (
  id, email, aud, role, instance_id,
  confirmation_token, recovery_token,
  email_change_token_new, email_change,
  email_change_token_current, reauthentication_token,
  phone_change, phone_change_token
)
VALUES
  -- acting super_admin (JWT sub = 22222222)
  ('22222222-2222-2222-2222-222222222222', 'superadmin@test.com',
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
   '', '', '', '', '', '', '', ''),
  -- target rep
  ('55555555-5555-5555-5555-555555555555', 'rep@test.com',
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
   '', '', '', '', '', '', '', '')
ON CONFLICT DO NOTHING;

-- ── Seed platform_admins for the acting super_admin ───────────────────────────
-- admin_email is NOT NULL in platform_admin_audit; RPC resolves via
-- SELECT email FROM platform_admins WHERE user_id = auth.uid().
INSERT INTO public.platform_admins (user_id, email, role, status, name)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  'superadmin@test.com',
  'super_admin',
  'active',
  'Test SuperAdmin'
)
ON CONFLICT (user_id) DO UPDATE SET
  email  = EXCLUDED.email,
  role   = EXCLUDED.role,
  status = EXCLUDED.status,
  name   = EXCLUDED.name;

-- ── Activate super_admin JWT claim ───────────────────────────────────────────
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","is_platform_admin":true,"platform_admin_role":"super_admin"}';

-- Test 1: create_sales_rep succeeds for super_admin
SELECT lives_ok(
  $$SELECT public.create_sales_rep(
      '55555555-5555-5555-5555-555555555555'::uuid,
      'rep@test.com',
      'Test Rep')$$,
  'create_sales_rep succeeds for super_admin'
);

-- Test 2: row inserted with role=sales_rep, status=active
SELECT results_eq(
  $$SELECT role, status
    FROM public.platform_admins
    WHERE user_id = '55555555-5555-5555-5555-555555555555'::uuid$$,
  $$VALUES ('sales_rep'::text, 'active'::text)$$,
  'row inserted with sales_rep/active'
);

-- Test 3: sales_rep cannot create another rep (P0403)
SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","is_platform_admin":true,"platform_admin_role":"sales_rep"}';
SELECT throws_ok(
  $$SELECT public.create_sales_rep(
      '66666666-6666-6666-6666-666666666666'::uuid,
      'x@x.com',
      'X')$$,
  'P0403',
  NULL,
  'sales_rep cannot create another rep'
);

-- Test 4: super_admin can deactivate the rep
SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","is_platform_admin":true,"platform_admin_role":"super_admin"}';
SELECT lives_ok(
  $$SELECT public.deactivate_sales_rep(
      '55555555-5555-5555-5555-555555555555'::uuid,
      'resigned')$$,
  'deactivate_sales_rep succeeds for super_admin'
);

-- Test 5: email column populated correctly
SELECT results_eq(
  $$SELECT email
    FROM public.platform_admins
    WHERE user_id = '55555555-5555-5555-5555-555555555555'::uuid$$,
  $$VALUES ('rep@test.com'::text)$$,
  'email column populated from p_email'
);

-- Test 6: audit row emitted with correct shape (CREATE_SALES_REP)
SELECT results_eq(
  $$SELECT action, tenant_id, detail->>'email'
    FROM public.platform_admin_audit
    WHERE detail->>'user_id' = '55555555-5555-5555-5555-555555555555'
      AND action = 'CREATE_SALES_REP'
    ORDER BY id DESC LIMIT 1$$,
  $$VALUES ('CREATE_SALES_REP'::text, NULL::uuid, 'rep@test.com'::text)$$,
  'audit row: action=CREATE_SALES_REP, tenant_id NULL, email in detail'
);

SELECT finish();
ROLLBACK;
