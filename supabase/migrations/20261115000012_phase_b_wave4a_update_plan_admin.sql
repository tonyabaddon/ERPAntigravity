BEGIN;

-- ============================================================
-- Phase B Wave 4a — Task 3
-- _assert_super_admin_from_jwt() helper + update_plan_admin(code, updates)
--
-- Schema drift corrections applied here:
--   • platform_admin_audit.tenant_id was NOT NULL in live schema.
--     Brief assumed nullable ("Wave 1 Task 3 confirmed it is") but that
--     assumption was wrong. Relaxing to nullable here — UPDATE_PLAN is
--     the first platform-scoped action that has no target tenant.
--
-- Ownership: both functions call auth.uid() and/or SELECT from
-- platform_admins. vosi_rpc_owner cannot access the auth schema
-- (supabase_admin owns it; postgres lacks WITH GRANT OPTION on
-- schema ACL). Both owned by postgres, same pattern as Tasks 1+2.
-- ============================================================

-- ── Step 1: Relax tenant_id NOT NULL ────────────────────────────────────────
ALTER TABLE public.platform_admin_audit
  ALTER COLUMN tenant_id DROP NOT NULL;

-- ── Step 2: Extend platform_admin_audit action CHECK whitelist ───────────────
-- Cumulative set (union of all prior slots + Task 3 addition):
--   Wave 1 seed:     IMPERSONATE_START, IMPERSONATE_END, CREATE_TENANT,
--                    CHANGE_PLAN, CHANGE_FEATURES, SUSPEND, ACTIVATE, ARCHIVE
--   Wave 4a Task 1:  RENEW_SUBSCRIPTION
--   Wave 4a Task 2:  SUSPEND_TENANT, ACTIVATE_TENANT
--   Wave 4a Task 3:  UPDATE_PLAN  (this migration)

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
      'ACTIVATE_TENANT'::text,
      'UPDATE_PLAN'::text
    ]));

-- ── Step 3: _assert_super_admin_from_jwt() helper ───────────────────────────
-- Returns void on success; raises P0403 SUPER_ADMIN_REQUIRED if the JWT sub
-- is not a platform_admins row with role='super_admin'.
-- STABLE (same volatility as _is_platform_admin_from_jwt).
-- NOT SECURITY DEFINER — called from within SECDEF callers; runs in their role.
-- Owned by postgres for consistency with all other auth-adjacent helpers.

CREATE OR REPLACE FUNCTION public._assert_super_admin_from_jwt()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_sub  text;
  v_role text;
BEGIN
  -- Read sub from JWT claims GUC
  v_sub := current_setting('request.jwt.claims', true)::jsonb ->> 'sub';

  IF v_sub IS NULL OR v_sub = '' THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'SUPER_ADMIN_REQUIRED';
  END IF;

  -- Look up role in platform_admins
  SELECT role INTO v_role
  FROM public.platform_admins
  WHERE user_id = v_sub::uuid;

  IF v_role IS NULL OR v_role <> 'super_admin' THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'SUPER_ADMIN_REQUIRED';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_super_admin_from_jwt() FROM PUBLIC;
ALTER FUNCTION  public._assert_super_admin_from_jwt() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public._assert_super_admin_from_jwt() TO authenticated;

COMMENT ON FUNCTION public._assert_super_admin_from_jwt() IS
  'category=P; Wave 4a Task 3. Internal helper: reads sub from request.jwt.claims, '
  'looks up platform_admins.role. Raises P0403 SUPER_ADMIN_REQUIRED if not super_admin. '
  'Returns void on success. STABLE. Owned by postgres for auth-schema consistency.';

-- ── Step 4: update_plan_admin RPC ───────────────────────────────────────────
-- Double-gated: (1) platform admin, (2) super admin.
-- Validates p_plan_code IN (STARTER, PRO, PREMIUM).
-- Validates p_updates keys against whitelist.
-- Updates plans using per-key CASE-WHEN (no dynamic SQL, no injection surface).
-- Audit INSERT: action='UPDATE_PLAN', tenant_id=NULL (platform-scoped).

CREATE OR REPLACE FUNCTION public.update_plan_admin(
  p_plan_code text,
  p_updates   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_admin_email   text;
  v_unknown_keys  text[];
  v_allowed_keys  text[] := ARRAY[
    'name', 'description', 'target_segment', 'price_reference',
    'feature_bundle', 'is_recommended', 'is_active', 'sort_order'
  ];
BEGIN
  -- ── Gate 1: platform admin ────────────────────────────────────────────────
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
  END IF;

  -- ── Gate 2: super admin ───────────────────────────────────────────────────
  PERFORM public._assert_super_admin_from_jwt();

  -- ── Validate: plan_code ───────────────────────────────────────────────────
  IF p_plan_code NOT IN ('STARTER', 'PRO', 'PREMIUM') THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_PLAN_CODE';
  END IF;

  -- ── Validate: p_updates key whitelist ─────────────────────────────────────
  SELECT ARRAY_AGG(k)
  INTO v_unknown_keys
  FROM jsonb_object_keys(p_updates) AS k
  WHERE k <> ALL(v_allowed_keys);

  IF v_unknown_keys IS NOT NULL AND array_length(v_unknown_keys, 1) > 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'UNKNOWN_FIELD';
  END IF;

  -- ── Resolve admin email for audit row ────────────────────────────────────
  SELECT email INTO v_admin_email
  FROM public.platform_admins
  WHERE user_id = auth.uid();

  -- ── UPDATE plans — per-key CASE-WHEN, no dynamic SQL ─────────────────────
  UPDATE public.plans
  SET
    name            = CASE WHEN p_updates ? 'name'
                           THEN p_updates ->>'name'
                           ELSE name END,
    description     = CASE WHEN p_updates ? 'description'
                           THEN p_updates ->>'description'
                           ELSE description END,
    target_segment  = CASE WHEN p_updates ? 'target_segment'
                           THEN p_updates ->>'target_segment'
                           ELSE target_segment END,
    price_reference = CASE WHEN p_updates ? 'price_reference'
                           THEN (p_updates ->>'price_reference')::numeric
                           ELSE price_reference END,
    feature_bundle  = CASE WHEN p_updates ? 'feature_bundle'
                           THEN p_updates ->'feature_bundle'
                           ELSE feature_bundle END,
    is_recommended  = CASE WHEN p_updates ? 'is_recommended'
                           THEN (p_updates ->>'is_recommended')::boolean
                           ELSE is_recommended END,
    is_active       = CASE WHEN p_updates ? 'is_active'
                           THEN (p_updates ->>'is_active')::boolean
                           ELSE is_active END,
    sort_order      = CASE WHEN p_updates ? 'sort_order'
                           THEN (p_updates ->>'sort_order')::int
                           ELSE sort_order END,
    updated_at      = now(),
    updated_by      = auth.uid()
  WHERE code = p_plan_code;

  -- ── Audit log: platform-scoped (tenant_id = NULL) ─────────────────────────
  INSERT INTO public.platform_admin_audit
    (admin_user_id, admin_email, tenant_id, action, detail)
  VALUES (
    auth.uid(),
    v_admin_email,
    NULL,
    'UPDATE_PLAN',
    jsonb_build_object(
      'plan_code', p_plan_code,
      'updates',   p_updates
    )
  );

  -- ── Return ────────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'ok',           true,
    'plan_code',    p_plan_code,
    'updated_keys', ARRAY(SELECT jsonb_object_keys(p_updates))
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.update_plan_admin(text, jsonb) FROM PUBLIC;
ALTER FUNCTION  public.update_plan_admin(text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.update_plan_admin(text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.update_plan_admin(text, jsonb) IS
  'category=P; Wave 4a Task 3. Updates a plan row (STARTER/PRO/PREMIUM). '
  'Double-gated: platform admin (P0403) + super admin (P0403). '
  'Validates plan_code (22023 INVALID_PLAN_CODE), update key whitelist (22023 UNKNOWN_FIELD). '
  'Per-key CASE-WHEN UPDATE — no dynamic SQL. '
  'Writes UPDATE_PLAN audit row with tenant_id=NULL (platform-scoped). '
  'Returns {ok, plan_code, updated_keys}.';

COMMIT;
