-- Stok Opname Phase E Task 13:
-- Make RPCs branch on opname_require_witness setting.
-- Default TRUE = behavior unchanged for existing tenants.

-- start_opname_session: accept NULL witness when setting is FALSE.
CREATE OR REPLACE FUNCTION public.start_opname_session(
  p_opname_type    public.opname_type,
  p_scope_payload  JSONB,
  p_counted_by     UUID,
  p_witnessed_by   UUID
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id BIGINT;
  v_sku_filter TEXT[];
  v_cat_filter TEXT[];
  v_require_witness BOOLEAN;
BEGIN
  v_require_witness := public._opname_require_witness();

  IF v_require_witness AND p_witnessed_by IS NULL THEN
    RAISE EXCEPTION 'witness is required (tenant setting opname_require_witness=true)';
  END IF;

  IF p_witnessed_by IS NOT NULL AND p_counted_by = p_witnessed_by THEN
    RAISE EXCEPTION 'counter and witness must be different users';
  END IF;

  INSERT INTO public.stock_opname_sessions
    (opname_type, scope_payload, counted_by_user_id, witnessed_by_user_id)
  VALUES (p_opname_type, p_scope_payload, p_counted_by, p_witnessed_by)
  RETURNING id INTO v_session_id;

  IF p_opname_type = 'per_sku_list' THEN
    v_sku_filter := ARRAY(SELECT jsonb_array_elements_text(p_scope_payload->'skus'));
    INSERT INTO public.stock_opname_counts (session_id, sku, warehouse, system_qty_snapshot)
    SELECT v_session_id, s.sku, w.w,
           CASE w.w WHEN 'atas' THEN s.stock_atas ELSE s.stock_bawah END
      FROM public.stocks s
      CROSS JOIN (VALUES ('atas'), ('bawah')) AS w(w)
     WHERE s.sku = ANY(v_sku_filter);
  ELSIF p_opname_type = 'per_kategori' THEN
    v_cat_filter := ARRAY(SELECT jsonb_array_elements_text(p_scope_payload->'categories'));
    INSERT INTO public.stock_opname_counts (session_id, sku, warehouse, system_qty_snapshot)
    SELECT v_session_id, s.sku, w.w,
           CASE w.w WHEN 'atas' THEN s.stock_atas ELSE s.stock_bawah END
      FROM public.stocks s
      CROSS JOIN (VALUES ('atas'), ('bawah')) AS w(w)
     WHERE s.category = ANY(v_cat_filter);
  ELSE
    INSERT INTO public.stock_opname_counts (session_id, sku, warehouse, system_qty_snapshot)
    SELECT v_session_id, s.sku, w.w,
           CASE w.w WHEN 'atas' THEN s.stock_atas ELSE s.stock_bawah END
      FROM public.stocks s
      CROSS JOIN (VALUES ('atas'), ('bawah')) AS w(w);
  END IF;

  RETURN v_session_id;
END $$;

GRANT EXECUTE ON FUNCTION public.start_opname_session(
  public.opname_type, JSONB, UUID, UUID
) TO authenticated;


-- submit_opname_for_owner: skip witness ack gate when require_witness=FALSE.
CREATE OR REPLACE FUNCTION public.submit_opname_for_owner(
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
  v_require_witness BOOLEAN;
BEGIN
  v_require_witness := public._opname_require_witness();

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

  -- Witness ack only required when setting is TRUE.
  IF v_require_witness AND v_session.witness_acknowledged_at IS NULL THEN
    RAISE EXCEPTION 'witness has not acknowledged session %', p_session_id;
  END IF;

  SELECT COUNT(*) INTO v_row_count FROM stock_opname_counts
   WHERE session_id = p_session_id;
  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'opname session % has no rows to count', p_session_id;
  END IF;

  SELECT EXISTS(SELECT 1 FROM stock_opname_counts
                 WHERE session_id = p_session_id AND counted_qty IS NULL)
    INTO v_has_null;
  SELECT EXISTS(SELECT 1 FROM stock_opname_counts
                 WHERE session_id = p_session_id AND variance <> 0)
    INTO v_has_variance;

  IF NOT v_has_null AND NOT v_has_variance THEN
    UPDATE stock_opname_sessions
       SET submitted_at = now()
     WHERE id = p_session_id;
    PERFORM public.commit_opname_internal(p_session_id);
    RETURN QUERY SELECT 'committed'::TEXT, TRUE, NULL::BIGINT;
    RETURN;
  END IF;

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


-- record_opname_count: skip ack invalidation when require_witness=FALSE.
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
  v_require_witness BOOLEAN;
BEGIN
  v_require_witness := public._opname_require_witness();

  SELECT * INTO v_session FROM public.stock_opname_sessions
   WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'opname session % not found', p_session_id;
  END IF;

  IF v_session.status <> 'in_progress' THEN
    RAISE EXCEPTION 'opname session % is not in_progress (status=%)',
      p_session_id, v_session.status;
  END IF;

  -- Auth: counter or (witness if present) can enter a count.
  IF p_actor_user_id <> v_session.counted_by_user_id
     AND (v_session.witnessed_by_user_id IS NULL
          OR p_actor_user_id <> v_session.witnessed_by_user_id) THEN
    RAISE EXCEPTION 'caller % is neither counter nor witness for session %',
      p_actor_user_id, p_session_id;
  END IF;

  SELECT COALESCE(harga_modal, 0) INTO v_hpp FROM public.stocks WHERE sku = p_sku;

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

  -- Only invalidate ack if witness is required AND already acked.
  IF v_require_witness AND v_session.witness_acknowledged_at IS NOT NULL THEN
    UPDATE public.stock_opname_sessions
       SET witness_acknowledged_at = NULL
     WHERE id = p_session_id;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.record_opname_count(BIGINT, TEXT, TEXT, INT, UUID)
  TO authenticated;
