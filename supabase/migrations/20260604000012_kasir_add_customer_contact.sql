ALTER TABLE public.kasir_transactions
  ADD COLUMN IF NOT EXISTS customer_phone TEXT,
  ADD COLUMN IF NOT EXISTS customer_company TEXT;
