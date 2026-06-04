-- Patch: make receive_purchase_order handle payment_due_at and invoice_url atomically

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
    SELECT id, sku, qty FROM public.purchase_order_items WHERE po_id = p_po_id
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
      END IF;
    END IF;
  END LOOP;

  UPDATE public.purchase_orders
  SET
    status          = 'RECEIVED',
    received_at     = p_received_at,
    payment_due_at  = p_payment_due_at,
    invoice_url     = COALESCE(p_invoice_url, invoice_url)
  WHERE id = p_po_id;
END;
$$;
