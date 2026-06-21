BEGIN;

CREATE TYPE public.journal_entry_source AS ENUM (
  'KASIR_SALE',
  'PEMBAYARAN',
  'PIUTANG_PAYMENT',
  'KASIR_EXPENSE',
  'PI_TAGIHAN',
  'PI_RECEIVE_GOODS',
  'WALKIN_PAYMENT',
  'TEMPO_WRITEOFF',
  'CASH_DEPOSIT_BATCH',
  'MANUAL_TRANSFER',
  'OWNER_DRAWING',
  'OWNER_TOPUP',
  'WALLET_TOPUP',
  'WALLET_SPEND',
  'ADJUSTMENT',
  'OPENING_BALANCE',
  'BACKFILL',
  'PERIOD_CLOSE',
  'YEAR_END_CLOSE',
  'HPP_RECOGNITION',
  'TAX_ACCRUAL_PPH',
  'TAX_ACCRUAL_PPN',
  'STOCK_OPNAME_ADJ',
  'DP_RECEIVE',
  'DP_RECOGNIZE',
  'DP_REFUND'
);

CREATE TABLE public.journal_entries (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number          text NOT NULL,
  entry_date            date NOT NULL,
  posted_at             timestamptz NOT NULL DEFAULT now(),
  source_type           public.journal_entry_source NOT NULL,
  source_ref_table      text,
  source_ref_id         uuid,
  description           text NOT NULL,
  total_debit           numeric(15,2) NOT NULL CHECK (total_debit >= 0),
  total_credit          numeric(15,2) NOT NULL CHECK (total_credit >= 0),
  is_balanced           boolean GENERATED ALWAYS AS (total_debit = total_credit) STORED,
  is_posted             boolean NOT NULL DEFAULT true,
  posted_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reversed_by_entry_id  uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  reverses_entry_id     uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  notes                 text,
  tenant_id             uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entry_number),
  CHECK (total_debit = total_credit)
);

CREATE INDEX idx_je_entry_date ON public.journal_entries(entry_date DESC);
CREATE INDEX idx_je_source ON public.journal_entries(source_type, source_ref_table, source_ref_id);
CREATE INDEX idx_je_tenant_period ON public.journal_entries(tenant_id, entry_date) WHERE is_posted = true;
CREATE UNIQUE INDEX uq_je_source_unique ON public.journal_entries(source_type, source_ref_table, source_ref_id)
  WHERE source_ref_id IS NOT NULL AND reverses_entry_id IS NULL;

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read je" ON public.journal_entries
  FOR SELECT TO authenticated USING (true);
-- No INSERT/UPDATE/DELETE: only via SECURITY DEFINER RPC _post_journal_entry

COMMIT;
