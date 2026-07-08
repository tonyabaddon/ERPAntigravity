-- Task #56 fix: tenant_users RLS self-recursion (42P17).
--
-- Original policies a_self_or_tenant_admin + a_admin_write contained
-- `EXISTS (SELECT 1 FROM tenant_users me WHERE ...)` — self-reference that
-- triggered infinite recursion the moment tenant_users RLS was applied
-- under security_invoker mode (e.g. when a view joining tenant_users had
-- security_invoker=true, or when a non-admin user did a direct SELECT).
--
-- Fix: extract the membership check into a SECURITY DEFINER helper. The
-- helper reads tenant_users bypassing RLS (safe because it's a scoped
-- boolean lookup — no rows are returned to the caller). Policies now
-- delegate to this helper, breaking the recursion.
--
-- Bonus: v_tenant_usage_summary can now be flipped to security_invoker=true
-- (it was the sole leftover public view without invoker mode per 000028).

CREATE OR REPLACE FUNCTION public._is_tenant_admin(p_tenant_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM tenant_users
    WHERE tenant_id = p_tenant_id
      AND user_id = p_user_id
      AND role = ANY (ARRAY['owner', 'admin'])
  );
$function$;

ALTER FUNCTION public._is_tenant_admin(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._is_tenant_admin(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._is_tenant_admin(uuid, uuid) TO authenticated, vosi_rpc_owner;

COMMENT ON FUNCTION public._is_tenant_admin IS
  'Boolean check: is p_user_id an owner/admin of p_tenant_id in tenant_users? SECDEF to bypass RLS and avoid the tenant_users self-recursion. Used in tenant_users a_* policies to replace the recursive EXISTS subquery.';

-- Rewrite the two recursive policies to call the helper.
DROP POLICY IF EXISTS a_self_or_tenant_admin ON public.tenant_users;
CREATE POLICY a_self_or_tenant_admin ON public.tenant_users
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (tenant_id = public._resolve_tenant_id()
        AND public._is_tenant_admin(tenant_id, auth.uid()))
  );

DROP POLICY IF EXISTS a_admin_write ON public.tenant_users;
CREATE POLICY a_admin_write ON public.tenant_users
  FOR ALL
  TO authenticated
  USING (
    tenant_id = public._resolve_tenant_id()
    AND public._is_tenant_admin(tenant_id, auth.uid())
  )
  WITH CHECK (tenant_id = public._resolve_tenant_id());

-- Now safe to enforce RLS on v_tenant_usage_summary via security_invoker.
-- Previously excluded from migration 20261115000028 due to this recursion.
ALTER VIEW public.v_tenant_usage_summary SET (security_invoker = true);
