BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- _get_platform_dashboard_stats()
-- Returns jsonb KPI snapshot for the platform admin home dashboard.
--
-- Keys returned:
--   tenants_total     INT  — all tenants
--   active_count      INT  — status = 'ACTIVE'
--   suspended_count   INT  — status = 'SUSPENDED'
--   expiring_45d      INT  — tenant_subscriptions expiring in next 45 days
--   plans_count       INT  — rows in plans table
--   pending_imports   INT  — placeholder 0; populated in Wave 3
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._get_platform_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- ── P0403 gate ────────────────────────────────────────────────────────────
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
  END IF;

  SELECT jsonb_build_object(
    'tenants_total',
      (SELECT COUNT(*)::INT FROM public.tenants),
    'active_count',
      (SELECT COUNT(*)::INT FROM public.tenants WHERE status = 'ACTIVE'),
    'suspended_count',
      (SELECT COUNT(*)::INT FROM public.tenants WHERE status = 'SUSPENDED'),
    'expiring_45d',
      (SELECT COUNT(*)::INT
       FROM public.tenant_subscriptions
       WHERE expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '45 days'),
    'plans_count',
      (SELECT COUNT(*)::INT FROM public.plans),
    'pending_imports',
      0   -- Wave 3 populates this
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public._get_platform_dashboard_stats() FROM PUBLIC;
ALTER  FUNCTION public._get_platform_dashboard_stats() OWNER TO vosi_rpc_owner;
GRANT  EXECUTE ON FUNCTION public._get_platform_dashboard_stats() TO authenticated;

COMMENT ON FUNCTION public._get_platform_dashboard_stats() IS
  'category=P; Wave 1 Phase B: platform admin home KPI stats. Returns jsonb with tenants_total, active_count, suspended_count, expiring_45d, plans_count, pending_imports.';

COMMIT;
