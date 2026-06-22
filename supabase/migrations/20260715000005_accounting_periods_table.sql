BEGIN;

CREATE TABLE public.accounting_periods (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid,
  period_year         int NOT NULL,
  period_month        int NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  status              text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','CLOSED','REOPENED')),
  closed_at           timestamptz,
  closed_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reopened_at         timestamptz,
  reopened_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reopen_reason       text,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period_year, period_month)
);

CREATE INDEX idx_periods_status ON public.accounting_periods(status, period_year, period_month);
CREATE INDEX idx_periods_tenant ON public.accounting_periods(tenant_id) WHERE tenant_id IS NOT NULL;

ALTER TABLE public.accounting_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role bypass" ON public.accounting_periods
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated read periods" ON public.accounting_periods
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "owners write periods" ON public.accounting_periods FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE id=auth.uid() AND role='Owner' AND status='Aktif'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE id=auth.uid() AND role='Owner' AND status='Aktif'));

-- Seed historical OPEN periods Juni 2025 - Des 2026
INSERT INTO public.accounting_periods (tenant_id, period_year, period_month, status)
SELECT NULL, y, m, 'OPEN'
FROM (
  SELECT 2025 AS y, m FROM generate_series(6, 12) m
  UNION ALL
  SELECT 2026 AS y, m FROM generate_series(1, 12) m
) AS periods;

COMMIT;
