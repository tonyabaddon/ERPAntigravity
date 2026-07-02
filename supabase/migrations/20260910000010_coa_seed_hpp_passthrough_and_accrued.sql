-- 20260910000010 — Foundation for sales-side dual-write close.
--
-- Adds 2 new COA accounts + 6 new journal_entry_source enum values.
-- Prerequisite for migrations 20260910000012–20260910000015.
--
-- Design spec: docs/superpowers/specs/2026-07-02-sales-side-dual-write-close-design.md §3.1
--
-- Rollback: DELETE the 2 chart_of_accounts rows (safe iff no JE references them yet).
--           Enum ADD VALUE cannot be reversed in-place; would need TYPE recreation
--           (destructive — accept as forward-only).

BEGIN;

-- 1. New COA accounts
-- Note: chart_of_accounts unique constraint is (tenant_id, account_code).
-- Garindo uses tenant_id=NULL. Since NULL is treated as distinct in PG unique
-- indexes (NULLS DISTINCT default), ON CONFLICT does not reliably fire on
-- (NULL, account_code) — use WHERE NOT EXISTS instead for true idempotency.
INSERT INTO public.chart_of_accounts
  (account_code, account_name, account_type, account_subtype, normal_balance, is_control_account, is_system)
SELECT '5-1200', 'HPP Barang Passthrough', 'BEBAN', 'HPP', 'DEBIT', false, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts
  WHERE tenant_id IS NULL AND account_code = '5-1200'
);

INSERT INTO public.chart_of_accounts
  (account_code, account_name, account_type, account_subtype, normal_balance, is_control_account, is_system)
SELECT '2-1150', 'Hutang Passthrough Accrued', 'LIABILITAS', 'HUTANG_USAHA', 'CREDIT', false, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts
  WHERE tenant_id IS NULL AND account_code = '2-1150'
);

-- 2. Link parent_id (5-1200 under 5-1000, 2-1150 under 2-1100 parent group)
UPDATE public.chart_of_accounts SET parent_id = (
  SELECT id FROM public.chart_of_accounts WHERE account_code = '5-1000'
) WHERE account_code = '5-1200';

UPDATE public.chart_of_accounts SET parent_id = (
  SELECT id FROM public.chart_of_accounts WHERE account_code = '2-1100'
) WHERE account_code = '2-1150';

-- 3. New enum values
DO $$ BEGIN
  ALTER TYPE public.journal_entry_source ADD VALUE 'TEMPO_INVOICE_CREATE';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.journal_entry_source ADD VALUE 'TEMPO_WRITEOFF_REVERT';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.journal_entry_source ADD VALUE 'BACKFILL_TEMPO_INVOICE';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.journal_entry_source ADD VALUE 'BACKFILL_PI_PASSTHROUGH';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.journal_entry_source ADD VALUE 'BACKFILL_PEMBAYARAN';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.journal_entry_source ADD VALUE 'BACKFILL_TEMPO_WRITEOFF';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
