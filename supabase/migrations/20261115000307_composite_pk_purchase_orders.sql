-- Migration 307: Composite PK (tenant_id, id) for purchase_orders
--
-- Rationale: partition-readiness for future (tenant_id, time_bucket) partitioning.
-- At 290 rows this takes seconds. At 10M+ rows it would be weeks.
--
-- Pre-flight checks passed (2026-07-17):
--   - tenant_id: NOT NULL, zero NULL rows on purchase_orders + all child tables
--   - cross-tenant FK violations: 0 (purchase_order_items, stock_lots)
--   - purchase_order_items.tenant_id: NOT NULL ✓
--   - stock_lots.tenant_id: NOT NULL ✓
--
-- FK plan:
--   - purchase_order_items.po_id → upgraded to composite (tenant_id, po_id)
--   - stock_lots.po_id          → upgraded to composite (tenant_id, po_id)
--   Both child tables carry NOT NULL tenant_id, zero cross-tenant violations confirmed.
--
-- Rollback: DROP CONSTRAINT purchase_orders_pkey; ADD PRIMARY KEY (id);
--           restore single-column FKs on po_id in purchase_order_items + stock_lots.
--
-- Idempotent: uses DROP CONSTRAINT IF EXISTS throughout.

BEGIN;

-- Step 1: Drop inbound FKs that reference purchase_orders(id) — old single-col PK.

ALTER TABLE public.purchase_order_items
  DROP CONSTRAINT IF EXISTS purchase_order_items_po_id_fkey;

ALTER TABLE public.stock_lots
  DROP CONSTRAINT IF EXISTS stock_lots_po_id_fkey;

-- Step 2: Drop existing single-column PK.
ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_pkey;

-- Step 3: Add composite PK — (tenant_id, id).
--         tenant_id is uuid NOT NULL; id is uuid NOT NULL (gen_random_uuid()).
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (tenant_id, id);

-- Step 4: Re-add FKs with composite references for tenant integrity enforcement.

--         purchase_order_items: (tenant_id, po_id) → purchase_orders(tenant_id, id)
--         Preserves ON DELETE CASCADE from original definition.
ALTER TABLE public.purchase_order_items
  ADD CONSTRAINT purchase_order_items_po_id_fkey
    FOREIGN KEY (tenant_id, po_id)
    REFERENCES public.purchase_orders (tenant_id, id)
    ON DELETE CASCADE;

--         stock_lots: (tenant_id, po_id) → purchase_orders(tenant_id, id)
--         po_id is nullable (stock_lots can exist without a PO).
--         Original FK had no ON DELETE action (default RESTRICT). Preserving that.
ALTER TABLE public.stock_lots
  ADD CONSTRAINT stock_lots_po_id_fkey
    FOREIGN KEY (tenant_id, po_id)
    REFERENCES public.purchase_orders (tenant_id, id);

-- Step 5: Covering indexes for the composite FK columns (advisor will flag these otherwise).

-- purchase_order_items: covering index on (tenant_id, po_id) for JOIN efficiency.
-- pesanan_items_pesanan_idx already existed as single-col; this supersedes for tenant-scoped joins.
CREATE INDEX IF NOT EXISTS idx_poi_tenant_po
  ON public.purchase_order_items (tenant_id, po_id);

-- stock_lots: covering index on (tenant_id, po_id) for JOIN efficiency.
CREATE INDEX IF NOT EXISTS idx_sl_tenant_po
  ON public.stock_lots (tenant_id, po_id)
  WHERE po_id IS NOT NULL;

COMMIT;
