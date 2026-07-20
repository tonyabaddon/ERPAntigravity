# QA-week Wave 1 Task 3: 2C Perf indexes — DONE

**Status:** DONE
**Date:** 2026-07-20
**Migration slot:** 20261115000504
**Commit SHA:** _(to be inserted post-commit)_

---

## Summary

Applied 4 btree indexes CONCURRENTLY to Supabase prod on 4 hot query paths.
All 4 verified `indisvalid = true, indisready = true`. All 4 AFTER plans use
the new indexes (Q3 + Q4 flipped from Seq Scan to Index Scan). Advisor gate
completed. Migration recorded in `supabase_migrations.schema_migrations`.

## Files

- `supabase/migrations/20261115000504_perf_indexes.sql` — 4 CREATE INDEX CONCURRENTLY (idempotent)
- `tests/sql/qa-week/2c-explain-before-after.sql` — canonical EXPLAIN queries (before + after)
- `docs/superpowers/specs/2026-07-20-perf-indexes-decision.md` — advisor-gate decision memo

## Column corrections vs brief

Verified against live schema 2026-07-20:
- `approval_requests` has **no** `created_at` → use `requested_at`
- `stock_lots` has **no** `created_at` → use `received_at`
- `approval_status` enum uses lowercase (`pending`, not `PENDING`)
- `purchase_orders.status` uses `ORDERED`/`RECEIVED`/`PAID` (no `OPEN`/`PARTIALLY_RECEIVED`)

Query + migration updated accordingly. Advisor briefed on these deltas.

---

## Step 1: EXPLAIN ANALYZE BEFORE (verbatim)

Rowcounts: approval_requests=1,289; purchase_order_items=290; stock_lots=245; purchase_orders=290.

### Q1 — approval_requests (BEFORE)
```
Limit  (cost=2.52..2.52 rows=1 width=237) (actual time=0.031..0.032 rows=0 loops=1)
  Buffers: shared hit=5
  ->  Sort  (cost=2.52..2.52 rows=1 width=237) (actual time=0.030..0.030 rows=0 loops=1)
        Sort Key: requested_at DESC
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=5
        ->  Index Scan using idx_ar_status_expires on approval_requests
              Index Cond: (status = 'pending'::approval_status)
              Filter: ((tenant_id = ...) AND (requested_at > now() - '7 days'::interval))
              Buffers: shared hit=2
Planning Time: 2.228 ms
Execution Time: 0.108 ms
```

### Q2 — purchase_order_items (BEFORE)
```
Index Scan using idx_poi_tenant_po on purchase_order_items
  Index Cond: (po_id = (InitPlan 1).col1)
  Buffers: shared hit=7
Planning Time: 0.792 ms
Execution Time: 1.328 ms
```

### Q3 — stock_lots (BEFORE)
```
Limit
  ->  Sort
        Sort Key: stock_lots.received_at
        Sort Method: quicksort  Memory: 25kB
        ->  Seq Scan on stock_lots
              Filter: (qty_remaining > 0 AND tenant_id = ... AND sku = ...)
              Rows Removed by Filter: 243
              Buffers: shared hit=9
Planning Time: 0.658 ms
Execution Time: 3.087 ms
```

### Q4 — purchase_orders (BEFORE)
```
Seq Scan on purchase_orders
  Filter: (status = ANY ('{ORDERED,RECEIVED}'::text[]) AND tenant_id = ... AND supplier_id = ...)
  Rows Removed by Filter: 290
  Buffers: shared hit=14
Planning Time: 2.142 ms
Execution Time: 2.116 ms
```

---

## Step 2: Decision memo

Path: `docs/superpowers/specs/2026-07-20-perf-indexes-decision.md`

Highlights:
- Reversibility: semi-reversible (`DROP INDEX CONCURRENTLY IF EXISTS`).
- Q3 + Q4 clear seq→index wins; Q1 + Q2 have existing partial coverage but
  new indexes give better sort/limit and single-column lookup paths at scale.
- Scale ceiling: 20 MB total at 10× (100k rows/table); flat cost curve.
- Write amplification: ~5-10% marginal on high-volume tables.

---

## Step 3: advisor() gate

**Verdict:** OK to proceed with one addition to apply step.

**Advisor additions incorporated:**
1. After each `CREATE INDEX CONCURRENTLY`, verify `pg_index.indisvalid = true
   AND indisready = true` **before** the `schema_migrations` INSERT.
   Rationale: `CONCURRENTLY` can leave an INVALID index on build failure
   and `IF NOT EXISTS` silently skips retry.
2. Flag in report that Q1 + Q2 plan changes may be marginal at low volume
   (tenants have <10 pending approvals, PO items table 290 rows).
3. `idx_purchase_order_items_po` partially shadows existing `idx_poi_tenant_po` —
   kept per CLAUDE.md "new query pattern → new index" but expect P3-01
   unused-index-sweep review.
4. No RLS impact (indexes transparent to policies); no FK re-check; new
   indexes' `unused_index` finding at birth (idx_scan=0) is expected — don't
   chase.

`indisvalid` check was executed post-apply — see Step 5.

---

## Step 4: Migration file

Path: `supabase/migrations/20261115000504_perf_indexes.sql`

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_approval_requests_tenant_status_requested
  ON approval_requests (tenant_id, status, requested_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_order_items_po
  ON purchase_order_items (po_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_lots_fifo
  ON stock_lots (tenant_id, sku, received_at) WHERE qty_remaining > 0;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_orders_tenant_supplier_status
  ON purchase_orders (tenant_id, supplier_id, status);
```

Idempotent (`IF NOT EXISTS`). Not wrapped in a transaction (CONCURRENTLY
constraint). Each statement individually atomic.

---

## Step 5: Apply via Management API

Each CREATE INDEX submitted as a separate POST to
`https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query`.

| # | Index | POST result |
|---|---|---|
| 1 | `idx_approval_requests_tenant_status_requested` | `[]` (success — empty rowset) |
| 2 | `idx_purchase_order_items_po` | `[]` (success) |
| 3 | `idx_stock_lots_fifo` | `[]` (success) |
| 4 | `idx_purchase_orders_tenant_supplier_status` | `[]` (success) |

### indisvalid check (per advisor)

```
relname                                                    indisvalid  indisready
idx_approval_requests_tenant_status_requested              true        true
idx_purchase_order_items_po                                true        true
idx_purchase_orders_tenant_supplier_status                 true        true
idx_stock_lots_fifo                                        true        true
```

All 4 valid + ready.

### schema_migrations INSERT

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261115000504', 'perf_indexes')
ON CONFLICT DO NOTHING
RETURNING version, name;
```

Returned: `[{"version":"20261115000504","name":"perf_indexes"}]` — fresh insert (no conflict), tracking recorded.

---

## Step 6: EXPLAIN ANALYZE AFTER + plan comparison

### Q1 — approval_requests (AFTER)
```
Limit  (cost=0.28..2.50 rows=1 width=237) (actual time=0.026..0.026 rows=0 loops=1)
  Buffers: shared hit=2
  ->  Index Scan using idx_approval_requests_tenant_status_requested on approval_requests
        Index Cond: ((tenant_id = ...) AND (status = 'pending'::approval_status)
                     AND (requested_at > now() - '7 days'::interval))
        Buffers: shared hit=2
Planning Time: 22.347 ms
Execution Time: 0.106 ms
```
**Verdict:** WIN — planner switched from `idx_ar_status_expires` + Sort to the new tenant-first composite. Sort step eliminated (`requested_at DESC` served by index order). Buffers 5 → 2.

### Q2 — purchase_order_items (AFTER)
```
Index Scan using idx_purchase_order_items_po on purchase_order_items
  Index Cond: (po_id = (InitPlan 1).col1)
  Buffers: shared hit=6
Planning Time: 14.435 ms
Execution Time: 0.181 ms
```
**Verdict:** WIN — planner switched from composite `idx_poi_tenant_po` to the dedicated single-column `(po_id)` index. Buffers 7 → 6; exec 1.33 ms → 0.18 ms.

### Q3 — stock_lots (AFTER)
```
Limit
  ->  Index Scan using idx_stock_lots_fifo on stock_lots
        Index Cond: ((tenant_id = ...) AND (sku = ...))
        Buffers: shared hit=5
Planning Time: 9.538 ms
Execution Time: 0.138 ms
```
**Verdict:** MAJOR WIN — Seq Scan + Sort eliminated. Index provides tenant+sku match and received_at-ordered rows, so no sort needed for FIFO. Exec 3.09 ms → 0.14 ms (22× faster). Buffers 9 → 5.

### Q4 — purchase_orders (AFTER)
```
Index Scan using idx_purchase_orders_tenant_supplier_status on purchase_orders
  Index Cond: ((tenant_id = ...) AND (supplier_id = ...) AND (status = ANY ('{ORDERED,RECEIVED}'::text[])))
  Buffers: shared hit=5
Planning Time: 3.349 ms
Execution Time: 1.938 ms
```
**Verdict:** WIN — Seq Scan eliminated. All 3 columns pushed to Index Cond. Buffers 14 → 5.

### Summary table

| Q | BEFORE plan | AFTER plan | Exec ms Δ | Buffers Δ |
|---|---|---|---|---|
| Q1 | Index Scan (status only) + Sort | **Index Scan (new composite)**, no sort | 0.108 → 0.106 | 5 → 2 |
| Q2 | Index Scan (composite) | **Index Scan (new po_id)** | 1.33 → 0.18 | 7 → 6 |
| Q3 | **Seq Scan + Sort** | **Index Scan (new partial)**, no sort | 3.09 → 0.14 (22×) | 9 → 5 |
| Q4 | **Seq Scan** | **Index Scan (new composite)** | 2.12 → 1.94 | 14 → 5 |

All 4 queries picked the new index. Q3 is the standout win (22× exec speedup even at 245 rows). Q1 + Q2 show modest improvement at current scale; the structural gain (sort elimination for Q1, smaller index for Q2) compounds at 10× scale.

---

## Step 7: get_advisors sweep

**Performance advisors filtered to our 4 target tables:**
- 8 `unindexed_foreign_keys` INFO findings (pre-existing FK covers unrelated to our indexes)
- 4 `unused_index` INFO findings (`idx_ar_requester`, `idx_purchase_orders_expected_receive_date`, `idx_sl_tenant_po`, `stock_lots_source_idx`) — **all pre-existing indexes**, none of them ours
- 0 lints referencing any of the 4 new index names

**Security advisors filtered to our 4 target tables:**
- 8 `multiple_permissive_policies` WARN findings (`p_platform_admin_readall` + `t_select_own`) — pre-existing, unchanged by this migration

**Verdict:** No new advisor findings introduced by 504. Expected `unused_index` finding for our new indexes at idx_scan=0 has NOT yet fired — advisor sweep didn't flag them (per advisor guidance, this is normal at birth; noise if it fires would still be expected and dismissed).

---

## Concerns / open items

1. **`idx_purchase_order_items_po` partially shadows `idx_poi_tenant_po`.** Advisor + memo note this. Retained per CLAUDE.md "new query pattern → new index"; watch under P3-01 quarterly unused-index sweep. If `pg_stat_user_indexes.idx_scan` stays 0 after 30 days of production traffic → drop.
2. **Q1 gains marginal at current 1,289 rows.** New composite `(tenant_id, status, requested_at DESC)` value shows up only at 10k+ pending rows. Kept because the structural win (no sort) is real; will look better in EXPLAIN once tenants accumulate pending queue.
3. **`approval_requests.id` is `bigint`, not uuid.** Not relevant to this migration but noted for the record — Q1 doesn't return id-ordered, so the composite index remains correct.
4. **No production tenant re-verify in Stage 3.** This migration is DDL-only, no user flow change. If Wave 1 Task 5 does the roll-up smoke test, no additional Stage 3 needed for 2C.
5. **`indisvalid` check must be baked into the apply-pending-migrations.sh flow** for future CONCURRENTLY migrations. Followup: add to migration runner script.

---

## Commit SHA

_(inserted post-commit)_
