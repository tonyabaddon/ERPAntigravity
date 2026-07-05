BEGIN;
SELECT plan(13);

-- ============================================================
-- pgTAP: v_tenant_payment_coverage view
-- Platform admin UUID: 227c28f4-09f6-4dc9-af7a-01b0feb2c194
-- Garindo tenant_id:   11111111-1111-1111-1111-111111111111
-- Garindo plan: PREMIUM, price_annual = 9,000,000 IDR
-- Garindo subscription: 2026-01-01 → 2099-12-31
--
-- Coverage thresholds (9M):
--   LUNAS   : >= 9,000,000
--   DP_60   : >= 5,400,000 (60%)
--   DP_30   : >= 2,700,000 (30%)
--   OVERDUE : > 0 AND < 2,700,000
--   UNPAID  : 0
-- ============================================================

-- ── Set platform admin JWT (needed for RLS on underlying tables) ──────────────
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',               '227c28f4-09f6-4dc9-af7a-01b0feb2c194',
    'is_platform_admin', 'true'
  )::text,
  true
);

-- ── Case 1: View exists ───────────────────────────────────────────────────────
SELECT has_view('public', 'v_tenant_payment_coverage',
  'Case 1: v_tenant_payment_coverage view exists');

-- ── Case 2: View has expected columns ────────────────────────────────────────
SELECT has_column('public', 'v_tenant_payment_coverage', 'tenant_id',
  'Case 2a: column tenant_id exists');

SELECT has_column('public', 'v_tenant_payment_coverage', 'total_paid_covering_current_subscription',
  'Case 2b: column total_paid_covering_current_subscription exists');

SELECT has_column('public', 'v_tenant_payment_coverage', 'expected',
  'Case 2c: column expected exists');

SELECT has_column('public', 'v_tenant_payment_coverage', 'coverage_status',
  'Case 2d: column coverage_status exists');

-- ── Case 3: Garindo with zero payments → UNPAID, total_paid=0, expected=9M ───
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.v_tenant_payment_coverage
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
      AND total_paid_covering_current_subscription = 0
      AND expected = 9000000
      AND coverage_status = 'UNPAID'
  ),
  'Case 3: Garindo with no payments → UNPAID, total_paid=0, expected=9000000'
);

-- ── Cases 4-7: Simulate payments, assert coverage_status flips ───────────────
-- All INSERTs are within the outer ROLLBACK — no permanent state change.

-- Insert a DP_30 amount (3.5M: above 30% threshold 2.7M, below 60% threshold 5.4M)
INSERT INTO public.tenant_payments (
  tenant_id, amount, payment_method, payment_date,
  period_from, period_to, recorded_by_admin
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  3500000,
  'CASH',
  CURRENT_DATE,
  '2026-01-01',
  '2026-12-31',
  '227c28f4-09f6-4dc9-af7a-01b0feb2c194'
);

SELECT ok(
  (SELECT coverage_status FROM public.v_tenant_payment_coverage
   WHERE tenant_id = '11111111-1111-1111-1111-111111111111') = 'DP_30',
  'Case 4: 3,500,000 / 9,000,000 → DP_30'
);

SELECT ok(
  (SELECT total_paid_covering_current_subscription FROM public.v_tenant_payment_coverage
   WHERE tenant_id = '11111111-1111-1111-1111-111111111111') = 3500000,
  'Case 4b: total_paid = 3,500,000'
);

-- Add more to reach DP_60 (total 6M: above 60% threshold 5.4M, below 100% 9M)
INSERT INTO public.tenant_payments (
  tenant_id, amount, payment_method, payment_date,
  period_from, period_to, recorded_by_admin
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  2500000,
  'CASH',
  CURRENT_DATE,
  '2026-01-01',
  '2026-12-31',
  '227c28f4-09f6-4dc9-af7a-01b0feb2c194'
);

SELECT ok(
  (SELECT coverage_status FROM public.v_tenant_payment_coverage
   WHERE tenant_id = '11111111-1111-1111-1111-111111111111') = 'DP_60',
  'Case 5: 6,000,000 / 9,000,000 → DP_60'
);

-- Add more to reach LUNAS (total 9.5M: >= 9M)
INSERT INTO public.tenant_payments (
  tenant_id, amount, payment_method, payment_date,
  period_from, period_to, recorded_by_admin
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  3500000,
  'CASH',
  CURRENT_DATE,
  '2026-01-01',
  '2026-12-31',
  '227c28f4-09f6-4dc9-af7a-01b0feb2c194'
);

SELECT ok(
  (SELECT coverage_status FROM public.v_tenant_payment_coverage
   WHERE tenant_id = '11111111-1111-1111-1111-111111111111') = 'LUNAS',
  'Case 6: 9,500,000 / 9,000,000 → LUNAS'
);

-- ── Case 7: Payment outside subscription window is excluded from total_paid ───
-- Delete all previous payments first via DELETE to reset to 0
-- (still within outer ROLLBACK)
DELETE FROM public.tenant_payments
WHERE tenant_id = '11111111-1111-1111-1111-111111111111';

-- Insert 5M but with period that does NOT overlap subscription window
-- Garindo subscription: 2026-01-01 → 2099-12-31
-- Out-of-window period: 1900-01-01 → 1900-12-31 (period_to < activated_at)
INSERT INTO public.tenant_payments (
  tenant_id, amount, payment_method, payment_date,
  period_from, period_to, recorded_by_admin
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  5000000,
  'CASH',
  '1900-01-15',
  '1900-01-01',
  '1900-12-31',
  '227c28f4-09f6-4dc9-af7a-01b0feb2c194'
);

SELECT ok(
  (SELECT coverage_status FROM public.v_tenant_payment_coverage
   WHERE tenant_id = '11111111-1111-1111-1111-111111111111') = 'UNPAID',
  'Case 7: 5M payment outside subscription window → excluded → UNPAID'
);

-- ── ROLLBACK ensures no state change in DB ────────────────────────────────────
SELECT * FROM finish();
ROLLBACK;
