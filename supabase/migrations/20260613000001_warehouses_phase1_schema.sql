-- supabase/migrations/20260613000001_warehouses_phase1_schema.sql
-- Phase 1 of configurable N warehouses (spec
-- docs/superpowers/specs/2026-06-13-warehouses-configurable-design.md):
-- additive schema. Creates the new tables, backfills stock_levels from the
-- existing stocks.stock_atas + stocks.stock_bawah columns, adds nullable
-- warehouse_id columns to every history table and backfills them from the
-- existing 'atas'|'bawah' text values, and installs the SUM trigger that
-- keeps stocks.stock in sync.
--
-- After this migration: both old (stocks.stock_atas/bawah,
-- stock_movements.warehouse text) and new (stock_levels, warehouse_id uuid)
-- columns coexist. Nothing breaks. Migration 2 rewrites the RPCs to read
-- the new columns; Migration 3 drops the old ones.

BEGIN;

-- ─── 1. warehouses table ───────────────────────────────────────────────────
CREATE TABLE public.warehouses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NULL,
  code        text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,16}$'),
  name        text NOT NULL,
  address     text NULL,
  is_active   boolean NOT NULL DEFAULT true,
  is_default  boolean NOT NULL DEFAULT false,
  sort_order  int     NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE UNIQUE INDEX warehouses_one_default_per_tenant
  ON public.warehouses (tenant_id) WHERE is_default;
CREATE UNIQUE INDEX warehouses_name_unique_per_tenant
  ON public.warehouses (tenant_id, lower(name));

-- ─── 2. Seed 2 warehouses for the current tenant ───────────────────────────
INSERT INTO public.warehouses (code, name, is_default, sort_order)
VALUES ('ATAS', 'Gudang Atas', true,  10),
       ('BAWAH', 'Gudang Bawah', false, 20);

-- ─── 3. stock_levels table ─────────────────────────────────────────────────
CREATE TABLE public.stock_levels (
  sku          text NOT NULL REFERENCES public.stocks(sku) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  qty          int  NOT NULL DEFAULT 0 CHECK (qty >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sku, warehouse_id)
);

-- Backfill: every (SKU, ATAS) row + every (SKU, BAWAH) row, qty from
-- the existing columns. Inserts qty=0 rows too so every SKU has explicit
-- per-warehouse coverage.
INSERT INTO public.stock_levels (sku, warehouse_id, qty)
SELECT s.sku,
       (SELECT id FROM public.warehouses WHERE tenant_id IS NULL AND code='ATAS'),
       s.stock_atas
  FROM public.stocks s
UNION ALL
SELECT s.sku,
       (SELECT id FROM public.warehouses WHERE tenant_id IS NULL AND code='BAWAH'),
       s.stock_bawah
  FROM public.stocks s;

-- ─── 4. warehouse_audit_log (append-only) ──────────────────────────────────
CREATE TABLE public.warehouse_audit_log (
  id            bigserial PRIMARY KEY,
  warehouse_id  uuid NOT NULL REFERENCES public.warehouses(id),
  actor_user_id uuid NOT NULL,
  action        text NOT NULL CHECK (action IN
    ('create','rename','set_default','deactivate','force_deactivate','reactivate','address_update','sort_update')),
  before        jsonb,
  after         jsonb,
  reason_note   text NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Append-only: revoke UPDATE/DELETE + deny trigger same pattern as rakit_audit_log
REVOKE UPDATE, DELETE ON public.warehouse_audit_log FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public._block_warehouse_audit_mutations()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'warehouse_audit_log is append-only (% blocked)', TG_OP;
END $$;
CREATE TRIGGER trg_block_warehouse_audit_update
  BEFORE UPDATE ON public.warehouse_audit_log
  FOR EACH ROW EXECUTE FUNCTION public._block_warehouse_audit_mutations();
CREATE TRIGGER trg_block_warehouse_audit_delete
  BEFORE DELETE ON public.warehouse_audit_log
  FOR EACH ROW EXECUTE FUNCTION public._block_warehouse_audit_mutations();

-- ─── 5. Add warehouse_id columns to history tables (nullable for Phase 1) ──
ALTER TABLE public.stock_movements      ADD COLUMN warehouse_id uuid NULL REFERENCES public.warehouses(id);
ALTER TABLE public.stock_adjustments    ADD COLUMN warehouse_id uuid NULL REFERENCES public.warehouses(id);
ALTER TABLE public.stock_opname_counts  ADD COLUMN warehouse_id uuid NULL REFERENCES public.warehouses(id);
ALTER TABLE public.orders               ADD COLUMN warehouse_id uuid NULL REFERENCES public.warehouses(id);
ALTER TABLE public.kasir_transactions   ADD COLUMN warehouse_id uuid NULL REFERENCES public.warehouses(id);
ALTER TABLE public.purchase_order_items ADD COLUMN warehouse_id uuid NULL REFERENCES public.warehouses(id);

-- Backfill warehouse_id from the existing 'atas'|'bawah' text columns where they exist.
-- stock_movements is append-only (the trg_deny_sm_update trigger blocks UPDATEs); the
-- backfill is a one-time schema-evolution exception, so we temporarily disable the
-- deny-trigger for the duration of this transaction, run the UPDATE, then re-enable.
ALTER TABLE public.stock_movements DISABLE TRIGGER trg_deny_sm_update;
UPDATE public.stock_movements      SET warehouse_id = (SELECT id FROM public.warehouses WHERE tenant_id IS NULL AND code = upper(warehouse));
ALTER TABLE public.stock_movements ENABLE TRIGGER trg_deny_sm_update;

UPDATE public.stock_adjustments    SET warehouse_id = (SELECT id FROM public.warehouses WHERE tenant_id IS NULL AND code = upper(warehouse));
UPDATE public.stock_opname_counts  SET warehouse_id = (SELECT id FROM public.warehouses WHERE tenant_id IS NULL AND code = upper(warehouse));
UPDATE public.orders               SET warehouse_id = (SELECT id FROM public.warehouses WHERE tenant_id IS NULL AND code = upper(warehouse));
-- purchase_order_items + kasir_transactions don't have a `warehouse` text column —
-- their warehouse_id stays NULL on existing rows and gets populated by future
-- receive / sale flows that pass warehouse_id explicitly.

-- ─── 6. stocks.stock SUM trigger ───────────────────────────────────────────
-- The old sync_stock_total trigger set stock = stock_atas + stock_bawah on
-- INSERT/UPDATE of stocks. Replace with a trigger ON stock_levels that
-- recomputes the SUM whenever per-warehouse qty changes.
CREATE OR REPLACE FUNCTION public._sync_stocks_stock_from_levels()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_sku text;
BEGIN
  v_sku := COALESCE(NEW.sku, OLD.sku);
  UPDATE public.stocks
     SET stock = COALESCE((SELECT SUM(qty) FROM public.stock_levels WHERE sku = v_sku), 0)
   WHERE sku = v_sku;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_stock_levels_sync_sum
  AFTER INSERT OR UPDATE OF qty OR DELETE ON public.stock_levels
  FOR EACH ROW EXECUTE FUNCTION public._sync_stocks_stock_from_levels();

-- Disable (but don't drop) the legacy sync trigger — it fires on stocks
-- INSERT/UPDATE which won't carry stock_atas/bawah edits going forward.
-- Migration 3 drops it together with the old columns.
ALTER TABLE public.stocks DISABLE TRIGGER trg_sync_stock_total;

COMMIT;
