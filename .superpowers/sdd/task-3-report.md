# Task 3 Report: Frontend isSuperAdmin helper + sidebar role filter

## What was implemented

1. **`src/lib/jwt.ts` (new)** — Extracted shared `decodeJwt(token)` helper. Handles base64url encoding (URL-safe char replacement before atob). Replaces the inline version previously in `AdminLayout.tsx`.

2. **`src/lib/adminAuth.ts` (rewritten)** — Replaced `tenantContextService.isPlatformAdmin()` proxy with direct JWT claim reading:
   - `isSuperAdmin()` reads `platform_admin_role` claim, returns `true` only for `'super_admin'`
   - `isSalesRep()` reads same claim, returns `true` only for `'sales_rep'` (NOT `!isSuperAdmin()` — tenant users lack the claim entirely)
   - Missing claim → `false` for both (safe default; handles pre-hook JWTs and tenant users)

3. **`src/lib/adminAuth.test.ts` (new)** — 6 unit tests (3 for `isSuperAdmin` + 3 for `isSalesRep`)

4. **`src/components/admin/AdminLayout.tsx` (modified)** — Replaced inline `decodeJwt` function with import from `../../lib/jwt`

5. **`src/components/admin/AdminSidebar.tsx` (modified)**:
   - Added `superAdminOnly?: boolean` to `NavItem` interface
   - Marked `/admin/plans` (Paket) and `/admin/revenue` (Pendapatan) with `superAdminOnly: true`
   - Added `useState<boolean | null>(null)` + `useEffect + isSuperAdmin()` pattern
   - Filters `NAV_ITEMS` using `!item.superAdminOnly || superAdmin !== false`

6. **`src/components/admin/AdminSidebar.test.tsx` (modified)** — Added `vi.mock('../../lib/adminAuth')` + `beforeEach` default (resolves `true`), plus 2 new role-filter cases (total: 8 tests)

## RED/GREEN test evidence

### RED (before rewriting adminAuth.ts):
```
src/lib/adminAuth.test.ts (6 tests | 6 failed)
  × returns true when JWT platform_admin_role=super_admin — expected undefined to be true
  × returns false when platform_admin_role=sales_rep — expected undefined to be false
  × returns false when claim missing — expected undefined to be false
  × returns true when JWT platform_admin_role=sales_rep — TypeError: isSalesRep is not a function
  × ... (3 more)
```

### GREEN (after rewrite):
```
src/lib/adminAuth.test.ts    6 passed (6) ✓
src/components/admin/AdminSidebar.test.tsx    8 passed (8) ✓
src/components/admin/PlansManagement.test.tsx    11 passed (11) ✓
Total: 25 passed (25)
```

## Full-suite test result

All pre-existing unit test failures are unchanged:
- `src/components/admin/AdminRoutes.test.tsx` — 2 pre-existing failures (searching for "Beranda Admin.*Task 8" / "Daftar Tenant.*Task 9" stub text — future tasks; confirmed pre-existing by stash verification)
- `tests/integration/**` — pre-existing; require live Supabase connection
- `tests/isolation/**` — pre-existing; require env vars

No NEW failures introduced by this task.

## `tsc --noEmit` result

```
(no output — clean compile, zero errors)
```

## Decision: extracted decodeJwt

Chose to extract to `src/lib/jwt.ts`. Rationale: AdminLayout already had the correct base64url implementation (with char replacement `replace(/-/g, '+').replace(/_/g, '/')`); keeping it as a DRY shared util avoids a second copy with a subtle difference (the plan snippet used `atob(payload)` without url-safe replacement, which would fail for Supabase JWTs). AdminLayout now imports from `../../lib/jwt` (3 lines removed, 1 import added).

## Decision: sidebar initial render approach

Chose **"show-all until resolved, then filter"**: `useState<boolean | null>(null)`, filter as `!item.superAdminOnly || superAdmin !== false`. This means:
- Super_admin: no flash (all items appear immediately in pending state, stay after resolve)
- Sales_rep: brief flash of Paket/Pendapatan before they hide on resolve

Acceptable per Note F (backend RLS + P0403 protect against actual damage during the flash window). The alternative ("hide until resolved") would cause a layout shift on every page load for all admin users, which is worse UX.

## Deferred E2E smoke

Sales_rep sidebar smoke cannot be performed in Task 3 — no `platform_admins` row with `role='sales_rep'` exists yet (Task 4/5 handle creation). Deferred to Task 5 (when a real sales_rep row exists) or Task 17 (final E2E). Unit tests with `waitFor` + mocked `isSuperAdmin` cover the filter logic adequately.

## Files changed

- `src/lib/jwt.ts` — new, shared decodeJwt helper
- `src/lib/adminAuth.ts` — rewritten (claim-based isSuperAdmin + new isSalesRep)
- `src/lib/adminAuth.test.ts` — new, 6 unit tests
- `src/components/admin/AdminLayout.tsx` — replace inline decodeJwt with import
- `src/components/admin/AdminSidebar.tsx` — superAdminOnly field + role filter
- `src/components/admin/AdminSidebar.test.tsx` — mock + 2 new role-filter cases

## Concerns

None. Implementation is clean. PlansManagement.tsx continues to work unchanged (async signature preserved). TypeScript strict mode passes with zero errors and no `any`.
