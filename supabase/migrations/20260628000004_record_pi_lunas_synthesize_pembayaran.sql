-- 20260628000004_record_pi_lunas_synthesize_pembayaran.sql
--
-- Closes Critical #5 from the end-to-end code review (see
-- docs/superpowers/specs/2026-06-19-record-pi-lunas-synthesize-pembayaran-design.md
-- and progress.md 2026-06-19 entry).
--
-- BEFORE this migration, record_pi's LUNAS branch wrote:
--   purchase_invoices.paid_amount = subtotal     (denormalised, no audit trail)
--   purchase_invoices.status = 'LUNAS'           (set directly, not via sum-of-truth)
--   kasir_transactions (description tied to TGH, no PMB reference)
-- and crucially, NO pembayaran / pembayaran_items rows. Every consumer that
-- joins through pembayaran_items (cash-flow forecasts, payment-method
-- breakdowns, void-reversal accounting, per-account reconciliation) silently
-- skipped LUNAS-at-create Tagihans.
--
-- AFTER this migration, the LUNAS branch:
--   1. Inserts the Tagihan as BELUM_LUNAS with paid_amount=0
--   2. Generates a pembayaran_number via generate_pembayaran_number()
--   3. INSERTs a pembayaran row (account_id NULL since TagihanFormPage doesn't
--      capture one today; can be added later via Approach C upgrade)
--   4. INSERTs the pembayaran_items link
--   5. Calls _recompute_tagihan_status to flip the Tagihan to LUNAS via the
--      same sum-of-truth path that record_pembayaran/void_pembayaran use
--   6. INSERTs a single kasir expense row tied to the Pembayaran, with
--      description suffix '(otomatis dari TGH <pi_number>)' so the operator
--      can trace synthesized rows in the ledger
--
-- This migration also BUNDLES the over-receive guard from 20260628000003
-- (FOR UPDATE on pesanan_items + delta validation). Reason: CREATE OR
-- REPLACE FUNCTION is last-writer-wins, so the new body must be a complete
-- superset to remain deploy-order-independent.
--
-- No data backfill needed: prod scan 2026-06-19 returned 0 orphan LUNAS
-- Tagihans (all 4 historical LUNAS rows came from migration 010 backfill
-- and already have pembayaran_items links).

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

  -- payment_due_at is only required when the Tagihan starts BELUM_LUNAS.
  -- For LUNAS-at-create, payment is happening *now*, so no due date matters.
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

  -- ALWAYS insert the Tagihan as BELUM_LUNAS with paid_amount=0. If
  -- initial_status='LUNAS', we flip it to LUNAS via _recompute_tagihan_status
  -- AFTER inserting the synthesized pembayaran_items row. This keeps a single
  -- code path for the LUNAS state machine (sum-of-truth), regardless of
  -- whether the Pembayaran was created here or via record_pembayaran later.
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
    v_payment_due_at, NULL, payload->>'payment_proof_url',
    v_subtotal, v_subtotal, 'BELUM_LUNAS', 0,
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
      -- Over-receive guard (bundled from 20260628000003). Lock + delta-validate
      -- BEFORE mutating any side-effects so two concurrent Tagihan submissions
      -- for the same pesanan_item_id serialize correctly.
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
  -- All in the same transaction as the Tagihan INSERT above; if any step
  -- fails the entire record_pi call rolls back.
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

    -- Sum-of-truth: this flips purchase_invoices to LUNAS, sets paid_amount,
    -- sets paid_at. Same call record_pembayaran and void_pembayaran use.
    PERFORM public._recompute_tagihan_status(v_pi_id);

    -- Kasir expense row tied to the synthesized PMB. Description suffix
    -- '(otomatis dari TGH <pi_number>)' tells the operator this came from
    -- the one-click LUNAS shortcut rather than a manual Pembayaran entry.
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

COMMIT;
