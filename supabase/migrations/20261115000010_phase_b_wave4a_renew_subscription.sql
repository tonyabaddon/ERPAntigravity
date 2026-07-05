BEGIN;

-- ============================================================
-- Phase B Wave 4a — Task 1
-- renew_subscription(p_tenant_id, p_new_expires_at, p_new_plan_code, p_notes)
--
-- Schema drift (vs brief):
--   • platform_admin_audit uses column "action" (not "action_code")
--   • "action" column has a CHECK whitelist — must extend it to
--     include 'RENEW_SUBSCRIPTION' before the RPC can INSERT.
--   • Notes param in UPDATE uses p_notes (brief typo: p_new_notes)
-- ============================================================

-- Ownership: this function calls auth.uid() and SELECTs from platform_admins
-- while resolving admin_email. vosi_rpc_owner cannot be granted USAGE on the
-- auth schema (supabase_admin owns it; postgres lacks WITH GRANT OPTION on the
-- schema ACL). So this function must be owned by postgres, mirroring Phase A's
-- custom_access_token_hook and Wave 1's list_tenant_users_admin (see memory
-- `project_phase_a_secdef_authenticated_gap` and Wave 1 Task 12 report).

-- ── Step 2: Extend platform_admin_audit action CHECK whitelist ──────────────
-- Current whitelist (Wave 1):
--   IMPERSONATE_START, IMPERSONATE_END, CREATE_TENANT, CHANGE_PLAN,
--   CHANGE_FEATURES, SUSPEND, ACTIVATE, ARCHIVE
-- Wave 4a adds: RENEW_SUBSCRIPTION (Task 1)
-- Future slots (Tasks 2–3) will extend further; this migration only adds its own.

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
      'RENEW_SUBSCRIPTION'::text
    ]));

-- ── Step 3: Create renew_subscription RPC ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.renew_subscription(
  p_tenant_id      uuid,
  p_new_expires_at date,
  p_new_plan_code  text DEFAULT NULL,
  p_notes          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_admin_email   text;
  v_final_plan    text;
BEGIN
  -- ── Gate: platform admin only ─────────────────────────────────────────────
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
  END IF;

  -- ── Validate: tenant exists ───────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION USING errcode = 'P0404', message = 'TENANT_NOT_FOUND';
  END IF;

  -- ── Validate: new expiry must be strictly in the future ───────────────────
  IF p_new_expires_at <= CURRENT_DATE THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_EXPIRES_AT';
  END IF;

  -- ── Validate: plan_code, if supplied, must exist in plans table ───────────
  IF p_new_plan_code IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.plans WHERE code = p_new_plan_code) THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_PLAN_CODE';
    END IF;
  END IF;

  -- ── Resolve admin email for audit row ────────────────────────────────────
  SELECT email INTO v_admin_email
  FROM public.platform_admins
  WHERE user_id = auth.uid();

  -- ── Update tenant_subscriptions ──────────────────────────────────────────
  -- Does NOT auto-reactivate suspended tenants (separate explicit action).
  -- grace_expires_at is a GENERATED column (expires_at + interval '7 days'
  -- per the actual column definition — not the '14 days' in the original
  -- brief). It auto-recomputes when expires_at changes; DO NOT set it here.
  UPDATE public.tenant_subscriptions
  SET
    expires_at = p_new_expires_at,
    plan_code  = COALESCE(p_new_plan_code, plan_code),
    notes      = COALESCE(p_notes, notes),
    updated_at = now(),
    updated_by = auth.uid()
  WHERE tenant_id = p_tenant_id
  RETURNING plan_code INTO v_final_plan;

  -- ── Audit log ─────────────────────────────────────────────────────────────
  INSERT INTO public.platform_admin_audit
    (admin_user_id, admin_email, tenant_id, action, detail)
  VALUES (
    auth.uid(),
    v_admin_email,
    p_tenant_id,
    'RENEW_SUBSCRIPTION',
    jsonb_build_object(
      'new_expires_at', p_new_expires_at,
      'new_plan_code',  p_new_plan_code,
      'notes',          p_notes
    )
  );

  -- ── Return ────────────────────────────────────────────────────────────────
  -- new_grace_expires_at derived from the generated column's formula
  -- (expires_at + 7 days). FE can also read grace_expires_at directly from
  -- v_tenant_effective_features on the next fetch.
  RETURN jsonb_build_object(
    'ok',                   true,
    'tenant_id',            p_tenant_id,
    'new_expires_at',       p_new_expires_at,
    'new_grace_expires_at', p_new_expires_at + interval '7 days',
    'plan_code',            v_final_plan
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.renew_subscription(uuid, date, text, text) FROM PUBLIC;
ALTER FUNCTION  public.renew_subscription(uuid, date, text, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.renew_subscription(uuid, date, text, text) TO authenticated;

COMMENT ON FUNCTION public.renew_subscription(uuid, date, text, text) IS
  'category=P; Wave 4a Task 1. Extends a tenant subscription: updates expires_at, '
  'grace_expires_at (+14d), optionally changes plan_code. '
  'Does NOT auto-reactivate SUSPENDED tenants. '
  'Requires platform-admin JWT (P0403). '
  'Validates tenant (P0404), future date (22023), plan code (22023). '
  'Writes RENEW_SUBSCRIPTION audit row.';

COMMIT;
