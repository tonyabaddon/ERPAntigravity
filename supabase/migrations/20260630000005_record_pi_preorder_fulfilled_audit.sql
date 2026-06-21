-- supabase/migrations/20260630000005_record_pi_preorder_fulfilled_audit.sql
-- Phase Catat Penjualan T5: extend record_pi to emit a 'preorder_fulfilled'
-- audit_log row when an incoming SKU's pre-call stock balance (SUM(qty_remaining)
-- across stock_lots) was negative. Captures FIFO-ordered pending order ids so the
-- Dashboard "Recent pre-order fulfillments" card (T25) can attribute the delivery
-- to the customers who were waiting.
--
-- Strategy: per-item loop computes v_pre_balance BEFORE the stock_lots INSERT;
-- after the INSERT, if v_pre_balance < 0 we emit the audit row.
--
-- orders.items JSONB shape (verified empirically):
--   [{ "sku": "...", "qty": N, "name": "...", "unit_price": N, "subtotal": N }]
-- so `items @> jsonb_build_array(jsonb_build_object('sku', v_sku))` works for FIFO.
--
-- Body of record_pi copied verbatim from 20260620000023_record_pi_cast_kasir_enum.sql
-- (most recent canonical definition in this branch).

BEGIN;

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
  -- T5: preorder_fulfilled audit
  v_pre_balance numeric;
  v_qty_delivered numeric;
  v_qty_fulfilled numeric;
  v_pending_order_ids uuid[];
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
      -- T5: compute pre-call stock balance BEFORE inserting the new lot
      SELECT COALESCE(SUM(qty_remaining), 0) INTO v_pre_balance
        FROM public.stock_lots
       WHERE sku = v_sku;
      v_qty_delivered := v_qty;

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

      -- T5: if pre-call balance was negative, this delivery (partially) fulfils
      -- pending pre-orders. Emit an audit row capturing the pending orders in
      -- FIFO order (oldest created_at first), bounded to last 90 days as a
      -- defensive guard against a runaway query if an SKU keeps drifting
      -- negative for very old orders.
      IF v_pre_balance < 0 THEN
        v_qty_fulfilled := LEAST(v_qty_delivered, -v_pre_balance);

        SELECT COALESCE(array_agg(id ORDER BY created_at), ARRAY[]::uuid[])
          INTO v_pending_order_ids
          FROM (
            SELECT id, created_at
              FROM public.orders
             WHERE items @> jsonb_build_array(jsonb_build_object('sku', v_sku))
               AND status IN (
                 'INVOICE_TEMPO',
                 'PAYMENT_VERIFIED',
                 'WAITING_PAYMENT',
                 'WAITING_DP',
                 'DP_VERIFIED'
               )
               AND created_at > now() - INTERVAL '90 days'
             ORDER BY created_at ASC
             LIMIT 50
          ) AS pending_orders;

        INSERT INTO public.audit_log (event_type, actor_user_id, payload)
        VALUES (
          'preorder_fulfilled',
          auth.uid(),
          jsonb_build_object(
            'sku', v_sku,
            'qty_delivered', v_qty_delivered,
            'qty_fulfilled', v_qty_fulfilled,
            'pre_call_balance', v_pre_balance,
            'pending_order_ids', COALESCE(to_jsonb(v_pending_order_ids), '[]'::jsonb),
            'supplier_id', payload->>'supplier_id',
            'pi_id', v_pi_id,
            'pi_number', v_pi_number,
            'pesanan_id', v_pesanan_id
          )
        );
      END IF;
    END IF;
  END LOOP;

  IF v_type = 'STOCK' AND v_pesanan_id IS NOT NULL THEN
    PERFORM public.set_pesanan_closed_if_fulfilled(v_pesanan_id);
  END IF;

  IF v_initial_status = 'LUNAS' THEN
    SELECT name INTO v_supplier_name FROM public.suppliers WHERE id = v_supplier_id;
    v_ref_label := CASE v_type
      WHEN 'STOCK' THEN 'utk Pesanan ' || (SELECT pesanan_number FROM public.pesanan WHERE id = v_pesanan_id)
      ELSE 'utk Order ' || COALESCE(v_order_id::text,'')
    END;
    INSERT INTO public.kasir_transactions (type, date, expense_category, description, subtotal, hpp_total)
    VALUES (
      'expense',
      (v_paid_at AT TIME ZONE 'Asia/Jakarta')::date,
      (CASE v_type WHEN 'STOCK' THEN 'Pembelian Stok' ELSE 'Pembelian Pass-Through' END)::public.kasir_expense_category,
      'TGH ' || v_pi_number || ' — ' || COALESCE(v_supplier_name,'') || ' — ' || v_ref_label,
      v_subtotal, 0
    );
  END IF;

  RETURN jsonb_build_object('pi_number', v_pi_number, 'pi_id', v_pi_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_pi(jsonb) TO authenticated;

COMMIT;
