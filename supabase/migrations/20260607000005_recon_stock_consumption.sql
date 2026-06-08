-- supabase/migrations/20260607000005_recon_stock_consumption.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.stock_lot_consumption (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id          uuid NOT NULL REFERENCES public.stock_lots(id),
  source_type     text NOT NULL CHECK (source_type IN ('ORDER_ITEM','KASIR_ITEM')),
  order_id        uuid REFERENCES public.orders(id),
  kasir_txn_id    uuid REFERENCES public.kasir_transactions(id),
  sku             varchar NOT NULL,
  qty_consumed    int NOT NULL CHECK (qty_consumed > 0),
  unit_cost       numeric(15,2) NOT NULL,
  consumed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_slc_lot ON public.stock_lot_consumption(lot_id);
CREATE INDEX IF NOT EXISTS idx_slc_order ON public.stock_lot_consumption(order_id);
CREATE INDEX IF NOT EXISTS idx_slc_kasir ON public.stock_lot_consumption(kasir_txn_id);

ALTER TABLE public.stock_lot_consumption ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='stock_lot_consumption' AND policyname='anon full access slc') THEN
    CREATE POLICY "anon full access slc" ON public.stock_lot_consumption FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='stock_lot_consumption' AND policyname='authenticated full access slc') THEN
    CREATE POLICY "authenticated full access slc" ON public.stock_lot_consumption FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS paid_bank_line_id uuid REFERENCES public.bank_statement_lines(id);

COMMIT;
