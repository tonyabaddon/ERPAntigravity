-- Tag the originating channel on orders so walk-in draft orders can coexist
-- with WhatsApp orders in the same table.
-- Existing rows default to 'whatsapp' since that was the only source until now.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS sales_channel text NOT NULL DEFAULT 'whatsapp';

-- Constrain values. NB: tokopedia/grosir do NOT use the orders table --
-- they remain in kasir_transactions (immediate paid sales only).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_sales_channel_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_sales_channel_check
      CHECK (sales_channel IN ('whatsapp', 'walkin'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_sales_channel_status
  ON public.orders(sales_channel, status);
