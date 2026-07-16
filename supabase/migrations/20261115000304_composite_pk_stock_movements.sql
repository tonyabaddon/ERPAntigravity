-- Migration 304: Composite PK (tenant_id, id) for stock_movements
--
-- Rationale: partition-readiness for future (tenant_id, time_bucket) partitioning.
-- At current row count (~1.5K rows) this is seconds. At 10M+ rows it would be weeks.
--
-- Pre-flight checks passed:
--   - tenant_id: NOT NULL, zero NULL rows
--   - cross-tenant FK violations: 0 (stock_adjustments ↔ stock_movements, self-ref)
--   - no tenant-agnostic id-only lookups found in RPC bodies or src/
--
-- FK plan:
--   - stock_adjustments.committed_movement_id → upgraded to composite (tenant_id, committed_movement_id)
--   - stock_movements.related_movement_id → upgraded to composite (tenant_id, related_movement_id)
--   Both tables already carry NOT NULL tenant_id, zero cross-tenant violations confirmed.
--
-- Rollback: DROP CONSTRAINT stock_movements_pkey; ADD PRIMARY KEY (id);
--           restore single-column FKs on committed_movement_id + related_movement_id.
--
-- Idempotent: uses DROP CONSTRAINT IF EXISTS throughout.

BEGIN;

-- Step 1: Drop FKs that reference stock_movements(id) — they target the old single-col PK.
--         stock_adjustments.committed_movement_id → stock_movements(id)
ALTER TABLE public.stock_adjustments
  DROP CONSTRAINT IF EXISTS stock_adjustments_committed_movement_id_fkey;

--         stock_movements.related_movement_id → stock_movements(id) (self-ref)
ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_related_movement_id_fkey;

-- Step 2: Drop existing single-column PK
ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_pkey;

-- Step 3: Add composite PK — (tenant_id, id)
--         tenant_id is uuid NOT NULL; id is bigint NOT NULL (nextval sequence).
--         The PK btree index on (tenant_id, id) serves tenant-scoped id lookups
--         and is the correct partition key prefix for future partitioning.
ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (tenant_id, id);

-- Step 4: Re-add FKs with composite references for tenant integrity enforcement.

--         stock_movements self-ref: (tenant_id, related_movement_id) → (tenant_id, id)
--         NULL-safe: related_movement_id IS nullable, FK only fires when non-NULL.
ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_related_movement_id_fkey
    FOREIGN KEY (tenant_id, related_movement_id)
    REFERENCES public.stock_movements (tenant_id, id)
    ON DELETE SET NULL;

--         stock_adjustments: (tenant_id, committed_movement_id) → stock_movements(tenant_id, id)
--         NULL-safe: committed_movement_id IS nullable.
ALTER TABLE public.stock_adjustments
  ADD CONSTRAINT stock_adjustments_committed_movement_id_fkey
    FOREIGN KEY (tenant_id, committed_movement_id)
    REFERENCES public.stock_movements (tenant_id, id)
    ON DELETE SET NULL;

COMMIT;
