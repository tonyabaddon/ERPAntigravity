-- 20260626000001_extend_request_rakit_lock_funnel.sql
-- Phase 1B follow-up: keeps Sales funnel position in sync after admin submits
-- rakit cost request. Idempotent CREATE OR REPLACE. The only change vs
-- migration 20260609000010 is the single UPDATE before RETURN.

CREATE OR REPLACE FUNCTION public.request_rakit_lock(
  p_transaction_id  UUID,
  p_lines           JSONB,
  p_actor_user_id   UUID DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_actor    UUID;
  v_status   TEXT;
  v_approval BIGINT;
  v_lock_req BIGINT;
  v_payload  JSONB;
  v_line     JSONB;
  v_line_id  UUID;
  v_comp     JSONB;
BEGIN
  v_actor := COALESCE(p_actor_user_id, auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);

  SELECT status INTO v_status FROM kasir_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF v_status != 'WIP' THEN
    RAISE EXCEPTION 'request_rakit_lock: transaction % is in status %, expected WIP', p_transaction_id, v_status;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_id := (v_line->>'id')::UUID;
    UPDATE rakit_job_lines
    SET final_price   = (v_line->>'final_price')::NUMERIC,
        tracking_mode = v_line->>'tracking_mode',
        labor_cost    = COALESCE((v_line->>'labor_cost')::NUMERIC, 0),
        lump_sum_hpp  = COALESCE((v_line->>'lump_sum_hpp')::NUMERIC, 0),
        updated_at    = now()
    WHERE id = v_line_id AND transaction_id = p_transaction_id;

    DELETE FROM rakit_components WHERE rakit_line_id = v_line_id;
    IF v_line ? 'components' THEN
      FOR v_comp IN SELECT * FROM jsonb_array_elements(v_line->'components') LOOP
        INSERT INTO rakit_components (rakit_line_id, sku, name, qty, warehouse, fifo_cost_snapshot)
        VALUES (v_line_id, v_comp->>'sku', v_comp->>'name',
                (v_comp->>'qty')::NUMERIC,
                COALESCE(v_comp->>'warehouse', 'atas'),
                COALESCE((v_comp->>'fifo_cost')::NUMERIC, 0));
      END LOOP;
    END IF;
  END LOOP;

  v_payload := jsonb_build_object(
    'transaction_id', p_transaction_id::text,
    'lines_count',    jsonb_array_length(p_lines)
  );

  INSERT INTO approval_requests (request_type, payload, requested_by)
  VALUES ('rakit_lock'::approval_request_type, v_payload, v_actor)
  RETURNING id INTO v_approval;

  INSERT INTO rakit_lock_requests
    (transaction_id, approval_request_id, lines_snapshot, requested_by)
  VALUES (p_transaction_id, v_approval, p_lines, v_actor)
  RETURNING id INTO v_lock_req;

  UPDATE kasir_transactions SET status = 'PENDING_LOCK_APPROVAL' WHERE id = p_transaction_id;

  -- Phase 1B integration: advance Sales funnel to 3g atomically.
  UPDATE public.kasir_transactions
     SET funnel_sub_stage = '3g'
   WHERE id = p_transaction_id;

  RETURN v_approval;
END $$;
GRANT EXECUTE ON FUNCTION public.request_rakit_lock(UUID, JSONB, UUID) TO authenticated;

COMMENT ON FUNCTION public.request_rakit_lock(UUID, JSONB, UUID) IS
  'Admin submits material/labor costs for rakit. Inserts approval_request, locks rakit_job_lines, inserts rakit_components, and advances Sales funnel to 3g.';
