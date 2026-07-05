-- Phase B Wave 1: extend plans + company_settings; backfill Garindo
BEGIN;

-- 2.1 plans extension: display metadata
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS target_segment TEXT,
  ADD COLUMN IF NOT EXISTS is_recommended BOOLEAN NOT NULL DEFAULT false;

UPDATE public.plans SET
  description = 'Warung / kios kecil dengan operasi minimal',
  target_segment = 'MSME 1-3 karyawan'
WHERE code = 'STARTER' AND description IS NULL;

UPDATE public.plans SET
  description = 'Toko retail dengan tempo + accounting',
  target_segment = 'MSME 5-15 karyawan',
  is_recommended = true
WHERE code = 'PRO' AND description IS NULL;

UPDATE public.plans SET
  description = 'Distributor / manufaktur multi-gudang',
  target_segment = 'B2B 20+ karyawan'
WHERE code = 'PREMIUM' AND description IS NULL;

-- 2.1b company_settings extension: business profile
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS industry TEXT,
  ADD COLUMN IF NOT EXISTS employee_range TEXT,
  ADD COLUMN IF NOT EXISTS annual_revenue_range TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'company_settings_employee_range_check'
  ) THEN
    ALTER TABLE public.company_settings
      ADD CONSTRAINT company_settings_employee_range_check
      CHECK (employee_range IS NULL OR employee_range IN (
        '1-3 orang (Mikro)',
        '4-19 orang (Kecil)',
        '20-99 orang (Menengah)',
        '100+ orang (Besar)'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'company_settings_annual_revenue_range_check'
  ) THEN
    ALTER TABLE public.company_settings
      ADD CONSTRAINT company_settings_annual_revenue_range_check
      CHECK (annual_revenue_range IS NULL OR annual_revenue_range IN (
        '< 300 juta (Mikro)',
        '300 juta - 2.5 miliar (Kecil)',
        '2.5 - 15 miliar (Menengah)',
        '15 - 50 miliar (Besar)',
        '> 50 miliar (Enterprise)'
      ));
  END IF;
END $$;

-- Backfill Garindo so it doesn't appear as "unprofiled"
UPDATE public.company_settings
SET
  industry = COALESCE(industry, 'Retail/Toko umum'),
  employee_range = COALESCE(employee_range, '4-19 orang (Kecil)'),
  annual_revenue_range = COALESCE(annual_revenue_range, '300 juta - 2.5 miliar (Kecil)')
WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug = 'garindo');

COMMIT;
