BEGIN;

CREATE OR REPLACE FUNCTION public.set_opening_balance(
  p_balance_date date,
  p_lines jsonb,
  p_tenant_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_already_set boolean;
  v_result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users
    WHERE id = auth.uid() AND role = 'Owner' AND status = 'Aktif'
  ) THEN
    RAISE EXCEPTION 'owner_only';
  END IF;

  SELECT opening_balance_set INTO v_already_set
  FROM accounting_config
  WHERE COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LIMIT 1;

  IF v_already_set THEN
    RAISE EXCEPTION 'opening_balance_already_set';
  END IF;

  v_result := _post_journal_entry(
    p_entry_date := p_balance_date,
    p_source_type := 'OPENING_BALANCE'::journal_entry_source,
    p_description := 'Saldo awal per ' || p_balance_date::text,
    p_lines := p_lines,
    p_tenant_id := p_tenant_id
  );

  UPDATE accounting_config
  SET opening_balance_set = true,
      opening_balance_date = p_balance_date,
      updated_at = now()
  WHERE COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid);

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_opening_balance(date, jsonb, uuid) TO authenticated;

COMMIT;
