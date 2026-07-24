# Admin Gender Avatar — Task 3: UserManagementScreen gender field + upsert + dbToAdminUser + initialData

**Status:** DONE
**Date:** 2026-07-24

---

## Summary

Wired gender field through the entire create-admin flow in `UserManagementScreen.tsx`:
- Added `newGender` state (default 'N')
- Added 3-pill "Jenis Kelamin" radio (Cowok/Cewek/Netral) using existing Caleo design tokens
- Extended `dbToAdminUser` with gender safeguard for legacy rows
- Extended `adminUserToDb` to pass gender through to RPC call
- Both Supabase and dev-mode `handleCreateAdminSubmit` paths include gender + reset on success
- Updated `adminUsersService.upsert` in `supabaseClient.ts` to pass `p_gender` to RPC
- Updated `initialData.ts` seed admins: Rini='F', Agus='M'

---

## Files Modified

1. **`src/components/UserManagementScreen.tsx`**
   - Line ~81: added `const [newGender, setNewGender] = useState<'M' | 'F' | 'N'>('N');`
   - Lines ~50-60: `dbToAdminUser` — added gender safeguard + `gender: validGender` in returned object
   - Lines ~64-75: `adminUserToDb` — added `gender: u.gender ?? 'N'` to returned object
   - Lines ~206-214: Supabase path `newAdmin` — added `gender: newGender`
   - Line ~228: Supabase path reset — added `setNewGender('N')`
   - Lines ~240-248: dev-mode path `newAdmin` — added `gender: newGender`
   - Lines ~251-252: dev-mode reset — added `setNewGender('N')`
   - Lines ~359-381: added Jenis Kelamin pill-button group (AFTER WhatsApp, BEFORE Peran/Role)

2. **`src/lib/supabaseClient.ts`**
   - Line ~1217: `adminUsersService.upsert` RPC call — added `p_gender: user.gender ?? 'N'`

3. **`src/initialData.ts`**
   - Added `gender: 'F'` to Admin Rini seed
   - Added `gender: 'M'` to Admin Agus seed

---

## TypeScript compilation

```
npx tsc --noEmit
→ 1 error (AuthScreen.tsx:269 — Task 4 scope, expected)
```

Before Task 3: UserManagementScreen.tsx had no TS errors (types already from Task 2).
After Task 3: only AuthScreen.tsx error remains — correctly deferred to Task 4.

---

## Test output

```
npx vitest run --changed
→ Test Files  78 passed (78)
→ Tests  666 passed | 2 skipped (668)
→ Duration  10.69s
```

All green. No regressions.

---

## Self-review notes

- `adminUserToDb` needed gender added to satisfy `Omit<DbAdminUser, 'created_at'>` type — was missing before this task. All permission-toggle upserts now also pass gender correctly.
- Gender safeguard in `dbToAdminUser` handles legacy rows from before migration 000517: any value other than 'M'/'F'/'N' (including undefined/null from pre-migration rows) falls back to 'N'.
- Both code paths in `handleCreateAdminSubmit` (Supabase + dev-mode) updated — brief Step 4 requirement met.
- `p_gender` added to RPC call in `supabaseClient.ts` — explicit-pass so gender persists even though RPC has DEFAULT (brief Step 5 requirement met).
- Radio pill design uses only existing tokens: `bg-[#012749]`, `text-[#43474e]`, `border-[#e5eeff]`, `hover:border-[#abc9f3]`. No new tokens.

---

## Commit SHA

(populated after Step 9 commit)
