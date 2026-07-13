-- 20261115000150_coa_seed_service_catalog.sql
-- Item #2: Add Pendapatan Jasa + Beban Tenaga Kerja Rakit COA accounts
-- for Garindo tenant. Idempotent via ON CONFLICT DO NOTHING.
-- Note: account_subtype is TEXT (not enum) — no ALTER TYPE needed.

INSERT INTO public.chart_of_accounts (
  tenant_id, account_code, account_name, account_type, account_subtype,
  normal_balance, is_control_account, is_active
)
SELECT
  t.id, '4-1300', 'Pendapatan Jasa Wiring', 'PENDAPATAN', 'PENDAPATAN_JASA',
  'CREDIT', false, true
FROM public.tenants t
WHERE t.slug = 'garindo'
ON CONFLICT (tenant_id, account_code) DO NOTHING;

INSERT INTO public.chart_of_accounts (
  tenant_id, account_code, account_name, account_type, account_subtype,
  normal_balance, is_control_account, is_active
)
SELECT
  t.id, '5-2110', 'Beban Tenaga Kerja Rakit', 'BEBAN', 'BEBAN_TENAGA_KERJA',
  'DEBIT', false, true
FROM public.tenants t
WHERE t.slug = 'garindo'
ON CONFLICT (tenant_id, account_code) DO NOTHING;
