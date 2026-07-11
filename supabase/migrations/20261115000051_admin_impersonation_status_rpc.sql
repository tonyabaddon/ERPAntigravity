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
-- across tenants freely (admin-only surface, cross-tenant read is
-- intentional here).
--
-- ---------------------------------------------------------------------------
-- OUT column naming
-- ---------------------------------------------------------------------------
-- Column names `slug` and `status` clash with real column names on
-- public.tenants and public.platform_admins/tenant_users. Postgres flags an
-- unqualified reference to either inside the function body as
--     42702: column reference "status" is ambiguous
-- (the PL/pgSQL OUT-parameter variable is considered a variable, and the
-- table column is considered a column). Even qualifying every occurrence
-- is fragile — one missed `WHERE status = ...` and the RPC breaks
-- silently at runtime. Rename the OUT columns to `out_slug` / `out_status`
-- / `out_expires_at` so the clash cannot recur. Frontend remaps to its
-- expected shape.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_impersonation_access_status(p_slugs text[])
RETURNS TABLE (
  out_slug        text,
  out_status      text,
  out_expires_at  timestamptz
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
    SELECT 1 FROM public.platform_admins pa
    WHERE pa.user_id = v_uid AND pa.status = 'active'
  ) THEN
    RAISE EXCEPTION 'NOT_PLATFORM_ADMIN' USING errcode = 'P0403';
  END IF;

  RETURN QUERY
  WITH input_slugs AS (
    SELECT unnest(p_slugs) AS s
  ),
  scoped AS (
    SELECT t.id AS tid, t.slug AS tslug
    FROM public.tenants t
    JOIN input_slugs ON input_slugs.s = t.slug
  )
  SELECT
    sc.tslug,
    (CASE
      WHEN EXISTS (
        SELECT 1 FROM public.tenant_users tu
        WHERE tu.tenant_id = sc.tid
          AND tu.user_id = v_uid
          AND tu.status = 'ACTIVE'
      ) THEN 'native'
      WHEN EXISTS (
        SELECT 1 FROM public.tenant_impersonation_grants g
        WHERE g.tenant_id = sc.tid
          AND g.admin_user_id = v_uid
          AND g.revoked_at IS NULL
          AND g.expires_at > now()
      ) THEN 'grant'
      ELSE 'blocked'
    END)::text,
    (
      SELECT MIN(g2.expires_at)
      FROM public.tenant_impersonation_grants g2
      WHERE g2.tenant_id = sc.tid
        AND g2.admin_user_id = v_uid
        AND g2.revoked_at IS NULL
        AND g2.expires_at > now()
    )
  FROM scoped sc;
END $$;

REVOKE ALL ON FUNCTION public.admin_impersonation_access_status(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_impersonation_access_status(text[]) TO authenticated;

COMMIT;
