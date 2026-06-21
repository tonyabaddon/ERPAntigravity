BEGIN;

CREATE TABLE public.journal_entry_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id            uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  line_number         int NOT NULL,
  account_id          uuid NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  side                text NOT NULL CHECK (side IN ('DEBIT','CREDIT')),
  amount              numeric(15,2) NOT NULL CHECK (amount > 0),
  description         text,
  counterparty_type   text CHECK (counterparty_type IN ('CUSTOMER','SUPPLIER','OWNER','INTERNAL','TAX','OTHER')),
  counterparty_id     uuid,
  status              text NOT NULL DEFAULT 'CLEARED'
    CHECK (status IN ('CLEARED','PENDING')),
  cleared_at          timestamptz,
  reconciled_at       timestamptz,
  bank_line_id        uuid,
  tenant_id           uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, line_number)
);

CREATE INDEX idx_jel_account_date ON public.journal_entry_lines(account_id, created_at DESC);
CREATE INDEX idx_jel_entry ON public.journal_entry_lines(entry_id);
CREATE INDEX idx_jel_counterparty ON public.journal_entry_lines(counterparty_type, counterparty_id)
  WHERE counterparty_id IS NOT NULL;
CREATE INDEX idx_jel_status ON public.journal_entry_lines(status) WHERE status = 'PENDING';
CREATE INDEX idx_jel_reconciled ON public.journal_entry_lines(account_id, reconciled_at)
  WHERE reconciled_at IS NULL;
CREATE INDEX idx_jel_tenant ON public.journal_entry_lines(tenant_id) WHERE tenant_id IS NOT NULL;

ALTER TABLE public.journal_entry_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read jel" ON public.journal_entry_lines
  FOR SELECT TO authenticated USING (true);

COMMIT;
