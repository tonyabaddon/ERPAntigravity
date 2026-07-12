-- 20261115000228_warehouse_transfer_je_enum.sql
--
-- Warehouse-transfer accounting integration — Part 1 of 2: enum extension.
--
-- Adds `WAREHOUSE_TRANSFER` value to `public.journal_entry_source`. Split
-- from the main patch (slot 229) because PostgreSQL 12+ allows
-- `ALTER TYPE ... ADD VALUE` inside a transaction, but the new value
-- cannot be USED in the same transaction it was added. Splitting into
-- two migrations gives slot 229 access to the new enum value.
--
-- Idempotent: guarded by IF NOT EXISTS lookup against pg_enum.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'journal_entry_source'
      AND e.enumlabel = 'WAREHOUSE_TRANSFER'
  ) THEN
    ALTER TYPE public.journal_entry_source ADD VALUE 'WAREHOUSE_TRANSFER';
  END IF;
END $$;
