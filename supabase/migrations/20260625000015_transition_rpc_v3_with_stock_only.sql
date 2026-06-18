-- Phase 1B PR A — transition_order_stage v3 (stock-aware, no WA).
--
-- v3 extends the v2 RPC (migration 20260625000007) to call:
--   * reserve_stock(p_order_id)  on 3a entry for KOMPONEN orders.
--   * restore_stock(p_order_id)  on Stage 6 cancel from 3a-3e.
--
-- WA notifications are deferred to Phase 1C — no queue_wa_notification
-- calls in this file. The v3 RPC remains backward-compatible with the
-- v2 client signature (same 5 params, same return shape).
--
-- Note: reserve_stock / restore_stock are introduced in migration 011 of
-- this PR as stubs that RAISE EXCEPTION until the schema decisions
-- (Q1-Q5 in 011's header) are made. v3 is written assuming the real
-- implementations land before the 3a/cancel paths are exercised in prod.

DROP FUNCTION IF EXISTS transition_order_stage(uuid, text, text, int, text);

CREATE OR REPLACE FUNCTION transition_order_stage(
  p_order_id uuid,
  p_from_sub_stage text,
  p_to_sub_stage text,
  p_expected_version int,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_version int;
  v_current_sub_stage text;
  v_new_stage smallint;
  v_actor uuid := auth.uid();
  v_order_type text;
  v_reserve_result jsonb;
BEGIN
  SELECT version, funnel_sub_stage, order_type
    INTO v_current_version, v_current_sub_stage, v_order_type
  FROM kasir_transactions
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_current_version IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;
  IF v_current_version != p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STALE_VERSION', 'current_version', v_current_version);
  END IF;
  IF v_current_sub_stage != p_from_sub_stage THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STAGE_MISMATCH', 'current_sub_stage', v_current_sub_stage);
  END IF;

  v_new_stage := CAST(SUBSTRING(p_to_sub_stage FROM '^[0-9]+') AS smallint);

  -- Reserve stock when entering 3a (Komponen flow). CP/RP uses existing rakit_lock approval.
  IF p_to_sub_stage = '3a' AND v_order_type = 'KOMPONEN' THEN
    v_reserve_result := reserve_stock(p_order_id);
    IF (v_reserve_result->>'ok')::boolean = false THEN
      RETURN jsonb_build_object('ok', false, 'code', 'STOCK_INSUFFICIENT', 'details', v_reserve_result);
    END IF;
  END IF;

  -- Restore stock when cancelling to stage 6 from a stage that had stock reserved
  IF v_new_stage = 6 AND v_current_sub_stage IN ('3a', '3b', '3c', '3d', '3e') THEN
    PERFORM restore_stock(p_order_id);
  END IF;

  UPDATE kasir_transactions
  SET
    funnel_sub_stage = p_to_sub_stage,
    funnel_stage = v_new_stage,
    version = version + 1,
    wip_started_at = CASE WHEN p_to_sub_stage IN ('3a', '3f') AND wip_started_at IS NULL THEN NOW() ELSE wip_started_at END
  WHERE id = p_order_id;

  INSERT INTO audit_log(event_type, actor_user_id, payload)
  VALUES ('stage_transition', v_actor, jsonb_build_object(
    'order_id', p_order_id,
    'from_sub_stage', p_from_sub_stage,
    'to_sub_stage', p_to_sub_stage,
    'reason', p_reason
  ));

  RETURN jsonb_build_object('ok', true, 'new_version', v_current_version + 1, 'new_sub_stage', p_to_sub_stage);
END;
$$;

REVOKE ALL ON FUNCTION transition_order_stage(uuid, text, text, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transition_order_stage(uuid, text, text, int, text) TO authenticated;

COMMENT ON FUNCTION transition_order_stage IS 'v3 — atomic transition + optimistic lock + audit log + stock reserve/restore. WA notifications deferred to Phase 1C.';
