-- =====================================================================
-- Phase 4 — Pengawasan View 3 (Task 3): v_pengawasan_outflow_outliers.
--
-- Flags SKUs whose last-7-day outflow exceeds 3× their 90-day daily-average
-- weekly equivalent. The Owner uses this view to catch suspicious surges
-- (e.g. a normally-quiet SKU suddenly bleeding inventory) that no single
-- adjustment or sale row would flag in isolation.
--
-- Math:
--   sum_7d                = SUM(ABS(qty_delta)) over rows with qty_delta<0
--                           in the last 7 days
--   avg_daily_90d         = SUM(ABS(qty_delta)) over rows with qty_delta<0
--                           in the last 90 days, divided by 90.0
--   weekly_equiv          = avg_daily_90d * 7
--   multiplier            = sum_7d / NULLIF(weekly_equiv, 0)
--   flagged when          sum_7d > 3 * weekly_equiv
--
-- Design notes:
--   - Computed strictly from stock_movements (the Phase 1 immutable ledger),
--     so the view inherits Phase 1's append-only guarantees: the underlying
--     numbers cannot be silently rewritten.
--   - SKUs with no 90-day outflow are absent from avg_90 — the INNER JOIN
--     drops them automatically. NULLIF guards the divisor anyway in case a
--     future migration makes the join LEFT.
--   - No ORDER BY in the view itself — Postgres optimisers handle ORDER BY
--     better when pushed by the caller. Consumers (dashboard, poller) order
--     by multiplier DESC at query time.
-- =====================================================================

CREATE OR REPLACE VIEW public.v_pengawasan_outflow_outliers AS
WITH outflow_7 AS (
  SELECT sku, SUM(ABS(qty_delta))::numeric AS sum_7d
  FROM public.stock_movements
  WHERE qty_delta < 0
    AND created_at >= now() - INTERVAL '7 days'
  GROUP BY sku
),
avg_90 AS (
  SELECT sku, SUM(ABS(qty_delta))::numeric / 90.0 AS avg_daily_90d
  FROM public.stock_movements
  WHERE qty_delta < 0
    AND created_at >= now() - INTERVAL '90 days'
  GROUP BY sku
)
SELECT
  o.sku,
  s.name,
  o.sum_7d,
  a.avg_daily_90d,
  o.sum_7d / NULLIF(a.avg_daily_90d * 7, 0) AS multiplier
FROM outflow_7 o
JOIN avg_90 a USING (sku)
JOIN public.stocks s ON s.sku = o.sku
WHERE o.sum_7d > 3 * a.avg_daily_90d * 7;

GRANT SELECT ON public.v_pengawasan_outflow_outliers TO authenticated;
