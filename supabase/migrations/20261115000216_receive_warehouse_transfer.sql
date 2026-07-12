-- 20261115000216_receive_warehouse_transfer.sql
-- Receiver RPC. Full contract: spec §5.2, §5.2.1.
-- Final status: RECEIVED (all lines full) or PARTIAL (any line short).

CREATE OR REPLACE FUNCTION public.receive_warehouse_transfer(
  p_transfer_id bigint,
  p_items       jsonb   -- [{"sku":"...","qty_received":N}, ...]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant       uuid;
  v_actor        uuid;
  v_xfer         record;
  v_p_item       record;
  v_line         record;
  v_qty_received int;
  v_loss_qty     int;
  v_total_recv   int := 0;
  v_total_loss   int := 0;
  v_line_count   int;
  v_p_count      int;
  v_final_status text;
  v_move_id      bigint;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_actor  := auth.uid();
  IF v_tenant IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_UNAUTHENTICATED' USING ERRCODE='42501';
  END IF;

  -- Load + lock transfer
  SELECT * INTO v_xfer FROM public.warehouse_transfers
   WHERE tenant_id = v_tenant AND id = p_transfer_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSFER_NOT_FOUND: id=%', p_transfer_id;
  END IF;
  IF v_xfer.status <> 'IN_TRANSIT' THEN
    RAISE EXCEPTION 'TRANSFER_WRONG_STATUS: current=%', v_xfer.status;
  END IF;
  IF v_xfer.receiver_user_id <> v_actor THEN
    RAISE EXCEPTION 'TRANSFER_NOT_RECEIVER: receiver=% actor=%', v_xfer.receiver_user_id, v_actor;
  END IF;

  -- Validate p_items covers every SKU (order-agnostic, count must match)
  SELECT COUNT(*) INTO v_line_count FROM public.warehouse_transfer_items
   WHERE tenant_id = v_tenant AND transfer_id = p_transfer_id;
  SELECT jsonb_array_length(p_items) INTO v_p_count;
  IF v_line_count <> v_p_count THEN
    RAISE EXCEPTION 'TRANSFER_ITEMS_MISMATCH: expected % lines, got %', v_line_count, v_p_count;
  END IF;

  -- Iterate p_items → validate + apply
  FOR v_p_item IN
    SELECT (it->>'sku')::text AS sku, (it->>'qty_received')::int AS qty_received
      FROM jsonb_array_elements(p_items) it
  LOOP
    -- Match to line
    SELECT * INTO v_line FROM public.warehouse_transfer_items
     WHERE tenant_id = v_tenant AND transfer_id = p_transfer_id AND sku = v_p_item.sku
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TRANSFER_ITEMS_MISMATCH: sku % not in transfer', v_p_item.sku;
    END IF;
    IF v_p_item.qty_received < 0 OR v_p_item.qty_received > v_line.qty_sent THEN
      RAISE EXCEPTION 'TRANSFER_ITEMS_MISMATCH: sku % qty_received=% out of [0, %]',
        v_p_item.sku, v_p_item.qty_received, v_line.qty_sent;
    END IF;

    v_qty_received := v_p_item.qty_received;
    v_loss_qty := v_line.qty_sent - v_qty_received;
    v_total_recv := v_total_recv + v_qty_received;
    v_total_loss := v_total_loss + v_loss_qty;

    -- Lock + credit destination stock_levels
    UPDATE public.stock_levels
       SET qty = qty + v_qty_received, updated_at = now()
     WHERE sku = v_line.sku AND warehouse_id = v_xfer.to_warehouse_id;
    IF NOT FOUND THEN
      -- Insert row if it doesn't exist yet (first time this SKU lands in dest warehouse)
      INSERT INTO public.stock_levels (sku, warehouse_id, qty)
      VALUES (v_line.sku, v_xfer.to_warehouse_id, v_qty_received);
    END IF;

    -- Ledger: transfer_in (positive delta at destination)
    PERFORM public._log_stock_movement(
      p_sku              => v_line.sku,
      p_warehouse        => NULL,
      p_qty_delta        => v_qty_received,
      p_qty_before       => NULL,
      p_source           => 'transfer_in'::public.stock_movement_source,
      p_related_doc_type => 'warehouse_transfer',
      p_related_doc_id   => p_transfer_id::text
    );

    -- Loss row (audit only — source already deducted at IN_TRANSIT; do NOT
    -- credit source back; do NOT re-deduct destination).
    IF v_loss_qty > 0 THEN
      -- Direct INSERT (NOT via _log_stock_movement) — helper does not accept
      -- warehouse_id, and post-insert UPDATE to set warehouse_id is blocked
      -- by trg_deny_sm_update. Pattern verified in 20261115000108_smoke_test_bug_fixes.sql
      -- (memory: smoke_test_bug_fixes Bug 2/3).
      INSERT INTO public.stock_movements
        (sku, warehouse_id, warehouse, qty_delta, qty_before, qty_after,
         source, related_doc_type, related_doc_id, actor_user_id, created_at)
      VALUES
        (v_line.sku, v_xfer.from_warehouse_id, NULL,
         -v_loss_qty, 0, -v_loss_qty,
         'transfer_loss'::public.stock_movement_source,
         'warehouse_transfer_loss', p_transfer_id::text, v_actor, now())
      RETURNING id INTO v_move_id;

      UPDATE public.warehouse_transfer_items
         SET qty_received = v_qty_received,
             loss_qty     = v_loss_qty,
             loss_movement_id = v_move_id
       WHERE tenant_id = v_tenant AND transfer_id = p_transfer_id AND line_no = v_line.line_no;
    ELSE
      UPDATE public.warehouse_transfer_items
         SET qty_received = v_qty_received,
             loss_qty     = NULL
       WHERE tenant_id = v_tenant AND transfer_id = p_transfer_id AND line_no = v_line.line_no;
    END IF;
  END LOOP;

  v_final_status := CASE WHEN v_total_loss = 0 THEN 'RECEIVED' ELSE 'PARTIAL' END;

  UPDATE public.warehouse_transfers
     SET status              = v_final_status,
         received_at         = now(),
         received_by_user_id = v_actor,
         total_qty_received  = v_total_recv,
         total_loss_qty      = CASE WHEN v_total_loss = 0 THEN NULL ELSE v_total_loss END,
         updated_at          = now()
   WHERE tenant_id = v_tenant AND id = p_transfer_id;

  -- Owner-inbox alert on PARTIAL (best-effort)
  IF v_final_status = 'PARTIAL' THEN
    BEGIN
      INSERT INTO public.app_inbox (tenant_id, user_id, kind, ref_type, ref_id, message, created_at)
      SELECT v_tenant, au.id, 'TRANSFER_PARTIAL_LOSS',
             'warehouse_transfer', p_transfer_id::text,
             format('Selisih transfer %s -%s pcs, cek ke gudang', v_xfer.doc_no, v_total_loss), now()
        FROM public.admin_users au
       WHERE au.tenant_id = v_tenant AND au.can_approve_adjustment = true;
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  END IF;

  RAISE LOG 'warehouse_transfer received tenant=% id=% status=% total_recv=% loss=% actor=%',
    v_tenant, p_transfer_id, v_final_status, v_total_recv, v_total_loss, v_actor;

  RETURN jsonb_build_object('status', v_final_status, 'total_loss_qty', v_total_loss);
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_warehouse_transfer(bigint, jsonb) TO authenticated;
