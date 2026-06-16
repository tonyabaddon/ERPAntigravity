-- supabase/migrations/20260620000004_phase2_rpcs_pesanan.sql
-- generate_pesanan_number, record_pesanan, mark_pesanan_ordered, update_pesanan, void_pesanan.

BEGIN;

CREATE OR REPLACE FUNCTION public.generate_pesanan_number() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  year_month text;
  next_seq int;
BEGIN
  year_month := to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM');
  SELECT COALESCE(MAX(CAST(split_part(pesanan_number, '-', 4) AS int)), 0) + 1
  INTO next_seq
  FROM public.pesanan
  WHERE pesanan_number LIKE 'PSN-' || year_month || '-%';
  RETURN 'PSN-' || year_month || '-' || LPAD(next_seq::text, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.record_pesanan(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pesanan_number text;
  v_pesanan_id uuid;
  v_supplier_id uuid;
  v_initial_status text;
  v_subtotal numeric := 0;
  v_tax_rate numeric;
  v_tax_amount numeric;
  v_item jsonb;
BEGIN
  v_supplier_id := (payload->>'supplier_id')::uuid;
  v_initial_status := COALESCE(payload->>'initial_status', 'DRAFT');
  v_tax_rate := COALESCE((payload->>'tax_rate')::numeric, 0);

  IF v_supplier_id IS NULL THEN RAISE EXCEPTION 'supplier_id required'; END IF;
  IF jsonb_array_length(COALESCE(payload->'items','[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'items required';
  END IF;
  IF v_initial_status NOT IN ('DRAFT','ORDERED') THEN
    RAISE EXCEPTION 'initial_status must be DRAFT or ORDERED';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_subtotal := v_subtotal + ((v_item->>'qty')::int * (v_item->>'unit_cost')::numeric);
  END LOOP;
  v_tax_amount := v_subtotal * v_tax_rate;

  v_pesanan_number := public.generate_pesanan_number();

  INSERT INTO public.pesanan (
    pesanan_number, supplier_id, status, notes, ordered_at, expected_receive_at,
    tax_rate, tax_amount, subtotal, total, created_by_user_id
  ) VALUES (
    v_pesanan_number, v_supplier_id, v_initial_status,
    payload->>'notes',
    CASE WHEN v_initial_status = 'ORDERED' THEN now() ELSE NULL END,
    (payload->>'expected_receive_at')::date,
    v_tax_rate, v_tax_amount, v_subtotal, v_subtotal + v_tax_amount,
    auth.uid()
  ) RETURNING id INTO v_pesanan_id;

  INSERT INTO public.pesanan_items (pesanan_id, sku, product_name, qty, unit_cost, subtotal)
  SELECT v_pesanan_id, item->>'sku', item->>'product_name',
         (item->>'qty')::int, (item->>'unit_cost')::numeric,
         (item->>'qty')::int * (item->>'unit_cost')::numeric
  FROM jsonb_array_elements(payload->'items') item;

  RETURN jsonb_build_object('pesanan_number', v_pesanan_number, 'pesanan_id', v_pesanan_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_pesanan_ordered(p_pesanan_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.pesanan WHERE id = p_pesanan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pesanan not found'; END IF;
  IF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only DRAFT can be marked ORDERED (current: %)', v_status;
  END IF;
  UPDATE public.pesanan SET status='ORDERED', ordered_at=now(), updated_at=now()
  WHERE id = p_pesanan_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_pesanan(p_pesanan_id uuid, payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pesanan public.pesanan%ROWTYPE;
  v_subtotal numeric := 0;
  v_tax_rate numeric;
  v_item jsonb;
BEGIN
  SELECT * INTO v_pesanan FROM public.pesanan WHERE id = p_pesanan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pesanan not found'; END IF;
  IF v_pesanan.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only DRAFT Pesanan can be edited (current: %)', v_pesanan.status;
  END IF;

  v_tax_rate := COALESCE((payload->>'tax_rate')::numeric, v_pesanan.tax_rate);
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_subtotal := v_subtotal + ((v_item->>'qty')::int * (v_item->>'unit_cost')::numeric);
  END LOOP;

  UPDATE public.pesanan SET
    supplier_id = COALESCE((payload->>'supplier_id')::uuid, supplier_id),
    notes = payload->>'notes',
    expected_receive_at = (payload->>'expected_receive_at')::date,
    tax_rate = v_tax_rate,
    tax_amount = v_subtotal * v_tax_rate,
    subtotal = v_subtotal,
    total = v_subtotal + (v_subtotal * v_tax_rate),
    updated_at = now()
  WHERE id = p_pesanan_id;

  DELETE FROM public.pesanan_items WHERE pesanan_id = p_pesanan_id;
  INSERT INTO public.pesanan_items (pesanan_id, sku, product_name, qty, unit_cost, subtotal)
  SELECT p_pesanan_id, item->>'sku', item->>'product_name',
         (item->>'qty')::int, (item->>'unit_cost')::numeric,
         (item->>'qty')::int * (item->>'unit_cost')::numeric
  FROM jsonb_array_elements(payload->'items') item;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_pesanan(p_pesanan_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pesanan public.pesanan%ROWTYPE;
BEGIN
  IF length(COALESCE(p_reason,'')) < 10 THEN
    RAISE EXCEPTION 'void reason must be at least 10 characters';
  END IF;
  SELECT * INTO v_pesanan FROM public.pesanan WHERE id = p_pesanan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pesanan not found'; END IF;
  IF v_pesanan.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Pesanan already voided'; END IF;

  UPDATE public.pesanan SET
    voided_at = now(), voided_by_user_id = auth.uid(), void_reason = p_reason,
    updated_at = now()
  WHERE id = p_pesanan_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_pesanan_closed_if_fulfilled(p_pesanan_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_all_fulfilled boolean;
BEGIN
  SELECT NOT EXISTS (
    SELECT 1 FROM public.pesanan_items
    WHERE pesanan_id = p_pesanan_id AND qty_received_total < qty
  ) INTO v_all_fulfilled;
  IF v_all_fulfilled THEN
    UPDATE public.pesanan SET status='CLOSED', closed_at=now(), updated_at=now()
    WHERE id = p_pesanan_id AND status='ORDERED';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_pesanan_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_pesanan(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_pesanan_ordered(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_pesanan(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_pesanan(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_pesanan_closed_if_fulfilled(uuid) TO authenticated;

COMMIT;
