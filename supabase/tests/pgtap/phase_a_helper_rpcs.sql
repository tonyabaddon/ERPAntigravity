-- supabase/tests/pgtap/phase_a_helper_rpcs.sql
BEGIN;
SELECT plan(6);

INSERT INTO auth.users (id, email) VALUES
  ('dddd9999-0000-0000-0000-000000000001', 'helper@test'),
  ('eeee9999-0000-0000-0000-000000000001', 'admin@test');
INSERT INTO tenants (id, slug, name) VALUES
  ('dddd1111-0000-0000-0000-000000000001', 'test-helper', 'Test Helper');
INSERT INTO tenant_users (tenant_id, user_id, role) VALUES
  ('dddd1111-0000-0000-0000-000000000001', 'dddd9999-0000-0000-0000-000000000001', 'owner');
INSERT INTO tenant_subscriptions (tenant_id, plan_code, activated_at, expires_at) VALUES
  ('dddd1111-0000-0000-0000-000000000001', 'PRO', '2026-01-01', '2099-12-31');
INSERT INTO platform_admins (user_id, email) VALUES
  ('eeee9999-0000-0000-0000-000000000001', 'admin@test');

-- Test 1: is_platform_admin false for tenant user
PERFORM set_config('request.jwt.claims', '{"sub":"dddd9999-0000-0000-0000-000000000001"}', true);
SELECT is(is_platform_admin(), false, 'is_platform_admin=false for tenant user');

-- Test 2: is_platform_admin true for admin
PERFORM set_config('request.jwt.claims', '{"sub":"eeee9999-0000-0000-0000-000000000001"}', true);
SELECT is(is_platform_admin(), true, 'is_platform_admin=true for platform admin');

-- Test 3: bootstrap_tenant_context returns feature bundle (via JWT-baked claim)
PERFORM set_config('request.jwt.claims',
  '{"sub":"dddd9999-0000-0000-0000-000000000001","tenant_id":"dddd1111-0000-0000-0000-000000000001","tenant_expiry_mode":"ACTIVE","is_platform_admin":false}',
  true);
SELECT is(bootstrap_tenant_context()->>'plan_code', 'PRO', 'bootstrap returns PRO plan');
SELECT is((bootstrap_tenant_context()->'effective_features'->>'modul_tempo')::boolean, true,
          'bootstrap includes modul_tempo=true for PRO');

-- Test 4: bootstrap raises when tenant_id claim missing
PERFORM set_config('request.jwt.claims', '{"sub":"dddd9999-0000-0000-0000-000000000001"}', true);
SELECT throws_ok($$SELECT bootstrap_tenant_context()$$, 'P0400', 'MISSING_TENANT_CONTEXT',
                 'bootstrap raises without tenant_id claim');

-- Test 5: impersonate_tenant rejects non-admin
PERFORM set_config('request.jwt.claims', '{"sub":"dddd9999-0000-0000-0000-000000000001"}', true);
SELECT throws_ok($$SELECT impersonate_tenant('test-helper')$$, 'P0403', 'Not a platform admin',
                 'impersonate_tenant rejects non-admin');

-- Test 6: impersonate_tenant + stop_impersonation write audit rows for admin
PERFORM set_config('request.jwt.claims', '{"sub":"eeee9999-0000-0000-0000-000000000001"}', true);
PERFORM impersonate_tenant('test-helper');
PERFORM stop_impersonation();
SELECT is(
  (SELECT COUNT(*) FROM platform_admin_audit
   WHERE admin_user_id='eeee9999-0000-0000-0000-000000000001'::uuid
     AND action IN ('IMPERSONATE_START','IMPERSONATE_END'))::int,
  2, 'impersonate_tenant + stop_impersonation write both audit rows');

SELECT finish();
ROLLBACK;
