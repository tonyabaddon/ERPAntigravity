-- supabase/migrations/20260614000011_pi_rpcs_create.sql
-- generate_pi_number + record_pi RPCs. Atomic: INSERTs header + items in one
-- transaction. Optionally inserts Kasir expense if initial_status=LUNAS.
-- Implements BR6 (soft duplicate-supplier-invoice-number warning).
--
-- Corrections applied:
-- - No order_item_id in items INSERT (table public.order_items doesn't exist)
-- - Uses orders.id::text instead of orders.order_number (column doesn't exist)
-- - Requires kasir_expense_category enum to include 'Pembelian Pass-Through'
--   (added in 20260614000010a_pi_kasir_enum.sql)

BEGIN;

CREATE OR REPLACE FUNCTION public.generate_pi_number() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  year_month text;
  next_seq int;
BEGIN
  year_month := to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM');
  SELECT COALESCE(MAX(CAST(split_part(pi_number, '-', 4) AS int)), 0) + 1
  INTO next_seq
  FROM public.purchase_invoices
  WHERE pi_number LIKE 'PI-' || year_month || '-%';
  RETURN 'PI-' || year_month || '-' || LPAD(next_seq::text, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.record_pi(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pi_number   text;
  v_pi_id       uuid;
  v_supplier_id uuid;
  v_order_id    uuid;
  v_supplier_invoice_number text;
  v_ignore_dup  boolean;
  v_existing_pi text;
  v_initial_status text;
  v_payment_due_at date;
  v_paid_at     timestamptz;
  v_subtotal    numeric := 0;
  v_supplier_name text;
  v_order_number text;
  v_item        jsonb;
BEGIN
  v_supplier_id := (payload->>'supplier_id')::uuid;
  v_order_id    := (payload->>'order_id')::uuid;
  v_supplier_invoice_number := payload->>'supplier_invoice_number';
  v_ignore_dup  := COALESCE((payload->>'ignore_duplicate_warning')::boolean, false);
  v_initial_status := COALESCE(payload->>'initial_status', 'BELUM_LUNAS');

  IF v_supplier_id IS NULL THEN RAISE EXCEPTION 'supplier_id required'; END IF;
  IF v_order_id IS NULL THEN RAISE EXCEPTION 'order_id required for PASSTHROUGH'; END IF;
  IF jsonb_array_length(COALESCE(payload->'items','[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'items required';
  END IF;

  -- BR6: soft duplicate warning
  IF v_supplier_invoice_number IS NOT NULL AND NOT v_ignore_dup THEN
    SELECT pi_number INTO v_existing_pi
    FROM public.purchase_invoices
    WHERE supplier_id = v_supplier_id
      AND supplier_invoice_number = v_supplier_invoice_number
      AND voided_at IS NULL
    LIMIT 1;
    IF v_existing_pi IS NOT NULL THEN
      RETURN jsonb_build_object(
        'warning', 'duplicate_supplier_invoice',
        'existing_pi', v_existing_pi
      );
    END IF;
  END IF;

  v_pi_number := public.generate_pi_number();

  IF v_initial_status = 'LUNAS' THEN
    v_paid_at := now();
    v_payment_due_at := NULL;
  ELSE
    v_payment_due_at := (payload->>'payment_due_at')::date;
    IF v_payment_due_at IS NULL THEN
      RAISE EXCEPTION 'payment_due_at required for BELUM_LUNAS';
    END IF;
  END IF;

  -- compute subtotal
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_subtotal := v_subtotal + ((v_item->>'qty')::int * (v_item->>'unit_cost')::numeric);
  END LOOP;

  INSERT INTO public.purchase_invoices (
    pi_number, type, supplier_id, order_id, purchase_date,
    supplier_invoice_number, supplier_invoice_photo_url,
    payment_method, payment_due_at, paid_at, payment_proof_url,
    subtotal, total, status, notes, created_by_user_id
  ) VALUES (
    v_pi_number, 'PASSTHROUGH', v_supplier_id, v_order_id,
    COALESCE((payload->>'purchase_date')::date, CURRENT_DATE),
    v_supplier_invoice_number,
    payload->>'supplier_invoice_photo_url',
    payload->>'payment_method',
    v_payment_due_at, v_paid_at, payload->>'payment_proof_url',
    v_subtotal, v_subtotal, v_initial_status,
    payload->>'notes', auth.uid()
  ) RETURNING id INTO v_pi_id;

  INSERT INTO public.purchase_invoice_items (
    pi_id, sku, product_name, qty, unit_cost, sell_price, subtotal
  )
  SELECT
    v_pi_id,
    item->>'sku',
    item->>'product_name',
    (item->>'qty')::int,
    (item->>'unit_cost')::numeric,
    (item->>'sell_price')::numeric,
    (item->>'qty')::int * (item->>'unit_cost')::numeric
  FROM jsonb_array_elements(payload->'items') item;

  -- Kasir expense if initial LUNAS
  IF v_initial_status = 'LUNAS' THEN
    SELECT name INTO v_supplier_name FROM public.suppliers WHERE id = v_supplier_id;
    v_order_number := v_order_id::text;  -- orders.order_number doesn't exist
    INSERT INTO public.kasir_transactions (
      type, date, expense_category, description, subtotal, hpp_total
    ) VALUES (
      'expense',
      (v_paid_at AT TIME ZONE 'Asia/Jakarta')::date,
      'Pembelian Pass-Through',
      'BNL ' || v_pi_number || ' — ' || COALESCE(v_supplier_name,'') ||
        ' — utk Order ' || COALESCE(v_order_number,''),
      v_subtotal,
      0
    );
  END IF;

  RETURN jsonb_build_object('pi_number', v_pi_number, 'pi_id', v_pi_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_pi_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_pi(jsonb) TO authenticated;

COMMIT;
