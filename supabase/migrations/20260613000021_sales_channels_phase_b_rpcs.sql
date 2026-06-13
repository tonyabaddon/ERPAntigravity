-- Phase B.2 — Refactor record_kasir_sale RPC variants for configurable sales channels.
--
-- Three variants of record_kasir_sale exist in the migration history:
--   1. 20260609000001 — base variant
--   2. 20260609000003 — adds payment_subtype + dp_input_type validation
--   3. 20260610000001 — adds support for pure-service lines (sku IS NULL)
--
-- Each variant currently inlines:
--   (a) the channel whitelist as `IF p_channel NOT IN ('walkin','tokopedia','grosir','whatsapp')`
--   (b) the invoice prefix CASE with only 4 channels (WLK / TPD / WAM / GRS)
--   (c) a parameter `p_tokped_order_no` writing into `tokped_order_no`
--
-- This migration replaces all three with new versions that:
--   * Call `public.validate_sales_channel(p_channel)` (Phase A helper) for channel
--     validation — single source of truth for the 14 canonical channels.
--   * Expand `v_invoice_prefix` CASE to all 14 canonical channels.
--   * Rename the parameter `p_tokped_order_no` → `p_marketplace_order_no` and write
--     into the renamed column `kasir_transactions.marketplace_order_no` (renamed in
--     20260613000011).
--
-- The function body is otherwise IDENTICAL to the prior revision — same DECLAREs,
-- same business logic, same INSERT shape, same RETURNS public.kasir_transactions.
--
-- Because parameter rename changes the function signature for Postgres' purposes,
-- DROP FUNCTION is required before CREATE FUNCTION (CREATE OR REPLACE alone cannot
-- rename a parameter). The old (date,text,jsonb,numeric,text,text,text,numeric,text,
-- numeric,text,numeric,text,text,text,text,text,text,text,text) signature is dropped
-- once and re-created three times below — each replacement preserves the type list
-- exactly, so only the LAST CREATE FUNCTION wins as the live RPC. This matches the
-- pre-existing behavior where each of the three variants in turn overwrote the
-- prior version via CREATE OR REPLACE.

-- Drop the old signature (single physical function, three historical revisions).
DROP FUNCTION IF EXISTS public.record_kasir_sale(
  date, text, jsonb, numeric, text, text, text, numeric, text,
  numeric, text, numeric, text, text, text, text, text, text, text, text
);


-- =============================================================================
-- Variant 1 (was 20260609000001) — base variant.
-- =============================================================================
CREATE FUNCTION public.record_kasir_sale(
  p_date                  date,
  p_channel               text,
  p_items                 jsonb,
  p_subtotal              numeric,
  p_payment_method        text,
  p_payment_subtype       text,
  p_payment_type          text,
  p_dp_amount             numeric,
  p_dp_input_type         text,
  p_ongkir_amount         numeric,
  p_notes                 text,
  p_total_amount          numeric,
  p_customer_name         text,
  p_customer_phone        text,
  p_customer_company      text,
  p_delivery_address      text,
  p_marketplace_order_no  text,
  p_wa_phone              text,
  p_wa_chat_url           text,
  p_customer_id           text
)
RETURNS public.kasir_transactions
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_customer_id    text := p_customer_id;
  v_counter        int;
  v_invoice_prefix text;
  v_invoice_number text;
  v_status         text;
  v_kasir          public.kasir_transactions%ROWTYPE;
  -- per-(sku, warehouse) aggregate for FIFO
  v_agg            record;
  v_agg_cost       numeric;
  -- map "sku||warehouse" -> hpp_per_unit (avg across the aggregate)
  v_cost_map       jsonb := '{}'::jsonb;
  v_items_out      jsonb := '[]'::jsonb;
  v_item           jsonb;
  v_item_out       jsonb;
  v_sku            text;
  v_qty            int;
  v_warehouse      text;
  v_hpp_per_unit   numeric;
  v_hpp_subtotal   numeric;
  v_hpp_total      numeric := 0;
  v_key            text;
BEGIN
  -- 1. Input validation. Fail fast before any side effects.
  PERFORM public.validate_sales_channel(p_channel);
  IF p_payment_method NOT IN ('cash', 'transfer', 'qris', 'edc') THEN
    RAISE EXCEPTION 'invalid payment_method: % (expected cash|transfer|qris|edc)', p_payment_method;
  END IF;
  IF p_payment_type NOT IN ('FULL', 'DP') THEN
    RAISE EXCEPTION 'invalid payment_type: % (expected FULL|DP)', p_payment_type;
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items must contain at least one line';
  END IF;

  -- 2. Find-or-create customer if not already linked. ON CONFLICT handles
  --    the race where two concurrent sales hit the same new wa_number.
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

  -- 3. Atomically reserve the invoice number BEFORE stock mutations so the
  --    invoice number can flow into stock_movements.related_doc_id as a
  --    trace handle. If anything downstream raises, the counter increment
  --    rolls back along with everything else.
  v_counter := public.next_kasir_number(p_channel, p_date);
  v_invoice_prefix := CASE p_channel
    WHEN 'walkin'    THEN 'WLK'
    WHEN 'grosir'    THEN 'GSR'
    WHEN 'sales'     THEN 'SLS'
    WHEN 'expo'      THEN 'EXP'
    WHEN 'tokopedia' THEN 'TPD'
    WHEN 'shopee'    THEN 'SHP'
    WHEN 'lazada'    THEN 'LZD'
    WHEN 'blibli'    THEN 'BLB'
    WHEN 'bukalapak' THEN 'BKL'
    WHEN 'ralali'    THEN 'RLI'
    WHEN 'bhinneka'  THEN 'BHN'
    WHEN 'whatsapp'  THEN 'WAM'
    WHEN 'instagram' THEN 'IGM'
    WHEN 'website'   THEN 'WEB'
  END;
  v_invoice_number := v_invoice_prefix
    || '-' || to_char(p_date, 'YYYYMMDD')
    || '-' || lpad(v_counter::text, 3, '0');

  -- 4. Aggregate (sku, warehouse), then for each unique pair:
  --    (a) warehouse column decrement + ledger row
  --    (b) FIFO lot walk + ledger row + cost return
  --    Each aggregate group walks lots once instead of once-per-line.
  FOR v_agg IN
    SELECT
      item->>'sku' AS sku,
      COALESCE(item->>'warehouse', 'atas') AS warehouse,
      SUM((item->>'qty')::int)::int AS qty
    FROM jsonb_array_elements(p_items) AS item
    GROUP BY 1, 2
  LOOP
    IF v_agg.sku IS NULL OR v_agg.qty IS NULL OR v_agg.qty <= 0 THEN
      RAISE EXCEPTION 'malformed item in p_items: sku=%, qty=%', v_agg.sku, v_agg.qty;
    END IF;

    PERFORM public.decrement_stock(
      p_sku              => v_agg.sku,
      p_qty              => v_agg.qty,
      p_warehouse        => v_agg.warehouse,
      p_related_doc_type => 'kasir_tx',
      p_related_doc_id   => v_invoice_number,
      p_source           => 'sale_kasir'
    );

    v_agg_cost := public.deduct_stock_fifo(
      p_sku              => v_agg.sku,
      p_qty              => v_agg.qty,
      p_warehouse        => v_agg.warehouse,
      p_related_doc_type => 'kasir_tx',
      p_related_doc_id   => v_invoice_number,
      p_source           => 'sale_kasir'
    );

    v_hpp_total := v_hpp_total + v_agg_cost;

    v_key := v_agg.sku || '||' || v_agg.warehouse;
    v_cost_map := v_cost_map || jsonb_build_object(
      v_key,
      CASE WHEN v_agg.qty > 0 THEN v_agg_cost / v_agg.qty ELSE 0 END
    );
  END LOOP;

  -- 5. Re-emit items[] with proportional hpp filled in per line.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sku       := v_item->>'sku';
    v_qty       := (v_item->>'qty')::int;
    v_warehouse := COALESCE(v_item->>'warehouse', 'atas');
    v_key       := v_sku || '||' || v_warehouse;
    v_hpp_per_unit := COALESCE((v_cost_map ->> v_key)::numeric, 0);
    v_hpp_subtotal := v_hpp_per_unit * v_qty;
    v_item_out := v_item || jsonb_build_object(
      'hpp_per_unit', v_hpp_per_unit,
      'hpp_subtotal', v_hpp_subtotal
    );
    v_items_out := v_items_out || v_item_out;
  END LOOP;

  v_status := CASE WHEN p_payment_type = 'DP' THEN 'AWAITING_LUNAS' ELSE 'PAID' END;

  -- 6. Insert kasir_transactions row. NULL coerced where the column allows it.
  INSERT INTO public.kasir_transactions (
    date, type, channel, items, subtotal, hpp_total,
    payment_method, payment_subtype, payment_type, dp_amount, dp_input_type,
    ongkir_amount, notes, total_amount,
    marketplace_order_no, wa_phone, wa_chat_url, status,
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
    p_marketplace_order_no,
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

GRANT EXECUTE ON FUNCTION public.record_kasir_sale(
  date, text, jsonb, numeric, text, text, text, numeric, text,
  numeric, text, numeric, text, text, text, text, text, text, text, text
) TO anon, authenticated;


-- =============================================================================
-- Variant 2 (was 20260609000003) — adds payment_subtype + dp_input_type validation.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.record_kasir_sale(
  p_date                  date,
  p_channel               text,
  p_items                 jsonb,
  p_subtotal              numeric,
  p_payment_method        text,
  p_payment_subtype       text,
  p_payment_type          text,
  p_dp_amount             numeric,
  p_dp_input_type         text,
  p_ongkir_amount         numeric,
  p_notes                 text,
  p_total_amount          numeric,
  p_customer_name         text,
  p_customer_phone        text,
  p_customer_company      text,
  p_delivery_address      text,
  p_marketplace_order_no  text,
  p_wa_phone              text,
  p_wa_chat_url           text,
  p_customer_id           text
)
RETURNS public.kasir_transactions
LANGUAGE plpgsql SECURITY DEFINER
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
  v_warehouse      text;
  v_hpp_per_unit   numeric;
  v_hpp_subtotal   numeric;
  v_hpp_total      numeric := 0;
  v_key            text;
BEGIN
  -- Input validation. Fail fast before any side effects.
  PERFORM public.validate_sales_channel(p_channel);
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
    RAISE EXCEPTION 'p_items must contain at least one line';
  END IF;

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

  v_counter := public.next_kasir_number(p_channel, p_date);
  v_invoice_prefix := CASE p_channel
    WHEN 'walkin'    THEN 'WLK'
    WHEN 'grosir'    THEN 'GSR'
    WHEN 'sales'     THEN 'SLS'
    WHEN 'expo'      THEN 'EXP'
    WHEN 'tokopedia' THEN 'TPD'
    WHEN 'shopee'    THEN 'SHP'
    WHEN 'lazada'    THEN 'LZD'
    WHEN 'blibli'    THEN 'BLB'
    WHEN 'bukalapak' THEN 'BKL'
    WHEN 'ralali'    THEN 'RLI'
    WHEN 'bhinneka'  THEN 'BHN'
    WHEN 'whatsapp'  THEN 'WAM'
    WHEN 'instagram' THEN 'IGM'
    WHEN 'website'   THEN 'WEB'
  END;
  v_invoice_number := v_invoice_prefix
    || '-' || to_char(p_date, 'YYYYMMDD')
    || '-' || lpad(v_counter::text, 3, '0');

  FOR v_agg IN
    SELECT
      item->>'sku' AS sku,
      COALESCE(item->>'warehouse', 'atas') AS warehouse,
      SUM((item->>'qty')::int)::int AS qty
    FROM jsonb_array_elements(p_items) AS item
    GROUP BY 1, 2
  LOOP
    IF v_agg.sku IS NULL OR v_agg.qty IS NULL OR v_agg.qty <= 0 THEN
      RAISE EXCEPTION 'malformed item in p_items: sku=%, qty=%', v_agg.sku, v_agg.qty;
    END IF;

    PERFORM public.decrement_stock(
      p_sku              => v_agg.sku,
      p_qty              => v_agg.qty,
      p_warehouse        => v_agg.warehouse,
      p_related_doc_type => 'kasir_tx',
      p_related_doc_id   => v_invoice_number,
      p_source           => 'sale_kasir'
    );

    v_agg_cost := public.deduct_stock_fifo(
      p_sku              => v_agg.sku,
      p_qty              => v_agg.qty,
      p_warehouse        => v_agg.warehouse,
      p_related_doc_type => 'kasir_tx',
      p_related_doc_id   => v_invoice_number,
      p_source           => 'sale_kasir'
    );

    v_hpp_total := v_hpp_total + v_agg_cost;

    v_key := v_agg.sku || '||' || v_agg.warehouse;
    v_cost_map := v_cost_map || jsonb_build_object(
      v_key,
      CASE WHEN v_agg.qty > 0 THEN v_agg_cost / v_agg.qty ELSE 0 END
    );
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sku       := v_item->>'sku';
    v_qty       := (v_item->>'qty')::int;
    v_warehouse := COALESCE(v_item->>'warehouse', 'atas');
    v_key       := v_sku || '||' || v_warehouse;
    v_hpp_per_unit := COALESCE((v_cost_map ->> v_key)::numeric, 0);
    v_hpp_subtotal := v_hpp_per_unit * v_qty;
    v_item_out := v_item || jsonb_build_object(
      'hpp_per_unit', v_hpp_per_unit,
      'hpp_subtotal', v_hpp_subtotal
    );
    v_items_out := v_items_out || v_item_out;
  END LOOP;

  v_status := CASE WHEN p_payment_type = 'DP' THEN 'AWAITING_LUNAS' ELSE 'PAID' END;

  INSERT INTO public.kasir_transactions (
    date, type, channel, items, subtotal, hpp_total,
    payment_method, payment_subtype, payment_type, dp_amount, dp_input_type,
    ongkir_amount, notes, total_amount,
    marketplace_order_no, wa_phone, wa_chat_url, status,
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
    p_marketplace_order_no,
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

GRANT EXECUTE ON FUNCTION public.record_kasir_sale(
  date, text, jsonb, numeric, text, text, text, numeric, text,
  numeric, text, numeric, text, text, text, text, text, text, text, text
) TO anon, authenticated;


-- =============================================================================
-- Variant 3 (was 20260610000001) — adds support for pure-service lines (sku IS NULL).
-- THIS IS THE LIVE / PRODUCTION VARIANT after this migration.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.record_kasir_sale(
  p_date                  date,
  p_channel               text,
  p_items                 jsonb,
  p_subtotal              numeric,
  p_payment_method        text,
  p_payment_subtype       text,
  p_payment_type          text,
  p_dp_amount             numeric,
  p_dp_input_type         text,
  p_ongkir_amount         numeric,
  p_notes                 text,
  p_total_amount          numeric,
  p_customer_name         text,
  p_customer_phone        text,
  p_customer_company      text,
  p_delivery_address      text,
  p_marketplace_order_no  text,
  p_wa_phone              text,
  p_wa_chat_url           text,
  p_customer_id           text
)
RETURNS public.kasir_transactions
LANGUAGE plpgsql SECURITY DEFINER
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
  v_warehouse      text;
  v_hpp_per_unit   numeric;
  v_hpp_subtotal   numeric;
  v_hpp_total      numeric := 0;
  v_key            text;
BEGIN
  -- 1. Input validation. Fail fast before any side effects.
  PERFORM public.validate_sales_channel(p_channel);
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
    RAISE EXCEPTION 'p_items must contain at least one line';
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
    WHEN 'grosir'    THEN 'GSR'
    WHEN 'sales'     THEN 'SLS'
    WHEN 'expo'      THEN 'EXP'
    WHEN 'tokopedia' THEN 'TPD'
    WHEN 'shopee'    THEN 'SHP'
    WHEN 'lazada'    THEN 'LZD'
    WHEN 'blibli'    THEN 'BLB'
    WHEN 'bukalapak' THEN 'BKL'
    WHEN 'ralali'    THEN 'RLI'
    WHEN 'bhinneka'  THEN 'BHN'
    WHEN 'whatsapp'  THEN 'WAM'
    WHEN 'instagram' THEN 'IGM'
    WHEN 'website'   THEN 'WEB'
  END;
  v_invoice_number := v_invoice_prefix
    || '-' || to_char(p_date, 'YYYYMMDD')
    || '-' || lpad(v_counter::text, 3, '0');

  -- 4. Aggregate (sku, warehouse) for SKU lines only. Service lines
  --    (sku IS NULL) are skipped here: no stock decrement, no FIFO walk.
  FOR v_agg IN
    SELECT
      item->>'sku' AS sku,
      COALESCE(item->>'warehouse', 'atas') AS warehouse,
      SUM((item->>'qty')::int)::int AS qty
    FROM jsonb_array_elements(p_items) AS item
    WHERE item->>'sku' IS NOT NULL
    GROUP BY 1, 2
  LOOP
    IF v_agg.sku IS NULL OR v_agg.qty IS NULL OR v_agg.qty <= 0 THEN
      RAISE EXCEPTION 'malformed item in p_items: sku=%, qty=%', v_agg.sku, v_agg.qty;
    END IF;

    PERFORM public.decrement_stock(
      p_sku              => v_agg.sku,
      p_qty              => v_agg.qty,
      p_warehouse        => v_agg.warehouse,
      p_related_doc_type => 'kasir_tx',
      p_related_doc_id   => v_invoice_number,
      p_source           => 'sale_kasir'
    );

    v_agg_cost := public.deduct_stock_fifo(
      p_sku              => v_agg.sku,
      p_qty              => v_agg.qty,
      p_warehouse        => v_agg.warehouse,
      p_related_doc_type => 'kasir_tx',
      p_related_doc_id   => v_invoice_number,
      p_source           => 'sale_kasir'
    );

    v_hpp_total := v_hpp_total + v_agg_cost;

    v_key := v_agg.sku || '||' || v_agg.warehouse;
    v_cost_map := v_cost_map || jsonb_build_object(
      v_key,
      CASE WHEN v_agg.qty > 0 THEN v_agg_cost / v_agg.qty ELSE 0 END
    );
  END LOOP;

  -- 5. Re-emit items[]. SKU lines fill hpp_per_unit/hpp_subtotal from
  --    v_cost_map. Service lines (sku IS NULL) pass through the
  --    input's hpp_per_unit / hpp_subtotal verbatim and add to v_hpp_total.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sku       := v_item->>'sku';
    IF v_sku IS NULL THEN
      -- Service lines always have qty=1 (one bill line per service). Default
      -- defensively so a malformed payload with a missing qty doesn't
      -- silently poison v_hpp_total via NULL arithmetic.
      v_qty          := COALESCE((v_item->>'qty')::int, 1);
      v_hpp_per_unit := COALESCE((v_item->>'hpp_per_unit')::numeric, 0);
      v_hpp_subtotal := COALESCE((v_item->>'hpp_subtotal')::numeric, v_hpp_per_unit * v_qty);
      v_hpp_total    := v_hpp_total + v_hpp_subtotal;
      v_item_out := v_item || jsonb_build_object(
        'hpp_per_unit', v_hpp_per_unit,
        'hpp_subtotal', v_hpp_subtotal
      );
    ELSE
      v_qty          := (v_item->>'qty')::int;
      v_warehouse    := COALESCE(v_item->>'warehouse', 'atas');
      v_key          := v_sku || '||' || v_warehouse;
      v_hpp_per_unit := COALESCE((v_cost_map ->> v_key)::numeric, 0);
      v_hpp_subtotal := v_hpp_per_unit * v_qty;
      v_item_out := v_item || jsonb_build_object(
        'hpp_per_unit', v_hpp_per_unit,
        'hpp_subtotal', v_hpp_subtotal
      );
    END IF;
    v_items_out := v_items_out || v_item_out;
  END LOOP;

  v_status := CASE WHEN p_payment_type = 'DP' THEN 'AWAITING_LUNAS' ELSE 'PAID' END;

  -- 6. Insert kasir_transactions row.
  INSERT INTO public.kasir_transactions (
    date, type, channel, items, subtotal, hpp_total,
    payment_method, payment_subtype, payment_type, dp_amount, dp_input_type,
    ongkir_amount, notes, total_amount,
    marketplace_order_no, wa_phone, wa_chat_url, status,
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
    p_marketplace_order_no,
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

GRANT EXECUTE ON FUNCTION public.record_kasir_sale(
  date, text, jsonb, numeric, text, text, text, numeric, text,
  numeric, text, numeric, text, text, text, text, text, text, text, text
) TO anon, authenticated;
