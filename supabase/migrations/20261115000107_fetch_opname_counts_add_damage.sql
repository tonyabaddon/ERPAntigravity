-- Migration: extend fetch_opname_counts return type with damage fields (rev 3, slot 107)
--
-- Needed so frontend can render "Flag Rusak" state per opname row without a
-- second query. Requires DROP-then-recreate because Postgres doesn't allow
-- CREATE OR REPLACE to change return-type row shape.
--
-- Backwards-incompatible for any caller that relied on positional column
-- indexing, but the client only uses named-column mapping.

DROP FUNCTION IF EXISTS public.fetch_opname_counts(bigint);

CREATE OR REPLACE FUNCTION public.fetch_opname_counts(p_session_id bigint)
RETURNS TABLE(
  session_id bigint,
  sku text,
  warehouse text,
  system_qty_snapshot integer,
  counted_qty integer,
  variance integer,
  variance_value numeric,
  damaged_qty integer,
  damage_notes text,
  damage_evidence_urls text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_session_status public.opname_status;
  v_caller_role    TEXT;
  v_mask           BOOLEAN;
BEGIN
  SELECT status INTO v_session_status FROM stock_opname_sessions WHERE id = p_session_id;
  SELECT role INTO v_caller_role FROM admin_users WHERE id = public._current_user_id();
  v_mask := (v_session_status = 'in_progress' AND COALESCE(v_caller_role, '') <> 'Owner');

  RETURN QUERY
    SELECT
      c.session_id, c.sku, c.warehouse,
      CASE WHEN v_mask THEN NULL ELSE c.system_qty_snapshot END,
      c.counted_qty,
      CASE WHEN v_mask THEN NULL ELSE c.variance END,
      CASE WHEN v_mask THEN 0::NUMERIC ELSE c.variance_value END,
      c.damaged_qty,
      c.damage_notes,
      c.damage_evidence_urls
    FROM stock_opname_counts c
    WHERE c.session_id = p_session_id;
END $function$;

REVOKE ALL ON FUNCTION public.fetch_opname_counts(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fetch_opname_counts(bigint) TO authenticated;
