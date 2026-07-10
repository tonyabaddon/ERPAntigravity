-- Migration: 20261115000034_narrow_rpc_gates_to_super.sql
-- Wave 6 Task 2: Narrow suspend_tenant / activate_tenant / renew_subscription
--   to super_admin only (was platform_admin_from_jwt, now super_admin_from_jwt).
--
-- Bodies fetched verbatim from prod via pg_get_functiondef on 2026-07-10.
-- ONLY the gate line is changed:
--   _is_platform_admin_from_jwt() → _is_super_admin_from_jwt()
--   error message: 'PLATFORM_ADMIN_REQUIRED' → 'SUPER_ADMIN_REQUIRED' (errcode P0403 unchanged)
-- All other logic, parameter names, types, OWNER, REVOKE, GRANT preserved exactly.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. suspend_tenant(p_tenant_id uuid, p_reason text)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.suspend_tenant(p_tenant_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_admin_email   text;
  v_status        text;
  v_suspended_reason text;
  v_suspended_at  timestamptz;
BEGIN
  -- ── Gate: super admin only ─────────────────────────────────────────────
  IF NOT public._is_super_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'SUPER_ADMIN_REQUIRED';
  END IF;

  -- ── Validate: non-empty reason ───────────────────────────────────────────
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_REASON';
  END IF;

  -- ── Lock-read tenant: check existence + capture current state ────────────
  SELECT status, suspended_reason
  INTO v_status, v_suspended_reason
  FROM public.tenants
  WHERE id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0404', message = 'TENANT_NOT_FOUND';
  END IF;

  -- ── Idempotent: already suspended → noop ─────────────────────────────────
  IF v_status = 'SUSPENDED' THEN
    RETURN jsonb_build_object(
      'ok',     true,
      'noop',   true,
      'reason', v_suspended_reason
    );
  END IF;

  -- ── Resolve admin email for audit row ────────────────────────────────────
  SELECT email INTO v_admin_email
  FROM public.platform_admins
  WHERE user_id = auth.uid();

  -- ── UPDATE tenants ───────────────────────────────────────────────────────
  UPDATE public.tenants
  SET
    status           = 'SUSPENDED',
    suspended_at     = now(),
    suspended_reason = p_reason
  WHERE id = p_tenant_id
  RETURNING suspended_at INTO v_suspended_at;

  -- ── Audit log ─────────────────────────────────────────────────────────────
  INSERT INTO public.platform_admin_audit
    (admin_user_id, admin_email, tenant_id, action, detail)
  VALUES (
    auth.uid(),
    v_admin_email,
    p_tenant_id,
    'SUSPEND_TENANT',
    jsonb_build_object(
      'reason',         p_reason,
      'previous_status', v_status
    )
  );

  -- ── Return ────────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'ok',          true,
    'tenant_id',   p_tenant_id,
    'suspended_at', v_suspended_at,
    'reason',      p_reason
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$function$;

ALTER FUNCTION public.suspend_tenant(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.suspend_tenant(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.suspend_tenant(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.suspend_tenant(uuid, text) TO vosi_rpc_owner;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. activate_tenant(p_tenant_id uuid)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.activate_tenant(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_admin_email text;
  v_old_status  text;
BEGIN
  -- ── Gate: super admin only ─────────────────────────────────────────────
  IF NOT public._is_super_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'SUPER_ADMIN_REQUIRED';
  END IF;

  -- ── Lock-read tenant: check existence + capture current state ────────────
  SELECT status
  INTO v_old_status
  FROM public.tenants
  WHERE id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0404', message = 'TENANT_NOT_FOUND';
  END IF;

  -- ── Idempotent: already active → noop ────────────────────────────────────
  IF v_old_status = 'ACTIVE' THEN
    RETURN jsonb_build_object(
      'ok',   true,
      'noop', true
    );
  END IF;

  -- ── Guard: archived tenants cannot be re-activated ───────────────────────
  IF v_old_status = 'ARCHIVED' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CANNOT_ACTIVATE_ARCHIVED';
  END IF;

  -- ── Resolve admin email for audit row ────────────────────────────────────
  SELECT email INTO v_admin_email
  FROM public.platform_admins
  WHERE user_id = auth.uid();

  -- ── UPDATE tenants ───────────────────────────────────────────────────────
  UPDATE public.tenants
  SET
    status           = 'ACTIVE',
    suspended_at     = NULL,
    suspended_reason = NULL
  WHERE id = p_tenant_id;

  -- ── Audit log ─────────────────────────────────────────────────────────────
  INSERT INTO public.platform_admin_audit
    (admin_user_id, admin_email, tenant_id, action, detail)
  VALUES (
    auth.uid(),
    v_admin_email,
    p_tenant_id,
    'ACTIVATE_TENANT',
    jsonb_build_object('previous_status', v_old_status)
  );

  -- ── Return ────────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'ok',        true,
    'tenant_id', p_tenant_id,
    'status',    'ACTIVE'
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$function$;

ALTER FUNCTION public.activate_tenant(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.activate_tenant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_tenant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_tenant(uuid) TO vosi_rpc_owner;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. renew_subscription(p_tenant_id uuid, p_new_expires_at date, p_new_plan_code text, p_notes text)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.renew_subscription(p_tenant_id uuid, p_new_expires_at date, p_new_plan_code text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_admin_email text;
  v_final_plan  text;
BEGIN
  IF NOT public._is_super_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'SUPER_ADMIN_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION USING errcode = 'P0404', message = 'TENANT_NOT_FOUND';
  END IF;
  IF p_new_expires_at <= CURRENT_DATE THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_EXPIRES_AT';
  END IF;
  IF p_new_plan_code IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.plans WHERE code = p_new_plan_code) THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_PLAN_CODE';
    END IF;
  END IF;
  SELECT email INTO v_admin_email FROM public.platform_admins WHERE user_id = auth.uid();
  UPDATE public.tenant_subscriptions
  SET expires_at = p_new_expires_at,
      plan_code  = COALESCE(p_new_plan_code, plan_code),
      notes      = COALESCE(p_notes, notes),
      updated_at = now(),
      updated_by = auth.uid()
  WHERE tenant_id = p_tenant_id
  RETURNING plan_code INTO v_final_plan;
  INSERT INTO public.platform_admin_audit
    (admin_user_id, admin_email, tenant_id, action, detail)
  VALUES (auth.uid(), v_admin_email, p_tenant_id, 'RENEW_SUBSCRIPTION',
    jsonb_build_object('new_expires_at', p_new_expires_at, 'new_plan_code', p_new_plan_code, 'notes', p_notes));
  RETURN jsonb_build_object(
    'ok', true, 'tenant_id', p_tenant_id, 'new_expires_at', p_new_expires_at,
    'new_grace_expires_at', p_new_expires_at + interval '7 days', 'plan_code', v_final_plan
  );
EXCEPTION WHEN OTHERS THEN RAISE;
END;
$function$;

ALTER FUNCTION public.renew_subscription(uuid, date, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.renew_subscription(uuid, date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renew_subscription(uuid, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.renew_subscription(uuid, date, text, text) TO vosi_rpc_owner;

COMMIT;
