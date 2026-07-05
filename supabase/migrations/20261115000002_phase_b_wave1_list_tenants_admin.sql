BEGIN;

-- ============================================================
-- Phase B Wave 1 — Task 2
-- v_tenant_usage_summary VIEW + list_tenants_admin() RPC
-- Drift A: transaction_count → writes
-- Drift B: expiry_mode sourced from v_tenant_effective_features.expiry_state
-- ============================================================

-- Usage summary view: per-tenant last_login + txn_7d (writes) + usage_status
CREATE OR REPLACE VIEW public.v_tenant_usage_summary AS
SELECT
  t.id AS tenant_id,
  (
    SELECT MAX(u.last_sign_in_at)
    FROM public.tenant_users tu
    JOIN auth.users u ON u.id = tu.user_id
    WHERE tu.tenant_id = t.id
  ) AS last_login_at,
  COALESCE(
    (SELECT SUM(tad.writes)::INT
     FROM public.tenant_activity_daily tad
     WHERE tad.tenant_id = t.id
       AND tad.activity_date >= CURRENT_DATE - INTERVAL '7 days'),
    0
  ) AS txn_7d,
  COALESCE(
    (SELECT ROUND(SUM(tad.writes)::NUMERIC / 7, 1)
     FROM public.tenant_activity_daily tad
     WHERE tad.tenant_id = t.id
       AND tad.activity_date >= CURRENT_DATE - INTERVAL '7 days'),
    0::NUMERIC
  ) AS avg_daily_txn,
  CASE
    WHEN COALESCE(
           (SELECT ROUND(SUM(tad.writes)::NUMERIC / 7, 1)
            FROM public.tenant_activity_daily tad
            WHERE tad.tenant_id = t.id
              AND tad.activity_date >= CURRENT_DATE - INTERVAL '7 days'),
           0::NUMERIC
         ) > 100                                                      THEN 'SANGAT_AKTIF'
    WHEN COALESCE(
           (SELECT ROUND(SUM(tad.writes)::NUMERIC / 7, 1)
            FROM public.tenant_activity_daily tad
            WHERE tad.tenant_id = t.id
              AND tad.activity_date >= CURRENT_DATE - INTERVAL '7 days'),
           0::NUMERIC
         ) >= 1                                                        THEN 'AKTIF'
    WHEN (
           SELECT MAX(u.last_sign_in_at)
           FROM public.tenant_users tu
           JOIN auth.users u ON u.id = tu.user_id
           WHERE tu.tenant_id = t.id
         ) IS NULL
      OR (
           SELECT MAX(u.last_sign_in_at)
           FROM public.tenant_users tu
           JOIN auth.users u ON u.id = tu.user_id
           WHERE tu.tenant_id = t.id
         ) < NOW() - INTERVAL '30 days'                              THEN 'VAKUM'
    ELSE 'IDLE'
  END AS usage_status
FROM public.tenants t;

COMMENT ON VIEW public.v_tenant_usage_summary IS
  'category=P; Wave 1 per-tenant activity summary: last_login, txn_7d (writes), avg_daily_txn, usage_status.';

-- ============================================================
-- list_tenants_admin(p_filters jsonb)
-- Paginated + filtered + sorted tenant list for platform admin.
-- Drift B: expiry_mode = v_tenant_effective_features.expiry_state
-- ============================================================
CREATE OR REPLACE FUNCTION public.list_tenants_admin(
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  tenant_id           UUID,
  slug                TEXT,
  name                TEXT,
  plan_code           TEXT,
  status              TEXT,
  expiry_mode         TEXT,
  activated_at        DATE,
  expires_at          DATE,
  days_until_expiry   INT,
  user_count          INT,
  sku_count           INT,
  industry            TEXT,
  employee_range      TEXT,
  onboarded_at        TIMESTAMPTZ,
  last_login_at       TIMESTAMPTZ,
  txn_7d              INT,
  avg_daily_txn       NUMERIC,
  usage_status        TEXT,
  total_count         BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
  v_search       TEXT    := NULLIF(TRIM(p_filters->>'search'), '');
  v_plan_code    TEXT    := NULLIF(TRIM(p_filters->>'plan_code'), '');
  v_status       TEXT    := NULLIF(TRIM(p_filters->>'status'), '');
  v_expiry_max   INT     := (p_filters->>'expiry_within_days')::INT;
  v_page         INT     := COALESCE((p_filters->>'page')::INT, 1);
  v_page_size    INT     := COALESCE((p_filters->>'page_size')::INT, 50);
  v_sort_by_raw  TEXT    := COALESCE(NULLIF(TRIM(p_filters->>'sort_by'), ''), 'name');
  -- Map public-facing sort keys to CTE column aliases (created_at → onboarded_at)
  v_sort_by      TEXT    := CASE COALESCE(NULLIF(TRIM(p_filters->>'sort_by'), ''), 'name')
                              WHEN 'created_at' THEN 'onboarded_at'
                              ELSE COALESCE(NULLIF(TRIM(p_filters->>'sort_by'), ''), 'name')
                            END;
  v_sort_dir     TEXT    := LOWER(COALESCE(NULLIF(TRIM(p_filters->>'sort_dir'), ''), 'asc'));
  v_allowed_keys TEXT[]  := ARRAY[
    'search','plan_code','status','expiry_within_days',
    'page','page_size','sort_by','sort_dir'
  ];
  -- Public-facing allowed sort keys (before alias mapping)
  v_allowed_sort TEXT[]  := ARRAY['name','created_at','plan_code','expires_at','last_login_at'];
  v_key          TEXT;
BEGIN
  -- Gate: platform admin only
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
  END IF;

  -- Validate p_filters keys (whitelist)
  FOR v_key IN SELECT jsonb_object_keys(p_filters)
  LOOP
    IF v_key <> ALL(v_allowed_keys) THEN
      RAISE EXCEPTION 'Invalid filter key: %', v_key
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Validate sort_by (check raw input before alias mapping)
  IF v_sort_by_raw <> ALL(v_allowed_sort) THEN
    RAISE EXCEPTION 'Invalid sort_by value: %', v_sort_by_raw
      USING ERRCODE = '22023';
  END IF;

  -- Validate sort_dir
  IF v_sort_dir NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'sort_dir must be asc or desc'
      USING ERRCODE = '22023';
  END IF;

  -- Clamp page / page_size
  v_page      := GREATEST(v_page, 1);
  v_page_size := LEAST(GREATEST(v_page_size, 1), 200);

  RETURN QUERY EXECUTE format(
    $dyn$
    WITH base AS (
      SELECT
        t.id                                            AS tenant_id,
        t.slug,
        t.name,
        ts.plan_code,
        t.status,
        vef.expiry_state                                AS expiry_mode,
        ts.activated_at,
        ts.expires_at,
        (ts.expires_at - CURRENT_DATE)::INT             AS days_until_expiry,
        (SELECT COUNT(*)::INT
         FROM public.tenant_users tu
         WHERE tu.tenant_id = t.id)                     AS user_count,
        COALESCE(
          (SELECT COUNT(*)::INT
           FROM public.stocks s
           WHERE s.tenant_id = t.id), 0)               AS sku_count,
        cs.industry,
        cs.employee_range,
        t.created_at                                    AS onboarded_at,
        us.last_login_at,
        us.txn_7d,
        us.avg_daily_txn,
        us.usage_status
      FROM public.tenants t
      LEFT JOIN public.tenant_subscriptions ts
             ON ts.tenant_id = t.id
      LEFT JOIN public.v_tenant_effective_features vef
             ON vef.tenant_id = t.id
      LEFT JOIN public.company_settings cs
             ON cs.tenant_id = t.id
      LEFT JOIN public.v_tenant_usage_summary us
             ON us.tenant_id = t.id
      WHERE
        ($1 IS NULL OR t.slug ILIKE '%%' || $1 || '%%' OR t.name ILIKE '%%' || $1 || '%%')
        AND ($2 IS NULL OR ts.plan_code = $2)
        AND ($3 IS NULL OR t.status = $3)
        AND ($4 IS NULL OR (ts.expires_at - CURRENT_DATE) <= $4)
    )
    SELECT
      b.tenant_id,
      b.slug,
      b.name,
      b.plan_code,
      b.status,
      b.expiry_mode,
      b.activated_at,
      b.expires_at,
      b.days_until_expiry,
      b.user_count,
      b.sku_count,
      b.industry,
      b.employee_range,
      b.onboarded_at,
      b.last_login_at,
      b.txn_7d,
      b.avg_daily_txn,
      b.usage_status,
      COUNT(*) OVER ()                                  AS total_count
    FROM base b
    ORDER BY %I %s
    LIMIT $5 OFFSET $6
    $dyn$,
    v_sort_by,
    v_sort_dir
  )
  USING
    v_search,
    v_plan_code,
    v_status,
    v_expiry_max,
    v_page_size,
    (v_page - 1) * v_page_size;
END;
$$;

REVOKE ALL ON FUNCTION public.list_tenants_admin(jsonb) FROM PUBLIC;
ALTER FUNCTION  public.list_tenants_admin(jsonb) OWNER TO vosi_rpc_owner;
GRANT EXECUTE ON FUNCTION public.list_tenants_admin(jsonb) TO authenticated;

COMMENT ON FUNCTION public.list_tenants_admin(jsonb) IS
  'category=P; Wave 1 super-admin tenant list with filters, sort, pagination. '
  'Accepted filter keys: search, plan_code, status, expiry_within_days, page, page_size, sort_by, sort_dir. '
  'Drift A: uses tenant_activity_daily.writes as transaction proxy. '
  'Drift B: expiry_mode sourced from v_tenant_effective_features.expiry_state.';

COMMIT;
