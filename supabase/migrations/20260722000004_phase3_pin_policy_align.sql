-- =================================================================
-- Phase 3 Task 1 Fix Wave 2 — PIN policy alignment + auth.uid() hardening
--
-- Fix 1 (PIN policy):
--   • record_balance_adjustment: align lockout policy to spec/mockup/UI
--     Was: 5 attempts → 1 hour lockout
--     Now: 3 attempts → 10 minute lockout
--     UI already shows "3 salah → akun terkunci 10 menit"; RPC now matches.
--
-- Fix 2 (auth.uid() hardening):
--   • Replace email-based Owner lookup (JOIN auth.users → email match) with
--     direct auth.uid() lookup (WHERE id = auth.uid()), restoring the
--     PR#34 hardening pattern. _assert_owner_active() already validates
--     the caller is Owner+Aktif via auth.uid(), so the lookup is safe.
--   • Drops v_caller_email variable and auth.users JOIN entirely.
-- =================================================================

BEGIN;

-- -----------------------------------------------------------------------
-- RPC 3: record_balance_adjustment  [Fix 1 + Fix 2]
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_balance_adjustment(
  p_cash_account_id   uuid,
  p_direction         text,   -- 'UP' or 'DOWN'
  p_amount            numeric,
  p_counterpart_coa_id uuid,
  p_reason            text,
  p_pin               text,
  p_entry_date        date
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_cash_code        text;
  v_counterpart_code text;
  v_counterpart_type text;
  v_desc             text;
  v_owner            RECORD;
BEGIN
  PERFORM public._assert_owner_active();

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Jumlah harus lebih dari nol';
  END IF;
  IF p_direction NOT IN ('UP', 'DOWN') THEN
    RAISE EXCEPTION 'INVALID_DIRECTION: Arah harus UP atau DOWN';
  END IF;
  IF p_entry_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_DATE: Tanggal entri diperlukan';
  END IF;

  -- C1 fix (from wave 1): reason min-length validation (audit requirement)
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'INVALID_REASON: Alasan koreksi minimal 10 karakter (audit)';
  END IF;

  -- Fix 2: Look up Owner row by auth.uid() (matches _assert_owner_active precondition)
  -- No JOIN to auth.users needed; admin_users.id = auth.uid() is the canonical pattern.
  SELECT id, approval_pin_hash, pin_failed_count, pin_locked_until
    INTO v_owner
    FROM public.admin_users
   WHERE id = auth.uid()
     AND role = 'Owner'
     AND status = 'Aktif'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OWNER_ONLY: Caller bukan Owner aktif';
  END IF;

  IF v_owner.pin_locked_until IS NOT NULL AND v_owner.pin_locked_until > now() THEN
    RAISE EXCEPTION 'PIN_LOCKED: PIN Owner dikunci 10 menit, coba lagi setelah %', v_owner.pin_locked_until;
  END IF;

  IF v_owner.approval_pin_hash IS NULL THEN
    RAISE EXCEPTION 'PIN_NOT_SET: PIN Owner belum dikonfigurasi';
  END IF;

  IF crypt(p_pin, v_owner.approval_pin_hash) = v_owner.approval_pin_hash THEN
    UPDATE public.admin_users
       SET pin_failed_count = 0,
           pin_locked_until = NULL
     WHERE id = v_owner.id;
  ELSE
    -- Fix 1: 3 attempts → 10 minute lockout (was: 5 attempts → 1 hour)
    UPDATE public.admin_users
       SET pin_failed_count = pin_failed_count + 1,
           pin_locked_until = CASE
             WHEN pin_failed_count + 1 >= 3 THEN now() + INTERVAL '10 minutes'
             ELSE pin_locked_until
           END
     WHERE id = v_owner.id;
    RAISE EXCEPTION 'INVALID_PIN: PIN tidak valid';
  END IF;

  -- Validate counterpart COA: must be PENDAPATAN or BEBAN, active
  SELECT account_code, account_type INTO v_counterpart_code, v_counterpart_type
    FROM public.chart_of_accounts
   WHERE id = p_counterpart_coa_id AND is_active = true;

  IF v_counterpart_code IS NULL THEN
    RAISE EXCEPTION 'COA_NOT_FOUND: Akun lawan tidak ditemukan atau tidak aktif';
  END IF;
  IF v_counterpart_type NOT IN ('PENDAPATAN', 'BEBAN') THEN
    RAISE EXCEPTION 'INVALID_COA_TYPE: Akun lawan harus bertipe PENDAPATAN atau BEBAN (dapat: %)', v_counterpart_type;
  END IF;

  v_cash_code := public._resolve_cash_coa(p_cash_account_id);

  v_desc := CASE p_direction
    WHEN 'UP'   THEN 'Koreksi Saldo Naik'
    WHEN 'DOWN' THEN 'Koreksi Saldo Turun'
  END;
  IF p_reason IS NOT NULL AND length(trim(p_reason)) > 0 THEN
    v_desc := v_desc || ' — ' || trim(p_reason);
  END IF;

  -- UP: Debit cash (ASET naik), Credit counterpart
  -- DOWN: Debit counterpart, Credit cash (ASET turun)
  RETURN public._post_journal_entry(
    p_entry_date,
    'ADJUSTMENT'::public.journal_entry_source,
    v_desc,
    CASE p_direction
      WHEN 'UP' THEN jsonb_build_array(
        jsonb_build_object('account_code', v_cash_code,        'side', 'DEBIT',  'amount', p_amount, 'description', p_reason),
        jsonb_build_object('account_code', v_counterpart_code, 'side', 'CREDIT', 'amount', p_amount, 'description', p_reason)
      )
      ELSE jsonb_build_array(
        jsonb_build_object('account_code', v_counterpart_code, 'side', 'DEBIT',  'amount', p_amount, 'description', p_reason),
        jsonb_build_object('account_code', v_cash_code,        'side', 'CREDIT', 'amount', p_amount, 'description', p_reason)
      )
    END,
    NULL, NULL, NULL, NULL
  );
END $$;

GRANT EXECUTE ON FUNCTION public.record_balance_adjustment(uuid, text, numeric, uuid, text, text, date) TO authenticated;

COMMIT;
