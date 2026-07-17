-- P2-C Round 2 — Migration 325: Audit instrumentation for kasir/tempo/pembayaran
--
-- Item 2: Drop submit_rakit_lock (dead function).
--   submit_rakit_lock was defined in 20260608000009_rakit_workflow_rpcs.sql and
--   then DROPPED in 20260609000010_rakit_workflow_revision.sql (both 4-arg and 3-arg
--   overloads). By the time of this migration the function no longer exists on DB.
--   These DROP IF EXISTS statements are idempotent no-ops that document the intent
--   and protect against any accidental re-creation.
--   Resolution: DEAD CODE DROP (not shim) — no FE caller was found in src/. The
--   LockSubmissionModal.tsx comment at line 179 is a code comment about the old
--   warehouse text format; actual FE calls requestRakitLock / approveAndAmendRakitLock.
DROP FUNCTION IF EXISTS public.submit_rakit_lock(uuid, jsonb, uuid, text);
DROP FUNCTION IF EXISTS public.submit_rakit_lock(uuid, jsonb, uuid);
DROP FUNCTION IF EXISTS public.submit_rakit_lock(uuid, jsonb);

-- Item 3: Add audit INSERT to record_kasir_sale (slot 311 body, preserved verbatim).
-- Audit block is placed AFTER the GL dual-write block and BEFORE idempotency store.
-- Audit failure is caught and demoted to WARNING — it does NOT roll back the sale.
-- Return type (kasir_transactions), argument list, and GRANTs are unchanged.

CREATE OR REPLACE FUNCTION public.record_kasir_sale(
  p_date date,
  p_channel text,
  p_items jsonb,
  p_subtotal numeric,
  p_payment_method text,
  p_payment_subtype text,
  p_payment_type text,
  p_dp_amount numeric,
  p_dp_input_type text,
  p_ongkir_amount numeric,
  p_notes text,
  p_total_amount numeric,
  p_customer_name text,
  p_customer_phone text,
  p_customer_company text,
  p_delivery_address text,
  p_marketplace_order_no text,
  p_wa_phone text,
  p_wa_chat_url text,
  p_customer_id text,
  p_discount_type text DEFAULT NULL::text,
  p_discount_value numeric DEFAULT NULL::numeric,
  p_discount_amount_rp numeric DEFAULT 0,
  p_cash_account_id uuid DEFAULT NULL::uuid,
  p_allow_negative_stock boolean DEFAULT false,
  p_idempotency_key uuid DEFAULT NULL::uuid
) RETURNS kasir_transactions
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id           uuid := public._resolve_tenant_id();
  v_existing            jsonb;
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
  -- ── Idempotency check ──────────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT result_json INTO v_existing
    FROM public.t_rpc_idempotency
    WHERE tenant_id       = v_tenant_id
      AND rpc_name        = 'record_kasir_sale'
      AND idempotency_key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN
      -- Replay: return the original kasir_transactions row.
      SELECT * INTO v_kasir
      FROM public.kasir_transactions
      WHERE id = (v_existing->>'id')::uuid;
      RETURN v_kasir;
    END IF;
  END IF;

  -- ── Original body (unchanged from slot 237) ────────────────────────────────
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

  -- ── P2-C Audit INSERT (soft-fail) ─────────────────────────────────────────
  -- Placed after GL dual-write and before idempotency store.
  -- Failure demoted to WARNING — does NOT roll back the committed sale.
  BEGIN
    INSERT INTO public.audit_log (event_type, tenant_id, actor_user_id, payload)
    VALUES (
      'kasir_sale_recorded',
      v_tenant_id,
      auth.uid(),
      jsonb_build_object(
        'transaction_id',   v_kasir.id,
        'invoice_number',   v_invoice_number,
        'total_amount',     v_recomputed_total,
        'channel',          p_channel,
        'payment_type',     p_payment_type,
        'payment_method',   p_payment_method,
        'customer_id',      v_customer_id,
        'item_count',       jsonb_array_length(p_items)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'audit_log insert failed for kasir_sale %: %', v_kasir.id, SQLERRM;
  END;

  -- ── Store idempotency result ────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.t_rpc_idempotency (tenant_id, rpc_name, idempotency_key, result_json)
    VALUES (v_tenant_id, 'record_kasir_sale', p_idempotency_key,
            jsonb_build_object('id', v_kasir.id))
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_kasir;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.record_kasir_sale(
  date, text, jsonb, numeric, text, text, text, numeric, text,
  numeric, text, numeric, text, text, text, text, text, text, text, text,
  text, numeric, numeric, uuid, boolean, uuid
) TO authenticated, service_role, vosi_rpc_owner;

-- ─────────────────────────────────────────────────────────────────────────────
-- Item 4: Add audit INSERT to create_tempo_invoice (slot 20260901000006 body).
-- Audit block placed after INSERT INTO orders RETURNING v_order_id, before RETURN.
-- RETURNS uuid — unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_tempo_invoice(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- ── P2-C addition ─────────────────────────────────────────────────────────
  v_tenant_id           uuid := public._resolve_tenant_id();
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

  -- ── P2-C Audit INSERT (soft-fail) ─────────────────────────────────────────
  -- Placed after INSERT INTO orders, before RETURN.
  -- Failure demoted to WARNING — does NOT roll back the committed order.
  BEGIN
    INSERT INTO public.audit_log (event_type, tenant_id, actor_user_id, payload)
    VALUES (
      'tempo_invoice_created',
      v_tenant_id,
      auth.uid(),
      jsonb_build_object(
        'order_id',             v_order_id,
        'customer_id',          p_payload->>'customer_id',
        'total',                v_total,
        'channel',              COALESCE(p_payload->>'channel', 'walkin'),
        'discount_type',        v_order_discount_type,
        'discount_amount_rp',   v_order_discount_amt,
        'item_count',           jsonb_array_length(v_items_jsonb)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'audit_log insert failed for tempo_invoice %: %', v_order_id, SQLERRM;
  END;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_tempo_invoice(jsonb) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Item 5: Add audit INSERT to record_pembayaran (slot 315 body, preserved verbatim).
-- Audit block placed after GL dual-write DECLARE...END block, before idempotency store.
-- Both overloads (jsonb) and (jsonb, uuid) preserved via GRANT.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_pembayaran(
  payload jsonb,
  p_idempotency_key uuid DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id     uuid := public._resolve_tenant_id();
  v_existing_idem jsonb;
  v_number        text;
  v_id            uuid;
  v_supplier_id   uuid;
  v_amount_total  numeric := 0;
  v_item          jsonb;
  v_tagihan_id    uuid;
  v_tagihan_total numeric;
  v_tagihan_paid  numeric;
  v_supplier_name text;
BEGIN
  -- ── Idempotency check ──────────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT result_json INTO v_existing_idem
    FROM public.t_rpc_idempotency
    WHERE tenant_id       = v_tenant_id
      AND rpc_name        = 'record_pembayaran'
      AND idempotency_key = p_idempotency_key;
    IF v_existing_idem IS NOT NULL THEN
      -- Replay: return the original result directly.
      RETURN v_existing_idem;
    END IF;
  END IF;

  -- ── Original body (unchanged from slot 239) ────────────────────────────────
  PERFORM public._guard_expiry_write();
  v_supplier_id := (payload->>'supplier_id')::uuid;
  IF v_supplier_id IS NULL THEN RAISE EXCEPTION 'supplier_id required'; END IF;
  IF jsonb_array_length(COALESCE(payload->'items','[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'items required'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_amount_total := v_amount_total + (v_item->>'amount')::numeric;
    v_tagihan_id := NULLIF(v_item->>'tagihan_id','')::uuid;
    IF v_tagihan_id IS NOT NULL THEN
      SELECT total, paid_amount INTO v_tagihan_total, v_tagihan_paid
      FROM public.purchase_invoices WHERE id = v_tagihan_id FOR UPDATE;
      IF v_tagihan_paid + (v_item->>'amount')::numeric > v_tagihan_total + 0.01 THEN
        RAISE EXCEPTION 'Tagihan % overpayment (current paid % + new % > total %)',
          v_tagihan_id, v_tagihan_paid, (v_item->>'amount')::numeric, v_tagihan_total;
      END IF;
    END IF;
  END LOOP;

  v_number := public.generate_pembayaran_number();
  INSERT INTO public.pembayaran (
    pembayaran_number, supplier_id, paid_at, payment_method,
    account_id, account_label, amount_total, discount_amount, proof_url, notes, created_by_user_id
  ) VALUES (
    v_number, v_supplier_id,
    COALESCE((payload->>'paid_at')::timestamptz, now()),
    payload->>'payment_method',
    NULLIF(payload->>'account_id','')::uuid,
    payload->>'account_label',
    v_amount_total,
    COALESCE((payload->>'discount_amount')::numeric, 0),
    payload->>'proof_url',
    payload->>'notes',
    public._current_user_id()
  ) RETURNING id INTO v_id;

  INSERT INTO public.pembayaran_items (pembayaran_id, tagihan_id, tukar_faktur_id, amount)
  SELECT v_id,
    NULLIF(item->>'tagihan_id','')::uuid,
    NULLIF(item->>'tukar_faktur_id','')::uuid,
    (item->>'amount')::numeric
  FROM jsonb_array_elements(payload->'items') item;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_tagihan_id := NULLIF(v_item->>'tagihan_id','')::uuid;
    IF v_tagihan_id IS NOT NULL THEN
      PERFORM public._recompute_tagihan_status(v_tagihan_id);
    END IF;
  END LOOP;

  SELECT name INTO v_supplier_name FROM public.suppliers WHERE id = v_supplier_id;
  INSERT INTO public.kasir_transactions (type, date, expense_category, description, subtotal, hpp_total)
  VALUES (
    'expense',
    (now() AT TIME ZONE 'Asia/Jakarta')::date,
    'Pembelian Stok',
    'Pembayaran ' || v_number || ' — ' || COALESCE(v_supplier_name,''),
    v_amount_total - COALESCE((payload->>'discount_amount')::numeric, 0),
    0
  );

  -- ── GL Dual-write (soft-fail) ──────────────────────────────────────────────
  DECLARE
    v_dual_write    boolean;
    v_account_id    uuid;
    v_cash_coa      text;
    v_discount      numeric;
    v_cash_out      numeric;
    v_je_lines      jsonb;
    v_entry_date    date;
  BEGIN
    SELECT enable_dual_write_to_gl
    INTO   v_dual_write
    FROM public.accounting_config WHERE tenant_id = public._resolve_tenant_id() LIMIT 1;

    IF COALESCE(v_dual_write, false) THEN
      v_account_id := NULLIF(payload->>'account_id', '')::uuid;

      IF v_account_id IS NULL THEN
        INSERT INTO public.gl_dual_write_anomalies (
          source_rpc, source_ref_table, source_ref_id,
          error_code, error_message, attempted_payload
        ) VALUES (
          'record_pembayaran', 'pembayaran', v_id,
          'NO_CASH_ACCOUNT',
          'GL dual-write skipped: account_id missing from payload',
          jsonb_build_object(
            'pembayaran_number', v_number,
            'amount_total',      v_amount_total,
            'discount_amount',   COALESCE((payload->>'discount_amount')::numeric, 0)
          )
        );
        RAISE WARNING 'GL dual-write skipped for pembayaran %: account_id missing from payload',
          v_id;
      ELSE
        BEGIN
          SELECT coa.account_code INTO v_cash_coa
          FROM public.cash_accounts ca
          JOIN public.chart_of_accounts coa ON coa.id = ca.coa_account_id
          WHERE ca.id = v_account_id AND coa.is_active = true;

          IF v_cash_coa IS NULL THEN
            RAISE EXCEPTION 'cash_account % has no active COA link', v_account_id;
          END IF;

          v_discount   := COALESCE((payload->>'discount_amount')::numeric, 0);
          v_cash_out   := v_amount_total - v_discount;
          v_entry_date := COALESCE((payload->>'paid_at')::timestamptz, now())::date;

          -- W3 fix: DR full hutang, CR cash out, CR 5-1900 for early-pay discount.
          v_je_lines := jsonb_build_array(
            jsonb_build_object(
              'account_code', '2-1100',
              'side',         'DEBIT',
              'amount',       v_amount_total,
              'description',  'Kurangi Hutang Usaha ' || v_number
            ),
            jsonb_build_object(
              'account_code', v_cash_coa,
              'side',         'CREDIT',
              'amount',       v_cash_out,
              'description',  'Kas keluar ' || COALESCE(payload->>'payment_method', '')
            )
          );

          IF v_discount > 0 THEN
            v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
              'account_code', '5-1900',
              'side',         'CREDIT',
              'amount',       v_discount,
              'description',  'Diskon Pembelian ' || v_number
            ));
          END IF;

          PERFORM public._post_journal_entry(
            v_entry_date,
            'PEMBAYARAN'::public.journal_entry_source,
            'Pembayaran ' || v_number || ' — ' || COALESCE(v_supplier_name, ''),
            v_je_lines,
            'pembayaran', v_id,
            NULL, NULL
          );

        EXCEPTION WHEN OTHERS THEN
          INSERT INTO public.gl_dual_write_anomalies (
            source_rpc, source_ref_table, source_ref_id,
            error_code, error_message, attempted_payload
          ) VALUES (
            'record_pembayaran', 'pembayaran', v_id,
            SQLSTATE, SQLERRM,
            jsonb_build_object(
              'account_id',      v_account_id,
              'cash_coa',        v_cash_coa,
              'amount_total',    v_amount_total,
              'discount_amount', v_discount,
              'cash_out',        v_cash_out,
              'pembayaran_number', v_number
            )
          );
          RAISE WARNING 'GL dual-write failed for pembayaran %: [%] %',
            v_id, SQLSTATE, SQLERRM;
        END;
      END IF;
    END IF;
  END;
  -- ── End GL Dual-write ──────────────────────────────────────────────────────

  -- ── P2-C Audit INSERT (soft-fail) ─────────────────────────────────────────
  -- Placed after GL dual-write, before idempotency store.
  -- Failure demoted to WARNING — does NOT roll back the committed pembayaran.
  -- Tagihan IDs aggregated as array since pembayaran is many-to-many.
  BEGIN
    INSERT INTO public.audit_log (event_type, tenant_id, actor_user_id, payload)
    VALUES (
      'pembayaran_recorded',
      v_tenant_id,
      auth.uid(),
      jsonb_build_object(
        'pembayaran_id',     v_id,
        'pembayaran_number', v_number,
        'supplier_id',       v_supplier_id,
        'amount_total',      v_amount_total,
        'payment_method',    payload->>'payment_method',
        'account_id',        NULLIF(payload->>'account_id', ''),
        'tagihan_ids',       (
          SELECT jsonb_agg(NULLIF(item->>'tagihan_id', ''))
          FROM jsonb_array_elements(payload->'items') item
        )
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'audit_log insert failed for pembayaran %: %', v_id, SQLERRM;
  END;

  -- ── Store idempotency result ────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.t_rpc_idempotency (tenant_id, rpc_name, idempotency_key, result_json)
    VALUES (v_tenant_id, 'record_pembayaran', p_idempotency_key,
            jsonb_build_object('pembayaran_number', v_number, 'pembayaran_id', v_id))
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object('pembayaran_number', v_number, 'pembayaran_id', v_id);
END;
$function$;

-- Grant only 2-arg overload — 1-arg was dropped in migration 317.
GRANT EXECUTE ON FUNCTION public.record_pembayaran(jsonb, uuid)
  TO authenticated, service_role, vosi_rpc_owner;
