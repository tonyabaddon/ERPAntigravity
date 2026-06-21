BEGIN;

CREATE OR REPLACE FUNCTION public._validate_journal_entry_balanced(p_entry_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_total_debit numeric;
  v_total_credit numeric;
BEGIN
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE side = 'DEBIT'), 0),
    COALESCE(SUM(amount) FILTER (WHERE side = 'CREDIT'), 0)
  INTO v_total_debit, v_total_credit
  FROM public.journal_entry_lines
  WHERE entry_id = p_entry_id;

  RETURN v_total_debit = v_total_credit AND v_total_debit > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public._check_period_open(
  p_entry_date date,
  p_tenant_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_period_status text;
  v_strict_close boolean;
BEGIN
  SELECT enable_strict_period_close INTO v_strict_close
  FROM public.accounting_config
  WHERE COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LIMIT 1;

  -- Strict mode disabled? Always allow.
  IF NOT COALESCE(v_strict_close, false) THEN
    RETURN true;
  END IF;

  SELECT status INTO v_period_status
  FROM public.accounting_periods
  WHERE COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND period_year = EXTRACT(YEAR FROM p_entry_date)::int
    AND period_month = EXTRACT(MONTH FROM p_entry_date)::int;

  -- Period not initialized → allow (period will be auto-created by _post_journal_entry)
  RETURN COALESCE(v_period_status, 'OPEN') IN ('OPEN', 'REOPENED');
END;
$$;

GRANT EXECUTE ON FUNCTION public._validate_journal_entry_balanced(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public._check_period_open(date, uuid) TO authenticated;

COMMIT;
