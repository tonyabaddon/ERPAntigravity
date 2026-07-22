-- Phase 1 follow-up (2026-07-22): revert provision_tenant + _seed_tenant_accounting
-- ownership back to postgres so SECDEF bypasses RLS + reads auth.users.
--
-- Background: mig 507 (P3-05 SECDEF audit) flipped ALL public SECDEFs to
-- vosi_rpc_owner. That broke two functions that need superuser to work:
--   1. provision_tenant  — reads auth.users (vosi_rpc_owner lacks USAGE on
--      the auth schema; supabase_admin owns it; postgres cannot grant).
--   2. _seed_tenant_accounting  — reads chart_of_accounts from the garindo
--      template tenant; RLS filters by JWT tenant_id, so vosi_rpc_owner
--      sees 0 rows and RAISEs "COA 1-1110 missing after copy".
--
-- Both functions have been latently broken since mig 507 shipped 2026-07-22.
-- The Task 4 staging seed inlined the workaround (postgres/BYPASSRLS via
-- Management API) but the founder cannot use that path from admin.caleo.id.
-- Blocks Task 9 real-tenant onboard until this reverts.
--
-- Follows the bootstrap_tenant_context pattern in mig 510 header: some
-- SECDEFs deliberately stay postgres-owned. Phase A migration 507 header
-- already lists a preserved exclusion set including bootstrap_tenant_context;
-- these two belong on that list.
--
-- Verified via smoke DO block before commit.

ALTER FUNCTION public.provision_tenant(uuid, text, text, text, text, text, integer, text)
  OWNER TO postgres;

ALTER FUNCTION public._seed_tenant_accounting(uuid)
  OWNER TO postgres;

-- Re-grant EXECUTE so callers (authenticated users, and vosi_rpc_owner via
-- Phase A allowlist) still call the function; ownership change alone does
-- not affect grants.
REVOKE ALL ON FUNCTION public.provision_tenant(uuid, text, text, text, text, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_tenant(uuid, text, text, text, text, text, integer, text) TO authenticated;

REVOKE ALL ON FUNCTION public._seed_tenant_accounting(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._seed_tenant_accounting(uuid) TO authenticated, vosi_rpc_owner;
