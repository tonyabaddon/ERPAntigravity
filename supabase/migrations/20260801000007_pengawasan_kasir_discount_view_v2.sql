-- 20260801000007 — Pengawasan view v2: sum explicit discount_amount_rp.
-- Replaces derived-from-stocks.price calculation (latent bug: harga master
-- berubah → historical discount geser). New view reads JSONB snapshot.
-- Order-level discount dijumlah utuh ke cashier (tidak prorated per line).

BEGIN;

CREATE OR REPLACE VIEW public.v_pengawasan_kasir_discount_7d AS
WITH line_agg AS (
  SELECT
    kt.id AS kt_id,
    kt.created_by,
    COALESCE(SUM((kti.value->>'discount_amount_rp')::numeric), 0)::numeric  AS line_discount_total,
    COALESCE(SUM((kti.value->>'unit_price')::numeric * (kti.value->>'qty')::int), 0)::numeric AS gross_revenue
  FROM public.kasir_transactions kt
  LEFT JOIN LATERAL jsonb_array_elements(kt.items) AS kti(value) ON TRUE
  WHERE kt.type = 'income'
    AND kt.status IN ('PAID','COMPLETED')
    AND kt.created_at >= now() - INTERVAL '7 days'
  GROUP BY kt.id, kt.created_by
),
kt_agg AS (
  SELECT
    la.created_by,
    SUM(la.line_discount_total + COALESCE(kt.discount_amount_rp, 0))::numeric AS total_discount_rp,
    SUM(la.gross_revenue)::numeric AS total_revenue_rp
  FROM line_agg la
  JOIN public.kasir_transactions kt ON kt.id = la.kt_id
  GROUP BY la.created_by
)
SELECT
  kt_agg.created_by AS cashier_user_id,
  au.name           AS cashier_name,
  kt_agg.total_discount_rp,
  kt_agg.total_revenue_rp,
  CASE WHEN kt_agg.total_revenue_rp > 0
    THEN kt_agg.total_discount_rp / kt_agg.total_revenue_rp
    ELSE 0
  END AS discount_pct_of_revenue
FROM kt_agg
LEFT JOIN public.admin_users au ON au.id = kt_agg.created_by;

GRANT SELECT ON public.v_pengawasan_kasir_discount_7d TO authenticated;

COMMIT;
