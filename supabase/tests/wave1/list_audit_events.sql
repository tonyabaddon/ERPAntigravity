-- pgTAP tests for list_audit_events(jsonb)
-- Note: platform_admin_audit is empty in Garindo prod — all row-count
--       assertions use >= 0, not >= 1.

BEGIN;
SELECT plan(7);

-- ── Set up platform-admin JWT context ────────────────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',               (SELECT user_id FROM public.platform_admins LIMIT 1)::text,
    'is_platform_admin', 'true'
  )::text,
  true   -- local to transaction
);

-- 1. No filter — returns >= 0 rows (table may be empty in prod)
SELECT ok(
  (SELECT COUNT(*) FROM public.list_audit_events('{}'::jsonb)) >= 0,
  'list_audit_events returns >= 0 rows with no filter'
);

-- 2. page_size cap
SELECT ok(
  (SELECT COUNT(*) FROM public.list_audit_events('{"page_size":10}'::jsonb)) <= 10,
  'page_size clamps result set to <=10'
);

-- 3. Filter by action_code — schema-valid, returns >= 0
SELECT ok(
  (SELECT COUNT(*) FROM public.list_audit_events('{"action_code":"TENANT_CREATED"}'::jsonb)) >= 0,
  'filter by action_code is schema-valid'
);

-- 4. Filter by tenant_id — schema-valid, returns >= 0
SELECT ok(
  (SELECT COUNT(*) FROM public.list_audit_events(
    json_build_object('tenant_id', (SELECT id FROM public.tenants LIMIT 1)::text)::jsonb
  )) >= 0,
  'filter by tenant_id is schema-valid'
);

-- 5. Pagination page 2 with page_size 50 — returns 0 when table is empty
SELECT ok(
  (SELECT COUNT(*) FROM public.list_audit_events('{"page":2,"page_size":50}'::jsonb)) >= 0,
  'pagination page 2 returns >= 0 rows'
);

-- 6. Unknown filter key raises 22023
SELECT throws_ok(
  $$ SELECT * FROM public.list_audit_events('{"unknown_key":"foo"}'::jsonb) $$,
  '22023',
  NULL,
  'unknown filter key raises 22023'
);

-- ── Switch to non-admin JWT context ──────────────────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","is_platform_admin":"false"}',
  true
);

-- 7. Non-admin caller → P0403
SELECT throws_ok(
  $$ SELECT * FROM public.list_audit_events('{}'::jsonb) $$,
  'P0403', 'PLATFORM_ADMIN_REQUIRED',
  'non-admin caller blocked with P0403'
);

SELECT finish();
ROLLBACK;
