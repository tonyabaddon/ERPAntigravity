# Service Catalog: Irreversible Decisions Memo

**Date:** 2026-07-13
**Related spec:** [2026-07-13-service-catalog-design.md](./2026-07-13-service-catalog-design.md)

Per CLAUDE.md scale-forward architecture rules, irreversible decisions require a decision memo before implementation.

**One** irreversible decision in the Service Catalog design:

1. **BOM snapshot pattern** (freeze at commit, no historical reference to master)

An additional item — composite PK on `rakit_job_lines` — was initially proposed as irreversible but revised to "tech debt to defer" after discovering the existing table already ships single-PK schema. See Section "Deferred" below.

---

## Decision 1: BOM Snapshot Pattern (Freeze at Commit)

### Context

BOM master (`service_catalog_bom`) can change anytime — owner tweaks komponen, adjusts qty, adds/removes items. If historical orders reference master directly, past reports "shift" as master evolves. Customer invoice from 6 months ago wouldn't reproduce same BOM breakdown.

Alternative: pass BOM by reference, store master version. Or: freeze snapshot at commit.

### Decision

Freeze BOM snapshot at order commit into `rakit_components` (existing snapshot table; extended with `service_catalog_bom_id` optional link + reuse of existing `fifo_cost_snapshot` populated at deliver).

Historical order queries never join back to `service_catalog_bom` for BOM detail. All BOM data self-contained in snapshot.

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Pass-by-reference (join to master) | Master evolves, historical reports become inconsistent; invoice regeneration impossible after BOM edit |
| Version master with `bom_version` column + point historical to specific version | Complex versioning logic; owner UX confusing ("edit will bump version"); harder to reason about; still requires snapshot at delivery for `fifo_cost_snapshot` |
| Copy BOM at quote → immutable → order upgrades quote | Wasted storage on abandoned quotes; less flexibility for order edits pre-commit |

### Consequences

**Reversibility cost:** Medium-high. Once snapshot pattern shipped and orders committed, we can add master-version fallback later BUT existing snapshots stay frozen. Cannot "unfreeze" without invalidating historical audit trail.

**Blast radius:** Small storage impact — snapshot is small copy (5-20 rows per order). Big benefit: reporting/invoice/audit stays consistent forever.

**Migration path if we need to undo:** No clean path. If we ever need to shift to reference-mode, we'd need to reconstruct master versions retroactively — impossible for edits that already lost history.

### Scale ceiling check

1. **What breaks first at 10×?** Storage grows linearly with orders. At 10K tenants × 10K orders × 10 components snapshot = 1B rows. Requires partitioning aligned with parent order (see Deferred section below).
2. **Hot path?** Deliver RPC writes 5-20 snapshot rows per order — bounded. Reporting reads snapshot per order — bounded per query.
3. **Partition-ready?** Not yet — depends on `rakit_job_lines` (parent) partitioning strategy, which is deferred (see below).
4. **Idempotency?** `attach_service_to_order` snapshots BOM once; re-attach fails on natural unique key.
5. **Long ops?** Snapshot copy is sync within order-commit transaction. Sub-second.
6. **Cost curve?** Linear with orders. Consistent with rest of system.

### Follow-up work

- Ensure snapshot copy happens **inside the transaction** with order commit — no lazy population risk.
- Add note in `rakit_components`: comment `snapshot_frozen_at` semantics (frozen at attach_service_to_order commit; unit cost frozen at verify_and_deliver_order commit).
- When we ever need master-version tracking (post-MVP), add `service_catalog_bom.version` + snapshot capture at attach time — additive schema change compatible with snapshot pattern.

---

## Deferred: `rakit_job_lines` Partition-Ready PK Migration

### Context

CLAUDE.md scale-forward rule: high-volume tables should have partition-ready composite PK `(tenant_id, id)` from birth. `rakit_job_lines` will become high-volume as service orders scale.

### Reality check

`rakit_job_lines` already exists in production with single PK `id UUID PRIMARY KEY` (mig 20260608000008). Retroactively changing PK requires:
- Drop existing PRIMARY KEY constraint
- Cascade FK on `rakit_components.rakit_job_line_id`
- Rewrite any RLS predicates and RPCs that assume single-key lookup
- Non-additive migration on a table that may already have production rows (Garindo)

For MVP scale (Garindo, tens of tempo orders/day, hundreds by year end), single PK works. Partition trigger (~10M rows) is years away.

### Decision

Ship MVP with existing single PK. Document as tech debt.

### Trigger for future migration

Migrate to composite PK `(tenant_id, id)` when either:
- `rakit_job_lines` row count exceeds 5M
- Query P95 on tenant-filtered reads exceeds 100ms consistently

At that point, plan a proper multi-week migration (parallel table + dual-write + backfill + cutover pattern).

### Consequences

**Not irreversible today** — this is a deferred choice, not a committed contract.

Future planners: don't repeat this shortcut on genuinely new tables. If you create a new high-volume table (e.g., `service_analytics_events`), design composite PK from day one per CLAUDE.md.

---

## Rejected: Making These Configurable

For the snapshot decision we considered "make it configurable per tenant" — e.g., let tenant choose snapshot vs reference mode. Rejected because:

- Configurable = 2× code paths to maintain
- Migration between modes still lossy for the snapshot case
- Configurability without demand = premature abstraction
- MVP tenant (Garindo) has no expressed preference; snapshot is safer default.

If a real tenant later requests reference-mode with living BOM, we revisit — but until then, snapshot is the committed contract.

---

## References

- CLAUDE.md scale-forward architecture rules (snapshot pattern for immutability, partition-ready as aspiration)
- Memory `feedback_check_constraints_before_rpc_rewrite`: enumerate constraints before RPC rewrite — applied when designing `verify_and_deliver_order`
- Memory `smoke_test_security_definer_rpcs`: SQL smoke pattern for testing new SECDEF RPCs
- Existing pattern: `journal_entries` + `saldo_awal_snapshots` use similar snapshot approach for accounting immutability
