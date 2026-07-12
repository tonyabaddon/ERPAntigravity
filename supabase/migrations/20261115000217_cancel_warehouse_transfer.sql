-- 20261115000217_cancel_warehouse_transfer.sql
-- Sender-only cancel RPC. Full contract: spec §5.3.

CREATE OR REPLACE FUNCTION public.cancel_warehouse_transfer(
  p_transfer_id bigint,
  p_reason      text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_actor  uuid;
  v_xfer   record;
  v_line   record;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_actor  := auth.uid();
  IF v_tenant IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_UNAUTHENTICATED' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_xfer FROM public.warehouse_transfers
   WHERE tenant_id = v_tenant AND id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND: id=%', p_transfer_id; END IF;
  IF v_xfer.status <> 'IN_TRANSIT' THEN
    RAISE EXCEPTION 'TRANSFER_WRONG_STATUS: current=%', v_xfer.status;
  END IF;
  IF v_xfer.sender_user_id <> v_actor THEN
    RAISE EXCEPTION 'TRANSFER_NOT_SENDER: sender=% actor=%', v_xfer.sender_user_id, v_actor;
  END IF;

  -- Credit each line's qty back to source stock_levels + audit row
  FOR v_line IN
    SELECT sku, qty_sent FROM public.warehouse_transfer_items
     WHERE tenant_id = v_tenant AND transfer_id = p_transfer_id
     ORDER BY line_no
     FOR UPDATE
  LOOP
    UPDATE public.stock_levels
       SET qty = qty + v_line.qty_sent, updated_at = now()
     WHERE sku = v_line.sku AND warehouse_id = v_xfer.from_warehouse_id;

    -- Direct INSERT (NOT via _log_stock_movement) — helper does not accept
    -- warehouse_id, and post-insert UPDATE to set warehouse_id is blocked
    -- by trg_deny_sm_update. Pattern verified in 20261115000108_smoke_test_bug_fixes.sql
    -- (memory: smoke_test_bug_fixes Bug 2/3 — same pattern used by
    --  resolve_supplier_claim + _apply_opname_change damage loop).
    INSERT INTO public.stock_movements
      (sku, warehouse_id, warehouse, qty_delta, qty_before, qty_after,
       source, related_doc_type, related_doc_id, actor_user_id, created_at)
    VALUES
      (v_line.sku, v_xfer.from_warehouse_id, NULL,
       v_line.qty_sent, 0, v_line.qty_sent,
       'transfer_cancel_return'::public.stock_movement_source,
       'warehouse_transfer', p_transfer_id::text, v_actor, now());
  END LOOP;

  UPDATE public.warehouse_transfers
     SET status               = 'CANCELLED',
         cancelled_at         = now(),
         cancelled_by_user_id = v_actor,
         cancel_reason        = p_reason,
         updated_at           = now()
   WHERE tenant_id = v_tenant AND id = p_transfer_id;

  -- Notify receiver (best-effort)
  BEGIN
    INSERT INTO public.app_inbox (tenant_id, user_id, kind, ref_type, ref_id, message, created_at)
    VALUES (v_tenant, v_xfer.receiver_user_id, 'TRANSFER_CANCELLED',
            'warehouse_transfer', p_transfer_id::text,
            format('Transfer %s dibatalkan sender', v_xfer.doc_no), now());
  EXCEPTION WHEN undefined_table THEN NULL; END;

  RAISE LOG 'warehouse_transfer cancelled tenant=% id=% actor=% reason=%',
    v_tenant, p_transfer_id, v_actor, p_reason;

  RETURN jsonb_build_object('status', 'CANCELLED');
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_warehouse_transfer(bigint, text) TO authenticated;
