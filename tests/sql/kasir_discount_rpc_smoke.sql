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
