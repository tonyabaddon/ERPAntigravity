-- 20260723000003 — record_pembayaran: add soft-fail GL dual-write
--
-- CREATE OR REPLACE record_pembayaran(payload jsonb) RETURNS jsonb
-- Existing business logic (v1) is fully preserved. After the kasir_transactions
-- insert, a new inner DECLARE block posts a GL journal entry when
-- accounting_config.enable_dual_write_to_gl = true.
--
-- GL shape (single JE per pembayaran):
--   D  2-1100  Hutang Usaha    total_paid  (sum(items.amount) - discount_amount)
--   K  <cash_coa>              total_paid
--
-- Where total_paid = v_amount_total - COALESCE(payload.discount_amount, 0).
-- This matches kasir_transactions.subtotal already written by the existing body.
--
-- Note: _recompute_tagihan_status reduces purchase_invoices.paid_amount by
-- sum(items.amount) with NO discount deduction — so when discount > 0 the GL
-- Hutang Usaha is debited slightly less than the business-layer AP reduction.
-- Acceptable for Phase 0b observability; revisit in full-accrual Phase 1.
-- TODO Phase 1: add D 2-1100 + K <Diskon Pembelian COA> third line for discounts.
--
-- Soft-fail: all GL errors are caught → anomaly logged to gl_dual_write_anomalies
-- → RAISE WARNING → business RETURN proceeds normally.
--
-- Signature unchanged (payload jsonb → jsonb); no DROP needed.

CREATE OR REPLACE FUNCTION public.record_pembayaran(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_number text;
  v_id uuid;
  v_supplier_id uuid;
  v_amount_total numeric := 0;
  v_item jsonb;
  v_tagihan_id uuid;
  v_tagihan_total numeric;
  v_tagihan_paid numeric;
  v_supplier_name text;
BEGIN
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
    auth.uid()
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
  -- All errors are caught; pembayaran is always returned.
  DECLARE
    v_dual_write    boolean;
    v_account_id    uuid;
    v_cash_coa      text;
    v_total_paid    numeric;
    v_entry_date    date;
  BEGIN
    SELECT enable_dual_write_to_gl
    INTO   v_dual_write
    FROM   public.accounting_config
    WHERE  tenant_id IS NULL
    LIMIT  1;

    IF COALESCE(v_dual_write, false) THEN
      v_account_id := NULLIF(payload->>'account_id', '')::uuid;

      IF v_account_id IS NULL THEN
        -- No cash account in payload → log anomaly, still return business row
        INSERT INTO public.gl_dual_write_anomalies (
          source_rpc, source_ref_table, source_ref_id,
          error_code, error_message, attempted_payload
        ) VALUES (
          'record_pembayaran',
          'pembayaran',
          v_id,
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
          -- Lookup COA code from cash_accounts → chart_of_accounts
          SELECT coa.account_code INTO v_cash_coa
          FROM public.cash_accounts ca
          JOIN public.chart_of_accounts coa ON coa.id = ca.coa_account_id
          WHERE ca.id = v_account_id
            AND coa.is_active = true;

          IF v_cash_coa IS NULL THEN
            RAISE EXCEPTION 'cash_account % has no active COA link', v_account_id;
          END IF;

          v_total_paid := v_amount_total - COALESCE((payload->>'discount_amount')::numeric, 0);
          v_entry_date := COALESCE((payload->>'paid_at')::timestamptz, now())::date;

          PERFORM public._post_journal_entry(
            v_entry_date,
            'PEMBAYARAN'::public.journal_entry_source,
            'Pembayaran ' || v_number || ' — ' || COALESCE(v_supplier_name, ''),
            jsonb_build_array(
              jsonb_build_object(
                'account_code', '2-1100',
                'side',         'DEBIT',
                'amount',       v_total_paid,
                'description',  'Kurangi Hutang Usaha ' || v_number
              ),
              jsonb_build_object(
                'account_code', v_cash_coa,
                'side',         'CREDIT',
                'amount',       v_total_paid,
                'description',  'Kas keluar ' || COALESCE(payload->>'payment_method', '')
              )
            ),
            'pembayaran',
            v_id,
            NULL,  -- tenant_id (single-tenant, NULL)
            NULL   -- reverses_entry_id
          );

        EXCEPTION WHEN OTHERS THEN
          INSERT INTO public.gl_dual_write_anomalies (
            source_rpc, source_ref_table, source_ref_id,
            error_code, error_message, attempted_payload
          ) VALUES (
            'record_pembayaran',
            'pembayaran',
            v_id,
            SQLSTATE,
            SQLERRM,
            jsonb_build_object(
              'account_id',      v_account_id,
              'cash_coa',        v_cash_coa,
              'amount_total',    v_amount_total,
              'discount_amount', COALESCE((payload->>'discount_amount')::numeric, 0),
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

  RETURN jsonb_build_object('pembayaran_number', v_number, 'pembayaran_id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_pembayaran(jsonb) TO authenticated;
