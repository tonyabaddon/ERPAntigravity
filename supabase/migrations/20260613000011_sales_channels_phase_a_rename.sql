-- Phase A — Rename tokped_order_no to marketplace_order_no
-- View alias gives 1-week soak for frontend cutover (Phase C/D).

ALTER TABLE public.kasir_transactions
  RENAME COLUMN tokped_order_no TO marketplace_order_no;

-- Add a column comment so future readers understand the field semantics.
COMMENT ON COLUMN public.kasir_transactions.marketplace_order_no IS
  'Order number from the originating marketplace. Required when channel is one of: tokopedia, shopee, lazada, blibli, bukalapak, ralali, bhinneka. NULL for offline and direct channels.';

-- Backward-compat alias view — drop in Phase D after 1-week soak.
-- Lets legacy code that still SELECTs tokped_order_no continue working.
CREATE OR REPLACE VIEW public.kasir_transactions_legacy AS
  SELECT *,
    marketplace_order_no AS tokped_order_no
  FROM public.kasir_transactions;
