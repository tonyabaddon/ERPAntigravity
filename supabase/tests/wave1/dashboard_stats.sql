-- pgTAP tests for _get_platform_dashboard_stats()

BEGIN;
SELECT plan(5);

-- ── Set up platform-admin JWT context ────────────────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',               (SELECT user_id FROM public.platform_admins LIMIT 1)::text,
    'is_platform_admin', 'true'
  )::text,
  true
);

-- 1. Returns a non-null jsonb
SELECT isnt(
  public._get_platform_dashboard_stats(),
  NULL,
  '_get_platform_dashboard_stats returns non-null jsonb'
);

-- 2. tenants_total >= 1 (Garindo exists)
SELECT ok(
  (public._get_platform_dashboard_stats()->>'tenants_total')::INT >= 1,
  'tenants_total >= 1 (Garindo present)'
);

-- 3. active_count >= 1 (Garindo is ACTIVE)
SELECT ok(
  (public._get_platform_dashboard_stats()->>'active_count')::INT >= 1,
  'active_count >= 1'
);

-- 4. All required keys present
SELECT ok(
  (public._get_platform_dashboard_stats() ?& ARRAY[
    'tenants_total','active_count','suspended_count',
    'expiring_45d','plans_count','pending_imports'
  ]),
  'all required keys present in result'
);

-- ── Switch to non-admin JWT context ──────────────────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","is_platform_admin":"false"}',
  true
);

-- 5. Non-admin → P0403
SELECT throws_ok(
  $$ SELECT public._get_platform_dashboard_stats() $$,
  'P0403', 'PLATFORM_ADMIN_REQUIRED',
  'non-admin caller blocked with P0403'
);

SELECT finish();
ROLLBACK;
