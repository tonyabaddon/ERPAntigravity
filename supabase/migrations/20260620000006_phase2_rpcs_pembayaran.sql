-- supabase/migrations/20260620000006_phase2_rpcs_pembayaran.sql
-- generate_pembayaran_number, record_pembayaran (atomic: insert + update Tagihan paid_amount + status + Kasir expense), void_pembayaran (reverse).

BEGIN;

CREATE OR REPLACE FUNCTION public.generate_pembayaran_number() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE year_month text; next_seq int;
BEGIN
  year_month := to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM');
  SELECT COALESCE(MAX(CAST(split_part(pembayaran_number, '-', 4) AS int)), 0) + 1
  INTO next_seq FROM public.pembayaran
  WHERE pembayaran_number LIKE 'PMB-' || year_month || '-%';
  RETURN 'PMB-' || year_month || '-' || LPAD(next_seq::text, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public._recompute_tagihan_status(p_tagihan_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_total numeric; v_paid numeric;
BEGIN
  SELECT total INTO v_total FROM public.purchase_invoices WHERE id = p_tagihan_id;
  SELECT COALESCE(SUM(pi_t.amount), 0) INTO v_paid
  FROM public.pembayaran_items pi_t
  JOIN public.pembayaran p ON p.id = pi_t.pembayaran_id
  WHERE pi_t.tagihan_id = p_tagihan_id AND p.status <> 'VOIDED';

  UPDATE public.purchase_invoices SET
    paid_amount = v_paid,
    status = CASE
      WHEN v_paid <= 0 THEN 'BELUM_LUNAS'
      WHEN v_paid < v_total THEN 'DIBAYAR_SEBAGIAN'
      ELSE 'LUNAS'
    END,
    paid_at = CASE WHEN v_paid >= v_total THEN now() ELSE NULL END,
    updated_at = now()
  WHERE id = p_tagihan_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_pembayaran(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_number text;
  v_id uuid;
  v_supplier_id uuid;
  v_amount_total numeric := 0;
  v_item jsonb;
  v_tagihan_id uuid;
  v_tagihan_total numeric;
  v_tagihan_paid numeric;
  v_supplier_name text;
BEGIN
  v_supplier_id := (payload->>'supplier_id')::uuid;
  IF v_supplier_id IS NULL THEN RAISE EXCEPTION 'supplier_id required'; END IF;
  IF jsonb_array_length(COALESCE(payload->'items','[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'items required'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_amount_total := v_amount_total + (v_item->>'amount')::numeric;
    v_tagihan_id := NULLIF(v_item->>'tagihan_id','')::uuid;
    IF v_tagihan_id IS NOT NULL THEN
      SELECT total, paid_amount INTO v_tagihan_total, v_tagihan_paid
      FROM public.purchase_invoices WHERE id = v_tagihan_id FOR UPDATE;
      IF v_tagihan_paid + (v_item->>'amount')::numeric > v_tagihan_total + 0.01 THEN
        RAISE EXCEPTION 'Tagihan % overpayment (current paid % + new % > total %)',
          v_tagihan_id, v_tagihan_paid, (v_item->>'amount')::numeric, v_tagihan_total;
      END IF;
    END IF;
  END LOOP;

  v_number := public.generate_pembayaran_number();
  INSERT INTO public.pembayaran (
    pembayaran_number, supplier_id, paid_at, payment_method,
    account_id, account_label, amount_total, discount_amount, proof_url, notes, created_by_user_id
  ) VALUES (
    v_number, v_supplier_id,
    COALESCE((payload->>'paid_at')::timestamptz, now()),
    payload->>'payment_method',
    NULLIF(payload->>'account_id','')::uuid,
    payload->>'account_label',
    v_amount_total,
    COALESCE((payload->>'discount_amount')::numeric, 0),
    payload->>'proof_url',
    payload->>'notes',
    auth.uid()
  ) RETURNING id INTO v_id;

  INSERT INTO public.pembayaran_items (pembayaran_id, tagihan_id, tukar_faktur_id, amount)
  SELECT v_id,
    NULLIF(item->>'tagihan_id','')::uuid,
    NULLIF(item->>'tukar_faktur_id','')::uuid,
    (item->>'amount')::numeric
  FROM jsonb_array_elements(payload->'items') item;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_tagihan_id := NULLIF(v_item->>'tagihan_id','')::uuid;
    IF v_tagihan_id IS NOT NULL THEN
      PERFORM public._recompute_tagihan_status(v_tagihan_id);
    END IF;
  END LOOP;

  SELECT name INTO v_supplier_name FROM public.suppliers WHERE id = v_supplier_id;
  INSERT INTO public.kasir_transactions (type, date, expense_category, description, subtotal, hpp_total)
  VALUES (
    'expense',
    (now() AT TIME ZONE 'Asia/Jakarta')::date,
    'Pembelian Stok',
    'Pembayaran ' || v_number || ' — ' || COALESCE(v_supplier_name,''),
    v_amount_total - COALESCE((payload->>'discount_amount')::numeric, 0),
    0
  );

  RETURN jsonb_build_object('pembayaran_number', v_number, 'pembayaran_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.void_pembayaran(p_pembayaran_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pembayaran public.pembayaran%ROWTYPE;
  v_item record;
BEGIN
  IF length(COALESCE(p_reason,'')) < 10 THEN
    RAISE EXCEPTION 'void reason must be at least 10 characters';
  END IF;
  SELECT * INTO v_pembayaran FROM public.pembayaran WHERE id = p_pembayaran_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pembayaran not found'; END IF;
  IF v_pembayaran.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Already voided'; END IF;

  UPDATE public.pembayaran SET
    status='VOIDED', voided_at=now(), voided_by_user_id=auth.uid(), void_reason=p_reason,
    updated_at=now()
  WHERE id = p_pembayaran_id;

  FOR v_item IN SELECT tagihan_id FROM public.pembayaran_items
                WHERE pembayaran_id = p_pembayaran_id AND tagihan_id IS NOT NULL LOOP
    PERFORM public._recompute_tagihan_status(v_item.tagihan_id);
  END LOOP;

  INSERT INTO public.kasir_transactions (type, date, expense_category, description, subtotal, hpp_total)
  VALUES (
    'expense',
    (now() AT TIME ZONE 'Asia/Jakarta')::date,
    'Pembelian Stok',
    'VOID Pembayaran ' || v_pembayaran.pembayaran_number || ' — ' || p_reason,
    -(v_pembayaran.amount_total - v_pembayaran.discount_amount),
    0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_pembayaran_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_pembayaran(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_pembayaran(uuid, text) TO authenticated;

COMMIT;
