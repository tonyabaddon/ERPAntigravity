-- 20261115000226_final_rpc_bodies_after_prod_smoke.sql
-- Final RPC bodies for initiate/receive/cancel warehouse_transfer, incorporating
-- all defects discovered during Task 25 Garindo prod smoke test:
--
-- Defect 1 (slot 224): FK from *_user_id → auth.users(id) is wrong because
--   admin_users.id ≠ auth.users.id in this repo (mapped by email). Dropped FKs
--   in slot 224 and re-issued RPCs to map auth.uid() → admin_users.id via email.
--
-- Defect 2 (slot 225): _log_stock_movement helper requires qty_before NOT NULL,
--   plus it stores warehouse text not warehouse_id uuid. Replaced calls with
--   direct INSERT (matches existing pattern from resolve_supplier_claim /
--   _apply_opname_change damage loop — memory: smoke_test_bug_fixes Bug 2/3).
--   Uses (0, delta, delta) convention — audit-only, not authoritative stock.
--
-- Defect 3 (slot 226 — this file): stock_movements has actor_role + evidence_urls
--   NOT NULL. Direct INSERTs must include both. All 4 sources (transfer_out,
--   transfer_in, transfer_loss, transfer_cancel_return) use actor_role =
--   'warehouse_transfer' and evidence_urls = '{}'::text[].
--
-- Consumers replaying migrations from scratch: apply this file after slot 224
-- (drops FKs). Slot 225 was intermediate scaffolding and is superseded by this
-- file; either apply 225 then 226 (idempotent CREATE OR REPLACE, works) or
-- just apply 224 + 226 (skips 225 — also works).

CREATE OR REPLACE FUNCTION public.initiate_warehouse_transfer(
  p_from_warehouse_id uuid, p_to_warehouse_id uuid, p_receiver_user_id uuid,
  p_notes text, p_client_request_id text, p_items jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid; v_auth_uid uuid; v_sender uuid;
  v_transfer_id bigint; v_doc_no text;
  v_total_qty int := 0; v_line record; v_line_no int := 0;
  v_existing record; v_avail_qty int;
  v_from_wh_active bool; v_to_wh_active bool;
BEGIN
  v_tenant := public._resolve_tenant_id(); v_auth_uid := auth.uid();
  IF v_tenant IS NULL OR v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_UNAUTHENTICATED' USING ERRCODE='42501'; END IF;
  SELECT au.id INTO v_sender FROM public.admin_users au JOIN auth.users u ON u.email = au.email
   WHERE u.id = v_auth_uid AND au.tenant_id = v_tenant;
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_UNAUTHENTICATED: no admin_user for auth uid %', v_auth_uid USING ERRCODE='42501'; END IF;

  IF p_client_request_id IS NOT NULL THEN
    SELECT id, doc_no INTO v_existing FROM public.warehouse_transfers
     WHERE tenant_id = v_tenant AND client_request_id = p_client_request_id;
    IF FOUND THEN
      RETURN jsonb_build_object('transfer_id', v_existing.id, 'doc_no', v_existing.doc_no, 'idempotent', true);
    END IF;
  END IF;

  IF p_from_warehouse_id = p_to_warehouse_id THEN RAISE EXCEPTION 'TRANSFER_INVALID_WAREHOUSE: from and to must differ'; END IF;
  SELECT is_active INTO v_from_wh_active FROM public.warehouses
    WHERE id = p_from_warehouse_id AND (tenant_id = v_tenant OR tenant_id IS NULL);
  IF NOT FOUND OR NOT v_from_wh_active THEN
    RAISE EXCEPTION 'TRANSFER_INVALID_WAREHOUSE: from % not in tenant or inactive', p_from_warehouse_id; END IF;
  SELECT is_active INTO v_to_wh_active FROM public.warehouses
    WHERE id = p_to_warehouse_id AND (tenant_id = v_tenant OR tenant_id IS NULL);
  IF NOT FOUND OR NOT v_to_wh_active THEN
    RAISE EXCEPTION 'TRANSFER_INVALID_WAREHOUSE: to % not in tenant or inactive', p_to_warehouse_id; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.admin_users
     WHERE id = p_receiver_user_id AND tenant_id = v_tenant
       AND COALESCE(permissions ->> 'can_receive_transfer', 'false') = 'true') THEN
    RAISE EXCEPTION 'TRANSFER_INVALID_RECEIVER: user % lacks can_receive_transfer or not in tenant', p_receiver_user_id; END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'TRANSFER_EMPTY_ITEMS'; END IF;
  SELECT SUM((it->>'qty')::int) INTO v_total_qty FROM jsonb_array_elements(p_items) it;
  IF v_total_qty IS NULL OR v_total_qty <= 0 THEN RAISE EXCEPTION 'TRANSFER_EMPTY_ITEMS: total qty must be > 0'; END IF;

  FOR v_line IN SELECT (it->>'sku')::text AS sku, (it->>'qty')::int AS qty FROM jsonb_array_elements(p_items) it
  LOOP
    IF v_line.qty <= 0 THEN RAISE EXCEPTION 'TRANSFER_EMPTY_ITEMS: sku % qty must be > 0', v_line.sku; END IF;
    SELECT qty INTO v_avail_qty FROM public.stock_levels
     WHERE sku = v_line.sku AND warehouse_id = p_from_warehouse_id FOR UPDATE;
    IF NOT FOUND OR v_avail_qty < v_line.qty THEN
      RAISE EXCEPTION 'TRANSFER_INSUFFICIENT_STOCK: sku=% tersedia=% diminta=%',
        v_line.sku, COALESCE(v_avail_qty, 0), v_line.qty; END IF;
  END LOOP;

  v_doc_no := public._next_warehouse_transfer_doc_no(v_tenant);

  INSERT INTO public.warehouse_transfers
    (tenant_id, doc_no, from_warehouse_id, to_warehouse_id, sender_user_id, receiver_user_id,
     status, notes, client_request_id, initiated_at, total_qty_sent)
  VALUES (v_tenant, v_doc_no, p_from_warehouse_id, p_to_warehouse_id, v_sender, p_receiver_user_id,
     'IN_TRANSIT', p_notes, p_client_request_id, now(), v_total_qty)
  RETURNING id INTO v_transfer_id;

  FOR v_line IN SELECT (it->>'sku')::text AS sku, (it->>'qty')::int AS qty FROM jsonb_array_elements(p_items) it
  LOOP
    v_line_no := v_line_no + 1;
    INSERT INTO public.warehouse_transfer_items (tenant_id, transfer_id, line_no, sku, qty_sent)
    VALUES (v_tenant, v_transfer_id, v_line_no, v_line.sku, v_line.qty);

    UPDATE public.stock_levels SET qty = qty - v_line.qty, updated_at = now()
     WHERE sku = v_line.sku AND warehouse_id = p_from_warehouse_id;

    INSERT INTO public.stock_movements
      (sku, warehouse_id, warehouse, qty_delta, qty_before, qty_after,
       source, related_doc_type, related_doc_id, actor_user_id, actor_role, evidence_urls, created_at)
    VALUES (v_line.sku, p_from_warehouse_id, NULL, -v_line.qty, 0, -v_line.qty,
       'transfer_out'::public.stock_movement_source,
       'warehouse_transfer', v_transfer_id::text, v_sender, 'warehouse_transfer', '{}'::text[], now());
  END LOOP;

  BEGIN
    INSERT INTO public.app_inbox (tenant_id, user_id, kind, ref_type, ref_id, message, created_at)
    VALUES (v_tenant, p_receiver_user_id, 'TRANSFER_INCOMING',
            'warehouse_transfer', v_transfer_id::text,
            format('Transfer masuk %s dari gudang', v_doc_no), now());
  EXCEPTION WHEN undefined_table THEN NULL; END;

  RETURN jsonb_build_object('transfer_id', v_transfer_id, 'doc_no', v_doc_no, 'idempotent', false);
END; $$;

CREATE OR REPLACE FUNCTION public.receive_warehouse_transfer(p_transfer_id bigint, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid; v_auth_uid uuid; v_actor uuid;
  v_xfer record; v_p_item record; v_line record;
  v_qty_received int; v_loss_qty int;
  v_total_recv int := 0; v_total_loss int := 0;
  v_line_count int; v_p_count int;
  v_final_status text; v_move_id bigint;
BEGIN
  v_tenant := public._resolve_tenant_id(); v_auth_uid := auth.uid();
  IF v_tenant IS NULL OR v_auth_uid IS NULL THEN RAISE EXCEPTION 'TRANSFER_UNAUTHENTICATED' USING ERRCODE='42501'; END IF;
  SELECT au.id INTO v_actor FROM public.admin_users au JOIN auth.users u ON u.email = au.email
   WHERE u.id = v_auth_uid AND au.tenant_id = v_tenant;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'TRANSFER_UNAUTHENTICATED: no admin_user for auth uid %', v_auth_uid USING ERRCODE='42501'; END IF;

  SELECT * INTO v_xfer FROM public.warehouse_transfers WHERE tenant_id = v_tenant AND id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND: id=%', p_transfer_id; END IF;
  IF v_xfer.status <> 'IN_TRANSIT' THEN RAISE EXCEPTION 'TRANSFER_WRONG_STATUS: current=%', v_xfer.status; END IF;
  IF v_xfer.receiver_user_id <> v_actor THEN
    RAISE EXCEPTION 'TRANSFER_NOT_RECEIVER: receiver=% actor=%', v_xfer.receiver_user_id, v_actor; END IF;

  SELECT COUNT(*) INTO v_line_count FROM public.warehouse_transfer_items
   WHERE tenant_id = v_tenant AND transfer_id = p_transfer_id;
  SELECT jsonb_array_length(p_items) INTO v_p_count;
  IF v_line_count <> v_p_count THEN
    RAISE EXCEPTION 'TRANSFER_ITEMS_MISMATCH: expected % lines, got %', v_line_count, v_p_count; END IF;

  FOR v_p_item IN SELECT (it->>'sku')::text AS sku, (it->>'qty_received')::int AS qty_received FROM jsonb_array_elements(p_items) it
  LOOP
    SELECT * INTO v_line FROM public.warehouse_transfer_items
     WHERE tenant_id = v_tenant AND transfer_id = p_transfer_id AND sku = v_p_item.sku FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_ITEMS_MISMATCH: sku % not in transfer', v_p_item.sku; END IF;
    IF v_p_item.qty_received < 0 OR v_p_item.qty_received > v_line.qty_sent THEN
      RAISE EXCEPTION 'TRANSFER_ITEMS_MISMATCH: sku % qty_received=% out of [0, %]', v_p_item.sku, v_p_item.qty_received, v_line.qty_sent; END IF;
    v_qty_received := v_p_item.qty_received;
    v_loss_qty := v_line.qty_sent - v_qty_received;
    v_total_recv := v_total_recv + v_qty_received;
    v_total_loss := v_total_loss + v_loss_qty;

    UPDATE public.stock_levels SET qty = qty + v_qty_received, updated_at = now()
     WHERE sku = v_line.sku AND warehouse_id = v_xfer.to_warehouse_id;
    IF NOT FOUND THEN
      INSERT INTO public.stock_levels (sku, warehouse_id, qty) VALUES (v_line.sku, v_xfer.to_warehouse_id, v_qty_received);
    END IF;

    INSERT INTO public.stock_movements
      (sku, warehouse_id, warehouse, qty_delta, qty_before, qty_after,
       source, related_doc_type, related_doc_id, actor_user_id, actor_role, evidence_urls, created_at)
    VALUES (v_line.sku, v_xfer.to_warehouse_id, NULL, v_qty_received, 0, v_qty_received,
       'transfer_in'::public.stock_movement_source,
       'warehouse_transfer', p_transfer_id::text, v_actor, 'warehouse_transfer', '{}'::text[], now());

    IF v_loss_qty > 0 THEN
      INSERT INTO public.stock_movements
        (sku, warehouse_id, warehouse, qty_delta, qty_before, qty_after,
         source, related_doc_type, related_doc_id, actor_user_id, actor_role, evidence_urls, created_at)
      VALUES (v_line.sku, v_xfer.from_warehouse_id, NULL, -v_loss_qty, 0, -v_loss_qty,
         'transfer_loss'::public.stock_movement_source,
         'warehouse_transfer_loss', p_transfer_id::text, v_actor, 'warehouse_transfer', '{}'::text[], now())
      RETURNING id INTO v_move_id;
      UPDATE public.warehouse_transfer_items
         SET qty_received = v_qty_received, loss_qty = v_loss_qty, loss_movement_id = v_move_id
       WHERE tenant_id = v_tenant AND transfer_id = p_transfer_id AND line_no = v_line.line_no;
    ELSE
      UPDATE public.warehouse_transfer_items
         SET qty_received = v_qty_received, loss_qty = NULL
       WHERE tenant_id = v_tenant AND transfer_id = p_transfer_id AND line_no = v_line.line_no;
    END IF;
  END LOOP;

  v_final_status := CASE WHEN v_total_loss = 0 THEN 'RECEIVED' ELSE 'PARTIAL' END;
  UPDATE public.warehouse_transfers
     SET status = v_final_status, received_at = now(), received_by_user_id = v_actor,
         total_qty_received = v_total_recv,
         total_loss_qty = CASE WHEN v_total_loss = 0 THEN NULL ELSE v_total_loss END,
         updated_at = now()
   WHERE tenant_id = v_tenant AND id = p_transfer_id;

  IF v_final_status = 'PARTIAL' THEN
    BEGIN
      INSERT INTO public.app_inbox (tenant_id, user_id, kind, ref_type, ref_id, message, created_at)
      SELECT v_tenant, au.id, 'TRANSFER_PARTIAL_LOSS',
             'warehouse_transfer', p_transfer_id::text,
             format('Selisih transfer %s -%s pcs, cek ke gudang', v_xfer.doc_no, v_total_loss), now()
        FROM public.admin_users au
       WHERE au.tenant_id = v_tenant
         AND COALESCE(au.permissions ->> 'can_approve_adjustment', 'false') = 'true';
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  END IF;

  RETURN jsonb_build_object('status', v_final_status, 'total_loss_qty', v_total_loss);
END; $$;

CREATE OR REPLACE FUNCTION public.cancel_warehouse_transfer(p_transfer_id bigint, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tenant uuid; v_auth_uid uuid; v_actor uuid; v_xfer record; v_line record;
BEGIN
  v_tenant := public._resolve_tenant_id(); v_auth_uid := auth.uid();
  IF v_tenant IS NULL OR v_auth_uid IS NULL THEN RAISE EXCEPTION 'TRANSFER_UNAUTHENTICATED' USING ERRCODE='42501'; END IF;
  SELECT au.id INTO v_actor FROM public.admin_users au JOIN auth.users u ON u.email = au.email
   WHERE u.id = v_auth_uid AND au.tenant_id = v_tenant;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'TRANSFER_UNAUTHENTICATED: no admin_user for auth uid %', v_auth_uid USING ERRCODE='42501'; END IF;

  SELECT * INTO v_xfer FROM public.warehouse_transfers WHERE tenant_id = v_tenant AND id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND: id=%', p_transfer_id; END IF;
  IF v_xfer.status <> 'IN_TRANSIT' THEN RAISE EXCEPTION 'TRANSFER_WRONG_STATUS: current=%', v_xfer.status; END IF;
  IF v_xfer.sender_user_id <> v_actor THEN RAISE EXCEPTION 'TRANSFER_NOT_SENDER: sender=% actor=%', v_xfer.sender_user_id, v_actor; END IF;

  FOR v_line IN SELECT sku, qty_sent FROM public.warehouse_transfer_items
     WHERE tenant_id = v_tenant AND transfer_id = p_transfer_id ORDER BY line_no FOR UPDATE
  LOOP
    UPDATE public.stock_levels SET qty = qty + v_line.qty_sent, updated_at = now()
     WHERE sku = v_line.sku AND warehouse_id = v_xfer.from_warehouse_id;

    INSERT INTO public.stock_movements
      (sku, warehouse_id, warehouse, qty_delta, qty_before, qty_after,
       source, related_doc_type, related_doc_id, actor_user_id, actor_role, evidence_urls, created_at)
    VALUES (v_line.sku, v_xfer.from_warehouse_id, NULL, v_line.qty_sent, 0, v_line.qty_sent,
       'transfer_cancel_return'::public.stock_movement_source,
       'warehouse_transfer', p_transfer_id::text, v_actor, 'warehouse_transfer', '{}'::text[], now());
  END LOOP;

  UPDATE public.warehouse_transfers
     SET status = 'CANCELLED', cancelled_at = now(), cancelled_by_user_id = v_actor,
         cancel_reason = p_reason, updated_at = now()
   WHERE tenant_id = v_tenant AND id = p_transfer_id;

  BEGIN
    INSERT INTO public.app_inbox (tenant_id, user_id, kind, ref_type, ref_id, message, created_at)
    VALUES (v_tenant, v_xfer.receiver_user_id, 'TRANSFER_CANCELLED',
            'warehouse_transfer', p_transfer_id::text,
            format('Transfer %s dibatalkan sender', v_xfer.doc_no), now());
  EXCEPTION WHEN undefined_table THEN NULL; END;

  RETURN jsonb_build_object('status', 'CANCELLED');
END; $$;
