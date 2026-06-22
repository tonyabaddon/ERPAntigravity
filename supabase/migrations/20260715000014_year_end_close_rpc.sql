BEGIN;

CREATE OR REPLACE FUNCTION public.close_fiscal_year(
  p_year int,
  p_tenant_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fiscal_end date;
  v_pendapatan_lines jsonb := '[]'::jsonb;
  v_beban_lines jsonb := '[]'::jsonb;
  v_total_pendapatan numeric := 0;
  v_total_beban numeric := 0;
  v_net_income numeric;
  v_prive_balance numeric := 0;
  v_acc record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users
    WHERE id = auth.uid() AND role = 'Owner' AND status = 'Aktif'
  ) THEN
    RAISE EXCEPTION 'owner_only';
  END IF;

  v_fiscal_end := make_date(p_year, 12, 31);

  -- Step 1: Build Pendapatan close (D 4-XXXX, K 3-1900)
  FOR v_acc IN
    SELECT coa.account_code, ABS(tb.balance) AS bal
    FROM trial_balance tb
    JOIN chart_of_accounts coa ON coa.id = tb.account_id
    WHERE coa.account_type = 'PENDAPATAN' AND tb.balance <> 0
      AND COALESCE(tb.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LOOP
    v_pendapatan_lines := v_pendapatan_lines ||
      jsonb_build_object('account_code', v_acc.account_code, 'side', 'DEBIT', 'amount', v_acc.bal);
    v_total_pendapatan := v_total_pendapatan + v_acc.bal;
  END LOOP;

  IF v_total_pendapatan > 0 THEN
    v_pendapatan_lines := v_pendapatan_lines ||
      jsonb_build_object('account_code', '3-1900', 'side', 'CREDIT', 'amount', v_total_pendapatan);
    PERFORM _post_journal_entry(
      p_entry_date := v_fiscal_end,
      p_source_type := 'YEAR_END_CLOSE'::journal_entry_source,
      p_description := 'Year-end: close Pendapatan ke Ikhtisar Laba Rugi (FY ' || p_year || ')',
      p_lines := v_pendapatan_lines,
      p_tenant_id := p_tenant_id
    );
  END IF;

  -- Step 2: Build Beban close (D 3-1900, K 5-XXXX)
  FOR v_acc IN
    SELECT coa.account_code, ABS(tb.balance) AS bal
    FROM trial_balance tb
    JOIN chart_of_accounts coa ON coa.id = tb.account_id
    WHERE coa.account_type = 'BEBAN' AND tb.balance <> 0
      AND COALESCE(tb.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LOOP
    v_beban_lines := v_beban_lines ||
      jsonb_build_object('account_code', v_acc.account_code, 'side', 'CREDIT', 'amount', v_acc.bal);
    v_total_beban := v_total_beban + v_acc.bal;
  END LOOP;

  IF v_total_beban > 0 THEN
    v_beban_lines := jsonb_build_array(
      jsonb_build_object('account_code', '3-1900', 'side', 'DEBIT', 'amount', v_total_beban)
    ) || v_beban_lines;
    PERFORM _post_journal_entry(
      p_entry_date := v_fiscal_end,
      p_source_type := 'YEAR_END_CLOSE'::journal_entry_source,
      p_description := 'Year-end: close Beban ke Ikhtisar Laba Rugi (FY ' || p_year || ')',
      p_lines := v_beban_lines,
      p_tenant_id := p_tenant_id
    );
  END IF;

  -- Step 3: Close Ikhtisar Laba Rugi (Net Income) ke Laba Ditahan
  v_net_income := v_total_pendapatan - v_total_beban;

  IF v_net_income > 0 THEN
    PERFORM _post_journal_entry(
      p_entry_date := v_fiscal_end,
      p_source_type := 'YEAR_END_CLOSE'::journal_entry_source,
      p_description := 'Year-end: close Net Income ke Laba Ditahan (FY ' || p_year || ')',
      p_lines := jsonb_build_array(
        jsonb_build_object('account_code', '3-1900', 'side', 'DEBIT', 'amount', v_net_income),
        jsonb_build_object('account_code', '3-1300', 'side', 'CREDIT', 'amount', v_net_income)
      ),
      p_tenant_id := p_tenant_id
    );
  ELSIF v_net_income < 0 THEN
    PERFORM _post_journal_entry(
      p_entry_date := v_fiscal_end,
      p_source_type := 'YEAR_END_CLOSE'::journal_entry_source,
      p_description := 'Year-end: close Net Loss ke Laba Ditahan (FY ' || p_year || ')',
      p_lines := jsonb_build_array(
        jsonb_build_object('account_code', '3-1300', 'side', 'DEBIT', 'amount', ABS(v_net_income)),
        jsonb_build_object('account_code', '3-1900', 'side', 'CREDIT', 'amount', ABS(v_net_income))
      ),
      p_tenant_id := p_tenant_id
    );
  END IF;

  -- Step 4: Close Prive ke Laba Ditahan
  SELECT ABS(balance) INTO v_prive_balance
  FROM trial_balance tb
  JOIN chart_of_accounts coa ON coa.id = tb.account_id
  WHERE coa.account_code = '3-1200'
    AND COALESCE(tb.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF v_prive_balance > 0 THEN
    PERFORM _post_journal_entry(
      p_entry_date := v_fiscal_end,
      p_source_type := 'YEAR_END_CLOSE'::journal_entry_source,
      p_description := 'Year-end: close Prive ke Laba Ditahan (FY ' || p_year || ')',
      p_lines := jsonb_build_array(
        jsonb_build_object('account_code', '3-1300', 'side', 'DEBIT', 'amount', v_prive_balance),
        jsonb_build_object('account_code', '3-1200', 'side', 'CREDIT', 'amount', v_prive_balance)
      ),
      p_tenant_id := p_tenant_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'fiscal_year', p_year,
    'total_pendapatan', v_total_pendapatan,
    'total_beban', v_total_beban,
    'net_income', v_net_income,
    'prive_closed', v_prive_balance
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_fiscal_year(int, uuid) TO authenticated;

COMMIT;
