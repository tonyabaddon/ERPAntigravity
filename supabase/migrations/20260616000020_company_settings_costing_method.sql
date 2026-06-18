-- 20260616000020_company_settings_costing_method.sql
-- Plan D Task 1 — Seed default costing method.
--
-- Table shape note: `company_settings` is a single-row config table
-- (id=1, flat columns) — see 20260603000001_company_settings.sql and
-- 20260614000006_opname_witness_optional_schema.sql (which uses the same
-- ALTER TABLE ADD COLUMN pattern for `opname_require_witness`). We follow
-- that pattern here rather than a key/value seed.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CHECK constraint guard.

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS costing_method TEXT NOT NULL DEFAULT 'FIFO';

-- Only 'FIFO' or 'Average' allowed at the DB layer.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'company_settings_costing_method_chk'
  ) THEN
    ALTER TABLE public.company_settings
      ADD CONSTRAINT company_settings_costing_method_chk
      CHECK (costing_method IN ('FIFO', 'Average'));
  END IF;
END $$;
