DO $$ BEGIN
  CREATE TYPE kasir_channel AS ENUM ('walkin', 'tokopedia', 'grosir');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE kasir_payment_method AS ENUM ('cash', 'transfer', 'qris');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE kasir_expense_category AS ENUM (
    'Gaji', 'Utilitas', 'Transportasi', 'Pembelian Stok', 'Marketing', 'Lain-lain'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.kasir_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date             DATE NOT NULL DEFAULT CURRENT_DATE,
  type             TEXT NOT NULL CHECK (type IN ('income', 'expense')),

  -- Income fields
  channel          kasir_channel,
  items            JSONB NOT NULL DEFAULT '[]',
  subtotal         NUMERIC(15,2) NOT NULL DEFAULT 0,
  hpp_total        NUMERIC(15,2) NOT NULL DEFAULT 0,
  payment_method   kasir_payment_method,
  customer_name    TEXT,
  invoice_number   TEXT,

  -- Expense fields
  expense_category kasir_expense_category,
  description      TEXT,

  -- PO module integration
  po_id            UUID,

  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kasir_date ON kasir_transactions(date);
CREATE INDEX IF NOT EXISTS idx_kasir_type_date ON kasir_transactions(type, date);

ALTER TABLE public.kasir_transactions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'kasir_transactions' AND policyname = 'anon_all_kasir'
  ) THEN
    CREATE POLICY "anon_all_kasir" ON kasir_transactions
      FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;
