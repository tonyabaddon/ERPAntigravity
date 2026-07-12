-- 20261115000221_smoke_test_warehouse_transfer.sql
-- Full lifecycle smoke: initiate → receive full, initiate → receive partial,
-- initiate → cancel. Runs as a DO block with faked auth.uid via set_config,
-- then RAISE EXCEPTION at end to rollback everything.
-- Per memory: smoke_test_security_definer_rpcs.

DO $$
DECLARE
  v_tenant     uuid;
  v_sender     uuid;
  v_receiver   uuid;
  v_from_wh    uuid;
  v_to_wh      uuid;
  v_sku        text;
  v_result     jsonb;
  v_xfer1      bigint; v_xfer2 bigint; v_xfer3 bigint;
  v_status     text;
BEGIN
  -- Pick any tenant with ≥2 warehouses + ≥1 stock row
  SELECT wt.tenant_id, wt.id, wf.id
    INTO v_tenant, v_to_wh, v_from_wh
    FROM public.warehouses wf
    JOIN public.warehouses wt ON wt.tenant_id = wf.tenant_id AND wt.id <> wf.id
   WHERE wf.is_active AND wt.is_active
   LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'smoke test: no tenant with 2 active warehouses found';
  END IF;

  SELECT id INTO v_sender FROM public.admin_users
   WHERE tenant_id = v_tenant
     AND COALESCE(permissions ->> 'can_initiate_transfer', 'false') = 'true'
   LIMIT 1;
  SELECT id INTO v_receiver FROM public.admin_users
   WHERE tenant_id = v_tenant
     AND COALESCE(permissions ->> 'can_receive_transfer', 'false') = 'true'
   LIMIT 1;
  IF v_sender IS NULL OR v_receiver IS NULL THEN
    RAISE EXCEPTION 'smoke test: no eligible sender/receiver in tenant %', v_tenant;
  END IF;

  SELECT sl.sku INTO v_sku FROM public.stock_levels sl
   WHERE sl.warehouse_id = v_from_wh AND sl.qty >= 10
   LIMIT 1;
  IF v_sku IS NULL THEN
    RAISE EXCEPTION 'smoke test: no SKU with ≥10 qty in warehouse %', v_from_wh;
  END IF;

  -- Fake auth.uid = sender for initiate
  PERFORM set_config('request.jwt.claim.sub', v_sender::text, true);

  -- Case A: initiate → receive full
  v_result := public.initiate_warehouse_transfer(v_from_wh, v_to_wh, v_receiver, 'smoke A',
              gen_random_uuid()::text, jsonb_build_array(jsonb_build_object('sku', v_sku, 'qty', 3)));
  v_xfer1 := (v_result->>'transfer_id')::bigint;
  PERFORM set_config('request.jwt.claim.sub', v_receiver::text, true);
  v_result := public.receive_warehouse_transfer(v_xfer1,
              jsonb_build_array(jsonb_build_object('sku', v_sku, 'qty_received', 3)));
  ASSERT v_result->>'status' = 'RECEIVED', format('A: expected RECEIVED, got %s', v_result->>'status');

  -- Case B: initiate → receive partial
  PERFORM set_config('request.jwt.claim.sub', v_sender::text, true);
  v_result := public.initiate_warehouse_transfer(v_from_wh, v_to_wh, v_receiver, 'smoke B',
              gen_random_uuid()::text, jsonb_build_array(jsonb_build_object('sku', v_sku, 'qty', 5)));
  v_xfer2 := (v_result->>'transfer_id')::bigint;
  PERFORM set_config('request.jwt.claim.sub', v_receiver::text, true);
  v_result := public.receive_warehouse_transfer(v_xfer2,
              jsonb_build_array(jsonb_build_object('sku', v_sku, 'qty_received', 3)));
  ASSERT v_result->>'status' = 'PARTIAL', format('B: expected PARTIAL, got %s', v_result->>'status');
  ASSERT (v_result->>'total_loss_qty')::int = 2, 'B: expected loss=2';

  -- Case C: initiate → cancel
  PERFORM set_config('request.jwt.claim.sub', v_sender::text, true);
  v_result := public.initiate_warehouse_transfer(v_from_wh, v_to_wh, v_receiver, 'smoke C',
              gen_random_uuid()::text, jsonb_build_array(jsonb_build_object('sku', v_sku, 'qty', 2)));
  v_xfer3 := (v_result->>'transfer_id')::bigint;
  v_result := public.cancel_warehouse_transfer(v_xfer3, 'smoke cancel');
  ASSERT v_result->>'status' = 'CANCELLED', format('C: expected CANCELLED, got %s', v_result->>'status');

  -- Case D: idempotency
  PERFORM set_config('request.jwt.claim.sub', v_sender::text, true);
  v_result := public.initiate_warehouse_transfer(v_from_wh, v_to_wh, v_receiver, 'smoke D',
              'fixed-token-D', jsonb_build_array(jsonb_build_object('sku', v_sku, 'qty', 1)));
  ASSERT (v_result->>'idempotent')::bool = false, 'D1: first call must be non-idempotent';
  v_result := public.initiate_warehouse_transfer(v_from_wh, v_to_wh, v_receiver, 'smoke D',
              'fixed-token-D', jsonb_build_array(jsonb_build_object('sku', v_sku, 'qty', 1)));
  ASSERT (v_result->>'idempotent')::bool = true, 'D2: second call must be idempotent';

  RAISE NOTICE 'smoke test PASSED for tenant %', v_tenant;
  RAISE EXCEPTION 'smoke test complete — intentional rollback (memory: smoke_test_security_definer_rpcs)';
END $$;
