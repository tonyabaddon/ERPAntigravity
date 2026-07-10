# Task 2 Report: Wave 6 RLS + Narrowed RPC Gates

**Date:** 2026-07-10
**Status:** DONE_WITH_CONCERNS (Docker unavailable; MCP smoke substitutes for local pgTAP RED/GREEN)
**Commit:** `f0c3a47` feat(rls): narrow tenant writes + suspend/activate/renew to super_admin

---

## 1. Verification Results (Pre-flight)

### plans.g_read_all
```
polname    | polcmd | using_clause | roles
g_read_all | r      | true         | authenticated,vosi_rpc_owner
```
Confirmed `USING (true)` — skipped per Note A. No change to plans policy.

### tenants + tenant_subscriptions existing policies
```
table                   | polname              | polcmd | using_clause                    | roles
tenants                 | p_platform_admin_only | *     | _is_platform_admin_from_jwt()   | authenticated,vosi_rpc_owner
tenant_subscriptions    | p_platform_admin_only | *     | _is_platform_admin_from_jwt()   | authenticated,vosi_rpc_owner
```
Confirmed: FOR ALL (`*`), TO authenticated,vosi_rpc_owner, USING _is_platform_admin_from_jwt(). Matches expected.

### RPC signatures (from pg_get_function_identity_arguments)
- `suspend_tenant(p_tenant_id uuid, p_reason text)` — matches (uuid, text)
- `activate_tenant(p_tenant_id uuid)` — matches (uuid)
- `renew_subscription(p_tenant_id uuid, p_new_expires_at date, p_new_plan_code text DEFAULT NULL, p_notes text DEFAULT NULL)` — matches (uuid, date, text, text)

No signature deviations. Proceeded with full implementation.

---

## 2. What Was Implemented

### Files Created
1. `supabase/migrations/20261115000033_rls_role_gates.sql`
   - DROP `p_platform_admin_only` on `tenants` + `tenant_subscriptions`
   - CREATE 8 replacement policies (4 per table):
     - `p_platform_admin_select` FOR SELECT `TO authenticated, vosi_rpc_owner` USING `_is_platform_admin_from_jwt()`
     - `p_super_admin_write` FOR INSERT `TO authenticated, vosi_rpc_owner` WITH CHECK `_is_super_admin_from_jwt()`
     - `p_super_admin_update` FOR UPDATE `TO authenticated, vosi_rpc_owner` USING+WITH CHECK `_is_super_admin_from_jwt()`
     - `p_super_admin_delete` FOR DELETE `TO authenticated, vosi_rpc_owner` USING `_is_super_admin_from_jwt()`

2. `supabase/migrations/20261115000034_narrow_rpc_gates_to_super.sql`
   - `suspend_tenant`: gate → `_is_super_admin_from_jwt()`, message → `SUPER_ADMIN_REQUIRED` (P0403)
   - `activate_tenant`: same gate change
   - `renew_subscription`: same gate change
   - OWNER TO postgres + REVOKE + GRANT preserved verbatim on all 3 RPCs
   - All other logic (audit inserts, idempotency guards, TENANT_NOT_FOUND, etc.) preserved verbatim from prod

3. `supabase/tests/wave6/rls_role_gates.sql`
   - 5 pgTAP assertions; seeds own test tenant UUID `11111111-2222-3333-4444-555555555555`
   - Tests: sales_rep SELECT (pass), UPDATE (blocked 42501), DELETE (blocked 42501), plans SELECT (pass), super_admin UPDATE (pass)

4. `supabase/tests/wave6/narrow_rpc_gates.sql`
   - 3 pgTAP assertions; seeds own test tenant UUID `99999999-9999-9999-9999-999999999999`
   - Tests: sales_rep → suspend_tenant P0403, activate_tenant P0403, renew_subscription P0403

---

## 3. Prod Smoke Evidence

### Policy verification (post-000033 apply)
All 8 policies confirmed on prod:
```
table                | polname               | polcmd | using_clause
tenant_subscriptions | p_platform_admin_select | r    | _is_platform_admin_from_jwt()
tenant_subscriptions | p_super_admin_delete    | d    | _is_super_admin_from_jwt()
tenant_subscriptions | p_super_admin_update    | w    | _is_super_admin_from_jwt()
tenant_subscriptions | p_super_admin_write     | a    | (WITH CHECK only)
tenants              | p_platform_admin_select | r    | _is_platform_admin_from_jwt()
tenants              | p_super_admin_delete    | d    | _is_super_admin_from_jwt()
tenants              | p_super_admin_update    | w    | _is_super_admin_from_jwt()
tenants              | p_super_admin_write     | a    | (WITH CHECK only)
```

### RPC gate smokes (post-000034 apply)
All ran as DO-block with `RAISE EXCEPTION 'SMOKE_ROLLBACK'` at end (no side effects on prod data).

- `suspend_tenant` with sales_rep JWT → P0403 SUPER_ADMIN_REQUIRED — PASS (SMOKE_ROLLBACK reached, not SMOKE_FAIL)
- `activate_tenant` with sales_rep JWT → P0403 SUPER_ADMIN_REQUIRED — PASS
- `renew_subscription` with sales_rep JWT → P0403 SUPER_ADMIN_REQUIRED — PASS
- Message correctness: SQLERRM verified as `'SUPER_ADMIN_REQUIRED'` (not old `'PLATFORM_ADMIN_REQUIRED'`)

---

## 4. Concerns

1. **Docker still unavailable** — pgTAP tests written but not run locally. No RED/GREEN cycle. MCP prod smoke is the only live verification. Tests are structurally correct (BEGIN/ROLLBACK, seeded UUIDs, correct errcode/message assertions) but CI has not confirmed GREEN.

2. **Garindo dashboard regression** — The `tenants` SELECT is preserved via `p_platform_admin_select` USING `_is_platform_admin_from_jwt()` (same predicate as old `p_platform_admin_only`). No regression expected, but human should verify Garindo dashboard renders normally post-migration as noted in Note E.

3. **REVOKE/GRANT explicit in 000034** — The original prod function bodies did not include REVOKE/GRANT in their pg_get_functiondef output (those were applied in separate prior migrations). Migration 000034 adds them explicitly following the Wave 5 OWNER TO postgres pattern. This is additive and correct, not a regression.

---

## 5. Post-Review Fix

### Finding
`rls_role_gates.sql` used `throws_ok(..., '42501', ...)` to assert RLS blocking on UPDATE/DELETE. Postgres RLS USING-clause silently filters rows rather than raising 42501; the test pattern was semantically incorrect.

### Replacement (Commit 70692cd)
Two assertions replaced:
- **Before:** `throws_ok($$UPDATE ... WHERE id = '11111111-2222-3333-4444-555555555555'::uuid$$, '42501', ...)`
- **After:** UPDATE statement executed, followed by `is((SELECT name FROM public.tenants WHERE ...), 'Test RLS Wave6', 'sales_rep UPDATE silently filtered — row unchanged')`

- **Before:** `throws_ok($$DELETE ... WHERE id = '11111111-2222-3333-4444-555555555555'::uuid$$, '42501', ...)`
- **After:** DELETE statement executed, followed by `is((SELECT count(*)::int FROM public.tenants WHERE ...), 1, 'sales_rep DELETE silently filtered — row still exists')`

**plan(5) unchanged:** 3 lives_ok + 2 is() = 5 total assertions.

### Caveats
- Seeded row name verified as `'Test RLS Wave6'` (line 12 of original file)
- Seeded UUID verified as `11111111-2222-3333-4444-555555555555` (line 12)
- SQL parses; assertion count preserved

---

## 6. Files Changed

- `/Users/tonywei/IdeaProjects/ERPAntigravity/supabase/migrations/20261115000033_rls_role_gates.sql`
- `/Users/tonywei/IdeaProjects/ERPAntigravity/supabase/migrations/20261115000034_narrow_rpc_gates_to_super.sql`
- `/Users/tonywei/IdeaProjects/ERPAntigravity/supabase/tests/wave6/rls_role_gates.sql` (post-review fix)
- `/Users/tonywei/IdeaProjects/ERPAntigravity/supabase/tests/wave6/narrow_rpc_gates.sql`
- `/Users/tonywei/IdeaProjects/ERPAntigravity/progress.md` (updated per CLAUDE.md requirement)
