# Task 7 Report — Suspend / Activate row actions

**Status:** DONE

## Deliverables

1. **Created** `src/components/admin/SuspendTenantModal.tsx`
   - Renders null when `open=false`; full dialog with `role="dialog"` when open
   - Warning callout (`bg-vosi-danger/10 border-l-4 border-vosi-danger`) with Bahasa copy
   - Tenant name in JetBrains Mono inline style
   - `<textarea required minLength=5 maxLength=500>` for alasan
   - Konfirmasi Suspend disabled when reason < 5 chars or submitting
   - ESC + backdrop close (blocked while submitting)
   - On success: `adminToast.success('Tenant di-suspend.')`, calls `onSuccess()` + `onClose()`
   - On AdminApiError: toasts `err.userMessage`; on unknown error: generic toast

2. **Created** `src/components/admin/SuspendTenantModal.test.tsx`
   - 18 tests: renders null/open, warning callout, validation blocks, happy path,
     typed error, generic error, busy state, ESC, backdrop, Batal, reset on reopen
   - All 18 pass

3. **Modified** `src/components/admin/TenantsTable.tsx`
   - Added `useState` + `activateTenant` + `adminToast` + `SuspendTenantModal` imports
   - New prop `onRowActionSuccess: () => void`
   - Aksi cell: ACTIVE → Suspend button (VOSI tokens); SUSPENDED → Aktifkan button;
     ARCHIVED → `<span data-testid="no-action-archived-{id}">—</span>`
   - `handleActivate`: window.confirm → activateTenant → toast + callback
   - `SuspendTenantModal` rendered outside table rows; closes on success and calls `onRowActionSuccess`

4. **Modified** `src/components/admin/TenantsList.tsx`
   - Added `refreshKey` state; added to `useEffect` deps
   - Passes `onRowActionSuccess={() => setRefreshKey(k => k + 1)}` to `TenantsTable`

5. **Created** `src/components/admin/TenantsTable.test.tsx`
   - 12 tests: empty state, Suspend button on ACTIVE, Aktifkan on SUSPENDED,
     em-dash on ARCHIVED, modal opens on Suspend click, Aktifkan confirm/cancel,
     error paths (AdminApiError + generic), Impersonasi preserved alongside new buttons,
     onRowActionSuccess called after suspend success
   - All 12 pass

## Terminology choice

Used **"Suspend"** (English loanword, matching Wave 1's existing "● Suspended" status badge and
"Suspended" filter option). Consistent: button label, modal header, confirm button. Audit RPC
action code stays `SUSPEND_TENANT` (not user-facing).

## Test summary

| File | Tests | Status |
|------|-------|--------|
| SuspendTenantModal.test.tsx | 18 | ✅ all pass |
| TenantsTable.test.tsx | 12 | ✅ all pass |
| TenantsList.test.tsx | 9 | ✅ no regression |

Pre-existing failures (unrelated): `AdminRoutes.test.tsx` (2 tests looking for "Task 8/9"
placeholder text not yet built) + `AdminLayout.test.tsx` (sonner import error).

## TypeScript

`npx tsc --noEmit` — zero errors from new/modified files. Only pre-existing errors
(missing `pg`, `yaml`, `sonner`, `jsonwebtoken` type declarations in scripts/tests).

## Concerns

None.
