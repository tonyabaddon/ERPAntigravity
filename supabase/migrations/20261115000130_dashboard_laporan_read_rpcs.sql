-- 20261115000130_dashboard_laporan_read_rpcs.sql
-- Item #3: Dashboard + Laporan read RPCs (6 functions).
-- All SECDEF STABLE, tenant-scoped via _resolve_tenant_id().
-- See docs/superpowers/specs/2026-07-13-dashboard-laporan-split-design.md

-- ── 1. get_dashboard_maintenance_counts ────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_dashboard_maintenance_counts()
RETURNS TABLE(
  approval_pending        INT,
  piutang_overdue_count   INT,
  piutang_overdue_sum     NUMERIC,
  hutang_overdue_count    INT,
  hutang_overdue_sum      NUMERIC,
  fulfillment_queue_count INT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    approval_pending := 0; piutang_overdue_count := 0; piutang_overdue_sum := 0;
    hutang_overdue_count := 0; hutang_overdue_sum := 0; fulfillment_queue_count := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT COALESCE((SELECT COUNT(*)::INT FROM public.approval_requests
                    WHERE tenant_id = v_tenant AND status = 'pending'), 0)
    INTO approval_pending;

  SELECT
    COALESCE(COUNT(*)::INT, 0),
    COALESCE(SUM(total_amount - COALESCE(dp_amount, 0)), 0)
  INTO piutang_overdue_count, piutang_overdue_sum
  FROM public.kasir_transactions
  WHERE tenant_id = v_tenant
    AND payment_type = 'TEMPO'
    AND status = 'AWAITING_LUNAS'
    AND lunas_at IS NULL
    AND cancelled_at IS NULL
    AND created_at < now() - INTERVAL '30 days';

  SELECT
    COALESCE(COUNT(*)::INT, 0),
    COALESCE(SUM(total - COALESCE(paid_amount, 0)), 0)
  INTO hutang_overdue_count, hutang_overdue_sum
  FROM public.purchase_invoices
  WHERE tenant_id = v_tenant
    AND payment_due_at IS NOT NULL
    AND payment_due_at < now()
    AND paid_at IS NULL
    AND voided_at IS NULL;

  SELECT COALESCE(COUNT(*)::INT, 0)
    INTO fulfillment_queue_count
  FROM public.kasir_transactions
  WHERE tenant_id = v_tenant
    AND status IN ('AWAITING_LUNAS','WIP','PENDING_LOCK_APPROVAL')
    AND cancelled_at IS NULL;

  RETURN NEXT;
END $$;

ALTER FUNCTION public.get_dashboard_maintenance_counts() OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.get_dashboard_maintenance_counts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_maintenance_counts() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_maintenance_counts() TO authenticated;

COMMENT ON FUNCTION public.get_dashboard_maintenance_counts IS
  'Item #3: single-round-trip aggregate for Dashboard maintenance cards.';


-- ── 2. get_today_snapshot ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_today_snapshot()
RETURNS TABLE(
  revenue_today NUMERIC,
  count_today   INT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    revenue_today := 0; count_today := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM(total_amount), 0),
    COALESCE(COUNT(*)::INT, 0)
  INTO revenue_today, count_today
  FROM public.kasir_transactions
  WHERE tenant_id = v_tenant
    AND date = CURRENT_DATE
    AND status IN ('PAID','AWAITING_LUNAS','WIP','PENDING_LOCK_APPROVAL')
    AND cancelled_at IS NULL;

  RETURN NEXT;
END $$;

ALTER FUNCTION public.get_today_snapshot() OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.get_today_snapshot() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_today_snapshot() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_today_snapshot() TO authenticated;

COMMENT ON FUNCTION public.get_today_snapshot IS
  'Item #3: Dashboard today strip (revenue + count for CURRENT_DATE).';


-- ── 3. get_performa_summary_with_delta ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_performa_summary_with_delta(p_days INT)
RETURNS TABLE(
  revenue                NUMERIC,
  gross_profit           NUMERIC,
  order_count            INT,
  avg_order_value        NUMERIC,
  prev_revenue           NUMERIC,
  prev_gross_profit      NUMERIC,
  prev_order_count       INT,
  prev_avg_order_value   NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_tenant       UUID;
  v_today        DATE := CURRENT_DATE;
  v_curr_start   DATE;
  v_prev_start   DATE;
  v_prev_end     DATE;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID OR p_days IS NULL OR p_days <= 0 THEN
    revenue := 0; gross_profit := 0; order_count := 0; avg_order_value := 0;
    prev_revenue := 0; prev_gross_profit := 0; prev_order_count := 0; prev_avg_order_value := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  v_curr_start := v_today - (p_days - 1);
  v_prev_end   := v_curr_start - 1;
  v_prev_start := v_prev_end - (p_days - 1);

  SELECT
    COALESCE(SUM(subtotal), 0),
    COALESCE(SUM(subtotal - COALESCE(hpp_total, 0)), 0),
    COALESCE(COUNT(*)::INT, 0),
    CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(subtotal), 0) / COUNT(*) ELSE 0 END
  INTO revenue, gross_profit, order_count, avg_order_value
  FROM public.kasir_transactions
  WHERE tenant_id = v_tenant
    AND date BETWEEN v_curr_start AND v_today
    AND status IN ('PAID','AWAITING_LUNAS','WIP','PENDING_LOCK_APPROVAL')
    AND cancelled_at IS NULL;

  SELECT
    COALESCE(SUM(subtotal), 0),
    COALESCE(SUM(subtotal - COALESCE(hpp_total, 0)), 0),
    COALESCE(COUNT(*)::INT, 0),
    CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(subtotal), 0) / COUNT(*) ELSE 0 END
  INTO prev_revenue, prev_gross_profit, prev_order_count, prev_avg_order_value
  FROM public.kasir_transactions
  WHERE tenant_id = v_tenant
    AND date BETWEEN v_prev_start AND v_prev_end
    AND status IN ('PAID','AWAITING_LUNAS','WIP','PENDING_LOCK_APPROVAL')
    AND cancelled_at IS NULL;

  RETURN NEXT;
END $$;

ALTER FUNCTION public.get_performa_summary_with_delta(INT) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.get_performa_summary_with_delta(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_performa_summary_with_delta(INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_performa_summary_with_delta(INT) TO authenticated;

COMMENT ON FUNCTION public.get_performa_summary_with_delta IS
  'Item #3: Laporan Performa KPI (revenue, gross_profit, orders, AOV) + previous-period counterparts for delta calc.';


-- ── 4. get_slow_moving_stock ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_slow_moving_stock(p_days INT, p_limit INT DEFAULT 20)
RETURNS TABLE(
  sku            TEXT,
  name           TEXT,
  stock          INT,
  qty_sold       INT,
  days_stagnant  INT,
  severity       TEXT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_tenant       UUID;
  v_period_start DATE;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID OR p_days IS NULL OR p_days <= 0 THEN
    RETURN;
  END IF;

  v_period_start := CURRENT_DATE - (COALESCE(p_days, 30) - 1);

  RETURN QUERY
  WITH sales_agg AS (
    SELECT
      (item->>'sku')::TEXT AS sku,
      SUM((item->>'qty')::INT) AS qty_sold
    FROM public.kasir_transactions kt,
         jsonb_array_elements(kt.items) AS item
    WHERE kt.tenant_id = v_tenant
      AND kt.date >= v_period_start
      AND kt.status IN ('PAID','AWAITING_LUNAS','WIP','PENDING_LOCK_APPROVAL')
      AND kt.cancelled_at IS NULL
      AND item->>'sku' IS NOT NULL
    GROUP BY 1
  ),
  all_time_last_sale AS (
    SELECT
      (item->>'sku')::TEXT AS sku,
      MAX(kt.date) AS last_sale_date_all
    FROM public.kasir_transactions kt,
         jsonb_array_elements(kt.items) AS item
    WHERE kt.tenant_id = v_tenant
      AND kt.status IN ('PAID','AWAITING_LUNAS','WIP','PENDING_LOCK_APPROVAL')
      AND kt.cancelled_at IS NULL
      AND item->>'sku' IS NOT NULL
    GROUP BY 1
  )
  SELECT
    s.sku::TEXT,
    s.name::TEXT,
    s.stock::INT,
    COALESCE(sa.qty_sold, 0)::INT AS qty_sold,
    (CURRENT_DATE - COALESCE(atls.last_sale_date_all, s.updated_at::date))::INT AS days_stagnant,
    CASE
      WHEN COALESCE(sa.qty_sold, 0) = 0
           AND (CURRENT_DATE - COALESCE(atls.last_sale_date_all, s.updated_at::date))::INT >= 45
        THEN 'dead'
      WHEN COALESCE(sa.qty_sold, 0) = 0
        THEN 'slow'
      WHEN sa.qty_sold IS NOT NULL AND s.stock > 0 AND sa.qty_sold < GREATEST(s.stock * 0.1, 1)
        THEN 'slow'
      ELSE 'active'
    END::TEXT AS severity
  FROM public.stocks s
  LEFT JOIN sales_agg sa ON sa.sku = s.sku
  LEFT JOIN all_time_last_sale atls ON atls.sku = s.sku
  WHERE s.tenant_id = v_tenant
    AND s.stock > 0
    AND (
      COALESCE(sa.qty_sold, 0) = 0
      OR (s.stock > 0 AND sa.qty_sold IS NOT NULL AND sa.qty_sold < GREATEST(s.stock * 0.1, 1))
    )
  ORDER BY days_stagnant DESC NULLS LAST, s.sku
  LIMIT COALESCE(p_limit, 20);
END $$;

ALTER FUNCTION public.get_slow_moving_stock(INT, INT) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.get_slow_moving_stock(INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_slow_moving_stock(INT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_slow_moving_stock(INT, INT) TO authenticated;

COMMENT ON FUNCTION public.get_slow_moving_stock IS
  'Item #3: Laporan Produk Slow-Moving list. Severity: dead (45d+ no sale), slow (<10% turnover).';


-- ── 5. get_top_customers ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_top_customers(p_days INT, p_limit INT DEFAULT 10)
RETURNS TABLE(
  customer_id        TEXT,
  customer_name      TEXT,
  customer_company   TEXT,
  total_revenue      NUMERIC,
  transaction_count  INT,
  last_purchase_date DATE,
  days_since_last    INT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_tenant       UUID;
  v_period_start DATE;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID OR p_days IS NULL OR p_days <= 0 THEN
    RETURN;
  END IF;

  v_period_start := CURRENT_DATE - (p_days - 1);

  RETURN QUERY
  SELECT
    kt.customer_id::TEXT,
    kt.customer_name::TEXT,
    kt.customer_company::TEXT,
    COALESCE(SUM(kt.subtotal), 0)::NUMERIC AS total_revenue,
    COUNT(*)::INT AS transaction_count,
    MAX(kt.date) AS last_purchase_date,
    (CURRENT_DATE - MAX(kt.date))::INT AS days_since_last
  FROM public.kasir_transactions kt
  WHERE kt.tenant_id = v_tenant
    AND kt.date >= v_period_start
    AND kt.status IN ('PAID','AWAITING_LUNAS','WIP','PENDING_LOCK_APPROVAL')
    AND kt.cancelled_at IS NULL
    AND kt.customer_id IS NOT NULL
    AND length(trim(COALESCE(kt.customer_name, ''))) > 0
  GROUP BY kt.customer_id, kt.customer_name, kt.customer_company
  ORDER BY total_revenue DESC
  LIMIT COALESCE(p_limit, 10);
END $$;

ALTER FUNCTION public.get_top_customers(INT, INT) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.get_top_customers(INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_top_customers(INT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_top_customers(INT, INT) TO authenticated;

COMMENT ON FUNCTION public.get_top_customers IS
  'Item #3: Laporan Top Customer aggregation (revenue + tx count + last purchase).';


-- ── 6. get_profit_per_channel ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_profit_per_channel(p_days INT)
RETURNS TABLE(
  channel      TEXT,
  revenue      NUMERIC,
  gross_profit NUMERIC,
  margin_pct   NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_tenant       UUID;
  v_period_start DATE;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID OR p_days IS NULL OR p_days <= 0 THEN
    RETURN;
  END IF;

  v_period_start := CURRENT_DATE - (p_days - 1);

  RETURN QUERY
  SELECT
    kt.channel::TEXT,
    COALESCE(SUM(kt.subtotal), 0)::NUMERIC AS revenue,
    COALESCE(SUM(kt.subtotal - COALESCE(kt.hpp_total, 0)), 0)::NUMERIC AS gross_profit,
    CASE WHEN SUM(kt.subtotal) > 0
      THEN (SUM(kt.subtotal - COALESCE(kt.hpp_total, 0)) * 100.0 / SUM(kt.subtotal))::NUMERIC
      ELSE 0
    END AS margin_pct
  FROM public.kasir_transactions kt
  WHERE kt.tenant_id = v_tenant
    AND kt.date >= v_period_start
    AND kt.status IN ('PAID','AWAITING_LUNAS','WIP','PENDING_LOCK_APPROVAL')
    AND kt.cancelled_at IS NULL
  GROUP BY kt.channel
  ORDER BY gross_profit DESC NULLS LAST;
END $$;

ALTER FUNCTION public.get_profit_per_channel(INT) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.get_profit_per_channel(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_profit_per_channel(INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_profit_per_channel(INT) TO authenticated;

COMMENT ON FUNCTION public.get_profit_per_channel IS
  'Item #3: Laporan Analisis Kanal — revenue + gross_profit + margin per channel.';
