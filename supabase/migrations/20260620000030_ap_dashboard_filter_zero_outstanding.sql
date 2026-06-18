-- supabase/migrations/20260620000030_ap_dashboard_filter_zero_outstanding.sql
-- Fix Beranda Pembelian: per-supplier table + Terlambat KPI inflated by
-- zero-total Tagihans migrated from legacy POs (total=0, paid_amount=0).
-- Smoke test 2026-06-17 caught 31 Test Supplier rows showing "⚠ Terlambat 10 hari"
-- with Rp 0 outstanding — RPC didn't filter (total - paid_amount) > 0.
--
-- Fix: add `(pi.total - pi.paid_amount) > 0` everywhere the RPC aggregates
-- "outstanding" semantics — per_supplier rows, overdue count/amount.
-- The bucket sums (due_this_month, next_7_days, total_outstanding) already
-- contribute 0 from zero-outstanding rows so are mathematically safe, but
-- filtering keeps the query plans consistent.

BEGIN;

CREATE OR REPLACE FUNCTION public.ap_dashboard_lite() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_total_outstanding numeric;
  v_due_this_month numeric;
  v_next_7d numeric;
  v_overdue_count int;
  v_overdue_amount numeric;
  v_per_supplier jsonb;
BEGIN
  SELECT COALESCE(SUM(total - paid_amount), 0) INTO v_total_outstanding
  FROM public.purchase_invoices
  WHERE status IN ('BELUM_LUNAS','DIBAYAR_SEBAGIAN') AND voided_at IS NULL
    AND (total - paid_amount) > 0;

  SELECT COALESCE(SUM(total - paid_amount), 0) INTO v_due_this_month
  FROM public.purchase_invoices
  WHERE status IN ('BELUM_LUNAS','DIBAYAR_SEBAGIAN') AND voided_at IS NULL
    AND (total - paid_amount) > 0
    AND payment_due_at >= date_trunc('month', v_today)::date
    AND payment_due_at < (date_trunc('month', v_today) + interval '1 month')::date;

  SELECT COALESCE(SUM(total - paid_amount), 0) INTO v_next_7d
  FROM public.purchase_invoices
  WHERE status IN ('BELUM_LUNAS','DIBAYAR_SEBAGIAN') AND voided_at IS NULL
    AND (total - paid_amount) > 0
    AND payment_due_at BETWEEN v_today AND v_today + 7;

  SELECT COUNT(*), COALESCE(SUM(total - paid_amount), 0)
  INTO v_overdue_count, v_overdue_amount
  FROM public.purchase_invoices
  WHERE status IN ('BELUM_LUNAS','DIBAYAR_SEBAGIAN') AND voided_at IS NULL
    AND (total - paid_amount) > 0
    AND payment_due_at < v_today;

  SELECT jsonb_agg(s ORDER BY (s->>'outstanding')::numeric DESC) INTO v_per_supplier
  FROM (
    SELECT jsonb_build_object(
      'supplier_id', s.id,
      'supplier_name', s.name,
      'outstanding', COALESCE(SUM(pi.total - pi.paid_amount), 0),
      'tagihan_count', COUNT(pi.id),
      'due_soonest', MIN(pi.payment_due_at)
    ) AS s
    FROM public.suppliers s
    JOIN public.purchase_invoices pi ON pi.supplier_id = s.id
    WHERE pi.status IN ('BELUM_LUNAS','DIBAYAR_SEBAGIAN') AND pi.voided_at IS NULL
      AND (pi.total - pi.paid_amount) > 0
    GROUP BY s.id, s.name
  ) sub;

  RETURN jsonb_build_object(
    'kpi', jsonb_build_object(
      'total_outstanding', v_total_outstanding,
      'due_this_month', v_due_this_month,
      'next_7_days', v_next_7d,
      'overdue', jsonb_build_object('amount', v_overdue_amount, 'count', v_overdue_count)
    ),
    'per_supplier', COALESCE(v_per_supplier, '[]'::jsonb)
  );
END;
$$;

COMMIT;
