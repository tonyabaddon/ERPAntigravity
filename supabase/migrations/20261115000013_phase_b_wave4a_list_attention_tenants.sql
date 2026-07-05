-- Phase B Wave 4a — Task 4
-- list_attention_tenants(p_expiry_within_days int DEFAULT 45) — read-only.
-- Feeds AttentionQueue on AdminHome dashboard.
--
-- Read-only, no auth-schema access, no audit. Owned by vosi_rpc_owner
-- (Wave 1 read-RPC pattern). Wave 1 RLS gap fix (20261115000002c) already
-- gives vosi_rpc_owner supplementary read access on tenants + tenant_subscriptions.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_attention_tenants(
  p_expiry_within_days int DEFAULT 45
)
RETURNS TABLE (
  tenant_id          uuid,
  slug               text,
  name               text,
  plan_code          text,
  status             text,
  expires_at         date,
  days_until_expiry  int,
  attention_reason   text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
  END IF;

  IF p_expiry_within_days < 1 OR p_expiry_within_days > 365 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_RANGE';
  END IF;

  RETURN QUERY
  SELECT
    t.id                                                       AS tenant_id,
    t.slug                                                     AS slug,
    t.name                                                     AS name,
    ts.plan_code                                               AS plan_code,
    t.status                                                   AS status,
    ts.expires_at                                              AS expires_at,
    (ts.expires_at - CURRENT_DATE)::int                        AS days_until_expiry,
    CASE
      WHEN t.status = 'SUSPENDED' AND ts.expires_at <= CURRENT_DATE
        THEN 'EXPIRED_AND_SUSPENDED'
      WHEN t.status = 'SUSPENDED'
        THEN 'SUSPENDED'
      ELSE 'EXPIRING'
    END                                                        AS attention_reason
  FROM public.tenants t
  JOIN public.tenant_subscriptions ts ON ts.tenant_id = t.id
  WHERE t.status <> 'ARCHIVED'
    AND (
      ts.expires_at <= (CURRENT_DATE + p_expiry_within_days)::date
      OR t.status = 'SUSPENDED'
    )
  ORDER BY days_until_expiry ASC NULLS LAST, name;

END;
$$;

REVOKE ALL ON FUNCTION public.list_attention_tenants(int) FROM PUBLIC;
ALTER FUNCTION  public.list_attention_tenants(int) OWNER TO vosi_rpc_owner;
GRANT EXECUTE ON FUNCTION public.list_attention_tenants(int) TO authenticated;

COMMENT ON FUNCTION public.list_attention_tenants(int) IS
  'category=P; Wave 4a Task 4. Returns tenants requiring super-admin attention: '
  'expiring within N days (1-365, default 45) OR currently SUSPENDED. '
  'Excludes ARCHIVED. attention_reason enum: SUSPENDED / EXPIRED_AND_SUSPENDED / '
  'EXPIRING. Sorted by days_until_expiry ASC NULLS LAST, then name. '
  'Requires platform-admin JWT (P0403). Range validated (22023).';

COMMIT;
