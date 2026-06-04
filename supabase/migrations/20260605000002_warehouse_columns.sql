-- 1. Add warehouse columns
ALTER TABLE public.stocks
  ADD COLUMN IF NOT EXISTS stock_atas  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_bawah INTEGER NOT NULL DEFAULT 0;

-- 2. Migrate existing stock to Gudang Atas
UPDATE public.stocks SET stock_atas = stock WHERE stock > 0;

-- 3. Trigger: keep stock = stock_atas + stock_bawah
CREATE OR REPLACE FUNCTION public.sync_stock_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.stock := NEW.stock_atas + NEW.stock_bawah;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_stock_total ON public.stocks;
CREATE TRIGGER trg_sync_stock_total
  BEFORE INSERT OR UPDATE ON public.stocks
  FOR EACH ROW EXECUTE FUNCTION public.sync_stock_total();

-- 4. decrement_stock RPC: warehouse-aware stock decrement
CREATE OR REPLACE FUNCTION public.decrement_stock(
  p_sku       text,
  p_qty       int,
  p_warehouse text DEFAULT 'atas'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_warehouse = 'atas' THEN
    UPDATE public.stocks
    SET stock_atas = GREATEST(0, stock_atas - p_qty), updated_at = now()
    WHERE sku = p_sku;
  ELSE
    UPDATE public.stocks
    SET stock_bawah = GREATEST(0, stock_bawah - p_qty), updated_at = now()
    WHERE sku = p_sku;
  END IF;
END;
$$;

-- 5. transfer_warehouse RPC: atomically move qty between warehouses
CREATE OR REPLACE FUNCTION public.transfer_warehouse(
  p_sku       text,
  p_from      text,
  p_to        text,
  p_qty       int
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_from_qty int;
BEGIN
  IF p_from = 'atas' THEN
    SELECT stock_atas INTO v_from_qty FROM stocks WHERE sku = p_sku FOR UPDATE;
    IF v_from_qty < p_qty THEN
      RAISE EXCEPTION 'Stok Gudang Atas tidak cukup: tersedia %, diminta %', v_from_qty, p_qty;
    END IF;
    UPDATE stocks
       SET stock_atas  = stock_atas  - p_qty,
           stock_bawah = stock_bawah + p_qty
     WHERE sku = p_sku;
  ELSE
    SELECT stock_bawah INTO v_from_qty FROM stocks WHERE sku = p_sku FOR UPDATE;
    IF v_from_qty < p_qty THEN
      RAISE EXCEPTION 'Stok Gudang Bawah tidak cukup: tersedia %, diminta %', v_from_qty, p_qty;
    END IF;
    UPDATE stocks
       SET stock_bawah = stock_bawah - p_qty,
           stock_atas  = stock_atas  + p_qty
     WHERE sku = p_sku;
  END IF;
END;
$$;

-- 6. receive_purchase_order: add p_warehouse param, increment correct column
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
        IF p_warehouse = 'atas' THEN
          UPDATE public.stocks
          SET stock_atas = stock_atas + v_qty_received, updated_at = now()
          WHERE sku = v_item.sku;
        ELSE
          UPDATE public.stocks
          SET stock_bawah = stock_bawah + v_qty_received, updated_at = now()
          WHERE sku = v_item.sku;
        END IF;

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
