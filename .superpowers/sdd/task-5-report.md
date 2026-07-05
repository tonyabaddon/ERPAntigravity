# Task 5 Report — adminApi wrappers + adminTypes extensions

**Status:** DONE  
**Date:** 2026-07-05  
**Branch:** worktree-phase-b-wave4a

## Files Modified

- `src/lib/adminTypes.ts` — Added `AdminApiError` abstract base class; refactored `PlatformAdminRequiredError` + `InvalidFilterError` to extend it; added 5 new error classes + 4 new interface/type exports (RenewSubscriptionInput, RenewSubscriptionResult, UpdatePlanInput, AttentionTenantRow, AttentionReason).
- `src/lib/adminApi.ts` — Extended `normalizeRpcError` with P0404 + message-gated P0403/22023 dispatch; added 5 new wrappers: `renewSubscription`, `suspendTenant`, `activateTenant`, `updatePlan`, `listAttentionTenants`.
- `src/lib/adminApi.test.ts` — Extended with 5 Wave 4a describe blocks (42 total tests, up from 21).

## SQL Sentinel Messages Verified

Before writing, verified exact RAISE EXCEPTION messages from each migration SQL file:

| SQLSTATE | message                  | throws                       | Source migration |
|----------|--------------------------|------------------------------|-----------------|
| P0404    | TENANT_NOT_FOUND         | TenantNotFoundError          | 000010, 000011  |
| 22023    | INVALID_EXPIRES_AT       | InvalidRenewalDateError      | 000010          |
| 22023    | INVALID_PLAN_CODE        | InvalidPlanCodeError         | 000010, 000012  |
| P0403    | SUPER_ADMIN_REQUIRED     | SuperAdminRequiredError      | 000012          |
| 22023    | CANNOT_ACTIVATE_ARCHIVED | CannotActivateArchivedError  | 000011          |
| 22023    | (other)                  | InvalidFilterError           | fallthrough     |
| P0403    | (other)                  | PlatformAdminRequiredError   | fallthrough     |

`listAttentionTenants` uses `p_expiry_within_days` parameter (verified from migration 000013).

## Test Results

```
npx vitest run src/lib/adminApi
  Tests  42 passed (42)
```

Full suite: 5 pre-existing failures unchanged (adminToast, AdminLayout, productWrappers×3, AdminRoutes×2 are pre-existing; adminApi added 21 new passing tests). Zero new failures.

## TypeScript

`npx tsc --noEmit`: same 9 pre-existing errors (pg, yaml, sonner, jsonwebtoken missing types). Zero new errors from Task 5 changes.

## Design Notes

- `AdminApiError` abstract base class introduced (brief assumed it existed; Wave 1 used `extends Error` directly). Both Wave 1 error classes updated to extend `AdminApiError` — `instanceof` chain preserved.
- `Object.setPrototypeOf(this, new.target.prototype)` called in `AdminApiError` constructor to fix prototype chain in transpiled JS.
- `normalizeRpcError`: P0404 checked first; P0403 checks `SUPER_ADMIN_REQUIRED` message before falling to `PlatformAdminRequiredError`; 22023 checks 3 specific messages before falling to `InvalidFilterError`.
- `updatePlan` returns `{ok: true; updated_keys: string[]}` — matches RPC RETURNS jsonb `updated_keys` key (list of jsonb_object_keys from p_updates).
