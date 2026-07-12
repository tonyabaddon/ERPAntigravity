-- 20261115000215_initiate_warehouse_transfer.sql
-- Sender RPC. Full contract: spec §5.1.
-- Idempotency: p_client_request_id unique per tenant; duplicate → return existing.
-- Errors: TRANSFER_INVALID_WAREHOUSE, TRANSFER_INVALID_RECEIVER,
--         TRANSFER_EMPTY_ITEMS, TRANSFER_INSUFFICIENT_STOCK,
--         TRANSFER_DUPLICATE_REQUEST.

CREATE OR REPLACE FUNCTION public.initiate_warehouse_transfer(
  p_from_warehouse_id uuid,
  p_to_warehouse_id   uuid,
  p_receiver_user_id  uuid,
  p_notes             text,
  p_client_request_id text,
  p_items             jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant          uuid;
  v_sender          uuid;
  v_transfer_id     bigint;
  v_doc_no          text;
  v_total_qty       int := 0;
  v_line            record;
  v_line_no         int := 0;
  v_existing        record;
  v_avail_qty       int;
  v_from_wh_active  bool;
  v_to_wh_active    bool;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_sender := auth.uid();

  IF v_tenant IS NULL OR v_sender IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_UNAUTHENTICATED' USING ERRCODE='42501';
  END IF;

  -- Idempotency: return existing row if same client_request_id
  IF p_client_request_id IS NOT NULL THEN
    SELECT id, doc_no INTO v_existing
      FROM public.warehouse_transfers
     WHERE tenant_id = v_tenant AND client_request_id = p_client_request_id;
    IF FOUND THEN
      RAISE LOG 'warehouse_transfer initiate_idempotent tenant=% client_request_id=% existing_id=%',
        v_tenant, p_client_request_id, v_existing.id;
      RETURN jsonb_build_object('transfer_id', v_existing.id, 'doc_no', v_existing.doc_no, 'idempotent', true);
    END IF;
  END IF;

  -- Validate from/to warehouses (same tenant, active, distinct)
  IF p_from_warehouse_id = p_to_warehouse_id THEN
    RAISE EXCEPTION 'TRANSFER_INVALID_WAREHOUSE: from and to must differ';
  END IF;

  SELECT is_active INTO v_from_wh_active FROM public.warehouses
    WHERE id = p_from_warehouse_id AND (tenant_id = v_tenant OR tenant_id IS NULL);
  IF NOT FOUND OR NOT v_from_wh_active THEN
    RAISE EXCEPTION 'TRANSFER_INVALID_WAREHOUSE: from % not in tenant or inactive', p_from_warehouse_id;
  END IF;

  SELECT is_active INTO v_to_wh_active FROM public.warehouses
    WHERE id = p_to_warehouse_id AND (tenant_id = v_tenant OR tenant_id IS NULL);
  IF NOT FOUND OR NOT v_to_wh_active THEN
    RAISE EXCEPTION 'TRANSFER_INVALID_WAREHOUSE: to % not in tenant or inactive', p_to_warehouse_id;
  END IF;

  -- Validate receiver (must be tenant member; permission check deferred to plan follow-up
  -- once permissions row is seeded in task 11)
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
     WHERE id = p_receiver_user_id AND tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'TRANSFER_INVALID_RECEIVER: user % not in tenant', p_receiver_user_id;
  END IF;

  -- Validate items array
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'TRANSFER_EMPTY_ITEMS';
  END IF;

  -- Pre-compute total_qty for header row
  SELECT SUM((it->>'qty')::int) INTO v_total_qty
    FROM jsonb_array_elements(p_items) it;
  IF v_total_qty IS NULL OR v_total_qty <= 0 THEN
    RAISE EXCEPTION 'TRANSFER_EMPTY_ITEMS: total qty must be > 0';
  END IF;

  -- Lock all source stock_levels rows in one pass, validate qty
  FOR v_line IN
    SELECT (it->>'sku')::text AS sku, (it->>'qty')::int AS qty
      FROM jsonb_array_elements(p_items) it
  LOOP
    IF v_line.qty <= 0 THEN
      RAISE EXCEPTION 'TRANSFER_EMPTY_ITEMS: sku % qty must be > 0', v_line.sku;
    END IF;
    SELECT qty INTO v_avail_qty FROM public.stock_levels
     WHERE sku = v_line.sku AND warehouse_id = p_from_warehouse_id
     FOR UPDATE;
    IF NOT FOUND OR v_avail_qty < v_line.qty THEN
      RAISE EXCEPTION 'TRANSFER_INSUFFICIENT_STOCK: sku=% tersedia=% diminta=%',
        v_line.sku, COALESCE(v_avail_qty, 0), v_line.qty;
    END IF;
  END LOOP;

  -- Generate doc_no + INSERT parent row
  v_doc_no := public._next_warehouse_transfer_doc_no(v_tenant);

  INSERT INTO public.warehouse_transfers
    (tenant_id, doc_no, from_warehouse_id, to_warehouse_id,
     sender_user_id, receiver_user_id, status, notes,
     client_request_id, initiated_at, total_qty_sent)
  VALUES
    (v_tenant, v_doc_no, p_from_warehouse_id, p_to_warehouse_id,
     v_sender, p_receiver_user_id, 'IN_TRANSIT', p_notes,
     p_client_request_id, now(), v_total_qty)
  RETURNING id INTO v_transfer_id;

  -- INSERT items, deduct source stock_levels, log stock_movements
  FOR v_line IN
    SELECT (it->>'sku')::text AS sku, (it->>'qty')::int AS qty
      FROM jsonb_array_elements(p_items) it
  LOOP
    v_line_no := v_line_no + 1;

    INSERT INTO public.warehouse_transfer_items
      (tenant_id, transfer_id, line_no, sku, qty_sent)
    VALUES
      (v_tenant, v_transfer_id, v_line_no, v_line.sku, v_line.qty);

    UPDATE public.stock_levels
       SET qty = qty - v_line.qty, updated_at = now()
     WHERE sku = v_line.sku AND warehouse_id = p_from_warehouse_id;

    PERFORM public._log_stock_movement(
      p_sku              => v_line.sku,
      p_warehouse        => NULL,  -- text field deprecated; warehouse_id below
      p_qty_delta        => -v_line.qty,
      p_qty_before       => NULL,
      p_source           => 'transfer_out'::public.stock_movement_source,
      p_related_doc_type => 'warehouse_transfer',
      p_related_doc_id   => v_transfer_id::text
    );
  END LOOP;

  -- App-inbox notify receiver (best-effort; skip on missing table for compat)
  BEGIN
    INSERT INTO public.app_inbox (tenant_id, user_id, kind, ref_type, ref_id, message, created_at)
    VALUES (v_tenant, p_receiver_user_id, 'TRANSFER_INCOMING',
            'warehouse_transfer', v_transfer_id::text,
            format('Transfer masuk %s dari gudang', v_doc_no), now());
  EXCEPTION WHEN undefined_table THEN
    NULL;  -- app_inbox not deployed yet; silently skip
  END;

  RAISE LOG 'warehouse_transfer initiated tenant=% id=% doc_no=% from=% to=% items=% sender=%',
    v_tenant, v_transfer_id, v_doc_no, p_from_warehouse_id, p_to_warehouse_id, v_line_no, v_sender;

  RETURN jsonb_build_object('transfer_id', v_transfer_id, 'doc_no', v_doc_no, 'idempotent', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.initiate_warehouse_transfer(uuid, uuid, uuid, text, text, jsonb) TO authenticated;
