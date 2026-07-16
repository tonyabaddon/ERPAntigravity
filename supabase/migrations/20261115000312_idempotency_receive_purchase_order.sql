-- Migration 312: Add p_idempotency_key to receive_purchase_order (5-arg form).
-- The 6-arg shim (p_warehouse text) delegates to the 5-arg form and is not
-- directly wrapped — callers use the 5-arg form in practice.
-- New parameter is DEFAULT NULL — fully backward compatible.
-- Existing function body is preserved verbatim.

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_po_id uuid,
  p_received_at timestamp with time zone,
  p_payment_due_at date,
  p_invoice_url text DEFAULT NULL::text,
  p_conditions jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key uuid DEFAULT NULL::uuid
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id     uuid := public._resolve_tenant_id();
  v_existing      jsonb;
  v_item          record;
  v_cond          jsonb;
  v_qty_received  int;
  v_qty_damaged   int;
  v_damage_notes  text;
  v_default_id    uuid;
  v_warehouse_id  uuid;
  v_before        int;
  v_mv_id         bigint;
BEGIN
  -- ── Idempotency check ──────────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT result_json INTO v_existing
    FROM public.t_rpc_idempotency
    WHERE tenant_id       = v_tenant_id
      AND rpc_name        = 'receive_purchase_order'
      AND idempotency_key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN
      RETURN;  -- Already processed; void return is idempotent.
    END IF;
  END IF;

  -- ── Original body (unchanged from slot 002b) ───────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM public.purchase_orders WHERE id = p_po_id AND status = 'ORDERED'
  ) THEN
    RAISE EXCEPTION 'PO % tidak dalam status ORDERED', p_po_id;
  END IF;

  SELECT id INTO v_default_id
    FROM public.warehouses
   WHERE tenant_id IS NULL AND is_default
   LIMIT 1;

  FOR v_item IN
    SELECT id, sku, qty, unit_cost FROM public.purchase_order_items WHERE po_id = p_po_id
  LOOP
    v_cond := p_conditions -> (v_item.id::text);
    IF v_cond IS NOT NULL THEN
      v_qty_received := (v_cond ->> 'qty_received')::int;
      v_qty_damaged  := (v_cond ->> 'qty_damaged')::int;
      v_damage_notes := v_cond ->> 'damage_notes';

      IF v_qty_received < 0 OR v_qty_damaged < 0 THEN
        RAISE EXCEPTION 'qty_received dan qty_damaged harus non-negatif untuk item %', v_item.id;
      END IF;

      IF v_qty_received + v_qty_damaged > v_item.qty THEN
        RAISE EXCEPTION 'qty_received + qty_damaged (%) melebihi qty pesanan (%) untuk item %',
          v_qty_received + v_qty_damaged, v_item.qty, v_item.id;
      END IF;

      UPDATE public.purchase_order_items SET
        qty_received  = v_qty_received,
        qty_damaged   = v_qty_damaged,
        damage_notes  = v_damage_notes,
        damage_status = CASE WHEN v_qty_damaged > 0 THEN 'PENDING_RETURN' ELSE 'NONE' END
      WHERE id = v_item.id;

      IF v_qty_received > 0 AND v_item.sku IS NOT NULL THEN
        v_warehouse_id := NULLIF(v_cond ->> 'warehouse_id', '')::uuid;
        IF v_warehouse_id IS NULL THEN
          v_warehouse_id := v_default_id;
        END IF;
        IF v_warehouse_id IS NULL THEN
          RAISE EXCEPTION 'receive_purchase_order: warehouse_id tidak dapat ditentukan untuk item %', v_item.id;
        END IF;

        SELECT COALESCE(qty, 0) INTO v_before
          FROM public.stock_levels
         WHERE sku = v_item.sku AND warehouse_id = v_warehouse_id;

        INSERT INTO public.stock_levels (sku, warehouse_id, qty)
             VALUES (v_item.sku, v_warehouse_id, v_qty_received)
        ON CONFLICT (sku, warehouse_id)
        DO UPDATE SET qty = stock_levels.qty + EXCLUDED.qty, updated_at = now();

        INSERT INTO public.stock_lots (sku, po_id, unit_cost, qty_received, qty_remaining, received_at)
        VALUES (v_item.sku, p_po_id, v_item.unit_cost, v_qty_received, v_qty_received,
                COALESCE(p_received_at, now()));

        v_mv_id := public._log_stock_movement(
          p_sku              => v_item.sku,
          p_warehouse        => NULL,
          p_qty_delta        => v_qty_received,
          p_qty_before       => v_before,
          p_source           => 'purchase_receive'::public.stock_movement_source,
          p_related_doc_type => 'purchase_order',
          p_related_doc_id   => p_po_id::text
        );
        UPDATE public.stock_movements SET warehouse_id = v_warehouse_id WHERE id = v_mv_id;

        UPDATE public.purchase_order_items
           SET warehouse_id = v_warehouse_id
         WHERE id = v_item.id;
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

  -- ── Store idempotency result ────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.t_rpc_idempotency (tenant_id, rpc_name, idempotency_key, result_json)
    VALUES (v_tenant_id, 'receive_purchase_order', p_idempotency_key, '{"ok":true}'::jsonb)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, timestamptz, date, text, jsonb, uuid)
  TO authenticated, service_role, vosi_rpc_owner;
