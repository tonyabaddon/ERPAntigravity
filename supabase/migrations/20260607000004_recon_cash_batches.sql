-- supabase/migrations/20260607000004_recon_cash_batches.sql
BEGIN;

-- Add MDR EDC to kasir_expense_category enum
DO $$ BEGIN
  ALTER TYPE kasir_expense_category ADD VALUE IF NOT EXISTS 'MDR EDC';
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.cash_deposit_batches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_date        date,
  bank_line_id        uuid REFERENCES public.bank_statement_lines(id),
  deposited_amount    numeric(15,2),
  expected_amount     numeric(15,2) NOT NULL,
  variance            numeric(15,2) NOT NULL DEFAULT 0,
  variance_reason     text CHECK (variance_reason IN ('PETTY_CASH','HITUNG_KURANG','HITUNG_LEBIH','LAINNYA')),
  variance_notes      text,
  status              text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DEPOSITED','CARRY_OVER')),
  carry_over_period   text,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cash_deposit_batch_items (
  batch_id        uuid NOT NULL REFERENCES public.cash_deposit_batches(id) ON DELETE CASCADE,
  kasir_txn_id    uuid NOT NULL REFERENCES public.kasir_transactions(id),
  PRIMARY KEY (batch_id, kasir_txn_id)
);

ALTER TABLE public.cash_deposit_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_deposit_batch_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cash_deposit_batches' AND policyname='anon full access cdb') THEN
    CREATE POLICY "anon full access cdb" ON public.cash_deposit_batches FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cash_deposit_batches' AND policyname='authenticated full access cdb') THEN
    CREATE POLICY "authenticated full access cdb" ON public.cash_deposit_batches FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cash_deposit_batch_items' AND policyname='anon full access cdbi') THEN
    CREATE POLICY "anon full access cdbi" ON public.cash_deposit_batch_items FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cash_deposit_batch_items' AND policyname='authenticated full access cdbi') THEN
    CREATE POLICY "authenticated full access cdbi" ON public.cash_deposit_batch_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;
