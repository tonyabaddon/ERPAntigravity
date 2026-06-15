-- supabase/migrations/20260614000011_resolve_tenant_helper.sql
-- Phase 1A: shared helper used by every Piutang/Tempo RPC. Pre-Layer-A,
-- the session GUC app.current_tenant_id is unset and we return the sentinel.
-- Post-Layer-A, Supabase auth hook sets the GUC at request time and this
-- function returns the active tenant. Idempotent contract: never raises.

CREATE OR REPLACE FUNCTION public._resolve_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_setting text;
BEGIN
  v_setting := current_setting('app.current_tenant_id', true);
  IF v_setting IS NULL OR v_setting = '' THEN
    RETURN '00000000-0000-0000-0000-000000000000'::uuid;
  END IF;
  RETURN v_setting::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN '00000000-0000-0000-0000-000000000000'::uuid;
END;
$$;

GRANT EXECUTE ON FUNCTION public._resolve_tenant_id() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public._resolve_tenant_id() IS
  'Returns active tenant_id from session GUC, or sentinel UUID pre-Layer-A. Never raises.';
