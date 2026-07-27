-- Slot 522 — schema hardening after slot 521 backfill.
--
-- Prevents any future cash_account row from being inserted without a COA link.
-- Safe: slot 521 backfilled all NULL rows in prod (2 rows on Toko Jaya).
-- Verified pre-apply: SELECT count(*) FROM cash_accounts WHERE coa_account_id IS NULL = 0.
--
-- Idempotent: SET NOT NULL is a no-op if column is already NOT NULL.
-- Rollback: ALTER TABLE public.cash_accounts ALTER COLUMN coa_account_id DROP NOT NULL;

ALTER TABLE public.cash_accounts
  ALTER COLUMN coa_account_id SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cash_accounts'
      AND column_name = 'coa_account_id'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'cash_accounts_coa_link_not_null: constraint verification failed';
  END IF;
  RAISE NOTICE 'cash_accounts_coa_link_not_null: OK';
END $$;
