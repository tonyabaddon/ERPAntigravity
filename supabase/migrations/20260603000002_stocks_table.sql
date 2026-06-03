-- supabase/migrations/20260603000002_stocks_table.sql
-- Versioned DDL for the stocks table.
-- Previously documented as manual SQL in backend-go/README.md.

CREATE TABLE IF NOT EXISTS public.stocks (
  sku        VARCHAR(50) PRIMARY KEY,
  name       TEXT NOT NULL,
  category   VARCHAR(100) NOT NULL,
  price      NUMERIC NOT NULL,
  stock      INT NOT NULL,
  status     VARCHAR(50) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.stocks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'stocks' AND policyname = 'Allow Public Access'
  ) THEN
    CREATE POLICY "Allow Public Access"
      ON public.stocks FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
