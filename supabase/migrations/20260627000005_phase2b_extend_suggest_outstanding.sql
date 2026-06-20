-- supabase/migrations/20260627000005_phase2b_extend_suggest_outstanding.sql
-- Phase 2b: extend pembayaran_suggest_outstanding to return both Tagihan
-- (outstanding NOT bundled into a TF) and TukarFaktur (outstanding) lists.
-- Pembayaran form can mix-check Tagihan + TF rows via pembayaran_items XOR junction.

BEGIN;

CREATE OR REPLACE FUNCTION public.pembayaran_suggest_outstanding(p_supplier_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'tagihan', COALESCE((
      SELECT jsonb_agg(t ORDER BY t->>'payment_due_at')
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
          AND tukar_faktur_id IS NULL          -- exclude rows bundled into TF (TF handles its own row)
      ) sub
    ), '[]'::jsonb),
    'tukar_faktur', COALESCE((
      SELECT jsonb_agg(t ORDER BY t->>'payment_due_at')
      FROM (
        SELECT jsonb_build_object(
          'id', tf.id,
          'tf_number', tf.tf_number,
          'total', tf.total_amount,
          'paid_amount', tf.paid_amount,
          'outstanding', tf.total_amount - tf.paid_amount,
          'payment_due_at', tf.payment_due_at,
          'tagihan_count', (
            SELECT COUNT(*) FROM public.purchase_invoices
            WHERE tukar_faktur_id = tf.id AND voided_at IS NULL
          )
        ) AS t
        FROM public.tukar_faktur tf
        WHERE tf.supplier_id = p_supplier_id
          AND tf.voided_at IS NULL
          AND tf.total_amount > tf.paid_amount
      ) sub
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

COMMIT;
