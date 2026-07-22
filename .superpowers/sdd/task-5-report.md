# Task 5 Report: 2B F5-10 — Error class branch for impersonate failure

**Status:** COMPLETED
**Date:** 2026-07-21
**Commit:** `6ee6ec9`

---

## Summary

When impersonation preflight fails (`impersonateGate === 'failed'`), all users
previously saw `TenantBootstrapError`. Now branches on `is_platform_admin` JWT claim:

- **Platform admin** (`is_platform_admin === true`) → `AccessDenied` (they navigated
  to a wrong or forbidden tenant slug)
- **Regular tenant user** (`is_platform_admin !== true`) → `TenantBootstrapError`
  (their own tenant is genuinely broken)

Sentry tag `error_class` is emitted before render with value `'impersonate'` or
`'tenant_bootstrap'`.

---

## Claim source (grep result)

```
grep -rn "is_platform_admin" src/ --include="*.ts" --include="*.tsx"

src/App.tsx:540: if (jwtClaims?.is_platform_admin === true) return;
src/App.tsx:571: const isAdmin = claims.is_platform_admin === true;
src/contexts/TenantContext.tsx:14: is_platform_admin: boolean;
```

Claim key is `is_platform_admin` (boolean) on the decoded JWT payload.
App.tsx already used this claim on line 540 (slug guard) and line 571
(impersonation preflight effect) — consistent spelling confirmed.

---

## Files modified

| File | Change |
|------|--------|
| `src/App.tsx` | Import `ImpersonateFailureScreen`; replace `TenantBootstrapError` hardcode in `impersonateGate === 'failed'` block with `<ImpersonateFailureScreen>` |
| `src/components/errors/ImpersonateFailureScreen.tsx` | New — pure component wrapping the branch + Sentry tag; takes `isPlatformAdmin`, `error`, `onRetry`, `onLogout` props |
| `src/components/errors/ImpersonateFailureScreen.test.tsx` | New — 6 unit tests covering both branches + Sentry tags |

### App.tsx change (impersonateGate === 'failed' block)

Before:
```tsx
if (impersonateGate === 'failed') {
  return (
    <TenantBootstrapError
      code={`IMPERSONATE_FAILED: ${impersonateError || 'unknown'}`}
      onRetry={() => window.location.reload()}
    />
  );
}
```

After:
```tsx
if (impersonateGate === 'failed') {
  return (
    <ImpersonateFailureScreen
      isPlatformAdmin={jwtClaims?.is_platform_admin === true}
      error={impersonateError}
      onRetry={() => window.location.reload()}
      onLogout={handleLogout}
    />
  );
}
```

---

## Test additions

File: `src/components/errors/ImpersonateFailureScreen.test.tsx` — 6 tests:

1. `renders AccessDenied when isPlatformAdmin=true` ✓
2. `emits Sentry error_class=impersonate tag when isPlatformAdmin=true` ✓
3. `renders TenantBootstrapError when isPlatformAdmin=false` ✓
4. `emits Sentry error_class=tenant_bootstrap tag when isPlatformAdmin=false` ✓
5. `includes error message in code when isPlatformAdmin=false` ✓
6. `falls back to "unknown" when error is empty and isPlatformAdmin=false` ✓

---

## Lint + vitest --changed result

```
npm run lint
→ tsc --noEmit (clean, no output)

npx vitest run --changed
→ Test Files  1 passed (1)
→ Tests  6 passed (6)

npx vitest run (full suite)
→ Test Files  114 passed (114)
→ Tests  1000 passed | 2 skipped (1002)
```

---

## Commit SHA

`6ee6ec9` — `[qa-week-followup] 2B: impersonate error class branch + Sentry tag`

---

## Notes

- Sentry is already imported in `App.tsx` (`import * as Sentry from '@sentry/react'`)
  but the Sentry tag emission lives in `ImpersonateFailureScreen` to keep the
  error-class logic co-located with the rendering logic.
- `jwtClaims` state is populated during session restore (before the impersonation
  effect runs), so it's available synchronously at render time when
  `impersonateGate === 'failed'`.
- `ImpersonateFailureScreen` calls `Sentry.setTag` during render (not in effect)
  which is acceptable: it's a one-time fire on error path, not a hot loop.
- AccessDenied.tsx and TenantBootstrapError.tsx were not modified.
