-- supabase/migrations/20260615000011_create_tempo_invoice_rpc.sql
-- Piutang Phase 1B — atomic create_tempo_invoice RPC.
-- Per spec §5.5.
--
-- CRITICAL race-safety design:
-- - Row lock on customers (FOR UPDATE) — serializes per-customer credit checks
-- - SUM existing INVOICE_TEMPO outstanding INSIDE the locked transaction
-- - Hard-block if outstanding + new total > credit_limit (RAISE EXCEPTION
--   with error code 'credit_limit_exceeded' so frontend can render over-limit modal)
-- - Insert order + decrement stock per line via existing deduct_stock_fifo
-- - All wrapped in single transaction; either everything commits or nothing

BEGIN;

CREATE OR REPLACE FUNCTION public.create_tempo_invoice(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer        public.customers%ROWTYPE;
  v_outstanding     numeric;
  v_total           numeric;
  v_subtotal        numeric;
  v_shipping_fee    numeric;
  v_item            jsonb;
  v_order_id        uuid;
  v_due_date        date;
  v_items_jsonb     jsonb := '[]'::jsonb;
  v_sku             text;
  v_qty             int;
  v_hpp_total       numeric := 0;
  v_hpp_per_line    numeric;
BEGIN
  -- 1. Validate payload shape
  IF p_payload->>'customer_id' IS NULL THEN
    RAISE EXCEPTION 'customer_id required' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(COALESCE(p_payload->'items', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'items must contain at least one line' USING ERRCODE = 'P0001';
  END IF;
  v_total := COALESCE((p_payload->>'total')::numeric, 0);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'total must be positive' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Lock customer row + read credit fields
  SELECT * INTO v_customer
  FROM public.customers
  WHERE id = (p_payload->>'customer_id')::uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_customer.allows_tempo THEN
    RAISE EXCEPTION 'tempo_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF v_customer.term_days IS NULL OR v_customer.term_days <= 0 THEN
    RAISE EXCEPTION 'invalid_term_days' USING ERRCODE = 'P0001';
  END IF;
  IF v_customer.credit_limit IS NULL OR v_customer.credit_limit <= 0 THEN
    RAISE EXCEPTION 'invalid_credit_limit' USING ERRCODE = 'P0001';
  END IF;

  -- 3. Sum existing outstanding INSIDE the locked transaction
  SELECT COALESCE(SUM(total), 0)
  INTO v_outstanding
  FROM public.orders
  WHERE customer_id = v_customer.id::text
    AND payment_type = 'TEMPO'
    AND status = 'INVOICE_TEMPO';

  -- 4. Hard-block over-limit
  IF (v_outstanding + v_total) > v_customer.credit_limit THEN
    RAISE EXCEPTION 'credit_limit_exceeded: outstanding=%, new=%, limit=%',
      v_outstanding, v_total, v_customer.credit_limit
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. Compute due_date + subtotal + shipping
  v_due_date := CURRENT_DATE + v_customer.term_days;
  v_subtotal := COALESCE((p_payload->>'subtotal')::numeric, v_total);
  v_shipping_fee := COALESCE((p_payload->>'shipping_fee')::numeric, 0);
  v_items_jsonb := COALESCE(p_payload->'items', '[]'::jsonb);

  -- 6. Decrement stock per line via existing FIFO RPC (gathers HPP total)
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items_jsonb) LOOP
    v_sku := v_item->>'sku';
    v_qty := COALESCE((v_item->>'qty')::int, 0);
    IF v_sku IS NULL OR v_qty <= 0 THEN
      CONTINUE; -- service-only or malformed line; skip stock deduction
    END IF;
    v_hpp_per_line := public.deduct_stock_fifo(
      v_sku, v_qty, 'atas', 'order_tempo', NULL, 'sale_kasir'::public.stock_movement_source
    );
    v_hpp_total := v_hpp_total + v_hpp_per_line;
  END LOOP;

  -- 7. Insert order with TEMPO + INVOICE_TEMPO status + due_date
  -- Note: orders has no payment_method column; channel + sales_channel both stored.
  -- conversation_id nullable (made so in 20260608000005_walkin_orders_polish.sql).
  INSERT INTO public.orders (
    customer_id, customer_name, customer_phone, customer_company, customer_address,
    items, subtotal, shipping_fee, total, hpp_total,
    payment_type, channel, sales_channel, status,
    due_date, delivery_type,
    booking_expires_at,
    created_at, updated_at
  ) VALUES (
    v_customer.id::text,
    COALESCE(p_payload->>'customer_name', v_customer.name, ''),
    COALESCE(p_payload->>'customer_phone', v_customer.wa_number, ''),
    COALESCE(p_payload->>'customer_company', v_customer.company, ''),
    COALESCE(p_payload->>'delivery_address', ''),
    v_items_jsonb,
    v_subtotal,
    v_shipping_fee,
    v_total,
    v_hpp_total,
    'TEMPO',
    COALESCE(p_payload->>'channel', 'walkin')::public.kasir_channel,
    COALESCE(p_payload->>'sales_channel', p_payload->>'channel', 'walkin')::public.sales_channel,
    'INVOICE_TEMPO',
    v_due_date,
    COALESCE(p_payload->>'delivery_type', 'PICKUP'),
    (now() + interval '90 days'),
    now(),
    now()
  )
  RETURNING id INTO v_order_id;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_tempo_invoice(jsonb) TO authenticated;

COMMIT;
