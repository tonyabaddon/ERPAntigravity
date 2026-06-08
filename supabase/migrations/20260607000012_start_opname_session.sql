-- Stock Fraud Prevention Phase 2 Task 6: start_opname_session RPC.
--
-- This is the entry-point for a physical-count cycle. It:
--   1. Validates the two-person rule (counter <> witness) at the RPC level
--      so the UI sees a friendlier "different" error string instead of the
--      raw chk_two_person constraint violation. The CHECK on
--      stock_opname_sessions (migration …011) remains the schema-level
--      backstop against direct INSERT bypass attempts.
--   2. INSERTs the parent stock_opname_sessions row.
--   3. Resolves the in-scope SKU set from p_opname_type + p_scope_payload:
--        'full'         → every SKU in public.stocks
--        'per_kategori' → SKUs whose stocks.category ∈ scope_payload->'categories'
--        'per_sku_list' → explicit SKUs in scope_payload->'skus'
--   4. For each in-scope SKU × warehouse (atas, bawah) INSERTs a
--      stock_opname_counts row with system_qty_snapshot set to the CURRENT
--      stocks.stock_<warehouse> value. This snapshot is taken atomically NOW
--      so concurrent sales after this point don't perturb the variance calc
--      (see header of migration …011 for the snapshot-pattern rationale).
--   5. Returns the new session_id (BIGINT).
--
-- SECURITY DEFINER + search_path pin: the RPC runs with elevated privileges
-- so the frontend's authenticated role can call it through PostgREST without
-- needing direct INSERT on stock_opname_sessions / _counts. EXECUTE is granted
-- to 'authenticated' explicitly at the bottom of this migration.
--
-- Why p_opname_type drives the WHERE clause (not scope_payload->>'opname_type'):
-- the enum-typed parameter is what the test fixtures and the eventual UI both
-- pass; keeping the dispatch on the parameter avoids the redundancy of
-- carrying the same fact in two places (param + JSON field). scope_payload is
-- reserved for the filter values themselves (categories list, SKU list).

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
BEGIN
  -- Friendlier two-person guard before the chk_two_person CHECK fires. The
  -- frontend surfaces this string in a toast; the CHECK constraint backs it
  -- up for direct-INSERT bypass attempts.
  IF p_counted_by = p_witnessed_by THEN
    RAISE EXCEPTION 'counter and witness must be different users';
  END IF;

  INSERT INTO public.stock_opname_sessions
    (opname_type, scope_payload, counted_by_user_id, witnessed_by_user_id)
  VALUES (p_opname_type, p_scope_payload, p_counted_by, p_witnessed_by)
  RETURNING id INTO v_session_id;

  -- Build SKU list from scope_payload and snapshot each (sku, warehouse)
  -- against the current stocks columns. Two warehouses per SKU = two rows.
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
  ELSE  -- 'full'
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
