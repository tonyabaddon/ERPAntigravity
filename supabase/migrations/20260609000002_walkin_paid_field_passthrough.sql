-- Phase C+D from the post-overhaul code review:
--
-- C) Walk-in draft orders silently dropped ongkir / notes / delivery_address
--    on creation, and at paid-time mark_walkin_order_paid wrote
--    subtotal = order.total (i.e. inflated subtotal by the shipping fee)
--    instead of splitting subtotal/ongkir/total properly into the kasir row.
--
-- D) mark_walkin_order_paid's payment_method whitelist rejected EDC, even
--    though KasirPaymentMethod and kasir_payment_method enum already include
--    'edc'. A future UI that wires walkin-draft → paid via EDC would hit a
--    needless RAISE EXCEPTION.
--
-- This migration:
--   1. Adds `notes TEXT` to public.orders so walkin drafts can persist a
--      cashier note across the draft → paid transition.
--   2. Replaces public.mark_walkin_order_paid to (a) whitelist EDC,
--      (b) pull shipping_fee/notes/customer_address/customer_company from
--      v_order into the kasir row, and (c) split subtotal/ongkir/total
--      correctly so the cashbook math matches the order's invoice.

-- 1. Add `notes` to orders. NULLABLE because most existing orders have none.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- 2. Replace mark_walkin_order_paid. Same call signature so existing TS
--    callers continue to work without recompile; behavior expanded per above.
CREATE OR REPLACE FUNCTION public.mark_walkin_order_paid(
  p_order_id        uuid,
  p_payment_method  text,
  p_invoice_number  text,
  p_paid_date       date DEFAULT CURRENT_DATE
)
RETURNS public.kasir_transactions
LANGUAGE plpgsql
AS $$
DECLARE
  v_order        public.orders%ROWTYPE;
  v_kasir        public.kasir_transactions%ROWTYPE;
  v_item         jsonb;
  v_sku          text;
  v_qty          int;
  v_warehouse    text;
  v_lot_cost     numeric;
  v_hpp_total    numeric := 0;
  v_items_out    jsonb   := '[]'::jsonb;
  v_item_out     jsonb;
BEGIN
  -- (D) EDC added to the whitelist. The enum already permits it.
  IF p_payment_method NOT IN ('cash','transfer','qris','edc') THEN
    RAISE EXCEPTION 'invalid payment_method: % (expected cash|transfer|qris|edc)', p_payment_method;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order % not found', p_order_id;
  END IF;
  IF v_order.sales_channel <> 'walkin' THEN
    RAISE EXCEPTION 'order % is not a walk-in order (channel=%)',
      p_order_id, v_order.sales_channel;
  END IF;
  IF v_order.status NOT IN (
    'WAITING_PAYMENT', 'PAYMENT_UPLOADED',
    'WAITING_DP',      'DP_UPLOADED', 'DP_VERIFIED'
  ) THEN
    RAISE EXCEPTION 'order % cannot be marked paid from status %',
      p_order_id, v_order.status;
  END IF;

  v_warehouse := COALESCE(v_order.warehouse, 'atas');
  IF v_order.warehouse IS NULL THEN
    RAISE WARNING 'order % has NULL warehouse, defaulting to atas', p_order_id;
  END IF;

  -- Walk every item line: drain warehouse column + FIFO lots, accumulate cost.
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_order.items, '[]'::jsonb))
  LOOP
    v_sku := v_item ->> 'sku';
    v_qty := (v_item ->> 'qty')::int;
    IF v_sku IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'order % has malformed item %', p_order_id, v_item;
    END IF;

    PERFORM public.decrement_stock(
      p_sku              => v_sku,
      p_qty              => v_qty,
      p_warehouse        => v_warehouse,
      p_related_doc_type => 'order',
      p_related_doc_id   => v_order.id::text,
      p_source           => 'sale_kasir'
    );

    v_lot_cost := public.deduct_stock_fifo(v_sku, v_qty);
    v_hpp_total := v_hpp_total + v_lot_cost;

    -- Re-emit the item with the true FIFO cost so the kasir row's items[]
    -- carries the same COGS the cashbook sums to.
    v_item_out := v_item
      || jsonb_build_object(
           'hpp_subtotal', v_lot_cost,
           'hpp_per_unit', CASE WHEN v_qty > 0 THEN v_lot_cost / v_qty ELSE 0 END
         );
    v_items_out := v_items_out || v_item_out;
  END LOOP;

  UPDATE public.orders
  SET status              = 'PAYMENT_VERIFIED',
      payment_verified_at = now(),
      updated_at          = now(),
      hpp_total           = v_hpp_total,
      items               = v_items_out
  WHERE id = p_order_id;

  -- (C) Split subtotal / ongkir_amount / total_amount correctly and
  -- propagate notes + customer_address (-> delivery_address) into the
  -- kasir row, so a draft created with shipping or a customer note doesn't
  -- silently lose those fields when settled.
  INSERT INTO public.kasir_transactions (
    date, type, channel, items, subtotal, hpp_total,
    payment_method, payment_type, dp_amount,
    ongkir_amount, notes, total_amount,
    status,
    customer_id, customer_name, customer_phone, customer_company,
    delivery_address, invoice_number
  ) VALUES (
    p_paid_date,
    'income',
    'walkin',
    v_items_out,
    COALESCE(v_order.subtotal, 0),
    v_hpp_total,
    p_payment_method::kasir_payment_method,
    'FULL',
    0,
    COALESCE(v_order.shipping_fee, 0),
    v_order.notes,
    COALESCE(v_order.total, 0),
    'PAID',
    v_order.customer_id,
    v_order.customer_name,
    v_order.customer_phone,
    v_order.customer_company,
    NULLIF(btrim(v_order.customer_address), ''),
    p_invoice_number
  )
  RETURNING * INTO v_kasir;

  RETURN v_kasir;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_walkin_order_paid(uuid, text, text, date) TO anon, authenticated;
