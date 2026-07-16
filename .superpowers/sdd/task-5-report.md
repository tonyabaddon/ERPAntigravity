# Task 5 Report: /admin/sales-reps UI (Wave 6 — archived below)

---

# Caleo Phase 1 Hardening — Task 5 (Day 5): Composite PK Migration Batch 1

**Status:** DONE
**Date:** 2026-07-17

## Commit

See git log for commit SHA.

## Row Counts (at migration time)

| Table | Rows |
|---|---|
| `stock_movements` | 1,589 |
| `journal_entry_lines` | 687 |

## Pre-flight Checks

| Check | Result |
|---|---|
| `stock_movements.tenant_id` NOT NULL | PASS |
| `journal_entry_lines.tenant_id` NOT NULL | PASS |
| NULL tenant_id rows in either table | 0 — PASS |
| Cross-tenant FK violations (sa ↔ sm) | 0 — PASS |
| Cross-tenant FK violations (sm self-ref) | 0 — PASS |
| Tenant-agnostic `id`-only lookups in src/ + migrations/ | None found — PASS |

## Migrations Applied

### Slot 304 — `composite_pk_stock_movements`
- `stock_movements` PK: `(id)` → `(tenant_id, id)`
- `stock_movements_related_movement_id_fkey` (self-ref) upgraded to composite `(tenant_id, related_movement_id) REFERENCES stock_movements(tenant_id, id) ON DELETE SET NULL`
- `stock_adjustments_committed_movement_id_fkey` upgraded to composite `(tenant_id, committed_movement_id) REFERENCES stock_movements(tenant_id, id) ON DELETE SET NULL`

### Slot 305 — `composite_pk_journal_entry_lines`
- `journal_entry_lines` PK: `(id)` → `(tenant_id, id)`
- No inbound FKs — no FK changes needed

### Slot 306 — `composite_pk_fk_indexes`
- `idx_sm_related_movement ON stock_movements(tenant_id, related_movement_id) WHERE NOT NULL`
- `idx_sa_committed_movement ON stock_adjustments(tenant_id, committed_movement_id) WHERE NOT NULL`
- Added after advisors flagged the two new composite FKs as unindexed

## EXPLAIN Regression Analysis

| Query | Verdict |
|---|---|
| `stock_movements WHERE tenant_id=? AND sku=?` | NO REGRESSION — `idx_sm_sku_created` |
| `stock_movements WHERE tenant_id=? AND source=?` | NO REGRESSION — `idx_sm_source` |
| `journal_entry_lines WHERE tenant_id=? ORDER BY created_at` | NO REGRESSION — Seq Scan expected at 687 rows |
| `journal_entry_lines WHERE tenant_id=? AND account_id=?` | NO REGRESSION — `idx_jel_account_date` |

## Advisor Findings (post-migration)

**New → RESOLVED:** `stock_movements_related_movement_id_fkey` unindexed → fixed in migration 306.

**Pre-existing (deferred):** `stock_movements_warehouse_id_fkey` unindexed; unused partial indexes on jel; dual permissive SELECT policies (intentional).

## Standard Gates

| Gate | Result |
|---|---|
| `npm run lint` | PASS |
| `npm run audit:numinput` | PASS |
| `npm run audit:secdef-null-tenant` | PASS |
| `npx vitest run --changed` | PASS |

## Rollback Plan

```sql
-- stock_movements
ALTER TABLE stock_adjustments DROP CONSTRAINT IF EXISTS stock_adjustments_committed_movement_id_fkey;
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_related_movement_id_fkey;
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_pkey;
ALTER TABLE stock_movements ADD PRIMARY KEY (id);
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_related_movement_id_fkey
  FOREIGN KEY (related_movement_id) REFERENCES stock_movements(id);
ALTER TABLE stock_adjustments ADD CONSTRAINT stock_adjustments_committed_movement_id_fkey
  FOREIGN KEY (committed_movement_id) REFERENCES stock_movements(id);

-- journal_entry_lines
ALTER TABLE journal_entry_lines DROP CONSTRAINT IF EXISTS journal_entry_lines_pkey;
ALTER TABLE journal_entry_lines ADD PRIMARY KEY (id);
```

---

# (Archived) Task 5 Report: /admin/sales-reps UI

**Status:** DONE
**Date:** 2026-07-10
**Wave:** 6

## What was built

### New files
- `src/lib/salesRepsApi.ts` — typed wrappers: `list()` queries `platform_admins` WHERE role='sales_rep'; `create()` calls `create_sales_rep` RPC; `deactivate()` calls `deactivate_sales_rep` RPC. Local `normalizeRpcError` mirrors paymentsApi pattern (not re-exported from adminApi).
- `src/lib/salesRepsApi.test.ts` — 9 tests covering list/create/deactivate happy paths and error propagation (P0403, P0002, 22023).
- `src/components/admin/SalesRepCreateModal.tsx` — 3-field form (UUID paste + email + name), UUID format validation, Bahasa copy per Note F, gold accent header, adminToast on submit.
- `src/components/admin/SalesRepDeactivateModal.tsx` — reason textarea (min 5 chars), Bahasa warning per Note G, gold accent header, adminToast on submit.
- `src/components/admin/SalesRepsList.tsx` — orchestrator: useEffect+async fetch, skeleton rows, table with status badges (green/gray), "Tambah Sales Rep" button, per-row "Nonaktifkan" button (active only), error inline retry, refresh key on create/deactivate success.
- `src/components/admin/SalesRepsList.test.tsx` — 8 tests: heading/button render, empty state, rows with badges, create modal opens, Nonaktifkan button active-only, deactivate modal opens, error state, re-fetch after create.

### Modified files
- `src/components/admin/AdminRoutes.tsx` — added `/admin/sales-reps` route dispatching to `<SalesRepsList />`.
- `src/components/admin/AdminSidebar.tsx` — added `UsersRound` import + "Sales Reps" nav item with `superAdminOnly: true`.

## Test results

```
npx vitest run src/lib/salesRepsApi.test.ts src/components/admin/SalesRepsList.test.tsx

Test Files  2 passed (2)
     Tests  18 passed (18)
  Duration  663ms
```

## TypeScript

```
npx tsc --noEmit
(no output — clean)
```

## Pre-existing test failures (not caused by Task 5)

`src/components/admin/AdminRoutes.test.tsx` had 2 pre-existing failures before Task 5 (confirmed via git stash):
- "renders AdminHome stub at /admin" — checks for `/Beranda Admin.*Task 8/` which doesn't exist in AdminHome.tsx
- "renders TenantsList stub at /admin/tenants" — checks for `/Daftar Tenant.*Task 9/` which doesn't exist in TenantsList.tsx

These are stale test stubs from a prior wave. Not introduced by this task.

## Design decisions

- `normalizeRpcError` is private in `adminApi.ts` (not exported); followed `paymentsApi.ts` pattern of a local mirror.
- AdminSidebar test count comment says "7 items" but test assertions don't count items — no test update needed.
- `SalesRepDeactivateModal` guards `!salesRep` at render to prevent null access (prop is `SalesRep | null`).
