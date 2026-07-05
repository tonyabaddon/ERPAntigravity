BEGIN;

-- ============================================================
-- Phase B Wave 5 — Task 5
-- list_payments + get_revenue_stats read RPCs
--
-- Schema facts verified before writing:
--   • tenant_payments columns: id, tenant_id, amount, currency,
--     payment_method, bank_name, ewallet_provider, payment_date,
--     period_from, period_to, proof_url, bank_reference, notes,
--     recorded_by_admin, audit_id, created_at, updated_at
--   • tenant_subscriptions.plan_code exists; no status column
--   • tenants: id, slug, name (confirmed via MCP)
--   • tenant_payments RLS: only p_platform_admin_only exists
--     (the 20261115000002c DO-loop ran before tenant_payments existed)
--     → must add p_tenant_owner_read for tenant-owner branch
--   • plans g_read_all already includes vosi_rpc_owner (002c Part 2)
--   • storage.create_signed_url / *sign* functions: DO NOT EXIST
--     → generate_payment_proof_signed_url is NOT implemented;
--       documented as DONE_WITH_CONCERNS; FE falls back to
--       supabase.storage.from('payment-proofs').createSignedUrl()
-- ============================================================

-- ── Step 1: Supplementary RLS policy for tenant-owner reads ──────────────────
-- p_platform_admin_only (existing) covers platform admins via
-- _is_platform_admin_from_jwt().  Tenant owners need SELECT access
-- scoped to their own tenant_id; without this policy, list_payments's
-- auth gate passes but the underlying SELECT returns 0 rows (RLS blocks).

CREATE POLICY p_tenant_owner_read ON public.tenant_payments
  AS PERMISSIVE FOR SELECT
  TO authenticated, vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id());


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. list_payments(p_filters jsonb) → SETOF (…)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Access:
--   • Platform admin → may list any tenant's payments (no tenant_id filter
--     required).
--   • Tenant owner   → MUST supply p_filters->>'tenant_id' equal to their
--     own _resolve_tenant_id()::text; any other tenant_id → P0403.
--   • All others     → P0403.
--
-- Filter whitelist: tenant_id, payment_method, from_date, to_date,
--   min_amount, page, page_size, sort_by, sort_dir.
-- sort_by whitelist: payment_date, amount, created_at. Default: payment_date.
-- sort_dir: asc | desc. Default: desc.
-- Pagination: page (1-based, default 1), page_size (default 50, max 200).
-- total_count via COUNT(*) OVER() window.

CREATE OR REPLACE FUNCTION public.list_payments(
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  id                  uuid,
  tenant_id           uuid,
  tenant_slug         text,
  tenant_name         text,
  amount              numeric,
  currency            text,
  payment_method      text,
  bank_name           text,
  ewallet_provider    text,
  payment_date        date,
  period_from         date,
  period_to           date,
  proof_url           text,
  bank_reference      text,
  notes               text,
  recorded_by_admin   uuid,
  created_at          timestamptz,
  total_count         bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
  v_is_admin       boolean;
  v_caller_tid     uuid;
  v_filter_tid_raw text;
  v_filter_tid     uuid;
  v_allowed_keys   text[] := ARRAY[
    'tenant_id','payment_method','from_date','to_date',
    'min_amount','page','page_size','sort_by','sort_dir'
  ];
  v_allowed_sort   text[] := ARRAY['payment_date','amount','created_at'];
  v_sort_by_raw    text;
  v_sort_by        text;
  v_sort_dir       text;
  v_page           int;
  v_page_size      int;
  v_payment_method text;
  v_from_date      date;
  v_to_date        date;
  v_min_amount     numeric;
  v_key            text;
BEGIN
  -- ── Determine caller type ─────────────────────────────────────────────────
  v_is_admin   := public._is_platform_admin_from_jwt();
  v_caller_tid := public._resolve_tenant_id();

  -- ── Validate: key whitelist ───────────────────────────────────────────────
  FOR v_key IN SELECT jsonb_object_keys(p_filters)
  LOOP
    IF v_key <> ALL(v_allowed_keys) THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'UNKNOWN_FIELD';
    END IF;
  END LOOP;

  -- ── Gate: admin or tenant owner ───────────────────────────────────────────
  v_filter_tid_raw := p_filters->>'tenant_id';

  IF NOT v_is_admin THEN
    -- Non-admin must supply tenant_id equal to their own JWT tenant
    IF v_filter_tid_raw IS NULL
       OR v_filter_tid_raw::uuid <> v_caller_tid
       OR v_caller_tid = '00000000-0000-0000-0000-000000000000'::uuid
    THEN
      RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
    END IF;
  END IF;

  -- ── Parse + validate filters ──────────────────────────────────────────────
  v_filter_tid     := NULLIF(v_filter_tid_raw, '')::uuid;
  v_payment_method := NULLIF(TRIM(p_filters->>'payment_method'), '');
  v_from_date      := NULLIF(TRIM(p_filters->>'from_date'), '')::date;
  v_to_date        := NULLIF(TRIM(p_filters->>'to_date'), '')::date;
  v_min_amount     := NULLIF(TRIM(p_filters->>'min_amount'), '')::numeric;

  -- sort_by: validate raw input before defaulting
  v_sort_by_raw := NULLIF(TRIM(p_filters->>'sort_by'), '');
  IF v_sort_by_raw IS NOT NULL AND v_sort_by_raw <> ALL(v_allowed_sort) THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_SORT_BY';
  END IF;
  v_sort_by := COALESCE(v_sort_by_raw, 'payment_date');

  v_sort_dir := LOWER(COALESCE(NULLIF(TRIM(p_filters->>'sort_dir'), ''), 'desc'));
  IF v_sort_dir NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_SORT_DIR';
  END IF;

  v_page      := GREATEST(COALESCE(NULLIF(TRIM(p_filters->>'page'), '')::int, 1), 1);
  v_page_size := LEAST(GREATEST(
    COALESCE(NULLIF(TRIM(p_filters->>'page_size'), '')::int, 50), 1), 200);

  -- ── Dynamic query ─────────────────────────────────────────────────────────
  RETURN QUERY EXECUTE format(
    $dyn$
    WITH base AS (
      SELECT
        tp.id,
        tp.tenant_id,
        t.slug                 AS tenant_slug,
        t.name                 AS tenant_name,
        tp.amount,
        tp.currency,
        tp.payment_method,
        tp.bank_name,
        tp.ewallet_provider,
        tp.payment_date,
        tp.period_from,
        tp.period_to,
        tp.proof_url,
        tp.bank_reference,
        tp.notes,
        tp.recorded_by_admin,
        tp.created_at
      FROM public.tenant_payments tp
      LEFT JOIN public.tenants t ON t.id = tp.tenant_id
      WHERE
        ($1::uuid IS NULL OR tp.tenant_id = $1::uuid)
        AND ($2 IS NULL OR tp.payment_method = $2)
        AND ($3::date IS NULL OR tp.payment_date >= $3::date)
        AND ($4::date IS NULL OR tp.payment_date <= $4::date)
        AND ($5::numeric IS NULL OR tp.amount >= $5::numeric)
    )
    SELECT
      b.id,
      b.tenant_id,
      b.tenant_slug,
      b.tenant_name,
      b.amount,
      b.currency,
      b.payment_method,
      b.bank_name,
      b.ewallet_provider,
      b.payment_date,
      b.period_from,
      b.period_to,
      b.proof_url,
      b.bank_reference,
      b.notes,
      b.recorded_by_admin,
      b.created_at,
      COUNT(*) OVER ()         AS total_count
    FROM base b
    ORDER BY %I %s
    LIMIT $6 OFFSET $7
    $dyn$,
    v_sort_by,
    v_sort_dir
  )
  USING
    v_filter_tid,
    v_payment_method,
    v_from_date,
    v_to_date,
    v_min_amount,
    v_page_size,
    (v_page - 1) * v_page_size;
END;
$$;

REVOKE ALL ON FUNCTION public.list_payments(jsonb) FROM PUBLIC;
ALTER FUNCTION  public.list_payments(jsonb) OWNER TO vosi_rpc_owner;
GRANT EXECUTE ON FUNCTION public.list_payments(jsonb) TO authenticated;

COMMENT ON FUNCTION public.list_payments(jsonb) IS
  'category=P; Wave 5 Task 5. Paginated, filterable payment list. '
  'Platform admin: any tenant. Tenant owner: own tenant_id only (P0403 otherwise). '
  'Filter whitelist: tenant_id, payment_method, from_date, to_date, min_amount, '
  'page, page_size, sort_by, sort_dir (22023 UNKNOWN_FIELD on violation). '
  'sort_by whitelist: payment_date, amount, created_at. Default: payment_date DESC. '
  'Pagination: page 1-based, page_size max 200. total_count via window. '
  'Owned by vosi_rpc_owner (read only, no auth-schema access). '
  'Supplementary RLS policy p_tenant_owner_read added to tenant_payments table '
  'so tenant-owner branch has SELECT access scoped to their own tenant_id.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. get_revenue_stats(p_filters jsonb) → jsonb
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Platform admin only (P0403).
-- Filters: from_date, to_date, group_by (enum 'plan'|'month'|'tenant').
-- Defaults: from_date = date_trunc('year', CURRENT_DATE),
--           to_date   = CURRENT_DATE,
--           group_by  = 'plan'.
-- Returns:
--   {
--     "total": <sum>,
--     "breakdown": [{"key": ..., "amount": ..., "count": ...}],
--     "monthly_trend": [{"month": "YYYY-MM", "total": ...}]  -- 12 rows, newest first
--   }

CREATE OR REPLACE FUNCTION public.get_revenue_stats(
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
  v_allowed_keys   text[] := ARRAY['from_date','to_date','group_by'];
  v_allowed_groups text[] := ARRAY['plan','month','tenant'];
  v_group_by_raw   text;
  v_group_by       text;
  v_from_date      date;
  v_to_date        date;
  v_key            text;
  v_total          numeric;
  v_breakdown      jsonb;
  v_monthly_trend  jsonb;
BEGIN
  -- ── Gate: platform admin only ─────────────────────────────────────────────
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
  END IF;

  -- ── Validate: key whitelist ───────────────────────────────────────────────
  FOR v_key IN SELECT jsonb_object_keys(p_filters)
  LOOP
    IF v_key <> ALL(v_allowed_keys) THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'UNKNOWN_FIELD';
    END IF;
  END LOOP;

  -- ── Parse + validate group_by (raw first, then default) ──────────────────
  v_group_by_raw := NULLIF(TRIM(p_filters->>'group_by'), '');
  IF v_group_by_raw IS NOT NULL AND v_group_by_raw <> ALL(v_allowed_groups) THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_GROUP_BY';
  END IF;
  v_group_by := COALESCE(v_group_by_raw, 'plan');

  -- ── Parse dates (defaults: YTD) ───────────────────────────────────────────
  v_from_date := COALESCE(
    NULLIF(TRIM(p_filters->>'from_date'), '')::date,
    date_trunc('year', CURRENT_DATE)::date
  );
  v_to_date := COALESCE(
    NULLIF(TRIM(p_filters->>'to_date'), '')::date,
    CURRENT_DATE
  );

  -- ── Total ─────────────────────────────────────────────────────────────────
  SELECT COALESCE(SUM(amount), 0)
  INTO v_total
  FROM public.tenant_payments
  WHERE payment_date BETWEEN v_from_date AND v_to_date;

  -- ── Breakdown by group_by ─────────────────────────────────────────────────
  -- Pre-aggregate in a subquery first; jsonb_agg ORDER BY cannot reference
  -- another aggregate expression directly (42803 nested aggregate error).
  IF v_group_by = 'plan' THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object('key', agg.plan_key, 'amount', agg.total_amount, 'count', agg.payment_count)
      ORDER BY agg.total_amount DESC
    ), '[]'::jsonb)
    INTO v_breakdown
    FROM (
      SELECT
        COALESCE(ts.plan_code, 'UNKNOWN') AS plan_key,
        SUM(tp.amount)                    AS total_amount,
        COUNT(*)                          AS payment_count
      FROM public.tenant_payments tp
      LEFT JOIN public.tenant_subscriptions ts ON ts.tenant_id = tp.tenant_id
      WHERE tp.payment_date BETWEEN v_from_date AND v_to_date
      GROUP BY COALESCE(ts.plan_code, 'UNKNOWN')
    ) agg;

  ELSIF v_group_by = 'month' THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object('key', agg.month_key, 'amount', agg.total_amount, 'count', agg.payment_count)
      ORDER BY agg.month_key DESC
    ), '[]'::jsonb)
    INTO v_breakdown
    FROM (
      SELECT
        to_char(payment_date, 'YYYY-MM') AS month_key,
        SUM(amount)                       AS total_amount,
        COUNT(*)                          AS payment_count
      FROM public.tenant_payments
      WHERE payment_date BETWEEN v_from_date AND v_to_date
      GROUP BY to_char(payment_date, 'YYYY-MM')
    ) agg;

  ELSE  -- 'tenant'
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object('key', agg.tenant_key, 'amount', agg.total_amount, 'count', agg.payment_count)
      ORDER BY agg.total_amount DESC
    ), '[]'::jsonb)
    INTO v_breakdown
    FROM (
      SELECT
        COALESCE(t.name, tp.tenant_id::text) AS tenant_key,
        SUM(tp.amount)                        AS total_amount,
        COUNT(*)                              AS payment_count
      FROM public.tenant_payments tp
      LEFT JOIN public.tenants t ON t.id = tp.tenant_id
      WHERE tp.payment_date BETWEEN v_from_date AND v_to_date
      GROUP BY tp.tenant_id, t.name
    ) agg;
  END IF;

  -- ── Monthly trend: last 12 calendar months, newest first, zeros filled ────
  -- generate_series produces months; LEFT JOIN to actual data fills zeros.
  SELECT jsonb_agg(
    jsonb_build_object(
      'month', to_char(m.month_start, 'YYYY-MM'),
      'total', COALESCE(agg.total, 0)
    )
    ORDER BY m.month_start DESC
  )
  INTO v_monthly_trend
  FROM (
    SELECT generate_series(
      date_trunc('month', CURRENT_DATE - INTERVAL '11 months'),
      date_trunc('month', CURRENT_DATE),
      '1 month'::interval
    )::date AS month_start
  ) m
  LEFT JOIN (
    SELECT
      date_trunc('month', payment_date)::date AS month_start,
      SUM(amount) AS total
    FROM public.tenant_payments
    GROUP BY date_trunc('month', payment_date)::date
  ) agg USING (month_start);

  -- ── Return ────────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'total',         v_total,
    'breakdown',     COALESCE(v_breakdown, '[]'::jsonb),
    'monthly_trend', COALESCE(v_monthly_trend, '[]'::jsonb)
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.get_revenue_stats(jsonb) FROM PUBLIC;
ALTER FUNCTION  public.get_revenue_stats(jsonb) OWNER TO vosi_rpc_owner;
GRANT EXECUTE ON FUNCTION public.get_revenue_stats(jsonb) TO authenticated;

COMMENT ON FUNCTION public.get_revenue_stats(jsonb) IS
  'category=P; Wave 5 Task 5. Revenue aggregation for platform admin dashboard. '
  'Platform-admin gated (P0403). '
  'Filter whitelist: from_date, to_date, group_by (22023 UNKNOWN_FIELD on violation). '
  'group_by enum: plan|month|tenant (22023 INVALID_GROUP_BY on violation). '
  'Defaults: from_date=year-start, to_date=today, group_by=plan. '
  'Returns {total, breakdown:[{key,amount,count}], monthly_trend:[{month,total}]}. '
  'monthly_trend always has exactly 12 rows (last 12 calendar months, zeros filled). '
  'Owned by vosi_rpc_owner (read only, no auth-schema access).';

-- ── generate_payment_proof_signed_url: NOT IMPLEMENTED ───────────────────────
-- storage.*sign* functions do not exist in this Supabase project.
-- Verified via: SELECT proname FROM pg_proc p JOIN pg_namespace n ON ...
-- WHERE n.nspname='storage' AND proname LIKE '%sign%' → 0 rows.
-- FE MUST use: supabase.storage.from('payment-proofs').createSignedUrl(objectKey, 3600)
-- This is a client-side SDK call that goes through the Supabase Storage HTTP API,
-- which generates signed URLs via the storage service (not via a Postgres function).
-- No SQL RPC wrapper is possible without the underlying SQL API.

COMMIT;
