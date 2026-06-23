-- 20260801000005 — create_tempo_invoice: payload extended with discount triples.
--
-- Adds per-line + order-level discount fields, server-side recompute of subtotal
-- and total, and writes 3 new diskon cols to orders table (added in Task 1 /
-- migration 20260801000001_diskon_schema.sql).
--
-- Payload shape extension (all optional for backward-compat):
--   {
--     "items": [{
--       ...,
--       "master_price_at_sale": N,   -- defaults to unit_price if absent
--       "discount_type": "PERCENT"|"AMOUNT"|null,
--       "discount_value": N|null,
--       "discount_amount_rp": N      -- defaults to 0 if absent
--     }],
--     "discount_type": "PERCENT"|"AMOUNT"|null,
--     "discount_value": N|null,
--     "discount_amount_rp": N        -- defaults to 0 if absent
--   }
--
-- Validations (identical to record_kasir_sale Task 10):
--   - Triple-consistency: discount_type and discount_value both NULL or both set.
--   - Per-line: unit_price must not exceed master_price_at_sale (MARKUP_NOT_ALLOWED).
--   - Per-line: discount_amount_rp <= unit_price * qty (EXCESSIVE_LINE_DISCOUNT).
--   - Order: discount_amount_rp <= recomputed_subtotal (DISCOUNT_EXCEEDS_SUBTOTAL).
--
-- Server recomputes subtotal and total; ignores payload subtotal/total.
-- Credit limit check uses recomputed total (not payload total).
--
-- TODO(Phase 0c sales dual-write): when create_tempo_invoice gains GL dual-write,
--   append a debit line to 4-1900 (Diskon Penjualan) for
--   (v_line_discount_total + v_order_discount_amt) so the journal entry
--   balances: D AR + D 4-1900 = C Pendapatan (gross). Tracked as Phase 0c
--   sales dual-write follow-up — dual-write is NOT present in this RPC yet.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CAPTURED ORIGINAL BODY (rollback reference — migration 20260630000003):
--
-- CREATE OR REPLACE FUNCTION public.create_tempo_invoice(p_payload jsonb)
--  RETURNS uuid
--  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
-- AS $function$
-- DECLARE
--   v_customer        public.customers%ROWTYPE;
--   v_outstanding     numeric;
--   v_total           numeric;
--   v_subtotal        numeric;
--   v_shipping_fee    numeric;
--   v_item            jsonb;
--   v_order_id        uuid;
--   v_due_date        date;
--   v_items_jsonb     jsonb := '[]'::jsonb;
--   v_sku             text;
--   v_qty             int;
--   v_hpp_total       numeric := 0;
--   v_hpp_per_line    numeric;
--   v_allow_negative  BOOLEAN := COALESCE((p_payload->>'allow_negative_stock')::boolean, false);
-- BEGIN
--   -- 1. Validate payload shape
--   IF p_payload->>'customer_id' IS NULL THEN
--     RAISE EXCEPTION 'customer_id required' USING ERRCODE = 'P0001';
--   END IF;
--   IF jsonb_array_length(COALESCE(p_payload->'items', '[]'::jsonb)) = 0 THEN
--     RAISE EXCEPTION 'items must contain at least one line' USING ERRCODE = 'P0001';
--   END IF;
--   v_total := COALESCE((p_payload->>'total')::numeric, 0);
--   IF v_total <= 0 THEN
--     RAISE EXCEPTION 'total must be positive' USING ERRCODE = 'P0001';
--   END IF;
--   SELECT * INTO v_customer FROM public.customers WHERE id = p_payload->>'customer_id' FOR UPDATE;
--   IF NOT FOUND THEN RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0001'; END IF;
--   IF NOT v_customer.allows_tempo THEN RAISE EXCEPTION 'tempo_not_enabled' USING ERRCODE = 'P0001'; END IF;
--   IF v_customer.term_days IS NULL OR v_customer.term_days <= 0 THEN RAISE EXCEPTION 'invalid_term_days' USING ERRCODE = 'P0001'; END IF;
--   IF v_customer.credit_limit IS NULL OR v_customer.credit_limit <= 0 THEN RAISE EXCEPTION 'invalid_credit_limit' USING ERRCODE = 'P0001'; END IF;
--   SELECT COALESCE(SUM(total), 0) INTO v_outstanding FROM public.orders
--     WHERE customer_id = v_customer.id::text AND payment_type = 'TEMPO' AND status = 'INVOICE_TEMPO';
--   IF (v_outstanding + v_total) > v_customer.credit_limit THEN
--     RAISE EXCEPTION 'credit_limit_exceeded: outstanding=%, new=%, limit=%', v_outstanding, v_total, v_customer.credit_limit USING ERRCODE = 'P0001';
--   END IF;
--   v_due_date := CURRENT_DATE + v_customer.term_days;
--   v_subtotal := COALESCE((p_payload->>'subtotal')::numeric, v_total);
--   v_shipping_fee := COALESCE((p_payload->>'shipping_fee')::numeric, 0);
--   v_items_jsonb := COALESCE(p_payload->'items', '[]'::jsonb);
--   FOR v_item IN SELECT * FROM jsonb_array_elements(v_items_jsonb) LOOP
--     v_sku := v_item->>'sku'; v_qty := COALESCE((v_item->>'qty')::int, 0);
--     IF v_sku IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;
--     v_hpp_per_line := public.deduct_stock_fifo(v_sku, v_qty, 'atas', 'order_tempo', NULL, 'sale_kasir'::public.stock_movement_source);
--     v_hpp_total := v_hpp_total + v_hpp_per_line;
--   END LOOP;
--   INSERT INTO public.orders (customer_id, customer_name, ..., items, subtotal, shipping_fee, total, hpp_total, ...)
--   VALUES (..., v_items_jsonb, v_subtotal, v_shipping_fee, v_total, v_hpp_total, ...)
--   RETURNING id INTO v_order_id;
--   RETURN v_order_id;
-- END;
-- $function$
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION public.create_tempo_invoice(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- ── Existing locals (unchanged) ─────────────────────────────────────────────
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
  v_allow_negative  BOOLEAN := COALESCE((p_payload->>'allow_negative_stock')::boolean, false);
  -- ── Discount / recompute locals (NEW) ───────────────────────────────────────
  v_master_price        numeric;
  v_unit_price          numeric;
  v_line_discount_amt   numeric;
  v_line_discount_total numeric := 0;
  v_recomputed_subtotal numeric := 0;
  v_order_discount_type TEXT    := p_payload->>'discount_type';
  v_order_discount_val  NUMERIC := (p_payload->>'discount_value')::numeric;
  v_order_discount_amt  NUMERIC := COALESCE((p_payload->>'discount_amount_rp')::numeric, 0);
BEGIN
  -- 1. Validate payload shape (existing)
  IF p_payload->>'customer_id' IS NULL THEN
    RAISE EXCEPTION 'customer_id required' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(COALESCE(p_payload->'items', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'items must contain at least one line' USING ERRCODE = 'P0001';
  END IF;

  -- ── Discount triple-consistency (NEW) ──────────────────────────────────────
  IF (v_order_discount_type IS NULL) <> (v_order_discount_val IS NULL) THEN
    RAISE EXCEPTION 'DISCOUNT_TRIPLE_INVALID: type and value must both be NULL or both set';
  END IF;
  IF v_order_discount_amt < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_DISCOUNT';
  END IF;

  -- ── Per-line validation + recompute subtotal (NEW) ─────────────────────────
  v_items_jsonb := COALESCE(p_payload->'items', '[]'::jsonb);
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items_jsonb) LOOP
    v_unit_price      := COALESCE((v_item->>'unit_price')::numeric, 0);
    v_qty             := COALESCE((v_item->>'qty')::int, 1);
    v_line_discount_amt := COALESCE((v_item->>'discount_amount_rp')::numeric, 0);
    -- master_price_at_sale falls back to unit_price when not provided (no-discount legacy items)
    v_master_price    := COALESCE((v_item->>'master_price_at_sale')::numeric, v_unit_price);

    -- Markup guard: unit_price must not exceed master (selling above catalogue price is markup)
    IF v_unit_price > v_master_price THEN
      RAISE EXCEPTION 'MARKUP_NOT_ALLOWED: sku=% master=% unit_price=%',
        v_item->>'sku', v_master_price, v_unit_price;
    END IF;

    -- Line discount cannot exceed total line value
    IF v_line_discount_amt > (v_unit_price * v_qty) THEN
      RAISE EXCEPTION 'EXCESSIVE_LINE_DISCOUNT: sku=% discount=% base=%',
        v_item->>'sku', v_line_discount_amt, (v_unit_price * v_qty);
    END IF;

    v_line_discount_total := v_line_discount_total + v_line_discount_amt;
    v_recomputed_subtotal := v_recomputed_subtotal
                           + (v_unit_price * v_qty)
                           - v_line_discount_amt;
  END LOOP;

  -- ── Order-level discount guard (NEW) ───────────────────────────────────────
  IF v_order_discount_amt > v_recomputed_subtotal THEN
    RAISE EXCEPTION 'DISCOUNT_EXCEEDS_SUBTOTAL: order_discount=% subtotal_after_line=%',
      v_order_discount_amt, v_recomputed_subtotal;
  END IF;

  -- ── Recompute authoritative totals (ignore payload subtotal/total) ──────────
  v_shipping_fee := COALESCE((p_payload->>'shipping_fee')::numeric, 0);
  v_subtotal     := v_recomputed_subtotal;
  v_total        := v_recomputed_subtotal - v_order_discount_amt + v_shipping_fee;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'total must be positive' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Lock customer row + read credit fields (existing)
  -- customers.id is TEXT (legacy GJP-CUST-XXXX format), not UUID — compare directly.
  SELECT * INTO v_customer
  FROM public.customers
  WHERE id = p_payload->>'customer_id'
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

  -- 3. Sum existing outstanding INSIDE the locked transaction (existing)
  SELECT COALESCE(SUM(total), 0)
  INTO v_outstanding
  FROM public.orders
  WHERE customer_id = v_customer.id::text
    AND payment_type = 'TEMPO'
    AND status = 'INVOICE_TEMPO';

  -- 4. Hard-block over-limit (uses recomputed v_total, not payload total)
  IF (v_outstanding + v_total) > v_customer.credit_limit THEN
    RAISE EXCEPTION 'credit_limit_exceeded: outstanding=%, new=%, limit=%',
      v_outstanding, v_total, v_customer.credit_limit
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. Compute due_date (existing)
  v_due_date := CURRENT_DATE + v_customer.term_days;

  -- 6. Decrement stock per line via existing FIFO RPC (gathers HPP total) (existing)
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
  -- Extended: writes discount_type, discount_value, discount_amount_rp cols (NEW).
  -- items JSONB stored as-is from payload (already shaped with discount_* fields by wizard).
  -- TODO(Phase 0c sales dual-write): when create_tempo_invoice gains GL dual-write,
  --   append a debit line to 4-1900 (Diskon Penjualan) for
  --   (v_line_discount_total + v_order_discount_amt). See migration header for details.
  INSERT INTO public.orders (
    customer_id, customer_name, customer_phone, customer_company, customer_address,
    items, subtotal, shipping_fee, total, hpp_total,
    payment_type, channel, sales_channel, status,
    due_date, delivery_type,
    booking_expires_at,
    discount_type, discount_value, discount_amount_rp,
    created_at, updated_at
  ) VALUES (
    v_customer.id::text,
    COALESCE(p_payload->>'customer_name', v_customer.name, ''),
    COALESCE(p_payload->>'customer_phone', v_customer.wa_number, ''),
    COALESCE(p_payload->>'customer_company', v_customer.company, ''),
    COALESCE(p_payload->>'delivery_address', ''),
    v_items_jsonb,
    v_subtotal,                   -- server-recomputed
    v_shipping_fee,
    v_total,                      -- server-recomputed
    v_hpp_total,
    'TEMPO',
    COALESCE(p_payload->>'channel', 'walkin')::public.sales_channel,
    COALESCE(p_payload->>'sales_channel', p_payload->>'channel', 'walkin')::public.sales_channel,
    'INVOICE_TEMPO',
    v_due_date,
    COALESCE(p_payload->>'delivery_type', 'PICKUP'),
    (now() + interval '90 days'),
    v_order_discount_type,        -- NEW
    v_order_discount_val,         -- NEW
    v_order_discount_amt,         -- NEW
    now(),
    now()
  )
  RETURNING id INTO v_order_id;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_tempo_invoice(jsonb) TO authenticated;

COMMIT;
