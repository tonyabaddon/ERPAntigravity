# Composite PK on audit_log + pembayaran — decision memo

## Context
audit_log currently PK `(id)`, pembayaran currently PK `(id)`. CLAUDE.md
scale-forward names both as high-volume. At 10M+ rows, altering PK requires
hours of exclusive lock. Cheap now (audit_log 210 rows, pembayaran 9 rows,
verified pre-migration 2026-07-20 via Management API `count(*)`).

## Decision
Migrate to composite PK `(tenant_id, id)` on both. Enables future partition
BY `(tenant_id)` or `(tenant_id, created_at MONTH)` without further PK changes.

## Alternatives considered
- Do nothing → paint into corner at 10M rows. Rejected.
- Partition now → over-engineering at current scale. Deferred to 10M+ row event.
- Change only audit_log (skip pembayaran) → inconsistent, pembayaran also needs
  partition-ready. Rejected.

## Consequences
- Reversibility: fully reversible (DROP composite + ADD single-col PK). Backup
  FK definition first.
- Blast radius: pembayaran has FK from pembayaran_items → migration must handle
  (drop FK → drop PK → add composite PK → re-add composite FK). Verified via
  `pg_constraint` scan on 2026-07-20 that this is the ONLY inbound FK to either
  table (besides tenants FKs from each which target `tenants(id)` and are not
  affected).
- Migration path: DROP FK → DROP PK → ADD composite PK → RE-ADD composite FK.
- REPLICA IDENTITY: both tables verified DEFAULT (not `USING INDEX <pkey>`) via
  `pg_class.relreplident` on 2026-07-20; safe to DROP PK without touching
  logical replication settings.

## Scale ceiling check
1. **Ceiling at 10×**: composite PK btree grows linearly. 100M rows = ~5GB
   index. Acceptable.
2. **Hot path**: reads by `(tenant_id, id)` — composite PK ideal. Reads by
   `id` alone RARE (verified 2026-07-20: `grep -rn -E "(pembayaran|audit_log).*WHERE.*\bid\s*="`
   on `backend-go/` = 0 hits; `.from('pembayaran'|'audit_log')` queries in
   `src/` all filter by `event_type`, `pembayaran_number`, `supplier_id`, or
   are covered by RLS auto-injection of `tenant_id`; no bare `.eq('id', ...)`
   without tenant context found). [VERIFIED]
3. **Partition-ready**: yes — composite PK enables `PARTITION BY (tenant_id)`
   or `(tenant_id, created_at)`.
4. **Idempotency**: migration guarded with pg_index shape check (attname array
   compared against `ARRAY['tenant_id','id']`). Safe re-run.
5. **Long ops**: sub-second at current data volume (210 + 9 rows). Non-issue.
6. **Cost curve**: flat per-tenant.

## Follow-up work
- At 10M+ audit_log rows: add PARTITION BY RANGE (created_at monthly). Separate
  design memo.
- At 10M+ pembayaran rows: consider PARTITION BY (tenant_id) hash. Separate
  memo.
- **Advisor `unindexed_foreign_keys` on `pembayaran_items(tenant_id, pembayaran_id)`**
  (INFO-level, new-caused by this migration). Existing
  `pembayaran_items_pembayaran_idx (pembayaran_id)` covers the trailing FK
  column so Postgres can still enforce `ON DELETE CASCADE` efficiently; at
  9 rows there is zero perf impact. When pembayaran_items nears ~1M rows,
  add `CREATE INDEX CONCURRENTLY idx_pmi_tenant_pembayaran ON pembayaran_items
  (tenant_id, pembayaran_id);` in a separate migration slot to clear the
  advisor.
