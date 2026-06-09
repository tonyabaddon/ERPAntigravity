-- =====================================================================
-- Phase 4 — Pengawasan View 4 (Task 4): v_pengawasan_transfer_aging.
--
-- Flags warehouse_transfers rows still in `initiated` status more than
-- 24 hours after `initiated_at`. Surfaces the "transfer sat in transit,
-- never confirmed by the receiver" risk — a vector for stock to vanish
-- between warehouses while no single row looks suspicious in isolation.
--
-- Math:
--   hours_pending = EXTRACT(EPOCH FROM (now() - initiated_at)) / 3600
--   flagged when   status = 'initiated' AND initiated_at < now() - INTERVAL '24 hours'
--
-- Design notes:
--   - warehouse_transfers is owned by Phase 3d. Phase 4 ships a minimal
--     stub here (CREATE TABLE IF NOT EXISTS) so the view compiles and
--     tests can seed rows. Phase 3d's migration will extend the table
--     with additional columns + RPCs without conflicting with this stub
--     (the CHECK / NOT NULL set covers only the columns the view reads).
--   - No FKs on stub — the view does not join `stocks` or `admin_users`,
--     so referencing missing rows is fine and tests stay self-contained.
--   - No ORDER BY in the view — Phase 4 convention (see T3 outflow_outliers).
--     Consumers (dashboard, poller) sort by `hours_pending DESC` at query time.
-- =====================================================================

-- Stub table — Phase 3d will extend with the RPC-facing columns
-- (received_at, received_by_user_id, dispute_*, etc.). IF NOT EXISTS so the
-- later Phase 3d migration that owns the full schema does not conflict.
CREATE TABLE IF NOT EXISTS public.warehouse_transfers (
  id                        BIGSERIAL PRIMARY KEY,
  sku                       TEXT NOT NULL,
  from_warehouse            TEXT NOT NULL CHECK (from_warehouse IN ('atas','bawah')),
  to_warehouse              TEXT NOT NULL CHECK (to_warehouse  IN ('atas','bawah')),
  initiated_qty             INTEGER NOT NULL,
  initiated_by_user_id      UUID NOT NULL,
  intended_receiver_user_id UUID NOT NULL,
  initiated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  status                    TEXT NOT NULL DEFAULT 'initiated'
                            CHECK (status IN ('initiated','received','disputed','cancelled'))
);

CREATE OR REPLACE VIEW public.v_pengawasan_transfer_aging AS
SELECT
  wt.id,
  wt.sku,
  wt.from_warehouse,
  wt.to_warehouse,
  wt.initiated_qty,
  wt.initiated_by_user_id,
  wt.intended_receiver_user_id,
  wt.initiated_at,
  EXTRACT(EPOCH FROM (now() - wt.initiated_at)) / 3600.0 AS hours_pending
FROM public.warehouse_transfers wt
WHERE wt.status = 'initiated'
  AND wt.initiated_at < now() - INTERVAL '24 hours';

GRANT SELECT ON public.v_pengawasan_transfer_aging TO authenticated;
