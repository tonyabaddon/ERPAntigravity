-- pgTAP tests for list_tenant_users_admin(p_tenant_id uuid)
-- Smoke-verified 2026-07-05: Garindo returns 3 rows; non-admin blocked with P0403.
-- Note: function owned by postgres (not vosi_rpc_owner) due to auth schema USAGE
-- restriction — supabase_admin owns auth schema; postgres has USAGE but not
-- WITH GRANT OPTION so cannot re-grant to vosi_rpc_owner. See migration
-- 20261115000005b for the ownership fix rationale.

BEGIN;
SELECT plan(3);

-- ── Set up platform-admin JWT context ────────────────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',               (SELECT user_id FROM public.platform_admins LIMIT 1)::text,
    'is_platform_admin', 'true'
  )::text,
  true   -- local to transaction
);

-- 1. Admin gets >= 1 rows for Garindo tenant
SELECT ok(
  (SELECT COUNT(*) FROM public.list_tenant_users_admin(
    (SELECT id FROM public.tenants WHERE slug = 'garindo' LIMIT 1)
  )) >= 1,
  'list_tenant_users_admin returns >= 1 row for Garindo tenant'
);

-- 2. All returned rows have non-null required fields
SELECT ok(
  (SELECT bool_and(
    user_id IS NOT NULL
    AND email IS NOT NULL
    AND full_name IS NOT NULL
    AND role IS NOT NULL
    AND status IS NOT NULL
  )
  FROM public.list_tenant_users_admin(
    (SELECT id FROM public.tenants WHERE slug = 'garindo' LIMIT 1)
  )),
  'all rows have non-null user_id, email, full_name, role, status'
);

-- ── Switch to non-admin JWT context ──────────────────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","is_platform_admin":"false"}',
  true
);

-- 3. Non-admin caller → P0403
SELECT throws_ok(
  $$ SELECT * FROM public.list_tenant_users_admin('00000000-0000-0000-0000-000000000000'::uuid) $$,
  'P0403', 'PLATFORM_ADMIN_REQUIRED',
  'non-admin caller blocked with P0403'
);

SELECT finish();
ROLLBACK;
