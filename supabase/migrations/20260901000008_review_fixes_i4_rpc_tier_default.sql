-- 20260901000008 — Review fix I-4: default eceran on missing tier
--
-- When modul_multi_tier_price = ON and a SKU line item has no pricing_tier_used
-- key, the RPC previously skipped tier validation entirely. This allowed buggy or
-- legacy clients to post mis-priced lines with no tier metadata.
--
-- Fix: both record_kasir_sale and create_tempo_invoice now default v_tier_used
-- to 'eceran' when modul ON + SKU non-null + tier missing. This causes the
-- server to validate master_price_at_sale against stocks.price (eceran baseline)
-- and reject any mismatch with TIER_PRICE_MISMATCH.
--
-- Service lines (sku IS NULL) keep the old null-skip behavior.
--
-- See also: 20260901000005 (record_kasir_sale source) and
--           20260901000006 (create_tempo_invoice source).
-- Review date: 2026-06-24.
-- ────────────────────────────────────────────────────────────────────────────

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
  p_customer_id           text,
  p_discount_type         TEXT    DEFAULT NULL,
  p_discount_value        NUMERIC DEFAULT NULL,
  p_discount_amount_rp    NUMERIC DEFAULT 0,
  p_cash_account_id       UUID    DEFAULT NULL,
  p_allow_negative_stock  BOOLEAN DEFAULT FALSE
) RETURNS public.kasir_transactions
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  -- ── Multi-tier additions ───────────────────────────────────────────────────
  v_tier_modul_on       BOOLEAN;
  v_tier_used           TEXT;
  v_expected_price      NUMERIC;
  -- ── Existing declarations ──────────────────────────────────────────────────
  v_customer_id         text := p_customer_id;
  v_counter             int;
  v_invoice_prefix      text;
  v_invoice_number      text;
  v_status              text;
  v_kasir               public.kasir_transactions%ROWTYPE;
  v_agg                 record;
  v_agg_cost            numeric;
  v_cost_map            jsonb := '{}'::jsonb;
  v_items_out           jsonb := '[]'::jsonb;
  v_item                jsonb;
  v_item_out            jsonb;
  v_sku                 text;
  v_qty                 int;
  v_warehouse           text;
  v_hpp_per_unit        numeric;
  v_hpp_subtotal        numeric;
  v_hpp_total           numeric := 0;
  v_key                 text;
  -- Discount / recompute locals
  v_master_price        numeric;
  v_unit_price          numeric;
  v_line_discount_amt   numeric;
  v_line_discount_total numeric := 0;
  v_recomputed_subtotal numeric := 0;
  v_recomputed_total    numeric;
  v_total_discount_rp   numeric;
BEGIN
  -- ── Read multi-tier flag early ─────────────────────────────────────────────
  SELECT modul_multi_tier_price INTO v_tier_modul_on FROM tenant_settings LIMIT 1;

  -- ── Input validation (existing) ────────────────────────────────────────────
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

  -- ── Discount triple-consistency (existing) ─────────────────────────────────
  IF (p_discount_type IS NULL) <> (p_discount_value IS NULL) THEN
    RAISE EXCEPTION 'DISCOUNT_TRIPLE_INVALID: type and value must both be NULL or both set';
  END IF;
  IF COALESCE(p_discount_amount_rp, 0) < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_DISCOUNT';
  END IF;

  -- ── Per-line validation + recompute subtotal ───────────────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    v_unit_price        := COALESCE((v_item->>'unit_price')::numeric, 0);
    v_qty               := COALESCE((v_item->>'qty')::int, 1);
    v_line_discount_amt := COALESCE((v_item->>'discount_amount_rp')::numeric, 0);
    -- master_price_at_sale falls back to unit_price when not provided
    v_master_price      := COALESCE((v_item->>'master_price_at_sale')::numeric, v_unit_price);

    -- ── NEW: tier validation (only when modul ON) ──────────────────────────
    v_tier_used := v_item->>'pricing_tier_used';

    -- I-4 (review 2026-06-24): when modul ON + SKU line (product) + tier missing,
    -- default to 'eceran' instead of silently skipping validation. Prevents
    -- buggy/legacy clients from posting mis-priced lines with no tier metadata.
    -- Service lines (sku IS NULL) keep the old null-skip behavior.
    IF v_tier_modul_on AND v_tier_used IS NULL AND (v_item->>'sku') IS NOT NULL THEN
      v_tier_used := 'eceran';
      -- Inject the default into v_item so the persisted JSONB snapshot carries the tier.
      v_item := v_item || jsonb_build_object('pricing_tier_used', v_tier_used);
    END IF;

    IF v_tier_modul_on AND v_tier_used IS NOT NULL THEN
      -- Validate tier value
      IF v_tier_used NOT IN ('eceran', 'grosir') THEN
        RAISE EXCEPTION 'INVALID_TIER: %', v_tier_used;
      END IF;

      -- Lookup expected price from stocks master
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

    -- Markup guard: unit_price must not exceed master
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

  -- ── Order-level discount guard (existing) ─────────────────────────────────
  IF COALESCE(p_discount_amount_rp, 0) > v_recomputed_subtotal THEN
    RAISE EXCEPTION 'DISCOUNT_EXCEEDS_SUBTOTAL: order_discount=% subtotal_after_line=%',
      p_discount_amount_rp, v_recomputed_subtotal;
  END IF;

  -- Recompute authoritative totals (ignore client's p_subtotal / p_total_amount)
  v_recomputed_total  := v_recomputed_subtotal
                       - COALESCE(p_discount_amount_rp, 0)
                       + COALESCE(p_ongkir_amount, 0);
  v_total_discount_rp := v_line_discount_total + COALESCE(p_discount_amount_rp, 0);

  -- ── Customer find-or-create (existing) ────────────────────────────────────
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

  -- ── Invoice number (existing) ──────────────────────────────────────────────
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

  -- ── Stock deduction + FIFO cost (existing) ────────────────────────────────
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

  -- ── Build items_out with HPP (existing; pricing_tier_used preserved via v_item passthrough) ─────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sku := v_item->>'sku';
    IF v_sku IS NULL THEN
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
      -- pricing_tier_used is already in v_item (left operand of ||), so it
      -- passes through automatically into v_item_out and into the stored JSONB.
      v_item_out := v_item || jsonb_build_object(
        'hpp_per_unit', v_hpp_per_unit,
        'hpp_subtotal', v_hpp_subtotal
      );
    END IF;
    v_items_out := v_items_out || v_item_out;
  END LOOP;

  v_status := CASE WHEN p_payment_type = 'DP' THEN 'AWAITING_LUNAS' ELSE 'PAID' END;

  -- ── Insert kasir_transaction (extended with discount cols) ─────────────────
  INSERT INTO public.kasir_transactions (
    date, type, channel, items, subtotal, hpp_total,
    payment_method, payment_subtype, payment_type, dp_amount, dp_input_type,
    ongkir_amount, notes, total_amount,
    marketplace_order_no, wa_phone, wa_chat_url, status,
    customer_id, customer_name, customer_phone, customer_company,
    delivery_address, invoice_number,
    discount_type, discount_value, discount_amount_rp
  ) VALUES (
    p_date,
    'income',
    p_channel::public.kasir_channel,
    v_items_out,
    v_recomputed_subtotal,
    v_hpp_total,
    p_payment_method::public.kasir_payment_method,
    p_payment_subtype,
    p_payment_type,
    COALESCE(p_dp_amount, 0),
    p_dp_input_type,
    COALESCE(p_ongkir_amount, 0),
    p_notes,
    v_recomputed_total,
    p_marketplace_order_no,
    p_wa_phone,
    p_wa_chat_url,
    v_status,
    v_customer_id,
    p_customer_name,
    p_customer_phone,
    p_customer_company,
    p_delivery_address,
    v_invoice_number,
    p_discount_type,
    p_discount_value,
    COALESCE(p_discount_amount_rp, 0)
  )
  RETURNING * INTO v_kasir;

  -- ── GL Dual-write (soft-fail) ──────────────────────────────────────────────
  DECLARE
    v_dual_write        boolean;
    v_default_kas       uuid;
    v_default_bank      uuid;
    v_default_qris      uuid;
    v_default_edc       uuid;
    v_resolved_acct_id  uuid;
    v_cash_coa          text;
    v_pendapatan_coa    text;
    v_lines             jsonb;
    v_gross_revenue     numeric;
  BEGIN
    SELECT
      enable_dual_write_to_gl,
      default_kas_account_id,
      default_bank_account_id,
      default_qris_account_id,
      default_edc_account_id
    INTO
      v_dual_write,
      v_default_kas,
      v_default_bank,
      v_default_qris,
      v_default_edc
    FROM public.accounting_config
    WHERE tenant_id IS NULL
    LIMIT 1;

    IF COALESCE(v_dual_write, false) THEN
      v_resolved_acct_id := COALESCE(
        p_cash_account_id,
        CASE LOWER(p_payment_method)
          WHEN 'cash'     THEN v_default_kas
          WHEN 'transfer' THEN v_default_bank
          WHEN 'qris'     THEN COALESCE(v_default_qris, v_default_bank)
          WHEN 'edc'      THEN COALESCE(v_default_edc, v_default_bank)
          ELSE v_default_kas
        END
      );

      IF v_resolved_acct_id IS NULL THEN
        INSERT INTO public.gl_dual_write_anomalies (
          source_rpc, source_ref_table, source_ref_id,
          error_code, error_message, attempted_payload
        ) VALUES (
          'record_kasir_sale',
          'kasir_transactions',
          v_kasir.id,
          'NO_CASH_ACCOUNT',
          'GL dual-write skipped: no cash_account_id resolved for payment_method=' || p_payment_method,
          jsonb_build_object(
            'cash_account_id', p_cash_account_id,
            'payment_method',  p_payment_method,
            'channel',         p_channel,
            'total_amount',    v_recomputed_total,
            'p_date',          p_date
          )
        );
        RAISE WARNING 'GL dual-write skipped for kasir_sale %: no cash account resolved (payment_method=%)',
          v_kasir.id, p_payment_method;
      ELSE
        BEGIN
          SELECT coa.account_code INTO v_cash_coa
          FROM public.cash_accounts ca
          JOIN public.chart_of_accounts coa ON coa.id = ca.coa_account_id
          WHERE ca.id = v_resolved_acct_id
            AND coa.is_active = true;

          IF v_cash_coa IS NULL THEN
            RAISE EXCEPTION 'cash_account % has no active COA link', v_resolved_acct_id;
          END IF;

          v_pendapatan_coa := public._resolve_kasir_pendapatan_coa(p_channel);

          v_gross_revenue := v_recomputed_total + v_total_discount_rp;

          v_lines := jsonb_build_array(
            jsonb_build_object(
              'account_code', v_cash_coa,
              'side',         'DEBIT',
              'amount',       v_recomputed_total,
              'description',  'Kas masuk ' || p_payment_method
            ),
            jsonb_build_object(
              'account_code', v_pendapatan_coa,
              'side',         'CREDIT',
              'amount',       v_gross_revenue,
              'description',  'Pendapatan ' || p_channel
            )
          );

          IF v_total_discount_rp > 0 THEN
            v_lines := v_lines || jsonb_build_array(
              jsonb_build_object(
                'account_code', '4-1900',
                'side',         'DEBIT',
                'amount',       v_total_discount_rp,
                'description',  'Diskon penjualan'
              )
            );
          END IF;

          IF v_kasir.hpp_total IS NOT NULL AND v_kasir.hpp_total > 0 THEN
            v_lines := v_lines || jsonb_build_array(
              jsonb_build_object(
                'account_code', '5-1100',
                'side',         'DEBIT',
                'amount',       v_kasir.hpp_total,
                'description',  'HPP ' || p_channel
              ),
              jsonb_build_object(
                'account_code', '1-1510',
                'side',         'CREDIT',
                'amount',       v_kasir.hpp_total,
                'description',  'Pemakaian persediaan'
              )
            );
          END IF;

          PERFORM public._post_journal_entry(
            p_date,
            'KASIR_SALE'::public.journal_entry_source,
            'Penjualan ' || p_channel || COALESCE(' · ' || p_marketplace_order_no, ''),
            v_lines,
            'kasir_transactions',
            v_kasir.id,
            NULL,
            NULL
          );

        EXCEPTION WHEN OTHERS THEN
          INSERT INTO public.gl_dual_write_anomalies (
            source_rpc, source_ref_table, source_ref_id,
            error_code, error_message, attempted_payload
          ) VALUES (
            'record_kasir_sale',
            'kasir_transactions',
            v_kasir.id,
            SQLSTATE,
            SQLERRM,
            jsonb_build_object(
              'cash_account_id', v_resolved_acct_id,
              'cash_coa',        v_cash_coa,
              'payment_method',  p_payment_method,
              'channel',         p_channel,
              'total_amount',    v_recomputed_total,
              'p_date',          p_date,
              'hpp_total',       v_kasir.hpp_total,
              'total_discount_rp', v_total_discount_rp
            )
          );
          RAISE WARNING 'GL dual-write failed for kasir_sale %: [%] %',
            v_kasir.id, SQLSTATE, SQLERRM;
        END;
      END IF;
    END IF;
  END;
  -- ── End GL Dual-write ──────────────────────────────────────────────────────

  RETURN v_kasir;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.record_kasir_sale(
  date, text, jsonb, numeric, text, text, text, numeric, text, numeric,
  text, numeric, text, text, text, text, text, text, text, text,
  text, numeric, numeric, uuid, boolean
) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────

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
