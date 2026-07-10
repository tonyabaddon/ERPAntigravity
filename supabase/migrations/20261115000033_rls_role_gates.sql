-- Migration: 20261115000033_rls_role_gates.sql
-- Wave 6 Task 2: Split platform_admin_only RLS policies on tenants + tenant_subscriptions
--   so sales_rep can SELECT but only super_admin can INSERT/UPDATE/DELETE.
--
-- plans.g_read_all is already USING (true) TO authenticated,vosi_rpc_owner — NOT touched (Note A).
--
-- All new policies use TO authenticated, vosi_rpc_owner to preserve SECDEF RPC access
-- (SECDEF RPCs owned by vosi_rpc_owner require explicit role in TO clause — Note C / Phase A gap).

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- TABLE: tenants
-- ────────────────────────────────────────────────────────────────────────────

-- Drop the old catch-all policy (FOR ALL, both roles, both gate functions)
DROP POLICY IF EXISTS p_platform_admin_only ON public.tenants;

-- SELECT: both sales_rep and super_admin can read tenant rows
CREATE POLICY p_platform_admin_select ON public.tenants
  FOR SELECT
  TO authenticated, vosi_rpc_owner
  USING (public._is_platform_admin_from_jwt());

-- INSERT: super_admin only
CREATE POLICY p_super_admin_write ON public.tenants
  FOR INSERT
  TO authenticated, vosi_rpc_owner
  WITH CHECK (public._is_super_admin_from_jwt());

-- UPDATE: super_admin only
CREATE POLICY p_super_admin_update ON public.tenants
  FOR UPDATE
  TO authenticated, vosi_rpc_owner
  USING (public._is_super_admin_from_jwt())
  WITH CHECK (public._is_super_admin_from_jwt());

-- DELETE: super_admin only
CREATE POLICY p_super_admin_delete ON public.tenants
  FOR DELETE
  TO authenticated, vosi_rpc_owner
  USING (public._is_super_admin_from_jwt());

-- ────────────────────────────────────────────────────────────────────────────
-- TABLE: tenant_subscriptions
-- ────────────────────────────────────────────────────────────────────────────

-- Drop the old catch-all policy
DROP POLICY IF EXISTS p_platform_admin_only ON public.tenant_subscriptions;

-- SELECT: both sales_rep and super_admin can read subscription rows
CREATE POLICY p_platform_admin_select ON public.tenant_subscriptions
  FOR SELECT
  TO authenticated, vosi_rpc_owner
  USING (public._is_platform_admin_from_jwt());

-- INSERT: super_admin only
CREATE POLICY p_super_admin_write ON public.tenant_subscriptions
  FOR INSERT
  TO authenticated, vosi_rpc_owner
  WITH CHECK (public._is_super_admin_from_jwt());

-- UPDATE: super_admin only
CREATE POLICY p_super_admin_update ON public.tenant_subscriptions
  FOR UPDATE
  TO authenticated, vosi_rpc_owner
  USING (public._is_super_admin_from_jwt())
  WITH CHECK (public._is_super_admin_from_jwt());

-- DELETE: super_admin only
CREATE POLICY p_super_admin_delete ON public.tenant_subscriptions
  FOR DELETE
  TO authenticated, vosi_rpc_owner
  USING (public._is_super_admin_from_jwt());

COMMIT;
