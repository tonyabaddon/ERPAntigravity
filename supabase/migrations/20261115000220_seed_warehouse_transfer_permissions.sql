-- 20261115000220_seed_warehouse_transfer_permissions.sql
-- Seed can_transfer_warehouse + can_receive_warehouse_transfer permissions
-- into admin_users.permissions JSONB blob. Matches the pattern used by
-- 20260613000004_backfill_can_manage_warehouses.sql.
--
-- Owner: both keys default true.
-- Non-Owner roles: both keys default false (must be granted explicitly).
--
-- Also tightens initiate_warehouse_transfer's receiver permission check
-- to require the receiver has can_receive_warehouse_transfer=true (deferred
-- from Task 6 per plan §5.1).

BEGIN;

-- Owners: default true for can_transfer_warehouse
UPDATE public.admin_users
   SET permissions = jsonb_set(
     COALESCE(permissions, '{}'::jsonb),
     '{can_transfer_warehouse}',
     'true'::jsonb,
     true
   )
 WHERE role = 'Owner'
   AND (permissions IS NULL OR NOT (permissions ? 'can_transfer_warehouse'));

-- Owners: default true for can_receive_warehouse_transfer
UPDATE public.admin_users
   SET permissions = jsonb_set(
     COALESCE(permissions, '{}'::jsonb),
     '{can_receive_warehouse_transfer}',
     'true'::jsonb,
     true
   )
 WHERE role = 'Owner'
   AND (permissions IS NULL OR NOT (permissions ? 'can_receive_warehouse_transfer'));

-- Non-Owners: default false for can_transfer_warehouse
UPDATE public.admin_users
   SET permissions = jsonb_set(
     COALESCE(permissions, '{}'::jsonb),
     '{can_transfer_warehouse}',
     'false'::jsonb,
     true
   )
 WHERE role <> 'Owner'
   AND (permissions IS NULL OR NOT (permissions ? 'can_transfer_warehouse'));

-- Non-Owners: default false for can_receive_warehouse_transfer
UPDATE public.admin_users
   SET permissions = jsonb_set(
     COALESCE(permissions, '{}'::jsonb),
     '{can_receive_warehouse_transfer}',
     'false'::jsonb,
     true
   )
 WHERE role <> 'Owner'
   AND (permissions IS NULL OR NOT (permissions ? 'can_receive_warehouse_transfer'));

-- Tighten receiver permission gate on initiate_warehouse_transfer.
-- Re-issues the RPC body from slot 215 with an additional check on
-- admin_users.permissions ->> 'can_receive_warehouse_transfer' = 'true'.
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

  -- Receiver check: must be tenant member AND have can_receive_warehouse_transfer=true
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
     WHERE id = p_receiver_user_id
       AND tenant_id = v_tenant
       AND COALESCE(permissions ->> 'can_receive_warehouse_transfer', 'false') = 'true'
  ) THEN
    RAISE EXCEPTION 'TRANSFER_INVALID_RECEIVER: user % lacks can_receive_warehouse_transfer or not in tenant', p_receiver_user_id;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'TRANSFER_EMPTY_ITEMS';
  END IF;

  SELECT SUM((it->>'qty')::int) INTO v_total_qty
    FROM jsonb_array_elements(p_items) it;
  IF v_total_qty IS NULL OR v_total_qty <= 0 THEN
    RAISE EXCEPTION 'TRANSFER_EMPTY_ITEMS: total qty must be > 0';
  END IF;

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
      p_warehouse        => NULL,
      p_qty_delta        => -v_line.qty,
      p_qty_before       => NULL,
      p_source           => 'transfer_out'::public.stock_movement_source,
      p_related_doc_type => 'warehouse_transfer',
      p_related_doc_id   => v_transfer_id::text
    );
  END LOOP;

  BEGIN
    INSERT INTO public.app_inbox (tenant_id, user_id, kind, ref_type, ref_id, message, created_at)
    VALUES (v_tenant, p_receiver_user_id, 'TRANSFER_INCOMING',
            'warehouse_transfer', v_transfer_id::text,
            format('Transfer masuk %s dari gudang', v_doc_no), now());
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  RAISE LOG 'warehouse_transfer initiated tenant=% id=% doc_no=% from=% to=% items=% sender=%',
    v_tenant, v_transfer_id, v_doc_no, p_from_warehouse_id, p_to_warehouse_id, v_line_no, v_sender;

  RETURN jsonb_build_object('transfer_id', v_transfer_id, 'doc_no', v_doc_no, 'idempotent', false);
END;
$$;

COMMIT;
