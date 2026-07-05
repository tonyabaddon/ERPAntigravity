# Task 9 Report — FE: AdminRevenue dashboard `/admin/revenue`

**Status:** DONE  
**Commit:** `2dc009a`  
**Branch:** `worktree-phase-b-wave5`

---

## What was built

### Chart decision
Hand-rolled SVG (no recharts). Reasons: keeps deploy surface small (no new npm dep), VOSI palette adherence is straightforward in raw SVG, and Wave 4a socket-timeout concerns make any additional dependency risk worth avoiding.

### Files created (12 new)

| File | Purpose |
|------|---------|
| `src/lib/formatIDR.ts` | `formatIDR(n) → "Rp X.XXX.XXX"` — Indonesian locale, no cents, Math.trunc |
| `src/lib/formatIDR.test.ts` | 8 tests (1234567, 0, 1000, 3.6M, truncation, 1B) |
| `src/components/admin/AdminRevenue.tsx` | Orchestrator: parallel fetch, loading/error/empty/happy, coverage gaps callout |
| `src/components/admin/AdminRevenue.test.tsx` | 12 tests: loading, happy, empty, error/retry, coverage gaps, ARR/MRR computation, page title |
| `src/components/admin/RevenueKPIRow.tsx` | 4 KPI cards: Bulan ini (↑/↓ vs prev month), YTD, MRR estimasi, ARR estimasi |
| `src/components/admin/RevenueKPIRow.test.tsx` | 8 tests: computeMonthlyKPIs unit + 5 render tests |
| `src/components/admin/RevenuePlanBreakdown.tsx` | Horizontal bar chart SVG per plan (STARTER/PRO/PREMIUM), sorted PREMIUM→PRO→STARTER |
| `src/components/admin/RevenuePlanBreakdown.test.tsx` | 6 tests |
| `src/components/admin/RevenueMonthlyTrend.tsx` | 12-month polyline SVG with area fill, month labels, accessible fallback table |
| `src/components/admin/RevenueMonthlyTrend.test.tsx` | 5 tests |
| `src/components/admin/RevenueTopTenants.tsx` | Top-10 table: Rank/Nama/Paket badge/Total/Coverage badge; rows clickable → /admin/tenants/{slug}?tab=pembayaran |
| `src/components/admin/RevenueTopTenants.test.tsx` | 8 tests including row-click navigation, limit-to-10 |

### Files modified

- `src/components/admin/AdminSidebar.tsx` — Added "Pendapatan" nav item with `Coins` lucide-react icon after "Paket"
- `src/components/admin/AdminRoutes.tsx` — Imported `AdminRevenue`; added `/admin/revenue` pattern match

### Data fetching design

Parallel `Promise.all` for:
1. `getRevenueStats({ group_by: 'plan' })`
2. `getRevenueStats({ group_by: 'month' })`
3. `getRevenueStats({ group_by: 'tenant' })`
4. `listTenantsAdmin({ page_size: 50 })`
5. `listPlansAdmin()`

Then separately: `supabase.from('v_tenant_payment_coverage').select('*').eq('coverage_status', 'OVERDUE')` for coverage gaps.

### MRR / ARR computation

```
ARR = SUM(plans.price_annual for each ACTIVE tenant's plan_code)
MRR = ARR / 12
```

Computed client-side from `listTenantsAdmin` + `listPlansAdmin`. Empty state (0 active tenants or all null prices) → ARR=0, MRR=0.

---

## Test summary

| Suite | Tests | Result |
|-------|-------|--------|
| formatIDR | 8 | PASS |
| RevenueKPIRow | 8 | PASS |
| RevenuePlanBreakdown | 6 | PASS |
| RevenueMonthlyTrend | 5 | PASS |
| RevenueTopTenants | 8 | PASS |
| AdminRevenue | 12 | PASS |
| **Total new** | **47** | **PASS** |

Full `src/` suite: 4 test files failed (adminToast, AdminLayout, AdminRoutes stub, productWrappers) — all 7 failures are **pre-existing** from prior tasks, verified via `git stash` baseline. No new failures introduced.

---

## TypeScript

`npx tsc --noEmit` — 0 errors in any of the 14 new/modified files. Pre-existing 9 errors (pg/yaml/sonner/jsonwebtoken type stubs) unchanged.

---

## Concerns

1. **v_tenant_payment_coverage client-side SELECT** — View is admin-readable via Row Level Security (`p_platform_admin_readall` on the underlying view per Task 6). Platform admin JWT is always present in AdminRevenue context so direct client SELECT works correctly. No additional grants needed.

2. **SVG chart accessibility** — Each SVG chart has an accessible fallback `<table class="sr-only">` with all data. The main SVG has `role="img"` + `aria-label`. Individual data points have `<title>` tooltips. This satisfies basic a11y without recharts.

3. **Top-10 tenant join by key** — `getRevenueStats({ group_by: 'tenant' })` returns `breakdown[].key` which is the tenant_id (UUID) per the migration's `jsonb_build_object('key', t.tenant_id, ...)`. Client-side join uses tenant_id match first, slug fallback for robustness.

4. **Coverage gaps callout reuses RecordPaymentModal** — "Catat pembayaran" CTA opens RecordPaymentModal with the matching AdminTenantRow. If the tenant row isn't in the first 50 results from listTenantsAdmin, the CTA falls back to navigation link (`/admin/tenants/{slug}?tab=pembayaran`). This is acceptable as OVERDUE tenants will typically be in the top 50 active tenants.
