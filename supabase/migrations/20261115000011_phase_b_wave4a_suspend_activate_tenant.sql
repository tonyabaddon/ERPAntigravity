BEGIN;

-- ============================================================
-- Phase B Wave 4a — Task 2
-- suspend_tenant(p_tenant_id uuid, p_reason text) → jsonb
-- activate_tenant(p_tenant_id uuid) → jsonb
--
-- Schema findings (verified via MCP before writing):
--   • tenants.status CHECK: ('ACTIVE','SUSPENDED','ARCHIVED') — all three present.
--   • tenants.suspended_at, suspended_reason, archived_at — all regular columns,
--     none are GENERATED. Safe to UPDATE all of them.
--   • platform_admin_audit.action whitelist currently includes generic 'SUSPEND'
--     and 'ACTIVATE' codes from Wave 1 seed. This migration adds the more specific
--     'SUSPEND_TENANT' and 'ACTIVATE_TENANT' codes used by these RPCs.
--     NOTE: the old codes ('SUSPEND','ACTIVATE') remain in the whitelist to preserve
--     any existing audit rows; only new RPCs emit the new codes.
--
-- Ownership: both RPCs call auth.uid() and SELECT from platform_admins for
-- admin_email. vosi_rpc_owner cannot access the auth schema (supabase_admin
-- owns it; postgres lacks WITH GRANT OPTION). Both must be owned by postgres,
-- same as Wave 1 Task 12 (list_tenant_users_admin) and Wave 4a Task 1
-- (renew_subscription). See memory `project_phase_a_secdef_authenticated_gap`.
-- ============================================================

-- ── Step 1: Extend platform_admin_audit action CHECK whitelist ───────────────
-- Cumulative set (union of all prior slots + Task 2 additions):
--   Wave 1 seed: IMPERSONATE_START, IMPERSONATE_END, CREATE_TENANT, CHANGE_PLAN,
--                CHANGE_FEATURES, SUSPEND, ACTIVATE, ARCHIVE
--   Wave 4a Task 1: RENEW_SUBSCRIPTION
--   Wave 4a Task 2 (this file): SUSPEND_TENANT, ACTIVATE_TENANT

ALTER TABLE public.platform_admin_audit
  DROP CONSTRAINT IF EXISTS platform_admin_audit_action_check;

ALTER TABLE public.platform_admin_audit
  ADD CONSTRAINT platform_admin_audit_action_check
    CHECK (action = ANY (ARRAY[
      'IMPERSONATE_START'::text,
      'IMPERSONATE_END'::text,
      'CREATE_TENANT'::text,
      'CHANGE_PLAN'::text,
      'CHANGE_FEATURES'::text,
      'SUSPEND'::text,
      'ACTIVATE'::text,
      'ARCHIVE'::text,
      'RENEW_SUBSCRIPTION'::text,
      'SUSPEND_TENANT'::text,
      'ACTIVATE_TENANT'::text
    ]));

-- ── Step 2: suspend_tenant RPC ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.suspend_tenant(
  p_tenant_id uuid,
  p_reason    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_admin_email   text;
  v_status        text;
  v_suspended_reason text;
  v_suspended_at  timestamptz;
BEGIN
  -- ── Gate: platform admin only ─────────────────────────────────────────────
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
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
$$;

REVOKE ALL ON FUNCTION public.suspend_tenant(uuid, text) FROM PUBLIC;
ALTER FUNCTION  public.suspend_tenant(uuid, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.suspend_tenant(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.suspend_tenant(uuid, text) IS
  'category=P; Wave 4a Task 2. Suspends a tenant: sets status=SUSPENDED, '
  'records suspended_at and suspended_reason. Idempotent — second call with '
  'same tenant returns {ok,noop,reason} without a new audit row. '
  'Requires non-empty reason (22023 INVALID_REASON). '
  'Requires platform-admin JWT (P0403). Validates tenant (P0404). '
  'Writes SUSPEND_TENANT audit row.';

-- ── Step 3: activate_tenant RPC ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.activate_tenant(
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_admin_email text;
  v_old_status  text;
BEGIN
  -- ── Gate: platform admin only ─────────────────────────────────────────────
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
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
$$;

REVOKE ALL ON FUNCTION public.activate_tenant(uuid) FROM PUBLIC;
ALTER FUNCTION  public.activate_tenant(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.activate_tenant(uuid) TO authenticated;

COMMENT ON FUNCTION public.activate_tenant(uuid) IS
  'category=P; Wave 4a Task 2. Re-activates a suspended tenant: sets status=ACTIVE, '
  'clears suspended_at and suspended_reason. Idempotent — already-ACTIVE returns '
  '{ok,noop}. ARCHIVED tenants cannot be re-activated (22023 CANNOT_ACTIVATE_ARCHIVED). '
  'Requires platform-admin JWT (P0403). Validates tenant (P0404). '
  'Writes ACTIVATE_TENANT audit row with previous_status.';

COMMIT;
