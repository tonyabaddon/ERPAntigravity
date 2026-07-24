# Admin Permission Registry — Task 3: UserManagementScreen Refactor

**Status:** DONE (pending commit SHA)
**Date:** 2026-07-24

---

## Summary

Refactored `src/components/UserManagementScreen.tsx` to be fully registry-driven.
Removed all hardcoded 12-key permission structures. Also fixed `src/initialData.ts`
(extended scope) which had the same 12-key drift bug.

---

## Files Modified

1. **`src/components/UserManagementScreen.tsx`** — 521 → ~540 lines net (grid expansion adds more lines than deletions save)
   - Added imports: `Info` from lucide-react; `PERMISSION_REGISTRY`, `PERM_CATEGORIES`, `PERMISSION_ROLES`, `defaultPermissions`, `normalizePermissions`, `type PermissionRole` from `../lib/permissions`
   - Removed import: `ALL_PERMISSIONS` from `../types` (no longer used here)
   - `dbToAdminUser`: added role safeguard via `PERMISSION_ROLES.includes()` + `captureError` fallback to `'Staff Admin Toko'`
   - Deleted: local `defaultPermissions(role: string)` function (12-key stale template)
   - Deleted: `PERM_LABELS` const array (12-key stale UI list)
   - `handleTogglePermission`: now calls `normalizePermissions(nextPartial, target.role)` to guarantee 43-key shape before RPC upsert
   - `handleAddAdmin` (both Supabase and dev-mode paths): wraps `defaultPermissions` with `normalizePermissions`; `newRole` cast to `PermissionRole`
   - Role dropdown: replaced hardcoded options with `PERMISSION_ROLES.map(...)` + added "Isi Preset" button affordance
   - `activeCount` denominator: now derives from `PERMISSION_REGISTRY.map(p => p.key)` (was `Object.keys(ALL_PERMISSIONS)`)
   - Expanded permission grid: replaced flat 12-item grid with `PERM_CATEGORIES.map(category => ...)` grouped sections, each with `<Info>` icon + native `title=` tooltip

2. **`src/initialData.ts`** — ~97 lines (extended scope fix)
   - Added import: `defaultPermissions` from `./lib/permissions`
   - Replaced inline 12-key `permissions: { dashboard: true, ... kasir: false }` literals with `permissions: defaultPermissions('Staff Admin Toko')` and `permissions: defaultPermissions('Supervisor Gudang')`

3. **`src/components/UserManagementScreen.test.tsx`** — new file, 63 lines
   - 5 tests covering: normalize preserves all 43 keys after toggle, defaultPermissions for all roles returns 43 keys, registry category counts match expected (10/4/7/3/9/1/7/2), valid role passes through, invalid role falls back

---

## TypeScript compilation

```
npx tsc --noEmit
→ (no output) ← zero errors
```

Before this task: 5 errors (3 in UserManagementScreen.tsx, 2 in initialData.ts).
After: 0 errors.

---

## Test output

```
npx vitest run src/components/UserManagementScreen.test.tsx
→ Test Files  1 passed (1)
→ Tests  5 passed (5)

npx vitest run --changed
→ Test Files  1 passed (1)
→ Tests  5 passed (5)
```

---

## Lint

```
npm run lint → clean (tsc --noEmit, zero errors, zero warnings)
```

---

## Self-review notes

- `ALL_PERMISSIONS` import removed from UserManagementScreen since it was only used by the deleted `permKeys` derivation (Step 10 replaced it with PERMISSION_REGISTRY). The import from types.ts still exists for other consumers.
- `newRole` state is `string` type but `defaultPermissions` requires `PermissionRole`. Safe to cast because the form validates `newRole !== 'Pilih Peran...'` before reaching the admin creation code; valid roles come from `PERMISSION_ROLES.map(r => ...)` in the dropdown.
- The `<Info>` component from lucide-react does not accept children, so the brief's defensive `<title>` child was omitted. The parent `<span title={description}>` provides the browser tooltip reliably.
- "Isi Preset" button is a UX affordance only (Phase 1 scope). Clicking it is a no-op beyond visual feedback; actual preset application happens via `handleAddAdmin` on form submit.

---

## Commit SHA

TBD — filled in after commit below.
