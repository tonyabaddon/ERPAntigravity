-- 20261115000042_tenants_id_anti_sentinel_check.sql
--
-- Defensive: prevent any tenant from being created with the all-zeros UUID.
-- Rationale — `_resolve_tenant_id()` (see 20261001000004) returns the sentinel
-- `00000000-0000-0000-0000-000000000000` whenever the JWT tenant claim is
-- missing (unauthenticated session, missing claim, etc.). Every T-category
-- RLS SELECT policy compares `tenant_id = _resolve_tenant_id()`. If a real
-- tenant were ever created with `id = 00000000-...`, the sentinel would
-- match its rows and every JWT-less session would collapse into that tenant.
-- Belt-and-braces CHECK constraint eliminates the scenario at schema level.

BEGIN;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_id_not_sentinel
  CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid);

COMMENT ON CONSTRAINT tenants_id_not_sentinel ON public.tenants IS
  'Reserved UUID used by _resolve_tenant_id() as the "no JWT claim" fallback. '
  'A real tenant with this id would let unauthenticated sessions read its data.';

COMMIT;
