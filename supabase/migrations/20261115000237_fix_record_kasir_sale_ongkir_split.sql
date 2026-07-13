-- Slot 237 — W1 fix: split ongkir out of channel revenue in record_kasir_sale.
--
-- BEFORE: v_gross_revenue = v_recomputed_total + v_total_discount_rp
--         (bundles ongkir into channel revenue "Pendapatan walkin" etc.)
--
-- AFTER:  channel revenue = goods gross only (pre-discount, no ongkir);
--         ongkir goes to its own CR 4-1220 Pendapatan Ongkir line.
--
-- Consistent with slot 232 (create_tempo_invoice) — that already posts
-- 4-1220 for tempo shipping margin. Kasir path was the last inconsistent one.
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.record_kasir_sale(
  p_date date, p_channel text, p_items jsonb, p_subtotal numeric,
  p_payment_method text, p_payment_subtype text, p_payment_type text,
  p_dp_amount numeric, p_dp_input_type text, p_ongkir_amount numeric,
  p_notes text, p_total_amount numeric,
  p_customer_name text, p_customer_phone text, p_customer_company text,
  p_delivery_address text, p_marketplace_order_no text, p_wa_phone text,
  p_wa_chat_url text, p_customer_id text,
  p_discount_type text DEFAULT NULL::text, p_discount_value numeric DEFAULT NULL::numeric,
  p_discount_amount_rp numeric DEFAULT 0, p_cash_account_id uuid DEFAULT NULL::uuid,
  p_allow_negative_stock boolean DEFAULT false
) RETURNS kasir_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tier_modul_on       BOOLEAN;
  v_tier_used           TEXT;
  v_expected_price      NUMERIC;
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
  v_master_price        numeric;
  v_unit_price          numeric;
  v_line_discount_amt   numeric;
  v_line_discount_total numeric := 0;
  v_recomputed_subtotal numeric := 0;
  v_recomputed_total    numeric;
  v_total_discount_rp   numeric;
BEGIN
  PERFORM public._guard_expiry_write();
  SELECT modul_multi_tier_price INTO v_tier_modul_on FROM tenant_settings LIMIT 1;

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

  IF (p_discount_type IS NULL) <> (p_discount_value IS NULL) THEN
    RAISE EXCEPTION 'DISCOUNT_TRIPLE_INVALID: type and value must both be NULL or both set';
  END IF;
  IF COALESCE(p_discount_amount_rp, 0) < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_DISCOUNT';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    v_unit_price        := COALESCE((v_item->>'unit_price')::numeric, 0);
    v_qty               := COALESCE((v_item->>'qty')::int, 1);
    v_line_discount_amt := COALESCE((v_item->>'discount_amount_rp')::numeric, 0);
    v_master_price      := COALESCE((v_item->>'master_price_at_sale')::numeric, v_unit_price);

    v_tier_used := v_item->>'pricing_tier_used';
    IF v_tier_modul_on AND v_tier_used IS NULL AND (v_item->>'sku') IS NOT NULL THEN
      v_tier_used := 'eceran';
      v_item := v_item || jsonb_build_object('pricing_tier_used', v_tier_used);
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
    v_recomputed_subtotal := v_recomputed_subtotal + (v_unit_price * v_qty) - v_line_discount_amt;
  END LOOP;

  IF COALESCE(p_discount_amount_rp, 0) > v_recomputed_subtotal THEN
    RAISE EXCEPTION 'DISCOUNT_EXCEEDS_SUBTOTAL: order_discount=% subtotal_after_line=%',
      p_discount_amount_rp, v_recomputed_subtotal;
  END IF;

  v_recomputed_total  := v_recomputed_subtotal
                       - COALESCE(p_discount_amount_rp, 0)
                       + COALESCE(p_ongkir_amount, 0);
  v_total_discount_rp := v_line_discount_total + COALESCE(p_discount_amount_rp, 0);

  IF v_customer_id IS NULL
     AND p_customer_phone IS NOT NULL AND length(btrim(p_customer_phone)) > 0
     AND p_customer_name  IS NOT NULL AND length(btrim(p_customer_name))  > 0 THEN
    SELECT id INTO v_customer_id
    FROM public.customers WHERE wa_number = btrim(p_customer_phone) LIMIT 1;
    IF v_customer_id IS NULL THEN
      v_customer_id := gen_random_uuid()::text;
      INSERT INTO public.customers (id, wa_number, name, company)
      VALUES (v_customer_id, btrim(p_customer_phone), btrim(p_customer_name),
              COALESCE(btrim(p_customer_company), ''))
      ON CONFLICT (wa_number) DO UPDATE SET name = EXCLUDED.name
      RETURNING id INTO v_customer_id;
    END IF;
  END IF;

  v_counter := public.next_kasir_number(p_channel, p_date);
  v_invoice_prefix := CASE p_channel
    WHEN 'walkin'    THEN 'WLK' WHEN 'grosir' THEN 'GSR' WHEN 'sales' THEN 'SLS'
    WHEN 'expo' THEN 'EXP' WHEN 'tokopedia' THEN 'TPD' WHEN 'shopee' THEN 'SHP'
    WHEN 'lazada' THEN 'LZD' WHEN 'blibli' THEN 'BLB' WHEN 'bukalapak' THEN 'BKL'
    WHEN 'ralali' THEN 'RLI' WHEN 'bhinneka' THEN 'BHN' WHEN 'whatsapp' THEN 'WAM'
    WHEN 'instagram' THEN 'IGM' WHEN 'website' THEN 'WEB'
  END;
  v_invoice_number := v_invoice_prefix || '-' || to_char(p_date, 'YYYYMMDD') || '-' || lpad(v_counter::text, 3, '0');

  FOR v_agg IN
    SELECT item->>'sku' AS sku, COALESCE(item->>'warehouse', 'atas') AS warehouse,
           SUM((item->>'qty')::int)::int AS qty
    FROM jsonb_array_elements(p_items) AS item
    WHERE item->>'sku' IS NOT NULL GROUP BY 1, 2
  LOOP
    IF v_agg.sku IS NULL OR v_agg.qty IS NULL OR v_agg.qty <= 0 THEN
      RAISE EXCEPTION 'malformed item in p_items: sku=%, qty=%', v_agg.sku, v_agg.qty;
    END IF;
    PERFORM public.decrement_stock(v_agg.sku, v_agg.qty, v_agg.warehouse,
      'kasir_tx', v_invoice_number, 'sale_kasir');
    v_agg_cost := public.deduct_stock_fifo(v_agg.sku, v_agg.qty, v_agg.warehouse,
      'kasir_tx', v_invoice_number, 'sale_kasir');
    v_hpp_total := v_hpp_total + v_agg_cost;
    v_key := v_agg.sku || '||' || v_agg.warehouse;
    v_cost_map := v_cost_map || jsonb_build_object(v_key,
      CASE WHEN v_agg.qty > 0 THEN v_agg_cost / v_agg.qty ELSE 0 END);
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sku := v_item->>'sku';
    IF v_sku IS NULL THEN
      v_qty := COALESCE((v_item->>'qty')::int, 1);
      v_hpp_per_unit := COALESCE((v_item->>'hpp_per_unit')::numeric, 0);
      v_hpp_subtotal := COALESCE((v_item->>'hpp_subtotal')::numeric, v_hpp_per_unit * v_qty);
      v_hpp_total := v_hpp_total + v_hpp_subtotal;
      v_item_out := v_item || jsonb_build_object('hpp_per_unit', v_hpp_per_unit, 'hpp_subtotal', v_hpp_subtotal);
    ELSE
      v_qty := (v_item->>'qty')::int;
      v_warehouse := COALESCE(v_item->>'warehouse', 'atas');
      v_key := v_sku || '||' || v_warehouse;
      v_hpp_per_unit := COALESCE((v_cost_map ->> v_key)::numeric, 0);
      v_hpp_subtotal := v_hpp_per_unit * v_qty;
      v_item_out := v_item || jsonb_build_object('hpp_per_unit', v_hpp_per_unit, 'hpp_subtotal', v_hpp_subtotal);
    END IF;
    v_items_out := v_items_out || v_item_out;
  END LOOP;

  v_status := CASE WHEN p_payment_type = 'DP' THEN 'AWAITING_LUNAS' ELSE 'PAID' END;

  INSERT INTO public.kasir_transactions (
    date, type, channel, items, subtotal, hpp_total,
    payment_method, payment_subtype, payment_type, dp_amount, dp_input_type,
    ongkir_amount, notes, total_amount, marketplace_order_no, wa_phone, wa_chat_url, status,
    customer_id, customer_name, customer_phone, customer_company, delivery_address, invoice_number,
    discount_type, discount_value, discount_amount_rp
  ) VALUES (
    p_date, 'income', p_channel::public.kasir_channel, v_items_out,
    v_recomputed_subtotal, v_hpp_total,
    p_payment_method::public.kasir_payment_method, p_payment_subtype, p_payment_type,
    COALESCE(p_dp_amount, 0), p_dp_input_type, COALESCE(p_ongkir_amount, 0),
    p_notes, v_recomputed_total, p_marketplace_order_no, p_wa_phone, p_wa_chat_url, v_status,
    v_customer_id, p_customer_name, p_customer_phone, p_customer_company, p_delivery_address, v_invoice_number,
    p_discount_type, p_discount_value, COALESCE(p_discount_amount_rp, 0)
  ) RETURNING * INTO v_kasir;

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
    v_goods_gross       numeric;
    v_ongkir            numeric;
    v_cash_dr_amount    numeric;
    v_remainder         numeric;
  BEGIN
    SELECT enable_dual_write_to_gl, default_kas_account_id, default_bank_account_id,
           default_qris_account_id, default_edc_account_id
      INTO v_dual_write, v_default_kas, v_default_bank, v_default_qris, v_default_edc
      FROM public.accounting_config WHERE tenant_id = public._resolve_tenant_id() LIMIT 1;

    IF COALESCE(v_dual_write, false) THEN
      v_resolved_acct_id := COALESCE(
        p_cash_account_id,
        CASE LOWER(p_payment_method)
          WHEN 'cash' THEN v_default_kas
          WHEN 'transfer' THEN v_default_bank
          WHEN 'qris' THEN COALESCE(v_default_qris, v_default_bank)
          WHEN 'edc' THEN COALESCE(v_default_edc, v_default_bank)
          ELSE v_default_kas
        END
      );

      IF v_resolved_acct_id IS NULL THEN
        INSERT INTO public.gl_dual_write_anomalies (source_rpc, source_ref_table, source_ref_id, error_code, error_message, attempted_payload)
        VALUES ('record_kasir_sale', 'kasir_transactions', v_kasir.id, 'NO_CASH_ACCOUNT',
          'GL dual-write skipped: no cash_account_id resolved for payment_method=' || p_payment_method,
          jsonb_build_object('cash_account_id', p_cash_account_id, 'payment_method', p_payment_method,
            'channel', p_channel, 'total_amount', v_recomputed_total, 'p_date', p_date));
        RAISE WARNING 'GL dual-write skipped for kasir_sale %: no cash account resolved (payment_method=%)',
          v_kasir.id, p_payment_method;
      ELSE
        BEGIN
          SELECT coa.account_code INTO v_cash_coa
            FROM public.cash_accounts ca
            JOIN public.chart_of_accounts coa ON coa.id = ca.coa_account_id
           WHERE ca.id = v_resolved_acct_id AND coa.is_active = true;
          IF v_cash_coa IS NULL THEN
            RAISE EXCEPTION 'cash_account % has no active COA link', v_resolved_acct_id;
          END IF;

          v_pendapatan_coa := public._resolve_kasir_pendapatan_coa(p_channel);
          -- W1 fix: separate ongkir from channel revenue.
          -- v_goods_gross = sum(unit_price * qty)  (before line + order discount, before ongkir)
          v_ongkir      := COALESCE(p_ongkir_amount, 0);
          v_goods_gross := v_recomputed_subtotal + v_line_discount_total;

          IF p_payment_type = 'DP' THEN
            v_cash_dr_amount := COALESCE(p_dp_amount, 0);
            v_remainder      := v_recomputed_total - v_cash_dr_amount;
            IF v_remainder < 0 THEN
              RAISE EXCEPTION 'DP_EXCEEDS_TOTAL: dp=% total=%', v_cash_dr_amount, v_recomputed_total;
            END IF;
          ELSE
            v_cash_dr_amount := v_recomputed_total;
            v_remainder      := 0;
          END IF;

          v_lines := jsonb_build_array(
            jsonb_build_object('account_code', v_cash_coa, 'side', 'DEBIT',
              'amount', v_cash_dr_amount, 'description', 'Kas masuk ' || p_payment_method),
            jsonb_build_object('account_code', v_pendapatan_coa, 'side', 'CREDIT',
              'amount', v_goods_gross, 'description', 'Pendapatan ' || p_channel)
          );

          IF v_ongkir > 0 THEN
            v_lines := v_lines || jsonb_build_array(jsonb_build_object(
              'account_code', '4-1220', 'side', 'CREDIT',
              'amount', v_ongkir, 'description', 'Pendapatan Ongkir ' || p_channel));
          END IF;

          IF v_remainder > 0 THEN
            v_lines := v_lines || jsonb_build_array(jsonb_build_object(
              'account_code', '1-1400', 'side', 'DEBIT',
              'amount', v_remainder,
              'description', 'Piutang DP kasir ' || v_invoice_number));
          END IF;

          IF v_total_discount_rp > 0 THEN
            v_lines := v_lines || jsonb_build_array(jsonb_build_object(
              'account_code', '4-1900', 'side', 'DEBIT',
              'amount', v_total_discount_rp, 'description', 'Diskon penjualan'));
          END IF;

          IF v_kasir.hpp_total IS NOT NULL AND v_kasir.hpp_total > 0 THEN
            v_lines := v_lines || jsonb_build_array(
              jsonb_build_object('account_code', '5-1100', 'side', 'DEBIT',
                'amount', v_kasir.hpp_total, 'description', 'HPP ' || p_channel),
              jsonb_build_object('account_code', '1-1510', 'side', 'CREDIT',
                'amount', v_kasir.hpp_total, 'description', 'Pemakaian persediaan')
            );
          END IF;

          PERFORM public._post_journal_entry(
            p_date, 'KASIR_SALE'::public.journal_entry_source,
            'Penjualan ' || p_channel || COALESCE(' - ' || p_marketplace_order_no, ''),
            v_lines, 'kasir_transactions', v_kasir.id, NULL, NULL);

        EXCEPTION WHEN OTHERS THEN
          INSERT INTO public.gl_dual_write_anomalies (source_rpc, source_ref_table, source_ref_id, error_code, error_message, attempted_payload)
          VALUES ('record_kasir_sale', 'kasir_transactions', v_kasir.id, SQLSTATE, SQLERRM,
            jsonb_build_object('cash_account_id', v_resolved_acct_id, 'cash_coa', v_cash_coa,
              'payment_method', p_payment_method, 'channel', p_channel,
              'total_amount', v_recomputed_total, 'p_date', p_date,
              'hpp_total', v_kasir.hpp_total, 'total_discount_rp', v_total_discount_rp,
              'payment_type', p_payment_type, 'dp_amount', p_dp_amount,
              'ongkir_amount', p_ongkir_amount));
          RAISE WARNING 'GL dual-write failed for kasir_sale %: [%] %',
            v_kasir.id, SQLSTATE, SQLERRM;
        END;
      END IF;
    END IF;
  END;

  RETURN v_kasir;
END;
$function$;
