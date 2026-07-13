-- 20261115000232_fix_create_tempo_invoice_shipping_je.sql
--
-- BLOCKER B1 fix (per docs/audits/2026-07-13-noa-e2e-audit.md).
--
-- Problem: `create_tempo_invoice` includes `shipping_fee` in the AR
-- debit (`v_total = subtotal − order_disc + shipping_fee`) but never
-- credits shipping to any revenue/liability account. When shipping > 0,
-- SUM(DEBIT) − SUM(CREDIT) = shipping_fee → `_post_journal_entry`
-- raises `unbalanced_entry` → soft-catch swallows → NO JE posted.
-- Silent GL drop for every tempo invoice with an ongkir charge.
--
-- Fix: add a CR to `4-1220 Pendapatan Ongkir (margin)` for
-- `v_shipping_fee` when > 0. Semantically MSME-appropriate:
-- COA row 4-1220 (subtype `PENDAPATAN_LAIN`) is literally seeded
-- "Pendapatan Ongkir (margin)" — this is exactly its purpose. Actual
-- courier expense continues to flow separately through
-- `5-2500 Beban Transportasi/Ongkir` when Anda catat pembayaran ke
-- driver / Lalamove via `record_manual_expense`.
--
-- Secondary fix (in scope: same RPC, same code block): replace the
-- unfiltered `accounting_config` lookup (`FROM ... LIMIT 1`) with the
-- per-tenant lookup (`WHERE tenant_id = _resolve_tenant_id()`) to
-- match the pattern established by slot 20261115000047 for
-- `_post_journal_entry` and slot 20261115000046 for `record_kasir_sale`.
-- Prod currently works accidentally because all 3 tenants have
-- `enable_dual_write_to_gl = true`; but a `false` toggle on any tenant
-- would incorrectly gate the others.
--
-- Idempotent: CREATE OR REPLACE. No historical data migration needed
-- (verified 2026-07-13: `gl_dual_write_anomalies` shows 0 rows with
-- `source_rpc='create_tempo_invoice'` → the shipping path hasn't been
-- exercised in prod yet; forward-only fix is safe).
--
-- Balance verification (with shipping_fee > 0, discount > 0):
--   DR = v_total + (line_disc + order_disc) + hpp_stock + hpp_pt
--      = (recomputed − order_disc + shipping_fee) + line_disc + order_disc + hpp_stock + hpp_pt
--      = recomputed + line_disc + shipping_fee + hpp_stock + hpp_pt
--   CR = (recomputed + line_disc) + shipping_fee + hpp_stock + hpp_pt
--   DR − CR = 0 ✓

BEGIN;

CREATE OR REPLACE FUNCTION public.create_tempo_invoice(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tier_modul_on       BOOLEAN;
  v_tier_used           TEXT;
  v_expected_price      NUMERIC;
  v_customer            public.customers%ROWTYPE;
  v_outstanding         numeric;
  v_total               numeric;
  v_subtotal            numeric;
  v_shipping_fee        numeric;
  v_item                jsonb;
  v_order_id            uuid;
  v_due_date            date;
  v_items_jsonb         jsonb := '[]'::jsonb;
  v_sku                 text;
  v_qty                 int;
  v_hpp_total           numeric := 0;
  v_hpp_per_line        numeric;
  v_allow_negative      BOOLEAN := COALESCE((p_payload->>'allow_negative_stock')::boolean, false);
  v_master_price        numeric;
  v_unit_price          numeric;
  v_line_discount_amt   numeric;
  v_line_discount_total numeric := 0;
  v_recomputed_subtotal numeric := 0;
  v_order_discount_type TEXT    := p_payload->>'discount_type';
  v_order_discount_val  NUMERIC := (p_payload->>'discount_value')::numeric;
  v_order_discount_amt  NUMERIC := COALESCE((p_payload->>'discount_amount_rp')::numeric, 0);
  v_hpp_stock_total       numeric := 0;
  v_hpp_passthrough_total numeric := 0;
  v_is_passthrough        boolean;
  v_line_harga_modal      numeric;
  v_dual_write_enabled  boolean;
  v_je_lines            jsonb := '[]'::jsonb;
BEGIN
  PERFORM public._guard_expiry_write();
  SELECT modul_multi_tier_price INTO v_tier_modul_on FROM tenant_settings LIMIT 1;

  IF p_payload->>'customer_id' IS NULL THEN
    RAISE EXCEPTION 'customer_id required' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(COALESCE(p_payload->'items', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'items must contain at least one line' USING ERRCODE = 'P0001';
  END IF;

  IF (v_order_discount_type IS NULL) <> (v_order_discount_val IS NULL) THEN
    RAISE EXCEPTION 'DISCOUNT_TRIPLE_INVALID: type and value must both be NULL or both set';
  END IF;
  IF v_order_discount_amt < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_DISCOUNT';
  END IF;

  v_items_jsonb := COALESCE(p_payload->'items', '[]'::jsonb);
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items_jsonb) LOOP
    v_unit_price      := COALESCE((v_item->>'unit_price')::numeric, 0);
    v_qty             := COALESCE((v_item->>'qty')::int, 1);
    v_line_discount_amt := COALESCE((v_item->>'discount_amount_rp')::numeric, 0);
    v_master_price    := COALESCE((v_item->>'master_price_at_sale')::numeric, v_unit_price);

    v_tier_used := v_item->>'pricing_tier_used';

    IF v_tier_modul_on AND v_tier_used IS NULL AND (v_item->>'sku') IS NOT NULL THEN
      v_tier_used := 'eceran';
    END IF;

    IF v_tier_modul_on AND v_tier_used IS NOT NULL THEN
      IF v_tier_used NOT IN ('eceran', 'grosir') THEN
        RAISE EXCEPTION 'INVALID_TIER: %', v_tier_used;
      END IF;
      SELECT CASE WHEN v_tier_used = 'grosir'
                  THEN COALESCE(s.price_grosir, s.price)
                  ELSE s.price
             END
        INTO v_expected_price
        FROM stocks s
       WHERE s.sku = v_item->>'sku';
      IF v_master_price IS DISTINCT FROM v_expected_price THEN
        RAISE EXCEPTION 'TIER_PRICE_MISMATCH: sku=%, tier=%, expected=%, got=%',
          v_item->>'sku', v_tier_used, v_expected_price, v_master_price;
      END IF;
    END IF;

    IF v_unit_price > v_master_price THEN
      RAISE EXCEPTION 'MARKUP_NOT_ALLOWED: sku=% master=% unit_price=%',
        v_item->>'sku', v_master_price, v_unit_price;
    END IF;
    IF v_line_discount_amt > (v_unit_price * v_qty) THEN
      RAISE EXCEPTION 'EXCESSIVE_LINE_DISCOUNT: sku=% discount=% base=%',
        v_item->>'sku', v_line_discount_amt, (v_unit_price * v_qty);
    END IF;

    v_line_discount_total := v_line_discount_total + v_line_discount_amt;
    v_recomputed_subtotal := v_recomputed_subtotal
                           + (v_unit_price * v_qty)
                           - v_line_discount_amt;
  END LOOP;

  IF v_order_discount_amt > v_recomputed_subtotal THEN
    RAISE EXCEPTION 'DISCOUNT_EXCEEDS_SUBTOTAL: order_discount=% subtotal_after_line=%',
      v_order_discount_amt, v_recomputed_subtotal;
  END IF;

  v_shipping_fee := COALESCE((p_payload->>'shipping_fee')::numeric, 0);
  v_subtotal     := v_recomputed_subtotal;
  v_total        := v_recomputed_subtotal - v_order_discount_amt + v_shipping_fee;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'total must be positive' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_customer FROM public.customers WHERE id = p_payload->>'customer_id' FOR UPDATE;
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

  SELECT COALESCE(SUM(total), 0) INTO v_outstanding
  FROM public.orders
  WHERE customer_id = v_customer.id::text
    AND payment_type = 'TEMPO' AND status = 'INVOICE_TEMPO';

  IF (v_outstanding + v_total) > v_customer.credit_limit THEN
    RAISE EXCEPTION 'credit_limit_exceeded: outstanding=%, new=%, limit=%',
      v_outstanding, v_total, v_customer.credit_limit USING ERRCODE = 'P0001';
  END IF;

  v_due_date := CURRENT_DATE + v_customer.term_days;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items_jsonb) LOOP
    v_sku := v_item->>'sku';
    v_qty := COALESCE((v_item->>'qty')::int, 0);
    IF v_sku IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    SELECT COALESCE(is_passthrough, false), harga_modal
      INTO v_is_passthrough, v_line_harga_modal
    FROM public.stocks WHERE sku = v_sku;

    IF v_is_passthrough THEN
      v_hpp_per_line := COALESCE(v_line_harga_modal, 0) * v_qty;
      v_hpp_passthrough_total := v_hpp_passthrough_total + v_hpp_per_line;
    ELSE
      v_hpp_per_line := public.deduct_stock_fifo(
        v_sku, v_qty, 'atas', 'order_tempo', NULL, 'sale_kasir'::public.stock_movement_source
      );
      v_hpp_stock_total := v_hpp_stock_total + v_hpp_per_line;
    END IF;
    v_hpp_total := v_hpp_total + v_hpp_per_line;
  END LOOP;

  INSERT INTO public.orders (
    customer_id, customer_name, customer_phone, customer_company, customer_address,
    items, subtotal, shipping_fee, total, hpp_total,
    payment_type, channel, sales_channel, status,
    due_date, delivery_type, booking_expires_at,
    discount_type, discount_value, discount_amount_rp,
    created_at, updated_at
  ) VALUES (
    v_customer.id::text,
    COALESCE(p_payload->>'customer_name', v_customer.name, ''),
    COALESCE(p_payload->>'customer_phone', v_customer.wa_number, ''),
    COALESCE(p_payload->>'customer_company', v_customer.company, ''),
    COALESCE(p_payload->>'delivery_address', ''),
    v_items_jsonb, v_subtotal, v_shipping_fee, v_total, v_hpp_total,
    'TEMPO',
    COALESCE(p_payload->>'channel', 'walkin')::public.sales_channel,
    COALESCE(p_payload->>'sales_channel', p_payload->>'channel', 'walkin')::public.sales_channel,
    'INVOICE_TEMPO', v_due_date,
    COALESCE(p_payload->>'delivery_type', 'PICKUP'),
    (now() + interval '90 days'),
    v_order_discount_type, v_order_discount_val, v_order_discount_amt,
    now(), now()
  ) RETURNING id INTO v_order_id;

  -- B1 secondary fix: per-tenant accounting_config lookup (was `LIMIT 1`)
  SELECT COALESCE(enable_dual_write_to_gl, false) INTO v_dual_write_enabled
    FROM public.accounting_config
   WHERE tenant_id = public._resolve_tenant_id()
   LIMIT 1;

  IF v_dual_write_enabled THEN
    BEGIN
      v_je_lines := jsonb_build_array(
        jsonb_build_object('account_code','1-1400','side','DEBIT','amount',v_total,
          'description','AR Tempo '||COALESCE(v_customer.name,'')),
        jsonb_build_object('account_code','4-1140','side','CREDIT',
          'amount',v_recomputed_subtotal + v_line_discount_total,
          'description','Revenue Tempo '||COALESCE(v_customer.name,''))
      );

      -- B1 primary fix: credit shipping fee to 4-1220 Pendapatan Ongkir (margin)
      -- when > 0. Without this, DR-CR balance is off by exactly shipping_fee
      -- and _post_journal_entry rejects.
      IF v_shipping_fee > 0 THEN
        v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
          'account_code','4-1220','side','CREDIT','amount',v_shipping_fee,
          'description','Ongkir Tempo '||COALESCE(v_customer.name,'')));
      END IF;

      IF (v_line_discount_total + v_order_discount_amt) > 0 THEN
        v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
          'account_code','4-1900','side','DEBIT',
          'amount',v_line_discount_total + v_order_discount_amt,
          'description','Diskon Penjualan Tempo'));
      END IF;
      IF v_hpp_stock_total > 0 THEN
        v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
          'account_code','5-1100','side','DEBIT','amount',v_hpp_stock_total,
          'description','HPP Penjualan Tempo (stock)'));
        v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
          'account_code','1-1510','side','CREDIT','amount',v_hpp_stock_total,
          'description','Persediaan Tempo'));
      END IF;
      IF v_hpp_passthrough_total > 0 THEN
        v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
          'account_code','5-1200','side','DEBIT','amount',v_hpp_passthrough_total,
          'description','HPP Passthrough Tempo (accrual)'));
        v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
          'account_code','2-1150','side','CREDIT','amount',v_hpp_passthrough_total,
          'description','Accrued Hutang Passthrough'));
      END IF;
      PERFORM public._post_journal_entry(
        p_entry_date       := CURRENT_DATE,
        p_source_type      := 'TEMPO_INVOICE_CREATE'::public.journal_entry_source,
        p_description      := 'Tempo Invoice '||v_order_id::text,
        p_lines            := v_je_lines,
        p_source_ref_table := 'orders',
        p_source_ref_id    := v_order_id
      );
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.gl_dual_write_anomalies (
        source_rpc, source_ref_table, source_ref_id,
        error_code, error_message, attempted_payload
      ) VALUES (
        'create_tempo_invoice', 'orders', v_order_id,
        SQLSTATE, SQLERRM, v_je_lines
      );
      RAISE WARNING 'GL dual-write failed for create_tempo_invoice %: [%] %',
        v_order_id, SQLSTATE, SQLERRM;
    END;
  END IF;

  RETURN v_order_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_tempo_invoice(jsonb) TO authenticated;

COMMIT;
