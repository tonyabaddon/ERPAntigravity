BEGIN;

CREATE TABLE public.cash_accounts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_type         text NOT NULL CHECK (account_type IN ('BANK','KAS','E_WALLET')),
  bank_code            text CHECK (account_type != 'BANK' OR bank_code IN ('BCA','MANDIRI','BRI','BNI','PERMATA','CIMB','OTHER')),
  account_number       text,
  account_holder       text,
  internal_label       text NOT NULL,
  provider             text,
  purpose              text NOT NULL DEFAULT 'OPERATIONAL' CHECK (purpose IN ('OPERATIONAL','OWNER_PERSONAL','SAVINGS','PETTY_CASH','OTHER')),
  show_in_invoice      boolean NOT NULL DEFAULT true,
  sort_order           int NOT NULL DEFAULT 0,
  is_active            boolean NOT NULL DEFAULT true,
  opening_balance      numeric(15,2) NOT NULL DEFAULT 0,
  opening_balance_date date,
  coa_account_id       uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  tenant_id            uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- Type-aware nullability
  CHECK ((account_type = 'BANK' AND account_number IS NOT NULL) OR account_type IN ('KAS','E_WALLET')),
  CHECK ((account_type = 'E_WALLET' AND provider IS NOT NULL) OR account_type IN ('BANK','KAS'))
);

CREATE INDEX idx_cash_accounts_type_active ON public.cash_accounts(account_type, is_active);
CREATE INDEX idx_cash_accounts_sort ON public.cash_accounts(sort_order) WHERE is_active = true;
CREATE INDEX idx_cash_accounts_coa ON public.cash_accounts(coa_account_id) WHERE coa_account_id IS NOT NULL;

ALTER TABLE public.cash_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read cash_accounts" ON public.cash_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "owners write cash_accounts" ON public.cash_accounts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE id=auth.uid() AND role='Owner' AND status='Aktif'))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE id=auth.uid() AND role='Owner' AND status='Aktif'));
CREATE POLICY "service_role bypass cash_accounts" ON public.cash_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER cash_accounts_set_updated_at BEFORE UPDATE ON public.cash_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed Garindo default: Kas Toko (linked to existing COA 1-1110)
INSERT INTO public.cash_accounts (account_type, internal_label, purpose, coa_account_id)
VALUES ('KAS', 'Kas Toko', 'PETTY_CASH', (SELECT id FROM chart_of_accounts WHERE account_code='1-1110'));

COMMIT;
