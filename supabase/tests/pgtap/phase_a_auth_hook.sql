-- supabase/tests/pgtap/phase_a_auth_hook.sql
BEGIN;
SELECT plan(7);

-- Helper: invoke hook with simulated event JSON
CREATE OR REPLACE FUNCTION _test_hook(p_uid uuid) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v_event jsonb; v_result jsonb;
BEGIN
  v_event := jsonb_build_object(
    'claims', jsonb_build_object(
      'sub', p_uid::text,
      'aud', 'authenticated',
      'role', 'authenticated',
      'exp', extract(epoch from now())::int + 3600,
      'iat', extract(epoch from now())::int
    )
  );
  RETURN public.custom_access_token_hook(v_event);
END $fn$;

-- Seed: 2 tenants, 2 users, 1 platform admin, 1 orphan user
INSERT INTO auth.users (id, email) VALUES
  ('aaaa9999-0000-0000-0000-000000000001', 'a@test'),
  ('bbbb9999-0000-0000-0000-000000000001', 'b@test'),
  ('cccc9999-0000-0000-0000-000000000001', 'super@test'),
  ('dddd9999-0000-0000-0000-000000000001', 'orphan@test');
INSERT INTO tenants (id, slug, name) VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'test-a', 'Test A'),
  ('bbbb2222-0000-0000-0000-000000000001', 'test-b', 'Test B');
INSERT INTO tenant_users (tenant_id, user_id, role) VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'aaaa9999-0000-0000-0000-000000000001', 'owner'),
  ('bbbb2222-0000-0000-0000-000000000001', 'bbbb9999-0000-0000-0000-000000000001', 'owner');
INSERT INTO tenant_subscriptions (tenant_id, plan_code, activated_at, expires_at) VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'PREMIUM', '2026-01-01', '2099-12-31'),
  ('bbbb2222-0000-0000-0000-000000000001', 'PREMIUM', '2026-01-01', '2020-01-01'); -- expired > 7d
INSERT INTO platform_admins (user_id, email) VALUES ('cccc9999-0000-0000-0000-000000000001', 'super@test');

-- Test 1: normal user A → JWT gets tenant_id = A
SELECT is(
  _test_hook('aaaa9999-0000-0000-0000-000000000001'::uuid) #>> '{claims,tenant_id}',
  'aaaa1111-0000-0000-0000-000000000001',
  'User A: JWT contains tenant_id = A');

-- Test 2: is_platform_admin = false for tenant user
SELECT is(
  _test_hook('aaaa9999-0000-0000-0000-000000000001'::uuid) #>> '{claims,is_platform_admin}',
  'false',
  'User A: is_platform_admin = false');

-- Test 3: expired tenant B → tenant_expiry_mode = READONLY
SELECT is(
  _test_hook('bbbb9999-0000-0000-0000-000000000001'::uuid) #>> '{claims,tenant_expiry_mode}',
  'READONLY',
  'User B (expired > 7d): tenant_expiry_mode = READONLY');

-- Test 4: super-admin without impersonation → no tenant_id claim
SELECT is(
  _test_hook('cccc9999-0000-0000-0000-000000000001'::uuid) #>> '{claims,tenant_id}',
  NULL,
  'Super-admin without impersonation: no tenant_id claim');

-- Test 5: super-admin with impersonation → tenant_id = impersonated tenant
INSERT INTO platform_admin_active_impersonation (admin_user_id, tenant_slug)
VALUES ('cccc9999-0000-0000-0000-000000000001', 'test-a');
SELECT is(
  _test_hook('cccc9999-0000-0000-0000-000000000001'::uuid) #>> '{claims,tenant_id}',
  'aaaa1111-0000-0000-0000-000000000001',
  'Super-admin impersonating test-a: tenant_id = A');

-- Test 6: impersonating claim = true
SELECT is(
  _test_hook('cccc9999-0000-0000-0000-000000000001'::uuid) #>> '{claims,impersonating}',
  'true',
  'Super-admin impersonating: claim impersonating = true');

-- Test 7: orphan user (no tenant_users) → no tenant_id claim
SELECT is(
  _test_hook('dddd9999-0000-0000-0000-000000000001'::uuid) #>> '{claims,tenant_id}',
  NULL,
  'Orphan user: no tenant_id claim');

SELECT finish();
ROLLBACK;
