-- 20261115000051_admin_impersonation_status_rpc.sql
--
-- F-10 Phase 2c: helper RPC for the VOSI Admin tenants list.
--
-- After Phase 2a landed, the Impersonate button on the admin tenants list
-- would silently fire IMPERSONATION_NOT_GRANTED on tenants the caller has
-- neither a native seat nor an active grant on. Better UX: show status per
-- row up-front, disable the button when blocked, and let the admin see
-- exactly why.
--
-- This RPC takes a list of slugs and returns per-row status:
--   'native' — admin has a tenant_users seat (impersonate always allowed)
--   'grant'  — admin has an active grant (impersonate allowed until expiry)
--   'blocked' — no seat, no active grant (impersonate would fail)
--
-- Caller must be an active platform_admin. Uses SECDEF postgres to read
-- across tenants freely (this is admin-only surface — cross-tenant read
-- is intentional here).

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_impersonation_access_status(p_slugs text[])
RETURNS TABLE (
  slug        text,
  status      text,
  expires_at  timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
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

  RETURN QUERY
  WITH input_slugs AS (
    SELECT unnest(p_slugs) AS s
  ),
  scoped AS (
    SELECT t.id, t.slug
    FROM public.tenants t
    JOIN input_slugs ON input_slugs.s = t.slug
  )
  SELECT
    sc.slug,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM public.tenant_users
        WHERE tenant_id = sc.id
          AND user_id = v_uid
          AND status = 'ACTIVE'
      ) THEN 'native'
      WHEN EXISTS (
        SELECT 1 FROM public.tenant_impersonation_grants
        WHERE tenant_id = sc.id
          AND admin_user_id = v_uid
          AND revoked_at IS NULL
          AND expires_at > now()
      ) THEN 'grant'
      ELSE 'blocked'
    END AS status,
    (
      SELECT MIN(expires_at)
      FROM public.tenant_impersonation_grants
      WHERE tenant_id = sc.id
        AND admin_user_id = v_uid
        AND revoked_at IS NULL
        AND expires_at > now()
    ) AS expires_at
  FROM scoped sc;
END $$;

REVOKE ALL ON FUNCTION public.admin_impersonation_access_status(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_impersonation_access_status(text[]) TO authenticated;

COMMIT;
