-- 20260628000005_record_pi_lunas_direct_insert_fix.sql
--
-- HOTFIX for migration 20260628000004. The previous rewrite inserted the
-- Tagihan as BELUM_LUNAS first (intending to flip to LUNAS via
-- _recompute_tagihan_status after the pembayaran_items row was synthesized).
-- That pattern conflicts with the pre-existing CHECK constraint
-- `pi_belum_lunas_requires_due`, which requires `payment_due_at IS NOT NULL`
-- when status='BELUM_LUNAS'. For LUNAS-at-create the function intentionally
-- skips computing `payment_due_at`, so the intermediate-state insert tripped
-- the constraint and `record_pi` failed.
--
-- Live smoke caught this immediately on the first LUNAS-at-create call:
--   ERROR  23514: new row for relation "purchase_invoices" violates check
--   constraint "pi_belum_lunas_requires_due"
--
-- Fix: insert directly with the target status/paid_amount/paid_at (same as
-- the pre-Critical-#5 path), then synthesize the pembayaran + pembayaran_items
-- + kasir row. `_recompute_tagihan_status` still runs afterwards — it computes
-- the same final state (paid=subtotal, status=LUNAS) from the synthesized
-- pembayaran_items sum, so the call is now idempotent. End state is identical
-- to the spec's design; only the intermediate-state ordering changes.
--
-- No new behavior, no schema change. Only the INSERT VALUES line for
-- purchase_invoices is touched relative to migration 20260628000004.

CREATE OR REPLACE FUNCTION public.record_pi(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_type text;
  v_pi_number text;
  v_pi_id uuid;
  v_supplier_id uuid;
  v_order_id uuid;
  v_pesanan_id uuid;
  v_supplier_invoice_number text;
  v_ignore_dup boolean;
  v_existing_pi text;
  v_initial_status text;
  v_payment_due_at date;
  v_paid_at timestamptz;
  v_subtotal numeric := 0;
  v_supplier_name text;
  v_ref_label text;
  v_item jsonb;
  v_pesanan_item_id uuid;
  v_sku varchar;
  v_qty int;
  v_unit_cost numeric;
  v_warehouse_id uuid;
  v_pi_qty_ordered int;
  v_pi_qty_received int;
  v_pembayaran_id uuid;
  v_pembayaran_number text;
BEGIN
  v_type := COALESCE(payload->>'type', 'PASSTHROUGH');
  v_supplier_id := (payload->>'supplier_id')::uuid;
  v_supplier_invoice_number := payload->>'supplier_invoice_number';
  v_ignore_dup := COALESCE((payload->>'ignore_duplicate_warning')::boolean, false);
  v_initial_status := COALESCE(payload->>'initial_status', 'BELUM_LUNAS');

  IF v_supplier_id IS NULL THEN RAISE EXCEPTION 'supplier_id required'; END IF;
  IF jsonb_array_length(COALESCE(payload->'items','[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'items required';
  END IF;

  IF v_type = 'PASSTHROUGH' THEN
    v_order_id := (payload->>'order_id')::uuid;
    IF v_order_id IS NULL THEN RAISE EXCEPTION 'order_id required for PASSTHROUGH'; END IF;
  ELSIF v_type = 'STOCK' THEN
    v_pesanan_id := (payload->>'pesanan_id')::uuid;
    IF v_pesanan_id IS NULL THEN
      RAISE EXCEPTION 'pesanan_id required for type=STOCK. Buat Pesanan dulu, atau pakai Belanja Numpang Lewat untuk pass-through customer.';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid type: %', v_type;
  END IF;

  IF v_supplier_invoice_number IS NOT NULL AND NOT v_ignore_dup THEN
    SELECT pi_number INTO v_existing_pi FROM public.purchase_invoices
    WHERE supplier_id = v_supplier_id
      AND supplier_invoice_number = v_supplier_invoice_number
      AND voided_at IS NULL LIMIT 1;
    IF v_existing_pi IS NOT NULL THEN
      RETURN jsonb_build_object('warning','duplicate_supplier_invoice','existing_pi',v_existing_pi);
    END IF;
  END IF;

  v_pi_number := public.generate_pi_number();

  IF v_initial_status = 'LUNAS' THEN
    v_paid_at := now();
  ELSE
    v_payment_due_at := (payload->>'payment_due_at')::date;
    IF v_payment_due_at IS NULL THEN
      RAISE EXCEPTION 'payment_due_at required for BELUM_LUNAS';
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_subtotal := v_subtotal + ((v_item->>'qty')::int * (v_item->>'unit_cost')::numeric);
  END LOOP;

  -- Insert the Tagihan directly in its target state (LUNAS or BELUM_LUNAS).
  -- We can NOT briefly insert as BELUM_LUNAS-then-flip because
  -- pi_belum_lunas_requires_due CHECK fires intra-transaction. Final state
  -- is identical to the spec's design — the pembayaran_items synthesis below
  -- still happens, and _recompute_tagihan_status runs at the end for
  -- idempotency with the void path.
  INSERT INTO public.purchase_invoices (
    pi_number, type, supplier_id, order_id, pesanan_id, purchase_date,
    supplier_invoice_number, supplier_invoice_photo_url,
    payment_method, payment_due_at, paid_at, payment_proof_url,
    subtotal, total, status, paid_amount, notes, created_by_user_id
  ) VALUES (
    v_pi_number, v_type, v_supplier_id, v_order_id, v_pesanan_id,
    COALESCE((payload->>'purchase_date')::date, CURRENT_DATE),
    v_supplier_invoice_number,
    payload->>'supplier_invoice_photo_url',
    payload->>'payment_method',
    v_payment_due_at, v_paid_at, payload->>'payment_proof_url',
    v_subtotal, v_subtotal, v_initial_status,
    CASE WHEN v_initial_status = 'LUNAS' THEN v_subtotal ELSE 0 END,
    payload->>'notes', auth.uid()
  ) RETURNING id INTO v_pi_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_sku := v_item->>'sku';
    v_qty := (v_item->>'qty')::int;
    v_unit_cost := (v_item->>'unit_cost')::numeric;
    v_pesanan_item_id := NULLIF(v_item->>'pesanan_item_id','')::uuid;
    v_warehouse_id := NULLIF(v_item->>'warehouse_id','')::uuid;

    INSERT INTO public.purchase_invoice_items (
      pi_id, sku, product_name, qty, unit_cost, sell_price, subtotal, pesanan_item_id
    ) VALUES (
      v_pi_id, v_sku, v_item->>'product_name',
      v_qty, v_unit_cost, (v_item->>'sell_price')::numeric,
      v_qty * v_unit_cost, v_pesanan_item_id
    );

    IF v_type = 'STOCK' THEN
      -- Over-receive guard (bundled from 20260628000003).
      IF v_pesanan_item_id IS NOT NULL THEN
        SELECT qty, qty_received_total
          INTO v_pi_qty_ordered, v_pi_qty_received
          FROM public.pesanan_items
         WHERE id = v_pesanan_item_id
         FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'PESANAN_ITEM_NOT_FOUND: %', v_pesanan_item_id;
        END IF;
        IF v_pi_qty_received + v_qty > v_pi_qty_ordered THEN
          RAISE EXCEPTION 'OVER_RECEIVE: sku=% pesanan_item=% qty_ordered=% qty_already_received=% qty_in_this_tagihan=% (would exceed by %)',
            v_sku, v_pesanan_item_id,
            v_pi_qty_ordered, v_pi_qty_received, v_qty,
            (v_pi_qty_received + v_qty) - v_pi_qty_ordered;
        END IF;
      END IF;

      INSERT INTO public.stock_lots (sku, source_id, source_type, unit_cost, qty_received, qty_remaining, received_at)
      VALUES (v_sku, v_pi_id, 'TAGIHAN', v_unit_cost, v_qty, v_qty, now());

      IF v_warehouse_id IS NOT NULL THEN
        INSERT INTO public.stock_levels (sku, warehouse_id, qty)
        VALUES (v_sku, v_warehouse_id, v_qty)
        ON CONFLICT (sku, warehouse_id) DO UPDATE
          SET qty = stock_levels.qty + EXCLUDED.qty;
      END IF;

      IF v_pesanan_item_id IS NOT NULL THEN
        UPDATE public.pesanan_items SET qty_received_total = qty_received_total + v_qty
        WHERE id = v_pesanan_item_id;
      END IF;
    END IF;
  END LOOP;

  IF v_type = 'STOCK' AND v_pesanan_id IS NOT NULL THEN
    PERFORM public.set_pesanan_closed_if_fulfilled(v_pesanan_id);
  END IF;

  -- LUNAS-at-create: synthesize a Pembayaran + pembayaran_items + kasir row.
  -- Same final outcome as before, but the Tagihan was already inserted as
  -- LUNAS above (necessary to satisfy pi_belum_lunas_requires_due CHECK).
  -- _recompute_tagihan_status at the bottom is idempotent: it computes
  -- paid_amount = subtotal from the new pembayaran_items sum, status stays
  -- LUNAS. Kept for consistency with the void path which DOES depend on it.
  IF v_initial_status = 'LUNAS' THEN
    v_pembayaran_number := public.generate_pembayaran_number();

    INSERT INTO public.pembayaran (
      pembayaran_number, supplier_id, paid_at, payment_method,
      account_id, account_label,
      amount_total, discount_amount, proof_url, notes, created_by_user_id
    ) VALUES (
      v_pembayaran_number, v_supplier_id, v_paid_at, payload->>'payment_method',
      NULL, NULL,
      v_subtotal, 0, payload->>'payment_proof_url', payload->>'notes', auth.uid()
    ) RETURNING id INTO v_pembayaran_id;

    INSERT INTO public.pembayaran_items (pembayaran_id, tagihan_id, tukar_faktur_id, amount)
    VALUES (v_pembayaran_id, v_pi_id, NULL, v_subtotal);

    PERFORM public._recompute_tagihan_status(v_pi_id);

    SELECT name INTO v_supplier_name FROM public.suppliers WHERE id = v_supplier_id;
    INSERT INTO public.kasir_transactions (type, date, expense_category, description, subtotal, hpp_total)
    VALUES (
      'expense',
      (v_paid_at AT TIME ZONE 'Asia/Jakarta')::date,
      (CASE v_type WHEN 'STOCK' THEN 'Pembelian Stok' ELSE 'Pembelian Pass-Through' END)::public.kasir_expense_category,
      'Pembayaran ' || v_pembayaran_number || ' — ' || COALESCE(v_supplier_name,'')
        || ' (otomatis dari TGH ' || v_pi_number || ')',
      v_subtotal,
      0
    );
  END IF;

  RETURN jsonb_build_object('pi_number', v_pi_number, 'pi_id', v_pi_id);
END;
$$;
