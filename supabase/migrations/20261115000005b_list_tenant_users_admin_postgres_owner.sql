-- 20261115000005b_list_tenant_users_admin_postgres_owner.sql
-- WHY this file exists:
--   Migration 20261115000005 creates list_tenant_users_admin owned by
--   vosi_rpc_owner. However, the function JOINs auth.users, which lives in the
--   auth schema owned by supabase_admin. vosi_rpc_owner needs USAGE on schema
--   auth and SELECT on auth.users — but postgres cannot re-grant these
--   WITH GRANT OPTION because postgres does not hold the WITH GRANT OPTION flag
--   on the auth schema ACL (supabase_admin owns it). The function therefore
--   must run under the postgres role, which already has superuser/USAGE access
--   to auth. This is the same pattern used for custom_access_token_hook in
--   Phase A.
--
--   Fresh setup: migration 000005 fires first (sets owner to vosi_rpc_owner),
--   then this file fires and re-sets owner to postgres. Net result: postgres.
--   Prod: owner was already changed to postgres (applied 2026-07-05 via Task 12
--   hotfix); this file is idempotent re-establishment.

ALTER FUNCTION public.list_tenant_users_admin(uuid) OWNER TO postgres;
