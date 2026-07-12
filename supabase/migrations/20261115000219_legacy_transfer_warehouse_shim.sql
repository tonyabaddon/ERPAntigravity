-- 20261115000219_legacy_transfer_warehouse_shim.sql
-- Rewrite legacy transfer_warehouse(sku, from text, to text, qty) as a proxy.
-- Looks up warehouse UUIDs from atas/bawah text, calls initiate + auto-receive
-- (same actor sender+receiver — legacy semantic was single-shot).
-- Emits RAISE WARNING to encourage caller migration.
-- Body: replaces the SECDEF body from 20260612000001_fix_transfer_warehouse_security_definer.sql

CREATE OR REPLACE FUNCTION public.transfer_warehouse(
  p_sku  text, p_from text, p_to text, p_qty int
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant     uuid := public._resolve_tenant_id();
  v_actor      uuid := auth.uid();
  v_from_wh    uuid;
  v_to_wh      uuid;
  v_result     jsonb;
  v_xfer_id    bigint;
BEGIN
  RAISE WARNING 'transfer_warehouse(text,text,text,int) is DEPRECATED. Use initiate_warehouse_transfer instead. Will be removed next release.';

  SELECT id INTO v_from_wh FROM public.warehouses
   WHERE (tenant_id = v_tenant OR tenant_id IS NULL) AND upper(code) = upper(p_from);
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_warehouse legacy shim: from warehouse code % not found', p_from; END IF;

  SELECT id INTO v_to_wh FROM public.warehouses
   WHERE (tenant_id = v_tenant OR tenant_id IS NULL) AND upper(code) = upper(p_to);
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_warehouse legacy shim: to warehouse code % not found', p_to; END IF;

  -- Sender = receiver = actor (legacy was single-shot)
  v_result := public.initiate_warehouse_transfer(
    p_from_warehouse_id => v_from_wh,
    p_to_warehouse_id   => v_to_wh,
    p_receiver_user_id  => v_actor,
    p_notes             => 'legacy transfer_warehouse call',
    p_client_request_id => NULL,
    p_items             => jsonb_build_array(jsonb_build_object('sku', p_sku, 'qty', p_qty))
  );
  v_xfer_id := (v_result->>'transfer_id')::bigint;

  PERFORM public.receive_warehouse_transfer(
    p_transfer_id => v_xfer_id,
    p_items       => jsonb_build_array(jsonb_build_object('sku', p_sku, 'qty_received', p_qty))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_warehouse(text, text, text, int) TO authenticated;
