-- supabase/migrations/20260613000002b_warehouses_phase2_sale_po_rpcs.sql
-- Phase 2b of configurable N warehouses: rewrite record_kasir_sale and
-- receive_purchase_order to read warehouse_id (uuid) from items, mutating
-- stock_levels instead of stocks.stock_atas/bawah.
--
-- Sources this migration copies and adapts:
--   record_kasir_sale body:   20260610000001_record_kasir_sale_service_lines.sql
--   receive_purchase_order body: 20260604000010_receive_po_add_payment_fields.sql
--
-- DEVIATIONS from task-spec (documented):
--   1. No kasir_transaction_items table exists. Items are stored as JSONB in
--      kasir_transactions.items. Per-line warehouse_id is stored inside each
--      JSONB item element as items[].warehouse_id (uuid text).
--   2. p_actor_user_id (uuid DEFAULT NULL) added as the 21st parameter to
--      record_kasir_sale. Adding a parameter requires DROP + CREATE (not just
--      CREATE OR REPLACE). Old callers that omit the param work via DEFAULT NULL.
--   3. receive_purchase_order does not have a p_warehouse text param in its
--      canonical body. Per-line warehouse_id comes from p_conditions per-item
--      jsonb. A top-level default is resolved from the single seeded ATAS
--      warehouse (is_default=true) so existing callers without warehouse_id
--      in conditions still work.
--   4. decrement_stock (the old 6-arg text-warehouse version that mutated
--      stocks.stock_atas/bawah) is replaced with inline SELECT FOR UPDATE on
--      stock_levels + UPDATE. deduct_stock_fifo retains the text 'atas' default
--      (FIFO is per-SKU, not per-warehouse; spec says FIFO stays per-SKU).

BEGIN;

-- ─── record_kasir_sale ────────────────────────────────────────────────────────
-- Drop the existing 20-arg signature first (adding p_actor_user_id changes
-- the signature — CREATE OR REPLACE cannot change param list).
DROP FUNCTION IF EXISTS public.record_kasir_sale(
  date, text, jsonb, numeric, text, text, text, numeric, text,
  numeric, text, numeric, text, text, text, text, text, text, text, text
);

CREATE FUNCTION public.record_kasir_sale(
  p_date              date,
  p_channel           text,
  p_items             jsonb,
  p_subtotal          numeric,
  p_payment_method    text,
  p_payment_subtype   text,
  p_payment_type      text,
  p_dp_amount         numeric,
  p_dp_input_type     text,
  p_ongkir_amount     numeric,
  p_notes             text,
  p_total_amount      numeric,
  p_customer_name     text,
  p_customer_phone    text,
  p_customer_company  text,
  p_delivery_address  text,
  p_tokped_order_no   text,
  p_wa_phone          text,
  p_wa_chat_url       text,
  p_customer_id       text,
  p_actor_user_id     uuid    DEFAULT NULL   -- NEW in Phase 2b
)
RETURNS public.kasir_transactions
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id    text := p_customer_id;
  v_counter        int;
  v_invoice_prefix text;
  v_invoice_number text;
  v_status         text;
  v_kasir          public.kasir_transactions%ROWTYPE;
  v_agg            record;
  v_agg_cost       numeric;
  v_cost_map       jsonb := '{}'::jsonb;
  v_items_out      jsonb := '[]'::jsonb;
  v_item           jsonb;
  v_item_out       jsonb;
  v_sku            text;
  v_qty            int;
  v_warehouse      text;        -- legacy text warehouse (retained for FIFO call)
  v_hpp_per_unit   numeric;
  v_hpp_subtotal   numeric;
  v_hpp_total      numeric := 0;
  v_key            text;
  -- NEW Phase 2b variables
  v_warehouse_id   uuid;        -- resolved warehouse_id for stock_levels mutation
  v_warehouse_txt  text;        -- temp for legacy text → uuid lookup
  v_before         int;         -- qty_before for ledger
  v_mv_id          bigint;      -- returned BIGINT from _log_stock_movement
BEGIN
  -- 1. Input validation. Fail fast before any side effects.
  IF p_channel NOT IN ('walkin', 'tokopedia', 'grosir', 'whatsapp') THEN
    RAISE EXCEPTION 'invalid channel: % (expected walkin|tokopedia|grosir|whatsapp)', p_channel;
  END IF;
  IF p_payment_method NOT IN ('cash', 'transfer', 'qris', 'edc') THEN
    RAISE EXCEPTION 'invalid payment_method: % (expected cash|transfer|qris|edc)', p_payment_method;
  END IF;
  IF p_payment_subtype IS NOT NULL AND p_payment_subtype NOT IN ('debit', 'qris') THEN
    RAISE EXCEPTION 'invalid payment_subtype: % (expected NULL|debit|qris)', p_payment_subtype;
  END IF;
  IF p_payment_type NOT IN ('FULL', 'DP') THEN
    RAISE EXCEPTION 'invalid payment_type: % (expected FULL|DP)', p_payment_type;
  END IF;
  IF p_dp_input_type IS NOT NULL AND p_dp_input_type NOT IN ('AMOUNT', 'PERCENT') THEN
    RAISE EXCEPTION 'invalid dp_input_type: % (expected NULL|AMOUNT|PERCENT)', p_dp_input_type;
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items harus berisi minimal satu baris item';
  END IF;

  -- 2. Find-or-create customer if not already linked.
  IF v_customer_id IS NULL
     AND p_customer_phone IS NOT NULL AND length(btrim(p_customer_phone)) > 0
     AND p_customer_name  IS NOT NULL AND length(btrim(p_customer_name))  > 0 THEN
    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE wa_number = btrim(p_customer_phone)
    LIMIT 1;
    IF v_customer_id IS NULL THEN
      v_customer_id := gen_random_uuid()::text;
      INSERT INTO public.customers (id, wa_number, name, company)
      VALUES (
        v_customer_id,
        btrim(p_customer_phone),
        btrim(p_customer_name),
        COALESCE(btrim(p_customer_company), '')
      )
      ON CONFLICT (wa_number) DO UPDATE
        SET name = EXCLUDED.name
      RETURNING id INTO v_customer_id;
    END IF;
  END IF;

  -- 3. Reserve the invoice number BEFORE stock mutations.
  v_counter := public.next_kasir_number(p_channel, p_date);
  v_invoice_prefix := CASE p_channel
    WHEN 'walkin'    THEN 'WLK'
    WHEN 'tokopedia' THEN 'TPD'
    WHEN 'whatsapp'  THEN 'WAM'
    ELSE 'GRS'
  END;
  v_invoice_number := v_invoice_prefix
    || '-' || to_char(p_date, 'YYYYMMDD')
    || '-' || lpad(v_counter::text, 3, '0');

  -- 4. Aggregate (sku, warehouse_id) for SKU lines only. Service lines
  --    (sku IS NULL) are skipped here: no stock decrement, no FIFO walk.
  --
  --    Phase 2b: resolve warehouse_id from each item's warehouse_id field
  --    (preferred) or legacy warehouse text field (fallback). The aggregation
  --    groups by sku + resolved warehouse_id to handle multi-line carts.
  FOR v_agg IN
    SELECT
      item->>'sku' AS sku,
      NULLIF(item->>'warehouse_id', '')::uuid AS warehouse_id,
      item->>'warehouse' AS warehouse_txt,
      SUM((item->>'qty')::int)::int AS qty
    FROM jsonb_array_elements(p_items) AS item
    WHERE item->>'sku' IS NOT NULL
    GROUP BY 1, 2, 3
  LOOP
    IF v_agg.sku IS NULL OR v_agg.qty IS NULL OR v_agg.qty <= 0 THEN
      RAISE EXCEPTION 'item tidak valid di p_items: sku=%, qty=%', v_agg.sku, v_agg.qty;
    END IF;

    -- Resolve warehouse_id: prefer uuid field, fall back to text code lookup.
    v_warehouse_id := v_agg.warehouse_id;
    IF v_warehouse_id IS NULL THEN
      v_warehouse_txt := v_agg.warehouse_txt;
      IF v_warehouse_txt IS NOT NULL THEN
        SELECT id INTO v_warehouse_id FROM public.warehouses
          WHERE tenant_id IS NULL AND code = upper(v_warehouse_txt);
      END IF;
    END IF;
    IF v_warehouse_id IS NULL THEN
      RAISE EXCEPTION 'record_kasir_sale: warehouse_id diperlukan untuk SKU %', v_agg.sku;
    END IF;

    -- Lock + validate stock_levels row for this (sku, warehouse_id).
    SELECT qty INTO v_before
      FROM public.stock_levels
     WHERE sku = v_agg.sku AND warehouse_id = v_warehouse_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SKU % belum ada di gudang yang dipilih', v_agg.sku;
    END IF;
    IF v_before < v_agg.qty THEN
      RAISE EXCEPTION 'Stok tidak cukup untuk SKU %: tersedia %, diminta %',
        v_agg.sku, v_before, v_agg.qty;
    END IF;

    -- Deduct from stock_levels.
    UPDATE public.stock_levels
       SET qty = qty - v_agg.qty, updated_at = now()
     WHERE sku = v_agg.sku AND warehouse_id = v_warehouse_id;

    -- Stock movement ledger row (BIGINT id pattern, per Task-4 fix 867c7d5).
    v_mv_id := public._log_stock_movement(
      p_sku              => v_agg.sku,
      p_warehouse        => NULL,           -- legacy text column deprecated in Migration 3
      p_qty_delta        => -v_agg.qty,
      p_qty_before       => v_before,
      p_source           => 'sale_kasir'::public.stock_movement_source,
      p_related_doc_type => 'kasir_tx',
      p_related_doc_id   => v_invoice_number,
      p_actor_user_id    => p_actor_user_id
    );
    UPDATE public.stock_movements SET warehouse_id = v_warehouse_id WHERE id = v_mv_id;

    -- FIFO cost walk (per-SKU, not per-warehouse — spec says FIFO stays per-SKU).
    v_agg_cost := public.deduct_stock_fifo(
      p_sku              => v_agg.sku,
      p_qty              => v_agg.qty,
      p_warehouse        => COALESCE(v_agg.warehouse_txt, 'atas'),
      p_related_doc_type => 'kasir_tx',
      p_related_doc_id   => v_invoice_number,
      p_source           => 'sale_kasir'
    );

    v_hpp_total := v_hpp_total + v_agg_cost;

    -- Key by sku + warehouse_id string for the re-emit loop below.
    v_key := v_agg.sku || '||' || v_warehouse_id::text;
    v_cost_map := v_cost_map || jsonb_build_object(
      v_key,
      CASE WHEN v_agg.qty > 0 THEN v_agg_cost / v_agg.qty ELSE 0 END
    );
  END LOOP;

  -- 5. Re-emit items[]. SKU lines fill hpp_per_unit/hpp_subtotal from
  --    v_cost_map. Service lines (sku IS NULL) pass through the
  --    input's hpp_per_unit / hpp_subtotal verbatim and add to v_hpp_total.
  --    Phase 2b: each SKU item also carries warehouse_id in the JSONB output.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sku       := v_item->>'sku';
    IF v_sku IS NULL THEN
      -- Service lines always have qty=1. Default defensively.
      v_qty          := COALESCE((v_item->>'qty')::int, 1);
      v_hpp_per_unit := COALESCE((v_item->>'hpp_per_unit')::numeric, 0);
      v_hpp_subtotal := COALESCE((v_item->>'hpp_subtotal')::numeric, v_hpp_per_unit * v_qty);
      v_hpp_total    := v_hpp_total + v_hpp_subtotal;
      v_item_out := v_item || jsonb_build_object(
        'hpp_per_unit', v_hpp_per_unit,
        'hpp_subtotal', v_hpp_subtotal
      );
    ELSE
      v_qty      := (v_item->>'qty')::int;
      -- Resolve warehouse_id for cost_map lookup.
      v_warehouse_id := NULLIF(v_item->>'warehouse_id', '')::uuid;
      IF v_warehouse_id IS NULL THEN
        v_warehouse_txt := v_item->>'warehouse';
        IF v_warehouse_txt IS NOT NULL THEN
          SELECT id INTO v_warehouse_id FROM public.warehouses
            WHERE tenant_id IS NULL AND code = upper(v_warehouse_txt);
        END IF;
      END IF;
      v_key          := v_sku || '||' || COALESCE(v_warehouse_id::text, '');
      v_hpp_per_unit := COALESCE((v_cost_map ->> v_key)::numeric, 0);
      v_hpp_subtotal := v_hpp_per_unit * v_qty;
      v_item_out := v_item || jsonb_build_object(
        'hpp_per_unit',  v_hpp_per_unit,
        'hpp_subtotal',  v_hpp_subtotal,
        'warehouse_id',  v_warehouse_id::text    -- persist resolved uuid into JSONB
      );
    END IF;
    v_items_out := v_items_out || v_item_out;
  END LOOP;

  v_status := CASE WHEN p_payment_type = 'DP' THEN 'AWAITING_LUNAS' ELSE 'PAID' END;

  -- 6. Insert kasir_transactions row. Verbatim from upstream — no separate
  --    kasir_transaction_items table exists; items live as JSONB.
  INSERT INTO public.kasir_transactions (
    date, type, channel, items, subtotal, hpp_total,
    payment_method, payment_subtype, payment_type, dp_amount, dp_input_type,
    ongkir_amount, notes, total_amount,
    tokped_order_no, wa_phone, wa_chat_url, status,
    customer_id, customer_name, customer_phone, customer_company,
    delivery_address, invoice_number
  ) VALUES (
    p_date,
    'income',
    p_channel::public.kasir_channel,
    v_items_out,
    p_subtotal,
    v_hpp_total,
    p_payment_method::public.kasir_payment_method,
    p_payment_subtype,
    p_payment_type,
    COALESCE(p_dp_amount, 0),
    p_dp_input_type,
    COALESCE(p_ongkir_amount, 0),
    p_notes,
    p_total_amount,
    p_tokped_order_no,
    p_wa_phone,
    p_wa_chat_url,
    v_status,
    v_customer_id,
    p_customer_name,
    p_customer_phone,
    p_customer_company,
    p_delivery_address,
    v_invoice_number
  )
  RETURNING * INTO v_kasir;

  RETURN v_kasir;
END;
$$;

-- Grant to the 21-arg signature (with p_actor_user_id).
GRANT EXECUTE ON FUNCTION public.record_kasir_sale(
  date, text, jsonb, numeric, text, text, text, numeric, text,
  numeric, text, numeric, text, text, text, text, text, text, text, text,
  uuid
) TO anon, authenticated;

-- ─── receive_purchase_order ───────────────────────────────────────────────────
-- Rewrites per-line stock mutation from UPDATE stocks SET stock = stock + qty
-- to INSERT INTO stock_levels ON CONFLICT DO UPDATE SET qty = qty + EXCLUDED.qty.
-- Per-line warehouse_id comes from p_conditions[item_id].warehouse_id.
-- Resolves default warehouse from warehouses WHERE is_default = true
-- so existing callers without per-line warehouse_id in conditions still work.
CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_po_id          uuid,
  p_received_at    timestamptz,
  p_payment_due_at date,
  p_invoice_url    text DEFAULT NULL,
  p_conditions     jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item          record;
  v_cond          jsonb;
  v_qty_received  int;
  v_qty_damaged   int;
  v_damage_notes  text;
  -- NEW Phase 2b variables
  v_default_id    uuid;     -- fallback warehouse for lines without per-line warehouse_id
  v_warehouse_id  uuid;     -- resolved per-line warehouse_id
  v_before        int;      -- qty_before for ledger
  v_mv_id         bigint;   -- returned BIGINT from _log_stock_movement
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.purchase_orders WHERE id = p_po_id AND status = 'ORDERED'
  ) THEN
    RAISE EXCEPTION 'PO % tidak dalam status ORDERED', p_po_id;
  END IF;

  -- Resolve default warehouse (the one marked is_default for this tenant).
  -- tenant_id IS NULL = single-tenant deployment (current state).
  SELECT id INTO v_default_id
    FROM public.warehouses
   WHERE tenant_id IS NULL AND is_default
   LIMIT 1;

  FOR v_item IN
    SELECT id, sku, qty, unit_cost FROM public.purchase_order_items WHERE po_id = p_po_id
  LOOP
    v_cond := p_conditions -> (v_item.id::text);
    IF v_cond IS NOT NULL THEN
      v_qty_received := (v_cond ->> 'qty_received')::int;
      v_qty_damaged  := (v_cond ->> 'qty_damaged')::int;
      v_damage_notes := v_cond ->> 'damage_notes';

      IF v_qty_received < 0 OR v_qty_damaged < 0 THEN
        RAISE EXCEPTION 'qty_received dan qty_damaged harus non-negatif untuk item %', v_item.id;
      END IF;

      IF v_qty_received + v_qty_damaged > v_item.qty THEN
        RAISE EXCEPTION 'qty_received + qty_damaged (%) melebihi qty pesanan (%) untuk item %',
          v_qty_received + v_qty_damaged, v_item.qty, v_item.id;
      END IF;

      UPDATE public.purchase_order_items SET
        qty_received  = v_qty_received,
        qty_damaged   = v_qty_damaged,
        damage_notes  = v_damage_notes,
        damage_status = CASE WHEN v_qty_damaged > 0 THEN 'PENDING_RETURN' ELSE 'NONE' END
      WHERE id = v_item.id;

      IF v_qty_received > 0 AND v_item.sku IS NOT NULL THEN
        -- Resolve per-line warehouse_id from conditions, fall back to default.
        v_warehouse_id := NULLIF(v_cond ->> 'warehouse_id', '')::uuid;
        IF v_warehouse_id IS NULL THEN
          v_warehouse_id := v_default_id;
        END IF;
        IF v_warehouse_id IS NULL THEN
          RAISE EXCEPTION 'receive_purchase_order: warehouse_id tidak dapat ditentukan untuk item %', v_item.id;
        END IF;

        -- Read qty_before for ledger (0 if row doesn't exist yet).
        SELECT COALESCE(qty, 0) INTO v_before
          FROM public.stock_levels
         WHERE sku = v_item.sku AND warehouse_id = v_warehouse_id;

        -- Insert or bump stock_levels.
        INSERT INTO public.stock_levels (sku, warehouse_id, qty)
             VALUES (v_item.sku, v_warehouse_id, v_qty_received)
        ON CONFLICT (sku, warehouse_id)
        DO UPDATE SET qty = stock_levels.qty + EXCLUDED.qty, updated_at = now();

        -- FIFO lot — per-SKU, not per-warehouse (spec: FIFO stays per-SKU).
        -- Use v_item.unit_cost (from purchase_order_items) to match the
        -- canonical body in 20260604000015_fifo_rpcs.sql.
        INSERT INTO public.stock_lots (sku, po_id, unit_cost, qty_received, qty_remaining, received_at)
        VALUES (v_item.sku, p_po_id, v_item.unit_cost, v_qty_received, v_qty_received,
                COALESCE(p_received_at, now()));

        -- Ledger row (BIGINT id pattern, per Task-4 fix 867c7d5).
        v_mv_id := public._log_stock_movement(
          p_sku              => v_item.sku,
          p_warehouse        => NULL,         -- legacy text column deprecated in Migration 3
          p_qty_delta        => v_qty_received,
          p_qty_before       => v_before,
          p_source           => 'purchase_receive'::public.stock_movement_source,
          p_related_doc_type => 'purchase_order',
          p_related_doc_id   => p_po_id::text
        );
        UPDATE public.stock_movements SET warehouse_id = v_warehouse_id WHERE id = v_mv_id;

        -- Stamp per-line warehouse_id on the PO item row.
        UPDATE public.purchase_order_items
           SET warehouse_id = v_warehouse_id
         WHERE id = v_item.id;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.purchase_orders
  SET
    status          = 'RECEIVED',
    received_at     = p_received_at,
    payment_due_at  = p_payment_due_at,
    invoice_url     = COALESCE(p_invoice_url, invoice_url)
  WHERE id = p_po_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_purchase_order(
  uuid, timestamptz, date, text, jsonb
) TO anon, authenticated;

-- ─── receive_purchase_order(6-arg) legacy overload bridge ──────────────────
-- The 6-arg form in 20260607000002_wrap_receive_po.sql still writes to
-- stocks.stock_atas/bawah. Migration 1 disabled the trg_sync_stock_total
-- trigger that synced stocks.stock from those columns. Without bridging, a
-- PO receipt via the legacy 6-arg path during the deploy window leaves
-- stock_levels stale. This wrapper resolves the text warehouse to a uuid,
-- merges it into each line's conditions, then delegates to the new 5-arg
-- form that writes to stock_levels. Task 13 will update pembelianService.ts
-- to call the 5-arg form directly; Task 17 (Migration 3) will drop this
-- wrapper entirely.

-- Drop the existing (uuid, timestamptz, date, text, jsonb, text) overload
-- that still writes to stocks.stock_atas/bawah before replacing it.
DROP FUNCTION IF EXISTS public.receive_purchase_order(uuid, timestamptz, date, text, jsonb, text);

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_po_id          uuid,
  p_received_at    timestamptz,
  p_payment_due_at date,
  p_invoice_url    text,
  p_conditions     jsonb,
  p_warehouse      text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_warehouse_id    uuid;
  v_merged          jsonb := COALESCE(p_conditions, '{}'::jsonb);
  v_item            record;
BEGIN
  SELECT id INTO v_warehouse_id FROM public.warehouses
    WHERE tenant_id IS NULL AND code = upper(p_warehouse);
  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'receive_purchase_order: gudang % tidak ditemukan', p_warehouse;
  END IF;

  -- For each PO item, ensure conditions has a warehouse_id (don't overwrite
  -- per-line overrides if the caller already set one).
  FOR v_item IN SELECT id::text AS item_id FROM public.purchase_order_items WHERE po_id = p_po_id LOOP
    IF (v_merged -> v_item.item_id ->> 'warehouse_id') IS NULL THEN
      v_merged := jsonb_set(
        v_merged,
        ARRAY[v_item.item_id, 'warehouse_id'],
        to_jsonb(v_warehouse_id::text),
        true
      );
    END IF;
  END LOOP;

  -- Delegate to the 5-arg form which writes to stock_levels + stock_movements.
  PERFORM public.receive_purchase_order(
    p_po_id, p_received_at, p_payment_due_at, p_invoice_url, v_merged
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, timestamptz, date, text, jsonb, text)
  TO anon, authenticated;

COMMIT;
