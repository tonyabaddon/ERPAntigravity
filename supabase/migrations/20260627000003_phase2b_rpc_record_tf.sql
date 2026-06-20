-- supabase/migrations/20260627000003_phase2b_rpc_record_tf.sql
-- Phase 2b: generate_tf_number + record_tukar_faktur atomic RPC.
-- record_tukar_faktur bundles existing Tagihans + optional foreign-faktur quick_add Tagihans into a TF.

BEGIN;

CREATE OR REPLACE FUNCTION public.generate_tf_number() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_yyyy text := to_char((now() AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY');
  v_mm   text := to_char((now() AT TIME ZONE 'Asia/Jakarta')::date, 'MM');
  v_n    int;
  v_nnn  text;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(tf_number FROM 12) AS INT)), 0) + 1 INTO v_n
  FROM public.tukar_faktur
  WHERE tf_number LIKE 'TF-' || v_yyyy || '-' || v_mm || '-%';
  v_nnn := LPAD(v_n::text, 3, '0');
  RETURN 'TF-' || v_yyyy || '-' || v_mm || '-' || v_nnn;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_tf_number() TO authenticated;

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
  -- Validate header
  IF v_supplier_id IS NULL THEN RAISE EXCEPTION 'supplier_id required'; END IF;
  IF v_tukar_date IS NULL THEN RAISE EXCEPTION 'tukar_date required'; END IF;
  IF v_due_at IS NULL THEN RAISE EXCEPTION 'payment_due_at required'; END IF;

  -- Parse arrays
  v_tagihan_ids := ARRAY(SELECT jsonb_array_elements_text(COALESCE(payload->'tagihan_ids', '[]'::jsonb)))::uuid[];
  v_photo_urls := ARRAY(SELECT jsonb_array_elements_text(COALESCE(payload->'photo_urls', '[]'::jsonb)));

  -- Must have at least one Faktur (existing or quick-add)
  IF array_length(v_tagihan_ids, 1) IS NULL AND jsonb_array_length(v_quick_add) = 0 THEN
    RAISE EXCEPTION 'tf_must_have_at_least_one_faktur';
  END IF;

  -- Same-supplier check on existing Tagihans
  IF EXISTS (
    SELECT 1 FROM public.purchase_invoices
    WHERE id = ANY(v_tagihan_ids) AND supplier_id <> v_supplier_id
  ) THEN
    RAISE EXCEPTION 'same_supplier_violation';
  END IF;

  -- Already-bundled check on existing Tagihans
  SELECT t.tf_number INTO v_existing_tf
  FROM public.purchase_invoices pi
  JOIN public.tukar_faktur t ON t.id = pi.tukar_faktur_id
  WHERE pi.id = ANY(v_tagihan_ids)
    AND t.voided_at IS NULL
  LIMIT 1;
  IF v_existing_tf IS NOT NULL THEN
    RAISE EXCEPTION 'tagihan_already_bundled: %', v_existing_tf;
  END IF;

  -- Insert quick-add Tagihans first (is_tf_quick_add=true, no Pesanan, no items)
  FOR v_quick_item IN SELECT * FROM jsonb_array_elements(v_quick_add) LOOP
    v_quick_id := gen_random_uuid();
    INSERT INTO public.purchase_invoices (
      id, pi_number, type, supplier_id,
      pesanan_id, tukar_faktur_id, is_tf_quick_add,
      purchase_date, supplier_invoice_number,
      payment_due_at, paid_at,
      subtotal, total, status, paid_amount, notes, created_by_user_id
    ) VALUES (
      v_quick_id, public.generate_pi_number(), 'STOCK', v_supplier_id,
      NULL, v_tf_id, true,
      (v_quick_item->>'purchase_date')::date,
      v_quick_item->>'supplier_invoice_number',
      (v_quick_item->>'payment_due_at')::date, NULL,
      (v_quick_item->>'total')::numeric, (v_quick_item->>'total')::numeric,
      'BELUM_LUNAS', 0,
      'TF quick-add — items kosong, link Pesanan nanti kalau perlu',
      auth.uid()
    );
    v_total := v_total + (v_quick_item->>'total')::numeric;
  END LOOP;

  -- Sum existing Tagihan totals
  SELECT v_total + COALESCE(SUM(total), 0) INTO v_total
  FROM public.purchase_invoices WHERE id = ANY(v_tagihan_ids);

  -- Insert TF
  INSERT INTO public.tukar_faktur (
    id, tf_number, supplier_id, tukar_date, payment_due_at,
    total_amount, photo_urls, notes, created_by_user_id
  ) VALUES (
    v_tf_id, v_tf_number, v_supplier_id, v_tukar_date, v_due_at,
    v_total, v_photo_urls, v_notes, auth.uid()
  );

  -- Link existing Tagihans (only those not already linked to ANY TF)
  UPDATE public.purchase_invoices SET tukar_faktur_id = v_tf_id
  WHERE id = ANY(v_tagihan_ids) AND tukar_faktur_id IS NULL;

  RETURN jsonb_build_object('tf_number', v_tf_number, 'tf_id', v_tf_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_tukar_faktur(jsonb) TO authenticated;

COMMIT;
