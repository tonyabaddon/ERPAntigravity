-- Phase 1 Task 3 (2026-07-22): bootstrap_tenant_context accepts p_hostname
-- and enforces env-vs-hostname alignment.
--
-- Mapping:
--   staging.app.caleo.id, staging.admin.caleo.id → env='staging'
--   everything else (incl. NULL for backward compat)  → env='production'
--
-- If JWT tenant.environment mismatches hostname surface: RAISE 'ENV_MISMATCH'
-- (P0401). FE (Task 5) catches this and shows "This account belongs to a
-- different environment" message.
--
-- Strict alignment per CLAUDE.md 4-hostname HARD RULE:
--   admin.caleo.id impersonates prod tenants only; staging.admin.caleo.id
--   impersonates staging tenants only. Cross-env impersonation blocked
--   deliberately — admin must switch surface, not tenant env.
--
-- Signature change: 0-arg → 1-arg (p_hostname TEXT DEFAULT NULL).
-- Existing callers (supabaseClient.ts:2521 + 3 pgTAP tests) all call
-- with no args → resolve to default NULL → v_env='production' →
-- backward-compat for prod tenants.
--
-- Returned schema unchanged (adds environment field, keeps every existing
-- key: tenant_id, slug, name, status, plan_code, effective_features,
-- expiry_mode, expires_at, grace_expires_at, is_platform_admin,
-- impersonating, impersonating_slug).
--
-- OWNERSHIP: kept as postgres per Phase A exclusion list
-- (20261001000005_phase_a_secdef_ownership.sql line 191). This function
-- must bypass RLS on public.tenants to read the tenant for any non-admin
-- user. vosi_rpc_owner would be blocked by p_platform_admin_select which
-- requires _is_platform_admin_active_from_jwt(). Superuser-owned SECDEF
-- bypasses RLS; changing owner to vosi_rpc_owner would break login for
-- every regular tenant user.

CREATE OR REPLACE FUNCTION public.bootstrap_tenant_context(p_hostname text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_claims    jsonb;
  v_tenant_id uuid;
  v_env       text;
  v_result    jsonb;
BEGIN
  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  IF v_claims IS NULL OR (v_claims->>'tenant_id') IS NULL THEN
    RAISE EXCEPTION 'MISSING_TENANT_CONTEXT' USING errcode = 'P0400';
  END IF;
  v_tenant_id := (v_claims->>'tenant_id')::uuid;

  v_env := CASE
    WHEN p_hostname IN ('staging.app.caleo.id', 'staging.admin.caleo.id') THEN 'staging'
    ELSE 'production'
  END;

  SELECT jsonb_build_object(
    'tenant_id', t.id,
    'slug', t.slug,
    'name', t.name,
    'status', t.status,
    'environment', t.environment,
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
  WHERE t.id = v_tenant_id
    AND t.environment = v_env;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'ENV_MISMATCH' USING
      errcode = 'P0401',
      detail  = format('tenant env does not match hostname surface (hostname=%s expected_env=%s)', COALESCE(p_hostname, 'NULL'), v_env);
  END IF;

  RETURN v_result;
END $function$;

-- OWNERSHIP: intentionally NOT altered — keeps postgres owner (superuser)
-- so SECDEF bypasses RLS on public.tenants. See header comment.

REVOKE ALL ON FUNCTION public.bootstrap_tenant_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_tenant_context(text) TO authenticated;

-- Drop old 0-arg signature. Safe: FE and pgTAP callers pass no args and
-- resolve to the new 1-arg version via DEFAULT NULL (→ v_env='production').
DROP FUNCTION IF EXISTS public.bootstrap_tenant_context();
