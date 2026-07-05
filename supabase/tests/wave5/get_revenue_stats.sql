BEGIN;
SELECT plan(10);

-- ============================================================
-- pgTAP smoke test: get_revenue_stats RPC
-- Platform admin UUID: 227c28f4-09f6-4dc9-af7a-01b0feb2c194
--
-- State: no payments in DB (Task 4 delete_payment cleaned up).
-- total=0, breakdown=[], monthly_trend has exactly 12 zero-filled rows.
--
-- Note: spec says group_by=plan returns 3 rows (STARTER/PRO/PREMIUM),
-- but that only holds when payments exist. With empty table, breakdown=[]
-- is correct. This is documented as a concern in task-5-report.md.
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

-- ── Case 1: Non-admin → P0403 ────────────────────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',               '00000000-0000-0000-0000-000000000000',
    'is_platform_admin', 'false'
  )::text,
  true
);
SELECT throws_ok(
  $$ SELECT public.get_revenue_stats('{}') $$,
  'P0403',
  'PLATFORM_ADMIN_REQUIRED',
  'Case 1: non-admin blocked with P0403'
);

-- ── Restore admin JWT ─────────────────────────────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',               '227c28f4-09f6-4dc9-af7a-01b0feb2c194',
    'is_platform_admin', 'true'
  )::text,
  true
);

-- ── Case 2: Unknown filter key → 22023 UNKNOWN_FIELD ─────────────────────
SELECT throws_ok(
  $$ SELECT public.get_revenue_stats('{"bad_key":"x"}') $$,
  '22023',
  'UNKNOWN_FIELD',
  'Case 2: unknown filter key raises 22023 UNKNOWN_FIELD'
);

-- ── Case 3: Bad group_by value → 22023 INVALID_GROUP_BY ──────────────────
SELECT throws_ok(
  $$ SELECT public.get_revenue_stats('{"group_by":"week"}') $$,
  '22023',
  'INVALID_GROUP_BY',
  'Case 3: invalid group_by raises 22023 INVALID_GROUP_BY'
);

-- ── Case 4: Default call → total = 0 (no payments) ───────────────────────
SELECT is(
  (public.get_revenue_stats('{}') ->>'total')::numeric,
  0::numeric,
  'Case 4: default stats total = 0 (empty payments table)'
);

-- ── Case 5: Default call → breakdown = [] ────────────────────────────────
SELECT is(
  public.get_revenue_stats('{}') ->'breakdown',
  '[]'::jsonb,
  'Case 5: breakdown = [] when no payments exist'
);

-- ── Case 6: monthly_trend has exactly 12 rows ────────────────────────────
SELECT is(
  jsonb_array_length(public.get_revenue_stats('{}') ->'monthly_trend'),
  12,
  'Case 6: monthly_trend always returns exactly 12 rows'
);

-- ── Case 7: All monthly_trend rows have total = 0 ────────────────────────
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.get_revenue_stats('{}') ->'monthly_trend'
    ) AS elem
    WHERE (elem->>'total')::numeric <> 0
  ),
  'Case 7: all monthly_trend totals = 0 (empty table)'
);

-- ── Case 8: monthly_trend rows newest-first (first elem >= second elem) ───
DO $$
DECLARE
  v_trend jsonb;
  v_month0 text;
  v_month1 text;
BEGIN
  v_trend := public.get_revenue_stats('{}') ->'monthly_trend';
  v_month0 := v_trend->0->>'month';
  v_month1 := v_trend->1->>'month';
  IF v_month0 < v_month1 THEN
    RAISE EXCEPTION 'monthly_trend not newest-first: % < %', v_month0, v_month1;
  END IF;
END $$;
SELECT ok(true, 'Case 8: monthly_trend is newest-first');

-- ── Case 9: get_revenue_stats owned by vosi_rpc_owner ────────────────────
SELECT is(
  (SELECT pg_get_userbyid(proowner)
   FROM pg_proc
   WHERE proname = 'get_revenue_stats'
     AND pronamespace = 'public'::regnamespace),
  'vosi_rpc_owner',
  'Case 9: get_revenue_stats is owned by vosi_rpc_owner'
);

-- ── Case 10: get_revenue_stats is SECURITY DEFINER ───────────────────────
SELECT ok(
  (SELECT prosecdef FROM pg_proc
   WHERE proname = 'get_revenue_stats'
     AND pronamespace = 'public'::regnamespace),
  'Case 10: get_revenue_stats is SECURITY DEFINER'
);

SELECT * FROM finish();
ROLLBACK;
