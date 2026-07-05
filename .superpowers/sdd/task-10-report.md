# Task 10 Report — TenantDetailShell + tab stubs

**Status:** DONE

## Routing pattern

`AdminRoutes.tsx` already had `TENANT_DETAIL_RE = /^\/admin\/tenants\/([^/]+)\/?$/` and passed the captured segment as `tenantId` prop to `TenantDetailShell`. No routing changes needed — the shell now accepts `{ tenantId: string }` prop (same interface as the stub).

## Param extraction shape

```tsx
// AdminRoutes.tsx (unchanged)
const tenantDetailMatch = pathname.match(TENANT_DETAIL_RE);
if (tenantDetailMatch) {
  return <TenantDetailShell tenantId={tenantDetailMatch[1]} />;
}
```

No `useParams` hook needed — prop-based extraction, consistent with the no-react-router-dom project pattern.

## Tab URL state

`useSyncExternalStore` subscribes to `popstate` + `urlroute:change` (reusing the same event name as `urlRoute.ts`). `setTab(key)` calls `window.history.pushState({}, '', '?' + params.toString())` using only the relative search string (avoids jsdom SecurityError with absolute URLs in tests).

## Tenant lookup

Client-side find: `listTenantsAdmin({ page_size: 200 })` → `rows.find(r => r.tenant_id === tenantId)`.

**Wave 2+ followup:** Add a `tenant_id` filter key to `list_tenants_admin` RPC to avoid fetching all rows. Currently safe — only 1 tenant in prod; `page_size: 200` is a cheap guard.

Note: `search` filter on `list_tenants_admin` does ILIKE on name/slug, NOT UUID match — confirmed by adminApi.ts + adminTypes.ts. Using `search: tenantId` would not reliably find a tenant by UUID.

## Loading / not-found discrimination

Three distinct states: `loading=true` (fetch in flight), `notFound=true` (fetch resolved, no match), `tenant` set (found). Loading and not-found are never conflated — tested in `'is distinct: loading state has no not-found marker'`.

## tsc

`npx tsc --noEmit` → 0 errors.

## Vitest

- New: `TenantDetailShell.test.tsx` — **9/9 PASS**
- Suite-wide: 63 total, 61 pass, 2 pre-existing failures (AdminRoutes.test.tsx stubs "Beranda Admin.*Task 8" and "Daftar Tenant.*Task 9" from Task 7-era assertions — not introduced by this task, confirmed by stash check).

## Files created/modified

- `src/components/admin/TenantDetail/TenantDetailShell.tsx` — replaced stub with real shell
- `src/components/admin/TenantDetail/OverviewTab.tsx` — stub (Task 11)
- `src/components/admin/TenantDetail/UsersTab.tsx` — stub (Task 12)
- `src/components/admin/TenantDetail/AuditTab.tsx` — stub (Task 13)
- `src/components/admin/TenantDetail/TenantDetailShell.test.tsx` — 9 tests
- `src/components/admin/AdminRoutes.test.tsx` — updated tenant detail test (tablist scope), added adminApi mock
