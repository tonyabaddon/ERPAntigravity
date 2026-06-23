-- 20260801000004 — record_kasir_sale: add diskon (3 params + JSONB shape + journal line)
--
-- Tambah 3 params (discount_type, discount_value, discount_amount_rp) sebelum
-- p_cash_account_id. p_items JSONB sekarang expect per-line discount fields
-- (master_price_at_sale, discount_*). Server recompute subtotal + total_amount.
-- Markup ditolak. Journal kontra 4-1900 di-append ke _post_journal_entry call
-- dengan penyesuaian balance: D cash + D 4-1900 = C pendapatan (gross).
--
-- ────────────────────────────────────────────────────────────────────────────
-- CAPTURED ORIGINAL BODY (rollback reference — actual signature was
--   ..., p_allow_negative_stock boolean DEFAULT false, p_cash_account_id uuid DEFAULT NULL
--   i.e. the boolean came BEFORE uuid in the live function):
--
-- CREATE OR REPLACE FUNCTION public.record_kasir_sale(
--   p_date date, p_channel text, p_items jsonb, p_subtotal numeric,
--   p_payment_method text, p_payment_subtype text, p_payment_type text,
--   p_dp_amount numeric, p_dp_input_type text, p_ongkir_amount numeric,
--   p_notes text, p_total_amount numeric, p_customer_name text,
--   p_customer_phone text, p_customer_company text, p_delivery_address text,
--   p_marketplace_order_no text, p_wa_phone text, p_wa_chat_url text,
--   p_customer_id text,
--   p_allow_negative_stock boolean DEFAULT false,
--   p_cash_account_id uuid DEFAULT NULL::uuid
-- )
-- [full body — see migration 20260724000001_phase0c_kasir_hpp_extension.sql]
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Drop old 22-param signature (actual live order: ..., boolean, uuid)
DROP FUNCTION IF EXISTS public.record_kasir_sale(
  date, text, jsonb, numeric, text, text, text, numeric, text, numeric,
  text, numeric, text, text, text, text, text, text, text, text, boolean, uuid
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
  p_discount_type         TEXT    DEFAULT NULL,
  p_discount_value        NUMERIC DEFAULT NULL,
  p_discount_amount_rp    NUMERIC DEFAULT 0,
  p_cash_account_id       UUID    DEFAULT NULL,
  p_allow_negative_stock  BOOLEAN DEFAULT FALSE
) RETURNS public.kasir_transactions
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
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

  -- ── Discount triple-consistency (NEW) ──────────────────────────────────────
  IF (p_discount_type IS NULL) <> (p_discount_value IS NULL) THEN
    RAISE EXCEPTION 'DISCOUNT_TRIPLE_INVALID: type and value must both be NULL or both set';
  END IF;
  IF COALESCE(p_discount_amount_rp, 0) < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_DISCOUNT';
  END IF;

  -- ── Per-line validation + recompute subtotal (NEW) ─────────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    v_unit_price       := COALESCE((v_item->>'unit_price')::numeric, 0);
    v_qty              := COALESCE((v_item->>'qty')::int, 1);
    v_line_discount_amt := COALESCE((v_item->>'discount_amount_rp')::numeric, 0);
    -- master_price_at_sale falls back to unit_price when not provided (no-discount legacy items)
    v_master_price     := COALESCE((v_item->>'master_price_at_sale')::numeric, v_unit_price);

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

  -- ── Build items_out with HPP (existing) ───────────────────────────────────
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
    v_recomputed_subtotal,   -- server-recomputed, not client p_subtotal
    v_hpp_total,
    p_payment_method::public.kasir_payment_method,
    p_payment_subtype,
    p_payment_type,
    COALESCE(p_dp_amount, 0),
    p_dp_input_type,
    COALESCE(p_ongkir_amount, 0),
    p_notes,
    v_recomputed_total,      -- server-recomputed, not client p_total_amount
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
  -- Phase 0c: extended to post HPP recognition lines when hpp_total > 0.
  -- Diskon: when v_total_discount_rp > 0, append D 4-1900 + increase C pendapatan
  --   to gross so the JE balances: D cash + D 4-1900 = C pendapatan (gross).
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
            'total_amount',    v_recomputed_total,
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

          -- Gross revenue = net collected + discounts given
          -- JE: D cash = v_recomputed_total
          --     D 4-1900 = v_total_discount_rp  (when > 0)
          --     C pendapatan = gross_revenue
          -- This keeps the entry balanced.
          v_gross_revenue := v_recomputed_total + v_total_discount_rp;

          -- Phase 0c + diskon: build JE lines
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

          -- Append discount contra line (D 4-1900) when discount was applied
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

          -- HPP recognition lines (Phase 0c)
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

COMMIT;
