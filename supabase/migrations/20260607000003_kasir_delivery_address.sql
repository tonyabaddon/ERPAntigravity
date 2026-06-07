-- 20260607000003_kasir_delivery_address.sql
-- Add optional delivery_address to kasir_transactions for shipping orders.

ALTER TABLE public.kasir_transactions
  ADD COLUMN IF NOT EXISTS delivery_address TEXT;
