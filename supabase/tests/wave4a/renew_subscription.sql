BEGIN;
SELECT plan(5);

-- ============================================================
-- pgTAP: renew_subscription RPC
-- Platform admin UUID: 227c28f4-09f6-4dc9-af7a-01b0feb2c194
-- Garindo tenant_id:   11111111-1111-1111-1111-111111111111
-- ============================================================

-- ── Case 1: Non-admin caller → raises P0403 ──────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","is_platform_admin":"false"}',
  true
);
SELECT throws_ok(
  $$ SELECT public.renew_subscription(
       '11111111-1111-1111-1111-111111111111'::uuid,
       CURRENT_DATE + 365
     ) $$,
  'P0403',
  'PLATFORM_ADMIN_REQUIRED',
  'Case 1: non-admin blocked with P0403'
);

-- Restore admin JWT for remaining cases
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',               '227c28f4-09f6-4dc9-af7a-01b0feb2c194',
    'is_platform_admin', 'true'
  )::text,
  true
);

-- ── Case 2: Bad p_tenant_id (nil uuid) → raises P0404 ───────────────────
SELECT throws_ok(
  $$ SELECT public.renew_subscription(
       '00000000-0000-0000-0000-000000000000'::uuid,
       CURRENT_DATE + 365
     ) $$,
  'P0404',
  'TENANT_NOT_FOUND',
  'Case 2: unknown tenant raises P0404'
);

-- ── Case 3: p_new_expires_at = CURRENT_DATE → raises 22023 ───────────────
SELECT throws_ok(
  $$ SELECT public.renew_subscription(
       '11111111-1111-1111-1111-111111111111'::uuid,
       CURRENT_DATE
     ) $$,
  '22023',
  'INVALID_EXPIRES_AT',
  'Case 3: today date raises 22023 INVALID_EXPIRES_AT'
);

-- ── Case 4: Invalid p_new_plan_code = 'BOGUS' → raises 22023 ─────────────
SELECT throws_ok(
  $$ SELECT public.renew_subscription(
       '11111111-1111-1111-1111-111111111111'::uuid,
       CURRENT_DATE + 365,
       'BOGUS'
     ) $$,
  '22023',
  'INVALID_PLAN_CODE',
  'Case 4: bogus plan code raises 22023 INVALID_PLAN_CODE'
);

-- ── Case 5: Happy path (all assertions inside a savepoint) ────────────────
DO $$
DECLARE
  v_before_expires date;
  v_target_expires date;
  v_before_audit   bigint;
BEGIN
  SELECT expires_at INTO v_before_expires
  FROM public.tenant_subscriptions
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid;

  v_target_expires := CURRENT_DATE + 365;

  SELECT COUNT(*) INTO v_before_audit
  FROM public.platform_admin_audit
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND action = 'RENEW_SUBSCRIPTION';

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub',               '227c28f4-09f6-4dc9-af7a-01b0feb2c194',
      'is_platform_admin', 'true'
    )::text,
    true
  );

  PERFORM public.renew_subscription(
    '11111111-1111-1111-1111-111111111111'::uuid,
    v_target_expires,
    NULL,
    'pgTAP happy path'
  );
END $$;

SELECT ok(
  (SELECT expires_at = CURRENT_DATE + 365
   FROM public.tenant_subscriptions
   WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid),
  'Case 5: happy path — expires_at updated to CURRENT_DATE+365'
);

SELECT * FROM finish();
ROLLBACK;
