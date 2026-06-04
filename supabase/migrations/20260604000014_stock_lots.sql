-- ── stock_lots: FIFO batch cost tracking ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_lots (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  sku           varchar NOT NULL REFERENCES public.stocks(sku),
  po_id         uuid    REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  unit_cost     numeric NOT NULL DEFAULT 0,
  qty_received  int     NOT NULL,
  qty_remaining int     NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_lots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'stock_lots' AND policyname = 'anon full access stock_lots'
  ) THEN
    CREATE POLICY "anon full access stock_lots"
      ON public.stock_lots FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'stock_lots' AND policyname = 'authenticated full access stock_lots'
  ) THEN
    CREATE POLICY "authenticated full access stock_lots"
      ON public.stock_lots FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Seed: bootstrap FIFO from current stock levels.
-- received_at is set 10 years in the past so seed lots are deducted before any real PO lots.
-- NOT EXISTS guard makes this idempotent on re-run.
INSERT INTO public.stock_lots (sku, po_id, unit_cost, qty_received, qty_remaining, received_at)
SELECT
  sku,
  NULL,
  COALESCE(harga_modal, 0),
  stock,
  stock,
  now() - INTERVAL '10 years'
FROM public.stocks
WHERE stock > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.stock_lots sl WHERE sl.sku = stocks.sku AND sl.po_id IS NULL
  );
