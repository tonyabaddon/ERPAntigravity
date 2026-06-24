-- 20260901000006 — create_tempo_invoice: tier-aware per-line validation
--
-- Adds modul_multi_tier_price gate: when ON, each line item may carry
-- pricing_tier_used ('eceran'|'grosir'). Server validates master_price_at_sale
-- matches expected tier price from stocks.  When flag is OFF, tier field is
-- silently ignored — Garindo default unchanged.
--
-- Signature: same single-param (p_payload jsonb) RETURNS uuid as 20260801000005.
-- pricing_tier_used is persisted in items JSONB via v_items_jsonb passthrough
-- (no rebuild loop needed — items stored as-is from payload).
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION public.create_tempo_invoice(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- ── Multi-tier additions ───────────────────────────────────────────────────
  v_tier_modul_on       BOOLEAN;
  v_tier_used           TEXT;
  v_expected_price      NUMERIC;
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
  -- ── Discount / recompute locals (unchanged from 20260801000005) ─────────────
  v_master_price        numeric;
  v_unit_price          numeric;
  v_line_discount_amt   numeric;
  v_line_discount_total numeric := 0;
  v_recomputed_subtotal numeric := 0;
  v_order_discount_type TEXT    := p_payload->>'discount_type';
  v_order_discount_val  NUMERIC := (p_payload->>'discount_value')::numeric;
  v_order_discount_amt  NUMERIC := COALESCE((p_payload->>'discount_amount_rp')::numeric, 0);
BEGIN
  -- ── Read multi-tier flag early ─────────────────────────────────────────────
  SELECT modul_multi_tier_price INTO v_tier_modul_on FROM tenant_settings LIMIT 1;

  -- 1. Validate payload shape (existing)
  IF p_payload->>'customer_id' IS NULL THEN
    RAISE EXCEPTION 'customer_id required' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(COALESCE(p_payload->'items', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'items must contain at least one line' USING ERRCODE = 'P0001';
  END IF;

  -- ── Discount triple-consistency (unchanged) ────────────────────────────────
  IF (v_order_discount_type IS NULL) <> (v_order_discount_val IS NULL) THEN
    RAISE EXCEPTION 'DISCOUNT_TRIPLE_INVALID: type and value must both be NULL or both set';
  END IF;
  IF v_order_discount_amt < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_DISCOUNT';
  END IF;

  -- ── Per-line validation + recompute subtotal ───────────────────────────────
  v_items_jsonb := COALESCE(p_payload->'items', '[]'::jsonb);
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items_jsonb) LOOP
    v_unit_price      := COALESCE((v_item->>'unit_price')::numeric, 0);
    v_qty             := COALESCE((v_item->>'qty')::int, 1);
    v_line_discount_amt := COALESCE((v_item->>'discount_amount_rp')::numeric, 0);
    -- master_price_at_sale falls back to unit_price when not provided (no-discount legacy items)
    v_master_price    := COALESCE((v_item->>'master_price_at_sale')::numeric, v_unit_price);

    -- ── NEW: tier validation (only when modul ON) ──────────────────────────
    v_tier_used := v_item->>'pricing_tier_used';

    -- I-4 (review 2026-06-24): when modul ON + SKU line + tier missing,
    -- default to 'eceran' instead of silently skipping validation. Prevents
    -- buggy/legacy clients from posting mis-priced lines with no tier metadata.
    -- NOTE: persisted JSONB snapshot stores items as-is from p_payload (see line 71);
    -- a defaulted tier validates correctly but does NOT inject into the snapshot.
    -- Historical readers can infer tier from master_price_at_sale = stocks.price/grosir.
    IF v_tier_modul_on AND v_tier_used IS NULL AND (v_item->>'sku') IS NOT NULL THEN
      v_tier_used := 'eceran';
    END IF;

    IF v_tier_modul_on AND v_tier_used IS NOT NULL THEN
      -- Validate tier value
      IF v_tier_used NOT IN ('eceran', 'grosir') THEN
        RAISE EXCEPTION 'INVALID_TIER: %', v_tier_used;
      END IF;

      -- Lookup expected price from stocks master
      -- grosir fallback: if price_grosir IS NULL, treat as eceran price (COALESCE)
      SELECT CASE WHEN v_tier_used = 'grosir'
                  THEN COALESCE(s.price_grosir, s.price)
                  ELSE s.price
             END
        INTO v_expected_price
        FROM stocks s
       WHERE s.sku = v_item->>'sku';

      -- master_price_at_sale must exactly match tier baseline (strict equality)
      IF v_master_price IS DISTINCT FROM v_expected_price THEN
        RAISE EXCEPTION 'TIER_PRICE_MISMATCH: sku=%, tier=%, expected=%, got=%',
          v_item->>'sku', v_tier_used, v_expected_price, v_master_price;
      END IF;
    END IF;
    -- ── END tier validation ────────────────────────────────────────────────

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

  -- ── Order-level discount guard (unchanged) ─────────────────────────────────
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
  -- pricing_tier_used passes through into v_items_jsonb automatically (stored as-is from payload)
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
  -- Extended: writes discount_type, discount_value, discount_amount_rp cols.
  -- items JSONB stored as-is from payload — pricing_tier_used in each line passes
  -- through automatically (no rebuild loop needed).
  -- TODO(Phase 0c sales dual-write): when create_tempo_invoice gains GL dual-write,
  --   append a debit line to 4-1900 (Diskon Penjualan) for
  --   (v_line_discount_total + v_order_discount_amt). See 20260801000005 for details.
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
    v_order_discount_type,
    v_order_discount_val,
    v_order_discount_amt,
    now(),
    now()
  )
  RETURNING id INTO v_order_id;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_tempo_invoice(jsonb) TO authenticated;

COMMIT;
