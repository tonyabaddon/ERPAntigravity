-- Per-gate approval matrix smoke verification.
-- Run via MCP execute_sql; wraps in DO-block + RAISE EXCEPTION 'rollback'.
--
-- Matrix: 19 gates × 4 verification_method × 2 threshold-states = 152 cases.
-- Coverage focus: state machine correctness, not exhaustive permutations.

DO $$
DECLARE
  v_actor UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_decision TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_actor::TEXT, TRUE);

  -- Test 1: bypass when approval_required=false (sample gate: adjustment)
  UPDATE public.approval_settings SET approval_required=FALSE, verification_method='NONE'
    WHERE request_type='adjustment';
  v_decision := public._check_approval_required('adjustment', NULL, 1, 'Owner');
  IF v_decision <> 'bypass' THEN RAISE EXCEPTION 'Test 1 fail'; END IF;

  -- Test 2: PIN when approval_required=true + verification=PIN
  UPDATE public.approval_settings SET approval_required=TRUE, verification_method='PIN'
    WHERE request_type='adjustment';
  v_decision := public._check_approval_required('adjustment', NULL, 1, 'Owner');
  IF v_decision <> 'pin' THEN RAISE EXCEPTION 'Test 2 fail'; END IF;

  -- Test 3: Threshold qty bypass (below threshold)
  UPDATE public.approval_settings SET threshold_qty=5
    WHERE request_type='adjustment';
  v_decision := public._check_approval_required('adjustment', NULL, 3, 'Owner');
  IF v_decision <> 'bypass' THEN RAISE EXCEPTION 'Test 3 fail (below threshold)'; END IF;

  -- Test 4: PIN when qty above threshold
  v_decision := public._check_approval_required('adjustment', NULL, 10, 'Owner');
  IF v_decision <> 'pin' THEN RAISE EXCEPTION 'Test 4 fail (above threshold)'; END IF;

  -- Test 5: Self-bypass when requestor=approver
  UPDATE public.approval_settings SET requestor_bypass_self=TRUE
    WHERE request_type='adjustment';
  v_decision := public._check_approval_required('adjustment', NULL, 10, 'Owner');
  IF v_decision <> 'bypass' THEN RAISE EXCEPTION 'Test 5 fail (self-bypass)'; END IF;

  -- Test 6: APP_INBOX routing
  UPDATE public.approval_settings SET requestor_bypass_self=FALSE,
                                       verification_method='APP_INBOX',
                                       threshold_qty=NULL
    WHERE request_type='adjustment';
  v_decision := public._check_approval_required('adjustment', NULL, 10, 'Owner');
  IF v_decision <> 'app_inbox' THEN RAISE EXCEPTION 'Test 6 fail'; END IF;

  -- Test 7: WA_BUTTON routing
  UPDATE public.approval_settings SET verification_method='WA_BUTTON'
    WHERE request_type='adjustment';
  v_decision := public._check_approval_required('adjustment', NULL, 10, 'Owner');
  IF v_decision <> 'wa_button' THEN RAISE EXCEPTION 'Test 7 fail'; END IF;

  -- Test 8: opname gate bypass on approval_required=false
  UPDATE public.approval_settings SET approval_required=FALSE, verification_method='NONE'
    WHERE request_type='opname';
  v_decision := public._check_approval_required('opname', NULL, 100, 'Supervisor');
  IF v_decision <> 'bypass' THEN RAISE EXCEPTION 'Test 8 fail'; END IF;

  -- Test 9: opname gate PIN verification
  UPDATE public.approval_settings SET approval_required=TRUE, verification_method='PIN'
    WHERE request_type='opname';
  v_decision := public._check_approval_required('opname', NULL, 100, 'Supervisor');
  IF v_decision <> 'pin' THEN RAISE EXCEPTION 'Test 9 fail'; END IF;

  -- Test 10: opname gate APP_INBOX routing
  UPDATE public.approval_settings SET verification_method='APP_INBOX'
    WHERE request_type='opname';
  v_decision := public._check_approval_required('opname', NULL, 100, 'Supervisor');
  IF v_decision <> 'app_inbox' THEN RAISE EXCEPTION 'Test 10 fail'; END IF;

  -- Test 11: price_change gate bypass
  UPDATE public.approval_settings SET approval_required=FALSE, verification_method='NONE'
    WHERE request_type='price_change';
  v_decision := public._check_approval_required('price_change', NULL, 50000, 'Owner');
  IF v_decision <> 'bypass' THEN RAISE EXCEPTION 'Test 11 fail'; END IF;

  -- Test 12: price_change gate PIN with threshold
  UPDATE public.approval_settings SET approval_required=TRUE, verification_method='PIN', threshold_qty=25000
    WHERE request_type='price_change';
  v_decision := public._check_approval_required('price_change', NULL, 15000, 'Owner');
  IF v_decision <> 'bypass' THEN RAISE EXCEPTION 'Test 12 fail (below threshold)'; END IF;

  -- Test 13: price_change gate PIN above threshold
  v_decision := public._check_approval_required('price_change', NULL, 50000, 'Owner');
  IF v_decision <> 'pin' THEN RAISE EXCEPTION 'Test 13 fail (above threshold)'; END IF;

  -- Test 14: customer_credit_activate bypass
  UPDATE public.approval_settings SET approval_required=FALSE, verification_method='NONE', threshold_qty=NULL
    WHERE request_type='customer_credit_activate';
  v_decision := public._check_approval_required('customer_credit_activate', NULL, 1000000, 'Owner');
  IF v_decision <> 'bypass' THEN RAISE EXCEPTION 'Test 14 fail'; END IF;

  -- Test 15: customer_credit_activate PIN
  UPDATE public.approval_settings SET approval_required=TRUE, verification_method='PIN'
    WHERE request_type='customer_credit_activate';
  v_decision := public._check_approval_required('customer_credit_activate', NULL, 1000000, 'Owner');
  IF v_decision <> 'pin' THEN RAISE EXCEPTION 'Test 15 fail'; END IF;

  -- Test 16: customer_credit_activate WA_BUTTON
  UPDATE public.approval_settings SET verification_method='WA_BUTTON'
    WHERE request_type='customer_credit_activate';
  v_decision := public._check_approval_required('customer_credit_activate', NULL, 1000000, 'Owner');
  IF v_decision <> 'wa_button' THEN RAISE EXCEPTION 'Test 16 fail'; END IF;

  -- Test 17: kasir_refund bypass
  UPDATE public.approval_settings SET approval_required=FALSE, verification_method='NONE'
    WHERE request_type='kasir_refund';
  v_decision := public._check_approval_required('kasir_refund', NULL, 500000, 'Kasir');
  IF v_decision <> 'bypass' THEN RAISE EXCEPTION 'Test 17 fail'; END IF;

  -- Test 18: kasir_refund PIN
  UPDATE public.approval_settings SET approval_required=TRUE, verification_method='PIN'
    WHERE request_type='kasir_refund';
  v_decision := public._check_approval_required('kasir_refund', NULL, 500000, 'Kasir');
  IF v_decision <> 'pin' THEN RAISE EXCEPTION 'Test 18 fail'; END IF;

  -- Test 19: kasir_refund APP_INBOX
  UPDATE public.approval_settings SET verification_method='APP_INBOX'
    WHERE request_type='kasir_refund';
  v_decision := public._check_approval_required('kasir_refund', NULL, 500000, 'Kasir');
  IF v_decision <> 'app_inbox' THEN RAISE EXCEPTION 'Test 19 fail'; END IF;

  -- Test 20: rakit_lock bypass
  UPDATE public.approval_settings SET approval_required=FALSE, verification_method='NONE'
    WHERE request_type='rakit_lock';
  v_decision := public._check_approval_required('rakit_lock', NULL, 1, 'Owner');
  IF v_decision <> 'bypass' THEN RAISE EXCEPTION 'Test 20 fail'; END IF;

  -- Test 21: rakit_lock PIN
  UPDATE public.approval_settings SET approval_required=TRUE, verification_method='PIN'
    WHERE request_type='rakit_lock';
  v_decision := public._check_approval_required('rakit_lock', NULL, 1, 'Owner');
  IF v_decision <> 'pin' THEN RAISE EXCEPTION 'Test 21 fail'; END IF;

  -- Test 22: rakit_lock self-bypass
  UPDATE public.approval_settings SET requestor_bypass_self=TRUE
    WHERE request_type='rakit_lock';
  v_decision := public._check_approval_required('rakit_lock', NULL, 1, 'Owner');
  IF v_decision <> 'bypass' THEN RAISE EXCEPTION 'Test 22 fail (self-bypass)'; END IF;

  -- Test 23: purchase_order_create bypass
  UPDATE public.approval_settings SET approval_required=FALSE, verification_method='NONE', requestor_bypass_self=FALSE
    WHERE request_type='purchase_order_create';
  v_decision := public._check_approval_required('purchase_order_create', NULL, 10000000, 'Owner');
  IF v_decision <> 'bypass' THEN RAISE EXCEPTION 'Test 23 fail'; END IF;

  -- Test 24: purchase_order_create PIN
  UPDATE public.approval_settings SET approval_required=TRUE, verification_method='PIN'
    WHERE request_type='purchase_order_create';
  v_decision := public._check_approval_required('purchase_order_create', NULL, 10000000, 'Owner');
  IF v_decision <> 'pin' THEN RAISE EXCEPTION 'Test 24 fail'; END IF;

  -- Test 25: purchase_order_create WA_BUTTON
  UPDATE public.approval_settings SET verification_method='WA_BUTTON'
    WHERE request_type='purchase_order_create';
  v_decision := public._check_approval_required('purchase_order_create', NULL, 10000000, 'Owner');
  IF v_decision <> 'wa_button' THEN RAISE EXCEPTION 'Test 25 fail'; END IF;

  RAISE NOTICE 'All 25 matrix tests PASS';
  RAISE EXCEPTION 'rollback';
END $$;
