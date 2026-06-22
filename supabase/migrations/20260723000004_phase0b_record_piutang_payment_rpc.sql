-- 20260723000004 — record_piutang_payment: NEW RPC to replace direct UPDATE pattern
--
-- Previously, markTempoInvoicePaid in piutangService.ts performed a direct
-- UPDATE on the orders table (no RPC). This RPC centralises the payment
-- verification logic and adds soft-fail GL dual-write.
--
-- When accounting_config.enable_dual_write_to_gl = true, posts:
--   D  <cash_coa>  (from cash_accounts → chart_of_accounts)
--   K  1-1400      (Piutang Usaha)
--
-- All GL errors are caught: anomaly logged to gl_dual_write_anomalies,
-- RAISE WARNING, business UPDATE proceeds normally (soft-fail).
--
-- SECURITY DEFINER so auth.uid() is available for the auth check.
-- GRANT EXECUTE TO authenticated — callers must be logged in.

CREATE OR REPLACE FUNCTION public.record_piutang_payment(
  p_order_id           uuid,
  p_cash_account_id    uuid,
  p_proof_url          text,
  p_verified_by_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order      public.orders%ROWTYPE;
  v_cash_coa   text;
  v_je_result  jsonb;
  v_je_id      uuid;
  v_dual_write boolean;
BEGIN
  -- 1. Auth check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  -- 2. Load order with row-level lock
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  -- 3. Validate state — only open tempo invoices may be marked paid
  IF v_order.status != 'INVOICE_TEMPO' THEN
    RAISE EXCEPTION 'INVALID_STATE: hanya invoice tempo yang bisa dicatat lunas (status=%)', v_order.status;
  END IF;
  IF v_order.payment_type != 'TEMPO' THEN
    RAISE EXCEPTION 'NOT_TEMPO_INVOICE';
  END IF;

  -- 4. Require cash account (mandatory for GL bookkeeping even if dual-write off)
  IF p_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'CASH_ACCOUNT_REQUIRED: Pilih akun penerima pembayaran';
  END IF;

  -- 5. UPDATE orders row
  UPDATE orders
  SET status             = 'PAYMENT_VERIFIED',
      cash_account_id    = p_cash_account_id,
      payment_verified_at = now(),
      verified_by        = p_verified_by_user_id::text,
      full_proof_url     = COALESCE(p_proof_url, full_proof_url)
  WHERE id = p_order_id;

  -- 6. Dual-write to GL (soft-fail — business UPDATE already committed above)
  SELECT enable_dual_write_to_gl INTO v_dual_write
  FROM accounting_config
  WHERE tenant_id IS NULL
  LIMIT 1;

  IF COALESCE(v_dual_write, false) THEN
    BEGIN
      -- Lookup COA code from cash_accounts → chart_of_accounts
      SELECT coa.account_code INTO v_cash_coa
      FROM cash_accounts ca
      JOIN chart_of_accounts coa ON coa.id = ca.coa_account_id
      WHERE ca.id = p_cash_account_id
        AND coa.is_active = true;

      IF v_cash_coa IS NULL THEN
        RAISE EXCEPTION 'cash_account % has no active COA link', p_cash_account_id;
      END IF;

      v_je_result := public._post_journal_entry(
        CURRENT_DATE,
        'PIUTANG_PAYMENT'::public.journal_entry_source,
        'Pelunasan piutang ' || p_order_id::text,
        jsonb_build_array(
          jsonb_build_object(
            'account_code', v_cash_coa,
            'side',         'DEBIT',
            'amount',       v_order.total,
            'description',  'Kas masuk pelunasan tempo'
          ),
          jsonb_build_object(
            'account_code', '1-1400',
            'side',         'CREDIT',
            'amount',       v_order.total,
            'description',  'Piutang Usaha'
          )
        ),
        'orders',
        p_order_id,
        NULL,   -- tenant_id (single-tenant, NULL)
        NULL    -- reverses_entry_id
      );
      v_je_id := (v_je_result->>'entry_id')::uuid;

    EXCEPTION WHEN OTHERS THEN
      INSERT INTO gl_dual_write_anomalies (
        source_rpc, source_ref_table, source_ref_id,
        error_code, error_message, attempted_payload
      ) VALUES (
        'record_piutang_payment',
        'orders',
        p_order_id,
        SQLSTATE,
        SQLERRM,
        jsonb_build_object(
          'order_id',        p_order_id,
          'cash_account_id', p_cash_account_id,
          'amount',          v_order.total
        )
      );
      RAISE WARNING 'GL dual-write failed for piutang_payment %: [%] %',
        p_order_id, SQLSTATE, SQLERRM;
      v_je_id := NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok',         true,
    'order_id',   p_order_id,
    'je_entry_id', v_je_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_piutang_payment(uuid, uuid, text, uuid) TO authenticated;
