-- Atomic transition_order_stage RPC with optimistic lock + audit log
--
-- NOTE: There is no kasir_audit_logs table. The project uses a generic
-- public.audit_log table (created in 20260614000003_audit_log_table.sql)
-- with columns: id, event_type, actor_user_id, payload, created_at.
-- The transaction_id is embedded in payload JSONB.
CREATE OR REPLACE FUNCTION transition_order_stage(
  p_order_id uuid,
  p_from_sub_stage text,
  p_to_sub_stage text,
  p_expected_version int,
  p_actor_user_id uuid,
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
BEGIN
  SELECT version, funnel_sub_stage
    INTO v_current_version, v_current_sub_stage
  FROM kasir_transactions
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_current_version IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;

  IF v_current_version != p_expected_version THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'STALE_VERSION',
      'current_version', v_current_version
    );
  END IF;

  IF v_current_sub_stage != p_from_sub_stage THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'STAGE_MISMATCH',
      'current_sub_stage', v_current_sub_stage
    );
  END IF;

  v_new_stage := CAST(SUBSTRING(p_to_sub_stage FROM '^[0-9]+') AS smallint);

  UPDATE kasir_transactions
  SET
    funnel_sub_stage = p_to_sub_stage,
    funnel_stage = v_new_stage,
    version = version + 1,
    wip_started_at = CASE
      WHEN p_to_sub_stage IN ('3a', '3f') AND wip_started_at IS NULL THEN NOW()
      ELSE wip_started_at
    END
  WHERE id = p_order_id;

  -- Audit log entry using the generic public.audit_log table.
  -- audit_log has no transaction_id column; order_id is stored in payload.
  INSERT INTO audit_log(event_type, actor_user_id, payload)
  VALUES (
    'stage_transition',
    p_actor_user_id,
    jsonb_build_object(
      'order_id', p_order_id,
      'from_sub_stage', p_from_sub_stage,
      'to_sub_stage', p_to_sub_stage,
      'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'new_version', v_current_version + 1,
    'new_sub_stage', p_to_sub_stage
  );
END;
$$;

REVOKE ALL ON FUNCTION transition_order_stage(uuid, text, text, int, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transition_order_stage(uuid, text, text, int, uuid, text) TO authenticated;

COMMENT ON FUNCTION transition_order_stage IS 'Atomic stage transition with optimistic lock (version) + audit log. Returns {ok, code?, new_version?, new_sub_stage?, current_version?, current_sub_stage?}.';
