-- 20261115000054_piutang_partial_payment.sql
--
-- Session 2 QA finding F-11 (P1): the Piutang → Catat Bayar modal only
-- offers "Konfirmasi Lunas" full-close. B2B tempo customers commonly pay
-- in installments — the AP-side Pembayaran flow (Session 3) already
-- supports partial via `record_pembayaran`, but the AR-side
-- `record_piutang_payment` has no `p_amount` parameter and unconditionally
-- posts the full `orders.total` to GL.
--
-- Fix
-- ===
-- 1. Add `piutang_paid_amount NUMERIC NOT NULL DEFAULT 0` to `orders` to
--    track cumulative partial payments per invoice.
-- 2. Rewrite `record_piutang_payment` with an optional `p_amount` param:
--    * If NULL (backward-compatible with pre-fix callers) → treated as
--      full close: pay `total - piutang_paid_amount` = whatever's still
--      outstanding, and flip to PAYMENT_VERIFIED.
--    * If provided → validate amount > 0 AND amount <= outstanding,
--      accumulate on `piutang_paid_amount`, flip to PAYMENT_VERIFIED only
--      when the invoice is fully paid; otherwise keep it INVOICE_TEMPO so
--      it stays in the Piutang list with reduced sisa.
--    * GL posts the actual paid amount for this call (not the whole
--      order total). Balanced 2-line entry same as before.
-- 3. Backward-compat: the pre-fix Piutang UI still calls the RPC without
--    `p_amount` → gets full-close behaviour, no regression.
--
-- Frontend (separate commit) will surface the new param in the modal
-- with a "Jumlah Bayar" input + "Sisa setelah bayar" preview and update
-- the Piutang list to render outstanding (total - piutang_paid_amount)
-- instead of the raw total.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Track cumulative piutang payments per order.
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS piutang_paid_amount numeric NOT NULL DEFAULT 0,
  ADD CONSTRAINT orders_piutang_paid_nonneg CHECK (piutang_paid_amount >= 0);

COMMENT ON COLUMN public.orders.piutang_paid_amount IS
  'F-11: cumulative amount already collected against this tempo invoice via '
  'record_piutang_payment. When >= total the RPC flips status to '
  'PAYMENT_VERIFIED; while < total the invoice stays INVOICE_TEMPO and '
  'remains visible in the Piutang list with sisa = total - piutang_paid_amount.';

-- ---------------------------------------------------------------------------
-- 2) Rewrite record_piutang_payment with optional p_amount.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_piutang_payment(
  p_order_id             uuid,
  p_cash_account_id      uuid,
  p_proof_url            text,
  p_verified_by_user_id  uuid,
  p_amount               numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order        public.orders%ROWTYPE;
  v_outstanding  numeric;
  v_amount       numeric;
  v_new_paid     numeric;
  v_full_close   boolean;
  v_cash_coa     text;
  v_je_result    jsonb;
  v_je_id        uuid;
  v_dual_write   boolean;
BEGIN
  PERFORM public._guard_expiry_write();

  IF public._current_user_id() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF v_order.status <> 'INVOICE_TEMPO' THEN
    RAISE EXCEPTION 'INVALID_STATE: hanya invoice tempo yang bisa dicatat bayar (status=%)', v_order.status;
  END IF;
  IF v_order.payment_type <> 'TEMPO' THEN
    RAISE EXCEPTION 'NOT_TEMPO_INVOICE';
  END IF;
  IF p_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'CASH_ACCOUNT_REQUIRED: Pilih akun penerima pembayaran';
  END IF;

  v_outstanding := v_order.total - COALESCE(v_order.piutang_paid_amount, 0);

  IF v_outstanding <= 0 THEN
    RAISE EXCEPTION 'ALREADY_FULLY_PAID: outstanding = %', v_outstanding;
  END IF;

  -- Resolve the effective payment amount.
  -- NULL p_amount → full-close (backward compatible with pre-fix callers).
  v_amount := COALESCE(p_amount, v_outstanding);

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: jumlah bayar harus > 0';
  END IF;
  IF v_amount > v_outstanding THEN
    RAISE EXCEPTION 'OVERPAY: jumlah bayar % > sisa outstanding %', v_amount, v_outstanding;
  END IF;

  v_new_paid   := COALESCE(v_order.piutang_paid_amount, 0) + v_amount;
  v_full_close := (v_new_paid >= v_order.total);

  UPDATE public.orders
     SET status              = CASE WHEN v_full_close THEN 'PAYMENT_VERIFIED' ELSE status END,
         piutang_paid_amount = v_new_paid,
         cash_account_id     = p_cash_account_id,
         payment_verified_at = CASE WHEN v_full_close THEN now() ELSE payment_verified_at END,
         verified_by         = CASE WHEN v_full_close THEN p_verified_by_user_id::text ELSE verified_by END,
         full_proof_url      = COALESCE(p_proof_url, full_proof_url)
   WHERE id = p_order_id;

  -- Dual-write (soft-fail) — posts the actual paid amount this call, not
  -- the full order total.
  SELECT enable_dual_write_to_gl INTO v_dual_write
    FROM public.accounting_config
   WHERE tenant_id = public._resolve_tenant_id()
   LIMIT 1;

  IF COALESCE(v_dual_write, false) THEN
    BEGIN
      SELECT coa.account_code INTO v_cash_coa
        FROM public.cash_accounts ca
        JOIN public.chart_of_accounts coa ON coa.id = ca.coa_account_id
       WHERE ca.id = p_cash_account_id
         AND coa.is_active = true;

      IF v_cash_coa IS NULL THEN
        RAISE EXCEPTION 'cash_account % has no active COA link', p_cash_account_id;
      END IF;

      v_je_result := public._post_journal_entry(
        CURRENT_DATE,
        'PIUTANG_PAYMENT'::public.journal_entry_source,
        CASE
          WHEN v_full_close THEN 'Pelunasan piutang ' || p_order_id::text
          ELSE 'Pembayaran parsial piutang ' || p_order_id::text
        END,
        jsonb_build_array(
          jsonb_build_object(
            'account_code', v_cash_coa,
            'side',         'DEBIT',
            'amount',       v_amount,
            'description',  CASE WHEN v_full_close THEN 'Kas masuk pelunasan tempo' ELSE 'Kas masuk parsial tempo' END
          ),
          jsonb_build_object(
            'account_code', '1-1400',
            'side',         'CREDIT',
            'amount',       v_amount,
            'description',  'Piutang Usaha'
          )
        ),
        'orders',
        p_order_id,
        NULL,
        NULL
      );
      v_je_id := (v_je_result->>'entry_id')::uuid;

    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.gl_dual_write_anomalies (
        source_rpc, source_ref_table, source_ref_id,
        error_code, error_message, attempted_payload
      ) VALUES (
        'record_piutang_payment', 'orders', p_order_id,
        SQLSTATE, SQLERRM,
        jsonb_build_object(
          'order_id',        p_order_id,
          'cash_account_id', p_cash_account_id,
          'amount',          v_amount,
          'full_close',      v_full_close
        )
      );
      RAISE WARNING 'GL dual-write failed for piutang_payment %: [%] %',
        p_order_id, SQLSTATE, SQLERRM;
      v_je_id := NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok',                  true,
    'order_id',            p_order_id,
    'je_entry_id',         v_je_id,
    'amount_paid',         v_amount,
    'piutang_paid_amount', v_new_paid,
    'outstanding_after',   v_order.total - v_new_paid,
    'full_close',          v_full_close
  );
END $$;

COMMIT;
