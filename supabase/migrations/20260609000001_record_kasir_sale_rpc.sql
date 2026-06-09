-- record_kasir_sale: atomically record a kasir sale in ONE transaction.
--
-- Bundles the previously-separate client-side calls
--   (1) purchaseOrderService.deductFifo() per item
--   (2) kasirService.nextInvoiceNumber()
--   (3) kasirService.insertSaleTransaction()
--   (4) stockService.decrementStock() per item
-- into one server-side function. Atomicity guarantees:
--
--   * A failure at any step rolls back EVERY step. No more stranded
--     stock_lots.qty_remaining or burned kasir_counters entries on
--     partial failure.
--   * Items with the same (sku, warehouse) are aggregated BEFORE
--     deduct_stock_fifo so we walk each lot at most once per sale.
--     This removes the Promise.all race where two cart lines for the
--     same SKU could double-deduct or pick wrong lots.
--   * Per-line hpp_per_unit is computed by distributing the aggregate
--     FIFO cost proportionally to qty. Sum of hpp_subtotal across
--     lines equals the aggregate FIFO cost exactly.
--
-- Pattern mirrors mark_walkin_order_paid which already uses this
-- shape for the walk-in draft -> paid transition. Eventually
-- nextInvoiceNumber + insertSaleTransaction should be retired in
-- favor of this RPC for ALL kasir sales (both SaleModal and
-- PenjualanBaruScreen save paths).

CREATE OR REPLACE FUNCTION public.record_kasir_sale(
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
  p_customer_id       text
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
  IF p_channel NOT IN ('walkin', 'tokopedia', 'grosir', 'whatsapp') THEN
    RAISE EXCEPTION 'invalid channel: % (expected walkin|tokopedia|grosir|whatsapp)', p_channel;
  END IF;
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
    WHEN 'tokopedia' THEN 'TPD'
    WHEN 'whatsapp'  THEN 'WAM'
    ELSE 'GRS'
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

GRANT EXECUTE ON FUNCTION public.record_kasir_sale(
  date, text, jsonb, numeric, text, text, text, numeric, text,
  numeric, text, numeric, text, text, text, text, text, text, text, text
) TO anon, authenticated;
