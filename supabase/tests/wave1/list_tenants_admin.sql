BEGIN;
SELECT plan(9);

-- ============================================================
-- pgTAP: list_tenants_admin + v_tenant_usage_summary
-- Platform admin UUID: 227c28f4-09f6-4dc9-af7a-01b0feb2c194
-- Garindo tenant_id:   11111111-1111-1111-1111-111111111111
-- ============================================================

-- Helper: set platform admin JWT context
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',               '227c28f4-09f6-4dc9-af7a-01b0feb2c194',
    'is_platform_admin', 'true'
  )::text,
  true
);

-- Case 1: Non-platform-admin caller → raises P0403
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","is_platform_admin":"false"}',
  true
);
SELECT throws_ok(
  $$ SELECT * FROM public.list_tenants_admin('{}'::jsonb) $$,
  'P0403',
  'PLATFORM_ADMIN_REQUIRED',
  'Case 1: non-admin blocked with P0403'
);

-- Restore platform admin context for remaining tests
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',               '227c28f4-09f6-4dc9-af7a-01b0feb2c194',
    'is_platform_admin', 'true'
  )::text,
  true
);

-- Case 2: Platform-admin, no filters → returns Garindo (only tenant)
SELECT ok(
  (SELECT COUNT(*) FROM public.list_tenants_admin('{}'::jsonb)) >= 1,
  'Case 2: no-filter returns at least Garindo'
);

-- Case 3: Filter plan_code=PREMIUM → returns Garindo
SELECT ok(
  (SELECT COUNT(*) FROM public.list_tenants_admin('{"plan_code":"PREMIUM"}'::jsonb)) >= 1,
  'Case 3: plan_code=PREMIUM returns Garindo'
);

-- Case 4: Filter plan_code=STARTER → 0 rows
SELECT is(
  (SELECT COUNT(*) FROM public.list_tenants_admin('{"plan_code":"STARTER"}'::jsonb))::INT,
  0,
  'Case 4: plan_code=STARTER returns 0 rows'
);

-- Case 5: Pagination page=2, page_size=1 → 0 rows (only 1 tenant exists)
SELECT is(
  (SELECT COUNT(*) FROM public.list_tenants_admin('{"page":2,"page_size":1}'::jsonb))::INT,
  0,
  'Case 5: page=2,page_size=1 returns 0 rows (only Garindo exists)'
);

-- Case 6: Sort by created_at desc → at least 1 row returned without error
SELECT ok(
  (SELECT COUNT(*) FROM public.list_tenants_admin('{"sort_by":"created_at","sort_dir":"desc"}'::jsonb)) >= 1,
  'Case 6: sort_by=created_at,sort_dir=desc returns rows without error'
);

-- Case 7: search=Garindo → returns Garindo
SELECT ok(
  (SELECT COUNT(*) FROM public.list_tenants_admin('{"search":"Garindo"}'::jsonb)) >= 1,
  'Case 7: search=Garindo returns Garindo'
);

-- Case 8: Invalid filter key → raises 22023
SELECT throws_ok(
  $$ SELECT * FROM public.list_tenants_admin('{"unknown_key":"x"}'::jsonb) $$,
  '22023',
  NULL,
  'Case 8: unknown filter key raises 22023'
);

-- Case 9: v_tenant_usage_summary returns Garindo row with sensible values
SELECT ok(
  (SELECT COUNT(*) FROM public.v_tenant_usage_summary
   WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid) = 1,
  'Case 9: v_tenant_usage_summary has Garindo row'
);

SELECT finish();
ROLLBACK;
