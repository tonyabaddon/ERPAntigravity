-- supabase/migrations/20260620000020_stock_lots_source_tracking.sql
-- Phase 2a hotfix: add source_id + source_type to stock_lots so Phase 2 Tagihan
-- (purchase_invoices type=STOCK) can be tracked as a stock source, alongside
-- the existing Phase 1 po_id column.
--
-- Rationale: spec §17 listed "Existing stock_lots re-attributed to Tagihan via
-- source_id/source_type" as a backward-compat goal, but the actual migration
-- was never authored — Phase 2a Task 5 RPC `record_pi` writes those columns
-- without them existing. This unblocks Tagihan creation.
--
-- Strategy: additive. Keep po_id column (still used by old PO module + as FK
-- to purchase_orders). Add nullable source_id (uuid) + source_type ('PURCHASE_ORDER'|'TAGIHAN').
-- Backfill existing rows with po_id → source_id + source_type='PURCHASE_ORDER'.

BEGIN;

ALTER TABLE public.stock_lots ADD COLUMN IF NOT EXISTS source_id uuid;
ALTER TABLE public.stock_lots ADD COLUMN IF NOT EXISTS source_type text
  CHECK (source_type IS NULL OR source_type IN ('PURCHASE_ORDER','TAGIHAN'));

-- Backfill: every existing row whose po_id is set becomes source_type=PURCHASE_ORDER.
UPDATE public.stock_lots
SET source_id = po_id, source_type = 'PURCHASE_ORDER'
WHERE po_id IS NOT NULL AND source_id IS NULL;

CREATE INDEX IF NOT EXISTS stock_lots_source_idx ON public.stock_lots (source_type, source_id)
  WHERE source_id IS NOT NULL;

COMMIT;
