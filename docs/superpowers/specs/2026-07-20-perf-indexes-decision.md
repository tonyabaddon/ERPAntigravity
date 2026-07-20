# 2C Perf indexes — decision memo

**Date:** 2026-07-20
**Owner:** QA-week Wave 1 Task 3
**Migration:** `supabase/migrations/20261115000504_perf_indexes.sql`
**Reversibility:** semi-reversible (DROP INDEX CONCURRENTLY is safe; index build cost is the only sunk cost).

## Context
Post-Phase-1 EXPLAIN ANALYZE surfaced 4 candidate hot queries. Empirical
BEFORE plans (verified 2026-07-20):

| Q | Table | Rowcount | BEFORE plan | Exec time |
|---|---|---|---|---|
| Q1 | `approval_requests` | 1,289 | Index Scan on `idx_ar_status_expires` (status only), filter tenant | 0.11 ms |
| Q2 | `purchase_order_items` | 290 | Index Scan on `idx_poi_tenant_po` using `po_id = X` (composite scan) | 1.33 ms |
| Q3 | `stock_lots` | 245 | **Seq Scan** + filter (tenant, sku, qty_remaining) | 3.09 ms |
| Q4 | `purchase_orders` | 290 | **Seq Scan** + filter (tenant, supplier, status) | 2.12 ms |

At current scale, execution is sub-3ms across the board — the SEQ SCANs
still fit in a single 8KB page hit. The 10× (10k tenant, ~100k rows/table)
projection is where Q3 + Q4 become 30-100 ms per query without an index.
Q1 + Q2 already have partial coverage but a tenant-first composite gives
the planner a better sort/limit path at scale.

## Decision
Add 4 btree indexes via `CREATE INDEX CONCURRENTLY IF NOT EXISTS`:

| # | Index | Table | Definition |
|---|---|---|---|
| 1 | `idx_approval_requests_tenant_status_requested` | `approval_requests` | `(tenant_id, status, requested_at DESC)` |
| 2 | `idx_purchase_order_items_po` | `purchase_order_items` | `(po_id)` |
| 3 | `idx_stock_lots_fifo` | `stock_lots` | `(tenant_id, sku, received_at) WHERE qty_remaining > 0` |
| 4 | `idx_purchase_orders_tenant_supplier_status` | `purchase_orders` | `(tenant_id, supplier_id, status)` |

**Deltas vs brief** (found during Step 1 verification):
- `approval_requests.created_at` does not exist → column is `requested_at`.
  Index and query both use `requested_at`.
- `stock_lots.created_at` does not exist → column is `received_at`. Partial
  index and query both use `received_at`.
- Q1/Q2 already have partial coverage (`idx_ar_status_expires`,
  `idx_poi_tenant_po`) — new indexes are still useful (see rationale below)
  but the immediate 10× gain concentrates on Q3+Q4.

### Rationale per index
1. **approval_requests** — existing `idx_ar_status_expires (status,
   expires_at)` uses `expires_at` not `requested_at`, and does not lead
   with `tenant_id`. Dashboard query "recent pending approvals for tenant X
   ordered by newest first" benefits from a tenant-leading composite that
   directly satisfies the LIMIT+ORDER without post-filter sort at scale.
2. **purchase_order_items** — existing `idx_poi_tenant_po (tenant_id,
   po_id)` is a composite index that Postgres uses via index scan even
   when only `po_id` is bound (via inner-key skip on the leading equality
   column). Adding a single-column `(po_id)` index makes the join hot-path
   cheaper (smaller index, faster inner-loop lookups) — the payoff is when
   PO items table grows past 100k rows and per-join lookup latency starts
   to dominate PO detail screen render.
3. **stock_lots** — no supporting index for FIFO retrieval. Partial index
   `WHERE qty_remaining > 0` is 2-5× smaller than a full index (many lots
   fully consumed) and directly supports the "find oldest lot with stock"
   pattern the sale/consumption RPCs use every time.
4. **purchase_orders** — no `(tenant_id, supplier_id, status)` coverage.
   Supplier detail screen (AP dashboard) filters by these three columns
   every page load; today it seq scans 290 rows, at 10× it seq scans 100k.

## Alternatives considered
- **Do nothing** → LATER cost at 10× scale. Rejected (cheap now, tables
  are 245-1,289 rows, index build is instant).
- **BRIN indexes** on `received_at` — useful for append-only time-series
  scans but the FIFO query is a point-lookup (`sku = X`) with sort limit,
  not a range scan. Rejected.
- **Covering indexes (INCLUDE cols)** — bloat cost > benefit at these row
  widths (stock_lots row is 124 B; adding INCLUDE(qty_remaining, unit_cost)
  doubles index size). Deferred until pg_stat_statements shows measurable
  heap fetch cost.
- **Skip `idx_purchase_order_items_po` because `idx_poi_tenant_po` covers**
  — considered; kept because tenant-leading skip scans cost O(distinct
  tenants) at scale (~10k). Dedicated `(po_id)` stays O(log n).
- **Skip `idx_approval_requests_tenant_status_requested` because
  `idx_ar_status_expires` is close** — considered; kept because the two
  serve different sorts (`expires_at` for SLA breach queries;
  `requested_at DESC` for the dashboard list). Both cost ~40KB at
  1,289 rows.

## Consequences
- **Reversibility:** `DROP INDEX CONCURRENTLY IF EXISTS <name>` — safe,
  no data loss, no downtime.
- **Blast radius:** additive only. Postgres planner picks whichever index
  wins the cost estimate; existing plans do not regress because the old
  indexes remain.
- **Write amplification:** ~4 extra btree pages per INSERT/UPDATE on the
  4 tables. Insert-heavy tables (`stock_lots`, `purchase_order_items`)
  see a marginal ~5-10% write slowdown at scale — dwarfed by the read
  savings on hot dashboards.
- **Storage:** each index ~40 KB today; ~5 MB per 100k rows at 10× scale.
  Total ~20 MB across 4 indexes at 10×. Negligible.

## Scale ceiling check (per CLAUDE.md 6-question)
1. **Ceiling at 10× (10k tenants, ~100k rows/table)**: Q3+Q4 seq scans
   become 30-100ms each; index scans keep them sub-5ms. Q1+Q2 gain
   marginal but future-proof. First breaking point is Q3 (stock_lots
   FIFO on every sale/consumption).
2. **Hot path**: all 4 serve dashboard / detail-screen queries hit on
   nearly every user session.
3. **Partition-ready**: composite indexes lead with `tenant_id` (except
   `idx_purchase_order_items_po` which leads with `po_id` intentionally —
   PO items always joined via PO, and PO PK is `(tenant_id, id)` so tenant
   is enforced upstream). Future partition on `tenant_id` remains open.
4. **Idempotency**: `CREATE INDEX CONCURRENTLY IF NOT EXISTS` — safe re-run
   and safe on retry after network failure.
5. **Long ops**: `CONCURRENTLY` avoids table lock. At 245-1,289 rows,
   sub-second per index. At 10× scale, ~30-60s per index — still
   non-blocking for writers.
6. **Cost curve**: flat storage cost, sub-linear read cost improvement.

## Follow-up work
- Re-run EXPLAIN ANALYZE quarterly + drop indexes where
  `pg_stat_user_indexes.idx_scan = 0` for 30d (add to P3-01 backlog).
- If Q1+Q2 gain remains marginal at 10× → consider dropping the two
  and revisiting query pattern (skip scan or MV).
- Watch `pg_stat_user_indexes.idx_tup_read` on `idx_stock_lots_fifo` — if
  the partial filter (`qty_remaining > 0`) shrinks below 10% of rows, the
  planner may prefer the full-table index instead; adjust.
