-- supabase/migrations/20260620000007_phase2_rpcs_smart_helpers.sql
-- pembayaran_suggest_outstanding: returns outstanding Tagihan for given supplier.
-- ap_dashboard_lite: KPI totals + per-supplier outstanding (no aging/cash-flow yet — those are Phase 2c).

BEGIN;

CREATE OR REPLACE FUNCTION public.pembayaran_suggest_outstanding(p_supplier_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'tagihan', COALESCE(jsonb_agg(t ORDER BY t->>'payment_due_at'), '[]'::jsonb)
  ) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', id,
      'pi_number', pi_number,
      'total', total,
      'paid_amount', paid_amount,
      'outstanding', total - paid_amount,
      'payment_due_at', payment_due_at,
      'supplier_invoice_number', supplier_invoice_number
    ) AS t
    FROM public.purchase_invoices
    WHERE supplier_id = p_supplier_id
      AND status IN ('BELUM_LUNAS','DIBAYAR_SEBAGIAN')
      AND voided_at IS NULL
      AND tukar_faktur_id IS NULL
  ) sub;
  RETURN COALESCE(v_result, jsonb_build_object('tagihan','[]'::jsonb));
END;
$$;

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
  WHERE status IN ('BELUM_LUNAS','DIBAYAR_SEBAGIAN') AND voided_at IS NULL;

  SELECT COALESCE(SUM(total - paid_amount), 0) INTO v_due_this_month
  FROM public.purchase_invoices
  WHERE status IN ('BELUM_LUNAS','DIBAYAR_SEBAGIAN') AND voided_at IS NULL
    AND payment_due_at >= date_trunc('month', v_today)::date
    AND payment_due_at < (date_trunc('month', v_today) + interval '1 month')::date;

  SELECT COALESCE(SUM(total - paid_amount), 0) INTO v_next_7d
  FROM public.purchase_invoices
  WHERE status IN ('BELUM_LUNAS','DIBAYAR_SEBAGIAN') AND voided_at IS NULL
    AND payment_due_at BETWEEN v_today AND v_today + 7;

  SELECT COUNT(*), COALESCE(SUM(total - paid_amount), 0)
  INTO v_overdue_count, v_overdue_amount
  FROM public.purchase_invoices
  WHERE status IN ('BELUM_LUNAS','DIBAYAR_SEBAGIAN') AND voided_at IS NULL
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

GRANT EXECUTE ON FUNCTION public.pembayaran_suggest_outstanding(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ap_dashboard_lite() TO authenticated;

COMMIT;
