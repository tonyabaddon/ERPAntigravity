-- 20260910000013 — record_pi: Slice B PASSTHROUGH COA swap + accrual reclass
-- + Slice C LUNAS-at-create refactored to reuse record_pembayaran.
--
-- Design spec: §3.4, §3.5.
-- Rollback: RPC-only (shared PI_TAGIHAN enum with Phase 0c prevents clean JE
-- cleanup — see design §6.3).
--
-- ── SLICE B: PASSTHROUGH GL block ─────────────────────────────────────────────
-- Replaces the original D 1-1510 / K 2-1100 dual-write for PASSTHROUGH type.
-- New logic:
--   1. Look up outstanding 2-1150 accrual balance on the linked customer order
--      (posted by create_tempo_invoice Slice A when a passthrough SKU was sold
--      on tempo terms).
--   2. If accrual_balance >= v_subtotal → reclass: D 2-1150 / K 2-1100.
--   3. Otherwise (no prior accrual / historical / cash sale) → direct HPP debit:
--      D 5-1200 / K 2-1100.
-- STOCK type is unchanged: D 1-1510 (gross) / K 2-1100 (net) / K 5-1900 (disc).
-- Non-PKP (Garindo): no PPN line.
--
-- KNOWN LIMITATION (flag per advisor review):
--   Slice B uses v_subtotal (pre-discount gross) for the PASSTHROUGH AP line.
--   If a PASSTHROUGH PI has line or order discounts, the discount-recognised
--   credit (5-1900) is NOT added and AP is over-recognised by discount amount.
--   Acceptable for Phase 0c observability; full correction deferred to Phase 1
--   full-accrual cutover. Historical PASSTHROUGH entries booking 1-1510 remain
--   (spec §6.3 rollback note).
--
-- KNOWN LIMITATION (partial-reclass double-count):
--   If outstanding 2-1150 accrual > 0 but < v_subtotal, the threshold `>=`
--   means the non-accrual branch fires and books D 5-1200 K 2-1100 in full.
--   The partial 2-1150 balance is NOT reclassed. For mixed partial deliveries,
--   this may double-book the HPP portion already accrued at sale time. Deferred
--   to Phase 1. Logged here for audit trail.
--
-- ── SLICE C: LUNAS-at-create ──────────────────────────────────────────────────
-- Replaces the inline INSERT INTO pembayaran + pembayaran_items + kasir_transactions
-- block with PERFORM public.record_pembayaran(). record_pembayaran carries Phase
-- 0b GL dual-write (D 2-1100 K <cash COA>), so the payment leg is now automatic.
-- Gate: if account_id or payment_method missing → RAISE EXCEPTION LUNAS_REQUIRES_CASH_ACCOUNT.
-- Uses v_total (net after all discounts) for amount — NOT v_subtotal — to match
-- purchase_invoices.total and avoid record_pembayaran's overpayment guard.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CAPTURED ORIGINAL BODY (rollback reference — from 20260801000006):
--
-- CREATE OR REPLACE FUNCTION public.record_pi(payload jsonb) RETURNS jsonb
-- LANGUAGE plpgsql SECURITY DEFINER AS $$
-- DECLARE
--   -- ── existing locals ──────────────────────────────────────────────────────
--   v_type text;
--   v_pi_number text;
--   v_pi_id uuid;
--   v_supplier_id uuid;
--   v_order_id uuid;
--   v_pesanan_id uuid;
--   v_supplier_invoice_number text;
--   v_ignore_dup boolean;
--   v_existing_pi text;
--   v_initial_status text;
--   v_payment_due_at date;
--   v_paid_at timestamptz;
--   v_subtotal numeric := 0;
--   v_supplier_name text;
--   v_ref_label text;
--   v_item jsonb;
--   v_pesanan_item_id uuid;
--   v_sku varchar;
--   v_qty int;
--   v_unit_cost numeric;
--   v_warehouse_id uuid;
--   v_pi_qty_ordered int;
--   v_pi_qty_received int;
--   v_pembayaran_id uuid;
--   v_pembayaran_number text;
--   v_pre_balance numeric;
--   v_qty_delivered numeric;
--   v_qty_fulfilled numeric;
--   v_pending_order_ids uuid[];
--   v_purchase_date date;
--   -- ── discount locals (Task 12) ────────────────────────────────────────────
--   v_master_cost         NUMERIC;
--   v_line_discount       NUMERIC;
--   v_line_discount_total NUMERIC := 0;
--   v_gross_subtotal      NUMERIC := 0;
--   v_order_discount_type TEXT;
--   v_order_discount_val  NUMERIC;
--   v_order_discount_amt  NUMERIC := 0;
--   v_total               NUMERIC := 0;
--   v_total_discount_rp   NUMERIC := 0;
-- BEGIN
--   ... (see 20260801000006 for full body) ...
--   -- GL Dual-write (single block, all types): D 1-1510 / K 2-1100 / K 5-1900
--   -- LUNAS: inline INSERT INTO pembayaran + pembayaran_items + kasir_transactions
--   RETURN jsonb_build_object('pi_number', v_pi_number, 'pi_id', v_pi_id);
-- END;
-- $$;
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION public.record_pi(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- ── existing locals (unchanged from 20260801000006) ──────────────────────
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
  -- PR #36: LUNAS pembayaran synthesis (kept for var declarations; logic replaced in Slice C)
  v_pembayaran_id uuid;
  v_pembayaran_number text;
  -- T5: preorder_fulfilled audit
  v_pre_balance numeric;
  v_qty_delivered numeric;
  v_qty_fulfilled numeric;
  v_pending_order_ids uuid[];
  -- Phase 0c: capture purchase_date for GL JE date consistency
  v_purchase_date date;
  -- ── discount locals (Task 12, unchanged from 20260801000006) ────────────
  v_master_cost         NUMERIC;
  v_line_discount       NUMERIC;
  v_line_discount_total NUMERIC := 0;
  v_gross_subtotal      NUMERIC := 0;  -- SUM(unit_cost × qty); GL D 1-1510 anchor
  v_order_discount_type TEXT;
  v_order_discount_val  NUMERIC;
  v_order_discount_amt  NUMERIC := 0;
  v_total               NUMERIC := 0;  -- PI.total = subtotal − order_discount_amt
  v_total_discount_rp   NUMERIC := 0;  -- line_discount_total + order_discount_amt; 5-1900
  -- ── Slice B: new locals ──────────────────────────────────────────────────
  v_accrual_balance     NUMERIC := 0;  -- net 2-1150 balance on linked customer order
BEGIN
  -- ── Step 0: read discount fields from payload ─────────────────────────────
  v_order_discount_type := payload->>'discount_type';
  v_order_discount_val  := (payload->>'discount_value')::numeric;
  v_order_discount_amt  := COALESCE((payload->>'discount_amount_rp')::numeric, 0);

  -- ── Step 1: type + supplier validation (unchanged from 20260801000006) ───
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
  IF (v_order_discount_type IS NULL) <> (v_order_discount_val IS NULL) THEN
    RAISE EXCEPTION 'DISCOUNT_TRIPLE_INVALID: order-level discount_type/value inconsistent';
  END IF;

  -- ── Step 3: per-item validation pass (before any INSERT) ─────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::jsonb)) LOOP
    v_unit_cost     := (v_item->>'unit_cost')::numeric;
    v_qty           := (v_item->>'qty')::int;
    v_master_cost   := COALESCE(NULLIF((v_item->>'master_unit_cost')::numeric, 0), v_unit_cost);
    v_line_discount := COALESCE((v_item->>'discount_amount_rp')::numeric, 0);

    DECLARE
      v_item_disc_type TEXT    := v_item->>'discount_type';
      v_item_disc_val  NUMERIC := (v_item->>'discount_value')::numeric;
    BEGIN
      IF (v_item_disc_type IS NULL) <> (v_item_disc_val IS NULL) THEN
        RAISE EXCEPTION 'DISCOUNT_TRIPLE_INVALID: sku=%', v_item->>'sku';
      END IF;
    END;

    IF v_master_cost < v_unit_cost THEN
      RAISE EXCEPTION 'MARKUP_NOT_ALLOWED: sku=%', v_item->>'sku';
    END IF;

    IF v_line_discount > (v_unit_cost * v_qty) THEN
      RAISE EXCEPTION 'EXCESSIVE_LINE_DISCOUNT: sku=%', v_item->>'sku';
    END IF;

    v_gross_subtotal      := v_gross_subtotal      + (v_unit_cost * v_qty);
    v_line_discount_total := v_line_discount_total + v_line_discount;
  END LOOP;

  -- ── Step 4: server recompute ──────────────────────────────────────────────
  v_subtotal := v_gross_subtotal - v_line_discount_total;

  IF v_order_discount_amt > v_subtotal THEN
    RAISE EXCEPTION 'DISCOUNT_EXCEEDS_SUBTOTAL';
  END IF;

  v_total             := v_subtotal - v_order_discount_amt;
  v_total_discount_rp := v_line_discount_total + v_order_discount_amt;

  -- ── Step 5: pi_number + dates (unchanged from 20260801000006) ─────────────
  v_pi_number := public.generate_pi_number();

  v_purchase_date := COALESCE((payload->>'purchase_date')::date, CURRENT_DATE);

  IF v_initial_status = 'LUNAS' THEN
    v_paid_at := now();
  ELSE
    v_payment_due_at := (payload->>'payment_due_at')::date;
    IF v_payment_due_at IS NULL THEN
      RAISE EXCEPTION 'payment_due_at required for BELUM_LUNAS';
    END IF;
  END IF;

  -- ── Step 6: INSERT purchase_invoices (unchanged from 20260801000006) ──────
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
    -- paid_amount starts at 0 so record_pembayaran's overpayment guard
    -- (paid_amount + new_amount > total) doesn't fire. _recompute_tagihan_status
    -- inside record_pembayaran recomputes paid_amount = SUM(pembayaran_items) = v_total.
    -- For BELUM_LUNAS the 0 is correct.
    0,
    payload->>'notes', auth.uid(),
    v_order_discount_type, v_order_discount_val, v_order_discount_amt
  ) RETURNING id INTO v_pi_id;

  -- ── Step 7: INSERT purchase_invoice_items + stock operations ──────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_sku             := v_item->>'sku';
    v_qty             := (v_item->>'qty')::int;
    v_unit_cost       := (v_item->>'unit_cost')::numeric;
    v_master_cost     := COALESCE(NULLIF((v_item->>'master_unit_cost')::numeric, 0), v_unit_cost);
    v_line_discount   := COALESCE((v_item->>'discount_amount_rp')::numeric, 0);
    v_pesanan_item_id := NULLIF(v_item->>'pesanan_item_id','')::uuid;
    v_warehouse_id    := NULLIF(v_item->>'warehouse_id','')::uuid;

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

  -- ── Step 8: Slice C — LUNAS-at-create via record_pembayaran ──────────────
  -- Replaces inline INSERT INTO pembayaran + pembayaran_items + kasir_transactions
  -- from 20260801000006. Delegates to record_pembayaran so Phase 0b GL dual-
  -- write (D 2-1100 K <cash COA>) fires automatically.
  --
  -- Uses v_total (net after all discounts) NOT v_subtotal: record_pembayaran
  -- validates `paid + new <= tagihan.total + 0.01`; v_subtotal > v_total when
  -- discounts exist and would trip an overpayment exception.
  --
  -- account_id + payment_method are required; missing → LUNAS_REQUIRES_CASH_ACCOUNT.
  IF v_initial_status = 'LUNAS' THEN
    IF payload->>'account_id' IS NULL OR payload->>'payment_method' IS NULL THEN
      RAISE EXCEPTION 'LUNAS_REQUIRES_CASH_ACCOUNT: LUNAS-at-create requires payment_method + account_id';
    END IF;

    -- Delegate to record_pembayaran (Phase 0b dual-write present)
    PERFORM public.record_pembayaran(
      jsonb_build_object(
        'supplier_id',    v_supplier_id,
        'payment_method', payload->>'payment_method',
        'account_id',     payload->>'account_id',
        'account_label',  payload->>'account_label',
        'paid_at',        COALESCE((payload->>'paid_at')::timestamptz, now()),
        'items', jsonb_build_array(jsonb_build_object(
          'tagihan_id', v_pi_id,
          'amount',     v_total
        ))
      )
    );

    -- Sync purchase_invoices status to LUNAS (record_pembayaran calls
    -- _recompute_tagihan_status which updates paid_amount; status column is
    -- set here explicitly so callers see LUNAS immediately without re-query).
    UPDATE public.purchase_invoices
      SET status = 'LUNAS', paid_at = COALESCE((payload->>'paid_at')::timestamptz, now())
      WHERE id = v_pi_id;
  END IF;

  -- ── GL Dual-write (soft-fail, type-branched) ──────────────────────────────
  -- PASSTHROUGH (Slice B): accrual-aware COA swap.
  --   If outstanding 2-1150 credit on linked order >= v_subtotal → reclass
  --   (D 2-1150 K 2-1100). Otherwise direct HPP debit (D 5-1200 K 2-1100).
  -- STOCK (unchanged from 20260801000006):
  --   No discount → D 1-1510 = K 2-1100 = v_gross_subtotal.
  --   Discount > 0 → D 1-1510 = v_gross_subtotal, K 2-1100 = v_total,
  --                  K 5-1900 = v_total_discount_rp.
  -- All GL errors caught → anomaly logged → RAISE WARNING → business RETURN.
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

      IF v_type = 'PASSTHROUGH' THEN
        -- ── Slice B: PASSTHROUGH GL with accrual reclass ─────────────────────
        BEGIN
          -- Look up net 2-1150 balance on the linked customer order.
          -- The balance equals credits (accrued at sale time by create_tempo_invoice
          -- Slice A) minus any prior debits (reclass payments). v_order_id is
          -- purchase_invoices.order_id — the customer order linked to this PI.
          SELECT
            COALESCE(SUM(l.amount) FILTER (WHERE l.side = 'CREDIT'), 0) -
            COALESCE(SUM(l.amount) FILTER (WHERE l.side = 'DEBIT'),  0)
          INTO v_accrual_balance
          FROM public.journal_entries e
          JOIN public.journal_entry_lines l ON l.entry_id = e.id
          JOIN public.chart_of_accounts a ON a.id = l.account_id
          WHERE e.source_ref_table = 'orders'
            AND e.source_ref_id    = v_order_id
            AND a.account_code     = '2-1150';

          IF COALESCE(v_accrual_balance, 0) >= v_subtotal THEN
            -- Reclass: interim accrued payable → real AP
            v_gl_lines := jsonb_build_array(
              jsonb_build_object(
                'account_code', '2-1150',
                'side',         'DEBIT',
                'amount',       v_subtotal,
                'description',  'Reclass PASSTHROUGH accrual ' || v_pi_number
              ),
              jsonb_build_object(
                'account_code', '2-1100',
                'side',         'CREDIT',
                'amount',       v_subtotal,
                'description',  'Hutang Usaha ' || v_pi_number
              )
            );
          ELSE
            -- No prior accrual (historical / cash-based): direct HPP debit
            v_gl_lines := jsonb_build_array(
              jsonb_build_object(
                'account_code', '5-1200',
                'side',         'DEBIT',
                'amount',       v_subtotal,
                'description',  'HPP PASSTHROUGH ' || v_pi_number
              ),
              jsonb_build_object(
                'account_code', '2-1100',
                'side',         'CREDIT',
                'amount',       v_subtotal,
                'description',  'Hutang Usaha ' || v_pi_number
              )
            );
          END IF;

          SELECT name INTO v_gl_supplier FROM public.suppliers WHERE id = v_supplier_id;

          PERFORM public._post_journal_entry(
            v_purchase_date,
            'PI_TAGIHAN'::public.journal_entry_source,
            'PASSTHROUGH PI ' || v_pi_number || ' · ' || COALESCE(v_gl_supplier, ''),
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
            'record_pi', 'purchase_invoices', v_pi_id,
            SQLSTATE, SQLERRM,
            jsonb_build_object(
              'pi_number',        v_pi_number,
              'pi_subtotal',      v_subtotal,
              'accrual_balance',  v_accrual_balance,
              'order_id',         v_order_id,
              'supplier_id',      v_supplier_id,
              'purchase_date',    v_purchase_date
            )
          );
          RAISE WARNING 'GL dual-write failed for record_pi PASSTHROUGH %: [%] %',
            v_pi_id, SQLSTATE, SQLERRM;
        END;

      ELSE
        -- ── STOCK GL: unchanged from 20260801000006 ──────────────────────────
        BEGIN
          SELECT name INTO v_gl_supplier FROM public.suppliers WHERE id = v_supplier_id;

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
            -- 2-line JE (no discount — backward compat)
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
            'record_pi', 'purchase_invoices', v_pi_id,
            SQLSTATE, SQLERRM,
            jsonb_build_object(
              'pi_number',         v_pi_number,
              'pi_total',          v_total,
              'pi_subtotal',       v_subtotal,
              'total_discount_rp', v_total_discount_rp,
              'supplier_id',       v_supplier_id,
              'purchase_date',     v_purchase_date
            )
          );
          RAISE WARNING 'GL dual-write failed for record_pi STOCK %: [%] %',
            v_pi_id, SQLSTATE, SQLERRM;
        END;
      END IF; -- v_type branch

    END IF; -- v_dual_write
  END;
  -- ── End GL Dual-write ──────────────────────────────────────────────────────

  RETURN jsonb_build_object('pi_number', v_pi_number, 'pi_id', v_pi_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_pi(jsonb) TO authenticated;

COMMIT;
