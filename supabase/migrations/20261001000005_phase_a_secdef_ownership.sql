-- supabase/migrations/20261001000005_phase_a_secdef_ownership.sql
-- Phase A: SECURITY DEFINER hardening. Create dedicated owner role without
-- BYPASSRLS so FORCE ROW LEVEL SECURITY actually applies to SECURITY DEFINER
-- function bodies. Re-own every SECURITY DEFINER RPC (except documented exclusions).
--
-- WHY: postgres role has BYPASSRLS. Functions owned by postgres run as
-- postgres → RLS bypassed even with FORCE RLS. Ownership change forces RLS
-- to apply, plugging the primary SECURITY DEFINER leak vector.
--
-- EXCLUSION LIST (14 functions that MUST stay postgres-owned because they
-- intentionally cross tenant boundaries or are platform-admin control paths):
--   custom_access_token_hook  — auth hook, runs as postgres for cross-tenant JWT minting
--   impersonate_tenant        — platform-admin control; cross-tenant by design
--   stop_impersonation        — platform-admin control; cross-tenant by design
--   is_platform_admin         — reads platform_admins across tenants
--   bootstrap_tenant_context  — reads tenants/v_tenant_effective_features for any tenant
--   _guard_expiry_write       — internal helper; called inside SECDEF RPCs owned by vosi_rpc_owner
--   _resolve_tenant_id        — internal helper; reads JWT claims
--   _forbid_slug_change       — trigger helper on tenants table (cross-tenant)
--   _seed_company_settings_for_new_tenant — trigger helper (cross-tenant bootstrap)
--   sync_tenant_settings_from_subscription — subscription sync (cross-tenant)
--   resync_all_tenants_on_plan_change     — plan-wide sync (cross-tenant)
--   log_impersonation_start   — legacy name (no-op exclusion; safe to keep)
--   log_impersonation_end     — legacy name (no-op exclusion; safe to keep)
--   _assert_tenant_context    — helper created in this file; excluded from bulk re-own
--
-- Rollback: ALTER FUNCTION public.<name>(<args>) OWNER TO postgres; for each.
--
-- FILE IS LEFT OPEN (no COMMIT) — Supabase applies each migration in a transaction.

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1: Create the dedicated owner role (idempotent)
-- No BYPASSRLS, No SUPERUSER, No LOGIN — purely a privilege bucket.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vosi_rpc_owner') THEN
    CREATE ROLE vosi_rpc_owner NOINHERIT;
    -- Explicitly: NO BYPASSRLS, NO SUPERUSER, NO LOGIN
  END IF;
END $$;

-- Migration user (postgres) needs the role to execute ALTER FUNCTION ... OWNER TO
GRANT vosi_rpc_owner TO postgres;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2: Grant vosi_rpc_owner privileges it needs to execute RPC bodies
-- (schema access, table DML, sequences, functions)
-- ─────────────────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO vosi_rpc_owner;
-- CREATE grant is REQUIRED for ALTER FUNCTION ... OWNER TO vosi_rpc_owner to
-- succeed. Postgres validates the new owner has CREATE on the containing schema
-- before it will move ownership; without this the bulk re-own DO block silently
-- fails on every ALTER FUNCTION. Verified against ERP MSME test project.
GRANT CREATE ON SCHEMA public TO vosi_rpc_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vosi_rpc_owner;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vosi_rpc_owner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO vosi_rpc_owner;

-- Future tables/sequences/functions created after this migration also get access
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vosi_rpc_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO vosi_rpc_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO vosi_rpc_owner;

-- Re-assert _guard_expiry_write grant (Task 8.4 file deferred this pending role creation)
GRANT EXECUTE ON FUNCTION public._guard_expiry_write() TO vosi_rpc_owner;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3: Bulk ownership migration — re-own all SECURITY DEFINER RPCs
-- that are NOT in the exclusion list.
--
-- Hard-fail: if ANY function fails to re-own, the migration aborts.
-- This prevents a partial state where some RPCs still bypass RLS.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
  v_reowned INT := 0;
  v_skipped INT := 0;
BEGIN
  FOR r IN
    SELECT p.proname, p.oid,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.prokind = 'f'
      AND p.proname NOT IN (
        'log_impersonation_start',
        'log_impersonation_end',
        'is_platform_admin',
        'bootstrap_tenant_context',
        '_guard_expiry_write',
        '_resolve_tenant_id',
        '_forbid_slug_change',
        '_seed_company_settings_for_new_tenant',
        'sync_tenant_settings_from_subscription',
        'resync_all_tenants_on_plan_change',
        'custom_access_token_hook',
        'impersonate_tenant',
        'stop_impersonation',
        '_assert_tenant_context'
      )
      -- Only re-own postgres-owned functions. Extension-owned functions
      -- (supabase_admin, pgsodium roles, etc.) stay with their owner.
      AND p.proowner = 'postgres'::regrole
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION public.%I(%s) OWNER TO vosi_rpc_owner',
                     r.proname, r.args);
      v_reowned := v_reowned + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to re-own %(%): %', r.proname, r.args, SQLERRM;
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RAISE NOTICE 'SECURITY DEFINER ownership migration: % re-owned, % skipped/failed',
    v_reowned, v_skipped;

  -- Hard-fail: any failure means migration is partial — investigate before Layer-A go-live
  IF v_skipped > 0 THEN
    RAISE EXCEPTION
      'SECDEF ownership migration incomplete: % function(s) could not be re-owned. '
      'Investigate pg_proc ownership and permissions before Layer-A go-live.',
      v_skipped;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 4: _assert_tenant_context() helper
--
-- Lightweight guard called at the top of high-risk write RPCs (belt-and-suspenders
-- over ownership migration). Reads tenant_id from request.jwt.claims (same source
-- as _resolve_tenant_id); raises P0400 if missing.
--
-- Intentionally STABLE (not VOLATILE) — reads only GUCs, no table writes.
-- NOT SECURITY DEFINER — must run as the calling role (vosi_rpc_owner) so that
-- any table reads within callers are subject to RLS.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._assert_tenant_context()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_claims_text text;
  v_tenant_id_text text;
  v_tid uuid;
BEGIN
  v_claims_text := current_setting('request.jwt.claims', true);
  IF v_claims_text IS NULL OR v_claims_text = '' THEN
    RAISE EXCEPTION 'MISSING_TENANT_CONTEXT'
      USING errcode = 'P0400',
            hint = 'JWT claims absent — ensure custom_access_token_hook is registered.';
  END IF;

  v_tenant_id_text := (v_claims_text::jsonb)->>'tenant_id';
  IF v_tenant_id_text IS NULL OR v_tenant_id_text = '' THEN
    RAISE EXCEPTION 'MISSING_TENANT_CONTEXT'
      USING errcode = 'P0400',
            hint = 'tenant_id missing from JWT claims — check hook registration.';
  END IF;

  v_tid := v_tenant_id_text::uuid;
  RETURN v_tid;
END $$;

REVOKE ALL ON FUNCTION public._assert_tenant_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._assert_tenant_context() TO authenticated, vosi_rpc_owner;

-- ─────────────────────────────────────────────────────────────────────────────
-- Post-apply verification (run manually — Docker unavailable in CI for this task):
--
-- 1. Count re-owned SECDEF functions:
--    SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.prosecdef=true
--    AND p.proowner = 'vosi_rpc_owner'::regrole;
--    Expected: ~163 minus 14 exclusions ≈ 149+
--
-- 2. Verify no SECDEF function still owned by postgres (except exclusion list):
--    SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.prosecdef=true AND p.prokind='f'
--    AND p.proowner = 'postgres'::regrole
--    AND p.proname NOT IN (
--      'log_impersonation_start','log_impersonation_end','is_platform_admin',
--      'bootstrap_tenant_context','_guard_expiry_write','_resolve_tenant_id',
--      '_forbid_slug_change','_seed_company_settings_for_new_tenant',
--      'sync_tenant_settings_from_subscription','resync_all_tenants_on_plan_change',
--      'custom_access_token_hook','impersonate_tenant','stop_impersonation',
--      '_assert_tenant_context'
--    );
--    Expected: 0 rows.
--
-- 3. Verify _assert_tenant_context is NOT SECURITY DEFINER:
--    SELECT prosecdef FROM pg_proc WHERE proname='_assert_tenant_context';
--    Expected: f (false)
--
-- Step 5 (per-RPC explicit filters) deferred to follow-up task after Task 8.5 commit.
-- ─────────────────────────────────────────────────────────────────────────────
