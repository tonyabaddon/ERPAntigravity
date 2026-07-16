-- Migration 315: Add p_idempotency_key to record_pembayaran.
--
-- Adds idempotency short-circuit at function start and stores result at end.
-- New parameter is DEFAULT NULL — fully backward compatible with existing callers.
-- Existing function body is preserved verbatim from slot 239.
--
-- NOTE on initiate_warehouse_transfer (originally planned for slot 315/316 in
-- the Task 9 brief): that RPC already has a purpose-built idempotency mechanism
-- via p_client_request_id (checks warehouse_transfers.client_request_id, returns
-- {transfer_id, doc_no, idempotent: true} on replay). Adding t_rpc_idempotency
-- wrapping on top would create two overlapping sources of truth. Decision:
-- leave initiate_warehouse_transfer with its existing mechanism — it covers
-- network-retry, timeout-retry, and double-submit for all known callers.
-- Revisit only if a gap emerges (e.g., a caller that doesn't pass client_request_id).
--
-- Adding `p_idempotency_key uuid DEFAULT NULL` after the existing `payload jsonb`
-- param creates a new overload (jsonb, uuid) alongside the old (jsonb) — same
-- pattern as receive_purchase_order in slots 312/314. We GRANT both overloads
-- in this migration (no separate fix-migration needed).
--
-- Changes vs slot 239:
--   1. Adds `SET search_path = public` (slot 239 omitted it).
--   2. Extracts v_tenant_id at function start (needed for idempotency lookup).
--   3. Wraps body with idempotency short-circuit at top and store-on-success at bottom.
--   4. Stores result_json = {pembayaran_number, pembayaran_id} on success.

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

-- Grant both overloads (old 1-arg and new 2-arg) to all consumers.
-- Pattern matches slot 314 (receive_purchase_order overload grant fix).
GRANT EXECUTE ON FUNCTION public.record_pembayaran(jsonb)
  TO authenticated, service_role, vosi_rpc_owner;

GRANT EXECUTE ON FUNCTION public.record_pembayaran(jsonb, uuid)
  TO authenticated, service_role, vosi_rpc_owner;
