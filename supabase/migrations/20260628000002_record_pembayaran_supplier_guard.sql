-- 20260628000002_record_pembayaran_supplier_guard.sql
--
-- Silent data-integrity bug in `record_pembayaran` (Phase 2a foundation,
-- 20260620000006). The per-item loop fetches `total, paid_amount` from
-- `purchase_invoices WHERE id = v_tagihan_id` with NO supplier filter. A
-- Pembayaran nominally "for Supplier B" can be applied to Supplier A's
-- outstanding Tagihan: `pembayaran_items.tagihan_id` points at A's row,
-- A's `paid_amount` is bumped, A's status flips toward LUNAS, and the
-- kasir expense description still references Supplier B.
--
-- The frontend (PembayaranFormPage) only fetches outstanding Tagihans for
-- the picked supplier, so the bug isn't triggered by the UI happy path.
-- But the RPC itself has no guard — a malformed client payload (or any
-- future caller) can cross suppliers undetected. AP per-supplier dashboards
-- silently diverge from reality.
--
-- Fix: add `AND supplier_id = v_supplier_id` to the FOR UPDATE select and
-- raise on miss. Same lock window, same return shape, no behavior change
-- for correctly-formed payloads.

BEGIN;

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
      -- Bind the Tagihan to the Pembayaran's supplier. Without this guard a
      -- payload could allocate against a Tagihan owned by a different
      -- supplier, silently corrupting per-supplier AP totals.
      SELECT total, paid_amount INTO v_tagihan_total, v_tagihan_paid
      FROM public.purchase_invoices
      WHERE id = v_tagihan_id AND supplier_id = v_supplier_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'TAGIHAN_SUPPLIER_MISMATCH: tagihan % does not belong to supplier %',
          v_tagihan_id, v_supplier_id;
      END IF;
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

GRANT EXECUTE ON FUNCTION public.record_pembayaran(jsonb) TO authenticated;

COMMIT;
