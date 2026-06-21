BEGIN;

CREATE OR REPLACE FUNCTION public.accrue_period_taxes(
  p_year int,
  p_month int,
  p_tenant_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config accounting_config;
  v_omzet numeric;
  v_tax numeric;
  v_period_end date;
  v_post_result jsonb;
BEGIN
  SELECT * INTO v_config
  FROM accounting_config
  WHERE COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LIMIT 1;

  IF v_config IS NULL OR NOT v_config.auto_accrue_pph_monthly THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'auto_accrue_disabled_or_no_config');
  END IF;

  -- Compute monthly omzet (sum credit side of all Pendapatan accounts in period, excluding year-end/tax-accrual sources)
  SELECT COALESCE(SUM(jel.amount), 0) INTO v_omzet
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.account_type = 'PENDAPATAN'
    AND jel.side = 'CREDIT'
    AND EXTRACT(YEAR FROM je.entry_date)::int = p_year
    AND EXTRACT(MONTH FROM je.entry_date)::int = p_month
    AND je.is_posted = true
    AND je.source_type NOT IN ('YEAR_END_CLOSE','TAX_ACCRUAL_PPH','TAX_ACCRUAL_PPN')
    AND COALESCE(je.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid);

  v_tax := v_omzet * (COALESCE(v_config.pph_rate_pct, 0.5) / 100);

  IF v_tax <= 0 THEN
    RETURN jsonb_build_object('omzet', v_omzet, 'tax', 0, 'skipped', true);
  END IF;

  v_period_end := (make_date(p_year, p_month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date;

  v_post_result := _post_journal_entry(
    p_entry_date := v_period_end,
    p_source_type := 'TAX_ACCRUAL_PPH'::journal_entry_source,
    p_description := 'PPh Final ' || v_config.pph_rate_pct || '% accrual ' ||
                     to_char(make_date(p_year, p_month, 1), 'Mon YYYY') ||
                     ' (omzet Rp ' || v_omzet || ')',
    p_lines := jsonb_build_array(
      jsonb_build_object('account_code', '5-3300', 'side', 'DEBIT', 'amount', v_tax),
      jsonb_build_object('account_code', '2-1210', 'side', 'CREDIT', 'amount', v_tax)
    ),
    p_tenant_id := p_tenant_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'omzet', v_omzet,
    'tax', v_tax,
    'pph_rate_pct', v_config.pph_rate_pct
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accrue_period_taxes(int, int, uuid) TO authenticated;

COMMIT;
