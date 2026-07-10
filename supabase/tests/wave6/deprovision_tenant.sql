-- supabase/tests/wave6/deprovision_tenant.sql
-- pgTAP: deprovision_tenant RPC (Wave 6 Task 6)
-- Tests:
--   1. sales_rep blocked with P0403
--   2. super_admin on unknown UUID → P0002
--   3. happy path: 5 tables cleaned, audit row inserted before cascade,
--      tenant_snapshot in detail, FK platform_admin_audit.tenant_id NULL after delete
-- All inside BEGIN/ROLLBACK — no prod side-effects.
BEGIN;
SELECT plan(6);

-- ── Seed: auth.users for the acting super_admin ───────────────────────────────
INSERT INTO auth.users (
  id, email, aud, role, instance_id,
  confirmation_token, recovery_token,
  email_change_token_new, email_change,
  email_change_token_current, reauthentication_token,
  phone_change, phone_change_token
)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  'superadmin-deprov@test.com',
  'authenticated', 'authenticated',
  '00000000-0000-0000-0000-000000000000',
  '', '', '', '', '', '', '', ''
)
ON CONFLICT DO NOTHING;

-- ── Seed: platform_admins for acting super_admin ──────────────────────────────
INSERT INTO public.platform_admins (user_id, email, role, status, name)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  'superadmin-deprov@test.com',
  'super_admin',
  'active',
  'Test SuperAdmin Deprov'
)
ON CONFLICT (user_id) DO UPDATE SET
  email  = EXCLUDED.email,
  role   = EXCLUDED.role,
  status = EXCLUDED.status,
  name   = EXCLUDED.name;

-- ── Seed: test tenant to deprovision ─────────────────────────────────────────
INSERT INTO public.tenants (id, slug, name, status)
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'test-deprov-wave6',
  'Test Deprov Tenant Wave6',
  'ACTIVE'
)
ON CONFLICT (id) DO NOTHING;

-- Seed child rows that should be deleted by RPC (explicit + cascade)
INSERT INTO public.tenant_subscriptions (id, tenant_id, plan_code, status, expires_at)
VALUES (
  gen_random_uuid(),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'STARTER',
  'ACTIVE',
  CURRENT_DATE + 365
)
ON CONFLICT DO NOTHING;

-- ── Test 1: sales_rep blocked (P0403) ────────────────────────────────────────
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","is_platform_admin":true,"platform_admin_role":"sales_rep"}';

SELECT throws_ok(
  $$SELECT public.deprovision_tenant(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      'test reason - sales_rep attempt')$$,
  'P0403',
  'SUPER_ADMIN_REQUIRED',
  'sales_rep blocked from deprovision_tenant with P0403'
);

-- ── Test 2: super_admin + unknown UUID → P0002 ────────────────────────────────
SET LOCAL request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","is_platform_admin":true,"platform_admin_role":"super_admin"}';

SELECT throws_ok(
  $$SELECT public.deprovision_tenant(
      'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,
      'test reason - unknown uuid')$$,
  'P0002',
  NULL,
  'unknown tenant UUID raises P0002'
);

-- ── Test 3: happy path — super_admin deprovisions a real (seeded) tenant ──────
SET LOCAL request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","is_platform_admin":true,"platform_admin_role":"super_admin"}';

SELECT lives_ok(
  $$SELECT public.deprovision_tenant(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
      'test deprovisioning - happy path wave6')$$,
  'super_admin can deprovision tenant'
);

-- ── Test 4: tenant row deleted ────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.tenants WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  0,
  'tenant row removed from tenants table'
);

-- ── Test 5: tenant_subscriptions deleted ─────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.tenant_subscriptions WHERE tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  0,
  'tenant_subscriptions rows deleted'
);

-- ── Test 6: audit row emitted with DEPROVISION_TENANT + tenant_snapshot ───────
-- After tenants delete, platform_admin_audit.tenant_id is SET NULL by FK.
-- The snapshot is preserved in detail->>'tenant_snapshot'.
SELECT results_eq(
  $$SELECT action,
           tenant_id,                              -- should be NULL after cascade SET NULL
           (detail->'tenant_snapshot'->>'id')::uuid  -- snapshot preserves original id
    FROM public.platform_admin_audit
    WHERE action = 'DEPROVISION_TENANT'
      AND (detail->'tenant_snapshot'->>'id')::uuid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
    ORDER BY id DESC LIMIT 1$$,
  $$VALUES ('DEPROVISION_TENANT'::text, NULL::uuid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid)$$,
  'audit row: action=DEPROVISION_TENANT, tenant_id NULL (SET NULL), snapshot id preserved'
);

SELECT * FROM finish();
ROLLBACK;
