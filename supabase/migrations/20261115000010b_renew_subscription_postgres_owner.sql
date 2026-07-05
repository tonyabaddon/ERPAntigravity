-- 20261115000010b_renew_subscription_postgres_owner.sql
-- Hotfix for the initial 20261115000010 apply on Garindo prod on 2026-07-05.
--
-- Original 000010 set OWNER TO vosi_rpc_owner. That prevents the function from
-- calling auth.uid() and SELECTing from platform_admins (both cross the auth
-- schema, which vosi_rpc_owner cannot access — supabase_admin owns it and
-- postgres lacks WITH GRANT OPTION on the auth schema ACL). Empirically
-- reproduced by DO-block smoke: SELECT public.renew_subscription(...) raised
-- "42501: permission denied for schema auth".
--
-- Same architectural gap that surfaced in Wave 1 Task 12
-- (list_tenant_users_admin) — canonical resolution is postgres ownership for
-- SECDEF write RPCs that touch the auth schema. Reference:
-- `project_phase_a_secdef_authenticated_gap` memory.
--
-- Idempotent: fresh setups will apply 000010 first (which now sets owner to
-- postgres inline) and then this file re-establishes postgres ownership as a
-- no-op. Prod converges from vosi_rpc_owner → postgres.

ALTER FUNCTION public.renew_subscription(uuid, date, text, text) OWNER TO postgres;
