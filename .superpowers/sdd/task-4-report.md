# Task 4 Report: AuthScreen + App.tsx — gender threaded through login flow

**Date:** 2026-07-24
**Status:** COMPLETE

---

## Summary

Threaded `gender: 'M' | 'F' | 'N'` through the login flow so `currentUser.gender` is available for Task 5 (Sidebar AvatarBadge). Extended 4 code paths in AuthScreen.tsx (Props signature, dev-mode bypass, Supabase sign-in, sign-up), App.tsx currentUser state + handleLoginSuccess signature + session-restore, and downstream prop types in OrderHistoryScreen + PenjualanScreen.

Bonus catch: `adminUsersService.upsert()` in the sign-up path was missing `gender` — fixed.

---

## Files Modified

| File | Changes |
|---|---|
| `src/App.tsx` | `currentUser` state type extended; `handleLoginSuccess` signature extended; session-restore try/catch extended to read `adminRow.gender` (no second DB fetch). |
| `src/components/AuthScreen.tsx` | Props `onLoginSuccess` signature extended; `devBypass` adds `gender: 'F'` (Rini=female); Supabase sign-in path adds safeguard-read of `adminRow!.gender`; `adminUsersService.upsert()` adds `gender: 'N'`; sign-up `onLoginSuccess` adds `gender: 'N'`. |
| `src/components/OrderHistoryScreen.tsx` | `currentUser` prop adds optional `gender?: 'M' | 'F' | 'N'`. |
| `src/components/PenjualanScreen.tsx` | `currentUser` prop adds optional `gender?: 'M' | 'F' | 'N'`. |

---

## tsc --noEmit output

```
(no output — zero errors)
```

Zero TypeScript errors. No Sidebar.tsx issues (Task 5 addresses that).

---

## vitest --changed output

```
No test files found, exiting with code 0
```

No unit tests exercise these files directly — expected.

---

## Implementation notes

- Session-restore reuses existing `adminUsersService.fetchById()` call — no extra DB round-trip.
- Supabase sign-in reads `adminRow!.gender` with explicit `'M'|'F'|'N'` safeguard → defaults 'N'.
- Dev-mode: `gender: 'F'` (Rini = female, matches initialData.ts seed).
- Sign-up: `gender: 'N'` (no admin_users row available yet; updatable via User Management).
- No circular imports: inline `'M' | 'F' | 'N'` literals — did NOT import AvatarGender.

---

## Self-review

- [x] All onLoginSuccess call sites in AuthScreen updated (devBypass, sign-in, sign-up)
- [x] App.tsx state type + handler signature + session-restore consistent
- [x] adminUsersService.upsert() (sign-up) also fixed (caught by tsc)
- [x] Downstream prop types updated with optional gender?
- [x] No double-fetch in session-restore
- [x] tsc --noEmit = zero errors
- [x] vitest --changed = clean

---

## Commit SHA

(populated after commit)
