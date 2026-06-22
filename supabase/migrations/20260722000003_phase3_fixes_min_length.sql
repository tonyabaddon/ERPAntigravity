-- =================================================================
-- Phase 3 Task 1 Fix Wave 1 — Review findings C1 + I3
--
-- C1 (Critical, spec violation):
--   • record_balance_adjustment: add p_reason min-length check (≥10 chars)
--   • record_manual_expense: add p_description min-length check (≥3 chars)
--
-- I3 (Important, code quality):
--   • _resolve_cash_coa: change STABLE → VOLATILE (reads mutable
--     cash_accounts table; STABLE is semantically incorrect)
--
-- Deployed as CREATE OR REPLACE to preserve migration history.
-- =================================================================

BEGIN;

-- -----------------------------------------------------------------------
-- Helper: _resolve_cash_coa  [I3 fix: STABLE → VOLATILE]
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._resolve_cash_coa(p_cash_account_id uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text;
BEGIN
  SELECT coa.account_code INTO v_code
  FROM public.cash_accounts ca
  JOIN public.chart_of_accounts coa ON coa.id = ca.coa_account_id
  WHERE ca.id = p_cash_account_id AND ca.is_active = true AND coa.is_active = true;

  IF v_code IS NULL THEN
    RAISE EXCEPTION 'CASH_ACCOUNT_NOT_FOUND: Akun kas % tidak ditemukan atau tidak aktif', p_cash_account_id;
  END IF;
  RETURN v_code;
END $$;

-- -----------------------------------------------------------------------
-- RPC 3: record_balance_adjustment  [C1 fix: add p_reason min-length check]
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
  v_caller           uuid;
  v_caller_email     text;
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

  -- C1 fix: reason min-length validation (audit requirement)
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'INVALID_REASON: Alasan koreksi minimal 10 karakter (audit)';
  END IF;

  -- PIN verification (inlined from verify_owner_pin PR#34 pattern)
  v_caller := auth.uid();
  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller;
  IF v_caller_email IS NULL OR v_caller_email = '' THEN
    RAISE EXCEPTION 'OWNER_ONLY: Caller tidak memiliki email auth';
  END IF;

  SELECT id, approval_pin_hash, pin_failed_count, pin_locked_until
    INTO v_owner
    FROM public.admin_users
   WHERE lower(email) = lower(v_caller_email)
     AND role = 'Owner'
     AND status = 'Aktif'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OWNER_ONLY: Caller bukan Owner aktif';
  END IF;

  IF v_owner.pin_locked_until IS NOT NULL AND v_owner.pin_locked_until > now() THEN
    RAISE EXCEPTION 'PIN_LOCKED: PIN Owner dikunci hingga %', v_owner.pin_locked_until;
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
    UPDATE public.admin_users
       SET pin_failed_count = pin_failed_count + 1,
           pin_locked_until = CASE
             WHEN pin_failed_count + 1 >= 5 THEN now() + INTERVAL '1 hour'
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

-- -----------------------------------------------------------------------
-- RPC 5: record_manual_expense  [C1 fix: add p_description min-length check]
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_manual_expense(
  p_beban_coa_id   uuid,
  p_source_cash_id uuid,
  p_amount         numeric,
  p_entry_date     date,
  p_description    text,
  p_proof_url      text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cash_code  text;
  v_beban_code text;
  v_beban_type text;
  v_desc       text;
BEGIN
  PERFORM public._assert_owner_active();

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Jumlah harus lebih dari nol';
  END IF;
  IF p_entry_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_DATE: Tanggal entri diperlukan';
  END IF;

  v_cash_code := public._resolve_cash_coa(p_source_cash_id);

  -- C1 fix: description min-length validation
  IF p_description IS NULL OR length(trim(p_description)) < 3 THEN
    RAISE EXCEPTION 'INVALID_DESCRIPTION: Deskripsi minimal 3 karakter';
  END IF;

  -- Validate beban COA
  SELECT account_code, account_type INTO v_beban_code, v_beban_type
    FROM public.chart_of_accounts
   WHERE id = p_beban_coa_id AND is_active = true;

  IF v_beban_code IS NULL THEN
    RAISE EXCEPTION 'COA_NOT_FOUND: Akun beban tidak ditemukan atau tidak aktif';
  END IF;
  IF v_beban_type <> 'BEBAN' THEN
    RAISE EXCEPTION 'INVALID_COA_TYPE: Akun beban harus bertipe BEBAN (dapat: %)', v_beban_type;
  END IF;

  v_desc := 'Beban Manual';
  IF p_description IS NOT NULL AND length(trim(p_description)) > 0 THEN
    v_desc := v_desc || ' — ' || trim(p_description);
  END IF;

  RETURN public._post_journal_entry(
    p_entry_date,
    'KASIR_EXPENSE'::public.journal_entry_source,
    v_desc,
    jsonb_build_array(
      jsonb_build_object('account_code', v_beban_code, 'side', 'DEBIT',  'amount', p_amount, 'description', p_description),
      jsonb_build_object('account_code', v_cash_code,  'side', 'CREDIT', 'amount', p_amount, 'description', p_description)
    ),
    NULL, NULL, NULL, NULL
  );
END $$;

GRANT EXECUTE ON FUNCTION public.record_manual_expense(uuid, uuid, numeric, date, text, text) TO authenticated;

COMMIT;
