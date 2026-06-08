-- Stock Fraud Prevention Phase 2 Task 8: commit_opname RPC.
--
-- This is the SECOND hop of the opname two-phase commit. The FIRST hop
-- (submit_opname_for_owner, …013) created the approval_requests gate and
-- froze the session at status='pending_owner'. Owner approval flips the
-- approval_requests row to 'approved' via _transition_approval (the same
-- canonical side-channel that commit_approved_adjustment relies on). This
-- RPC is the THIRD step — it walks every (sku, warehouse) row in the
-- session with a non-zero variance and:
--
--   1. UPDATEs stocks.stock_<warehouse> by the SIGNED variance (delta).
--      A negative variance (shortage) decrements stock; a positive
--      variance (surplus) increments. Task 7 stores variance as a STORED
--      generated column on (counted_qty - system_qty_snapshot) so the sign
--      is already correct — no abs() / case-on-sign is needed.
--   2. Writes ONE stock_movements row via Phase 1's _log_stock_movement
--      helper with source='opname_variance', related_doc_type='opname_session',
--      related_doc_id=session_id::text. qty_before is the snapshot from
--      stock_opname_counts (the count was taken against the snapshot, so the
--      delta against the snapshot is the truthful before/after pair); the
--      helper computes qty_after = qty_before + qty_delta.
--   3. Flips the session to status='committed' and stamps committed_at.
--
-- All-or-nothing guarantee:
--   Postgres functions run in their caller's transaction (or an implicit
--   transaction wrapping the SELECT). If ANY iteration of the FOR loop
--   raises — bad warehouse name, _log_stock_movement violating chk_qty_math,
--   stocks row missing — the entire RPC unwinds: no partial stock update,
--   no orphan ledger rows, no session committed_at stamp. This is the
--   property the tests pin (commit_opname_NotApproved_Fails verifies
--   nothing-was-written on the negative path).
--
-- Gate verification:
--   We assert approval_requests.status='approved' before touching anything,
--   matching commit_approved_adjustment's pattern. This is the linchpin of
--   the two-phase architecture: the satellite commit RPC must NEVER write
--   stock before the source-of-truth gate has been flipped by the canonical
--   _transition_approval side-channel.
--
-- Why we don't re-verify request_type='opname':
--   The session FOR UPDATE lookup uses approval_request_id = p_approval_id,
--   which is a FK pointing back at this very row. An approval with the
--   wrong request_type would have no matching session, and the "no opname
--   session for approval %" branch catches it cleanly.

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
BEGIN
  -- Gate check: approval_requests row must already be 'approved' (the Owner
  -- has flipped it via _transition_approval). Lock the row to serialize
  -- against concurrent commit attempts on the same approval.
  SELECT * INTO v_ar FROM public.approval_requests
    WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_request % not found', p_approval_id;
  END IF;
  IF v_ar.status <> 'approved' THEN
    RAISE EXCEPTION 'approval_request % is not approved (status=%)',
      p_approval_id, v_ar.status;
  END IF;

  -- Find the linked opname session. Lock it FOR UPDATE so a concurrent
  -- caller racing on the same approval is serialized at the session-row
  -- level too (defence in depth on top of the AR lock).
  SELECT * INTO v_session FROM public.stock_opname_sessions
    WHERE approval_request_id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no opname session for approval %', p_approval_id;
  END IF;
  IF v_session.status <> 'pending_owner' THEN
    RAISE EXCEPTION 'opname session % is not pending_owner (status=%)',
      v_session.id, v_session.status;
  END IF;

  -- Walk every varianced row. Zero-variance rows (counted_qty matched
  -- snapshot exactly) are filtered out — they contribute no movement and
  -- no stock update. counted_qty IS NULL rows (counter never entered a
  -- count for this sku × warehouse) are also skipped: we don't write a
  -- ledger row for "I didn't look at this one".
  FOR r IN
    SELECT sku, warehouse, system_qty_snapshot, counted_qty, variance
      FROM public.stock_opname_counts
     WHERE session_id = v_session.id
       AND counted_qty IS NOT NULL
       AND variance <> 0
  LOOP
    -- UPDATE the dynamic stock_<warehouse> column. format()/%I quotes the
    -- identifier so 'atas' and 'bawah' are safe; the CHECK on
    -- stock_opname_counts.warehouse already constrains the value to one of
    -- those two literals, so an unknown warehouse is not reachable here.
    EXECUTE format(
      'UPDATE public.stocks SET stock_%I = stock_%I + $2 WHERE sku = $1',
      r.warehouse, r.warehouse)
      USING r.sku, r.variance;

    -- Write the ledger row via the Phase 1 chokepoint. qty_delta is the
    -- SIGNED variance; qty_before is the snapshot (the count was taken
    -- against this number); _log_stock_movement computes qty_after.
    -- related_doc_type='opname_session' matches the table name the row
    -- traces back to; related_doc_id is the session id stringified so
    -- downstream audit can join back.
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

  -- Finalize: flip the session to committed and stamp the timestamp. The
  -- approval_requests row STAYS at 'approved' (it's the gate, not the
  -- satellite status); only the session moves to its terminal state.
  UPDATE public.stock_opname_sessions
     SET status       = 'committed',
         committed_at = now()
   WHERE id = v_session.id;

  RETURN v_movement_count;
END $$;

GRANT EXECUTE ON FUNCTION public.commit_opname(BIGINT) TO authenticated;
