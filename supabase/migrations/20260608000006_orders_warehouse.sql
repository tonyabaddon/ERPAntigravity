-- Walk-in draft orders need to remember which warehouse to deduct from when
-- payment is recorded later. WhatsApp orders default to 'atas' in the Go
-- service (same as the current implicit assumption), so this column is only
-- meaningful for sales_channel = 'walkin'.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS warehouse text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_warehouse_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_warehouse_check
      CHECK (warehouse IS NULL OR warehouse IN ('atas', 'bawah'));
  END IF;
END $$;
