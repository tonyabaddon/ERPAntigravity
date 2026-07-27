# Task 6 Report — Type Widening + FE Service Layer

**Status**: DONE
**Date**: 2026-07-25
**Commit**: 98854d7 feat(kasir): typed RPC service for expense category CRUD + widen type

---

## Files Changed

- `src/types.ts` — widened `KasirExpenseCategory` union → `string`
- `src/lib/kasirExpenseCategoryService.ts` — new: typed service wrapping 5 SECDEF RPCs
- `src/lib/kasirExpenseCategoryService.test.ts` — new: 6 TDD assertions

---

## TDD Evidence

### RED Phase (before implementation)

```
 FAIL  src/lib/kasirExpenseCategoryService.test.ts
Error: Failed to resolve import "./kasirExpenseCategoryService" from
"src/lib/kasirExpenseCategoryService.test.ts". Does the file exist?

Test Files  1 failed (1)
     Tests  no tests
```

Confirmed: module-not-found failure before implementation.

### GREEN Phase (after implementation)

```
Test Files  1 passed (1)
     Tests  6 passed (6)
  Start at  14:56:36
  Duration  617ms
```

All 6 assertions pass.

---

## Test Results (6/6)

1. `create calls kasir_expense_category_create with trimmed label` — PASS
2. `create passes insertAfterId when given` — PASS
3. `create throws with KECT code parsed from PG error` — PASS
4. `update passes only provided fields` — PASS
5. `softDelete + restore call correct RPCs` — PASS
6. `reorder passes uuid array` — PASS

---

## Lint + Type-check

`npm run lint` (tsc --noEmit on full project): **CLEAN** (exit 0, no output).

Note: The brief specified `npm run type-check` but that script does not exist in this project. `npm run lint` is the tsc --noEmit check and runs cleanly.

---

## Impact Analysis

- `KasirExpenseCategory` type widening (union → `string`) affects:
  - `src/types.ts` lines 449, 524 (field types — no functional change, string is a supertype of union)
  - `src/components/KasirScreen.tsx` lines 7, 42, 597, 638 — existing usage still valid; `as KasirExpenseCategory` cast becomes a no-op cast to `string`
- New service file has zero importers (Tasks 7+ will consume it)
- No DB migration in this task

---

## Self-review Findings

- `unwrap<T>` helper correctly propagates KECT_* error messages — test 3 verifies this
- `patch.active ?? null` correctly handles `false` — `false ?? null` returns `false` (not null), so passing `{ active: false }` to update sends `p_active: false` as intended
- Type widening is a safe broadening — all existing union literal values remain valid `string` values
- No `any` types introduced; `unwrap<T>` is properly generic
