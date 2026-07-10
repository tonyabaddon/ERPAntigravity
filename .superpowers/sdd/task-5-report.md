# Task 5 Report: /admin/sales-reps UI

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
