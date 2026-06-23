-- supabase/migrations/20260725000001_phase5_gl_recon_rpcs.sql
-- Phase 5 Task 1: GL Recon RPCs
--   - _score_journal_match(bank_line_id, journal_line_id)  → 0.0–1.0 numeric
--   - match_journal_to_bank_line(bank_line_id, journal_entry_line_ids[], match_reason)
--   - auto_match_journal_lines_to_bank(bank_account_id, period_year, period_month)
--
-- Schema facts verified before writing:
--   bank_statement_lines: txn_date (NOT date), amount > 0 always, direction IN/OUT,
--                         lane CHECK IN ('GREEN','YELLOW','ORANGE','RED','GRAY') default 'GRAY',
--                         matched_at timestamptz, matched_by uuid, match_confidence numeric(3,2)
--   journal_entry_lines:  amount > 0 always, side IN ('DEBIT','CREDIT'),
--                         bank_line_id uuid (nullable FK), reconciled_at timestamptz
--   bank_statement_lines.bank_account_id → bank_accounts.id  (separate from cash_accounts)
--   cash_accounts.coa_account_id → chart_of_accounts.id      (no direct FK to bank_accounts)
--   Auto-match COA filter: account_subtype='BANK' (single-tenant, one BANK COA entry)
--   Direction↔side: IN→DEBIT, OUT→CREDIT

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────────
-- Helper: _score_journal_match
-- Returns 0.0–1.0 composite score.
--   amount_score (weight 0.7): 1.0 if exact, linear decay to 0 at ±5% divergence
--   date_score   (weight 0.3): 1.0 same day, 0.75 ±1d, 0.5 ±2d, 0.25 ±3d, 0 beyond
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._score_journal_match(
  p_bank_line_id      uuid,
  p_journal_line_id   uuid
) RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_bsl       record;
  v_jel       record;
  v_je        record;
  v_pct_diff  numeric;
  v_day_diff  int;
  v_amount_score numeric;
  v_date_score   numeric;
BEGIN
  SELECT txn_date, amount INTO v_bsl
  FROM bank_statement_lines WHERE id = p_bank_line_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT amount, entry_id INTO v_jel
  FROM journal_entry_lines WHERE id = p_journal_line_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT entry_date INTO v_je
  FROM journal_entries WHERE id = v_jel.entry_id;

  -- Amount score: linear from 1.0 at 0% diff to 0.0 at 5% diff
  v_pct_diff := abs(v_jel.amount - v_bsl.amount) / NULLIF(v_bsl.amount, 0);
  v_amount_score := GREATEST(0, 1.0 - (v_pct_diff / 0.05));

  -- Date score: step function
  v_day_diff := abs(v_je.entry_date - v_bsl.txn_date);
  v_date_score := CASE
    WHEN v_day_diff = 0 THEN 1.00
    WHEN v_day_diff = 1 THEN 0.75
    WHEN v_day_diff = 2 THEN 0.50
    WHEN v_day_diff = 3 THEN 0.25
    ELSE 0.00
  END;

  RETURN round((v_amount_score * 0.7) + (v_date_score * 0.3), 4);
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- RPC 1: match_journal_to_bank_line
-- Manually links one or more journal_entry_lines to a bank_statement_line.
-- Validates:
--   - bank_line exists
--   - journal line ids non-empty
--   - direction↔side compatibility (IN→DEBIT, OUT→CREDIT) for all lines
--   - sum of JE amounts ≤ bank line amount (overflow check; partial allocation allowed)
-- Updates:
--   - journal_entry_lines: bank_line_id, reconciled_at (idempotent — skips already matched)
--   - bank_statement_lines: lane='GREEN', match_reason, matched_at, matched_by, match_confidence=1.0
-- Returns: {ok, matched_count, total_amount_matched}
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_journal_to_bank_line(
  p_bank_line_id            uuid,
  p_journal_entry_line_ids  uuid[],
  p_match_reason            text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_bank_line         record;
  v_total_je_amount   numeric := 0;
  v_matched_count     int;
  v_expected_side     text;
  v_wrong_side_count  int;
BEGIN
  PERFORM _assert_owner_active();

  IF array_length(p_journal_entry_line_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'EMPTY_JOURNAL_LINES: minimal 1 journal entry line diperlukan';
  END IF;

  SELECT * INTO v_bank_line
  FROM bank_statement_lines WHERE id = p_bank_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BANK_LINE_NOT_FOUND: bank_statement_line % tidak ada', p_bank_line_id;
  END IF;

  -- Direction → expected JE side
  v_expected_side := CASE v_bank_line.direction WHEN 'IN' THEN 'DEBIT' ELSE 'CREDIT' END;

  -- Validate all supplied JE lines have correct side
  SELECT count(*) INTO v_wrong_side_count
  FROM journal_entry_lines
  WHERE id = ANY(p_journal_entry_line_ids)
    AND side <> v_expected_side;

  IF v_wrong_side_count > 0 THEN
    RAISE EXCEPTION 'SIDE_MISMATCH: % journal line(s) tidak cocok direction bank (% → harus side %)',
      v_wrong_side_count, v_bank_line.direction, v_expected_side;
  END IF;

  -- Sum amounts of supplied journal lines
  SELECT COALESCE(sum(amount), 0) INTO v_total_je_amount
  FROM journal_entry_lines
  WHERE id = ANY(p_journal_entry_line_ids);

  -- Overflow check: JE total must not exceed bank line amount
  IF v_total_je_amount > v_bank_line.amount + 0.01 THEN
    RAISE EXCEPTION 'AMOUNT_OVERFLOW: total journal lines (%) melebihi bank line amount (%)',
      v_total_je_amount, v_bank_line.amount;
  END IF;

  -- UPDATE matched journal lines (idempotent: skip already-matched lines)
  UPDATE journal_entry_lines
  SET bank_line_id   = p_bank_line_id,
      reconciled_at  = now()
  WHERE id = ANY(p_journal_entry_line_ids)
    AND bank_line_id IS NULL;

  GET DIAGNOSTICS v_matched_count = ROW_COUNT;

  -- Update bank_statement_line to GREEN + audit fields
  UPDATE bank_statement_lines
  SET lane             = 'GREEN',
      match_reason     = COALESCE(p_match_reason, 'manual_gl_match'),
      match_confidence = 1.00,
      matched_at       = now(),
      matched_by       = auth.uid()
  WHERE id = p_bank_line_id;

  RETURN jsonb_build_object(
    'ok',                   true,
    'matched_count',        v_matched_count,
    'total_amount_matched', v_total_je_amount
  );
END $$;

GRANT EXECUTE ON FUNCTION public.match_journal_to_bank_line(uuid, uuid[], text) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- RPC 2: auto_match_journal_lines_to_bank
-- For each unmatched bank_statement_line in the given period:
--   1. Find candidate journal_entry_lines on BANK-subtype accounts
--      with matching direction↔side, date within ±3 days, amount within ±5%
--   2. Score each candidate via _score_journal_match (computed once in subquery)
--   3. Auto-link if best score ≥ 0.95; otherwise leave for manual review
-- Returns: {auto_matched, candidates_pending_manual}
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_match_journal_lines_to_bank(
  p_bank_account_id  uuid,
  p_period_year      int,
  p_period_month     int
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_bank_line         record;
  v_best_je_id        uuid;
  v_best_score        numeric;
  v_auto_matched      int := 0;
  v_pending_manual    int := 0;
  v_period_start      date := make_date(p_period_year, p_period_month, 1);
  v_period_end        date := (make_date(p_period_year, p_period_month, 1) + interval '1 month' - interval '1 day')::date;
  v_expected_side     text;
BEGIN
  PERFORM _assert_owner_active();

  -- Iterate over unmatched bank lines in period
  FOR v_bank_line IN
    SELECT bsl.*
    FROM bank_statement_lines bsl
    WHERE bsl.bank_account_id = p_bank_account_id
      AND bsl.txn_date BETWEEN v_period_start AND v_period_end
      AND NOT EXISTS (
        SELECT 1 FROM journal_entry_lines jel
        WHERE jel.bank_line_id = bsl.id
      )
    ORDER BY bsl.txn_date
  LOOP
    -- Direction → expected JE side (IN cash received → DEBIT bank; OUT payment → CREDIT bank)
    v_expected_side := CASE v_bank_line.direction WHEN 'IN' THEN 'DEBIT' ELSE 'CREDIT' END;

    -- Find best-scoring unmatched candidate (score computed once in subquery)
    SELECT scored.je_id, scored.score
    INTO v_best_je_id, v_best_score
    FROM (
      SELECT
        jel.id AS je_id,
        _score_journal_match(v_bank_line.id, jel.id) AS score
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      JOIN chart_of_accounts coa ON coa.id = jel.account_id
      WHERE coa.account_subtype = 'BANK'
        AND coa.is_active = true
        AND jel.side = v_expected_side
        AND jel.bank_line_id IS NULL
        AND je.entry_date BETWEEN v_bank_line.txn_date - 3 AND v_bank_line.txn_date + 3
        AND abs(jel.amount - v_bank_line.amount) <= v_bank_line.amount * 0.05
    ) scored
    ORDER BY scored.score DESC
    LIMIT 1;

    IF v_best_je_id IS NOT NULL AND v_best_score >= 0.95 THEN
      -- Auto-link via match_journal_to_bank_line (handles lane + audit fields)
      PERFORM match_journal_to_bank_line(
        v_bank_line.id,
        ARRAY[v_best_je_id]::uuid[],
        'auto_match_score_' || round(v_best_score, 4)::text
      );
      v_auto_matched := v_auto_matched + 1;
    ELSE
      v_pending_manual := v_pending_manual + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'auto_matched',               v_auto_matched,
    'candidates_pending_manual',  v_pending_manual
  );
END $$;

GRANT EXECUTE ON FUNCTION public.auto_match_journal_lines_to_bank(uuid, int, int) TO authenticated;

COMMIT;
