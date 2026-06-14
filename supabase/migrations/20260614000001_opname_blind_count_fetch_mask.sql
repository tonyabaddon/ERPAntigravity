-- Stok Opname Blind-Count Phase B Task 4:
-- fetch_opname_counts + get_opname_session masking.
--
-- When caller is NOT 'Owner' AND session.status='in_progress', return NULL
-- for system_qty_snapshot, variance, and variance_value. counted_qty stays
-- visible (admin is allowed to see what they typed). Once status flips out
-- of in_progress, all fields return as normal — counts are frozen and
-- transparency post-input is the MSME design intent.
--
-- Default-deny: if admin_users role lookup returns NULL/error, COALESCE
-- compares with '' which never equals 'Owner', so mask kicks in.
--
-- Note: warehouse column is text (legacy 'atas'/'bawah') — Phase 3 cutover
-- (warehouse_id UUID) is pending 24h soak and will update these RPCs
-- separately when applied.

CREATE OR REPLACE FUNCTION public.fetch_opname_counts(p_session_id BIGINT)
RETURNS TABLE (
  session_id          BIGINT,
  sku                 TEXT,
  warehouse           TEXT,
  system_qty_snapshot INTEGER,
  counted_qty         INTEGER,
  variance            INTEGER,
  variance_value      NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_status public.opname_status;
  v_caller_role    TEXT;
  v_mask           BOOLEAN;
BEGIN
  SELECT status INTO v_session_status
    FROM stock_opname_sessions WHERE id = p_session_id;

  SELECT role INTO v_caller_role
    FROM admin_users WHERE id = auth.uid();

  v_mask := (v_session_status = 'in_progress'
             AND COALESCE(v_caller_role, '') <> 'Owner');

  RETURN QUERY
    SELECT
      c.session_id, c.sku, c.warehouse,
      CASE WHEN v_mask THEN NULL ELSE c.system_qty_snapshot END,
      c.counted_qty,
      CASE WHEN v_mask THEN NULL ELSE c.variance END,
      CASE WHEN v_mask THEN 0::NUMERIC ELSE c.variance_value END
    FROM stock_opname_counts c
    WHERE c.session_id = p_session_id;
END $$;

GRANT EXECUTE ON FUNCTION public.fetch_opname_counts(BIGINT) TO authenticated;


CREATE OR REPLACE FUNCTION public.get_opname_session(p_session_id BIGINT)
RETURNS TABLE (
  id                      BIGINT,
  opname_type             public.opname_type,
  scope_payload           JSONB,
  counted_by_user_id      UUID,
  witnessed_by_user_id    UUID,
  witness_acknowledged_at TIMESTAMPTZ,
  status                  public.opname_status,
  variance_total_value    NUMERIC,
  approval_request_id     BIGINT,
  started_at              TIMESTAMPTZ,
  submitted_at            TIMESTAMPTZ,
  committed_at            TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
BEGIN
  SELECT role INTO v_caller_role FROM admin_users WHERE id = auth.uid();

  RETURN QUERY
    SELECT
      s.id, s.opname_type, s.scope_payload,
      s.counted_by_user_id, s.witnessed_by_user_id,
      s.witness_acknowledged_at, s.status,
      CASE
        WHEN s.status = 'in_progress' AND COALESCE(v_caller_role,'') <> 'Owner'
        THEN 0::NUMERIC
        ELSE s.variance_total_value
      END,
      s.approval_request_id, s.started_at, s.submitted_at, s.committed_at
    FROM stock_opname_sessions s
    WHERE s.id = p_session_id;
END $$;

GRANT EXECUTE ON FUNCTION public.get_opname_session(BIGINT) TO authenticated;
