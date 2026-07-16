-- Migration 305: Composite PK (tenant_id, id) for journal_entry_lines
--
-- Rationale: partition-readiness for future (tenant_id, time_bucket) partitioning.
-- At current row count (~687 rows) this is seconds. At 10M+ rows it would be weeks.
--
-- Pre-flight checks passed:
--   - tenant_id: NOT NULL, zero NULL rows
--   - no inbound FKs referencing journal_entry_lines.id (only outbound FKs to
--     chart_of_accounts and journal_entries — these are unaffected by PK change)
--   - no tenant-agnostic id-only lookups found in RPC bodies or src/
--
-- The existing UNIQUE(entry_id, line_number) constraint is preserved as-is.
-- Outbound FKs (entry_id → journal_entries, account_id → chart_of_accounts) are
-- unaffected — they reference OTHER tables' PKs, not this table's PK.
--
-- Rollback: DROP CONSTRAINT journal_entry_lines_pkey; ADD PRIMARY KEY (id);
--
-- Idempotent: uses DROP CONSTRAINT IF EXISTS throughout.

BEGIN;

-- Step 1: Drop existing single-column PK
ALTER TABLE public.journal_entry_lines
  DROP CONSTRAINT IF EXISTS journal_entry_lines_pkey;

-- Step 2: Add composite PK — (tenant_id, id)
--         tenant_id is uuid NOT NULL; id is uuid NOT NULL (gen_random_uuid()).
--         UUID ids are globally unique — the composite PK also serves as an index
--         for (tenant_id, id) scoped lookups, which is the correct partition prefix.
ALTER TABLE public.journal_entry_lines
  ADD CONSTRAINT journal_entry_lines_pkey PRIMARY KEY (tenant_id, id);

COMMIT;
