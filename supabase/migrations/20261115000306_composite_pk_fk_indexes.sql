-- Migration 306: Covering indexes for composite FKs added in migration 304
--
-- Advisors flagged stock_movements_related_movement_id_fkey as unindexed after
-- the composite PK migration in slot 304. Two new composite FKs were created:
--   1. stock_movements(tenant_id, related_movement_id) → stock_movements(tenant_id, id)
--   2. stock_adjustments(tenant_id, committed_movement_id) → stock_movements(tenant_id, id)
-- Both need covering indexes on the FK columns for JOIN efficiency.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS.

-- Index for self-referential FK on stock_movements
CREATE INDEX IF NOT EXISTS idx_sm_related_movement
  ON public.stock_movements (tenant_id, related_movement_id)
  WHERE related_movement_id IS NOT NULL;

-- Index for FK from stock_adjustments to stock_movements
CREATE INDEX IF NOT EXISTS idx_sa_committed_movement
  ON public.stock_adjustments (tenant_id, committed_movement_id)
  WHERE committed_movement_id IS NOT NULL;
