-- Stok Opname Blind-Count Phase B Task 5:
-- record_opname_count invalidates witness_acknowledged_at when counter
-- edits AFTER witness has already acked.
--
-- Rationale: witness signed off on what they saw counter type. If counter
-- changes the number afterwards, witness must re-confirm. Two-person rule
-- compromise mitigated. Especially important with auto-commit path where
-- Owner is no longer the third pair of eyes.
--
-- Implementation: append a single UPDATE after the existing count UPDATE,
-- guarded by IF v_session.witness_acknowledged_at IS NOT NULL.

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

  -- NEW (Task 5): if witness has already acked, invalidate the ack.
  -- Counter changing a number after witness sign-off compromises two-person
  -- chain-of-custody; witness must re-acknowledge before submit proceeds.
  IF v_session.witness_acknowledged_at IS NOT NULL THEN
    UPDATE public.stock_opname_sessions
       SET witness_acknowledged_at = NULL
     WHERE id = p_session_id;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.record_opname_count(BIGINT, TEXT, TEXT, INT, UUID)
  TO authenticated;
