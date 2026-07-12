-- Smoke test: check_kasir_discount_gate RPC (Task 2 / slot 112)
-- Run via MCP execute_sql BEFORE migration to verify FAIL, AFTER to verify PASS.
-- Each DO block rolls back its own changes via RAISE EXCEPTION 'rollback-marker'.

-- Test 1: approval_required=false → gate_triggered always false
DO $$
DECLARE
  v_tenant UUID;
  v_user UUID;
  v_result JSONB;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);

  -- Default: approval_required=false → always false
  v_result := public.check_kasir_discount_gate(500000, 1000000);
  IF (v_result->>'gate_triggered')::BOOL <> false THEN
    RAISE EXCEPTION 'Expected gate_triggered=false when approval_required=false, got %', v_result;
  END IF;
  RAISE NOTICE 'TEST 1 PASS: opt-out default returns triggered=false';

  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;

-- Test 2: gate triggered when discount exceeds threshold_amount
DO $$
DECLARE
  v_tenant UUID;
  v_user UUID;
  v_result JSONB;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);

  -- Configure threshold
  UPDATE public.approval_settings SET approval_required=true, threshold_amount=500000, threshold_percent=NULL
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';

  -- Discount 600k > 500k threshold → triggered
  v_result := public.check_kasir_discount_gate(600000, 1000000);
  IF (v_result->>'gate_triggered')::BOOL <> true THEN
    RAISE EXCEPTION 'Expected triggered=true, got %', v_result;
  END IF;
  IF v_result->>'trigger_reason' <> 'exceeds_amount' THEN
    RAISE EXCEPTION 'Expected trigger_reason=exceeds_amount, got %', v_result->>'trigger_reason';
  END IF;

  -- Discount 400k < 500k threshold → not triggered
  v_result := public.check_kasir_discount_gate(400000, 1000000);
  IF (v_result->>'gate_triggered')::BOOL <> false THEN
    RAISE EXCEPTION 'Expected triggered=false, got %', v_result;
  END IF;

  RAISE NOTICE 'TEST 2 PASS: threshold_amount gate';
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;

-- Test 3: gate triggered when discount exceeds threshold_percent
DO $$
DECLARE
  v_tenant UUID;
  v_user UUID;
  v_result JSONB;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);

  UPDATE public.approval_settings SET approval_required=true, threshold_amount=NULL, threshold_percent=10.0
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';

  -- 15% discount (150k of 1000k) → triggered
  v_result := public.check_kasir_discount_gate(150000, 1000000);
  IF (v_result->>'gate_triggered')::BOOL <> true THEN
    RAISE EXCEPTION 'Expected triggered=true, got %', v_result;
  END IF;
  IF v_result->>'trigger_reason' <> 'exceeds_percent' THEN
    RAISE EXCEPTION 'Expected trigger_reason=exceeds_percent, got %', v_result->>'trigger_reason';
  END IF;

  -- 5% discount → not triggered
  v_result := public.check_kasir_discount_gate(50000, 1000000);
  IF (v_result->>'gate_triggered')::BOOL <> false THEN
    RAISE EXCEPTION 'Expected triggered=false, got %', v_result;
  END IF;

  RAISE NOTICE 'TEST 3 PASS: threshold_percent gate';
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;

-- Test 4: zero subtotal edge case (no divide-by-zero)
DO $$
DECLARE v_tenant UUID; v_user UUID; v_result JSONB;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);
  UPDATE public.approval_settings SET approval_required=true, threshold_percent=10.0
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';
  v_result := public.check_kasir_discount_gate(0, 0);
  IF (v_result->>'gate_triggered')::BOOL <> false THEN
    RAISE EXCEPTION 'Zero subtotal should return triggered=false, got %', v_result;
  END IF;
  RAISE NOTICE 'TEST 4 PASS: zero subtotal safe';
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;

-- Test 5: request_kasir_discount_approval creates request + updates txn
-- Schema note: kasir_transactions.id is UUID; columns are subtotal/total_amount/date (not *_rp/sold_at)
-- status CHECK only allows PAID/AWAITING_LUNAS/COMPLETED/CANCELLED/WIP/PENDING_LOCK_APPROVAL (no 'draft')
DO $$
DECLARE
  v_tenant UUID;
  v_user UUID;
  v_txn_id UUID;
  v_req_id BIGINT;
  v_txn_status TEXT;
  v_req_status TEXT;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);

  UPDATE public.approval_settings SET approval_required=true, threshold_amount=500000, reason_required=true
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';

  -- Insert a test kasir_transaction (type is the only required non-defaulted column)
  INSERT INTO public.kasir_transactions (tenant_id, type, subtotal, total_amount, created_by)
    VALUES (v_tenant, 'income', 1000000, 400000, v_user)
    RETURNING id INTO v_txn_id;

  -- Request approval for 600k discount (> 500k threshold)
  v_req_id := public.request_kasir_discount_approval(
    v_txn_id, 600000, 'AMOUNT', 600000, 1000000, 'Customer loyal 5 tahun'
  );

  IF v_req_id IS NULL THEN RAISE EXCEPTION 'expected req_id'; END IF;

  SELECT discount_approval_status INTO v_txn_status FROM public.kasir_transactions WHERE id = v_txn_id;
  IF v_txn_status <> 'awaiting' THEN
    RAISE EXCEPTION 'expected txn status=awaiting, got %', v_txn_status;
  END IF;

  SELECT status INTO v_req_status FROM public.approval_requests WHERE id = v_req_id;
  IF v_req_status::TEXT <> 'pending' THEN
    RAISE EXCEPTION 'expected req status=pending, got %', v_req_status;
  END IF;

  RAISE NOTICE 'TEST 5 PASS: request creates + links';
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;

-- Test 6: reason validation
DO $$
DECLARE v_tenant UUID; v_user UUID; v_txn_id UUID;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);

  UPDATE public.approval_settings SET approval_required=true, threshold_amount=500000, reason_required=true
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';

  INSERT INTO public.kasir_transactions (tenant_id, type, subtotal, total_amount, created_by)
    VALUES (v_tenant, 'income', 1000000, 400000, v_user) RETURNING id INTO v_txn_id;

  BEGIN
    PERFORM public.request_kasir_discount_approval(v_txn_id, 600000, 'AMOUNT', 600000, 1000000, '');
    RAISE EXCEPTION 'expected reason validation error';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%reason%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'TEST 6 PASS: reason validation';
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;
