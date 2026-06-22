BEGIN;

CREATE OR REPLACE FUNCTION public.close_accounting_period(
  p_year int,
  p_month int,
  p_tenant_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users
    WHERE id = auth.uid() AND role = 'Owner' AND status = 'Aktif'
  ) THEN
    RAISE EXCEPTION 'owner_only';
  END IF;

  UPDATE accounting_periods
  SET status = 'CLOSED',
      closed_at = now(),
      closed_by = auth.uid()
  WHERE COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND period_year = p_year
    AND period_month = p_month
    AND status IN ('OPEN', 'REOPENED');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'period_not_open_or_not_found: year=% month=%', p_year, p_month;
  END IF;

  RETURN jsonb_build_object('ok', true, 'closed_at', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_accounting_period(int, int, uuid) TO authenticated;

COMMIT;
