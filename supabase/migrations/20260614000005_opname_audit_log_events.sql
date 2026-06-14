-- Stok Opname Blind-Count Phase C Task 8:
-- audit_log entries for commit_opname and reject paths.
--
-- Auto-commit path already writes 'opname_auto_commit' via
-- commit_opname_internal (Task 6 migration). This task adds parallel
-- entries for owner-driven paths:
--   commit_opname  → 'opname_owner_commit'
--   reject path    → 'opname_owner_reject' (via trigger on approval_requests
--                                           since reject lives in canonical
--                                           _transition_approval side-channel)
--
-- The commit_opname body is COPIED verbatim from migration 20260607000014
-- with an INSERT INTO audit_log appended before RETURN.

CREATE OR REPLACE FUNCTION public.commit_opname(
  p_approval_id BIGINT
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ar               RECORD;
  v_session          RECORD;
  r                  RECORD;
  v_movement_count   INT := 0;
  v_counter_name     TEXT;
  v_witness_name     TEXT;
  v_approver_name    TEXT;
  v_row_count        INT;
BEGIN
  SELECT * INTO v_ar FROM public.approval_requests
    WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_request % not found', p_approval_id;
  END IF;
  IF v_ar.status <> 'approved' THEN
    RAISE EXCEPTION 'approval_request % is not approved (status=%)',
      p_approval_id, v_ar.status;
  END IF;

  SELECT * INTO v_session FROM public.stock_opname_sessions
    WHERE approval_request_id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no opname session for approval %', p_approval_id;
  END IF;
  IF v_session.status <> 'pending_owner' THEN
    RAISE EXCEPTION 'opname session % is not pending_owner (status=%)',
      v_session.id, v_session.status;
  END IF;

  FOR r IN
    SELECT sku, warehouse, system_qty_snapshot, counted_qty, variance
      FROM public.stock_opname_counts
     WHERE session_id = v_session.id
       AND counted_qty IS NOT NULL
       AND variance <> 0
  LOOP
    EXECUTE format(
      'UPDATE public.stocks SET stock_%I = stock_%I + $2 WHERE sku = $1',
      r.warehouse, r.warehouse)
      USING r.sku, r.variance;

    PERFORM public._log_stock_movement(
      p_sku              => r.sku,
      p_warehouse        => r.warehouse,
      p_qty_delta        => r.variance,
      p_qty_before       => r.system_qty_snapshot,
      p_source           => 'opname_variance'::public.stock_movement_source,
      p_related_doc_type => 'opname_session',
      p_related_doc_id   => v_session.id::text,
      p_reason_code      => 'opname',
      p_reason_note      => NULL,
      p_actor_user_id    => v_session.counted_by_user_id,
      p_actor_role       => 'opname_commit',
      p_evidence_urls    => '{}'::text[]
    );

    v_movement_count := v_movement_count + 1;
  END LOOP;

  UPDATE public.stock_opname_sessions
     SET status       = 'committed',
         committed_at = now()
   WHERE id = v_session.id;

  -- NEW (Task 8): audit_log entry for forensic visibility into Owner-driven
  -- commits. Counter + witness names included so the Pengawasan UI doesn't
  -- need to join back to admin_users on every render.
  SELECT name INTO v_counter_name FROM admin_users WHERE id = v_session.counted_by_user_id;
  SELECT name INTO v_witness_name FROM admin_users WHERE id = v_session.witnessed_by_user_id;
  SELECT name INTO v_approver_name FROM admin_users WHERE id = v_ar.decided_by;
  SELECT COUNT(*) INTO v_row_count FROM stock_opname_counts WHERE session_id = v_session.id;

  INSERT INTO audit_log (event_type, actor_user_id, payload)
  VALUES (
    'opname_owner_commit',
    v_ar.decided_by,
    jsonb_build_object(
      'session_id',           v_session.id,
      'counter_user_id',      v_session.counted_by_user_id,
      'counter_name',         v_counter_name,
      'witness_user_id',      v_session.witnessed_by_user_id,
      'witness_name',         v_witness_name,
      'approved_by_user_id',  v_ar.decided_by,
      'approved_by_name',     v_approver_name,
      'row_count',            v_row_count,
      'total_variance_value', v_session.variance_total_value,
      'movement_count',       v_movement_count
    )
  );

  RETURN v_movement_count;
END $$;

GRANT EXECUTE ON FUNCTION public.commit_opname(BIGINT) TO authenticated;


-- Reject path: trigger on approval_requests AFTER UPDATE.
-- Reject flow uses the canonical _transition_approval helper which updates
-- approval_requests.status to 'rejected'. Trigger fires for opname-type
-- requests and writes audit_log + flips the linked session to rejected.

CREATE OR REPLACE FUNCTION public._audit_opname_reject() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session       RECORD;
  v_counter_name  TEXT;
  v_witness_name  TEXT;
  v_rejector_name TEXT;
  v_row_count     INT;
BEGIN
  IF NEW.status = 'rejected'
     AND (OLD.status IS DISTINCT FROM 'rejected')
     AND NEW.request_type = 'opname' THEN

    SELECT * INTO v_session FROM stock_opname_sessions
     WHERE approval_request_id = NEW.id;

    IF v_session.id IS NOT NULL THEN
      -- Flip session status to rejected. Stock remains untouched.
      UPDATE stock_opname_sessions
         SET status = 'rejected'
       WHERE id = v_session.id;

      SELECT name INTO v_counter_name FROM admin_users WHERE id = v_session.counted_by_user_id;
      SELECT name INTO v_witness_name FROM admin_users WHERE id = v_session.witnessed_by_user_id;
      SELECT name INTO v_rejector_name FROM admin_users WHERE id = NEW.decided_by;
      SELECT COUNT(*) INTO v_row_count FROM stock_opname_counts WHERE session_id = v_session.id;

      INSERT INTO audit_log (event_type, actor_user_id, payload)
      VALUES (
        'opname_owner_reject',
        NEW.decided_by,
        jsonb_build_object(
          'session_id',           v_session.id,
          'counter_user_id',      v_session.counted_by_user_id,
          'counter_name',         v_counter_name,
          'witness_user_id',      v_session.witnessed_by_user_id,
          'witness_name',         v_witness_name,
          'rejected_by_user_id',  NEW.decided_by,
          'rejected_by_name',     v_rejector_name,
          'row_count',            v_row_count,
          'total_variance_value', v_session.variance_total_value
        )
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_opname_reject ON public.approval_requests;
CREATE TRIGGER trg_audit_opname_reject
  AFTER UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public._audit_opname_reject();
