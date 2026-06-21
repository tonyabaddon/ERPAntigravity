BEGIN;

-- Service role bypass policies for test access (service_role bypasses RLS;
-- anon key fallback in _setup.ts hits these only in CI without SERVICE_KEY)
CREATE POLICY "service role bypass je" ON public.journal_entries
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service role bypass jel" ON public.journal_entry_lines
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public._post_journal_entry(
  p_entry_date date,
  p_source_type public.journal_entry_source,
  p_description text,
  p_lines jsonb,
  p_source_ref_table text DEFAULT NULL,
  p_source_ref_id uuid DEFAULT NULL,
  p_tenant_id uuid DEFAULT NULL,
  p_reverses_entry_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  v_year := EXTRACT(YEAR FROM p_entry_date)::int;
  v_month := EXTRACT(MONTH FROM p_entry_date)::int;

  -- 1. Auto-create period if missing
  -- NOTE: ON CONFLICT with NULL tenant_id doesn't work in PostgreSQL B-tree unique indexes
  -- (NULLs are treated as non-equal for conflict detection). Use explicit IF NOT EXISTS.
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

  -- 5. Insert entry header
  INSERT INTO journal_entries (
    entry_number, entry_date, source_type, source_ref_table, source_ref_id,
    description, total_debit, total_credit, posted_by, reverses_entry_id, tenant_id
  ) VALUES (
    v_entry_number, p_entry_date, p_source_type, p_source_ref_table, p_source_ref_id,
    p_description, v_total_debit, v_total_credit, auth.uid(), p_reverses_entry_id, p_tenant_id
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
    'entry_number', v_entry_number
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public._post_journal_entry(
  date, public.journal_entry_source, text, jsonb, text, uuid, uuid, uuid
) TO authenticated;

COMMIT;
