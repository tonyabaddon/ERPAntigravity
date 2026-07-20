-- QA Week fix P1-01: REVOKE debug SECDEF from authenticated + service_role
-- Applied 2026-07-19 via psql from docs/qa-week/pending-fixes/. Saving as
-- numbered migration for repeatability (fresh test DB bootstrap picks up).
--
-- Idempotent: REVOKE never errors if grant already absent. Safe to re-run.

BEGIN;

REVOKE EXECUTE ON FUNCTION public._debug_jwt_claims_visible() FROM authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public._debug_secdef_probe() FROM authenticated, service_role;

COMMIT;
