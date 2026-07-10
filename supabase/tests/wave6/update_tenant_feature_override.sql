-- pgTAP tests: update_tenant_feature_override RPC
-- Wave 6 Task 11
-- plan(5): happy-path super_admin, happy-path sales_rep (same guard),
--          non-admin → P0403, invalid tenant → P0002,
--          toggle changes effective_features via view.
-- All in BEGIN/ROLLBACK so no state leaks to other tests.

BEGIN;

SELECT plan(5);

-- ─── Helpers ──────────────────────────────────────────────────────────────────

-- Enable is_platform_admin in the fake JWT so _is_platform_admin_from_jwt() passes
CREATE OR REPLACE FUNCTION _t11_set_admin_jwt(p_uid UUID) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object(
      'sub',               p_uid,
      'role',              'authenticated',
      'is_platform_admin', true
    )::text,
    true);
END;
$$;

CREATE OR REPLACE FUNCTION _t11_set_nonadmin_jwt() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object(
      'sub',               gen_random_uuid(),
      'role',              'authenticated',
      'is_platform_admin', false
    )::text,
    true);
END;
$$;

-- ─── Seed fake admin ──────────────────────────────────────────────────────────

-- Use an existing auth.users row if present, otherwise a fixed UUID
-- The function checks platform_admins for email, so insert a stub
DO $$
DECLARE v_uid UUID := '99990000-0000-0000-0000-000000000001';
BEGIN
  -- Insert into platform_admins so the audit INSERT sub-select returns an email
  INSERT INTO public.platform_admins (user_id, email, role, status)
  VALUES (v_uid, 'test-admin@example.com', 'super_admin', 'ACTIVE')
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

-- ─── Test 1: super_admin can toggle — happy path ──────────────────────────────

SELECT lives_ok(
  $$
    SELECT _t11_set_admin_jwt('99990000-0000-0000-0000-000000000001'::UUID);
    PERFORM public.update_tenant_feature_override(
      '11111111-1111-1111-1111-111111111111'::UUID,
      'modul_kasir',
      false,
      'pgTAP test'
    );
  $$,
  'super_admin can toggle a module (happy path)'
);

-- ─── Test 2: sales_rep (same is_platform_admin=true guard) can toggle ─────────
-- Note: both super_admin and sales_rep have is_platform_admin=true in JWT;
-- the guard does not distinguish them — that is the intended Wave 6 dual-role spec.

SELECT lives_ok(
  $$
    SELECT _t11_set_admin_jwt('99990000-0000-0000-0000-000000000001'::UUID);
    PERFORM public.update_tenant_feature_override(
      '11111111-1111-1111-1111-111111111111'::UUID,
      'modul_tempo',
      false,
      'sales_rep test'
    );
  $$,
  'sales_rep (is_platform_admin=true) can toggle a module'
);

-- ─── Test 3: non-platform-admin → P0403 ──────────────────────────────────────

SELECT throws_matching(
  $$
    SELECT _t11_set_nonadmin_jwt();
    PERFORM public.update_tenant_feature_override(
      '11111111-1111-1111-1111-111111111111'::UUID,
      'modul_kasir', false, null
    );
  $$,
  'P0403',
  'non-platform-admin gets P0403'
);

-- ─── Test 4: invalid tenant_id → P0002 ────────────────────────────────────────

SELECT throws_matching(
  $$
    SELECT _t11_set_admin_jwt('99990000-0000-0000-0000-000000000001'::UUID);
    PERFORM public.update_tenant_feature_override(
      '00000000-0000-0000-0000-000000000000'::UUID,
      'modul_kasir', false, null
    );
  $$,
  'P0002',
  'invalid tenant_id gets P0002'
);

-- ─── Test 5: toggle changes effective_features via view ───────────────────────

SELECT is(
  (
    SELECT (effective_features->>'modul_kasir')::boolean
    FROM public.v_tenant_effective_features
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
  ),
  false,
  'v_tenant_effective_features reflects the toggle written in test 1'
);

SELECT * FROM finish();

ROLLBACK;
