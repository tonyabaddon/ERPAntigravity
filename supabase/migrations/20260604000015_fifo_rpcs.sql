-- ── Updated receive_purchase_order: inserts a stock_lot per received SKU ───

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_po_id          uuid,
  p_received_at    timestamptz,
  p_payment_due_at date,
  p_invoice_url    text DEFAULT NULL,
  p_conditions     jsonb DEFAULT '{}'::jsonb
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
        UPDATE public.stocks
        SET stock = stock + v_qty_received, updated_at = now()
        WHERE sku = v_item.sku;

        INSERT INTO public.stock_lots (sku, po_id, unit_cost, qty_received, qty_remaining, received_at)
        VALUES (v_item.sku, p_po_id, v_item.unit_cost, v_qty_received, v_qty_received, COALESCE(p_received_at, now()));
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

-- ── Updated receive_replacement: inserts a stock_lot for replacement units ─

CREATE OR REPLACE FUNCTION public.receive_replacement(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_sku         varchar;
  v_qty_damaged int;
  v_unit_cost   numeric;
  v_po_id       uuid;
BEGIN
  SELECT poi.sku, poi.qty_damaged, poi.unit_cost, poi.po_id
  INTO v_sku, v_qty_damaged, v_unit_cost, v_po_id
  FROM public.purchase_order_items poi
  WHERE poi.id = p_item_id AND poi.damage_status = 'RETURNED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item % not found or not in RETURNED status', p_item_id;
  END IF;

  IF v_qty_damaged > 0 AND v_sku IS NOT NULL THEN
    UPDATE public.stocks
    SET stock = stock + v_qty_damaged, updated_at = now()
    WHERE sku = v_sku;

    INSERT INTO public.stock_lots (sku, po_id, unit_cost, qty_received, qty_remaining, received_at)
    VALUES (v_sku, v_po_id, v_unit_cost, v_qty_damaged, v_qty_damaged, now());
  END IF;

  UPDATE public.purchase_order_items
  SET damage_status = 'REPLACED'
  WHERE id = p_item_id;
END;
$$;

-- ── deduct_stock_fifo: FIFO lot deduction, returns total COGS ─────────────

CREATE OR REPLACE FUNCTION public.deduct_stock_fifo(
  p_sku varchar,
  p_qty int
)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_lot          record;
  v_remaining    int     := p_qty;
  v_total_cost   numeric := 0;
  v_deduct       int;
  v_fallback_hpp numeric := 0;
BEGIN
  FOR v_lot IN
    SELECT id, qty_remaining, unit_cost
    FROM public.stock_lots
    WHERE sku = p_sku AND qty_remaining > 0
    ORDER BY received_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_deduct := LEAST(v_remaining, v_lot.qty_remaining);
    UPDATE public.stock_lots
    SET qty_remaining = qty_remaining - v_deduct
    WHERE id = v_lot.id;
    v_total_cost := v_total_cost + (v_deduct * v_lot.unit_cost);
    v_remaining  := v_remaining - v_deduct;
  END LOOP;

  -- Fallback: lots exhausted before qty satisfied — use stocks.harga_modal
  IF v_remaining > 0 THEN
    SELECT COALESCE(harga_modal, 0) INTO v_fallback_hpp
    FROM public.stocks WHERE sku = p_sku;
    v_total_cost := v_total_cost + (v_remaining * v_fallback_hpp);
    RAISE WARNING 'deduct_stock_fifo: % units of SKU % had no lot coverage, used harga_modal fallback', v_remaining, p_sku;
  END IF;

  RETURN v_total_cost;
END;
$$;
