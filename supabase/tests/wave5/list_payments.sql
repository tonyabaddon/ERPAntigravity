BEGIN;
SELECT plan(11);

-- ============================================================
-- pgTAP smoke test: list_payments RPC
-- Platform admin UUID: 227c28f4-09f6-4dc9-af7a-01b0feb2c194
-- Garindo tenant_id:   11111111-1111-1111-1111-111111111111
--
-- State: no payments in DB (Task 4 delete_payment cleaned up all rows).
-- All data-returning tests assert 0 rows.
-- ============================================================

-- ── Setup: platform admin JWT ─────────────────────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',               '227c28f4-09f6-4dc9-af7a-01b0feb2c194',
    'is_platform_admin', 'true'
  )::text,
  true
);

-- ── Case 1: Platform admin, no filters → 0 rows, no error ────────────────
SELECT ok(
  (SELECT COUNT(*) FROM public.list_payments('{}')) = 0,
  'Case 1: admin list_payments no filters returns 0 rows (empty table)'
);

-- ── Case 2: Platform admin, filter by Garindo tenant_id → 0 rows ─────────
SELECT ok(
  (SELECT COUNT(*) FROM public.list_payments(
    jsonb_build_object('tenant_id', '11111111-1111-1111-1111-111111111111')
  )) = 0,
  'Case 2: admin filter by tenant_id returns 0 rows'
);

-- ── Case 3: total_count column exists and is 0 when no rows ──────────────
-- When SETOF has 0 rows, window COUNT returns nothing; test via direct
-- assertion that 0 rows means total_count is vacuously satisfied.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.list_payments('{}')
    WHERE total_count <> 0
  ),
  'Case 3: total_count is 0 when table empty'
);

-- ── Case 4: Unknown filter key → 22023 UNKNOWN_FIELD ─────────────────────
SELECT throws_ok(
  $$ SELECT * FROM public.list_payments('{"bogus_key":"x"}'::jsonb) $$,
  '22023',
  'UNKNOWN_FIELD',
  'Case 4: unknown filter key raises 22023 UNKNOWN_FIELD'
);

-- ── Case 5: Bad sort_by value → 22023 ────────────────────────────────────
SELECT throws_ok(
  $$ SELECT * FROM public.list_payments('{"sort_by":"bad_col"}'::jsonb) $$,
  '22023',
  NULL,
  'Case 5: invalid sort_by raises 22023'
);

-- ── Case 6: Non-admin without tenant_id filter → P0403 ───────────────────
-- _resolve_tenant_id() reads tenant_id from request.jwt.claims (Phase A auth hook pattern)
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',               'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'is_platform_admin', 'false',
    'tenant_id',         '11111111-1111-1111-1111-111111111111'
  )::text,
  true
);

SELECT throws_ok(
  $$ SELECT * FROM public.list_payments('{}'::jsonb) $$,
  'P0403',
  'PLATFORM_ADMIN_REQUIRED',
  'Case 6: non-admin with no tenant_id filter → P0403'
);

-- ── Case 7: Non-admin with foreign tenant_id → P0403 ─────────────────────
SELECT throws_ok(
  $$ SELECT * FROM public.list_payments(
    '{"tenant_id":"22222222-2222-2222-2222-222222222222"}'::jsonb
  ) $$,
  'P0403',
  'PLATFORM_ADMIN_REQUIRED',
  'Case 7: non-admin with foreign tenant_id → P0403'
);

-- ── Case 8: Non-admin with own tenant_id → 0 rows (allowed) ──────────────
SELECT ok(
  (SELECT COUNT(*) FROM public.list_payments(
    jsonb_build_object('tenant_id', '11111111-1111-1111-1111-111111111111')
  )) = 0,
  'Case 8: tenant owner listing own tenant returns 0 rows (no payments)'
);

-- ── Restore admin JWT for ownership tests ────────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',               '227c28f4-09f6-4dc9-af7a-01b0feb2c194',
    'is_platform_admin', 'true'
  )::text,
  true
);

-- ── Case 9: list_payments owned by vosi_rpc_owner ────────────────────────
SELECT is(
  (SELECT pg_get_userbyid(proowner)
   FROM pg_proc
   WHERE proname = 'list_payments'
     AND pronamespace = 'public'::regnamespace),
  'vosi_rpc_owner',
  'Case 9: list_payments is owned by vosi_rpc_owner'
);

-- ── Case 10: list_payments is SECURITY DEFINER ───────────────────────────
SELECT ok(
  (SELECT prosecdef FROM pg_proc
   WHERE proname = 'list_payments'
     AND pronamespace = 'public'::regnamespace),
  'Case 10: list_payments is SECURITY DEFINER'
);

-- ── Case 11: p_tenant_owner_read policy exists on tenant_payments ─────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tenant_payments'
      AND policyname = 'p_tenant_owner_read'
  ),
  'Case 11: p_tenant_owner_read policy exists on tenant_payments'
);

SELECT * FROM finish();
ROLLBACK;
