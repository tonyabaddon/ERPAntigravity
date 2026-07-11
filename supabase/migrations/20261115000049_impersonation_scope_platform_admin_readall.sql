-- 20261115000049_impersonation_scope_platform_admin_readall.sql
--
-- QA cycle Session 1 finding F-6 permanent fix (Phase 1 of 2).
--
-- Problem
-- =======
-- `_is_platform_admin_from_jwt()` returns TRUE whenever the JWT carries
-- `is_platform_admin=true`. During impersonation the JWT keeps that claim
-- (impersonation only adds `impersonating=true` + swaps `tenant_id`). Result:
-- 87 supplementary RLS policies (`p_platform_admin_readall` and friends)
-- and 8 admin-write RPC gates fire even while the admin is supposed to be
-- viewing a single tenant. Any reader query without an explicit
-- `WHERE tenant_id = _resolve_tenant_id()` clause leaks other tenants'
-- rows into the impersonated tenant's UI (Dashboard AI log, Laporan
-- Performa totals, Produk Terlaris top-N, etc.).
--
-- Semantic fix
-- ============
-- The helper's *name* claims "is platform admin from JWT" but its correct
-- runtime meaning is "is *effectively* acting as a platform admin *right
-- now*". During impersonation, the admin is acting as a tenant, so the
-- answer is FALSE. Two changes:
--
-- 1. Introduce a new helper `_is_platform_admin_active_from_jwt()` whose
--    body encodes the "effectively active" semantic:
--        is_platform_admin = true AND impersonating != true
--    Naming it explicitly prevents future policies from accidentally
--    referencing the old lax semantic.
--
-- 2. Sweep every policy/function that references the old helper to point
--    at the new one via `pg_get_functiondef` + `pg_policies` regex-replace
--    + `EXECUTE`. Then DROP the old helper so no callsite drifts back.
--
-- Blast radius
-- ============
-- - 87 policies (mostly `p_platform_admin_readall` on tenant tables +
--   a few write-side policies on VOSI Admin surfaces).
-- - ~8 admin-write RPCs (list-tenants-admin, update-plan-admin,
--   list-attention-tenants, payment_verification_workflow,
--   renew_subscription, etc.). Those will now REJECT calls from an
--   impersonating admin — semantically correct: an admin currently
--   pretending to be tenant X should not invoke platform-wide operations.
--   To re-enable, stop impersonation first.
-- - 0 views.
--
-- What this does NOT change
-- =========================
-- - `is_platform_admin` JWT claim itself — frontend `AdminRouteGuard` and
--   the impersonation banner keep working. (Frontend URL-hacking to
--   /admin during impersonation will hit RPC 403; follow-up commit will
--   also gate the route on `!impersonating` for UX polish.)
-- - `stop_impersonation` — it checks `platform_admins` table directly,
--   not the helper. Impersonation exit path stays open.
-- - `impersonate_tenant` START gate — that is Phase 2 (F-10, grant-based
--   consent). This migration only fixes the *scope during* impersonation.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) New helper: impersonation-aware
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._is_platform_admin_active_from_jwt()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_claims_text text;
  v_claims      jsonb;
BEGIN
  v_claims_text := current_setting('request.jwt.claims', true);
  IF v_claims_text IS NULL OR v_claims_text = '' THEN
    RETURN false;
  END IF;
  v_claims := v_claims_text::jsonb;

  -- During impersonation the admin is acting as a tenant user, so the
  -- platform-admin read-all bypass and admin-only RPC gates should NOT
  -- fire. This is the whole point of the rename.
  IF COALESCE((v_claims ->> 'impersonating')::boolean, false) THEN
    RETURN false;
  END IF;

  RETURN COALESCE((v_claims ->> 'is_platform_admin')::boolean, false);

EXCEPTION WHEN OTHERS THEN
  RETURN false;
END $function$;

COMMENT ON FUNCTION public._is_platform_admin_active_from_jwt() IS
  'Returns TRUE iff the caller is a platform admin AND is NOT currently '
  'impersonating any tenant. Use this for RLS supplementary read-all '
  'policies and admin-only RPC gates. Never call the old '
  '_is_platform_admin_from_jwt() name — it will be dropped by this migration.';

REVOKE ALL ON FUNCTION public._is_platform_admin_active_from_jwt() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._is_platform_admin_active_from_jwt()
  TO authenticated, service_role, vosi_rpc_owner;

-- ---------------------------------------------------------------------------
-- 2) Sweep RLS policies: rewrite qual + with_check to reference new helper
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r record;
  v_new_qual       text;
  v_new_with_check text;
  v_patched        int := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check, roles
    FROM pg_policies
    WHERE qual LIKE '%_is_platform_admin_from_jwt%'
       OR with_check LIKE '%_is_platform_admin_from_jwt%'
  LOOP
    v_new_qual := replace(
      COALESCE(r.qual, 'true'),
      '_is_platform_admin_from_jwt',
      '_is_platform_admin_active_from_jwt'
    );
    v_new_with_check := replace(
      COALESCE(r.with_check, r.qual, 'true'),
      '_is_platform_admin_from_jwt',
      '_is_platform_admin_active_from_jwt'
    );

    -- ALTER POLICY supports USING and/or WITH CHECK depending on cmd.
    -- Postgres accepts both clauses even for cmd=SELECT (WITH CHECK is
    -- ignored for read); this keeps the rewrite branch-free.
    IF r.qual IS NOT NULL AND r.with_check IS NOT NULL THEN
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I USING (%s) WITH CHECK (%s)',
        r.policyname, r.schemaname, r.tablename, v_new_qual, v_new_with_check
      );
    ELSIF r.qual IS NOT NULL THEN
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I USING (%s)',
        r.policyname, r.schemaname, r.tablename, v_new_qual
      );
    ELSIF r.with_check IS NOT NULL THEN
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I WITH CHECK (%s)',
        r.policyname, r.schemaname, r.tablename, v_new_with_check
      );
    END IF;

    v_patched := v_patched + 1;
  END LOOP;
  RAISE NOTICE 'patched % policies', v_patched;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Sweep functions that reference the old helper (admin RPC gates etc.)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r record;
  v_body    text;
  v_patched int := 0;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND pg_get_functiondef(p.oid) LIKE '%_is_platform_admin_from_jwt%'
      -- exclude the old helper itself — we drop it below
      AND p.oid <> (
        SELECT oid FROM pg_proc
        WHERE proname = '_is_platform_admin_from_jwt'
          AND pronamespace = 'public'::regnamespace
      )
  LOOP
    v_body := pg_get_functiondef(r.oid);
    v_body := replace(v_body, '_is_platform_admin_from_jwt', '_is_platform_admin_active_from_jwt');
    EXECUTE v_body;
    v_patched := v_patched + 1;
  END LOOP;
  RAISE NOTICE 'patched % functions', v_patched;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Drop the old helper — no more callsites should remain.
--    If any linger (e.g., a view we missed), this will fail with a
--    "cannot drop function ... because other objects depend on it"
--    error, which is desirable — we want the migration to STOP rather
--    than silently leave a lax gate live.
-- ---------------------------------------------------------------------------

DROP FUNCTION public._is_platform_admin_from_jwt();

-- ---------------------------------------------------------------------------
-- 5) In-place smoke test
--    Fakes three JWT payloads and asserts the new helper returns the
--    correct value for each. Uses RAISE EXCEPTION to fail loudly on
--    regression, then rolls back the smoke-test transaction so no state
--    leaks. This is BEFORE the outer COMMIT — if any assertion fails,
--    the entire migration aborts.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_got boolean;
BEGIN
  -- Scenario 1: regular tenant user (no admin claim)
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000001","is_platform_admin":false,"tenant_id":"11111111-1111-1111-1111-111111111111"}',
    true
  );
  v_got := public._is_platform_admin_active_from_jwt();
  IF v_got IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'smoke test 1 failed: regular tenant user should return false, got %', v_got;
  END IF;

  -- Scenario 2: platform admin, NOT impersonating
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000002","is_platform_admin":true}',
    true
  );
  v_got := public._is_platform_admin_active_from_jwt();
  IF v_got IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'smoke test 2 failed: admin not impersonating should return true, got %', v_got;
  END IF;

  -- Scenario 3: platform admin, actively impersonating
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000002","is_platform_admin":true,"impersonating":true,"impersonating_slug":"garindo","tenant_id":"11111111-1111-1111-1111-111111111111"}',
    true
  );
  v_got := public._is_platform_admin_active_from_jwt();
  IF v_got IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'smoke test 3 failed: admin impersonating should return false, got %', v_got;
  END IF;

  -- Reset JWT so it doesn't leak into the COMMIT
  PERFORM set_config('request.jwt.claims', '', true);

  RAISE NOTICE 'F-6 smoke tests passed';
END $$;

COMMIT;
