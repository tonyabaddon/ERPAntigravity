-- 20261115000524_kasir_transactions_expense_category_to_text.sql
-- Migrate kasir_transactions.expense_category from enum kasir_expense_category → TEXT.
-- Non-breaking for existing RPCs: enum type retained; cast '...'::kasir_expense_category
-- returns TEXT and inserts fine into a TEXT column. RPC cast cleanup deferred to
-- follow-up migrations (525+). DROP TYPE deferred until all casts removed (post-soak).
--
-- Rollback plan: ALTER COLUMN TYPE kasir_expense_category USING expense_category::kasir_expense_category
-- (works only while all existing values are still valid enum literals — i.e., before FE
-- ships custom labels).

DO $$
DECLARE
  v_current_type text;
BEGIN
  SELECT udt_name INTO v_current_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'kasir_transactions'
      AND column_name = 'expense_category';

  IF v_current_type = 'text' THEN
    RAISE NOTICE 'expense_category already TEXT — skipping';
    RETURN;
  END IF;

  IF v_current_type <> 'kasir_expense_category' THEN
    RAISE EXCEPTION 'unexpected type % for expense_category', v_current_type;
  END IF;

  ALTER TABLE public.kasir_transactions
    ALTER COLUMN expense_category TYPE text
    USING expense_category::text;

  RAISE NOTICE 'expense_category migrated to TEXT';
END $$;

COMMENT ON COLUMN public.kasir_transactions.expense_category IS
  'User-facing expense category label. TEXT (was kasir_expense_category enum) since '
  'slot 524, to allow tenant-configurable labels. System-emitted values '
  '(''Pembelian Stok'', ''Pembelian Pass-Through'', ''MDR EDC'') remain valid but '
  'invisible in UI. See kasir_expense_categories table + design doc.';
