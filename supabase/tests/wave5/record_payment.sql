BEGIN;
SELECT plan(12);

-- ============================================================
-- pgTAP: record_payment RPC
-- Platform admin UUID: 227c28f4-09f6-4dc9-af7a-01b0feb2c194
-- Garindo tenant_id:   11111111-1111-1111-1111-111111111111
-- Garindo plan: PREMIUM, price_annual = 9,000,000 IDR
--
-- Coverage thresholds (9M):
--   LUNAS   : >= 9,000,000
--   DP_60   : >= 5,400,000
--   DP_30   : >= 2,700,000
--   OVERDUE : > 0 AND < 2,700,000   (e.g. 1,000,000 → OVERDUE)
--   UNPAID  : 0
-- ============================================================

-- ── Case 1: Non-admin caller → raises P0403 ──────────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","is_platform_admin":"false"}',
  true
);
SELECT throws_ok(
  $$ SELECT public.record_payment('{"tenant_id":"11111111-1111-1111-1111-111111111111",
     "amount":1000000,"payment_method":"CASH","payment_date":"2026-01-01",
     "period_from":"2026-01-01","period_to":"2026-12-31"}'::jsonb) $$,
  'P0403',
  'PLATFORM_ADMIN_REQUIRED',
  'Case 1: non-admin blocked with P0403 PLATFORM_ADMIN_REQUIRED'
);

-- ── Restore admin JWT for remaining cases ────────────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',               '227c28f4-09f6-4dc9-af7a-01b0feb2c194',
    'is_platform_admin', 'true'
  )::text,
  true
);

-- ── Case 2: Unknown key in payload → 22023 UNKNOWN_FIELD ─────────────────────
SELECT throws_ok(
  $$ SELECT public.record_payment('{"tenant_id":"11111111-1111-1111-1111-111111111111",
     "amount":1000000,"payment_method":"CASH","payment_date":"2026-01-01",
     "period_from":"2026-01-01","period_to":"2026-12-31",
     "bogus_key":"x"}'::jsonb) $$,
  '22023',
  'UNKNOWN_FIELD',
  'Case 2: unknown payload key raises 22023 UNKNOWN_FIELD'
);

-- ── Case 3: amount = 0 → 22023 INVALID_AMOUNT ────────────────────────────────
SELECT throws_ok(
  $$ SELECT public.record_payment('{"tenant_id":"11111111-1111-1111-1111-111111111111",
     "amount":0,"payment_method":"CASH","payment_date":"2026-01-01",
     "period_from":"2026-01-01","period_to":"2026-12-31"}'::jsonb) $$,
  '22023',
  'INVALID_AMOUNT',
  'Case 3: amount=0 raises 22023 INVALID_AMOUNT'
);

-- ── Case 4: negative amount → 22023 INVALID_AMOUNT ───────────────────────────
SELECT throws_ok(
  $$ SELECT public.record_payment('{"tenant_id":"11111111-1111-1111-1111-111111111111",
     "amount":-500,"payment_method":"CASH","payment_date":"2026-01-01",
     "period_from":"2026-01-01","period_to":"2026-12-31"}'::jsonb) $$,
  '22023',
  'INVALID_AMOUNT',
  'Case 4: negative amount raises 22023 INVALID_AMOUNT'
);

-- ── Case 5: period_to < period_from → 22023 INVALID_PERIOD ───────────────────
SELECT throws_ok(
  $$ SELECT public.record_payment('{"tenant_id":"11111111-1111-1111-1111-111111111111",
     "amount":1000000,"payment_method":"CASH","payment_date":"2026-01-01",
     "period_from":"2026-12-31","period_to":"2026-01-01"}'::jsonb) $$,
  '22023',
  'INVALID_PERIOD',
  'Case 5: period_to < period_from raises 22023 INVALID_PERIOD'
);

-- ── Case 6: unknown tenant → P0404 TENANT_NOT_FOUND ─────────────────────────
SELECT throws_ok(
  $$ SELECT public.record_payment('{"tenant_id":"00000000-0000-0000-0000-000000000000",
     "amount":1000000,"payment_method":"CASH","payment_date":"2026-01-01",
     "period_from":"2026-01-01","period_to":"2026-12-31"}'::jsonb) $$,
  'P0404',
  'TENANT_NOT_FOUND',
  'Case 6: unknown tenant raises P0404 TENANT_NOT_FOUND'
);

-- ── Case 7: BANK_TRANSFER with no bank_name → 23514 (CHECK constraint) ───────
SELECT throws_ok(
  $$ SELECT public.record_payment('{"tenant_id":"11111111-1111-1111-1111-111111111111",
     "amount":1000000,"payment_method":"BANK_TRANSFER","payment_date":"2026-01-01",
     "period_from":"2026-01-01","period_to":"2026-12-31"}'::jsonb) $$,
  '23514',
  NULL,
  'Case 7: BANK_TRANSFER with no bank_name raises 23514 (payment_bank_required CHECK)'
);

-- ── Case 8: Happy path — BANK_TRANSFER + BCA + 1M IDR → OVERDUE ──────────────
-- 1,000,000 / 9,000,000 = 11.1% → below 30% threshold → OVERDUE
DO $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub',               '227c28f4-09f6-4dc9-af7a-01b0feb2c194',
      'is_platform_admin', 'true'
    )::text,
    true
  );

  v_result := public.record_payment(jsonb_build_object(
    'tenant_id',      '11111111-1111-1111-1111-111111111111',
    'amount',         1000000,
    'payment_method', 'BANK_TRANSFER',
    'bank_name',      'BCA',
    'payment_date',   CURRENT_DATE::text,
    'period_from',    CURRENT_DATE::text,
    'period_to',      (CURRENT_DATE + 365)::text,
    'notes',          'pgTAP case 8'
  ));

  -- Verify coverage_status = OVERDUE for 1M/9M
  IF (v_result ->>'coverage_status') <> 'OVERDUE' THEN
    RAISE EXCEPTION 'Expected OVERDUE but got %', v_result ->>'coverage_status';
  END IF;

  -- Verify coverage_ok = false
  IF (v_result ->>'coverage_ok')::boolean THEN
    RAISE EXCEPTION 'Expected coverage_ok=false but got true';
  END IF;

  -- Verify payment_id is present (UUID shape)
  IF (v_result ->>'payment_id') IS NULL THEN
    RAISE EXCEPTION 'payment_id is NULL in return';
  END IF;
END $$;

-- Case 8a: payment row created in tenant_payments
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.tenant_payments
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
      AND amount = 1000000
      AND payment_method = 'BANK_TRANSFER'
      AND bank_name = 'BCA'
      AND notes = 'pgTAP case 8'
  ),
  'Case 8a: payment row exists in tenant_payments'
);

-- Case 8b: audit row with action=RECORD_PAYMENT exists
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.platform_admin_audit
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
      AND action = 'RECORD_PAYMENT'
      AND (detail ->> 'notes') = 'pgTAP case 8'
  ),
  'Case 8b: RECORD_PAYMENT audit row exists'
);

-- Case 8c: audit_id FK is populated on the payment row
SELECT ok(
  (SELECT audit_id IS NOT NULL
   FROM public.tenant_payments
   WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
     AND notes = 'pgTAP case 8'),
  'Case 8c: audit_id FK is set on the payment row'
);

-- Case 8d: function is owned by postgres
SELECT is(
  (SELECT pg_get_userbyid(proowner)
   FROM pg_proc
   WHERE proname = 'record_payment'
     AND pronamespace = 'public'::regnamespace),
  'postgres',
  'Case 8d: record_payment is owned by postgres'
);

-- Case 8e: function is SECURITY DEFINER
SELECT ok(
  (SELECT prosecdef
   FROM pg_proc
   WHERE proname = 'record_payment'
     AND pronamespace = 'public'::regnamespace),
  'Case 8e: record_payment is SECURITY DEFINER'
);

SELECT * FROM finish();
ROLLBACK;
