-- Stock Fraud Prevention Phase 1, Task 4:
-- Wrap receive_purchase_order to write a stock_movements ledger row per line
-- item, inside the same transaction as the stock_atas/stock_bawah update.
--
-- This replaces the canonical 6-arg overload defined in
-- 20260605000002_warehouse_columns.sql. The body is a near-verbatim copy of
-- that migration's CREATE OR REPLACE — the ONLY additions are:
--   1. Reading the current stock_atas / stock_bawah into v_qty_before BEFORE
--      the UPDATE (needed for the ledger's qty_before column).
--   2. PERFORM public._log_stock_movement(...) AFTER the UPDATE, inside the
--      per-line IF v_qty_received > 0 AND v_item.sku IS NOT NULL branch.
--
-- The older 5-arg overload (without p_warehouse) from
-- 20260604000010_receive_po_add_payment_fields.sql is intentionally NOT
-- wrapped here: no frontend or backend code calls it (grep confirmed only
-- src/lib/pembelianService.ts uses the 6-arg version), and its body still
-- targets the legacy stocks.stock column (which the sync_stock_total trigger
-- now overwrites anyway). Leaving it untouched minimizes diff risk; a future
-- task should drop the dead overload.

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_po_id          uuid,
  p_received_at    timestamptz,
  p_payment_due_at date,
  p_invoice_url    text DEFAULT NULL,
  p_conditions     jsonb DEFAULT '{}'::jsonb,
  p_warehouse      text DEFAULT 'atas'
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_item         record;
  v_cond         jsonb;
  v_qty_received int;
  v_qty_damaged  int;
  v_damage_notes text;
  v_qty_before   int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.purchase_orders WHERE id = p_po_id AND status = 'ORDERED'
  ) THEN
    RAISE EXCEPTION 'PO % is not in ORDERED status', p_po_id;
  END IF;

  FOR v_item IN
    SELECT id, sku, qty, unit_cost FROM public.purchase_order_items WHERE po_id = p_po_id
  LOOP
    v_cond := p_conditions -> (v_item.id::text);
    IF v_cond IS NOT NULL THEN
      v_qty_received := (v_cond ->> 'qty_received')::int;
      v_qty_damaged  := (v_cond ->> 'qty_damaged')::int;
      v_damage_notes := v_cond ->> 'damage_notes';

      IF v_qty_received < 0 OR v_qty_damaged < 0 THEN
        RAISE EXCEPTION 'qty_received and qty_damaged must be non-negative for item %', v_item.id;
      END IF;

      IF v_qty_received + v_qty_damaged > v_item.qty THEN
        RAISE EXCEPTION 'qty_received + qty_damaged (%) exceeds ordered qty (%) for item %',
          v_qty_received + v_qty_damaged, v_item.qty, v_item.id;
      END IF;

      UPDATE public.purchase_order_items SET
        qty_received  = v_qty_received,
        qty_damaged   = v_qty_damaged,
        damage_notes  = v_damage_notes,
        damage_status = CASE WHEN v_qty_damaged > 0 THEN 'PENDING_RETURN' ELSE 'NONE' END
      WHERE id = v_item.id;

      IF v_qty_received > 0 AND v_item.sku IS NOT NULL THEN
        -- Read qty_before from the correct warehouse column BEFORE updating.
        -- Needed for the immutable stock_movements ledger (chk_qty_math
        -- requires qty_before + qty_delta = qty_after).
        IF p_warehouse = 'atas' THEN
          SELECT stock_atas INTO v_qty_before
          FROM public.stocks WHERE sku = v_item.sku;

          UPDATE public.stocks
          SET stock_atas = stock_atas + v_qty_received, updated_at = now()
          WHERE sku = v_item.sku;
        ELSE
          SELECT stock_bawah INTO v_qty_before
          FROM public.stocks WHERE sku = v_item.sku;

          UPDATE public.stocks
          SET stock_bawah = stock_bawah + v_qty_received, updated_at = now()
          WHERE sku = v_item.sku;
        END IF;

        INSERT INTO public.stock_lots (sku, po_id, unit_cost, qty_received, qty_remaining, received_at)
        VALUES (v_item.sku, p_po_id, v_item.unit_cost, v_qty_received, v_qty_received, COALESCE(p_received_at, now()));

        -- Phase 1 ledger row. Same transaction as the stock update above —
        -- if the INSERT fails (e.g. chk_qty_math violation), the entire RPC
        -- rolls back and the warehouse column stays consistent with the
        -- audit trail. actor defaults to the system bot ('00000000-…') in
        -- _log_stock_movement because this RPC runs SECURITY DEFINER and the
        -- caller identity is currently not threaded through; Phase 2 will
        -- add actor capture.
        PERFORM public._log_stock_movement(
          p_sku              => v_item.sku,
          p_warehouse        => p_warehouse,
          p_qty_delta        => v_qty_received,
          p_qty_before       => COALESCE(v_qty_before, 0),
          p_source           => 'purchase_receive'::public.stock_movement_source,
          p_related_doc_type => 'purchase_order',
          p_related_doc_id   => p_po_id::text
        );
      END IF;
    END IF;
  END LOOP;

  UPDATE public.purchase_orders
  SET
    status         = 'RECEIVED',
    received_at    = p_received_at,
    payment_due_at = p_payment_due_at,
    invoice_url    = COALESCE(p_invoice_url, invoice_url)
  WHERE id = p_po_id;
END;
$$;
