-- 20260723000002 — record_kasir_sale: add p_cash_account_id param + soft-fail GL dual-write
--
-- Extends the canonical 21-param record_kasir_sale with a 22nd optional param:
--   p_cash_account_id uuid DEFAULT NULL
--
-- When accounting_config.enable_dual_write_to_gl = true, after inserting the
-- kasir_transaction row, posts a KASIR_SALE journal entry via _post_journal_entry.
--
-- Cash account resolution order:
--   1. p_cash_account_id (explicit picker selection)
--   2. accounting_config.default_{payment_method}_account_id
--   3. If nothing resolved → anomaly logged, business row succeeds
--
-- Pendapatan COA mapping (kasir_channel enum, lowercase):
--   walkin                                    → 4-1110
--   tokopedia, shopee, lazada, blibli,
--   bukalapak, ralali, bhinneka               → 4-1120
--   grosir                                    → 4-1130
--   sales, expo, whatsapp, instagram, website → 4-1110 (default)
--
-- All GL errors are caught: anomaly logged to gl_dual_write_anomalies, RAISE WARNING,
-- kasir_transaction RETURN proceeds normally (soft-fail).
--
-- Note: Postgres treats adding a parameter as a NEW signature even with DEFAULT.
-- Must DROP the 21-param function first, then CREATE with 22 params.

-- Helper: resolve pendapatan COA code from channel
CREATE OR REPLACE FUNCTION public._resolve_kasir_pendapatan_coa(p_channel text)
RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE p_channel
    WHEN 'walkin'    THEN '4-1110'
    WHEN 'grosir'    THEN '4-1130'
    WHEN 'tokopedia' THEN '4-1120'
    WHEN 'shopee'    THEN '4-1120'
    WHEN 'lazada'    THEN '4-1120'
    WHEN 'blibli'    THEN '4-1120'
    WHEN 'bukalapak' THEN '4-1120'
    WHEN 'ralali'    THEN '4-1120'
    WHEN 'bhinneka'  THEN '4-1120'
    ELSE '4-1110'   -- sales, expo, whatsapp, instagram, website → walkin revenue default
  END;
$$;

-- Drop the canonical 21-param function (adding a param requires new signature)
DROP FUNCTION IF EXISTS public.record_kasir_sale(
  date, text, jsonb, numeric, text, text, text, numeric, text,
  numeric, text, numeric, text, text, text, text, text, text, text, text, boolean
);

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
  p_allow_negative_stock  boolean DEFAULT false,
  p_cash_account_id       uuid    DEFAULT NULL
)
RETURNS public.kasir_transactions
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
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
      v_item_out := v_item || jsonb_build_object(
        'hpp_per_unit', v_hpp_per_unit,
        'hpp_subtotal', v_hpp_subtotal
      );
    END IF;
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

  -- ── GL Dual-write (soft-fail) ──────────────────────────────────────────────
  -- All errors are caught; kasir_transaction is always returned.
  DECLARE
    v_dual_write        boolean;
    v_default_kas       uuid;
    v_default_bank      uuid;
    v_default_qris      uuid;
    v_default_edc       uuid;
    v_resolved_acct_id  uuid;
    v_cash_coa          text;
    v_pendapatan_coa    text;
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
      -- Resolve cash account: explicit picker > payment_method default
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
        -- No cash account resolved — log anomaly, still return business row
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
            'total_amount',    p_total_amount,
            'p_date',          p_date
          )
        );
        RAISE WARNING 'GL dual-write skipped for kasir_sale %: no cash account resolved (payment_method=%)',
          v_kasir.id, p_payment_method;
      ELSE
        BEGIN
          -- Lookup COA code from cash_accounts → chart_of_accounts
          SELECT coa.account_code INTO v_cash_coa
          FROM public.cash_accounts ca
          JOIN public.chart_of_accounts coa ON coa.id = ca.coa_account_id
          WHERE ca.id = v_resolved_acct_id
            AND coa.is_active = true;

          IF v_cash_coa IS NULL THEN
            RAISE EXCEPTION 'cash_account % has no active COA link', v_resolved_acct_id;
          END IF;

          v_pendapatan_coa := public._resolve_kasir_pendapatan_coa(p_channel);

          PERFORM public._post_journal_entry(
            p_date,
            'KASIR_SALE'::public.journal_entry_source,
            'Penjualan ' || p_channel || COALESCE(' · ' || p_marketplace_order_no, ''),
            jsonb_build_array(
              jsonb_build_object(
                'account_code', v_cash_coa,
                'side',         'DEBIT',
                'amount',       p_total_amount,
                'description',  'Kas masuk ' || p_payment_method
              ),
              jsonb_build_object(
                'account_code', v_pendapatan_coa,
                'side',         'CREDIT',
                'amount',       p_total_amount,
                'description',  'Pendapatan ' || p_channel
              )
            ),
            'kasir_transactions',
            v_kasir.id,
            NULL,  -- tenant_id (single-tenant, NULL)
            NULL   -- reverses_entry_id
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
              'total_amount',    p_total_amount,
              'p_date',          p_date
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
  date, text, jsonb, numeric, text, text, text, numeric, text,
  numeric, text, numeric, text, text, text, text, text, text, text, text, boolean, uuid
) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public._resolve_kasir_pendapatan_coa(text)
  TO anon, authenticated;
