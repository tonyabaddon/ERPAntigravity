BEGIN;

-- ============================================================
-- Phase B Wave 5 — Task 11 fix C2
-- get_revenue_stats: monthly_trend ORDER BY m.month_start ASC
--
-- Bug: monthly_trend was ORDER BY m.month_start DESC, producing
-- newest-first ordering. FE assumes ASC:
--   • RevenueKPIRow reads trend[trend.length - 1] expecting current
--     month — with DESC that element was actually 11 months ago.
--   • RevenueMonthlyTrend chart plots left→right expecting
--     oldest→newest; DESC reversed the polyline.
--
-- Fix: change the jsonb_agg ORDER BY from DESC to ASC.
-- Comment updated: removed "newest first" language.
-- Full function body reproduced from pg_get_functiondef to ensure
-- all-or-nothing replacement.
-- ============================================================

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
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_filters)
  LOOP
    IF v_key <> ALL(v_allowed_keys) THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'UNKNOWN_FIELD';
    END IF;
  END LOOP;

  -- validate raw group_by before defaulting
  v_group_by_raw := NULLIF(TRIM(p_filters->>'group_by'), '');
  IF v_group_by_raw IS NOT NULL AND v_group_by_raw <> ALL(v_allowed_groups) THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_GROUP_BY';
  END IF;
  v_group_by := COALESCE(v_group_by_raw, 'plan');

  v_from_date := COALESCE(
    NULLIF(TRIM(p_filters->>'from_date'), '')::date,
    date_trunc('year', CURRENT_DATE)::date
  );
  v_to_date := COALESCE(
    NULLIF(TRIM(p_filters->>'to_date'), '')::date,
    CURRENT_DATE
  );

  -- total
  SELECT COALESCE(SUM(amount), 0)
  INTO v_total
  FROM public.tenant_payments
  WHERE payment_date BETWEEN v_from_date AND v_to_date;

  -- breakdown: pre-aggregate in subquery to avoid nested aggregate
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

  -- monthly trend: last 12 calendar months, oldest-first, zeros filled
  -- FE reads trend[0] as oldest month, trend[11] as current month.
  SELECT jsonb_agg(
    jsonb_build_object(
      'month', to_char(m.month_start, 'YYYY-MM'),
      'total', COALESCE(agg.total, 0)
    )
    ORDER BY m.month_start ASC
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
      SUM(amount)                              AS total
    FROM public.tenant_payments
    GROUP BY date_trunc('month', payment_date)::date
  ) agg USING (month_start);

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
  'category=P; Wave 5 Task 5 (fixed Task 11 C2). Revenue aggregation for platform admin dashboard. '
  'Platform-admin gated (P0403). '
  'Filter whitelist: from_date, to_date, group_by (22023 UNKNOWN_FIELD on violation). '
  'group_by enum: plan|month|tenant (22023 INVALID_GROUP_BY on violation). '
  'Defaults: from_date=year-start, to_date=today, group_by=plan. '
  'Returns {total, breakdown:[{key,amount,count}], monthly_trend:[{month,total}]}. '
  'monthly_trend always has exactly 12 rows (last 12 calendar months, oldest-first ASC). '
  'Owned by vosi_rpc_owner (read only, no auth-schema access).';

COMMIT;
