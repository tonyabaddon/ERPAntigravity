# Task 4 Report: create_sales_rep + deactivate_sales_rep RPCs (Wave 6)

**Date:** 2026-07-10
**Commit:** `48e354e` feat(rls): create_sales_rep + deactivate_sales_rep RPCs (super_admin only)
**Status:** DONE_WITH_CONCERNS (Docker unavailable → MCP smoke only, as expected)

---

## MCP Pre-flight Verifications

| Check | Result |
|---|---|
| `platform_admin_audit_action_check` contains CREATE_SALES_REP + DEACTIVATE_SALES_REP | PASS |
| `platform_admins.email` is NOT NULL | PASS (is_nullable=NO) |
| `suspend_tenant` Wave 5 pattern fetched | PASS — `v_admin_email` from `platform_admins WHERE user_id = auth.uid()` |
| `platform_admin_audit` columns | id, admin_user_id (NN), admin_email (NN), tenant_id (nullable), action (NN), detail, ip_address, user_agent, created_at |
| `platform_admins_user_id_fkey` → `auth.users(id)` | Confirmed via `pg_constraint` (cross-schema FK; invisible to information_schema cross-join) |
| `platform_admins` columns | user_id, email (NN), role (default super_admin), created_at, created_by, status (default active), name |

**Key correction from pre-flight:** Note B's example showed `admin_email` resolved via `auth.users` subquery. Wave 5 canonical pattern (suspend_tenant) resolves it via `SELECT email FROM public.platform_admins WHERE user_id = auth.uid()`. Used Wave 5 pattern.

**Cross-schema FK discovery:** information_schema FK query returned empty for `platform_admins`; `pg_constraint` query revealed `platform_admins_user_id_fkey` → `auth.users(id)`. Caught in smoke DO-block (FK violation), fixed by seeding auth.users for the actor as well as the target before platform_admins INSERT.

---

## What Was Implemented

### Migration `supabase/migrations/20261115000036_sales_rep_lifecycle_rpcs.sql`

**`create_sales_rep(p_user_id UUID, p_email TEXT, p_name TEXT) RETURNS JSONB`**
- P0403 SUPER_ADMIN_REQUIRED gate via `_is_super_admin_from_jwt()`
- 22023 USER_ID_REQUIRED — p_user_id IS NULL check
- 22023 INVALID_EMAIL_FORMAT — regex check
- P0002 USER_NOT_FOUND_IN_AUTH — `EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id)`
- 22023 CANNOT_DEMOTE_SUPER_ADMIN — guard against demoting existing super_admin (Note E)
- INSERT with email (Note A fix), ON CONFLICT DO UPDATE
- `platform_admin_audit` INSERT: admin_user_id=auth.uid(), admin_email=v_admin_email (from platform_admins), tenant_id=NULL, action='CREATE_SALES_REP'
- OWNER TO postgres, REVOKE ALL FROM PUBLIC, GRANT EXECUTE TO authenticated
- `SET search_path TO 'public', 'pg_catalog'` per Wave 5 pattern

**`deactivate_sales_rep(p_user_id UUID, p_reason TEXT) RETURNS JSONB`**
- P0403 SUPER_ADMIN_REQUIRED gate
- UPDATE WHERE user_id = p_user_id AND role = 'sales_rep' (Note C: protects super_admin from accidental deactivation)
- P0002 SALES_REP_NOT_FOUND if NOT FOUND
- `platform_admin_audit` INSERT: action='DEACTIVATE_SALES_REP', tenant_id=NULL
- Same OWNER + GRANT pattern

### pgTAP Test `supabase/tests/wave6/sales_rep_lifecycle.sql`

plan(6) per Note F:
1. `lives_ok` — create_sales_rep succeeds for super_admin
2. `results_eq` — role=sales_rep, status=active
3. `throws_ok` — P0403 for sales_rep JWT
4. `lives_ok` — deactivate_sales_rep succeeds
5. `results_eq` — email column populated from p_email
6. `results_eq` — audit row: action=CREATE_SALES_REP, tenant_id NULL, email in detail

**Seed order corrected from plan:** auth.users for BOTH actor (22222222) AND target (55555555) seeded before `SET LOCAL role` — required by `platform_admins_user_id_fkey`.

---

## Prod Smoke Evidence (MCP DO-blocks, all RAISE-rolled-back)

| Smoke | Result |
|---|---|
| create_sales_rep super_admin path | SMOKE_ROLLBACK: role=sales_rep status=active email=smokerep@test.com audit=CREATE_SALES_REP |
| create_sales_rep P0403 gate | SMOKE_ROLLBACK: P0403 gate WORKS for create_sales_rep. sales_rep correctly blocked. |
| deactivate_sales_rep super_admin path | SMOKE_ROLLBACK: status=disabled audit=DEACTIVATE_SALES_REP |
| deactivate_sales_rep P0403 gate | SMOKE_ROLLBACK: P0403 gate WORKS for deactivate_sales_rep. sales_rep correctly blocked. |

RPC metadata: both `owner=postgres`, `security_definer=true`, `acl` includes authenticated.

---

## Concerns

1. **ACL includes anon** — existing global GRANTs give `anon=X/postgres` in addition to `authenticated`. Not introduced by this migration. SECDEF super_admin gate blocks unauthorized callers regardless. Cleanup in a dedicated ACL audit if needed.
2. **Docker unavailable** — pgTAP run substituted by 4 MCP DO-block smoke tests (all pass + rollback). DONE_WITH_CONCERNS per escalation policy.
3. **Founder JWT refresh** — founder must refresh JWT to pick up `platform_admin_role=super_admin` claim before calling these RPCs from the UI. Migration is unaffected.

---

## Files Produced

- `/Users/tonywei/IdeaProjects/ERPAntigravity/supabase/migrations/20261115000036_sales_rep_lifecycle_rpcs.sql`
- `/Users/tonywei/IdeaProjects/ERPAntigravity/supabase/tests/wave6/sales_rep_lifecycle.sql`
