-- supabase/migrations/20260607000001_recon_bank_accounts.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_code       text NOT NULL CHECK (bank_code IN ('BCA','MANDIRI','BRI','BNI','PERMATA','CIMB','OTHER')),
  account_number  text NOT NULL,
  account_label   text NOT NULL,
  purpose         text NOT NULL CHECK (purpose IN ('OPERATIONAL','OWNER_PERSONAL','SAVINGS','OTHER')),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_code, account_number)
);

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bank_accounts' AND policyname='anon full access bank_accounts') THEN
    CREATE POLICY "anon full access bank_accounts" ON public.bank_accounts FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bank_accounts' AND policyname='authenticated full access bank_accounts') THEN
    CREATE POLICY "authenticated full access bank_accounts" ON public.bank_accounts FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.bank_imports (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id       uuid NOT NULL REFERENCES public.bank_accounts(id),
  period_start          date NOT NULL,
  period_end            date NOT NULL,
  filename              text NOT NULL,
  storage_path          text NOT NULL,
  uploaded_by           uuid,
  uploaded_at           timestamptz NOT NULL DEFAULT now(),
  line_count            int NOT NULL DEFAULT 0,
  matched_count         int NOT NULL DEFAULT 0,
  gemini_model          text NOT NULL DEFAULT 'gemini-2.5-flash',
  gemini_input_tokens   int,
  gemini_output_tokens  int,
  status                text NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING','READY','FAILED')),
  error_message         text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_imports_account_period ON public.bank_imports(bank_account_id, period_start);

ALTER TABLE public.bank_imports ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bank_imports' AND policyname='anon full access bank_imports') THEN
    CREATE POLICY "anon full access bank_imports" ON public.bank_imports FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bank_imports' AND policyname='authenticated full access bank_imports') THEN
    CREATE POLICY "authenticated full access bank_imports" ON public.bank_imports FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;
