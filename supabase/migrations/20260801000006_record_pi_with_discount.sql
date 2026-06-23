-- 20260801000006 — record_pi: payload + per-item discount + journal 5-1900 credit.
--
-- What changed (relative to 20260724000002_phase0c_record_pi_dual_write.sql):
--   1. Discount variables added (order-level + per-item).
--   2. Per-item loop now reads master_unit_cost, discount_type/value/amount_rp.
--   3. Three validations added (early, before any INSERT):
--        a. Per-item triple-consistency check  → DISCOUNT_TRIPLE_INVALID
--        b. Markup guard (master_unit_cost < unit_cost) → MARKUP_NOT_ALLOWED
--        c. Excessive line discount            → EXCESSIVE_LINE_DISCOUNT
--   4. Order-level triple-consistency check    → DISCOUNT_TRIPLE_INVALID
--   5. Order over-discount guard               → DISCOUNT_EXCEEDS_SUBTOTAL
--   6. Server recompute:
--        v_gross_subtotal     = SUM(unit_cost × qty)          (GL D 1-1510 anchor)
--        v_recomputed_subtotal = SUM(unit_cost × qty − line_discount) (PI.subtotal)
--        v_total              = v_recomputed_subtotal − order_discount_amt (PI.total)
--   7. INSERT purchase_invoices: 3 new cols (discount_type, discount_value, discount_amount_rp).
--   8. INSERT purchase_invoice_items: 4 new cols (master_unit_cost + 3 discount).
--        items.subtotal = (unit_cost × qty) − line_discount (net, not gross).
--   9. LUNAS synthesis uses v_total (not v_subtotal) to prevent AP mismatch.
--  10. GL dual-write (soft-fail):
--        No discount → D 1-1510 = K 2-1100 = v_gross_subtotal (backward-compat).
--        Discount > 0 → D 1-1510 = v_gross_subtotal,
--                        K 2-1100 = v_total,
--                        K 5-1900 = v_total_discount_rp.
--        JE always balanced; soft-fail anomaly log preserved.
--
-- CHECKs enumerated (purchase_invoices):
--   subtotal >= 0, total >= 0
--   pi_belum_lunas_requires_due, pi_lunas_requires_paid_at, pi_void_requires_reason
--   pi_passthrough_requires_order, pi_type_linkage_check
--   pi_discount_type_chk, pi_discount_value_chk, pi_discount_amount_chk
--   pi_discount_triple_chk
-- CHECKs enumerated (purchase_invoice_items):
--   qty > 0, unit_cost >= 0, sell_price >= 0, subtotal >= 0
--   pi_items_discount_type_chk, pi_items_discount_value_chk, pi_items_discount_amount_chk
--   pi_items_discount_triple_chk, pi_items_master_unit_cost_chk
-- All intermediate state kept in variables; no intermediate DB writes that trip CHECKs.
--
-- ── ORIGINAL FUNCTION BODY (20260724000002) captured for rollback reference ────
-- BEGIN
--   v_type := COALESCE(payload->>'type', 'PASSTHROUGH');
--   ... (supplier/items validation) ...
--   FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
--     v_subtotal := v_subtotal + ((v_item->>'qty')::int * (v_item->>'unit_cost')::numeric);
--   END LOOP;
--   INSERT INTO public.purchase_invoices (..., subtotal, total, ...) VALUES (..., v_subtotal, v_subtotal, ...);
--   FOR v_item IN ... LOOP
--     INSERT INTO public.purchase_invoice_items (pi_id, sku, product_name, qty, unit_cost, sell_price, subtotal, pesanan_item_id)
--     VALUES (v_pi_id, v_sku, ..., v_qty * v_unit_cost, v_pesanan_item_id);
--     IF v_type = 'STOCK' THEN ... stock_lots / stock_levels / pesanan_items updates ... END IF;
--   END LOOP;
--   IF v_type = 'STOCK' AND v_pesanan_id IS NOT NULL THEN
--     PERFORM public.set_pesanan_closed_if_fulfilled(v_pesanan_id);
--   END IF;
--   IF v_initial_status = 'LUNAS' THEN
--     INSERT pembayaran (amount_total = v_subtotal), pembayaran_items (amount = v_subtotal),
--     kasir_transactions (subtotal = v_subtotal);
--   END IF;
--   GL dual-write: D 1-1510 v_subtotal / K 2-1100 v_subtotal (soft-fail).
--   RETURN jsonb_build_object('pi_number', v_pi_number, 'pi_id', v_pi_id);
-- END;
-- ────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_pi(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  -- ── existing locals ──────────────────────────────────────────────────────────
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
  v_subtotal numeric := 0;      -- PI.subtotal = SUM(line_subtotal), set during validation loop
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
  -- Phase 0c: capture purchase_date for GL JE date consistency
  v_purchase_date date;
  -- ── discount locals (Task 12) ────────────────────────────────────────────────
  v_master_cost         NUMERIC;
  v_line_discount       NUMERIC;
  v_line_discount_total NUMERIC := 0;
  v_gross_subtotal      NUMERIC := 0;  -- SUM(unit_cost × qty); GL D 1-1510 anchor
  v_order_discount_type TEXT;
  v_order_discount_val  NUMERIC;
  v_order_discount_amt  NUMERIC := 0;
  v_total               NUMERIC := 0;  -- PI.total = subtotal − order_discount_amt
  v_total_discount_rp   NUMERIC := 0;  -- line_discount_total + order_discount_amt; 5-1900
BEGIN
  -- ── Step 0: read discount fields from payload ─────────────────────────────
  v_order_discount_type := payload->>'discount_type';
  v_order_discount_val  := (payload->>'discount_value')::numeric;
  v_order_discount_amt  := COALESCE((payload->>'discount_amount_rp')::numeric, 0);

  -- ── Step 1: type + supplier validation (unchanged from Phase 0c) ──────────
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

  -- ── Step 2: order-level triple-consistency check ──────────────────────────
  -- Triple rule: all-null = no discount; type+value both non-null = has discount.
  -- amount_rp must be provided when type is set (client computes, server re-validates).
  IF (v_order_discount_type IS NULL) <> (v_order_discount_val IS NULL) THEN
    RAISE EXCEPTION 'DISCOUNT_TRIPLE_INVALID: order-level discount_type/value inconsistent';
  END IF;

  -- ── Step 3: per-item validation pass (before any INSERT) ─────────────────
  -- Validates: per-item triple, markup guard, excessive line discount.
  -- Also accumulates v_gross_subtotal + v_line_discount_total for recompute.
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::jsonb)) LOOP
    v_unit_cost     := (v_item->>'unit_cost')::numeric;
    v_qty           := (v_item->>'qty')::int;
    v_master_cost   := COALESCE(NULLIF((v_item->>'master_unit_cost')::numeric, 0), v_unit_cost);
    v_line_discount := COALESCE((v_item->>'discount_amount_rp')::numeric, 0);

    -- Per-item triple-consistency
    DECLARE
      v_item_disc_type TEXT    := v_item->>'discount_type';
      v_item_disc_val  NUMERIC := (v_item->>'discount_value')::numeric;
    BEGIN
      IF (v_item_disc_type IS NULL) <> (v_item_disc_val IS NULL) THEN
        RAISE EXCEPTION 'DISCOUNT_TRIPLE_INVALID: sku=%', v_item->>'sku';
      END IF;
    END;

    -- Markup guard: master_unit_cost is the baseline; unit_cost > master = markup not allowed
    IF v_master_cost < v_unit_cost THEN
      RAISE EXCEPTION 'MARKUP_NOT_ALLOWED: sku=%', v_item->>'sku';
    END IF;

    -- Excessive line discount guard
    IF v_line_discount > (v_unit_cost * v_qty) THEN
      RAISE EXCEPTION 'EXCESSIVE_LINE_DISCOUNT: sku=%', v_item->>'sku';
    END IF;

    v_gross_subtotal      := v_gross_subtotal      + (v_unit_cost * v_qty);
    v_line_discount_total := v_line_discount_total + v_line_discount;
  END LOOP;

  -- ── Step 4: server recompute ──────────────────────────────────────────────
  -- v_subtotal = PI.subtotal = SUM(line_subtotal) = gross − line_discount_total
  v_subtotal := v_gross_subtotal - v_line_discount_total;

  -- Order over-discount guard
  IF v_order_discount_amt > v_subtotal THEN
    RAISE EXCEPTION 'DISCOUNT_EXCEEDS_SUBTOTAL';
  END IF;

  v_total             := v_subtotal - v_order_discount_amt;
  v_total_discount_rp := v_line_discount_total + v_order_discount_amt;

  -- ── Step 5: pi_number + dates (unchanged from Phase 0c) ──────────────────
  v_pi_number := public.generate_pi_number();

  -- Phase 0c: capture purchase_date before INSERT for use in GL JE date
  v_purchase_date := COALESCE((payload->>'purchase_date')::date, CURRENT_DATE);

  IF v_initial_status = 'LUNAS' THEN
    v_paid_at := now();
  ELSE
    v_payment_due_at := (payload->>'payment_due_at')::date;
    IF v_payment_due_at IS NULL THEN
      RAISE EXCEPTION 'payment_due_at required for BELUM_LUNAS';
    END IF;
  END IF;

  -- ── Step 6: INSERT purchase_invoices (extended with 3 discount cols) ──────
  -- subtotal = SUM(line_subtotal) = gross − line_discounts
  -- total    = subtotal − order_discount_amt
  -- paid_amount uses v_total (not v_subtotal) for LUNAS to avoid AP mismatch.
  INSERT INTO public.purchase_invoices (
    pi_number, type, supplier_id, order_id, pesanan_id, purchase_date,
    supplier_invoice_number, supplier_invoice_photo_url,
    payment_method, payment_due_at, paid_at, payment_proof_url,
    subtotal, total, status, paid_amount, notes, created_by_user_id,
    discount_type, discount_value, discount_amount_rp
  ) VALUES (
    v_pi_number, v_type, v_supplier_id, v_order_id, v_pesanan_id,
    v_purchase_date,
    v_supplier_invoice_number,
    payload->>'supplier_invoice_photo_url',
    payload->>'payment_method',
    v_payment_due_at, v_paid_at, payload->>'payment_proof_url',
    v_subtotal, v_total, v_initial_status,
    CASE WHEN v_initial_status = 'LUNAS' THEN v_total ELSE 0 END,
    payload->>'notes', auth.uid(),
    v_order_discount_type, v_order_discount_val, v_order_discount_amt
  ) RETURNING id INTO v_pi_id;

  -- ── Step 7: INSERT purchase_invoice_items + stock operations ─────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_sku             := v_item->>'sku';
    v_qty             := (v_item->>'qty')::int;
    v_unit_cost       := (v_item->>'unit_cost')::numeric;
    v_master_cost     := COALESCE(NULLIF((v_item->>'master_unit_cost')::numeric, 0), v_unit_cost);
    v_line_discount   := COALESCE((v_item->>'discount_amount_rp')::numeric, 0);
    v_pesanan_item_id := NULLIF(v_item->>'pesanan_item_id','')::uuid;
    v_warehouse_id    := NULLIF(v_item->>'warehouse_id','')::uuid;

    -- items.subtotal = net after line discount (SUM matches PI.subtotal)
    INSERT INTO public.purchase_invoice_items (
      pi_id, sku, product_name, qty, unit_cost, sell_price, subtotal, pesanan_item_id,
      master_unit_cost, discount_type, discount_value, discount_amount_rp
    ) VALUES (
      v_pi_id, v_sku, v_item->>'product_name',
      v_qty, v_unit_cost, (v_item->>'sell_price')::numeric,
      (v_unit_cost * v_qty) - v_line_discount, v_pesanan_item_id,
      v_master_cost,
      v_item->>'discount_type',
      (v_item->>'discount_value')::numeric,
      v_line_discount
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

  -- ── Step 8: LUNAS synthesis (uses v_total, not v_subtotal) ────────────────
  -- PR #36: LUNAS-at-create synthesizes a Pembayaran + pembayaran_items + kasir
  -- row. Uses v_total (net after all discounts) to ensure AP ledger ties out.
  -- Same final outcome as the legacy direct-insert path, but with a real
  -- Pembayaran row so the AP ledger ties out and the void path is symmetric.
  -- The Tagihan was inserted as LUNAS above (necessary to satisfy
  -- pi_belum_lunas_requires_due CHECK). _recompute_tagihan_status is
  -- idempotent: it computes paid_amount = total from the new
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
      v_total, 0, payload->>'payment_proof_url', payload->>'notes', auth.uid()
    ) RETURNING id INTO v_pembayaran_id;

    INSERT INTO public.pembayaran_items (pembayaran_id, tagihan_id, tukar_faktur_id, amount)
    VALUES (v_pembayaran_id, v_pi_id, NULL, v_total);

    PERFORM public._recompute_tagihan_status(v_pi_id);

    SELECT name INTO v_supplier_name FROM public.suppliers WHERE id = v_supplier_id;
    INSERT INTO public.kasir_transactions (type, date, expense_category, description, subtotal, hpp_total)
    VALUES (
      'expense',
      (v_paid_at AT TIME ZONE 'Asia/Jakarta')::date,
      (CASE v_type WHEN 'STOCK' THEN 'Pembelian Stok' ELSE 'Pembelian Pass-Through' END)::public.kasir_expense_category,
      'Pembayaran ' || v_pembayaran_number || ' — ' || COALESCE(v_supplier_name,'')
        || ' (otomatis dari TGH ' || v_pi_number || ')',
      v_total,
      0
    );
  END IF;

  -- ── GL Dual-write (soft-fail) ─────────────────────────────────────────────
  -- When no discount: D 1-1510 = K 2-1100 = v_gross_subtotal (backward-compat).
  -- When discount > 0: D 1-1510 = v_gross_subtotal (gross),
  --                    K 2-1100 = v_total (net AP),
  --                    K 5-1900 = v_total_discount_rp (discount recognized).
  -- JE is always balanced: gross = total + total_discount_rp.
  -- All GL errors caught → anomaly logged → RAISE WARNING → business RETURN proceeds.
  -- v_supplier_name fetched independently here because the LUNAS branch above
  -- only populates it for LUNAS status; BELUM_LUNAS leaves it NULL.
  DECLARE
    v_dual_write  boolean;
    v_gl_supplier text;
    v_gl_lines    jsonb;
  BEGIN
    SELECT enable_dual_write_to_gl
    INTO   v_dual_write
    FROM   public.accounting_config
    WHERE  tenant_id IS NULL
    LIMIT  1;

    IF COALESCE(v_dual_write, false) THEN
      BEGIN
        -- Fetch supplier name unconditionally for JE description
        SELECT name INTO v_gl_supplier FROM public.suppliers WHERE id = v_supplier_id;

        -- Build balanced lines array
        IF v_total_discount_rp > 0 THEN
          -- 3-line JE: D 1-1510 gross, K 2-1100 net, K 5-1900 discount
          v_gl_lines := jsonb_build_array(
            jsonb_build_object(
              'account_code', '1-1510',
              'side',         'DEBIT',
              'amount',       v_gross_subtotal,
              'description',  'Persediaan masuk'
            ),
            jsonb_build_object(
              'account_code', '2-1100',
              'side',         'CREDIT',
              'amount',       v_total,
              'description',  'Hutang ke ' || COALESCE(v_gl_supplier, '')
            ),
            jsonb_build_object(
              'account_code', '5-1900',
              'side',         'CREDIT',
              'amount',       v_total_discount_rp,
              'description',  'Diskon Pembelian TGH ' || v_pi_number
            )
          );
        ELSE
          -- 2-line JE (unchanged backward-compat when no discount)
          v_gl_lines := jsonb_build_array(
            jsonb_build_object(
              'account_code', '1-1510',
              'side',         'DEBIT',
              'amount',       v_gross_subtotal,
              'description',  'Persediaan masuk'
            ),
            jsonb_build_object(
              'account_code', '2-1100',
              'side',         'CREDIT',
              'amount',       v_gross_subtotal,
              'description',  'Hutang ke ' || COALESCE(v_gl_supplier, '')
            )
          );
        END IF;

        PERFORM public._post_journal_entry(
          v_purchase_date,
          'PI_TAGIHAN'::public.journal_entry_source,
          'Tagihan ' || v_pi_number || ' · ' || COALESCE(v_gl_supplier, ''),
          v_gl_lines,
          'purchase_invoices',
          v_pi_id,
          NULL,   -- tenant_id (single-tenant, NULL)
          NULL    -- reverses_entry_id
        );

      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.gl_dual_write_anomalies (
          source_rpc, source_ref_table, source_ref_id,
          error_code, error_message, attempted_payload
        ) VALUES (
          'record_pi',
          'purchase_invoices',
          v_pi_id,
          SQLSTATE,
          SQLERRM,
          jsonb_build_object(
            'pi_number',          v_pi_number,
            'pi_total',           v_total,
            'pi_subtotal',        v_subtotal,
            'total_discount_rp',  v_total_discount_rp,
            'supplier_id',        v_supplier_id,
            'purchase_date',      v_purchase_date
          )
        );
        RAISE WARNING 'GL dual-write failed for record_pi %: [%] %',
          v_pi_id, SQLSTATE, SQLERRM;
      END;
    END IF;
  END;
  -- ── End GL Dual-write ──────────────────────────────────────────────────────

  RETURN jsonb_build_object('pi_number', v_pi_number, 'pi_id', v_pi_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_pi(jsonb) TO authenticated;
