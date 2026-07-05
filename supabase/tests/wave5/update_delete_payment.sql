BEGIN;
SELECT plan(18);

-- ============================================================
-- pgTAP: update_payment + delete_payment RPCs
-- Platform admin UUID: 227c28f4-09f6-4dc9-af7a-01b0feb2c194
-- Garindo tenant_id:   11111111-1111-1111-1111-111111111111
-- Garindo plan: PREMIUM, price_annual = 9,000,000 IDR
--
-- Coverage thresholds (9M):
--   DP_30 : >= 2,700,000 AND < 5,400,000   (e.g. 3,000,000 → DP_30)
--   OVERDUE: > 0 AND < 2,700,000           (e.g. 1,000,000 → OVERDUE)
--   UNPAID : 0 (no payments this year)
-- ============================================================

-- ── Fixture: admin JWT ────────────────────────────────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',               '227c28f4-09f6-4dc9-af7a-01b0feb2c194',
    'is_platform_admin', 'true'
  )::text,
  true
);

-- ── Fixture: insert a seed payment to operate on ─────────────────────────────
-- We insert a known payment row directly (no need to call record_payment here).
-- Uses a fixed UUID so we can reference it deterministically.
INSERT INTO public.tenant_payments (
  id,
  tenant_id,
  amount,
  currency,
  payment_method,
  bank_name,
  payment_date,
  period_from,
  period_to,
  notes,
  recorded_by_admin,
  audit_id
) VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  '11111111-1111-1111-1111-111111111111'::uuid,
  1000000,
  'IDR',
  'BANK_TRANSFER',
  'BCA',
  CURRENT_DATE,
  CURRENT_DATE,
  CURRENT_DATE + 365,
  'pgtap seed payment',
  '227c28f4-09f6-4dc9-af7a-01b0feb2c194'::uuid,
  NULL
);

-- ════════════════════════════════════════════════════════════════════════════
-- update_payment tests
-- ════════════════════════════════════════════════════════════════════════════

-- ── Case 1: Non-admin caller → P0403 ─────────────────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","is_platform_admin":"false"}',
  true
);
SELECT throws_ok(
  $$ SELECT public.update_payment(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
       '{"amount":2000000}'::jsonb
     ) $$,
  'P0403',
  'PLATFORM_ADMIN_REQUIRED',
  'Case 1: update_payment non-admin blocked with P0403'
);

-- ── Restore admin JWT ─────────────────────────────────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',               '227c28f4-09f6-4dc9-af7a-01b0feb2c194',
    'is_platform_admin', 'true'
  )::text,
  true
);

-- ── Case 2: Unknown key in p_updates → 22023 UNKNOWN_FIELD ───────────────────
SELECT throws_ok(
  $$ SELECT public.update_payment(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
       '{"bogus_key":"x"}'::jsonb
     ) $$,
  '22023',
  'UNKNOWN_FIELD',
  'Case 2: update_payment unknown key raises 22023 UNKNOWN_FIELD'
);

-- ── Case 3: tenant_id key rejected (not in whitelist) → 22023 UNKNOWN_FIELD ──
SELECT throws_ok(
  $$ SELECT public.update_payment(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
       '{"tenant_id":"11111111-1111-1111-1111-111111111111"}'::jsonb
     ) $$,
  '22023',
  'UNKNOWN_FIELD',
  'Case 3: update_payment tenant_id key (blocked) raises 22023 UNKNOWN_FIELD'
);

-- ── Case 4: Payment not found → P0404 PAYMENT_NOT_FOUND ──────────────────────
SELECT throws_ok(
  $$ SELECT public.update_payment(
       '00000000-0000-0000-0000-000000000000'::uuid,
       '{"amount":2000000}'::jsonb
     ) $$,
  'P0404',
  'PAYMENT_NOT_FOUND',
  'Case 4: update_payment unknown payment_id raises P0404 PAYMENT_NOT_FOUND'
);

-- ── Case 5: Happy path — update amount from 1M to 3M ─────────────────────────
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

  v_result := public.update_payment(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    '{"amount":3000000}'::jsonb
  );

  IF NOT (v_result ->>'ok')::boolean THEN
    RAISE EXCEPTION 'Expected ok=true but got %', v_result;
  END IF;

  IF (v_result ->>'payment_id') <> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' THEN
    RAISE EXCEPTION 'payment_id mismatch: %', v_result ->>'payment_id';
  END IF;
END $$;

-- Case 5a: amount updated in tenant_payments
SELECT is(
  (SELECT amount FROM public.tenant_payments
   WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  3000000::numeric,
  'Case 5a: update_payment — amount updated to 3,000,000'
);

-- Case 5b: updated_at was touched
SELECT ok(
  (SELECT updated_at > created_at FROM public.tenant_payments
   WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'Case 5b: update_payment — updated_at > created_at after update'
);

-- Case 5c: UPDATE_PAYMENT audit row exists
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.platform_admin_audit
    WHERE action = 'UPDATE_PAYMENT'
      AND tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
      AND (detail ->> 'payment_id') = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  'Case 5c: UPDATE_PAYMENT audit row exists'
);

-- Case 5d: proof_object_key key maps to proof_url column
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
  PERFORM public.update_payment(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    '{"proof_object_key":"payment-proofs/2026/test.pdf"}'::jsonb
  );
END $$;

SELECT is(
  (SELECT proof_url FROM public.tenant_payments
   WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'payment-proofs/2026/test.pdf',
  'Case 5d: proof_object_key key maps to proof_url column'
);

-- Case 5e: update_payment owned by postgres
SELECT is(
  (SELECT pg_get_userbyid(proowner)
   FROM pg_proc
   WHERE proname = 'update_payment'
     AND pronamespace = 'public'::regnamespace),
  'postgres',
  'Case 5e: update_payment is owned by postgres'
);

-- Case 5f: update_payment is SECURITY DEFINER
SELECT ok(
  (SELECT prosecdef
   FROM pg_proc
   WHERE proname = 'update_payment'
     AND pronamespace = 'public'::regnamespace),
  'Case 5f: update_payment is SECURITY DEFINER'
);

-- ════════════════════════════════════════════════════════════════════════════
-- delete_payment tests
-- ════════════════════════════════════════════════════════════════════════════

-- ── Case 6: Non-admin caller → P0403 ─────────────────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","is_platform_admin":"false"}',
  true
);
SELECT throws_ok(
  $$ SELECT public.delete_payment(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
       'test reason'
     ) $$,
  'P0403',
  'PLATFORM_ADMIN_REQUIRED',
  'Case 6: delete_payment non-admin blocked with P0403'
);

-- ── Restore admin JWT ─────────────────────────────────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',               '227c28f4-09f6-4dc9-af7a-01b0feb2c194',
    'is_platform_admin', 'true'
  )::text,
  true
);

-- ── Case 7: Empty reason → 22023 REASON_REQUIRED ─────────────────────────────
SELECT throws_ok(
  $$ SELECT public.delete_payment(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
       ''
     ) $$,
  '22023',
  'REASON_REQUIRED',
  'Case 7: empty reason raises 22023 REASON_REQUIRED'
);

-- ── Case 8: NULL reason → 22023 REASON_REQUIRED ──────────────────────────────
SELECT throws_ok(
  $$ SELECT public.delete_payment(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
       NULL
     ) $$,
  '22023',
  'REASON_REQUIRED',
  'Case 8: NULL reason raises 22023 REASON_REQUIRED'
);

-- ── Case 9: Payment not found → P0404 ────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT public.delete_payment(
       '00000000-0000-0000-0000-000000000000'::uuid,
       'some reason'
     ) $$,
  'P0404',
  'PAYMENT_NOT_FOUND',
  'Case 9: delete_payment unknown payment_id raises P0404 PAYMENT_NOT_FOUND'
);

-- ── Case 10: Happy path — delete the seed payment ─────────────────────────────
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

  v_result := public.delete_payment(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    'pgTAP test deletion'
  );

  IF NOT (v_result ->>'ok')::boolean THEN
    RAISE EXCEPTION 'Expected ok=true but got %', v_result;
  END IF;
END $$;

-- Case 10a: payment row is gone
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.tenant_payments
    WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
  ),
  'Case 10a: delete_payment — row removed from tenant_payments'
);

-- Case 10b: DELETE_PAYMENT audit row exists with reason + snapshot
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.platform_admin_audit
    WHERE action = 'DELETE_PAYMENT'
      AND tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
      AND (detail ->> 'reason') = 'pgTAP test deletion'
      AND detail ? 'snapshot'
      AND (detail -> 'snapshot' ->> 'id') = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  'Case 10b: DELETE_PAYMENT audit row has reason + snapshot'
);

-- Case 10c: delete_payment owned by postgres
SELECT is(
  (SELECT pg_get_userbyid(proowner)
   FROM pg_proc
   WHERE proname = 'delete_payment'
     AND pronamespace = 'public'::regnamespace),
  'postgres',
  'Case 10c: delete_payment is owned by postgres'
);

-- Case 10d: delete_payment is SECURITY DEFINER
SELECT ok(
  (SELECT prosecdef
   FROM pg_proc
   WHERE proname = 'delete_payment'
     AND pronamespace = 'public'::regnamespace),
  'Case 10d: delete_payment is SECURITY DEFINER'
);

SELECT * FROM finish();
ROLLBACK;
