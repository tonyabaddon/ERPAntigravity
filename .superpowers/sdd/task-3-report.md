# Task 3 Report: Migration 523 — 5 SECDEF RPCs + Smoke Test

**Status:** DONE
**Date:** 2026-07-25

---

## Summary

Created migration file `supabase/migrations/20261115000523_kasir_expense_categories_rpcs.sql` containing 5 SECDEF RPCs for owner-only CRUD on `kasir_expense_categories` table:

1. **`kasir_expense_category_create`** — Creates category with label validation (3-40 chars), duplicate guard, fractional sort_order via insert_after_id
2. **`kasir_expense_category_update`** — Updates label/active flag, blocks system categories
3. **`kasir_expense_category_soft_delete`** — Soft-deletes (sets deleted_at), blocks system categories
4. **`kasir_expense_category_restore`** — Restores deleted row, guards label conflicts
5. **`kasir_expense_categories_reorder`** — Bulk reorder via uuid array, assigns sort_order = position * 10

All RPCs: SECURITY DEFINER, OWNER TO vosi_rpc_owner, owner role check inline, tenant auto-derived from JWT.

Includes smoke test exercising full CRUD + reorder flow, rolled back by final RAISE EXCEPTION.

---

## Files Modified

1. **`supabase/migrations/20261115000523_kasir_expense_categories_rpcs.sql`** (348 lines)
   - Lines 9-86: RPC 1 create
   - Lines 89-160: RPC 2 update
   - Lines 163-201: RPC 3 soft_delete
   - Lines 205-254: RPC 4 restore
   - Lines 258-301: RPC 5 reorder
   - Lines 304-328: Smoke test DO block

---

## Verification

```
$ head -5 supabase/migrations/20261115000523_kasir_expense_categories_rpcs.sql
-- 20261115000523_kasir_expense_categories_rpcs.sql
-- 5 SECDEF RPCs for owner CRUD on kasir_expense_categories.
-- All owner-only via inline admin_users role check.
-- Error taxonomy: KECT_FORBIDDEN (P0403), KECT_NOT_FOUND (P0404), KECT_IS_SYSTEM (P0403),
--                 KECT_LABEL_INVALID (P0400), KECT_LABEL_DUPLICATE (P0409), KECT_INVALID_ORDER (P0400).

$ wc -l supabase/migrations/20261115000523_kasir_expense_categories_rpcs.sql
     348 supabase/migrations/20261115000523_kasir_expense_categories_rpcs.sql
```

---

## Self-Review

**Transcription checks:**
- [x] All 5 function signatures match brief exactly (kasir_expense_category_create, update, soft_delete, restore, kasir_expense_categories_reorder)
- [x] All OWNER TO vosi_rpc_owner statements present (5 total, one per function)
- [x] All GRANT EXECUTE TO authenticated + REVOKE FROM anon triads correct (15 statements)
- [x] Error code mappings correct: KECT_FORBIDDEN→P0403, KECT_NOT_FOUND→P0404, KECT_IS_SYSTEM→P0403, KECT_LABEL_INVALID→P0400, KECT_LABEL_DUPLICATE→P0409, KECT_INVALID_ORDER→P0400
- [x] Smoke test final RAISE EXCEPTION 'SMOKE_TEST_OK' kept as brief specifies
- [x] All tenant filters use v_tenant_id from _resolve_tenant_id() (never client input)
- [x] Owner role check inline in every RPC via admin_users WHERE id=auth.uid() AND role='Owner'
- [x] Label validation: trim + 3-40 char bounds in create and update
- [x] Case-insensitive duplicate guard: lower(label) = lower(p_label) consistently applied
- [x] Sort order logic: create uses MAX+10 or fractional midpoint; reorder uses rn*10
- [x] FOR UPDATE locking on all SELECT statements preventing concurrent modification
- [x] Smoke test picks any Owner + tenant, exercises create→update→soft_delete→restore→reorder, rolls back via exception

**No issues found.** SQL transcription is clean and complete.

---

## Commit

- **Commit SHA:** `ae4677d`
- **Subject:** `feat(kasir): add 5 SECDEF RPCs for expense category CRUD`
- **Branch:** `feat/kasir-expense-categories`

---

## Next Steps

Steps 2, 3, 4 (apply on Supabase branch, verify RPCs exist, test negative paths) deferred to Task 13 batch apply.

Ready for migration apply when Task 13 batch process runs.

---

## Bugfix: Smoke-Test DO Block Transaction Semantics (2026-07-25)

**Bug:** Bare `DO` block without an `EXCEPTION` clause does not create a subtransaction. The `RAISE EXCEPTION 'SMOKE_TEST_OK'` at the end propagated to the outer migration transaction, which would abort all 5 `CREATE FUNCTION` statements above it. At Task 13 batch apply, the migration would fail and none of the RPCs would be installed.

**Fix:** Added `EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;` handler to the DO block. Postgres creates an implicit subtransaction when any `EXCEPTION` clause is present, so the RAISE rolls back only the smoke-test mutations while the outer migration tx commits the CREATE FUNCTIONs intact.

**KECT_* error codes** (P0400/P0403/P0404/P0409) are not caught by the handler and propagate normally — so a real RPC bug during smoke test would still abort the migration correctly.

**Files edited:**
- `supabase/migrations/20261115000523_kasir_expense_categories_rpcs.sql` — EXCEPTION handler added to DO block closing
- `docs/superpowers/plans/2026-07-25-kasir-expense-categories-configurable-plan.md` — Task 3 SQL snippet + Note paragraph updated to match

**Test evidence:** N/A (SQL not runnable in this environment). The test that WOULD cover it: Task 13 Stage 2 batch apply — expect migration succeeds, all 5 RPCs installed, no lingering smoke-test rows in `kasir_expense_categories`.

**Commit:** `f54b24a` — fix(kasir): smoke-test DO block needs EXCEPTION handler for clean rollback
