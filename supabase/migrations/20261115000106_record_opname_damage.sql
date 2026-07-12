-- Migration: record_opname_damage RPC (Item #1 rev 3, slot 106)
--
-- Admin-facing RPC to flag damaged qty for a specific opname row.
-- Separate from record_opname_count to avoid backward-compat concerns.
--
-- Preconditions:
--   - opname session must exist + be in a state accepting counts (draft/counting)
--   - stock_opname_counts row for (session, sku, warehouse) must exist
--     (created by record_opname_count first)
--   - damaged_qty must be <= counted_qty (CHECK constraint enforces)
--
-- Frontend flow: admin counts SKU via record_opname_count, then if any are
-- damaged, calls record_opname_damage with damaged_qty + photos + notes.
--
-- Setting damaged_qty=0 clears the damage flag (idempotent).

CREATE OR REPLACE FUNCTION public.record_opname_damage(
  p_session_id           BIGINT,
  p_sku                  TEXT,
  p_warehouse            TEXT,
  p_damaged_qty          INTEGER,
  p_damage_notes         TEXT DEFAULT NULL,
  p_damage_evidence_urls TEXT[] DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session   RECORD;
  v_count_row RECORD;
  v_user_id   UUID;
BEGIN
  v_user_id := public._current_user_id();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  IF p_warehouse NOT IN ('atas','bawah') THEN
    RAISE EXCEPTION 'p_warehouse must be atas|bawah, got %', p_warehouse;
  END IF;

  IF p_damaged_qty < 0 THEN
    RAISE EXCEPTION 'damaged_qty must be >= 0';
  END IF;

  -- Verify session exists, is in the right state, and belongs to caller's tenant
  SELECT * INTO v_session FROM public.stock_opname_sessions
    WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'opname session % not found', p_session_id;
  END IF;
  IF v_session.tenant_id <> public._resolve_tenant_id() THEN
    RAISE EXCEPTION 'session % is not accessible from current tenant', p_session_id;
  END IF;
  -- Accept damage flags only during counting phase (before submit for approval)
  IF v_session.status <> 'in_progress' THEN
    RAISE EXCEPTION 'session % is not in_progress (status=%). Damage can only be flagged during counting.',
      p_session_id, v_session.status;
  END IF;

  -- Verify count row exists (admin must have counted first)
  SELECT * INTO v_count_row FROM public.stock_opname_counts
    WHERE session_id = p_session_id AND sku = p_sku AND warehouse = p_warehouse;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no count row for sku % warehouse % — record_opname_count first',
      p_sku, p_warehouse;
  END IF;

  -- Enforce damaged_qty <= counted_qty (CHECK constraint will also catch this)
  IF p_damaged_qty > 0 AND (v_count_row.counted_qty IS NULL OR p_damaged_qty > v_count_row.counted_qty) THEN
    RAISE EXCEPTION 'damaged_qty (%) exceeds counted_qty (%)',
      p_damaged_qty, COALESCE(v_count_row.counted_qty, 0);
  END IF;

  -- Update damage fields
  UPDATE public.stock_opname_counts
     SET damaged_qty          = p_damaged_qty,
         damage_notes         = p_damage_notes,
         damage_evidence_urls = COALESCE(p_damage_evidence_urls, damage_evidence_urls)
   WHERE session_id = p_session_id
     AND sku        = p_sku
     AND warehouse  = p_warehouse;
END $$;

ALTER FUNCTION public.record_opname_damage(BIGINT, TEXT, TEXT, INTEGER, TEXT, TEXT[]) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.record_opname_damage(BIGINT, TEXT, TEXT, INTEGER, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_opname_damage(BIGINT, TEXT, TEXT, INTEGER, TEXT, TEXT[]) TO authenticated;
