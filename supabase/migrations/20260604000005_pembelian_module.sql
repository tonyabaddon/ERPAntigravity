-- supabase/migrations/20260604000005_pembelian_module.sql

-- ── Suppliers ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.suppliers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  contact_name      text,
  phone             text,
  payment_term_days int  NOT NULL DEFAULT 0,
  created_at        timestamptz DEFAULT now()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'suppliers' AND policyname = 'anon full access suppliers'
  ) THEN
    CREATE POLICY "anon full access suppliers"
      ON public.suppliers FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── Purchase Orders ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id                uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number         text    UNIQUE NOT NULL,
  supplier_id       uuid    NOT NULL REFERENCES public.suppliers(id),
  status            text    NOT NULL DEFAULT 'DRAFT',
  notes             text,
  ordered_at        timestamptz,
  received_at       timestamptz,
  payment_due_at    date,
  paid_at           timestamptz,
  invoice_url       text,
  payment_proof_url text,
  tax_rate          numeric NOT NULL DEFAULT 0,
  tax_amount        numeric NOT NULL DEFAULT 0,
  subtotal          numeric NOT NULL DEFAULT 0,
  total             numeric NOT NULL DEFAULT 0,
  created_at        timestamptz DEFAULT now()
);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'purchase_orders' AND policyname = 'anon full access purchase_orders'
  ) THEN
    CREATE POLICY "anon full access purchase_orders"
      ON public.purchase_orders FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── Purchase Order Items ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id         uuid    NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  sku           varchar REFERENCES public.stocks(sku),
  product_name  text    NOT NULL,
  qty           int     NOT NULL,
  unit_cost     numeric NOT NULL,
  subtotal      numeric NOT NULL,
  qty_received  int     NOT NULL DEFAULT 0,
  qty_damaged   int     NOT NULL DEFAULT 0,
  damage_notes  text,
  damage_status text    NOT NULL DEFAULT 'NONE'
);

ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'purchase_order_items' AND policyname = 'anon full access purchase_order_items'
  ) THEN
    CREATE POLICY "anon full access purchase_order_items"
      ON public.purchase_order_items FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── RPC: generate_po_number ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_po_number()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_prefix  text;
  v_max_seq int;
BEGIN
  v_prefix := 'PO-' || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-');
  SELECT COALESCE(MAX(
    CASE
      WHEN po_number ~ '^PO-[0-9]{4}-[0-9]{2}-[0-9]{3}$'
           AND LEFT(po_number, LENGTH(v_prefix)) = v_prefix
      THEN RIGHT(po_number, 3)::int
      ELSE 0
    END
  ), 0) + 1
  INTO v_max_seq
  FROM public.purchase_orders;
  RETURN v_prefix || LPAD(v_max_seq::text, 3, '0');
END;
$$;

-- ── RPC: receive_purchase_order ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_po_id       uuid,
  p_received_at timestamptz,
  p_conditions  jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_item        record;
  v_cond        jsonb;
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
    SELECT id, sku FROM public.purchase_order_items WHERE po_id = p_po_id
  LOOP
    v_cond := p_conditions -> (v_item.id::text);
    IF v_cond IS NOT NULL THEN
      v_qty_received := (v_cond ->> 'qty_received')::int;
      v_qty_damaged  := (v_cond ->> 'qty_damaged')::int;
      v_damage_notes := v_cond ->> 'damage_notes';

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
  SET status = 'RECEIVED', received_at = p_received_at
  WHERE id = p_po_id;
END;
$$;

-- ── RPC: receive_replacement ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.receive_replacement(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_sku         varchar;
  v_qty_damaged int;
BEGIN
  SELECT sku, qty_damaged
  INTO v_sku, v_qty_damaged
  FROM public.purchase_order_items
  WHERE id = p_item_id AND damage_status = 'RETURNED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item % not found or not in RETURNED status', p_item_id;
  END IF;

  IF v_qty_damaged > 0 AND v_sku IS NOT NULL THEN
    UPDATE public.stocks
    SET stock = stock + v_qty_damaged, updated_at = now()
    WHERE sku = v_sku;
  END IF;

  UPDATE public.purchase_order_items
  SET damage_status = 'REPLACED'
  WHERE id = p_item_id;
END;
$$;
