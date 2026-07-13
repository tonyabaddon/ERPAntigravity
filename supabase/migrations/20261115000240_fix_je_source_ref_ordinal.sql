-- Slot 240 — W4 fix: allow 1:N journal_entries per source_ref_id via ordinal.
--
-- Problem: uq_je_source_unique is (source_type, source_ref_table, source_ref_id)
-- WHERE source_ref_id IS NOT NULL AND reverses_entry_id IS NULL.
-- This assumes 1:1 (source, JE). But partial-payment scenarios are legitimately
-- 1:N — order X gets paid in installments, each = separate JE. 2nd installment
-- fails 23505.
--
-- Real production evidence (2026-07-03 & 2026-07-11):
--   - 1× _backfill_pi_lunas_payment_gl on pembayaran fb7610e6...
--   - 2× record_piutang_payment on orders 4c3584a7... (partial then full-close)
--
-- Fix: add source_ref_ordinal INT column (default 1). Widen unique index to
-- include ordinal. _post_journal_entry auto-computes next ordinal per
-- (source_type, source_ref_table, source_ref_id) using advisory lock for
-- concurrent-safety.
--
-- Backward-compat:
--   - Existing rows default ordinal=1 (identical to prior implicit "1st").
--   - Existing constraint kept in identity but widened by ordinal column.
--   - All 20+ RPCs calling _post_journal_entry unchanged (ordinal handled inside).
--
-- Idempotent: DROP IF EXISTS + ADD IF NOT EXISTS pattern.

-- Step 1: add source_ref_ordinal column
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS source_ref_ordinal INT NOT NULL DEFAULT 1;

-- Step 2: replace unique index (must include ordinal)
DROP INDEX IF EXISTS public.uq_je_source_unique;

CREATE UNIQUE INDEX uq_je_source_unique
  ON public.journal_entries
  USING btree (source_type, source_ref_table, source_ref_id, source_ref_ordinal)
  WHERE (source_ref_id IS NOT NULL AND reverses_entry_id IS NULL);

-- Step 3: update _post_journal_entry to auto-compute ordinal
CREATE OR REPLACE FUNCTION public._post_journal_entry(
  p_entry_date date,
  p_source_type journal_entry_source,
  p_description text,
  p_lines jsonb,
  p_source_ref_table text DEFAULT NULL::text,
  p_source_ref_id uuid DEFAULT NULL::uuid,
  p_tenant_id uuid DEFAULT NULL::uuid,
  p_reverses_entry_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_entry_id uuid;
  v_entry_number text;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_line jsonb;
  v_line_number int := 0;
  v_account_id uuid;
  v_year int;
  v_month int;
  v_source_ref_ordinal int := 1;
BEGIN
  p_tenant_id := COALESCE(p_tenant_id, public._resolve_tenant_id());
  v_year := EXTRACT(YEAR FROM p_entry_date)::int;
  v_month := EXTRACT(MONTH FROM p_entry_date)::int;

  -- 1. Auto-create period if missing
  IF NOT EXISTS (
    SELECT 1 FROM accounting_periods
    WHERE period_year = v_year
      AND period_month = v_month
      AND COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) THEN
    INSERT INTO accounting_periods (tenant_id, period_year, period_month, status)
    VALUES (p_tenant_id, v_year, v_month, 'OPEN');
  END IF;

  -- 2. Validate period open
  IF NOT _check_period_open(p_entry_date, p_tenant_id) THEN
    RAISE EXCEPTION 'period_closed: cannot post entry to closed period for date %', p_entry_date;
  END IF;

  -- 3. Validate balanced
  SELECT
    COALESCE(SUM(CASE WHEN (l->>'side') = 'DEBIT' THEN (l->>'amount')::numeric ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN (l->>'side') = 'CREDIT' THEN (l->>'amount')::numeric ELSE 0 END), 0)
  INTO v_total_debit, v_total_credit
  FROM jsonb_array_elements(p_lines) AS arr(l);

  IF v_total_debit IS DISTINCT FROM v_total_credit OR v_total_debit <= 0 THEN
    RAISE EXCEPTION 'unbalanced_entry: debit=% credit=%', v_total_debit, v_total_credit;
  END IF;

  -- 3b. W4 fix: compute next source_ref_ordinal (1:N linkage support).
  -- Advisory xact lock serializes concurrent ordinal-computation for same source.
  IF p_source_ref_id IS NOT NULL AND p_reverses_entry_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtext(p_source_ref_id::text || '|' || COALESCE(p_source_ref_table, ''))
    );
    SELECT COALESCE(MAX(source_ref_ordinal), 0) + 1
    INTO v_source_ref_ordinal
    FROM journal_entries
    WHERE source_type = p_source_type
      AND source_ref_table = p_source_ref_table
      AND source_ref_id = p_source_ref_id
      AND reverses_entry_id IS NULL;
  END IF;

  -- 4. Generate entry number
  SELECT 'JE-' || to_char(p_entry_date, 'YYYYMM') || '-' ||
    LPAD((COALESCE(
      (SELECT MAX(NULLIF(SUBSTRING(entry_number FROM 'JE-\d{6}-(\d+)$'), '')::int)
       FROM journal_entries
       WHERE entry_number LIKE 'JE-' || to_char(p_entry_date, 'YYYYMM') || '-%'
         AND COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      ), 0) + 1)::text, 4, '0')
  INTO v_entry_number;

  -- 5. Insert entry header (with ordinal)
  INSERT INTO journal_entries (
    entry_number, entry_date, source_type, source_ref_table, source_ref_id, source_ref_ordinal,
    description, total_debit, total_credit, posted_by, reverses_entry_id, tenant_id
  ) VALUES (
    v_entry_number, p_entry_date, p_source_type, p_source_ref_table, p_source_ref_id, v_source_ref_ordinal,
    p_description, v_total_debit, v_total_credit, public._current_user_id(), p_reverses_entry_id, p_tenant_id
  ) RETURNING id INTO v_entry_id;

  -- 6. Insert lines
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_line_number := v_line_number + 1;

    SELECT id INTO v_account_id FROM chart_of_accounts
    WHERE account_code = (v_line->>'account_code')
      AND COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND is_active = true;

    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'account_not_found: %', (v_line->>'account_code');
    END IF;

    INSERT INTO journal_entry_lines (
      entry_id, line_number, account_id, side, amount, description,
      counterparty_type, counterparty_id, tenant_id
    ) VALUES (
      v_entry_id, v_line_number, v_account_id,
      (v_line->>'side'), (v_line->>'amount')::numeric,
      v_line->>'description',
      v_line->>'counterparty_type',
      NULLIF(v_line->>'counterparty_id', '')::uuid,
      p_tenant_id
    );
  END LOOP;

  -- 7. Link reversal if applicable
  IF p_reverses_entry_id IS NOT NULL THEN
    UPDATE journal_entries
    SET reversed_by_entry_id = v_entry_id
    WHERE id = p_reverses_entry_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'entry_id', v_entry_id,
    'entry_number', v_entry_number,
    'source_ref_ordinal', v_source_ref_ordinal
  );
END;
$function$;

COMMENT ON COLUMN public.journal_entries.source_ref_ordinal IS
  '1-based position of this JE within the (source_type, source_ref_table, source_ref_id) group. Enables 1:N linkage — e.g., partial installment payments on an order each get ordinal 1, 2, 3. Auto-computed by _post_journal_entry with advisory lock for concurrency safety.';
