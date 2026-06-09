-- Align orders.dp_input_type allowed values with kasir_transactions.
--
-- Before:
--   orders.chk_dp_input_type             → NULL | 'AMOUNT' | 'PERCENTAGE'
--   kasir_transactions.chk_kasir_dp_input_type → NULL | 'AMOUNT' | 'PERCENT'
--
-- After (both):
--   NULL | 'AMOUNT' | 'PERCENT'
--
-- Why PERCENT and not PERCENTAGE: kasir_transactions is the source of
-- truth for revenue + already used by every PenjualanBaruScreen sale. The
-- KasirDpInputType TS type was already 'AMOUNT' | 'PERCENT'. Aligning
-- orders to match kasir avoids needing a mapping step when a walk-in
-- draft (orders row) is settled and copied into a kasir_transactions row.

-- 1. Backfill any existing PERCENTAGE rows to PERCENT. UPDATE is idempotent.
UPDATE public.orders
SET dp_input_type = 'PERCENT'
WHERE dp_input_type = 'PERCENTAGE';

-- 2. Replace the constraint. Drop-if-exists then add — safe to re-run.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS chk_dp_input_type;
ALTER TABLE public.orders
  ADD CONSTRAINT chk_dp_input_type
  CHECK (dp_input_type IS NULL OR dp_input_type IN ('AMOUNT', 'PERCENT'));
