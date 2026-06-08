-- Stock Fraud Prevention Phase 1: _log_stock_movement helper RPC.
--
-- Single chokepoint that every wrapper RPC (receive_purchase_order,
-- deduct_stock_fifo, transfer_warehouse, decrement_stock) will call inside its
-- transaction in Phase 1 Tasks 4-7. Centralizes:
--   - qty_after computation (qty_before + qty_delta)
--   - actor_user_id / actor_role defaults (system bot fallback)
--   - evidence_urls default ('{}')
--
-- Filename suffix `b` is an addendum to 20260607000001_stock_movements.sql.
-- The prior migration is already applied to production and committed at
-- 9e22fd4; past migration files are immutable in this project's workflow.
--
-- The function is SECURITY DEFINER + REVOKEd from anon/authenticated/PUBLIC:
-- only invoked from inside other SECURITY DEFINER RPCs in this codebase.

CREATE OR REPLACE FUNCTION public._log_stock_movement(
  p_sku TEXT, p_warehouse TEXT, p_qty_delta INT,
  p_qty_before INT, p_source public.stock_movement_source,
  p_related_doc_type TEXT DEFAULT NULL,
  p_related_doc_id   TEXT DEFAULT NULL,
  p_reason_code      TEXT DEFAULT NULL,
  p_reason_note      TEXT DEFAULT NULL,
  p_actor_user_id    UUID DEFAULT NULL,
  p_actor_role       TEXT DEFAULT NULL,
  p_evidence_urls    TEXT[] DEFAULT '{}'
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id BIGINT;
BEGIN
  INSERT INTO public.stock_movements
    (sku, warehouse, qty_delta, qty_before, qty_after, source,
     related_doc_type, related_doc_id, reason_code, reason_note,
     actor_user_id, actor_role, evidence_urls)
  VALUES
    (p_sku, p_warehouse, p_qty_delta, p_qty_before,
     p_qty_before + p_qty_delta, p_source,
     p_related_doc_type, p_related_doc_id, p_reason_code, p_reason_note,
     COALESCE(p_actor_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
     COALESCE(p_actor_role, 'system'),
     p_evidence_urls)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public._log_stock_movement(
  TEXT, TEXT, INT, INT, public.stock_movement_source,
  TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT[]
) FROM PUBLIC, anon, authenticated;
-- Only invoked from inside other SECURITY DEFINER RPCs in this codebase.
