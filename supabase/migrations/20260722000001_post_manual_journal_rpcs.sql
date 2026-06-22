-- =================================================================
-- Phase 3 Manual Journal Entry RPCs — Task 1
-- 5 SECURITY DEFINER wrappers for owner-initiated manual GL posts
--
-- Key implementation decisions:
--   • _post_journal_entry reads account_code from lines jsonb (not UUID).
--     So _resolve_cash_coa returns account_code text, not UUID.
--   • Prive account = 3-1200 (from seed; brief said 3-3000, seed wins).
--   • verify_owner_pin(BIGINT, TEXT) is approval_requests-coupled; can't
--     reuse for balance adjustment PIN. Inline the crypt() check instead,
--     mirroring PR#34 (email-based Owner lookup, lockout counter).
--   • _assert_owner_active() uses WHERE id = auth.uid() — same as all
--     Phase 0a RPCs (close_accounting_period, set_opening_balance, etc.).
-- =================================================================

BEGIN;

-- -----------------------------------------------------------------------
-- Helper: _resolve_cash_coa
-- Returns the account_code (text) of the linked COA for a cash account.
-- _post_journal_entry reads account_code from lines jsonb, so we return
-- text, not uuid.
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._resolve_cash_coa(p_cash_account_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
-- Helper: _assert_owner_active
-- Raises INSUFFICIENT_ROLE if caller is not an Aktif Owner.
-- Uses id = auth.uid() pattern (consistent with all Phase 0a RPCs).
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._assert_owner_active()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: Tidak terautentikasi';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE id = auth.uid() AND role = 'Owner' AND status = 'Aktif'
  ) THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: Hanya Owner+Aktif yang boleh melakukan tindakan ini';
  END IF;
END $$;

-- -----------------------------------------------------------------------
-- RPC 1: record_internal_transfer
-- Transfer cash between two active cash accounts.
-- source_type = MANUAL_TRANSFER; p_source_subtype distinguishes:
--   'TRANSFER'    → Transfer Internal
--   'CASH_DEPOSIT' → Setor Kas ke Bank
--   'WALLET_TOPUP' → Top-Up Wallet
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_internal_transfer(
  p_from_cash_id  uuid,
  p_to_cash_id    uuid,
  p_amount        numeric,
  p_entry_date    date,
  p_notes         text,
  p_proof_url     text,
  p_source_subtype text DEFAULT 'TRANSFER'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from_code text;
  v_to_code   text;
  v_desc      text;
BEGIN
  PERFORM public._assert_owner_active();

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Jumlah harus lebih dari nol';
  END IF;
  IF p_from_cash_id = p_to_cash_id THEN
    RAISE EXCEPTION 'SAME_ACCOUNT: Akun sumber dan tujuan tidak boleh sama';
  END IF;
  IF p_entry_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_DATE: Tanggal entri diperlukan';
  END IF;

  v_from_code := public._resolve_cash_coa(p_from_cash_id);
  v_to_code   := public._resolve_cash_coa(p_to_cash_id);

  v_desc := CASE p_source_subtype
    WHEN 'CASH_DEPOSIT'  THEN 'Setor Kas ke Bank'
    WHEN 'WALLET_TOPUP'  THEN 'Top-Up Wallet'
    ELSE 'Transfer Internal'
  END;
  IF p_notes IS NOT NULL AND length(trim(p_notes)) > 0 THEN
    v_desc := v_desc || ' — ' || trim(p_notes);
  END IF;

  RETURN public._post_journal_entry(
    p_entry_date,
    'MANUAL_TRANSFER'::public.journal_entry_source,
    v_desc,
    jsonb_build_array(
      jsonb_build_object('account_code', v_to_code,   'side', 'DEBIT',  'amount', p_amount, 'description', p_notes),
      jsonb_build_object('account_code', v_from_code, 'side', 'CREDIT', 'amount', p_amount, 'description', p_notes)
    ),
    NULL, NULL, NULL, NULL
  );
END $$;

GRANT EXECUTE ON FUNCTION public.record_internal_transfer(uuid, uuid, numeric, date, text, text, text) TO authenticated;

-- -----------------------------------------------------------------------
-- RPC 2: record_owner_drawing
-- Owner withdraws cash from a cash account for personal use.
-- Debit: 3-1200 Prive (Owner Drawing); Credit: cash account COA.
-- source_type = OWNER_DRAWING
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_owner_drawing(
  p_from_cash_id  uuid,
  p_amount        numeric,
  p_entry_date    date,
  p_reason        text,
  p_personal_memo text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cash_code  text;
  v_prive_code text := '3-1200';
  v_desc       text;
BEGIN
  PERFORM public._assert_owner_active();

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Jumlah harus lebih dari nol';
  END IF;
  IF p_entry_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_DATE: Tanggal entri diperlukan';
  END IF;

  v_cash_code := public._resolve_cash_coa(p_from_cash_id);

  -- Verify Prive COA exists and is active
  IF NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts
    WHERE account_code = v_prive_code AND is_active = true
  ) THEN
    RAISE EXCEPTION 'COA_NOT_FOUND: Akun Prive (3-1200) tidak ditemukan atau tidak aktif';
  END IF;

  v_desc := 'Prive Owner';
  IF p_reason IS NOT NULL AND length(trim(p_reason)) > 0 THEN
    v_desc := v_desc || ' — ' || trim(p_reason);
  END IF;

  RETURN public._post_journal_entry(
    p_entry_date,
    'OWNER_DRAWING'::public.journal_entry_source,
    v_desc,
    jsonb_build_array(
      jsonb_build_object('account_code', v_prive_code, 'side', 'DEBIT',  'amount', p_amount, 'description', p_reason),
      jsonb_build_object('account_code', v_cash_code,  'side', 'CREDIT', 'amount', p_amount, 'description', p_reason)
    ),
    NULL, NULL, NULL, NULL
  );
END $$;

GRANT EXECUTE ON FUNCTION public.record_owner_drawing(uuid, numeric, date, text, text) TO authenticated;

-- -----------------------------------------------------------------------
-- RPC 3: record_balance_adjustment
-- Manual balance correction. Requires Owner PIN verification.
-- p_direction = 'UP' (cash increases) or 'DOWN' (cash decreases).
-- p_counterpart_coa_id must be PENDAPATAN or BEBAN (active).
-- PIN check is inlined (crypt + email-based lookup per PR#34 pattern).
-- source_type = ADJUSTMENT
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
-- RPC 4: record_wallet_spend
-- Records an e-wallet spend (e.g. Lalamove fee paid from Shopee wallet).
-- p_beban_coa_id must be account_type='BEBAN' AND is_active=true.
-- source_type = WALLET_SPEND
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_wallet_spend(
  p_wallet_cash_id  uuid,
  p_beban_coa_id    uuid,
  p_amount          numeric,
  p_entry_date      date,
  p_order_id        uuid,
  p_notes           text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wallet_code text;
  v_beban_code  text;
  v_beban_type  text;
  v_desc        text;
BEGIN
  PERFORM public._assert_owner_active();

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Jumlah harus lebih dari nol';
  END IF;
  IF p_entry_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_DATE: Tanggal entri diperlukan';
  END IF;

  -- Validate wallet cash account (must be E_WALLET type)
  IF NOT EXISTS (
    SELECT 1 FROM public.cash_accounts
    WHERE id = p_wallet_cash_id AND is_active = true AND account_type = 'E_WALLET'
  ) THEN
    RAISE EXCEPTION 'INVALID_WALLET: Akun kas harus bertipe E_WALLET dan aktif';
  END IF;

  v_wallet_code := public._resolve_cash_coa(p_wallet_cash_id);

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

  v_desc := 'Pengeluaran Wallet';
  IF p_notes IS NOT NULL AND length(trim(p_notes)) > 0 THEN
    v_desc := v_desc || ' — ' || trim(p_notes);
  END IF;

  RETURN public._post_journal_entry(
    p_entry_date,
    'WALLET_SPEND'::public.journal_entry_source,
    v_desc,
    jsonb_build_array(
      jsonb_build_object('account_code', v_beban_code,  'side', 'DEBIT',  'amount', p_amount, 'description', p_notes),
      jsonb_build_object('account_code', v_wallet_code, 'side', 'CREDIT', 'amount', p_amount, 'description', p_notes)
    ),
    NULL, NULL, NULL, NULL
  );
END $$;

GRANT EXECUTE ON FUNCTION public.record_wallet_spend(uuid, uuid, numeric, date, uuid, text) TO authenticated;

-- -----------------------------------------------------------------------
-- RPC 5: record_manual_expense
-- Records a manual expense (e.g. cash paid for electricity bill).
-- p_beban_coa_id must be account_type='BEBAN' AND is_active=true.
-- source_type = KASIR_EXPENSE (reusing existing enum value for manual cash
-- expenses, per brief: "reuse existing enum values, do NOT create new ones")
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
