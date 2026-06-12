-- supabase/migrations/20260613000003_warehouses_phase3_cutover.sql
-- Phase 3 cutover. Drops the legacy text-arg overloads and the
-- stock_atas/stock_bawah columns. One-way. Apply only after the new
-- frontend has been live for >= 1 day with no errors.
--
-- Pre-conditions (verify BEFORE applying):
--   1. Migrations 20260613000001..2d + 4 all applied.
--   2. Cloud Run frontend running the new build for >= 24 hours.
--   3. No errors in Supabase or Cloud Run logs referencing
--      `stock_atas`, `stock_bawah`, or `warehouse` text values.
--   4. Optional sanity: `SELECT COUNT(*) FROM stock_levels` matches
--      `(SELECT COUNT(*) FROM stocks) * (SELECT COUNT(*) FROM warehouses
--      WHERE tenant_id IS NULL)`.

BEGIN;

-- Drop legacy RPC overloads (text-arg versions)
DROP FUNCTION IF EXISTS public.transfer_warehouse(text, text, text, int);
DROP FUNCTION IF EXISTS public.decrement_stock(text, text, int);
-- Legacy seed_stock_row with int args for atas/bawah qtys
DROP FUNCTION IF EXISTS public.seed_stock_row(text, text, text, numeric, numeric, int, int, uuid);
-- Legacy 6-arg receive_purchase_order (we now use 5-arg with conditions[item_id].warehouse_id)
DROP FUNCTION IF EXISTS public.receive_purchase_order(uuid, timestamptz, date, text, jsonb, text);

-- Promote warehouse_id to NOT NULL on tables where it should always have a value
ALTER TABLE public.stock_movements      ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE public.stock_adjustments    ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE public.stock_opname_counts  ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE public.purchase_order_items ALTER COLUMN warehouse_id SET NOT NULL;
-- orders + kasir_transactions stay nullable (channel-routed default may legitimately be NULL)

-- Drop the legacy text columns
ALTER TABLE public.stock_movements      DROP COLUMN IF EXISTS warehouse;
ALTER TABLE public.stock_adjustments    DROP COLUMN IF EXISTS warehouse;
ALTER TABLE public.stock_opname_counts  DROP COLUMN IF EXISTS warehouse;
ALTER TABLE public.orders               DROP COLUMN IF EXISTS warehouse;
ALTER TABLE public.purchase_order_items DROP COLUMN IF EXISTS warehouse;

-- Drop the legacy stocks columns. The SUM trigger from Migration 1 keeps
-- stocks.stock in sync via stock_levels — these columns are no longer needed.
ALTER TABLE public.stocks DROP COLUMN IF EXISTS stock_atas;
ALTER TABLE public.stocks DROP COLUMN IF EXISTS stock_bawah;

-- Drop the legacy sync trigger that depended on stock_atas/bawah
DROP TRIGGER IF EXISTS trg_sync_stock_total ON public.stocks;
DROP FUNCTION IF EXISTS public.sync_stock_total();

COMMIT;
