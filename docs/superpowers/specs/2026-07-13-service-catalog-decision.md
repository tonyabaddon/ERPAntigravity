# Service Catalog: Irreversible Decisions Memo

**Date:** 2026-07-13
**Related spec:** [2026-07-13-service-catalog-design.md](./2026-07-13-service-catalog-design.md)

Per CLAUDE.md scale-forward architecture rules, irreversible decisions require a decision memo before implementation.

Two irreversible decisions in the Service Catalog design:

1. **PK shape `(tenant_id, id)` composite on `order_service_lines`** (extended `rakit_job_lines`)
2. **BOM snapshot pattern** (freeze at commit, no historical reference to master)

Both commit to data model contracts that clients rely on. Changing them after go-live requires either a breaking migration or shipping code that reads both old + new formats.

---

## Decision 1: Composite PK `(tenant_id, id)` — Partition-Ready

### Context

`order_service_lines` (extended `rakit_job_lines`) growth curve:
- 10 tenants × 100 orders/tenant × 1 service line avg = 1K rows
- 100 tenants × 500 orders/tenant × 1.5 service lines avg = 75K rows
- 1K tenants × 1K orders/tenant × 2 service lines avg = 2M rows
- 10K tenants × 10K orders/tenant × 2 service lines avg = 200M rows

At 10× scale we hit the "10M rows partition trigger" from CLAUDE.md. This table is a hot write path (every deliver + every reverse touches it) and a hot read path (reporting per service).

### Decision

Use composite PK `(tenant_id, id)` on `order_service_lines`.

Concretely: add `tenant_id` column (existing), keep `id UUID`, but replace `PRIMARY KEY (id)` with `PRIMARY KEY (tenant_id, id)`.

FK from `rakit_components` also composite: `(tenant_id, rakit_job_line_id)`.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| `PRIMARY KEY (id)` only | Cannot partition by tenant later without breaking PK contract; every partition swap = downtime |
| `PRIMARY KEY (id)` + `PARTITION BY hash(id)` | Loses tenant locality (queries scan all partitions); indexes larger; RLS filter can't use partition pruning |
| Add composite PK later (migration when needed) | Requires breaking migration on 10M+ row table; foreign keys to migrate; RLS predicates to rewrite; no zero-downtime path |
| Separate physical table per tenant | Explosion of migration count; RLS still needed; joins across tenant boundaries impossible for platform admin queries |

### Consequences

**Reversibility cost:** High. Once we ship composite PK to production, changing back means dropping PK on a growing table + rewriting all FKs — hours of downtime.

**Blast radius:** Small at write time — inserts still keyed by generated UUID, uniqueness preserved. Larger at query time — RPCs must pass tenant_id explicitly in WHERE clauses; PostgREST auto-fills via RLS predicate.

**Migration path if we need to undo:** Sequential: (1) create parallel single-PK table, (2) dual-write, (3) backfill, (4) cutover reads, (5) drop old. Multi-week project on a large table.

### Scale ceiling check

1. **What breaks first at 10×?** Nothing under this design — partition trigger is (tenant_id, cutover_date) or hash(tenant_id), both aligned with composite PK.
2. **Hot path?** Reporting query `WHERE tenant_id = X AND created_at > Y GROUP BY service_catalog_id`. Composite PK + index on `(tenant_id, is_active, category)` on catalog + index on `(tenant_id, created_at)` on order_service_lines cover it.
3. **Partition-ready?** Yes — composite PK enables `PARTITION BY LIST (tenant_id)` or `PARTITION BY hash(tenant_id)` without breaking constraints.
4. **Idempotency?** RPC `attach_service_to_order` uses natural unique key `(order_id, service_catalog_id, sequence)`. Retry-safe.
5. **Long ops?** FIFO decrement per component × qty — bounded per order (few dozen components × few units). Sub-second even at scale.
6. **Cost curve?** Flat per tenant. No cross-tenant scanning. Reporting scales with per-tenant activity, not total system size.

### Follow-up work

- Ensure all new RPCs include tenant_id in WHERE clauses (via `_resolve_tenant_id()`), not just relying on RLS.
- When we ship partitioning (post-10K tenants), plan for `PARTITION BY hash(tenant_id, 8)` initial split.
- Observability metric: track P95 query time on order_service_lines reads to trigger partition earlier if hot.

---

## Decision 2: BOM Snapshot Pattern (Freeze at Commit)

### Context

BOM master (`service_catalog_bom`) can change anytime — owner tweaks komponen, adjusts qty, adds/removes items. If historical orders reference master directly, past reports "shift" as master evolves. Customer invoice from 6 months ago wouldn't reproduce same BOM breakdown.

Alternative: pass BOM by reference, store master version. Or: freeze snapshot at commit.

### Decision

Freeze BOM snapshot at order commit into `rakit_components` (with per-component `service_catalog_bom_id` optional link + `qty` frozen + `unit_cost_at_delivery` populated at deliver).

Historical order queries never join back to `service_catalog_bom` for BOM detail. All BOM data self-contained in snapshot.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Pass-by-reference (join to master) | Master evolves, historical reports become inconsistent; invoice regeneration impossible after BOM edit |
| Version master with `bom_version` column + point historical to specific version | Complex versioning logic; owner UX confusing ("edit will bump version"); harder to reason about; still requires snapshot at delivery for `unit_cost_at_delivery` |
| Copy BOM at quote → immutable → order upgrades quote | Wasted storage on abandoned quotes; less flexibility for order edits pre-commit |

### Consequences

**Reversibility cost:** Medium-high. Once snapshot pattern shipped and orders committed, we can add master-version fallback later BUT existing snapshots stay frozen. Cannot "unfreeze" without invalidating historical audit trail.

**Blast radius:** Small storage impact — snapshot is small copy (5-20 rows per order). Big benefit: reporting/invoice/audit stays consistent forever.

**Migration path if we need to undo:** No clean path. If we ever need to shift to reference-mode, we'd need to reconstruct master versions retroactively — impossible for edits that already lost history.

### Scale ceiling check

1. **What breaks first at 10×?** Storage grows linearly with orders. At 10K tenants × 10K orders × 10 components snapshot = 1B rows. Needs partitioning aligned with parent order (see Decision 1).
2. **Hot path?** Deliver RPC writes 5-20 snapshot rows per order — bounded. Reporting reads snapshot per order — bounded per query.
3. **Partition-ready?** Yes — snapshot table follows same `(tenant_id, id)` composite PK strategy as parent order line.
4. **Idempotency?** `attach_service_to_order` snapshots BOM once; re-attach fails on natural unique key.
5. **Long ops?** Snapshot copy is sync within order-commit transaction. Sub-second.
6. **Cost curve?** Linear with orders. Consistent with rest of system.

### Follow-up work

- Ensure snapshot copy happens **inside the transaction** with order commit — no lazy population risk.
- Add `snapshot_frozen_at` timestamp for audit clarity.
- When we ever need master-version tracking (post-MVP), add `service_catalog_bom.version` + `service_catalog_bom_snapshot.master_version_at_snapshot` — additive schema change compatible with snapshot pattern.

---

## Rejected: Making These Configurable

For both decisions we considered "make it configurable per tenant" — e.g., let tenant choose snapshot vs reference mode. Rejected because:

- Configurable = 2× code paths to maintain
- Migration between modes still lossy for the snapshot case
- Configurability without demand = premature abstraction
- MVP tenant (Garindo) has no expressed preference; decision default is safer choice for both.

If a real tenant later requests reference-mode with living BOM, we revisit — but until then, snapshot is the committed contract.

---

## References

- CLAUDE.md scale-forward architecture rules (composite PK for partition-ready, snapshot pattern for immutability)
- Memory `feedback_check_constraints_before_rpc_rewrite`: enumerate constraints before RPC rewrite — applied when designing `verify_and_deliver_order`
- Memory `smoke_test_security_definer_rpcs`: SQL smoke pattern for testing new SECDEF RPCs
- Existing pattern: journal_entries + saldo_awal_snapshots use similar snapshot approach for accounting immutability
