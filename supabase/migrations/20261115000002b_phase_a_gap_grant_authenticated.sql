-- Phase A architectural gap fix — enables Phase B Wave 1 admin RPCs.
--
-- Root cause: vosi_rpc_owner (function owner of SECDEF admin RPCs) is not
-- a member of authenticated. All P-policies scope TO {authenticated}. Inside
-- SECDEF, current_user = vosi_rpc_owner → policies don't fire → 0 rows.
--
-- Fix: grant authenticated to vosi_rpc_owner. This gives vosi_rpc_owner
-- role membership only — NOT privileges (NOINHERIT is preserved). RLS
-- policies scoped TO {authenticated} now apply to vosi_rpc_owner (RLS
-- uses pg_has_role membership semantics, not INHERIT). The policies'
-- USING clauses (_is_platform_admin_from_jwt(), _resolve_tenant_id())
-- still gate the actual read — no privilege leaks.
--
-- Discovered while implementing Phase B Wave 1 Task 2 (list_tenants_admin).
-- Reference: memory `project_phase_a_secdef_authenticated_gap`.

BEGIN;

GRANT authenticated TO vosi_rpc_owner;

COMMIT;
