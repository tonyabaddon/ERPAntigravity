-- Migration 309: Composite PK (tenant_id, id) for journal_entries
--
-- Rationale: partition-readiness for future (tenant_id, time_bucket) partitioning.
-- At 295 rows this takes seconds. At 10M+ rows it would be weeks.
-- journal_entries is the core GL ledger — gets one row per business event.
--
-- Pre-flight checks passed (2026-07-17):
--   - tenant_id: NOT NULL, zero NULL rows on journal_entries + all child tables
--   - cross-tenant FK violations: 0
--     * journal_entry_lines.entry_id: 0 violations
--     * journal_entries self-ref (reverses_entry_id, reversed_by_entry_id): 0 violations
--     * supplier_claim_events.journal_entry_id: 0 violations
--     * supplier_claims.create_journal_id: 0 violations
--     * supplier_claims.resolution_journal_id: 0 violations
--   - All child tables carry NOT NULL tenant_id ✓
--
-- FK plan (all inbound FKs referencing journal_entries.id):
--   1. journal_entries self-ref: reverses_entry_id    → composite (tenant_id, reverses_entry_id)
--   2. journal_entries self-ref: reversed_by_entry_id → composite (tenant_id, reversed_by_entry_id)
--   3. journal_entry_lines.entry_id                   → composite (tenant_id, entry_id)
--   4. supplier_claim_events.journal_entry_id         → composite (tenant_id, journal_entry_id)
--   5. supplier_claims.create_journal_id              → composite (tenant_id, create_journal_id)
--   6. supplier_claims.resolution_journal_id          → composite (tenant_id, resolution_journal_id)
--
-- Note: journal_entries_posted_by_fkey references auth.users — unaffected (outbound FK).
--
-- Rollback: DROP CONSTRAINT journal_entries_pkey; ADD PRIMARY KEY (id);
--           restore all single-column FKs in order.
--
-- Idempotent: uses DROP CONSTRAINT IF EXISTS throughout.

BEGIN;

-- =========================================================================
-- Step 1: Drop ALL inbound FKs referencing journal_entries(id).
--         Must drop before dropping the PK constraint.
-- =========================================================================

-- Self-referential FKs on journal_entries itself.
ALTER TABLE public.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_reverses_entry_id_fkey;

ALTER TABLE public.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_reversed_by_entry_id_fkey;

-- journal_entry_lines → journal_entries
ALTER TABLE public.journal_entry_lines
  DROP CONSTRAINT IF EXISTS journal_entry_lines_entry_id_fkey;

-- supplier_claim_events → journal_entries
ALTER TABLE public.supplier_claim_events
  DROP CONSTRAINT IF EXISTS supplier_claim_events_journal_entry_id_fkey;

-- supplier_claims → journal_entries (two FKs)
ALTER TABLE public.supplier_claims
  DROP CONSTRAINT IF EXISTS supplier_claims_create_journal_id_fkey;

ALTER TABLE public.supplier_claims
  DROP CONSTRAINT IF EXISTS supplier_claims_resolution_journal_id_fkey;

-- =========================================================================
-- Step 2: Drop existing single-column PK.
-- =========================================================================
ALTER TABLE public.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_pkey;

-- =========================================================================
-- Step 3: Add composite PK — (tenant_id, id).
--         tenant_id is uuid NOT NULL; id is uuid NOT NULL (gen_random_uuid()).
-- =========================================================================
ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_pkey PRIMARY KEY (tenant_id, id);

-- =========================================================================
-- Step 4: Re-add FKs with composite references for tenant integrity.
-- =========================================================================

-- Self-referential: reverses_entry_id → (tenant_id, id)
-- reverses_entry_id is nullable; FK only fires when non-NULL.
-- Preserves ON DELETE SET NULL from original definition.
ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_reverses_entry_id_fkey
    FOREIGN KEY (tenant_id, reverses_entry_id)
    REFERENCES public.journal_entries (tenant_id, id)
    ON DELETE SET NULL;

-- Self-referential: reversed_by_entry_id → (tenant_id, id)
-- reversed_by_entry_id is nullable; FK only fires when non-NULL.
-- Preserves ON DELETE SET NULL from original definition.
ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_reversed_by_entry_id_fkey
    FOREIGN KEY (tenant_id, reversed_by_entry_id)
    REFERENCES public.journal_entries (tenant_id, id)
    ON DELETE SET NULL;

-- journal_entry_lines: (tenant_id, entry_id) → journal_entries(tenant_id, id)
-- Preserves ON DELETE CASCADE from original definition.
ALTER TABLE public.journal_entry_lines
  ADD CONSTRAINT journal_entry_lines_entry_id_fkey
    FOREIGN KEY (tenant_id, entry_id)
    REFERENCES public.journal_entries (tenant_id, id)
    ON DELETE CASCADE;

-- supplier_claim_events: (tenant_id, journal_entry_id) → journal_entries(tenant_id, id)
-- journal_entry_id is nullable. Original FK had no ON DELETE action (default RESTRICT).
ALTER TABLE public.supplier_claim_events
  ADD CONSTRAINT supplier_claim_events_journal_entry_id_fkey
    FOREIGN KEY (tenant_id, journal_entry_id)
    REFERENCES public.journal_entries (tenant_id, id);

-- supplier_claims: (tenant_id, create_journal_id) → journal_entries(tenant_id, id)
-- create_journal_id is nullable. Original FK had no ON DELETE action (default RESTRICT).
ALTER TABLE public.supplier_claims
  ADD CONSTRAINT supplier_claims_create_journal_id_fkey
    FOREIGN KEY (tenant_id, create_journal_id)
    REFERENCES public.journal_entries (tenant_id, id);

-- supplier_claims: (tenant_id, resolution_journal_id) → journal_entries(tenant_id, id)
-- resolution_journal_id is nullable. Original FK had no ON DELETE action (default RESTRICT).
ALTER TABLE public.supplier_claims
  ADD CONSTRAINT supplier_claims_resolution_journal_id_fkey
    FOREIGN KEY (tenant_id, resolution_journal_id)
    REFERENCES public.journal_entries (tenant_id, id);

-- =========================================================================
-- Step 5: Covering indexes for composite FK columns.
--         The existing idx_jel_entry covers single-col entry_id — we add a
--         composite covering index for tenant-scoped entry lookups.
-- =========================================================================

-- journal_entry_lines: composite covering index on (tenant_id, entry_id).
CREATE INDEX IF NOT EXISTS idx_jel_tenant_entry
  ON public.journal_entry_lines (tenant_id, entry_id);

-- journal_entries self-ref reversal pair: composite index for reverse lookup.
CREATE INDEX IF NOT EXISTS idx_je_tenant_reverses
  ON public.journal_entries (tenant_id, reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_je_tenant_reversed_by
  ON public.journal_entries (tenant_id, reversed_by_entry_id)
  WHERE reversed_by_entry_id IS NOT NULL;

-- supplier_claim_events: composite covering index on (tenant_id, journal_entry_id).
CREATE INDEX IF NOT EXISTS idx_sce_tenant_je
  ON public.supplier_claim_events (tenant_id, journal_entry_id)
  WHERE journal_entry_id IS NOT NULL;

-- supplier_claims: composite covering indexes on journal FK columns.
CREATE INDEX IF NOT EXISTS idx_sc_tenant_create_journal
  ON public.supplier_claims (tenant_id, create_journal_id)
  WHERE create_journal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sc_tenant_resolution_journal
  ON public.supplier_claims (tenant_id, resolution_journal_id)
  WHERE resolution_journal_id IS NOT NULL;

COMMIT;
