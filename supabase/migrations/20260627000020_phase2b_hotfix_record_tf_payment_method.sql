-- supabase/migrations/20260627000020_phase2b_hotfix_record_tf_payment_method.sql
-- Phase 2b hotfix: record_tukar_faktur quick-add INSERT was missing payment_method,
-- which is NOT NULL on purchase_invoices. Smoke test 2026-06-20 caught:
--   ERROR 23502: null value in column "payment_method" of relation "purchase_invoices"
-- Fix: include payment_method='TRANSFER' (default — operator can change via Edit later;
-- matches the value of all 32 existing BELUM_LUNAS Tagihans in production).

BEGIN;

CREATE OR REPLACE FUNCTION public.record_tukar_faktur(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tf_id uuid := gen_random_uuid();
  v_tf_number text := public.generate_tf_number();
  v_supplier_id uuid := (payload->>'supplier_id')::uuid;
  v_tukar_date date := (payload->>'tukar_date')::date;
  v_due_at date := (payload->>'payment_due_at')::date;
  v_tagihan_ids uuid[];
  v_quick_add jsonb := COALESCE(payload->'quick_add_tagihans', '[]'::jsonb);
  v_photo_urls text[];
  v_notes text := payload->>'notes';
  v_total numeric := 0;
  v_existing_tf text;
  v_quick_item jsonb;
  v_quick_id uuid;
BEGIN
  IF v_supplier_id IS NULL THEN RAISE EXCEPTION 'supplier_id required'; END IF;
  IF v_tukar_date IS NULL THEN RAISE EXCEPTION 'tukar_date required'; END IF;
  IF v_due_at IS NULL THEN RAISE EXCEPTION 'payment_due_at required'; END IF;

  v_tagihan_ids := ARRAY(SELECT jsonb_array_elements_text(COALESCE(payload->'tagihan_ids', '[]'::jsonb)))::uuid[];
  v_photo_urls := ARRAY(SELECT jsonb_array_elements_text(COALESCE(payload->'photo_urls', '[]'::jsonb)));

  IF array_length(v_tagihan_ids, 1) IS NULL AND jsonb_array_length(v_quick_add) = 0 THEN
    RAISE EXCEPTION 'tf_must_have_at_least_one_faktur';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.purchase_invoices
    WHERE id = ANY(v_tagihan_ids) AND supplier_id <> v_supplier_id
  ) THEN
    RAISE EXCEPTION 'same_supplier_violation';
  END IF;

  SELECT t.tf_number INTO v_existing_tf
  FROM public.purchase_invoices pi
  JOIN public.tukar_faktur t ON t.id = pi.tukar_faktur_id
  WHERE pi.id = ANY(v_tagihan_ids)
    AND t.voided_at IS NULL
  LIMIT 1;
  IF v_existing_tf IS NOT NULL THEN
    RAISE EXCEPTION 'tagihan_already_bundled: %', v_existing_tf;
  END IF;

  FOR v_quick_item IN SELECT * FROM jsonb_array_elements(v_quick_add) LOOP
    v_quick_id := gen_random_uuid();
    INSERT INTO public.purchase_invoices (
      id, pi_number, type, supplier_id,
      pesanan_id, tukar_faktur_id, is_tf_quick_add,
      purchase_date, supplier_invoice_number,
      payment_method,                                     -- ← FIX: was missing
      payment_due_at, paid_at,
      subtotal, total, status, paid_amount, notes, created_by_user_id
    ) VALUES (
      v_quick_id, public.generate_pi_number(), 'STOCK', v_supplier_id,
      NULL, v_tf_id, true,
      (v_quick_item->>'purchase_date')::date,
      v_quick_item->>'supplier_invoice_number',
      COALESCE(v_quick_item->>'payment_method', 'TRANSFER'),  -- accept override else default
      (v_quick_item->>'payment_due_at')::date, NULL,
      (v_quick_item->>'total')::numeric, (v_quick_item->>'total')::numeric,
      'BELUM_LUNAS', 0,
      'TF quick-add — items kosong, link Pesanan nanti kalau perlu',
      auth.uid()
    );
    v_total := v_total + (v_quick_item->>'total')::numeric;
  END LOOP;

  SELECT v_total + COALESCE(SUM(total), 0) INTO v_total
  FROM public.purchase_invoices WHERE id = ANY(v_tagihan_ids);

  INSERT INTO public.tukar_faktur (
    id, tf_number, supplier_id, tukar_date, payment_due_at,
    total_amount, photo_urls, notes, created_by_user_id
  ) VALUES (
    v_tf_id, v_tf_number, v_supplier_id, v_tukar_date, v_due_at,
    v_total, v_photo_urls, v_notes, auth.uid()
  );

  UPDATE public.purchase_invoices SET tukar_faktur_id = v_tf_id
  WHERE id = ANY(v_tagihan_ids) AND tukar_faktur_id IS NULL;

  RETURN jsonb_build_object('tf_number', v_tf_number, 'tf_id', v_tf_id);
END;
$$;

COMMIT;
