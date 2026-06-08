-- =====================================================================
-- Phase 4 — Pengawasan views. Read-only, computed from existing tables.
--
-- Phase 1 used 001-005 and Phase 2/3 reserved 006-049. Phase 4 starts at
-- 050 to leave headroom for late additions to earlier phases.
--
-- These views power the Owner anomaly dashboard. They are SELECT-only and
-- granted to authenticated; no writes ever flow through this surface.
-- =====================================================================

-- View 1 (Phase 4 Task 1): Top committed stock adjustments ranked by absolute
-- rupiah value. Only committed_at IS NOT NULL rows are included — pending
-- adjustments do not represent realized stock movement and would distort the
-- ranking before the Owner approves them.
--
-- value_rp = ABS(qty_delta) * COALESCE(harga_modal, 0). Cast to numeric so the
-- product remains numeric even when qty_delta is INTEGER. COALESCE keeps the
-- value at 0 for SKUs without harga_modal set (rather than NULL collapsing
-- the row in ORDER BY).
CREATE OR REPLACE VIEW public.v_pengawasan_top_adjustments AS
SELECT
  sa.id,
  sa.sku,
  s.name                                                    AS sku_name,
  sa.warehouse,
  sa.qty_delta,
  sa.reason_code,
  sa.reason_note,
  sa.evidence_urls,
  ABS(sa.qty_delta)::numeric * COALESCE(s.harga_modal, 0)   AS value_rp,
  sa.requested_by,
  au.name                                                   AS actor_name,
  sa.requested_at,
  sa.committed_at,
  sa.status
FROM public.stock_adjustments sa
JOIN public.stocks            s  ON s.sku = sa.sku
LEFT JOIN public.admin_users  au ON au.id = sa.requested_by
WHERE sa.committed_at IS NOT NULL
ORDER BY value_rp DESC;

GRANT SELECT ON public.v_pengawasan_top_adjustments TO authenticated;
