-- Phase B Wave 1 — Task 2 admin-RLS gap fix (supersedes 20261115000002b).
--
-- Problem: Phase A SECDEF RPCs owned by vosi_rpc_owner cannot read tables
-- whose RLS policies are scoped `TO {authenticated}`. Inside the SECDEF,
-- current_user = vosi_rpc_owner, and Postgres RLS `TO role` applies only
-- when current_user literally matches (membership via GRANT does not
-- confer applicability — verified empirically). `SET LOCAL ROLE` is
-- forbidden inside SECURITY DEFINER (42501). The fix must be at the
-- policy layer.
--
-- Approach: add `vosi_rpc_owner` to the role clause of every policy that
-- an admin SECDEF RPC needs to read through, and add a supplementary
-- SELECT policy on every other FORCE-RLS table so future admin RPCs can
-- reach any tenant data without touching per-table policy again.
-- The USING clauses (`_is_platform_admin_from_jwt()` for P-policies and
-- for the new supplementary policy) still gate the actual read — no
-- privilege leaks.
--
-- Reference: memory `project_phase_a_secdef_authenticated_gap`.

BEGIN;

-- Part 1: fix all 6 platform-scoped P-policies (add vosi_rpc_owner).
ALTER POLICY p_platform_admin_only ON public.platform_admins                     TO authenticated, vosi_rpc_owner;
ALTER POLICY p_platform_admin_only ON public.platform_admin_active_impersonation TO authenticated, vosi_rpc_owner;
ALTER POLICY p_platform_admin_only ON public.platform_admin_audit               TO authenticated, vosi_rpc_owner;
ALTER POLICY p_platform_admin_only ON public.tenant_activity_daily              TO authenticated, vosi_rpc_owner;
ALTER POLICY p_platform_admin_only ON public.tenant_subscriptions               TO authenticated, vosi_rpc_owner;
ALTER POLICY p_platform_admin_only ON public.tenants                            TO authenticated, vosi_rpc_owner;

-- Part 2: fix plans g_read_all (same category of problem).
ALTER POLICY g_read_all ON public.plans TO authenticated, vosi_rpc_owner;

-- Part 3: supplementary SELECT policy on every FORCE-RLS public table that
-- does not already have platform-admin coverage. Read-only — writes remain
-- gated by existing tenant-scoped policies (impersonation flow unchanged).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tablename
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relforcerowsecurity = true
      AND NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = c.relname
          AND p.policyname = 'p_platform_admin_only'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = c.relname
          AND p.policyname = 'p_platform_admin_readall'
      )
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'CREATE POLICY p_platform_admin_readall ON public.%I '
      'FOR SELECT TO authenticated, vosi_rpc_owner '
      'USING (public._is_platform_admin_from_jwt())',
      r.tablename
    );
  END LOOP;
END $$;

-- Part 4: revert the ineffective GRANT from 20261115000002b.
-- The GRANT was applied to prod on 2026-07-05 as an attempted fix; verified
-- empirically that role membership alone does NOT make TO {authenticated}
-- policies fire inside SECDEF. The policy-level fix above is what works.
-- REVOKE here restores the Phase A design intent: vosi_rpc_owner is a
-- NOINHERIT NOLOGIN role with no elevated role memberships.
REVOKE authenticated FROM vosi_rpc_owner;

COMMIT;
