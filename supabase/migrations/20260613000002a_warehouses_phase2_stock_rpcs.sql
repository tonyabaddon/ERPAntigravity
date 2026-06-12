-- supabase/migrations/20260613000002a_warehouses_phase2_stock_rpcs.sql
-- Phase 2a of configurable warehouses: rewrite the three SECURITY DEFINER
-- stock-mutating RPCs to take warehouse_id uuid + reads/writes stock_levels.
-- The old text-arg signatures stay as overloads that resolve text → warehouse_id
-- internally so old frontend bundles keep working during the deploy window.
-- Migration 3 drops the overloads and the legacy text columns.

BEGIN;

-- ─── Pre-requisite: allow NULL in stock_movements.warehouse ─────────────────
-- _log_stock_movement is now called with p_warehouse => NULL from the new
-- uuid-aware RPCs (the legacy text column is being deprecated in Migration 3).
-- Drop the NOT NULL so the helper INSERT succeeds; the CHECK already accepts
-- NULL (PostgreSQL evaluates CHECK with UNKNOWN → row passes).
ALTER TABLE public.stock_movements ALTER COLUMN warehouse DROP NOT NULL;

-- ─── transfer_warehouse (new uuid signature) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_warehouse(
  p_sku                text,
  p_from_warehouse_id  uuid,
  p_to_warehouse_id    uuid,
  p_qty                int
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_from_qty    int;
  v_from_before int;
  v_to_before   int;
  v_from_tenant uuid;
  v_to_tenant   uuid;
  v_found_from  boolean := false;
  v_found_to    boolean := false;
BEGIN
  IF p_from_warehouse_id = p_to_warehouse_id THEN
    RAISE EXCEPTION 'transfer_warehouse: source and destination must differ';
  END IF;

  SELECT tenant_id INTO v_from_tenant
    FROM warehouses WHERE id = p_from_warehouse_id AND is_active;
  GET DIAGNOSTICS v_found_from = ROW_COUNT;
  IF v_found_from = 0 THEN
    RAISE EXCEPTION 'transfer_warehouse: source warehouse not found or not active';
  END IF;

  SELECT tenant_id INTO v_to_tenant
    FROM warehouses WHERE id = p_to_warehouse_id AND is_active;
  GET DIAGNOSTICS v_found_to = ROW_COUNT;
  IF v_found_to = 0 THEN
    RAISE EXCEPTION 'transfer_warehouse: destination warehouse not found or not active';
  END IF;

  IF v_from_tenant IS DISTINCT FROM v_to_tenant THEN
    RAISE EXCEPTION 'transfer_warehouse: cross-tenant transfer is not allowed';
  END IF;

  -- Source row + lock
  SELECT qty INTO v_from_before
    FROM stock_levels
   WHERE sku = p_sku AND warehouse_id = p_from_warehouse_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SKU % belum ada di gudang asal', p_sku;
  END IF;

  v_from_qty := v_from_before;
  IF v_from_qty < p_qty THEN
    RAISE EXCEPTION 'Stok gudang asal tidak cukup: tersedia %, diminta %', v_from_qty, p_qty;
  END IF;

  -- Destination row (snapshot for ledger qty_before — 0 if row doesn't exist yet)
  SELECT qty INTO v_to_before
    FROM stock_levels
   WHERE sku = p_sku AND warehouse_id = p_to_warehouse_id
   FOR UPDATE;
  v_to_before := COALESCE(v_to_before, 0);

  -- Apply stock_levels mutations
  UPDATE stock_levels
     SET qty = qty - p_qty, updated_at = now()
   WHERE sku = p_sku AND warehouse_id = p_from_warehouse_id;

  INSERT INTO stock_levels (sku, warehouse_id, qty)
       VALUES (p_sku, p_to_warehouse_id, p_qty)
  ON CONFLICT (sku, warehouse_id)
  DO UPDATE SET qty = stock_levels.qty + EXCLUDED.qty, updated_at = now();

  -- Ledger: transfer_out row
  PERFORM public._log_stock_movement(
    p_sku              => p_sku,
    p_warehouse        => NULL,        -- legacy text column deprecated in Migration 3
    p_qty_delta        => -p_qty,
    p_qty_before       => v_from_before,
    p_source           => 'transfer_out'::public.stock_movement_source,
    p_related_doc_type => 'transfer_legacy',
    p_related_doc_id   => NULL
  );
  UPDATE stock_movements
     SET warehouse_id = p_from_warehouse_id
   WHERE id = (
     SELECT id FROM stock_movements
      WHERE sku = p_sku AND source = 'transfer_out'
      ORDER BY id DESC LIMIT 1
   );

  -- Ledger: transfer_in row
  PERFORM public._log_stock_movement(
    p_sku              => p_sku,
    p_warehouse        => NULL,
    p_qty_delta        => p_qty,
    p_qty_before       => v_to_before,
    p_source           => 'transfer_in'::public.stock_movement_source,
    p_related_doc_type => 'transfer_legacy',
    p_related_doc_id   => NULL
  );
  UPDATE stock_movements
     SET warehouse_id = p_to_warehouse_id
   WHERE id = (
     SELECT id FROM stock_movements
      WHERE sku = p_sku AND source = 'transfer_in'
      ORDER BY id DESC LIMIT 1
   );
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_warehouse(text, uuid, uuid, int) TO authenticated;

-- ─── transfer_warehouse (legacy text-arg overload) ──────────────────────────
-- Resolves 'atas'|'bawah' → warehouse_id and delegates to the new function.
-- The old SECURITY DEFINER body is replaced here with a thin wrapper.
CREATE OR REPLACE FUNCTION public.transfer_warehouse(
  p_sku  text,
  p_from text,
  p_to   text,
  p_qty  int
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_from_id uuid;
  v_to_id   uuid;
BEGIN
  SELECT id INTO v_from_id
    FROM warehouses WHERE tenant_id IS NULL AND code = upper(p_from);
  SELECT id INTO v_to_id
    FROM warehouses WHERE tenant_id IS NULL AND code = upper(p_to);
  IF v_from_id IS NULL OR v_to_id IS NULL THEN
    RAISE EXCEPTION 'transfer_warehouse: legacy code mapping failed (from=%, to=%)', p_from, p_to;
  END IF;
  PERFORM public.transfer_warehouse(p_sku, v_from_id, v_to_id, p_qty);
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_warehouse(text, text, text, int) TO authenticated;

-- ─── decrement_stock (new uuid signature) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.decrement_stock(
  p_sku          text,
  p_warehouse_id uuid,
  p_qty          int
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_before int;
BEGIN
  SELECT qty INTO v_before
    FROM stock_levels
   WHERE sku = p_sku AND warehouse_id = p_warehouse_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SKU % belum ada di gudang yang dipilih', p_sku;
  END IF;
  IF v_before < p_qty THEN
    RAISE EXCEPTION 'Stok tidak cukup: tersedia %, diminta %', v_before, p_qty;
  END IF;
  UPDATE stock_levels
     SET qty = GREATEST(0, qty - p_qty), updated_at = now()
   WHERE sku = p_sku AND warehouse_id = p_warehouse_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decrement_stock(text, uuid, int) TO authenticated;

-- ─── decrement_stock (legacy text-arg overload) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.decrement_stock(
  p_sku       text,
  p_warehouse text,
  p_qty       int
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id
    FROM warehouses WHERE tenant_id IS NULL AND code = upper(p_warehouse);
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'decrement_stock: legacy code mapping failed (%)', p_warehouse;
  END IF;
  PERFORM public.decrement_stock(p_sku, v_id, p_qty);
END;
$$;

GRANT EXECUTE ON FUNCTION public.decrement_stock(text, text, int) TO authenticated;

-- ─── seed_stock_row (new jsonb signature) ───────────────────────────────────
-- New overload: accepts p_initial_levels jsonb mapping {warehouse_id_str: qty}
-- instead of p_stock_atas + p_stock_bawah ints. The old 8-arg signature from
-- migration 20260607000017 is left completely unchanged as a separate overload.
CREATE OR REPLACE FUNCTION public.seed_stock_row(
  p_sku            text,
  p_name           text,
  p_category       text,
  p_price          numeric,
  p_harga_modal    numeric,
  p_initial_levels jsonb  DEFAULT '{}'::jsonb,
  p_actor_user_id  uuid   DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor  uuid := COALESCE(p_actor_user_id, auth.uid());
  v_role   text;
  v_kv     record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'seed_stock_row requires p_actor_user_id (or auth.uid())';
  END IF;

  -- Owner-only gate (same as existing 8-arg overload)
  SELECT role INTO v_role FROM admin_users WHERE id = v_actor;
  IF v_role IS DISTINCT FROM 'Owner' THEN
    RAISE EXCEPTION 'seed_stock_row requires Owner role (actor=% role=%)',
      v_actor, COALESCE(v_role, '<missing>');
  END IF;

  -- INSERT-or-fail: ON CONFLICT DO NOTHING → FOUND is false on duplicate SKU
  INSERT INTO stocks (sku, name, category, price, harga_modal, stock, status, specs)
       VALUES (p_sku, p_name, p_category, p_price, p_harga_modal, 0, 'Sinkron', '{}'::jsonb)
  ON CONFLICT (sku) DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sku % already exists — use the approval flow to change existing rows', p_sku;
  END IF;

  -- Initial price-history audit rows
  INSERT INTO stock_price_history (sku, field, old_value, new_value, source, actor_user_id, actor_role)
       VALUES (p_sku, 'price',       0, p_price,       'seed', v_actor, 'Owner'),
              (p_sku, 'harga_modal', 0, p_harga_modal, 'seed', v_actor, 'Owner');

  -- Iterate the jsonb {warehouse_id_string: qty} map.
  -- Insert a stock_levels row for each (including qty=0) so every SKU has
  -- explicit per-warehouse coverage; only write a ledger row for non-zero qty.
  FOR v_kv IN SELECT key, (value::text)::int AS qty
                FROM jsonb_each_text(p_initial_levels) LOOP
    INSERT INTO stock_levels (sku, warehouse_id, qty)
         VALUES (p_sku, v_kv.key::uuid, v_kv.qty);

    IF v_kv.qty > 0 THEN
      PERFORM public._log_stock_movement(
        p_sku           => p_sku,
        p_warehouse     => NULL,   -- legacy text column deprecated in Migration 3
        p_qty_delta     => v_kv.qty,
        p_qty_before    => 0,
        p_source        => 'seed'::public.stock_movement_source,
        p_actor_user_id => v_actor,
        p_actor_role    => 'Owner'
      );
      UPDATE stock_movements
         SET warehouse_id = v_kv.key::uuid
       WHERE id = (
         SELECT id FROM stock_movements
          WHERE sku = p_sku AND source = 'seed'
          ORDER BY id DESC LIMIT 1
       );
    END IF;
  END LOOP;

  RETURN p_sku;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_stock_row(text, text, text, numeric, numeric, jsonb, uuid) TO authenticated;

-- The existing 8-arg legacy seed_stock_row(text, text, text, numeric, numeric,
-- int, int, uuid) from migration 20260607000017 is NOT touched here — Postgres
-- function overload resolution keeps it active alongside the new 7-arg form.

COMMIT;
