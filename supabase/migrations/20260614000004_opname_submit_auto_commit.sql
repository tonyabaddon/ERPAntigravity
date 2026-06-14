-- Stok Opname Blind-Count Phase C Task 6:
-- submit_opname_for_owner dual-branch + commit_opname_internal helper.
--
-- Auto-commit (selesai_otomatis): all rows have counted_qty NOT NULL AND
-- variance=0 AND witness has acked. Then session goes straight from
-- in_progress → committed. No stock_movements (all deltas are zero), no
-- approval_requests row. audit_log entry 'opname_auto_commit' written.
--
-- Pending owner (existing path): any NULL counted_qty OR any variance≠0.
-- approval_requests row created exactly as before.
--
-- Empty session: row_count=0 → reject. Defense in depth; UI already guards.
--
-- Return shape change: was RETURNS BIGINT (approval_id). Now RETURNS TABLE
-- (status TEXT, auto BOOLEAN, approval_id BIGINT). DROP required before
-- CREATE because Postgres won't change return type via CREATE OR REPLACE.

-- Drop old signature so we can change the return type.
DROP FUNCTION IF EXISTS public.submit_opname_for_owner(BIGINT, UUID);

-- Helper for the auto-commit path. Writes audit_log + flips session status.
-- Skips stock_movements (variance=0 for all rows so no delta to record;
-- audit_log captures the event itself).
CREATE OR REPLACE FUNCTION public.commit_opname_internal(
  p_session_id BIGINT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session       RECORD;
  v_counter_name  TEXT;
  v_witness_name  TEXT;
  v_row_count     INT;
BEGIN
  SELECT * INTO v_session FROM stock_opname_sessions
   WHERE id = p_session_id FOR UPDATE;

  SELECT COUNT(*) INTO v_row_count FROM stock_opname_counts
   WHERE session_id = p_session_id;

  UPDATE stock_opname_sessions
     SET status = 'committed',
         submitted_at = COALESCE(submitted_at, now()),
         committed_at = now()
   WHERE id = p_session_id;

  SELECT name INTO v_counter_name FROM admin_users WHERE id = v_session.counted_by_user_id;
  SELECT name INTO v_witness_name FROM admin_users WHERE id = v_session.witnessed_by_user_id;

  INSERT INTO audit_log (event_type, actor_user_id, payload)
  VALUES (
    'opname_auto_commit',
    v_session.counted_by_user_id,
    jsonb_build_object(
      'session_id',           p_session_id,
      'counter_user_id',      v_session.counted_by_user_id,
      'counter_name',         v_counter_name,
      'witness_user_id',      v_session.witnessed_by_user_id,
      'witness_name',         v_witness_name,
      'row_count',            v_row_count,
      'total_variance_value', 0
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.commit_opname_internal(BIGINT) TO authenticated;


CREATE FUNCTION public.submit_opname_for_owner(
  p_session_id     BIGINT,
  p_actor_user_id  UUID
) RETURNS TABLE (status TEXT, auto BOOLEAN, approval_id BIGINT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session         RECORD;
  v_variance_total  NUMERIC := 0;
  v_approval_id     BIGINT;
  v_row_count       INT;
  v_has_null        BOOLEAN;
  v_has_variance    BOOLEAN;
BEGIN
  SELECT * INTO v_session FROM stock_opname_sessions
   WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'opname session % not found', p_session_id;
  END IF;

  IF v_session.status <> 'in_progress' THEN
    RAISE EXCEPTION 'opname session % is not in_progress (status=%)',
      p_session_id, v_session.status;
  END IF;

  IF p_actor_user_id <> v_session.counted_by_user_id THEN
    RAISE EXCEPTION 'caller % is not the assigned counter for session %',
      p_actor_user_id, p_session_id;
  END IF;

  IF v_session.witness_acknowledged_at IS NULL THEN
    RAISE EXCEPTION 'witness has not acknowledged session %', p_session_id;
  END IF;

  -- Row count guard (defense in depth — UI already prevents this)
  SELECT COUNT(*) INTO v_row_count FROM stock_opname_counts
   WHERE session_id = p_session_id;
  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'opname session % has no rows to count', p_session_id;
  END IF;

  -- Gate check for auto-commit
  SELECT EXISTS(SELECT 1 FROM stock_opname_counts
                 WHERE session_id = p_session_id AND counted_qty IS NULL)
    INTO v_has_null;
  SELECT EXISTS(SELECT 1 FROM stock_opname_counts
                 WHERE session_id = p_session_id AND variance <> 0)
    INTO v_has_variance;

  IF NOT v_has_null AND NOT v_has_variance THEN
    -- AUTO-COMMIT path
    UPDATE stock_opname_sessions
       SET submitted_at = now()
     WHERE id = p_session_id;
    PERFORM public.commit_opname_internal(p_session_id);
    RETURN QUERY SELECT 'committed'::TEXT, TRUE, NULL::BIGINT;
    RETURN;
  END IF;

  -- PENDING_OWNER path (existing logic preserved)
  SELECT COALESCE(SUM(variance_value), 0) INTO v_variance_total
    FROM stock_opname_counts WHERE session_id = p_session_id;

  INSERT INTO approval_requests (request_type, payload, requested_by)
  VALUES (
    'opname',
    jsonb_build_object(
      'session_id',           p_session_id,
      'variance_total_value', v_variance_total,
      'counted_by_user_id',   v_session.counted_by_user_id,
      'witnessed_by_user_id', v_session.witnessed_by_user_id
    ),
    v_session.counted_by_user_id
  )
  RETURNING id INTO v_approval_id;

  UPDATE stock_opname_sessions
     SET status = 'pending_owner',
         submitted_at = now(),
         variance_total_value = v_variance_total,
         approval_request_id = v_approval_id
   WHERE id = p_session_id;

  RETURN QUERY SELECT 'pending_owner'::TEXT, FALSE, v_approval_id;
END $$;

GRANT EXECUTE ON FUNCTION public.submit_opname_for_owner(BIGINT, UUID) TO authenticated;
