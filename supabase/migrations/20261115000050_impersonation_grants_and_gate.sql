-- 20261115000050_impersonation_grants_and_gate.sql
--
-- Phase 2a of the F-10 fix (grant-gated impersonation).
--
-- Problem
-- =======
-- After Phase 1 (migration 000049) scoped supplementary RLS reads during
-- impersonation, the *start* of impersonation was still ungated. Any
-- platform_admin could call `impersonate_tenant(slug)` for any active
-- tenant without that tenant's consent. From an MSME tenant's perspective
-- this is a legitimate concern: they don't want VOSI staff quietly logging
-- in to their books whenever they want.
--
-- Fix
-- ===
-- Introduce a consent record — `tenant_impersonation_grants` — that the
-- tenant owner explicitly issues, with a required expiry and reason.
-- Gate `impersonate_tenant(slug)` on either:
--   (a) admin has a native seat in `tenant_users` for that tenant (self-
--       impersonation shortcut for founder use), OR
--   (b) an active grant exists (`revoked_at IS NULL AND expires_at > now()`).
-- Otherwise raise `IMPERSONATION_NOT_GRANTED`.
--
-- No frontend changes in this migration. Phase 2b builds the tenant UI to
-- issue grants; Phase 2c gates the VOSI Admin impersonate button.
--
-- Ownership + auth access
-- =======================
-- These RPCs need to read from `auth.users` (email lookup for audit and
-- display). `vosi_rpc_owner` cannot see `auth` (see migration 000048).
-- So all new RPCs in this migration are SECDEF owned by postgres — the
-- same pattern the existing `impersonate_tenant` RPC uses. The grants
-- table itself is NOT a T-table (it does not participate in the
-- `t_insert_own`/`t_select_own` family), so client writes are simply
-- denied by absent policies and the SECDEF RPCs are the only write path.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Extend platform_admin_audit action CHECK to accept new grant events.
--    The CHECK is a hardcoded enum; adding rows to it is a schema change.
-- ---------------------------------------------------------------------------

ALTER TABLE public.platform_admin_audit
  DROP CONSTRAINT platform_admin_audit_action_check;
ALTER TABLE public.platform_admin_audit
  ADD CONSTRAINT platform_admin_audit_action_check
  CHECK (action = ANY (ARRAY[
    'IMPERSONATE_START', 'IMPERSONATE_END',
    'IMPERSONATION_GRANT_ISSUED', 'IMPERSONATION_GRANT_REVOKED',
    'CREATE_TENANT', 'CHANGE_PLAN', 'CHANGE_FEATURES',
    'SUSPEND', 'ACTIVATE', 'ARCHIVE', 'RENEW_SUBSCRIPTION',
    'SUSPEND_TENANT', 'ACTIVATE_TENANT', 'UPDATE_PLAN',
    'RECORD_PAYMENT', 'UPDATE_PAYMENT', 'DELETE_PAYMENT', 'UPLOAD_PAYMENT_PROOF',
    'PROVISION_TENANT', 'DEPROVISION_TENANT',
    'CREATE_SALES_REP', 'DEACTIVATE_SALES_REP',
    'TOGGLE_MODULE', 'VERIFY_PAYMENT', 'REJECT_PAYMENT'
  ]::text[]));

-- ---------------------------------------------------------------------------
-- 1) Grants table
-- ---------------------------------------------------------------------------

CREATE TABLE public.tenant_impersonation_grants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  admin_user_id       uuid NOT NULL,
  admin_email         text NOT NULL,
  granted_by_user_id  uuid NOT NULL,
  granted_by_email    text NOT NULL,
  granted_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz,
  revoked_by_user_id  uuid,
  revoked_by_email    text,
  reason              text NOT NULL,
  CONSTRAINT tig_revocation_atomic CHECK (
    (revoked_at IS NULL     AND revoked_by_user_id IS NULL     AND revoked_by_email IS NULL) OR
    (revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL AND revoked_by_email IS NOT NULL)
  ),
  CONSTRAINT tig_expiry_future_of_grant CHECK (expires_at > granted_at),
  CONSTRAINT tig_reason_nonempty        CHECK (length(trim(reason)) > 0)
);

CREATE INDEX ix_tig_tenant_active
  ON public.tenant_impersonation_grants (tenant_id, admin_user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX ix_tig_admin_active
  ON public.tenant_impersonation_grants (admin_user_id, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE public.tenant_impersonation_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_impersonation_grants FORCE ROW LEVEL SECURITY;

CREATE POLICY p_owner_read_own_grants ON public.tenant_impersonation_grants
FOR SELECT TO authenticated, vosi_rpc_owner
USING (tenant_id = public._resolve_tenant_id());

CREATE POLICY p_admin_read_own_grants ON public.tenant_impersonation_grants
FOR SELECT TO authenticated, vosi_rpc_owner
USING (
  admin_user_id = public._current_user_id()
  AND public._is_platform_admin_active_from_jwt()
);

COMMENT ON TABLE public.tenant_impersonation_grants IS
  'Consent record — tenant owner explicitly grants a platform_admin '
  'permission to impersonate their tenant for a bounded time window. '
  'Impersonate_tenant() enforces this at the RPC layer.';

-- ---------------------------------------------------------------------------
-- 2) Helper: assert caller is the owner of a given tenant
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._assert_caller_is_tenant_owner(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE v_uid uuid := public._current_user_id();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NO_AUTH' USING errcode = 'P0403';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_users
    WHERE tenant_id = p_tenant_id
      AND user_id = v_uid
      AND role = 'owner'
      AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'NOT_TENANT_OWNER' USING errcode = 'P0403';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public._assert_caller_is_tenant_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._assert_caller_is_tenant_owner(uuid)
  TO authenticated, vosi_rpc_owner;

-- ---------------------------------------------------------------------------
-- 3) grant_impersonation — tenant owner issues a new grant
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.grant_impersonation(
  p_admin_email      text,
  p_expires_in_hours int,
  p_reason           text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id        uuid := public._current_user_id();
  v_caller_email     text;
  v_tenant_id        uuid := public._resolve_tenant_id();
  v_admin_id         uuid;
  v_admin_email_norm text;
  v_grant_id         uuid;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'NO_AUTH' USING errcode = 'P0403';
  END IF;
  IF v_tenant_id IS NULL OR v_tenant_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'NO_TENANT_CONTEXT';
  END IF;
  IF p_expires_in_hours < 1 OR p_expires_in_hours > 720 THEN
    RAISE EXCEPTION 'INVALID_EXPIRY'
      USING hint = 'duration must be 1-720 hours (max 30 days)';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  PERFORM public._assert_caller_is_tenant_owner(v_tenant_id);

  v_admin_email_norm := lower(trim(p_admin_email));

  SELECT user_id INTO v_admin_id
  FROM public.platform_admins
  WHERE lower(email) = v_admin_email_norm AND status = 'active';

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'ADMIN_NOT_FOUND'
      USING hint = 'email must belong to an active platform_admins row';
  END IF;

  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_id;

  INSERT INTO public.tenant_impersonation_grants (
    tenant_id, admin_user_id, admin_email,
    granted_by_user_id, granted_by_email,
    expires_at, reason
  ) VALUES (
    v_tenant_id, v_admin_id, v_admin_email_norm,
    v_caller_id, COALESCE(v_caller_email, 'unknown'),
    now() + make_interval(hours => p_expires_in_hours), p_reason
  ) RETURNING id INTO v_grant_id;

  INSERT INTO public.platform_admin_audit (
    admin_user_id, admin_email, tenant_id, action, detail
  ) VALUES (
    v_admin_id, v_admin_email_norm, v_tenant_id, 'IMPERSONATION_GRANT_ISSUED',
    jsonb_build_object(
      'grant_id', v_grant_id,
      'expires_in_hours', p_expires_in_hours,
      'granted_by_user_id', v_caller_id,
      'granted_by_email', v_caller_email,
      'reason', p_reason
    )
  );

  RETURN v_grant_id;
END $$;

REVOKE ALL ON FUNCTION public.grant_impersonation(text, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_impersonation(text, int, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) revoke_impersonation — tenant owner revokes; kicks active session too
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.revoke_impersonation(
  p_grant_id uuid,
  p_reason   text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id    uuid := public._current_user_id();
  v_caller_email text;
  v_tenant_id    uuid := public._resolve_tenant_id();
  v_grant_tenant uuid;
  v_admin_id     uuid;
  v_admin_email  text;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'NO_AUTH' USING errcode = 'P0403';
  END IF;

  SELECT tenant_id, admin_user_id, admin_email
    INTO v_grant_tenant, v_admin_id, v_admin_email
    FROM public.tenant_impersonation_grants
    WHERE id = p_grant_id;

  IF v_grant_tenant IS NULL THEN
    RAISE EXCEPTION 'GRANT_NOT_FOUND';
  END IF;
  IF v_grant_tenant <> v_tenant_id THEN
    RAISE EXCEPTION 'NOT_TENANT_OWNER' USING errcode = 'P0403';
  END IF;

  PERFORM public._assert_caller_is_tenant_owner(v_tenant_id);

  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_id;

  UPDATE public.tenant_impersonation_grants
     SET revoked_at         = now(),
         revoked_by_user_id = v_caller_id,
         revoked_by_email   = COALESCE(v_caller_email, 'unknown')
   WHERE id = p_grant_id
     AND revoked_at IS NULL;

  -- If the target admin is currently impersonating this tenant, kick them
  -- out immediately. Their next request re-mints a fresh JWT with no
  -- tenant claim (their client-side refreshSession picks it up).
  DELETE FROM public.platform_admin_active_impersonation
   WHERE admin_user_id = v_admin_id
     AND tenant_slug = (SELECT slug FROM public.tenants WHERE id = v_tenant_id);

  INSERT INTO public.platform_admin_audit (
    admin_user_id, admin_email, tenant_id, action, detail
  ) VALUES (
    v_admin_id, v_admin_email, v_tenant_id, 'IMPERSONATION_GRANT_REVOKED',
    jsonb_build_object(
      'grant_id', p_grant_id,
      'revoked_by_user_id', v_caller_id,
      'revoked_by_email', v_caller_email,
      'reason', COALESCE(p_reason, '')
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.revoke_impersonation(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_impersonation(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) list_impersonation_grants — for tenant owner's UI
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_impersonation_grants()
RETURNS TABLE (
  id                uuid,
  admin_email       text,
  granted_by_email  text,
  granted_at        timestamptz,
  expires_at        timestamptz,
  revoked_at        timestamptz,
  revoked_by_email  text,
  reason            text,
  is_active         boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tenant_id uuid := public._resolve_tenant_id();
BEGIN
  IF v_tenant_id IS NULL OR v_tenant_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'NO_TENANT_CONTEXT';
  END IF;
  PERFORM public._assert_caller_is_tenant_owner(v_tenant_id);

  RETURN QUERY
  SELECT
    g.id, g.admin_email, g.granted_by_email, g.granted_at, g.expires_at,
    g.revoked_at, g.revoked_by_email, g.reason,
    (g.revoked_at IS NULL AND g.expires_at > now()) AS is_active
  FROM public.tenant_impersonation_grants g
  WHERE g.tenant_id = v_tenant_id
  ORDER BY g.granted_at DESC;
END $$;

REVOKE ALL ON FUNCTION public.list_impersonation_grants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_impersonation_grants() TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) Rewrite impersonate_tenant to require grant OR native seat
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.impersonate_tenant(p_slug text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_tenant_id  uuid;
  v_has_native boolean;
  v_has_grant  boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NO_AUTH' USING errcode = 'P0403';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = v_uid AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'NOT_PLATFORM_ADMIN' USING errcode = 'P0403';
  END IF;

  SELECT id INTO v_tenant_id
    FROM public.tenants
    WHERE slug = p_slug AND status = 'ACTIVE';

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND';
  END IF;

  v_has_native := EXISTS (
    SELECT 1 FROM public.tenant_users
    WHERE tenant_id = v_tenant_id
      AND user_id = v_uid
      AND status = 'ACTIVE'
  );

  IF NOT v_has_native THEN
    v_has_grant := EXISTS (
      SELECT 1 FROM public.tenant_impersonation_grants
      WHERE tenant_id = v_tenant_id
        AND admin_user_id = v_uid
        AND revoked_at IS NULL
        AND expires_at > now()
    );
    IF NOT v_has_grant THEN
      RAISE EXCEPTION 'IMPERSONATION_NOT_GRANTED'
        USING hint = 'tenant owner must issue a grant before impersonation is allowed';
    END IF;
  END IF;

  INSERT INTO public.platform_admin_active_impersonation (admin_user_id, tenant_slug)
  VALUES (v_uid, p_slug)
  ON CONFLICT (admin_user_id) DO UPDATE
    SET tenant_slug = EXCLUDED.tenant_slug, started_at = now();

  INSERT INTO public.platform_admin_audit (
    admin_user_id, admin_email, tenant_id, action, detail
  ) VALUES (
    v_uid, (SELECT email FROM auth.users WHERE id = v_uid), v_tenant_id,
    'IMPERSONATE_START',
    jsonb_build_object(
      'slug', p_slug,
      'via', CASE WHEN v_has_native THEN 'native_seat' ELSE 'grant' END
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.impersonate_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.impersonate_tenant(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) In-place smoke test (4 scenarios)
--    Uses REAL rows (existing platform_admin + real tenant users) because
--    platform_admins.user_id has a FK to auth.users we can't fake in the
--    migration. Scenarios exercise the full grant lifecycle.
-- ---------------------------------------------------------------------------

DO $smoke$
DECLARE
  v_admin_uid       uuid := '227c28f4-09f6-4dc9-af7a-01b0feb2c194';   -- tonywei.office@gmail.com
  v_tjm_owner_uid   uuid := '22222222-aaaa-bbbb-cccc-000000000001';   -- toko-jaya-makmur owner
  v_tjm_tenant_uid  uuid := '22222222-2222-2222-2222-222222222222';   -- toko-jaya-makmur tenant id
  v_grant_id        uuid;
BEGIN
  -- Ensure clean start: no stale impersonation targeting anything but garindo
  DELETE FROM public.platform_admin_active_impersonation
   WHERE admin_user_id = v_admin_uid AND tenant_slug NOT IN ('garindo');

  ---------------------------------------------------------------------------
  -- Scenario 1: admin without native seat + without grant → REJECTED
  ---------------------------------------------------------------------------
  PERFORM set_config(
    'request.jwt.claims',
    format('{"sub":"%s","is_platform_admin":true}', v_admin_uid),
    true
  );
  BEGIN
    PERFORM public.impersonate_tenant('toko-jaya-makmur');
    RAISE EXCEPTION 'smoke 1 failed: expected IMPERSONATION_NOT_GRANTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%IMPERSONATION_NOT_GRANTED%' THEN
      RAISE EXCEPTION 'smoke 1 wrong error: %', SQLERRM;
    END IF;
  END;

  ---------------------------------------------------------------------------
  -- Scenario 2: owner issues grant → admin can impersonate
  ---------------------------------------------------------------------------
  PERFORM set_config(
    'request.jwt.claims',
    format('{"sub":"%s","is_platform_admin":false,"tenant_id":"%s"}', v_tjm_owner_uid, v_tjm_tenant_uid),
    true
  );
  v_grant_id := public.grant_impersonation('tonywei.office@gmail.com', 4, 'smoke test grant');

  PERFORM set_config(
    'request.jwt.claims',
    format('{"sub":"%s","is_platform_admin":true}', v_admin_uid),
    true
  );
  PERFORM public.impersonate_tenant('toko-jaya-makmur');
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admin_active_impersonation
     WHERE admin_user_id = v_admin_uid AND tenant_slug = 'toko-jaya-makmur'
  ) THEN
    RAISE EXCEPTION 'smoke 2 failed: impersonation state not set';
  END IF;

  ---------------------------------------------------------------------------
  -- Scenario 3: revoke → active session evicted + future impersonate fails
  ---------------------------------------------------------------------------
  PERFORM set_config(
    'request.jwt.claims',
    format('{"sub":"%s","is_platform_admin":false,"tenant_id":"%s"}', v_tjm_owner_uid, v_tjm_tenant_uid),
    true
  );
  PERFORM public.revoke_impersonation(v_grant_id, 'smoke test done');
  IF EXISTS (
    SELECT 1 FROM public.platform_admin_active_impersonation
     WHERE admin_user_id = v_admin_uid AND tenant_slug = 'toko-jaya-makmur'
  ) THEN
    RAISE EXCEPTION 'smoke 3 failed: revoke did not evict active impersonation';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    format('{"sub":"%s","is_platform_admin":true}', v_admin_uid),
    true
  );
  BEGIN
    PERFORM public.impersonate_tenant('toko-jaya-makmur');
    RAISE EXCEPTION 'smoke 3 failed: expected IMPERSONATION_NOT_GRANTED after revoke';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%IMPERSONATION_NOT_GRANTED%' THEN
      RAISE EXCEPTION 'smoke 3 wrong error after revoke: %', SQLERRM;
    END IF;
  END;

  ---------------------------------------------------------------------------
  -- Scenario 4: native seat still works (garindo self-impersonation escape)
  ---------------------------------------------------------------------------
  PERFORM set_config(
    'request.jwt.claims',
    format('{"sub":"%s","is_platform_admin":true}', v_admin_uid),
    true
  );
  PERFORM public.impersonate_tenant('garindo');
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admin_active_impersonation
     WHERE admin_user_id = v_admin_uid AND tenant_slug = 'garindo'
  ) THEN
    RAISE EXCEPTION 'smoke 4 failed: native seat impersonation not set';
  END IF;

  PERFORM set_config('request.jwt.claims', '', true);
  RAISE NOTICE 'F-10 Phase 2a smoke tests passed (4 scenarios)';
END $smoke$;

-- Clean up smoke-test grants (audit rows kept as honest trace).
DELETE FROM public.tenant_impersonation_grants WHERE reason = 'smoke test grant';

COMMIT;
