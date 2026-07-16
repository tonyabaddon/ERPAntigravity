-- Migration 308: Composite PK (tenant_id, id) for purchase_invoices
--
-- Rationale: partition-readiness for future (tenant_id, time_bucket) partitioning.
-- At 40 rows this takes seconds. At 10M+ rows it would be weeks.
--
-- Pre-flight checks passed (2026-07-17):
--   - tenant_id: NOT NULL, zero NULL rows on purchase_invoices + all child tables
--   - cross-tenant FK violations: 0 (purchase_invoice_items, pembayaran_items.tagihan_id)
--   - purchase_invoice_items.tenant_id: NOT NULL ✓
--   - pembayaran_items.tenant_id: NOT NULL ✓
--
-- FK plan:
--   - purchase_invoice_items.pi_id → upgraded to composite (tenant_id, pi_id)
--   - pembayaran_items.tagihan_id  → upgraded to composite (tenant_id, tagihan_id)
--   Both child tables carry NOT NULL tenant_id, zero cross-tenant violations confirmed.
--
-- Note: purchase_invoices.pesanan_id is an OUTBOUND FK (to pesanan), not inbound.
-- It is unaffected by this PK change.
--
-- Rollback: DROP CONSTRAINT purchase_invoices_pkey; ADD PRIMARY KEY (id);
--           restore single-column FKs on pi_id + tagihan_id.
--
-- Idempotent: uses DROP CONSTRAINT IF EXISTS throughout.

BEGIN;

-- Step 1: Drop inbound FKs that reference purchase_invoices(id) — old single-col PK.

ALTER TABLE public.purchase_invoice_items
  DROP CONSTRAINT IF EXISTS purchase_invoice_items_pi_id_fkey;

ALTER TABLE public.pembayaran_items
  DROP CONSTRAINT IF EXISTS pembayaran_items_tagihan_id_fkey;

-- Step 2: Drop existing single-column PK.
ALTER TABLE public.purchase_invoices
  DROP CONSTRAINT IF EXISTS purchase_invoices_pkey;

-- Step 3: Add composite PK — (tenant_id, id).
--         tenant_id is uuid NOT NULL; id is uuid NOT NULL (gen_random_uuid()).
ALTER TABLE public.purchase_invoices
  ADD CONSTRAINT purchase_invoices_pkey PRIMARY KEY (tenant_id, id);

-- Step 4: Re-add FKs with composite references for tenant integrity enforcement.

--         purchase_invoice_items: (tenant_id, pi_id) → purchase_invoices(tenant_id, id)
--         Preserves ON DELETE CASCADE from original definition.
ALTER TABLE public.purchase_invoice_items
  ADD CONSTRAINT purchase_invoice_items_pi_id_fkey
    FOREIGN KEY (tenant_id, pi_id)
    REFERENCES public.purchase_invoices (tenant_id, id)
    ON DELETE CASCADE;

--         pembayaran_items: (tenant_id, tagihan_id) → purchase_invoices(tenant_id, id)
--         tagihan_id is nullable (pembayaran_items can exist without a tagihan).
--         Preserves ON DELETE RESTRICT from original definition.
ALTER TABLE public.pembayaran_items
  ADD CONSTRAINT pembayaran_items_tagihan_id_fkey
    FOREIGN KEY (tenant_id, tagihan_id)
    REFERENCES public.purchase_invoices (tenant_id, id)
    ON DELETE RESTRICT;

-- Step 5: Covering indexes for the composite FK columns.

-- purchase_invoice_items: covering index on (tenant_id, pi_id) for JOIN efficiency.
CREATE INDEX IF NOT EXISTS idx_pii_tenant_pi
  ON public.purchase_invoice_items (tenant_id, pi_id);

-- pembayaran_items: covering index on (tenant_id, tagihan_id) for JOIN efficiency.
-- Existing single-col index pembayaran_items_tagihan_idx preserved; this adds composite.
CREATE INDEX IF NOT EXISTS idx_pmi_tenant_tagihan
  ON public.pembayaran_items (tenant_id, tagihan_id)
  WHERE tagihan_id IS NOT NULL;

COMMIT;
