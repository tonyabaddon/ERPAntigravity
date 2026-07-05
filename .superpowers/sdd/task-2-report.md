# Task 2 Report — `suspend_tenant` + `activate_tenant` RPCs

**Status:** DONE
**Migration slot:** `20261115000011_phase_b_wave4a_suspend_activate_tenant`
**Applied:** 2026-07-05 via Supabase MCP on project `ekhhojaezdfjfwuxyjkl`

---

## Schema Findings

### `tenants` table columns (relevant to this task)

| column | data_type | nullable | generated |
|---|---|---|---|
| `status` | text | NO | no |
| `suspended_at` | timestamptz | YES | no |
| `suspended_reason` | text | YES | no |
| `archived_at` | timestamptz | YES | no |

All four target columns are regular (non-GENERATED). Safe to UPDATE all of them.

### `tenants.status` CHECK constraint

```sql
CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'SUSPENDED'::text, 'ARCHIVED'::text])))
```

All three values present — `ACTIVE`, `SUSPENDED`, `ARCHIVED`. No blockers. ARCHIVED guard test exercised in both smoke and pgTAP.

### `tenants` NOT NULL columns (for pgTAP fixture seeding)

Columns requiring values: `id`, `slug`, `name`, `status`. All four supplied in pgTAP fixture for the ARCHIVED test tenant.

---

## `platform_admin_audit` Action Code Whitelist

### State before this migration

```
IMPERSONATE_START, IMPERSONATE_END, CREATE_TENANT, CHANGE_PLAN,
CHANGE_FEATURES, SUSPEND, ACTIVATE, ARCHIVE, RENEW_SUBSCRIPTION
```

### State after this migration

```
IMPERSONATE_START, IMPERSONATE_END, CREATE_TENANT, CHANGE_PLAN,
CHANGE_FEATURES, SUSPEND, ACTIVATE, ARCHIVE, RENEW_SUBSCRIPTION,
SUSPEND_TENANT, ACTIVATE_TENANT
```

### Action-code duplication flag

The Wave 1 seed included generic `SUSPEND` and `ACTIVATE` codes. This migration adds more specific `SUSPEND_TENANT` and `ACTIVATE_TENANT` codes as instructed by the brief. The old codes are preserved in the whitelist to cover any existing audit rows but no new RPCs emit them. **The operator should acknowledge this intentional dual-code existence.** If the semantic intent is to consolidate, a future migration can relabel historic rows and drop the old codes from the CHECK — but that is out of scope here.

---

## Ownership Decision

Both RPCs call `auth.uid()` (for `admin_user_id` audit column) and SELECT from `platform_admins` (for `admin_email`). `vosi_rpc_owner` cannot be granted USAGE on the `auth` schema (`supabase_admin` owns it; `postgres` lacks `WITH GRANT OPTION`). Both functions are owned by `postgres`, consistent with Wave 1 Task 12 and Wave 4a Task 1.

Verified:
```
proname         | owner    | prosecdef
activate_tenant | postgres | true
suspend_tenant  | postgres | true
```

---

## Smoke Test Results

DO block with RAISE-based rollback. All 10 cases passed.

| # | Test | Result |
|---|---|---|
| SMOKE1 | non-admin `suspend_tenant` → P0403 | PASS |
| SMOKE2 | non-admin `activate_tenant` → P0403 | PASS |
| SMOKE3 | bad tenant `suspend_tenant` → P0404 | PASS |
| SMOKE4 | bad tenant `activate_tenant` → P0404 | PASS |
| SMOKE5 | empty/whitespace reason → 22023 INVALID_REASON | PASS |
| SMOKE6 | suspend Garindo → status=SUSPENDED, result ok=true | PASS |
| SMOKE6b | SUSPEND_TENANT audit row exists | PASS |
| SMOKE7 | idempotent suspend (2nd call) → noop=true | PASS |
| SMOKE8 | activate Garindo → status=ACTIVE, result ok=true | PASS |
| SMOKE8b | ACTIVATE_TENANT audit row exists | PASS |
| SMOKE9 | idempotent activate (2nd call) → noop=true | PASS |
| SMOKE10 | ARCHIVED guard → 22023 CANNOT_ACTIVATE_ARCHIVED | PASS |

Post-rollback verification:
- Garindo: `status=ACTIVE`, `suspended_at=null`, `suspended_reason=null` — clean.
- Audit table: 0 rows for `SUSPEND_TENANT` / `ACTIVATE_TENANT` — all rolled back.

---

## pgTAP Coverage

File: `supabase/tests/wave4a/suspend_activate_tenant.sql`
13 assertions across 13 cases.

| Case | Description |
|---|---|
| 1 | `suspend_tenant` non-admin → P0403 |
| 2 | `activate_tenant` non-admin → P0403 |
| 3 | `suspend_tenant` unknown tenant → P0404 |
| 4 | `suspend_tenant` empty whitespace reason → 22023 |
| 5 | `suspend_tenant` NULL reason → 22023 |
| 6 | `activate_tenant` unknown tenant → P0404 |
| 7 | `suspend_tenant` happy path: Garindo status=SUSPENDED |
| 8 | SUSPEND_TENANT audit row exists |
| 9 | `suspend_tenant` idempotent: noop=true |
| 10 | `activate_tenant` happy path: Garindo status=ACTIVE |
| 11 | ACTIVATE_TENANT audit row exists |
| 12 | `activate_tenant` idempotent: noop=true |
| 13 | `activate_tenant` ARCHIVED tenant → 22023 CANNOT_ACTIVATE_ARCHIVED (exercised — CHECK permits ARCHIVED) |

---

## Files Produced

- `supabase/migrations/20261115000011_phase_b_wave4a_suspend_activate_tenant.sql`
- `supabase/tests/wave4a/suspend_activate_tenant.sql`
- `docs/sdd/task-2-report.md` (this file)
