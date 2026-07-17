-- P2-C Round 2 — Migration 324: Add tenant_id to audit_log
--
-- audit_log was created in 20260614000003 with no tenant_id column.
-- Queries currently require joining actor_user_id → admin_users to find tenant,
-- which is (a) unindexed, (b) misses system-actor events, (c) doesn't support
-- platform-wide events without a synthetic actor row.
--
-- Non-breaking: column is nullable. Existing rows stay NULL (no backfill).
-- Future audit INSERTs (Items 3-5 in migration 325) set tenant_id explicitly.
-- Pre-P2-C rows and genuine platform-wide events remain NULL by design.
--
-- Index: partial (WHERE tenant_id IS NOT NULL) keeps the index lean for queries
-- that filter by tenant, while not indexing the NULL-heavy pre-P2-C rows.

ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS tenant_id uuid;

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_created
    ON public.audit_log (tenant_id, created_at DESC)
    WHERE tenant_id IS NOT NULL;

COMMENT ON COLUMN public.audit_log.tenant_id IS
    'P2-C (2026-07-17): tenant scope for forensic queries. NULL for pre-P2-C rows and platform-wide events.';
