-- supabase/migrations/20260607000002_recon_bank_lines.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.bank_statement_lines (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id                 uuid NOT NULL REFERENCES public.bank_imports(id) ON DELETE CASCADE,
  bank_account_id           uuid NOT NULL REFERENCES public.bank_accounts(id),
  txn_date                  date NOT NULL,
  amount                    numeric(15,2) NOT NULL CHECK (amount > 0),
  direction                 text NOT NULL CHECK (direction IN ('IN','OUT')),
  description               text NOT NULL,
  counterparty              text,
  raw_row                   jsonb,
  line_kind                 text NOT NULL DEFAULT 'UNKNOWN' CHECK (line_kind IN (
    'CUSTOMER_PAYMENT','CASH_DEPOSIT','EDC_SETTLEMENT','SUPPLIER_PAYMENT','EXPENSE',
    'BANK_FEE','INTERNAL_TRANSFER','CUSTOMER_TOPUP','OWNER_DRAWING','OWNER_TOPUP',
    'REFUND','OTHER_INCOME','LEGACY_PERIOD','UNKNOWN'
  )),
  lane                      text NOT NULL DEFAULT 'GRAY' CHECK (lane IN ('GREEN','YELLOW','ORANGE','RED','GRAY')),
  match_confidence          numeric(3,2),
  match_reason              text,
  matched_internal_pair_id  uuid REFERENCES public.bank_statement_lines(id),
  matched_at                timestamptz,
  matched_by                uuid,
  notes                     text,
  dedup_hash                text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_bsl_dedup UNIQUE (bank_account_id, dedup_hash)
);
CREATE INDEX IF NOT EXISTS idx_bsl_account_date ON public.bank_statement_lines(bank_account_id, txn_date);
CREATE INDEX IF NOT EXISTS idx_bsl_lane ON public.bank_statement_lines(lane) WHERE lane IN ('YELLOW','ORANGE','RED');
CREATE INDEX IF NOT EXISTS idx_bsl_kind ON public.bank_statement_lines(line_kind);

ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bank_statement_lines' AND policyname='anon full access bsl') THEN
    CREATE POLICY "anon full access bsl" ON public.bank_statement_lines FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bank_statement_lines' AND policyname='authenticated full access bsl') THEN
    CREATE POLICY "authenticated full access bsl" ON public.bank_statement_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.bank_line_allocations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_line_id    uuid NOT NULL REFERENCES public.bank_statement_lines(id) ON DELETE CASCADE,
  slot_id         uuid NOT NULL,        -- FK added in next migration after payable_slots exists
  amount          numeric(15,2) NOT NULL CHECK (amount > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_line_id, slot_id)
);
CREATE INDEX IF NOT EXISTS idx_bla_line ON public.bank_line_allocations(bank_line_id);
CREATE INDEX IF NOT EXISTS idx_bla_slot ON public.bank_line_allocations(slot_id);

ALTER TABLE public.bank_line_allocations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bank_line_allocations' AND policyname='anon full access bla') THEN
    CREATE POLICY "anon full access bla" ON public.bank_line_allocations FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bank_line_allocations' AND policyname='authenticated full access bla') THEN
    CREATE POLICY "authenticated full access bla" ON public.bank_line_allocations FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;
