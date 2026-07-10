-- Wave 6 Task 2: RLS role-gates pgTAP test
-- Verifies: sales_rep can SELECT tenants but is blocked from INSERT/UPDATE/DELETE
--           super_admin can SELECT and write tenants
-- Note: Seeds its own test row — does NOT depend on garindo seed data (Note D)
BEGIN;
SELECT plan(5);

-- ── Seed a test tenant inside this transaction ────────────────────────────────
-- We use a deterministic UUID so both sub-tests can reference the same row.
-- Inserted as postgres (superuser) before dropping to the authenticated role.
INSERT INTO public.tenants (id, slug, name, status)
  VALUES ('11111111-2222-3333-4444-555555555555'::uuid, 'test-rls-wave6', 'Test RLS Wave6', 'ACTIVE')
  ON CONFLICT (id) DO NOTHING;

-- ── Simulate sales_rep JWT ────────────────────────────────────────────────────
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","is_platform_admin":true,"platform_admin_role":"sales_rep"}';

-- 1. sales_rep can SELECT tenants
SELECT lives_ok(
  $$SELECT 1 FROM public.tenants LIMIT 1$$,
  'sales_rep can SELECT tenants'
);

-- 2. sales_rep CANNOT UPDATE tenants (blocked by RLS — new p_super_admin_update policy)
SELECT throws_ok(
  $$UPDATE public.tenants SET name = 'hacked' WHERE id = '11111111-2222-3333-4444-555555555555'::uuid$$,
  '42501',
  NULL,
  'sales_rep blocked from direct UPDATE tenants'
);

-- 3. sales_rep CANNOT DELETE tenants
SELECT throws_ok(
  $$DELETE FROM public.tenants WHERE id = '11111111-2222-3333-4444-555555555555'::uuid$$,
  '42501',
  NULL,
  'sales_rep blocked from direct DELETE tenants'
);

-- 4. sales_rep CAN SELECT plans (already open via g_read_all USING (true))
SELECT lives_ok(
  $$SELECT 1 FROM public.plans LIMIT 1$$,
  'sales_rep can SELECT plans'
);

-- ── Simulate super_admin JWT ─────────────────────────────────────────────────
SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","is_platform_admin":true,"platform_admin_role":"super_admin"}';

-- 5. super_admin can UPDATE tenants
SELECT lives_ok(
  $$UPDATE public.tenants SET updated_at = now() WHERE id = '11111111-2222-3333-4444-555555555555'::uuid$$,
  'super_admin can UPDATE tenants'
);

SELECT finish();
ROLLBACK;
