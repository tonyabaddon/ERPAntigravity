-- Phase 0a: Chart of Accounts table foundation for SAK EMKM accounting
BEGIN;

CREATE TABLE public.chart_of_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_code        text NOT NULL,
  account_name        text NOT NULL,
  account_type        text NOT NULL CHECK (account_type IN (
    'ASET','LIABILITAS','MODAL','PENDAPATAN','BEBAN'
  )),
  account_subtype     text,
  parent_id           uuid REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  is_control_account  boolean NOT NULL DEFAULT false,
  normal_balance      text NOT NULL CHECK (normal_balance IN ('DEBIT','CREDIT')),
  is_active           boolean NOT NULL DEFAULT true,
  is_system           boolean NOT NULL DEFAULT false,
  description         text,
  tenant_id           uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, account_code)
);

CREATE INDEX idx_coa_type_active ON public.chart_of_accounts(account_type, is_active);
CREATE INDEX idx_coa_subtype ON public.chart_of_accounts(account_subtype) WHERE is_active = true;
CREATE INDEX idx_coa_parent ON public.chart_of_accounts(parent_id);
CREATE INDEX idx_coa_tenant ON public.chart_of_accounts(tenant_id) WHERE tenant_id IS NOT NULL;

ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read coa" ON public.chart_of_accounts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "owners write coa" ON public.chart_of_accounts FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE id = auth.uid() AND role = 'Owner' AND status = 'Aktif'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE id = auth.uid() AND role = 'Owner' AND status = 'Aktif'
  ));

CREATE TRIGGER coa_set_updated_at
  BEFORE UPDATE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
