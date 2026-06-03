-- supabase/migrations/20260603000001_company_settings.sql
-- Versioned DDL for company_settings.
-- This table was previously applied via MCP; this file ensures fresh deployments work.

CREATE TABLE IF NOT EXISTS company_settings (
  id           int PRIMARY KEY DEFAULT 1,
  company_name text,
  address      text,
  phone        text,
  email        text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'company_settings' AND policyname = 'public read company_settings'
  ) THEN
    CREATE POLICY "public read company_settings"
      ON company_settings FOR SELECT TO anon USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'company_settings' AND policyname = 'anon write company_settings'
  ) THEN
    CREATE POLICY "anon write company_settings"
      ON company_settings FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON company_settings TO anon;

-- Seed the default row; safe to run on existing DB
INSERT INTO company_settings (id, company_name)
VALUES (1, 'Garindo Jaya Panel')
ON CONFLICT (id) DO NOTHING;
