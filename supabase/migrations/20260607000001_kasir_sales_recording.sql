-- 20260607000001_kasir_sales_recording.sql
-- Sub-project A: Sales Recording overhaul
-- Adds channels (whatsapp), payment subtype (debit/qris), DP flow, ongkir, notes,
-- per-row warehouse (in items JSON), and pelunasan state machine.

-- 1. Add 'whatsapp' to kasir_channel enum
DO $$ BEGIN
  ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'whatsapp';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Add 'edc' to kasir_payment_method enum (keep 'qris' for backward compat with old rows)
DO $$ BEGIN
  ALTER TYPE kasir_payment_method ADD VALUE IF NOT EXISTS 'edc';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Add new columns to kasir_transactions
ALTER TABLE public.kasir_transactions
  ADD COLUMN IF NOT EXISTS payment_subtype TEXT,
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'FULL',
  ADD COLUMN IF NOT EXISTS dp_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dp_input_type TEXT,
  ADD COLUMN IF NOT EXISTS ongkir_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokped_order_no TEXT,
  ADD COLUMN IF NOT EXISTS wa_phone TEXT,
  ADD COLUMN IF NOT EXISTS wa_chat_url TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PAID',
  ADD COLUMN IF NOT EXISTS lunas_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lunas_payment_method kasir_payment_method,
  ADD COLUMN IF NOT EXISTS lunas_payment_subtype TEXT;

-- 4. Check constraints
DO $$ BEGIN
  ALTER TABLE public.kasir_transactions
    ADD CONSTRAINT chk_kasir_payment_type CHECK (payment_type IN ('FULL','DP'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.kasir_transactions
    ADD CONSTRAINT chk_kasir_dp_input_type CHECK (dp_input_type IS NULL OR dp_input_type IN ('AMOUNT','PERCENT'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.kasir_transactions
    ADD CONSTRAINT chk_kasir_status CHECK (status IN ('PAID','AWAITING_LUNAS','COMPLETED','CANCELLED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.kasir_transactions
    ADD CONSTRAINT chk_kasir_payment_subtype CHECK (
      payment_subtype IS NULL OR payment_subtype IN ('debit','qris')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. Backfill total_amount for existing rows (subtotal + ongkir, ongkir=0 by default)
UPDATE public.kasir_transactions
SET total_amount = subtotal
WHERE total_amount = 0 AND type = 'income';

-- 6. Index for AWAITING_LUNAS queries
CREATE INDEX IF NOT EXISTS idx_kasir_status_date
  ON public.kasir_transactions(status, date)
  WHERE status = 'AWAITING_LUNAS';
