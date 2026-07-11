-- 20261115000044_fix_secdef_write_path_all_ttables.sql
--
-- P0 pre-launch fix: unblock SECDEF write RPCs on every T-table.
--
-- Root cause chain:
--   1. `_guard_expiry_write()` returns `void`. The predicate
--      `_guard_expiry_write() IS NULL` evaluates to FALSE always (void
--      compared to NULL is not null). Every WITH CHECK on t_insert_own /
--      t_update_own / t_delete_own therefore ANDs against false → write
--      is denied regardless of tenant_id match.
--   2. `t_*_own` policies are scoped `TO {authenticated}`. Inside a
--      SECURITY DEFINER function owned by `vosi_rpc_owner`, current_user
--      is `vosi_rpc_owner`, which is NOT a member of `authenticated`
--      (verified: `20261115000002b` GRANT was reverted by 000002c because
--      role membership doesn't confer RLS applicability). So the policies
--      don't fire for SECDEF RPCs → 42501 RLS violation with no policy match.
--
-- Net effect: every write path in the app has been broken since Phase A.
-- The tenant tables that appear populated hold seed data only. Verified
-- empirically 2026-07-11 via real HTTP call from browser (real JWT):
--   `create_cash_account_with_coa` → 42501
--   `_debug_insert_customer_vs_cash` → 42501 on both customers & cash_accounts
--   With policy PATCHED to include vosi_rpc_owner AND guard predicate
--   removed → INSERT succeeds (hit downstream check constraint as expected).
--
-- Fix (2 parts, applied atomically):
--
--   A. New `_check_expiry_ok()` returns BOOLEAN. Behavior identical to
--      `_guard_expiry_write` (raises P0402 SUBSCRIPTION_EXPIRED_READONLY
--      when JWT claim tenant_expiry_mode='READONLY', allows write otherwise).
--      Used as a real predicate — evaluates to TRUE or aborts with the
--      specific error. The old `_guard_expiry_write` is kept in place so
--      any SECDEF body that PERFORMs it continues to work.
--
--   B. For each T-table (78 total), rewrite t_insert_own / t_update_own /
--      t_delete_own to (a) include `vosi_rpc_owner` in the role clause
--      so SECDEF RPCs can hit the policy, and (b) replace the broken
--      `_guard_expiry_write() IS NULL` predicate with `_check_expiry_ok()`.
--
-- Rollback: run reverse migration that (i) restores each policy's original
-- WITH CHECK expression and (ii) drops _check_expiry_ok(). Reverts to the
-- broken-but-known state — do not apply unless verified regression.

BEGIN;

-- ── Part A: boolean guard function ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._check_expiry_ok()
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE v_mode text;
BEGIN
  v_mode := (current_setting('request.jwt.claims', true)::jsonb)->>'tenant_expiry_mode';
  IF v_mode = 'READONLY' THEN
    RAISE EXCEPTION USING errcode = 'P0402',
      message = 'SUBSCRIPTION_EXPIRED_READONLY',
      hint = 'Renew subscription to enable writes.';
  END IF;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR null_value_not_allowed OR undefined_object THEN
  -- JWT claim missing/malformed — allow write. Mirrors _guard_expiry_write
  -- behavior for backward compatibility.
  RETURN true;
END $$;

ALTER FUNCTION public._check_expiry_ok() OWNER TO postgres;
REVOKE ALL ON FUNCTION public._check_expiry_ok() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._check_expiry_ok() TO authenticated, vosi_rpc_owner;

-- ── Part B: rewrite write policies on every T-table ────────────────────────
-- Idempotent: safe to re-run. Iterates over every table that currently has
-- a `t_insert_own` policy (identifies T-tables uniquely).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = c.relname
          AND p.policyname = 't_insert_own'
      )
    ORDER BY c.relname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS t_insert_own ON public.%I', r.relname);
    EXECUTE format(
      'CREATE POLICY t_insert_own ON public.%I '
      'FOR INSERT TO authenticated, vosi_rpc_owner '
      'WITH CHECK ((tenant_id = public._resolve_tenant_id()) AND public._check_expiry_ok())',
      r.relname
    );

    EXECUTE format('DROP POLICY IF EXISTS t_update_own ON public.%I', r.relname);
    EXECUTE format(
      'CREATE POLICY t_update_own ON public.%I '
      'FOR UPDATE TO authenticated, vosi_rpc_owner '
      'USING (tenant_id = public._resolve_tenant_id()) '
      'WITH CHECK ((tenant_id = public._resolve_tenant_id()) AND public._check_expiry_ok())',
      r.relname
    );

    EXECUTE format('DROP POLICY IF EXISTS t_delete_own ON public.%I', r.relname);
    EXECUTE format(
      'CREATE POLICY t_delete_own ON public.%I '
      'FOR DELETE TO authenticated, vosi_rpc_owner '
      'USING ((tenant_id = public._resolve_tenant_id()) AND public._check_expiry_ok())',
      r.relname
    );
  END LOOP;
END $$;

COMMIT;
