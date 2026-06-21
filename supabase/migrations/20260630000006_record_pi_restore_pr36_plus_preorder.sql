-- 20260630000006_record_pi_restore_pr36_plus_preorder.sql
--
-- Restores PR #36 (fix/code-review-critical, migrations 20260628000003-005)
-- record_pi behavior that T5 (commit 63596fe) accidentally overwrote, AND
-- preserves T5's preorder_fulfilled audit emit logic.
--
-- This is a coordination migration: PR #36 was still open when T5 landed; T5
-- created its body from the in-repo `20260620000023` definition which lacked
-- PR #36's extras. This migration is the merge:
--   - FOR UPDATE lock + structured RAISE before pesanan_items increment (PR #36)
--   - LUNAS auto-synthesize pembayaran + pembayaran_items + traceability
--     suffix in kasir_transactions description (PR #36)
--   - preorder_fulfilled audit_log emit when pre-call balance < 0 (T5)
--
-- When PR #36 eventually rebases onto main containing this migration, the
-- maintainer can drop their record_pi-modifying migrations (20260628000003
-- and 20260628000005) since this migration already incorporates their logic.

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
  -- PR #36: over-receive guard with FOR UPDATE lock
  v_pi_qty_ordered int;
  v_pi_qty_received int;
  -- PR #36: LUNAS pembayaran synthesis
  v_pembayaran_id uuid;
  v_pembayaran_number text;
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
      -- PR #36: Over-receive guard (bundled from 20260628000003). FOR UPDATE
      -- locks the pesanan_items row so concurrent record_pi calls against the
      -- same pesanan_item serialize, and the structured RAISE gives the UI a
      -- machine-parseable error code (OVER_RECEIVE / PESANAN_ITEM_NOT_FOUND).
      -- The DB CHECK constraint remains as a backstop, but this guard fires
      -- first with the richer diagnostic context.
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

      -- T5: compute pre-call stock balance BEFORE inserting the new lot, so
      -- the audit row can attribute (partial) fulfillment of pending pre-orders.
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

  -- PR #36: LUNAS-at-create synthesizes a Pembayaran + pembayaran_items + kasir
  -- row. Same final outcome as the legacy direct-insert path, but with a real
  -- Pembayaran row so the AP ledger ties out and the void path is symmetric.
  -- The Tagihan was inserted as LUNAS above (necessary to satisfy
  -- pi_belum_lunas_requires_due CHECK). _recompute_tagihan_status is
  -- idempotent: it computes paid_amount = subtotal from the new
  -- pembayaran_items sum, status stays LUNAS. Kept for consistency with the
  -- void path which DOES depend on it.
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

GRANT EXECUTE ON FUNCTION public.record_pi(jsonb) TO authenticated;

COMMIT;
