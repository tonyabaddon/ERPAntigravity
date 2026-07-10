-- Wave 6 Task 2: narrow RPC gates pgTAP test
-- Verifies: sales_rep is blocked from suspend_tenant / activate_tenant / renew_subscription
--           with errcode P0403
-- Note: Seeds its own test tenant; ROLLBACK at end — no side effects on prod.
BEGIN;
SELECT plan(3);

-- ── Seed test tenant ──────────────────────────────────────────────────────────
-- Insert as superuser before dropping to authenticated role.
INSERT INTO public.tenants (id, slug, name, status)
  VALUES ('99999999-9999-9999-9999-999999999999'::uuid, 'test-narrow-wave6', 'Test Narrow Wave6', 'ACTIVE')
  ON CONFLICT (id) DO NOTHING;

-- ── Simulate sales_rep JWT ────────────────────────────────────────────────────
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","is_platform_admin":true,"platform_admin_role":"sales_rep"}';

-- 1. sales_rep CANNOT call suspend_tenant (super_admin required)
SELECT throws_ok(
  $$SELECT public.suspend_tenant('99999999-9999-9999-9999-999999999999'::uuid, 'test reason')$$,
  'P0403',
  'SUPER_ADMIN_REQUIRED',
  'sales_rep blocked from suspend_tenant'
);

-- 2. sales_rep CANNOT call activate_tenant
SELECT throws_ok(
  $$SELECT public.activate_tenant('99999999-9999-9999-9999-999999999999'::uuid)$$,
  'P0403',
  'SUPER_ADMIN_REQUIRED',
  'sales_rep blocked from activate_tenant'
);

-- 3. sales_rep CANNOT call renew_subscription
SELECT throws_ok(
  $$SELECT public.renew_subscription('99999999-9999-9999-9999-999999999999'::uuid, CURRENT_DATE + 365, NULL, NULL)$$,
  'P0403',
  'SUPER_ADMIN_REQUIRED',
  'sales_rep blocked from renew_subscription'
);

SELECT finish();
ROLLBACK;
