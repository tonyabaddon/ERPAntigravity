-- supabase/migrations/20261001000004_phase_a_auth_hook.sql
-- Phase A: Supabase Auth Hook for JWT tenant claims + expiry guard +
-- impersonation RPCs + bulk write-guard auto-wrap.
--
-- ROLLBACK NOTES:
--   1. Supabase Dashboard → Auth → Hooks → Custom Access Token → disable.
--      OR: run the "rollback" fallback below to restore _resolve_tenant_id
--      to sentinel-only behavior (Phase A pre-pivot state).
--   2. If bulk auto-wrap causes issues on a specific RPC, restore that
--      individual RPC from git history and re-apply.
--
-- IMPORTANT: platform_admin_active_impersonation table is NOT created here;
-- it was already created in 20261001000001_phase_a_schema.sql (Task 1 pre-flight fix).
--
-- NOTE: vosi_rpc_owner role doesn't exist until Task 8.5
-- (20261001000005_phase_a_secdef_ownership.sql). The grant to vosi_rpc_owner
-- in Step 2 is wrapped in a conditional DO block so file 4 applies cleanly.
-- Task 8.5 unconditionally re-asserts the grant after creating the role.

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1 (continued): _resolve_tenant_id() rewrite
-- Replaces the sentinel-returning body from 20260614000011_resolve_tenant_helper.sql.
-- NEW behaviour: reads tenant_id from JWT claim `request.jwt.claims`.
-- Pre-Layer-A sessions (no hook yet) will receive the sentinel UUID as before.
-- Signature unchanged; grants unchanged.
--
-- AUDIT COMPLETE: Grep of the codebase confirms no migration or RPC sets
-- `app.current_tenant_id` via set_config() — the pre-pivot GUC pattern was
-- never adopted at scale. All tenant resolution now flows through the JWT.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._resolve_tenant_id()
RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_claims_text text;
  v_tenant_id_text text;
BEGIN
  v_claims_text := current_setting('request.jwt.claims', true);
  IF v_claims_text IS NULL OR v_claims_text = '' THEN
    RETURN '00000000-0000-0000-0000-000000000000'::uuid;
  END IF;
  v_tenant_id_text := (v_claims_text::jsonb)->>'tenant_id';
  IF v_tenant_id_text IS NULL THEN
    RETURN '00000000-0000-0000-0000-000000000000'::uuid;
  END IF;
  RETURN v_tenant_id_text::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN '00000000-0000-0000-0000-000000000000'::uuid;
END $$;

-- signature unchanged; grants unchanged

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2: _guard_expiry_write() — real JWT-reading implementation
-- Replaces stub from 20261001000003_phase_a_not_null_and_rls.sql.
-- Reads tenant_expiry_mode from JWT claims; raises P0402 when READONLY.
-- Gracefully no-ops when JWT claims absent (unauth flows, tests, migrations).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._guard_expiry_write()
RETURNS void LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_mode text;
BEGIN
  v_mode := (current_setting('request.jwt.claims', true)::jsonb)->>'tenant_expiry_mode';
  IF v_mode = 'READONLY' THEN
    RAISE EXCEPTION USING errcode = 'P0402',
      message = 'SUBSCRIPTION_EXPIRED_READONLY',
      hint = 'Renew subscription to enable writes.';
  END IF;
EXCEPTION WHEN invalid_text_representation OR null_value_not_allowed OR undefined_object THEN
  -- No JWT claims (unauth flow, tests, migration scripts) — do not block.
  -- RLS is the primary defense; guard is a UX-preserving extra.
  NULL;
END $$;

REVOKE ALL ON FUNCTION public._guard_expiry_write() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._guard_expiry_write() TO authenticated, service_role;

-- Grant to vosi_rpc_owner conditionally: role doesn't exist until Task 8.5.
-- Task 8.5 unconditionally re-asserts this grant after role creation.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vosi_rpc_owner') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public._guard_expiry_write() TO vosi_rpc_owner';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3: custom_access_token_hook
-- Called by Supabase Auth at token-mint time. Injects tenant_id, tenant_status,
-- tenant_expiry_mode, is_platform_admin, and impersonation state into the JWT.
-- Must be registered manually in Supabase Dashboard → Authentication → Hooks.
-- GRANT is to supabase_auth_admin only (not authenticated).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id                uuid;
  v_is_platform_admin      boolean;
  v_impersonating_slug     text;
  v_tenant_id              uuid;
  v_tenant_status          text;
  v_expiry_state           text;
  v_claims                 jsonb;
BEGIN
  v_claims := event->'claims';
  v_user_id := (v_claims->>'sub')::uuid;

  v_is_platform_admin := EXISTS (
    SELECT 1 FROM public.platform_admins WHERE user_id = v_user_id
  );
  v_claims := jsonb_set(v_claims, '{is_platform_admin}', to_jsonb(v_is_platform_admin));

  IF v_is_platform_admin THEN
    SELECT tenant_slug INTO v_impersonating_slug
    FROM public.platform_admin_active_impersonation
    WHERE admin_user_id = v_user_id;
  END IF;

  IF v_impersonating_slug IS NOT NULL THEN
    SELECT id, status INTO v_tenant_id, v_tenant_status
    FROM public.tenants WHERE slug = v_impersonating_slug;
    v_claims := jsonb_set(v_claims, '{impersonating}', to_jsonb(true));
    v_claims := jsonb_set(v_claims, '{impersonating_slug}', to_jsonb(v_impersonating_slug));
  ELSE
    SELECT t.id, t.status INTO v_tenant_id, v_tenant_status
    FROM public.tenant_users tu
    JOIN public.tenants t ON t.id = tu.tenant_id
    WHERE tu.user_id = v_user_id AND tu.status = 'ACTIVE' AND t.status IN ('ACTIVE','SUSPENDED')
    ORDER BY tu.created_at ASC
    LIMIT 1;
  END IF;

  IF v_tenant_id IS NOT NULL THEN
    v_claims := jsonb_set(v_claims, '{tenant_id}', to_jsonb(v_tenant_id::text));
    v_claims := jsonb_set(v_claims, '{tenant_status}', to_jsonb(v_tenant_status));

    SELECT expiry_state INTO v_expiry_state
    FROM public.v_tenant_effective_features WHERE tenant_id = v_tenant_id;
    v_claims := jsonb_set(v_claims, '{tenant_expiry_mode}', to_jsonb(COALESCE(v_expiry_state, 'ACTIVE')));
  END IF;

  RETURN jsonb_build_object('claims', v_claims);
END $$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, PUBLIC;

-- Also grant supabase_auth_admin read access to the tables the hook needs
GRANT SELECT ON public.platform_admins TO supabase_auth_admin;
GRANT SELECT ON public.platform_admin_active_impersonation TO supabase_auth_admin;
GRANT SELECT ON public.tenants TO supabase_auth_admin;
GRANT SELECT ON public.tenant_users TO supabase_auth_admin;
GRANT SELECT ON public.tenant_subscriptions TO supabase_auth_admin;
GRANT SELECT ON public.plans TO supabase_auth_admin;
GRANT SELECT ON public.v_tenant_effective_features TO supabase_auth_admin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 4: Impersonation RPCs + helper RPCs
-- impersonate_tenant / stop_impersonation: platform admin only; writes audit row.
-- is_platform_admin / bootstrap_tenant_context: client bootstrap helpers.
-- All granted to authenticated; security enforced inside via platform_admins check.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.impersonate_tenant(p_slug text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'Not a platform admin' USING errcode = 'P0403';
  END IF;
  SELECT id INTO v_tenant_id FROM public.tenants WHERE slug = p_slug AND status = 'ACTIVE';
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND';
  END IF;
  INSERT INTO public.platform_admin_active_impersonation (admin_user_id, tenant_slug)
  VALUES (v_uid, p_slug)
  ON CONFLICT (admin_user_id) DO UPDATE SET tenant_slug = EXCLUDED.tenant_slug, started_at = now();
  INSERT INTO public.platform_admin_audit
    (admin_user_id, admin_email, tenant_id, action, detail)
  VALUES (v_uid, (SELECT email FROM auth.users WHERE id = v_uid), v_tenant_id,
          'IMPERSONATE_START', jsonb_build_object('slug', p_slug));
END $$;

CREATE OR REPLACE FUNCTION public.stop_impersonation()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prev_slug text;
  v_tenant_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'Not a platform admin' USING errcode = 'P0403';
  END IF;
  SELECT tenant_slug INTO v_prev_slug FROM public.platform_admin_active_impersonation
  WHERE admin_user_id = v_uid;
  DELETE FROM public.platform_admin_active_impersonation WHERE admin_user_id = v_uid;
  IF v_prev_slug IS NOT NULL THEN
    SELECT id INTO v_tenant_id FROM public.tenants WHERE slug = v_prev_slug;
    INSERT INTO public.platform_admin_audit
      (admin_user_id, admin_email, tenant_id, action, detail)
    VALUES (v_uid, (SELECT email FROM auth.users WHERE id = v_uid), v_tenant_id,
            'IMPERSONATE_END', jsonb_build_object('slug', v_prev_slug));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_tenant_context()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_claims jsonb;
  v_tenant_id uuid;
  v_result jsonb;
BEGIN
  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  IF v_claims IS NULL OR (v_claims->>'tenant_id') IS NULL THEN
    RAISE EXCEPTION 'MISSING_TENANT_CONTEXT' USING errcode = 'P0400';
  END IF;
  v_tenant_id := (v_claims->>'tenant_id')::uuid;
  SELECT jsonb_build_object(
    'tenant_id', t.id,
    'slug', t.slug,
    'name', t.name,
    'status', t.status,
    'plan_code', v.plan_code,
    'effective_features', v.effective_features,
    'expiry_mode', v.expiry_state,
    'expires_at', v.expires_at,
    'grace_expires_at', v.grace_expires_at,
    'is_platform_admin', COALESCE((v_claims->>'is_platform_admin')::boolean, false),
    'impersonating', COALESCE((v_claims->>'impersonating')::boolean, false),
    'impersonating_slug', v_claims->>'impersonating_slug'
  ) INTO v_result
  FROM public.tenants t
  LEFT JOIN public.v_tenant_effective_features v ON v.tenant_id = t.id
  WHERE t.id = v_tenant_id;
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.impersonate_tenant(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stop_impersonation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_tenant_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.impersonate_tenant(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stop_impersonation() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_tenant_context() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 5 (statement_timeout): SKIPPED — already applied in Task 1
-- (20261001000001_phase_a_schema.sql lines 197-199).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 6: Bulk auto-wrap write RPCs with PERFORM _guard_expiry_write().
-- Heuristic: function name doesn't start with get_/list_/resolve_/is_/bootstrap_/log_
-- AND function body contains INSERT/UPDATE/DELETE/TRUNCATE (case-insensitive).
-- CREATE OR REPLACE with `PERFORM _guard_expiry_write();` right after first BEGIN.
--
-- REGEX: line-anchored `\nBEGIN\n` — robust to DECLARE blocks.
-- pg_get_functiondef normalizes formatting so BEGIN always appears on its own line.
-- Skip if already wrapped (avoid double injection on re-runs).
--
-- NOTE: impersonate_tenant and stop_impersonation are EXCLUDED (see NOT IN list
-- below). When a platform admin impersonates a READONLY-expired tenant, the JWT
-- carries tenant_expiry_mode=READONLY from the impersonated tenant. If the guard
-- fired inside these RPCs, the admin would be trapped — unable to stop or switch
-- impersonation without a direct DB session.
--
-- Hard-fail threshold: >5 misses halts migration; manual audit required.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
  v_new_body TEXT;
  v_wrapped_count INT := 0;
  v_skipped_count INT := 0;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, p.proname AS fn_name, p.oid,
           pg_get_functiondef(p.oid) AS full_def, p.prosrc AS body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      -- Skip read-only naming conventions
      AND p.proname NOT LIKE 'get\_%' ESCAPE '\'
      AND p.proname NOT LIKE 'list\_%' ESCAPE '\'
      AND p.proname NOT LIKE 'resolve\_%' ESCAPE '\'
      AND p.proname NOT LIKE 'is\_%' ESCAPE '\'
      AND p.proname NOT LIKE 'bootstrap\_%' ESCAPE '\'
      AND p.proname NOT LIKE 'log\_%' ESCAPE '\'
      AND p.proname NOT LIKE '\_%' ESCAPE '\'  -- skip internal helpers (leading underscore)
      -- Skip trigger functions we own (they're not RPCs)
      -- Skip impersonation RPCs: guard would create P0402 dead-end when platform
      -- admin impersonates a READONLY-expired tenant (JWT has tenant_expiry_mode
      -- from the impersonated tenant; guard fires before platform-admin check).
      AND p.proname NOT IN ('sync_tenant_settings_from_subscription',
                            'resync_all_tenants_on_plan_change',
                            'company_settings_costing_method_chk',
                            '_forbid_slug_change',
                            '_seed_company_settings_for_new_tenant',
                            'impersonate_tenant',
                            'stop_impersonation')
      -- Body must contain a write keyword outside of comments
      AND p.prosrc ~* '\y(INSERT|UPDATE|DELETE|TRUNCATE)\y'
      -- Skip if already wrapped (idempotent)
      AND p.prosrc !~ 'PERFORM\s+(public\.)?_guard_expiry_write\(\s*\)'
  LOOP
    -- Line-anchored BEGIN: matches `\nBEGIN\n` anywhere in the function definition.
    -- pg_get_functiondef output always has BEGIN on its own line.
    -- Nested BEGIN...EXCEPTION blocks appear later; regexp_replace default replaces first match only.
    v_new_body := regexp_replace(
      r.full_def,
      E'(\\nBEGIN\\n)',
      E'\\1  PERFORM public._guard_expiry_write();\n'
    );

    -- Safety: only execute if regex actually changed the body
    IF v_new_body = r.full_def THEN
      RAISE WARNING 'Regex miss on %: no \\nBEGIN\\n pattern found — investigate manually', r.fn_name;
      v_skipped_count := v_skipped_count + 1;
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE v_new_body;
      RAISE NOTICE 'Wrapped: %', r.fn_name;
      v_wrapped_count := v_wrapped_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Skipped % (execute failed): %', r.fn_name, SQLERRM;
      v_skipped_count := v_skipped_count + 1;
    END;
  END LOOP;

  RAISE NOTICE 'Bulk auto-wrap complete: % wrapped, % skipped', v_wrapped_count, v_skipped_count;

  -- Hard-fail if too many misses — indicates codebase has RPCs the heuristic can't handle
  IF v_skipped_count > 5 THEN
    RAISE EXCEPTION 'Too many skipped RPCs (%). Manual audit required before rolling out Layer-A.', v_skipped_count;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Post-apply verification query (run manually after supabase db reset):
-- Every write RPC should now contain _guard_expiry_write.
-- Expected result: 0 rows. Any row = an unwrapped write RPC; investigate.
--
-- SELECT proname FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.prokind = 'f'
--   AND p.proname NOT LIKE 'get\_%' ESCAPE '\'
--   AND p.proname NOT LIKE 'list\_%' ESCAPE '\'
--   AND p.proname NOT LIKE 'resolve\_%' ESCAPE '\'
--   AND p.proname NOT LIKE 'is\_%' ESCAPE '\'
--   AND p.proname NOT LIKE 'bootstrap\_%' ESCAPE '\'
--   AND p.proname NOT LIKE 'log\_%' ESCAPE '\'
--   AND p.proname NOT LIKE '\_%' ESCAPE '\'
--   AND p.prosrc ~* '\y(INSERT|UPDATE|DELETE|TRUNCATE)\y'
--   AND p.prosrc !~ 'PERFORM\s+(public\.)?_guard_expiry_write\(\s*\)';
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 7 (Dashboard registration): MANUAL STEP — see rollout checklist (Task 27).
-- LOCAL: hook auto-picked up from Postgres config if using `supabase start`.
-- Preview/Production:
--   1. Dashboard → Authentication → Hooks → Custom Access Token Hook → Enable ON.
--   2. Hook Function → public.custom_access_token_hook → Save.
--   3. Verify new JWT has tenant_id claim via jwt.io after fresh login.
