-- supabase/migrations/20260627000004_phase2b_rpc_tf_mutations.sql
-- Phase 2b: update / add / remove / delete TF RPCs.
-- delete_tukar_faktur implements cascade soft-delete on is_tf_quick_add Tagihans.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_tukar_faktur(p_tf_id uuid, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_photo_urls text[];
BEGIN
  IF (SELECT voided_at FROM public.tukar_faktur WHERE id = p_tf_id) IS NOT NULL THEN
    RAISE EXCEPTION 'tf_voided';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tukar_faktur WHERE id = p_tf_id) THEN
    RAISE EXCEPTION 'tf_not_found';
  END IF;

  IF payload ? 'photo_urls' THEN
    v_photo_urls := ARRAY(SELECT jsonb_array_elements_text(payload->'photo_urls'));
  END IF;

  UPDATE public.tukar_faktur SET
    tukar_date = COALESCE((payload->>'tukar_date')::date, tukar_date),
    payment_due_at = COALESCE((payload->>'payment_due_at')::date, payment_due_at),
    notes = CASE WHEN payload ? 'notes' THEN payload->>'notes' ELSE notes END,
    photo_urls = COALESCE(v_photo_urls, photo_urls)
  WHERE id = p_tf_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_tukar_faktur(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_tagihan_to_tf(p_tf_id uuid, p_tagihan_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tf_supplier uuid;
  v_pi_supplier uuid;
  v_existing_tf text;
  v_pi_total numeric;
  v_pi_status text;
BEGIN
  SELECT supplier_id INTO v_tf_supplier FROM public.tukar_faktur
  WHERE id = p_tf_id AND voided_at IS NULL;
  IF v_tf_supplier IS NULL THEN RAISE EXCEPTION 'tf_not_found_or_voided'; END IF;

  SELECT supplier_id, total, status INTO v_pi_supplier, v_pi_total, v_pi_status
  FROM public.purchase_invoices WHERE id = p_tagihan_id;
  IF v_pi_supplier IS NULL THEN RAISE EXCEPTION 'tagihan_not_found'; END IF;
  IF v_pi_supplier <> v_tf_supplier THEN RAISE EXCEPTION 'same_supplier_violation'; END IF;
  IF v_pi_status = 'LUNAS' THEN RAISE EXCEPTION 'tagihan_already_paid'; END IF;

  SELECT t.tf_number INTO v_existing_tf
  FROM public.purchase_invoices pi
  JOIN public.tukar_faktur t ON t.id = pi.tukar_faktur_id
  WHERE pi.id = p_tagihan_id AND t.voided_at IS NULL;
  IF v_existing_tf IS NOT NULL THEN
    RAISE EXCEPTION 'tagihan_already_bundled: %', v_existing_tf;
  END IF;

  UPDATE public.purchase_invoices SET tukar_faktur_id = p_tf_id WHERE id = p_tagihan_id;
  UPDATE public.tukar_faktur SET total_amount = total_amount + v_pi_total WHERE id = p_tf_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_tagihan_to_tf(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_tagihan_from_tf(p_tf_id uuid, p_tagihan_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_paid numeric;
  v_pi_total numeric;
  v_is_quick boolean;
BEGIN
  SELECT paid_amount INTO v_paid FROM public.tukar_faktur WHERE id = p_tf_id AND voided_at IS NULL;
  IF v_paid IS NULL THEN RAISE EXCEPTION 'tf_not_found_or_voided'; END IF;
  IF v_paid > 0 THEN RAISE EXCEPTION 'cannot_remove_from_paid_tf'; END IF;

  SELECT total, is_tf_quick_add INTO v_pi_total, v_is_quick
  FROM public.purchase_invoices
  WHERE id = p_tagihan_id AND tukar_faktur_id = p_tf_id;
  IF v_pi_total IS NULL THEN RAISE EXCEPTION 'tagihan_not_in_tf'; END IF;

  -- Quick-add Tagihan can't exist standalone (no Pesanan, no items, would violate CHECK).
  -- If operator removes a quick-add from TF, soft-delete it (same as cascade on TF delete).
  IF v_is_quick THEN
    UPDATE public.purchase_invoices SET
      voided_at = now(),
      voided_by_user_id = auth.uid(),
      void_reason = 'removed from TF (quick-add cannot exist standalone)',
      tukar_faktur_id = NULL
    WHERE id = p_tagihan_id;
  ELSE
    UPDATE public.purchase_invoices SET tukar_faktur_id = NULL WHERE id = p_tagihan_id;
  END IF;

  UPDATE public.tukar_faktur SET total_amount = total_amount - v_pi_total WHERE id = p_tf_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_tagihan_from_tf(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_tukar_faktur(p_tf_id uuid, p_reason text DEFAULT 'manual') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_paid numeric;
BEGIN
  SELECT paid_amount INTO v_paid FROM public.tukar_faktur
  WHERE id = p_tf_id AND voided_at IS NULL;
  IF v_paid IS NULL THEN RAISE EXCEPTION 'tf_not_found_or_voided'; END IF;
  IF v_paid > 0 THEN RAISE EXCEPTION 'cannot_delete_paid_tf'; END IF;

  -- Cascade soft-delete tf_quick_add Tagihans (per spec Q1 decision A)
  UPDATE public.purchase_invoices SET
    voided_at = now(),
    voided_by_user_id = auth.uid(),
    void_reason = 'cascade from TF deletion: ' || COALESCE(p_reason, 'manual'),
    tukar_faktur_id = NULL
  WHERE tukar_faktur_id = p_tf_id AND is_tf_quick_add = true;

  -- Unlink normal Tagihans (revert to JT asli + outstanding lists)
  UPDATE public.purchase_invoices SET tukar_faktur_id = NULL
  WHERE tukar_faktur_id = p_tf_id AND is_tf_quick_add = false;

  -- Soft-delete TF itself
  UPDATE public.tukar_faktur SET
    voided_at = now(),
    voided_by_user_id = auth.uid(),
    void_reason = p_reason
  WHERE id = p_tf_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_tukar_faktur(uuid, text) TO authenticated;

COMMIT;
