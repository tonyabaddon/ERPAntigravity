-- PENDING FIX P1-01 — REVOKE debug SECDEF functions from authenticated
-- Origin: docs/qa-week/2026-07-19-session1-findings.md P1-01
-- Author: QA Session 2 (draft, not applied)
-- Reviewer: founder
-- Apply via: mcp__plugin_supabase_supabase__apply_migration or scripts/apply-migration.sh
--
-- WHY:
--   _debug_jwt_claims_visible + _debug_secdef_probe are SECURITY DEFINER functions
--   currently granted EXECUTE to `authenticated` (all tenant users) + `service_role`.
--   These reveal JWT claim visibility + SECDEF execution context — sensitive info
--   disclosure vectors from a defense-in-depth perspective. Debug functions should
--   not be callable by production tenant users.
--
-- SCOPE:
--   REVOKE EXECUTE from authenticated + service_role. Keep for postgres + vosi_rpc_owner
--   (superuser/RPC owner still needs them for debugging).
--
-- ALTERNATIVE CONSIDERED (rejected):
--   DROP FUNCTION entirely. Rejected because: (a) risk of missing use in an internal
--   admin dashboard, (b) REVOKE is fully reversible if we later need them.
--
-- IDEMPOTENCY:
--   REVOKE is always idempotent (safe to re-run — no error if grant absent).
--
-- REGRESSION TEST (post-apply):
--   -- Should raise 42501 as authenticated:
--   SET LOCAL role authenticated;
--   PERFORM set_config('request.jwt.claim.sub', '<any-user-uuid>', true);
--   BEGIN
--     PERFORM public._debug_jwt_claims_visible();
--     RAISE NOTICE 'FAIL — call succeeded when it should not';
--   EXCEPTION WHEN insufficient_privilege THEN
--     RAISE NOTICE 'PASS — 42501 raised as expected';
--   END;
--
-- BLAST RADIUS:
--   Any app code calling these functions from FE will break. Verify via:
--     grep -rn "_debug_jwt_claims_visible\|_debug_secdef_probe" src/ backend-go/
--   Expected: no matches (these are dev-time debug tools). If matches found, halt.

BEGIN;

REVOKE EXECUTE ON FUNCTION public._debug_jwt_claims_visible() FROM authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public._debug_secdef_probe() FROM authenticated, service_role;

COMMIT;

-- VERIFY (run separately after commit):
-- SELECT p.proname, pg_catalog.pg_get_userbyid(a.grantee) AS grantee, a.privilege_type
-- FROM pg_proc p JOIN aclexplode(p.proacl) a ON true
-- WHERE p.proname IN ('_debug_jwt_claims_visible','_debug_secdef_probe')
-- ORDER BY 1, 2;
-- Expected: only postgres + vosi_rpc_owner grants remain (2 rows per function).
