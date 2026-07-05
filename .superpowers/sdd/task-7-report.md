# Task 7 Report: /admin/* routes + platform-admin guard

## urlRoute.ts API Summary

`urlRoute.ts` is a custom query-string and pathname router — **no react-router-dom**. Key facts:

- `parseRoute(pathname, search)` collapses **all** `/admin/*` paths into `{ screen: 'admin', isPlatformAdminArea: true, params: {} }` — no sub-path or param extraction.
- Navigation uses `window.history.pushState` + custom `urlroute:change` event.
- No nested-route primitives, no URL param extraction for admin sub-paths.

**Workaround applied**: `AdminRoutes.tsx` performs its own `pathname.match()` dispatch (regex-based) since `urlRoute.ts` cannot distinguish `/admin/tenants/garindo` from `/admin/tenants`. This is intentional and documented — Task 8+ may want to formalise this into a helper if more param extraction is needed.

## Guard Location + Strategy

- `src/components/admin/AdminRouteGuard.tsx` — standalone component wrapping children.
- Calls `tenantContextService.isPlatformAdmin()` (Supabase RPC `is_platform_admin`) on mount.
- On deny: fires `adminToast.error('Halaman khusus admin')` then `window.location.assign('/dashboard')`.
- Redirect target is `/dashboard` (not `/login`); the Garindo legacy-redirect in `App.tsx` will further bounce to `/t/garindo/dashboard` for tenant users.

## Route Dispatch

`src/components/admin/AdminRoutes.tsx` replaces `AdminShell` as the entry-point from `App.tsx`:
- `/admin` → `AdminHome` (Task 8 placeholder)
- `/admin/tenants` → `TenantsList` (Task 9 placeholder)
- `/admin/tenants/:tenantId` → `TenantDetailShell` (Task 10 placeholder, extracts slug via regex)
- `/admin/audit` → `AuditLogViewer` (Task 13 placeholder)
- `/admin/plans` → `PlansManagement` (Task 14 placeholder)

## Tests

| File | Tests | Result |
|------|-------|--------|
| `AdminRouteGuard.test.tsx` | 4 | PASS |
| `AdminRoutes.test.tsx` | 5 | PASS |
| `AdminLayout.test.tsx` | 3 | PASS (pre-existing) |
| `AdminSidebar.test.tsx` | 5 | PASS (pre-existing) |
| `adminApi.test.ts` | 11 | PASS (pre-existing) |
| `adminToast.test.ts` | 7 | PASS (pre-existing) |

**Pre-existing failures**: `src/lib/products/productWrappers.test.ts` (3 tests) — unrelated mock issue, present before this task. No new failures introduced.

## Concerns / DONE_WITH_CONCERNS

1. **urlRoute.ts has no nested-route or param-extraction support for admin paths.** Workaround: inline regex dispatch in `AdminRoutes.tsx`. Suggest adding `parseAdminRoute(pathname)` helper to `urlRoute.ts` in Task 8+ if more admin params are needed.

2. **Impersonate Tenant form from AdminShell (Phase A) is now orphaned.** `AdminShell` is no longer rendered; the impersonate UI (text input + button) has no home. `AdminHome` stub (Task 8) or `TenantsList` row action (Task 9) is the natural replacement. Flagged for Task 8/9 implementors.
