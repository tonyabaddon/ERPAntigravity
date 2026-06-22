BEGIN;

CREATE TABLE public.accounting_config (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid UNIQUE,
  ppn_mode                    text NOT NULL DEFAULT 'NON_PKP'
    CHECK (ppn_mode IN ('NON_PKP','PKP')),
  ppn_rate_pct                numeric(5,2) NOT NULL DEFAULT 11.0,
  pph_mode                    text NOT NULL DEFAULT 'UMKM_FINAL_0_5'
    CHECK (pph_mode IN ('UMKM_FINAL_0_5','BADAN_NORMAL_25','BADAN_NORMAL_22','MANUAL')),
  pph_rate_pct                numeric(5,2),
  fiscal_year_start_month     int NOT NULL DEFAULT 1
    CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  enable_dual_write_to_gl     boolean NOT NULL DEFAULT false,
  enable_strict_period_close  boolean NOT NULL DEFAULT false,
  opening_balance_set         boolean NOT NULL DEFAULT false,
  opening_balance_date        date,
  auto_accrue_pph_monthly     boolean NOT NULL DEFAULT true,
  auto_accrue_ppn_monthly     boolean NOT NULL DEFAULT false,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read global config" ON public.accounting_config
  FOR SELECT USING (tenant_id IS NULL);

CREATE POLICY "authenticated read own config" ON public.accounting_config
  FOR SELECT TO authenticated USING (tenant_id IS NULL OR tenant_id = auth.uid());

CREATE POLICY "owners write config" ON public.accounting_config FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE id=auth.uid() AND role='Owner' AND status='Aktif'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE id=auth.uid() AND role='Owner' AND status='Aktif'));

CREATE TRIGGER accounting_config_set_updated_at
  BEFORE UPDATE ON public.accounting_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed Garindo default
INSERT INTO public.accounting_config (
  tenant_id, ppn_mode, pph_mode, pph_rate_pct,
  enable_dual_write_to_gl, opening_balance_set
) VALUES (
  NULL, 'NON_PKP', 'UMKM_FINAL_0_5', 0.5, false, false
);

COMMIT;
