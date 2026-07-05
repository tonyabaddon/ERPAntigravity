BEGIN;
SELECT plan(9);

-- ============================================================
-- pgTAP: tenant_payments table shape + RLS + audit CHECK
-- Platform admin UUID: 227c28f4-09f6-4dc9-af7a-01b0feb2c194
-- Garindo tenant_id:   11111111-1111-1111-1111-111111111111
-- ============================================================

-- ── 1. Table exists ──────────────────────────────────────────────────────────
SELECT has_table('public', 'tenant_payments',
  'tenant_payments table exists');

-- ── 2. Index: tenant + payment_date ─────────────────────────────────────────
SELECT has_index('public', 'tenant_payments', 'idx_tenant_payments_tenant_date',
  'idx_tenant_payments_tenant_date index exists');

-- ── 3. Index: period_from + period_to ───────────────────────────────────────
SELECT has_index('public', 'tenant_payments', 'idx_tenant_payments_period',
  'idx_tenant_payments_period index exists');

-- ── 4. RLS is enabled ────────────────────────────────────────────────────────
SELECT ok(
  (SELECT relrowsecurity
   FROM pg_class
   WHERE oid = 'public.tenant_payments'::regclass),
  'tenant_payments RLS is enabled'
);

-- ── 5. FORCE RLS is enabled ──────────────────────────────────────────────────
SELECT ok(
  (SELECT relforcerowsecurity
   FROM pg_class
   WHERE oid = 'public.tenant_payments'::regclass),
  'tenant_payments FORCE RLS is enabled'
);

-- ── 6. Policy p_platform_admin_only exists ───────────────────────────────────
SELECT has_row_policy('public', 'tenant_payments', 'p_platform_admin_only',
  'policy p_platform_admin_only exists on tenant_payments');

-- ── 7. Audit CHECK includes RECORD_PAYMENT ───────────────────────────────────
SELECT ok(
  (SELECT pg_get_constraintdef(oid) LIKE '%RECORD_PAYMENT%'
   FROM pg_constraint
   WHERE conrelid = 'public.platform_admin_audit'::regclass
     AND conname = 'platform_admin_audit_action_check'),
  'audit CHECK constraint includes RECORD_PAYMENT'
);

-- ── 8. Audit CHECK includes all 4 new Wave 5 codes ───────────────────────────
SELECT ok(
  (SELECT
     pg_get_constraintdef(oid) LIKE '%RECORD_PAYMENT%'
     AND pg_get_constraintdef(oid) LIKE '%UPDATE_PAYMENT%'
     AND pg_get_constraintdef(oid) LIKE '%DELETE_PAYMENT%'
     AND pg_get_constraintdef(oid) LIKE '%UPLOAD_PAYMENT_PROOF%'
   FROM pg_constraint
   WHERE conrelid = 'public.platform_admin_audit'::regclass
     AND conname = 'platform_admin_audit_action_check'),
  'audit CHECK includes all 4 new Wave 5 payment codes'
);

-- ── 9. payment_bank_required CHECK rejects BANK_TRANSFER + NULL bank_name ───
-- Must set platform-admin JWT first — FORCE RLS fires WITH CHECK before
-- the table CHECK; without admin JWT the error would be 42501 (RLS), not 23514.
-- Garindo tenant_id and admin user_id are real seed rows in this DB.
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',               '227c28f4-09f6-4dc9-af7a-01b0feb2c194',
    'is_platform_admin', 'true'
  )::text,
  true
);

SELECT throws_ok(
  $$ INSERT INTO public.tenant_payments (
       tenant_id,
       amount,
       currency,
       payment_method,
       bank_name,
       payment_date,
       period_from,
       period_to,
       recorded_by_admin
     ) VALUES (
       '11111111-1111-1111-1111-111111111111'::uuid,
       500000,
       'IDR',
       'BANK_TRANSFER',
       NULL,
       CURRENT_DATE,
       date_trunc('month', CURRENT_DATE)::date,
       (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date,
       '227c28f4-09f6-4dc9-af7a-01b0feb2c194'::uuid
     ) $$,
  '23514',
  NULL,
  'Case 9: BANK_TRANSFER with NULL bank_name raises 23514 (payment_bank_required)'
);

SELECT * FROM finish();
ROLLBACK;
