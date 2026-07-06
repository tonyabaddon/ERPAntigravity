-- 20261115000027 — admin_users: admin_delete_user SD RPC
--
-- Follow-up to 20261115000026. `adminUsersService.remove()` also fails
-- via direct DELETE because the t_delete_own RLS USING predicate
-- `_guard_expiry_write() IS NULL` always evaluates false (guard function
-- RETURNS void; `void IS NULL = false` in Postgres). Silently broken
-- until a user clicks the Trash icon in UserManagementScreen. Routes
-- deletes through a SECDEF RPC using the same OWNER postgres pattern.
--
-- Guards:
--   1. Caller must be authenticated and a member (Owner) of the tenant
--      resolved from JWT.
--   2. Target row must live in the caller's tenant (cross-tenant delete
--      is not allowed even for platform admins via this path).
--   3. Caller cannot delete themselves — prevents self-lockout of the
--      only administrator with UserManagement access.
--   4. Cannot delete the last remaining Owner in the tenant — orphaning
--      a tenant is unrecoverable through the app UI.
--
-- Returns the deleted row so the client can confirm what was removed;
-- returns NULL if no matching row existed (idempotent).

CREATE OR REPLACE FUNCTION public.admin_delete_user(
  p_id  uuid
)
RETURNS public.admin_users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor         uuid := auth.uid();
  v_actor_role    text;
  v_tenant        uuid := public._resolve_tenant_id();
  v_target_ten    uuid;
  v_target_role   text;
  v_owner_count   int;
  v_row           public.admin_users;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'admin_delete_user: requires authenticated caller';
  END IF;
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'admin_delete_user: tenant context missing from JWT';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.admin_users
  WHERE id = v_actor AND tenant_id = v_tenant;
  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'admin_delete_user: caller (%) is not a member of tenant %',
      v_actor, v_tenant;
  END IF;
  IF v_actor_role <> 'Owner' THEN
    RAISE EXCEPTION 'admin_delete_user: Owner role required (caller role=%)',
      v_actor_role;
  END IF;

  IF v_actor = p_id THEN
    RAISE EXCEPTION 'admin_delete_user: cannot delete self (would lock out UserManagement)';
  END IF;

  SELECT tenant_id, role INTO v_target_ten, v_target_role
  FROM public.admin_users WHERE id = p_id;
  IF v_target_ten IS NULL THEN
    -- Row doesn't exist — idempotent no-op.
    RETURN NULL;
  END IF;
  IF v_target_ten <> v_tenant THEN
    RAISE EXCEPTION 'admin_delete_user: id % belongs to another tenant', p_id;
  END IF;

  IF v_target_role = 'Owner' THEN
    SELECT count(*) INTO v_owner_count
    FROM public.admin_users
    WHERE tenant_id = v_tenant AND role = 'Owner';
    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'admin_delete_user: cannot delete last Owner of tenant %',
        v_tenant;
    END IF;
  END IF;

  DELETE FROM public.admin_users
  WHERE id = p_id AND tenant_id = v_tenant
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

ALTER FUNCTION public.admin_delete_user(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;
