-- 20261115000213_extend_stock_movement_source_enum.sql
-- Extend stock_movement_source enum with two new values used by the
-- warehouse transfer flow.
-- - 'transfer_loss'          : audit-only row for PARTIAL receive; NOT re-applied to stock_levels
-- - 'transfer_cancel_return' : source stock_levels credit on sender cancel

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'stock_movement_source' AND e.enumlabel = 'transfer_loss'
  ) THEN
    ALTER TYPE public.stock_movement_source ADD VALUE 'transfer_loss';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'stock_movement_source' AND e.enumlabel = 'transfer_cancel_return'
  ) THEN
    ALTER TYPE public.stock_movement_source ADD VALUE 'transfer_cancel_return';
  END IF;
END $$;
