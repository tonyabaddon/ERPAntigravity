-- Scheduler-safe variant of backfill_tenant_cost_daily.
-- The original RPC requires is_platform_admin() which returns false when
-- called from Cloud Run Job as service_role (no auth.uid). This variant
-- skips the auth check but is REVOKEd from all client roles so only
-- service_role (bypassing RLS + grants) can invoke.
--
-- Migration slot 329.

CREATE OR REPLACE FUNCTION public.scheduler_backfill_tenant_cost_daily(p_date date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_rows_upserted int;
BEGIN
  WITH tenant_storage AS (
    SELECT
      (regexp_matches(name, '^tenants/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/'))[1]::uuid AS tenant_id,
      COALESCE(SUM((metadata->>'size')::bigint), 0) AS storage_bytes
    FROM storage.objects
    WHERE name ~ '^tenants/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    GROUP BY 1
  )
  INSERT INTO public.t_tenant_cost_daily (tenant_id, usage_date, storage_bytes, updated_at)
  SELECT tenant_id, p_date, storage_bytes, now()
  FROM tenant_storage
  WHERE tenant_id IS NOT NULL
  ON CONFLICT (tenant_id, usage_date) DO UPDATE
    SET storage_bytes = EXCLUDED.storage_bytes,
        updated_at    = now();

  GET DIAGNOSTICS v_rows_upserted = ROW_COUNT;
  RAISE LOG 'scheduler_backfill_tenant_cost_daily: date=% rows_upserted=%', p_date, v_rows_upserted;

  RETURN jsonb_build_object('ok', true, 'date', p_date, 'rows_upserted', v_rows_upserted);
END;
$$;

-- Owner MUST be postgres (not vosi_rpc_owner) so the SECDEF body can read
-- storage.objects. vosi_rpc_owner has no privileges on the storage schema.
ALTER FUNCTION public.scheduler_backfill_tenant_cost_daily(date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.scheduler_backfill_tenant_cost_daily(date) FROM PUBLIC, anon, authenticated;
-- service_role only
