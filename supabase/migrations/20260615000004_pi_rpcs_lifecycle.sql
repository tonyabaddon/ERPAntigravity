-- supabase/migrations/20260615000004_pi_rpcs_lifecycle.sql
-- Lifecycle RPCs: mark_pi_paid (BELUM -> LUNAS + insert Kasir expense),
-- void_pi (LUNAS -> VOIDED + reversal Kasir expense), update_pi (edit BELUM).
--
-- Corrections applied (from plan C1-C5):
-- - Uses orders.id::text instead of orders.order_number (column doesn't exist)
-- - Uses 'Pembelian Pass-Through' enum value (added in 20260615000002)
-- - update_pi INSERT does NOT reference order_item_id (column dropped per C2)

BEGIN;

CREATE OR REPLACE FUNCTION public.mark_pi_paid(p_pi_id uuid, p_proof_url text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pi    public.purchase_invoices%ROWTYPE;
  v_supplier_name text;
  v_order_number text;
BEGIN
  SELECT * INTO v_pi FROM public.purchase_invoices WHERE id = p_pi_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PI not found'; END IF;
  IF v_pi.status <> 'BELUM_LUNAS' THEN
    RAISE EXCEPTION 'PI status must be BELUM_LUNAS to mark paid (current: %)', v_pi.status;
  END IF;
  IF v_pi.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot mark voided PI as paid';
  END IF;

  UPDATE public.purchase_invoices
  SET status = 'LUNAS',
      paid_at = now(),
      payment_proof_url = COALESCE(p_proof_url, payment_proof_url),
      payment_due_at = NULL,
      updated_at = now()
  WHERE id = p_pi_id;

  SELECT name INTO v_supplier_name FROM public.suppliers WHERE id = v_pi.supplier_id;
  v_order_number := v_pi.order_id::text;  -- orders.order_number doesn't exist

  INSERT INTO public.kasir_transactions (
    type, date, expense_category, description, subtotal, hpp_total
  ) VALUES (
    'expense',
    (now() AT TIME ZONE 'Asia/Jakarta')::date,
    'Pembelian Pass-Through',
    'BNL ' || v_pi.pi_number || ' — ' || COALESCE(v_supplier_name,'') ||
      ' — utk Order ' || COALESCE(v_order_number,''),
    v_pi.total,
    0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.void_pi(p_pi_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pi public.purchase_invoices%ROWTYPE;
  v_supplier_name text;
BEGIN
  IF length(COALESCE(p_reason,'')) < 10 THEN
    RAISE EXCEPTION 'void reason must be at least 10 characters';
  END IF;
  SELECT * INTO v_pi FROM public.purchase_invoices WHERE id = p_pi_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PI not found'; END IF;
  IF v_pi.voided_at IS NOT NULL THEN RAISE EXCEPTION 'PI already voided'; END IF;
  IF v_pi.status <> 'LUNAS' THEN
    RAISE EXCEPTION 'only LUNAS PI can be voided (current: %)', v_pi.status;
  END IF;

  UPDATE public.purchase_invoices
  SET voided_at = now(),
      voided_by_user_id = auth.uid(),
      void_reason = p_reason,
      updated_at = now()
  WHERE id = p_pi_id;

  SELECT name INTO v_supplier_name FROM public.suppliers WHERE id = v_pi.supplier_id;
  INSERT INTO public.kasir_transactions (
    type, date, expense_category, description, subtotal, hpp_total
  ) VALUES (
    'expense',
    (now() AT TIME ZONE 'Asia/Jakarta')::date,
    'Pembelian Pass-Through',
    'VOID BNL ' || v_pi.pi_number || ' — ' || COALESCE(v_supplier_name,''),
    -v_pi.total,
    0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_pi(p_pi_id uuid, payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pi public.purchase_invoices%ROWTYPE;
  v_subtotal numeric := 0;
  v_item jsonb;
  v_due date;
BEGIN
  SELECT * INTO v_pi FROM public.purchase_invoices WHERE id = p_pi_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PI not found'; END IF;
  IF v_pi.voided_at IS NOT NULL THEN RAISE EXCEPTION 'cannot edit voided PI'; END IF;
  IF v_pi.status <> 'BELUM_LUNAS' THEN
    RAISE EXCEPTION 'only BELUM_LUNAS PI can be edited (current: %)', v_pi.status;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_subtotal := v_subtotal + ((v_item->>'qty')::int * (v_item->>'unit_cost')::numeric);
  END LOOP;
  v_due := (payload->>'payment_due_at')::date;
  IF v_due IS NULL THEN RAISE EXCEPTION 'payment_due_at required'; END IF;

  UPDATE public.purchase_invoices SET
    supplier_id = COALESCE((payload->>'supplier_id')::uuid, supplier_id),
    order_id = COALESCE((payload->>'order_id')::uuid, order_id),
    purchase_date = COALESCE((payload->>'purchase_date')::date, purchase_date),
    supplier_invoice_number = payload->>'supplier_invoice_number',
    supplier_invoice_photo_url = payload->>'supplier_invoice_photo_url',
    payment_method = COALESCE(payload->>'payment_method', payment_method),
    payment_due_at = v_due,
    notes = payload->>'notes',
    subtotal = v_subtotal,
    total = v_subtotal,
    updated_at = now()
  WHERE id = p_pi_id;

  DELETE FROM public.purchase_invoice_items WHERE pi_id = p_pi_id;
  INSERT INTO public.purchase_invoice_items (
    pi_id, sku, product_name, qty, unit_cost, sell_price, subtotal
  )
  SELECT
    p_pi_id, item->>'sku', item->>'product_name',
    (item->>'qty')::int, (item->>'unit_cost')::numeric, (item->>'sell_price')::numeric,
    (item->>'qty')::int * (item->>'unit_cost')::numeric
  FROM jsonb_array_elements(payload->'items') item;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_pi_paid(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_pi(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_pi(uuid, jsonb) TO authenticated;

COMMIT;
