-- Multi-tier pricing — add default_pricing_tier flag per customer.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS default_pricing_tier TEXT NOT NULL DEFAULT 'eceran';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customers_default_pricing_tier_check'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_default_pricing_tier_check
      CHECK (default_pricing_tier IN ('eceran','grosir'));
  END IF;
END $$;
