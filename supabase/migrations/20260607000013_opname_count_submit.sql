-- Stock Fraud Prevention Phase 2 Task 7:
-- record_opname_count, witness_acknowledge_opname, submit_opname_for_owner.
--
-- These three RPCs drive the in-warehouse phase of an opname session that
-- migration …011 (stock_opname_sessions + stock_opname_counts) and …012
-- (start_opname_session) laid the groundwork for:
--
--   record_opname_count       — counter / witness enters one (sku, warehouse)
--                               counted_qty. UPSERT-style: updates the row
--                               start_opname_session already inserted.
--   witness_acknowledge_opname — witness flips witness_acknowledged_at,
--                                attesting they were present for the count.
--                                This is a prerequisite for submit.
--   submit_opname_for_owner   — counter freezes the session, creates an
--                               approval_requests row (type='opname'),
--                               and flips status to 'pending_owner'. Returns
--                               the approval_request_id.
--
-- Auth model (all three are SECURITY DEFINER so PostgREST can call them as
-- the 'authenticated' role without needing UPDATE privileges on the satellite
-- tables; each RPC carries its own actor_user_id parameter and compares it
-- against the session's counter / witness columns):
--
--   record_opname_count     : caller must be EITHER counted_by_user_id OR
--                             witnessed_by_user_id. Both physical humans on
--                             the floor are entitled to type a count in.
--   witness_acknowledge_…   : caller must be witnessed_by_user_id. The
--                             whole point of witness ack is the WITNESS
--                             signs off — the counter signing for the
--                             witness defeats the two-person rule.
--   submit_opname_for_owner : caller must be counted_by_user_id. Only the
--                             counter submits for Owner review. (Mirrors
--                             the convention in request_adjustment where
--                             the originator drives state.)
--
-- variance_value semantics:
--   record_opname_count writes (counted - snapshot) × harga_modal as a SIGNED
--   numeric. A shortage produces a NEGATIVE number; a surplus produces a
--   POSITIVE one. submit_opname_for_owner sums these signed values into
--   stock_opname_sessions.variance_total_value (NOT the absolute-value
--   total — Task 8's commit RPC needs the signed direction to know which
--   way to write the ledger row). The Owner UI can format the sign for
--   display; the database stores signed truth.
--
-- harga_modal lookup:
--   We read public.stocks.harga_modal at record time, NOT at submit time.
--   Rationale: variance_value is the row's contribution to the loss surface,
--   and the price the count was taken at is the price the counter was
--   physically holding. Concurrent harga_modal updates on stocks don't
--   retroactively re-value an opname row. Task 8 may re-read harga_modal
--   when writing the ledger; that's a Phase-1 ledger concern, not this RPC's.

CREATE OR REPLACE FUNCTION public.record_opname_count(
  p_session_id     BIGINT,
  p_sku            TEXT,
  p_warehouse      TEXT,
  p_counted_qty    INT,
  p_actor_user_id  UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_hpp NUMERIC;
BEGIN
  SELECT * INTO v_session
    FROM public.stock_opname_sessions
   WHERE id = p_session_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'opname session % not found', p_session_id;
  END IF;

  IF v_session.status <> 'in_progress' THEN
    RAISE EXCEPTION 'opname session % is not in_progress (status=%)',
      p_session_id, v_session.status;
  END IF;

  -- Auth: only the assigned counter or witness can enter a count.
  IF p_actor_user_id <> v_session.counted_by_user_id
     AND p_actor_user_id <> v_session.witnessed_by_user_id THEN
    RAISE EXCEPTION 'caller % is neither counter nor witness for session %',
      p_actor_user_id, p_session_id;
  END IF;

  SELECT COALESCE(harga_modal, 0) INTO v_hpp
    FROM public.stocks WHERE sku = p_sku;

  -- UPSERT against the row start_opname_session already inserted. variance
  -- is a STORED generated column on (counted_qty - system_qty_snapshot) so
  -- updating counted_qty is enough to refresh the integer variance; we
  -- compute variance_value explicitly here because harga_modal lives on a
  -- separate table.
  UPDATE public.stock_opname_counts
     SET counted_qty    = p_counted_qty,
         variance_value = (COALESCE(p_counted_qty, 0) - system_qty_snapshot) * v_hpp
   WHERE session_id = p_session_id
     AND sku        = p_sku
     AND warehouse  = p_warehouse;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no opname count row for session=% sku=% warehouse=%',
      p_session_id, p_sku, p_warehouse;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.record_opname_count(BIGINT, TEXT, TEXT, INT, UUID)
  TO authenticated;


CREATE OR REPLACE FUNCTION public.witness_acknowledge_opname(
  p_session_id     BIGINT,
  p_actor_user_id  UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
BEGIN
  SELECT * INTO v_session
    FROM public.stock_opname_sessions
   WHERE id = p_session_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'opname session % not found', p_session_id;
  END IF;

  IF v_session.status <> 'in_progress' THEN
    RAISE EXCEPTION 'opname session % is not in_progress (status=%)',
      p_session_id, v_session.status;
  END IF;

  -- Only the assigned witness can acknowledge. Letting the counter ack on
  -- the witness's behalf would defeat the two-person rule.
  IF p_actor_user_id <> v_session.witnessed_by_user_id THEN
    RAISE EXCEPTION 'caller % is not the assigned witness for session %',
      p_actor_user_id, p_session_id;
  END IF;

  UPDATE public.stock_opname_sessions
     SET witness_acknowledged_at = now()
   WHERE id = p_session_id;
END $$;

GRANT EXECUTE ON FUNCTION public.witness_acknowledge_opname(BIGINT, UUID)
  TO authenticated;


CREATE OR REPLACE FUNCTION public.submit_opname_for_owner(
  p_session_id     BIGINT,
  p_actor_user_id  UUID
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session         RECORD;
  v_variance_total  NUMERIC := 0;
  v_approval_id     BIGINT;
BEGIN
  SELECT * INTO v_session
    FROM public.stock_opname_sessions
   WHERE id = p_session_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'opname session % not found', p_session_id;
  END IF;

  IF v_session.status <> 'in_progress' THEN
    RAISE EXCEPTION 'opname session % is not in_progress (status=%)',
      p_session_id, v_session.status;
  END IF;

  -- Only the counter can submit. Mirrors request_adjustment where the
  -- originator drives state. The witness's role ends at acknowledgement.
  IF p_actor_user_id <> v_session.counted_by_user_id THEN
    RAISE EXCEPTION 'caller % is not the assigned counter for session %',
      p_actor_user_id, p_session_id;
  END IF;

  -- Witness must have acked separately via witness_acknowledge_opname. The
  -- error string must contain "witness" so the UI can surface a friendly
  -- toast (TestSubmitOpname_WithoutWitnessAck_Fails pins this).
  IF v_session.witness_acknowledged_at IS NULL THEN
    RAISE EXCEPTION 'witness has not acknowledged session %', p_session_id;
  END IF;

  -- Signed sum across all counted (sku, warehouse) rows in this session.
  -- Rows still NULL for counted_qty contribute 0 (no count entered = no
  -- variance claim). Task 8's commit RPC also reads this back to record the
  -- session-level loss surface in approval_requests.payload for the Owner.
  SELECT COALESCE(SUM(variance_value), 0)
    INTO v_variance_total
    FROM public.stock_opname_counts
   WHERE session_id = p_session_id;

  -- The approval_requests row is the source-of-truth for the Owner gate.
  -- payload carries enough to render the review UI without joining back
  -- to the satellite tables: session id, signed total, and a count of
  -- impacted rows for at-a-glance scope.
  INSERT INTO public.approval_requests
    (request_type, payload, requested_by)
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

  UPDATE public.stock_opname_sessions
     SET status                = 'pending_owner',
         submitted_at          = now(),
         variance_total_value  = v_variance_total,
         approval_request_id   = v_approval_id
   WHERE id = p_session_id;

  RETURN v_approval_id;
END $$;

GRANT EXECUTE ON FUNCTION public.submit_opname_for_owner(BIGINT, UUID)
  TO authenticated;
