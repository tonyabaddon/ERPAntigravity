BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- list_tenant_users_admin(p_tenant_id uuid)
-- Returns tenant_users JOIN auth.users for a given tenant.
-- Platform-admin gate (P0403). SECDEF, owned by vosi_rpc_owner.
--
-- Columns returned:
--   user_id         UUID     — auth.users.id
--   email           TEXT     — auth.users.email
--   full_name       TEXT     — raw_user_meta_data->>'full_name' || fallback to email
--   role            TEXT     — tenant_users.role ('owner'|'admin'|'staff'|'kasir')
--   status          TEXT     — tenant_users.status ('ACTIVE'|'DISABLED')
--   last_sign_in_at TIMESTAMPTZ — auth.users.last_sign_in_at
--   created_at      TIMESTAMPTZ — tenant_users.created_at
-- ─────────────────────────────────────────────────────────────────────────────

-- Grant vosi_rpc_owner access to auth schema + auth.users table
-- (verified 2026-07-05: schema_usage=false, table_select=false before this migration)
GRANT USAGE ON SCHEMA auth TO vosi_rpc_owner;
GRANT SELECT ON auth.users TO vosi_rpc_owner;

CREATE OR REPLACE FUNCTION public.list_tenant_users_admin(p_tenant_id uuid)
RETURNS TABLE (
  user_id         UUID,
  email           TEXT,
  full_name       TEXT,
  role            TEXT,
  status          TEXT,
  last_sign_in_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
STABLE
AS $$
BEGIN
  -- ── P0403 gate ─────────────────────────────────────────────────────────────
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
  END IF;

  RETURN QUERY
  SELECT
    tu.user_id,
    u.email::TEXT,
    COALESCE(u.raw_user_meta_data->>'full_name', u.email)::TEXT AS full_name,
    tu.role,
    tu.status,
    u.last_sign_in_at,
    tu.created_at
  FROM public.tenant_users tu
  JOIN auth.users u ON u.id = tu.user_id
  WHERE tu.tenant_id = p_tenant_id
  ORDER BY (tu.role = 'owner') DESC, tu.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_tenant_users_admin(uuid) FROM PUBLIC;
-- NOTE: Owner is set to postgres (not vosi_rpc_owner) in follow-up migration
-- 20261115000005b because vosi_rpc_owner lacks USAGE on schema auth.
-- supabase_admin owns the auth schema; postgres has USAGE but not WITH GRANT
-- OPTION, so it cannot re-grant USAGE to vosi_rpc_owner. The P0403 gate
-- inside the function body provides the required access control.
-- Superseded by 20261115000005b (auth schema USAGE gap).
ALTER  FUNCTION public.list_tenant_users_admin(uuid) OWNER TO vosi_rpc_owner;
GRANT  EXECUTE ON FUNCTION public.list_tenant_users_admin(uuid) TO authenticated;

COMMENT ON FUNCTION public.list_tenant_users_admin(uuid) IS
  'category=P; Wave 1 Phase B Task 12: platform-admin read-only staff list for a tenant. '
  'JOINs tenant_users + auth.users. P0403 gate. SECDEF owned by vosi_rpc_owner.';

COMMIT;
