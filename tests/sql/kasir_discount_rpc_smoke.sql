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

-- ============================================================
-- Task 3 REDO: request_kasir_discount_approval smoke tests
-- Rev 2 design: no p_sale_draft_id, no kasir_transactions touch
-- ============================================================

-- Test A: Happy path — creates approval_requests row, returns BIGINT > 0, payload has all 7 keys
DO $$
DECLARE
  v_tenant  UUID  := '11111111-1111-1111-1111-111111111111';
  v_user    UUID  := '227c28f4-09f6-4dc9-af7a-01b0feb2c194';
  v_req_id  BIGINT;
  v_row     RECORD;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);

  -- Setup: approval_required=true, threshold_amount=500000, reason_required=true, bypass=false
  UPDATE public.approval_settings
     SET approval_required=true, threshold_amount=500000, threshold_percent=NULL,
         reason_required=true, requestor_bypass_self=false, approver_role='Owner'
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';

  -- Call RPC: discount 600k > 500k threshold, good reason
  v_req_id := public.request_kasir_discount_approval(
    600000, 'AMOUNT', 600000, 1000000, 'Customer loyal'
  );

  -- Return must be BIGINT > 0
  IF v_req_id IS NULL OR v_req_id <= 0 THEN
    RAISE EXCEPTION 'TEST A FAIL: expected positive req_id, got %', v_req_id;
  END IF;

  -- Row must exist with status=pending and correct tenant
  SELECT * INTO v_row FROM public.approval_requests WHERE id = v_req_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST A FAIL: approval_requests row not found for id=%', v_req_id;
  END IF;
  IF v_row.status::TEXT <> 'pending' THEN
    RAISE EXCEPTION 'TEST A FAIL: expected status=pending, got %', v_row.status;
  END IF;
  IF v_row.tenant_id <> v_tenant THEN
    RAISE EXCEPTION 'TEST A FAIL: tenant_id mismatch';
  END IF;

  -- Verify payload has all 7 required keys
  IF NOT (
    v_row.payload ? 'discount_type'       AND
    v_row.payload ? 'discount_value'      AND
    v_row.payload ? 'discount_amount_rp'  AND
    v_row.payload ? 'subtotal_rp'         AND
    v_row.payload ? 'reason'              AND
    v_row.payload ? 'admin_user_id'       AND
    v_row.payload ? 'trigger_reason'
  ) THEN
    RAISE EXCEPTION 'TEST A FAIL: payload missing required keys, got %', v_row.payload;
  END IF;

  -- Verify payload values
  IF (v_row.payload->>'discount_amount_rp')::NUMERIC <> 600000 THEN
    RAISE EXCEPTION 'TEST A FAIL: payload discount_amount_rp wrong, got %', v_row.payload->>'discount_amount_rp';
  END IF;
  IF v_row.payload->>'reason' <> 'Customer loyal' THEN
    RAISE EXCEPTION 'TEST A FAIL: payload reason wrong, got %', v_row.payload->>'reason';
  END IF;
  IF v_row.payload->>'admin_user_id' <> v_user::TEXT THEN
    RAISE EXCEPTION 'TEST A FAIL: payload admin_user_id wrong, got %', v_row.payload->>'admin_user_id';
  END IF;

  RAISE NOTICE 'TEST A PASS: happy path — req_id=%, payload keys OK', v_req_id;
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;

-- Test B: Reason validation — empty reason raises error when reason_required=true
DO $$
DECLARE
  v_tenant UUID := '11111111-1111-1111-1111-111111111111';
  v_user   UUID := '227c28f4-09f6-4dc9-af7a-01b0feb2c194';
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);

  UPDATE public.approval_settings
     SET approval_required=true, threshold_amount=500000, reason_required=true, requestor_bypass_self=false
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';

  BEGIN
    -- Empty reason should raise
    PERFORM public.request_kasir_discount_approval(600000, 'AMOUNT', 600000, 1000000, '');
    RAISE EXCEPTION 'TEST B FAIL: expected reason validation error, but no error raised';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%reason%' THEN
      RAISE EXCEPTION 'TEST B FAIL: wrong error message: %', SQLERRM;
    END IF;
    RAISE NOTICE 'TEST B PASS: empty reason correctly rejected, msg=%', SQLERRM;
  END;

  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;

-- Test C: Gate not triggered guard — discount below threshold raises error
DO $$
DECLARE
  v_tenant UUID := '11111111-1111-1111-1111-111111111111';
  v_user   UUID := '227c28f4-09f6-4dc9-af7a-01b0feb2c194';
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);

  UPDATE public.approval_settings
     SET approval_required=true, threshold_amount=500000, threshold_percent=NULL,
         reason_required=false, requestor_bypass_self=false
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';

  BEGIN
    -- 100k discount is below 500k threshold → gate not triggered → should RAISE
    PERFORM public.request_kasir_discount_approval(100000, 'AMOUNT', 100000, 1000000, 'test');
    RAISE EXCEPTION 'TEST C FAIL: expected gate not triggered error, but no error raised';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%gate not triggered%' THEN
      RAISE EXCEPTION 'TEST C FAIL: wrong error message: %', SQLERRM;
    END IF;
    RAISE NOTICE 'TEST C PASS: gate guard correctly fired, msg=%', SQLERRM;
  END;

  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;

-- Test D: Bypass self — when requestor_bypass_self=true AND caller is Owner role, return -1 (no row inserted)
DO $$
DECLARE
  v_tenant    UUID  := '11111111-1111-1111-1111-111111111111';
  v_user      UUID  := '227c28f4-09f6-4dc9-af7a-01b0feb2c194';  -- tonywei.office@gmail.com, role=Owner
  v_result    BIGINT;
  v_count_before BIGINT;
  v_count_after  BIGINT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);

  UPDATE public.approval_settings
     SET approval_required=true, threshold_amount=500000, threshold_percent=NULL,
         reason_required=false, requestor_bypass_self=true, approver_role='Owner'
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';

  SELECT COUNT(*) INTO v_count_before FROM public.approval_requests
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';

  -- Call with discount > threshold; user IS Owner → should return -1
  v_result := public.request_kasir_discount_approval(600000, 'AMOUNT', 600000, 1000000, 'bypass');

  IF v_result <> -1 THEN
    RAISE EXCEPTION 'TEST D FAIL: expected -1 for bypass_self, got %', v_result;
  END IF;

  SELECT COUNT(*) INTO v_count_after FROM public.approval_requests
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';

  IF v_count_after <> v_count_before THEN
    RAISE EXCEPTION 'TEST D FAIL: expected no new approval_requests row, count went from % to %', v_count_before, v_count_after;
  END IF;

  RAISE NOTICE 'TEST D PASS: bypass_self returns -1, no row inserted';
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;

-- =========================================================
-- Test suite for request_kasir_discount_approval (rev 2 signature)
-- =========================================================
-- All rolled back via rollback-marker. Run against Garindo prod safely.

-- Test A: Happy path (creates request, returns BIGINT > 0, payload keys correct)
DO $$
DECLARE
  v_tenant UUID := '11111111-1111-1111-1111-111111111111';
  v_user   UUID := '227c28f4-09f6-4dc9-af7a-01b0feb2c194';
  v_req_id BIGINT;
  v_payload JSONB;
  v_status TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);
  UPDATE public.approval_settings SET approval_required=true, threshold_amount=500000,
    threshold_percent=NULL, reason_required=true, requestor_bypass_self=false
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';

  v_req_id := public.request_kasir_discount_approval(600000, 'AMOUNT', 600000, 1000000, 'Customer loyal 5 tahun');
  IF v_req_id IS NULL OR v_req_id <= 0 THEN RAISE EXCEPTION 'A FAIL: expected BIGINT > 0, got %', v_req_id; END IF;
  SELECT payload, status INTO v_payload, v_status FROM public.approval_requests WHERE id = v_req_id;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'A FAIL: expected pending, got %', v_status; END IF;
  IF v_payload->>'discount_type' <> 'AMOUNT' THEN RAISE EXCEPTION 'A FAIL: discount_type'; END IF;
  IF v_payload->>'trigger_reason' <> 'exceeds_amount' THEN RAISE EXCEPTION 'A FAIL: trigger_reason'; END IF;
  RAISE NOTICE 'A PASS';
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF; END $$;

-- Test B: Empty reason rejected
DO $$
DECLARE v_tenant UUID := '11111111-1111-1111-1111-111111111111'; v_user UUID := '227c28f4-09f6-4dc9-af7a-01b0feb2c194';
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);
  UPDATE public.approval_settings SET approval_required=true, threshold_amount=500000, reason_required=true
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';
  BEGIN
    PERFORM public.request_kasir_discount_approval(600000, 'AMOUNT', 600000, 1000000, '');
    RAISE EXCEPTION 'B FAIL: expected reason error';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%reason%' THEN RAISE; END IF;
    RAISE NOTICE 'B PASS';
  END;
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF; END $$;

-- Test C: Gate not triggered guard
DO $$
DECLARE v_tenant UUID := '11111111-1111-1111-1111-111111111111'; v_user UUID := '227c28f4-09f6-4dc9-af7a-01b0feb2c194';
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);
  UPDATE public.approval_settings SET approval_required=true, threshold_amount=500000, threshold_percent=NULL
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';
  BEGIN
    PERFORM public.request_kasir_discount_approval(100000, 'AMOUNT', 100000, 1000000, 'small');
    RAISE EXCEPTION 'C FAIL: expected gate error';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%gate not triggered%' THEN RAISE; END IF;
    RAISE NOTICE 'C PASS';
  END;
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF; END $$;

-- Test D: Owner bypass_self returns -1
DO $$
DECLARE v_tenant UUID := '11111111-1111-1111-1111-111111111111'; v_owner UUID := 'bf47bc57-a6f5-403d-beed-114e9aaab26b'; v_result BIGINT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);
  UPDATE public.approval_settings SET approval_required=true, threshold_amount=500000, reason_required=true,
    requestor_bypass_self=true, approver_role='Owner'
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';
  v_result := public.request_kasir_discount_approval(600000, 'AMOUNT', 600000, 1000000, 'owner bypass');
  IF v_result <> -1 THEN RAISE EXCEPTION 'D FAIL: expected -1, got %', v_result; END IF;
  RAISE NOTICE 'D PASS';
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF; END $$;
