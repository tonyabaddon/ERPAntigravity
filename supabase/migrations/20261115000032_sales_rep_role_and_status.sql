-- Migration: 20261115000032_sales_rep_role_and_status.sql
-- Wave 6 Task 1: Sales Rep role + status columns + auth hook extension
--
-- Correction A: role column already exists from Phase A (20261001000001) with
--   CHECK IN ('super_admin','support'). Swap the constraint to include 'sales_rep'.
-- Correction C: merge platform_admin_role claim into existing hook body (do not wipe
--   tenant_id / impersonation logic).
-- Idempotent: DROP CONSTRAINT IF EXISTS + ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE.

BEGIN;

-- ─── Correction A: swap role CHECK enum ────────────────────────────────────────
-- Phase A created: CHECK (role IN ('super_admin','support'))
-- We need:         CHECK (role IN ('super_admin','sales_rep'))
-- All existing rows have role='super_admin' so no violation.
ALTER TABLE public.platform_admins
  DROP CONSTRAINT IF EXISTS platform_admins_role_check;

ALTER TABLE public.platform_admins
  ADD CONSTRAINT platform_admins_role_check
    CHECK (role IN ('super_admin', 'sales_rep'));

-- ─── New columns (status + name are genuinely new) ─────────────────────────────
ALTER TABLE public.platform_admins
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  ADD COLUMN IF NOT EXISTS name TEXT;

-- Backward compat: all existing platform_admins default to super_admin + active.

-- ─── New helper: _is_super_admin_from_jwt() ────────────────────────────────────
-- Reads the platform_admin_role JWT claim. Returns true only for 'super_admin'.
-- Missing claim = false (safe default — no lockout for non-platform-admins).
-- SECDEF owned by postgres, per Wave 5 pattern for JWT-reading helpers.
CREATE OR REPLACE FUNCTION public._is_super_admin_from_jwt()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'platform_admin_role') = 'super_admin',
    false
  );
$function$;

ALTER FUNCTION public._is_super_admin_from_jwt() OWNER TO postgres;
REVOKE ALL ON FUNCTION public._is_super_admin_from_jwt() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._is_super_admin_from_jwt() TO authenticated, vosi_rpc_owner;

COMMENT ON FUNCTION public._is_super_admin_from_jwt() IS
  'Reads platform_admin_role JWT claim (super_admin | sales_rep). Returns true only if super_admin. Missing claim = false (safe default).';

-- ─── Correction C: extend custom_access_token_hook ─────────────────────────────
-- Full existing body preserved verbatim. Extension inserts AFTER the initial
-- is_platform_admin check and BEFORE the impersonation block, so that:
--   (a) active super_admin/sales_rep gets platform_admin_role claim in JWT
--   (b) disabled platform_admin loses is_platform_admin=true on next JWT mint
--       (impersonation block then correctly skips for disabled admins)
--
-- Return format: jsonb_build_object('claims', v_claims) — unchanged from Phase A.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id                uuid;
  v_is_platform_admin      boolean;
  v_impersonating_slug     text;
  v_tenant_id              uuid;
  v_tenant_status          text;
  v_expiry_state           text;
  v_claims                 jsonb;
  -- Wave 6 additions
  v_pa_role                text;
  v_pa_status              text;
BEGIN
  v_claims := event->'claims';
  v_user_id := (v_claims->>'sub')::uuid;

  v_is_platform_admin := EXISTS (
    SELECT 1 FROM public.platform_admins WHERE user_id = v_user_id
  );
  v_claims := jsonb_set(v_claims, '{is_platform_admin}', to_jsonb(v_is_platform_admin));

  -- Wave 6: expose platform_admin_role claim; tighten is_platform_admin to active only.
  -- Placed BEFORE impersonation block so v_is_platform_admin reflects current status.
  IF v_is_platform_admin THEN
    SELECT role, status INTO v_pa_role, v_pa_status
    FROM public.platform_admins
    WHERE user_id = v_user_id;

    IF v_pa_status = 'active' THEN
      v_claims := jsonb_set(v_claims, '{platform_admin_role}', to_jsonb(v_pa_role));
    ELSE
      -- Disabled platform_admin: strip is_platform_admin so impersonation block skips.
      v_claims := jsonb_set(v_claims, '{is_platform_admin}', to_jsonb(false));
      v_is_platform_admin := false;
    END IF;
  END IF;

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
END $function$;

-- Preserve auth admin grant (required for hook to fire)
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

COMMIT;
