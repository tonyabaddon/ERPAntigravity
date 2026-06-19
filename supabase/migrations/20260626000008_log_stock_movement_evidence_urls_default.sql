-- 20260626000008_log_stock_movement_evidence_urls_default.sql
--
-- Fix latent NOT NULL constraint violation in _log_stock_movement.
--
-- The stock_movements.evidence_urls column is NOT NULL with DEFAULT '{}'::text[],
-- and the existing _log_stock_movement function had a matching parameter
-- default ('{}'::text[]). But several callers (commit_approved_rakit_lock,
-- deduct_stock_fifo, wrap_decrement_stock) explicitly pass p_evidence_urls => NULL,
-- which overrides the parameter default with NULL. The INSERT then violates the
-- column-level NOT NULL constraint and raises 23502.
--
-- Discovered while smoking the new Sales funnel Owner Biaya Final flow against
-- a detail-mode CP/RP order (PR #27/#28). The same failure mode affects the
-- legacy WipListScreen → approve_rakit_lock path for any order that has
-- rakit_components (i.e. tracking_mode='detail'). Lumpsum is unaffected because
-- it skips _log_stock_movement entirely.
--
-- Fix: COALESCE the parameter inside the function to the same default the
-- column carries. Preserves the existing parameter signature including all
-- defaults. Callers that genuinely have evidence URLs still pass an array;
-- callers that pass NULL now resolve to '{}' instead of failing the INSERT.

CREATE OR REPLACE FUNCTION public._log_stock_movement(
  p_sku              TEXT,
  p_warehouse        TEXT,
  p_qty_delta        INT,
  p_qty_before       INT,
  p_source           public.stock_movement_source,
  p_related_doc_type TEXT     DEFAULT NULL,
  p_related_doc_id   TEXT     DEFAULT NULL,
  p_reason_code      TEXT     DEFAULT NULL,
  p_reason_note      TEXT     DEFAULT NULL,
  p_actor_user_id    UUID     DEFAULT NULL,
  p_actor_role       TEXT     DEFAULT NULL,
  p_evidence_urls    TEXT[]   DEFAULT '{}'::text[]
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
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
     COALESCE(p_evidence_urls, '{}'::text[]))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
