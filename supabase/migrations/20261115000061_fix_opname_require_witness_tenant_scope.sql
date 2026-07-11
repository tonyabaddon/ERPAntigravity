-- 20261115000061_fix_opname_require_witness_tenant_scope.sql
--
-- P0 bugfix: `_opname_require_witness()` selects from a nonexistent `id`
-- column on `company_settings`, which broke `start_opname_session` (users
-- clicked "Mulai Sesi Opname Baru" and got 42703 column "id" does not exist).
--
-- History: helper was written when company_settings was single-row (had a
-- surrogate `id` column). Multi-tenant refactor swapped that for `tenant_id`
-- but this helper wasn't updated.
--
-- Fix: tenant-scope the lookup. Fallback default remains TRUE (MSME-safe
-- opt-in for the two-person opname flow) if no row exists yet for the tenant.

BEGIN;

CREATE OR REPLACE FUNCTION public._opname_require_witness()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_val boolean;
BEGIN
  SELECT opname_require_witness INTO v_val
  FROM company_settings
  WHERE tenant_id = public._resolve_tenant_id()
  LIMIT 1;
  RETURN COALESCE(v_val, TRUE);
END $$;

ALTER FUNCTION public._opname_require_witness() OWNER TO postgres;
REVOKE ALL ON FUNCTION public._opname_require_witness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._opname_require_witness() TO authenticated, vosi_rpc_owner;

COMMIT;
