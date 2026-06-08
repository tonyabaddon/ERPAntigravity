-- =====================================================================
-- Phase 4 — Pengawasan View 2 (Task 2): v_pengawasan_kasir_discount_7d.
--
-- Per-cashier discount aggregate over the last 7 days. "Discount" =
-- stocks.price (the listed default) minus the line's unit_price, summed
-- across kasir transactions whose status indicates a realized sale.
-- Captures both pre-Phase-3b free-form price entry and Phase-3b approved
-- overrides — both leak margin if abused.
--
-- Schema reality notes (differ from the spec draft):
--   1. The Phase 3b `cashier_user_id` column has not landed yet — this
--      codebase uses `kasir_transactions.created_by` as the cashier
--      identity. The view aliases it AS cashier_user_id so the contract
--      the Owner dashboard / poller expects is preserved.
--   2. The CHECK constraint on `status` allows only PAID, AWAITING_LUNAS,
--      COMPLETED, CANCELLED — there is no 'committed' value. We treat
--      `PAID` and `COMPLETED` as the "realized sale" set: those are the
--      states where the discount has been booked and revenue recognised.
--      AWAITING_LUNAS (DP / partial) and CANCELLED are excluded.
--   3. `type = 'income'` is required — expense rows have an empty items
--      array, but filtering at the kt scope is safer than relying on
--      jsonb_to_recordset yielding zero rows.
-- =====================================================================

CREATE OR REPLACE VIEW public.v_pengawasan_kasir_discount_7d AS
SELECT
  kt.created_by                                       AS cashier_user_id,
  au.name                                             AS cashier_name,
  SUM((s.price - kti.unit_price) * kti.qty)::numeric  AS total_discount_rp,
  SUM(kti.unit_price * kti.qty)::numeric              AS total_revenue_rp,
  CASE
    WHEN SUM(kti.unit_price * kti.qty) > 0
      THEN SUM((s.price - kti.unit_price) * kti.qty)::numeric
           / SUM(kti.unit_price * kti.qty)::numeric
    ELSE 0
  END                                                 AS discount_pct_of_revenue
FROM public.kasir_transactions kt
JOIN LATERAL jsonb_to_recordset(kt.items)
     AS kti(sku TEXT, unit_price NUMERIC, qty INT) ON TRUE
JOIN public.stocks            s  ON s.sku = kti.sku
LEFT JOIN public.admin_users  au ON au.id = kt.created_by
WHERE kt.type       = 'income'
  AND kt.status     IN ('PAID', 'COMPLETED')
  AND kt.created_at >= now() - INTERVAL '7 days'
GROUP BY kt.created_by, au.name;

GRANT SELECT ON public.v_pengawasan_kasir_discount_7d TO authenticated;
