BEGIN;
SELECT plan(9);

-- ============================================================
-- pgTAP: _assert_super_admin_from_jwt + update_plan_admin RPCs
-- Platform admin UUID: 227c28f4-09f6-4dc9-af7a-01b0feb2c194
-- Plans: STARTER, PRO, PREMIUM (all exist in live DB)
-- ============================================================

-- ── Fixture: fake non-super platform admin (in-txn only) ────────────────────
-- We insert directly into platform_admins with role='admin' to simulate a
-- non-super-admin caller. The FK on platform_admins.user_id references
-- auth.users, so we use the real founder UUID as admin_user_id for the audit
-- rows in other tests, and test the super-admin gate by using a fake sub UUID
-- that is present in platform_admins with role='admin'.
--
-- NOTE: platform_admins.user_id → auth.users(id) FK means we cannot insert
-- a completely fake UUID without a matching auth.users row. Instead we test
-- _assert_super_admin_from_jwt directly by pointing sub at a UUID not in
-- platform_admins at all — role lookup returns NULL → raises SUPER_ADMIN_REQUIRED.
-- This covers the gate logic correctly (NULL role = not super_admin).

-- ── Set non-admin JWT for Cases 1–2 ─────────────────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","is_platform_admin":"false"}',
  true
);

-- ── Case 1: update_plan_admin — non-admin caller → P0403 ────────────────────
SELECT throws_ok(
  $$ SELECT public.update_plan_admin('PRO', '{"description":"x"}'::jsonb) $$,
  'P0403',
  'PLATFORM_ADMIN_REQUIRED',
  'Case 1: update_plan_admin non-admin blocked with P0403 PLATFORM_ADMIN_REQUIRED'
);

-- ── Case 2: _assert_super_admin_from_jwt — unknown sub (no platform_admins row)
-- → P0403 SUPER_ADMIN_REQUIRED ───────────────────────────────────────────────
-- sub UUID is not in platform_admins → role lookup returns NULL → gate fires.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","is_platform_admin":"true"}',
  true
);
SELECT throws_ok(
  $$ SELECT public._assert_super_admin_from_jwt() $$,
  'P0403',
  'SUPER_ADMIN_REQUIRED',
  'Case 2: _assert_super_admin_from_jwt — unknown sub (NULL role) blocked with P0403 SUPER_ADMIN_REQUIRED'
);

-- ── Restore super-admin JWT for remaining cases ──────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',               '227c28f4-09f6-4dc9-af7a-01b0feb2c194',
    'is_platform_admin', 'true'
  )::text,
  true
);

-- ── Case 3: update_plan_admin — invalid plan_code → 22023 INVALID_PLAN_CODE ─
SELECT throws_ok(
  $$ SELECT public.update_plan_admin('ENTERPRISE', '{"description":"x"}'::jsonb) $$,
  '22023',
  'INVALID_PLAN_CODE',
  'Case 3: update_plan_admin invalid plan_code ENTERPRISE raises 22023 INVALID_PLAN_CODE'
);

-- ── Case 4: update_plan_admin — unknown update key → 22023 UNKNOWN_FIELD ────
SELECT throws_ok(
  $$ SELECT public.update_plan_admin('PRO', '{"bogus":1}'::jsonb) $$,
  '22023',
  'UNKNOWN_FIELD',
  'Case 4: update_plan_admin unknown key {bogus} raises 22023 UNKNOWN_FIELD'
);

-- ── Case 5: Happy path — update PRO description ─────────────────────────────
DO $$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub',               '227c28f4-09f6-4dc9-af7a-01b0feb2c194',
      'is_platform_admin', 'true'
    )::text,
    true
  );
  PERFORM public.update_plan_admin('PRO', '{"description":"pgtap-test-description"}'::jsonb);
END $$;

-- Case 5a: return value has ok=true and plan_code=PRO
SELECT ok(
  (SELECT (public.update_plan_admin('PRO', '{"description":"pgtap-test-description-2"}'::jsonb) ->> 'ok')::boolean),
  'Case 5a: update_plan_admin returns ok=true'
);

-- Case 5b: returned updated_keys contains description
SELECT ok(
  (SELECT (public.update_plan_admin('PRO', '{"description":"pgtap-test-description-3"}'::jsonb) -> 'updated_keys') @> '["description"]'::jsonb),
  'Case 5b: update_plan_admin returns updated_keys containing description'
);

-- Case 5c: plan row description was updated (using the last call above)
SELECT is(
  (SELECT description FROM public.plans WHERE code = 'PRO'),
  'pgtap-test-description-3',
  'Case 5c: PRO plan description updated in plans table'
);

-- Case 5d: audit row with action=UPDATE_PLAN and tenant_id=NULL exists
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.platform_admin_audit
    WHERE action    = 'UPDATE_PLAN'
      AND tenant_id IS NULL
      AND detail->>'plan_code' = 'PRO'
  ),
  'Case 5d: UPDATE_PLAN audit row with tenant_id=NULL exists for PRO'
);

-- Case 5e: _assert_super_admin_from_jwt passes for the real founder
SELECT lives_ok(
  $$ SELECT public._assert_super_admin_from_jwt() $$,
  'Case 5e: _assert_super_admin_from_jwt passes for founder super_admin'
);

SELECT * FROM finish();
ROLLBACK;
