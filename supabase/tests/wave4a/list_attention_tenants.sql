BEGIN;
SELECT plan(7);

-- Platform admin: 227c28f4-09f6-4dc9-af7a-01b0feb2c194
-- Garindo: 11111111-1111-1111-1111-111111111111

-- ── Case 1: Non-admin → P0403 ──────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","is_platform_admin":false}'::text, true);
SELECT throws_ok(
  $$ SELECT * FROM public.list_attention_tenants(45) $$,
  'P0403', 'PLATFORM_ADMIN_REQUIRED',
  'Case 1: non-admin caller raises P0403'
);

-- Rest as platform admin
SELECT set_config('request.jwt.claims',
  '{"sub":"227c28f4-09f6-4dc9-af7a-01b0feb2c194","is_platform_admin":true}'::text, true);

-- ── Case 2: p_expiry_within_days = 0 → 22023 ──────────────
SELECT throws_ok(
  $$ SELECT * FROM public.list_attention_tenants(0) $$,
  '22023', 'INVALID_RANGE',
  'Case 2: p_expiry_within_days < 1 raises 22023'
);

-- ── Case 3: p_expiry_within_days = 366 → 22023 ─────────────
SELECT throws_ok(
  $$ SELECT * FROM public.list_attention_tenants(366) $$,
  '22023', 'INVALID_RANGE',
  'Case 3: p_expiry_within_days > 365 raises 22023'
);

-- ── Case 4: Baseline — Garindo expires far future, ACTIVE → 0 rows ──
SELECT is(
  (SELECT COUNT(*)::int FROM public.list_attention_tenants(45)),
  0,
  'Case 4: baseline — Garindo not in attention queue'
);

-- ── Case 5: Simulated expiring — Garindo expires_at = today + 10 ──
DO $$
BEGIN
  UPDATE public.tenant_subscriptions
     SET expires_at = CURRENT_DATE + 10
   WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid;
END $$;

SELECT results_eq(
  $$ SELECT attention_reason, days_until_expiry
     FROM public.list_attention_tenants(45)
     WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid $$,
  $$ VALUES ('EXPIRING'::text, 10) $$,
  'Case 5: expiring in 10 days → attention_reason=EXPIRING'
);

-- ── Case 6: Simulated SUSPENDED — expires_at still far future ──
DO $$
BEGIN
  UPDATE public.tenant_subscriptions
     SET expires_at = CURRENT_DATE + 365
   WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid;
  UPDATE public.tenants
     SET status = 'SUSPENDED', suspended_at = now(), suspended_reason = 'test'
   WHERE id = '11111111-1111-1111-1111-111111111111'::uuid;
END $$;

SELECT results_eq(
  $$ SELECT attention_reason
     FROM public.list_attention_tenants(1)
     WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid $$,
  $$ VALUES ('SUSPENDED'::text) $$,
  'Case 6: SUSPENDED with future expiry → attention_reason=SUSPENDED'
);

-- ── Case 7: Simulated EXPIRED + SUSPENDED ──
DO $$
BEGIN
  UPDATE public.tenant_subscriptions
     SET expires_at = CURRENT_DATE - 5
   WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid;
END $$;

SELECT results_eq(
  $$ SELECT attention_reason, days_until_expiry
     FROM public.list_attention_tenants(1)
     WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid $$,
  $$ VALUES ('EXPIRED_AND_SUSPENDED'::text, -5) $$,
  'Case 7: SUSPENDED + expired 5 days ago → EXPIRED_AND_SUSPENDED'
);

SELECT * FROM finish();
ROLLBACK;
