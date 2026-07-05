# Task 2 Report — list_tenants_admin RPC + v_tenant_usage_summary

**Status: NEEDS_CONTEXT**
**Date: 2026-07-05**
**Migration slot: 20261115000002** (VIEW + RPC deployed to prod; sort_by alias patch 20261115000002b also deployed)

---

## Schema Drifts Resolved (from controller brief)

### Drift A — `tenant_activity_daily.transaction_count` → `writes`
Applied per resolution: `writes` used as transaction proxy in `v_tenant_usage_summary` VIEW (txn_7d, avg_daily_txn) and all `usage_status` CASE thresholds. All thresholds are avg-daily-based:
- `SANGAT_AKTIF`: avg_daily > 100
- `AKTIF`: avg_daily >= 1
- `VAKUM`: last_login IS NULL OR last_login < now() - 30d
- `IDLE`: catch-all

### Drift B — `tenant_subscriptions.expiry_mode` → `v_tenant_effective_features.expiry_state`
Applied per resolution: JOINs `v_tenant_effective_features vef ON vef.tenant_id = t.id`, SELECTs `vef.expiry_state AS expiry_mode`. Confirmed `expiry_state` is TEXT, Garindo returns `'ACTIVE'`.

### Additional bug found and fixed during smoke test
`sort_by = 'created_at'` caused `column "created_at" does not exist` inside dynamic SQL — the CTE aliases `t.created_at` as `onboarded_at`. Fixed by mapping `'created_at' → 'onboarded_at'` via `v_sort_by_raw` (validated) → `v_sort_by` (alias-mapped), passed to `%I`. Deployed as patch migration 20261115000002b.

---

## VIEW SELECT list — `v_tenant_usage_summary`

```
tenant_id       UUID
last_login_at   TIMESTAMPTZ   -- MAX(auth.users.last_sign_in_at) via tenant_users
txn_7d          INT           -- SUM(tenant_activity_daily.writes) last 7 days
avg_daily_txn   NUMERIC       -- ROUND(txn_7d / 7, 1)
usage_status    TEXT          -- SANGAT_AKTIF / AKTIF / VAKUM / IDLE (all avg-based)
```

Garindo live values: `txn_7d=0, avg_daily_txn=0, usage_status=IDLE, last_login_at=2026-07-03T08:01Z`

---

## RPC RETURNS TABLE — `list_tenants_admin(p_filters jsonb)`

```
tenant_id         UUID
slug              TEXT
name              TEXT
plan_code         TEXT
status            TEXT
expiry_mode       TEXT          -- sourced from v_tenant_effective_features.expiry_state
activated_at      DATE
expires_at        DATE
days_until_expiry INT
user_count        INT
sku_count         INT           -- COUNT(*) FROM stocks WHERE tenant_id = t.id
industry          TEXT
employee_range    TEXT
onboarded_at      TIMESTAMPTZ   -- t.created_at aliased
last_login_at     TIMESTAMPTZ
txn_7d            INT
avg_daily_txn     NUMERIC
usage_status      TEXT
total_count       BIGINT        -- window COUNT(*) OVER () for pagination
```

Accepted `p_filters` keys (whitelist-validated, 22023 on unknown): `search`, `plan_code`, `status`, `expiry_within_days`, `page`, `page_size`, `sort_by`, `sort_dir`.
`sort_by` whitelist: `name`, `created_at`, `plan_code`, `expires_at`, `last_login_at`.

---

## NEW DRIFT — RLS Blocker (NEEDS_CONTEXT)

### Root cause (fully confirmed by evidence)

`tenants` has `relforcerowsecurity = true`. The only RLS policy is:
- policyname: `p_platform_admin_only`
- roles: `{authenticated}`
- qual: `_is_platform_admin_from_jwt()`

`list_tenants_admin` is `SECURITY DEFINER` owned by `vosi_rpc_owner`. SECURITY DEFINER switches the effective role to `vosi_rpc_owner` for all inner queries. `vosi_rpc_owner` is **not a member of `authenticated`** (confirmed):

```sql
SELECT pg_has_role('vosi_rpc_owner', 'authenticated', 'MEMBER');
-- → false
```

With `forcerowsecurity=true`, **default-deny** applies when no policy matches the current role → 0 rows even with valid admin JWT set in `request.jwt.claims`.

**Evidence:**
```sql
-- SET LOCAL ROLE vosi_rpc_owner + admin JWT → 0 rows
SELECT COUNT(*) FROM public.tenants;  -- → 0

-- Direct query as postgres (rolbypassrls=true) + admin JWT → 1 row (Garindo)
SELECT COUNT(*) FROM public.tenants;  -- → 1
```

### Blast radius

All 81 tables in `public` have `relforcerowsecurity = true`. The ones touched by `list_tenants_admin` and upcoming admin RPCs (Task 3: `audit_log`, `platform_admin_audit`; Task 5+: `tenant_users`, `tenant_subscriptions`, `company_settings`, `tenant_activity_daily`, `stocks`):

```
tenants, tenant_subscriptions, tenant_users, tenant_settings,
company_settings, tenant_activity_daily, stocks, audit_log,
platform_admin_audit, platform_admins, platform_admin_active_impersonation
```

This affects every future SECURITY DEFINER RPC owned by `vosi_rpc_owner` that reads any tenant-scoped table.

### Candidate fixes (controller decision required)

**A — `GRANT authenticated TO vosi_rpc_owner`** ← recommended
One line. Matches PostgREST convention. The existing `p_platform_admin_only` policy (gates on `_is_platform_admin_from_jwt()`) then correctly fires for `vosi_rpc_owner` too. No new policies needed on any table. No changes to `list_tenants_admin` itself.
Risk: `vosi_rpc_owner` inherits privileges granted to `authenticated`. For SECURITY DEFINER RPCs this is bounded by what each function exposes.

**B — Extend `p_platform_admin_only` to `{authenticated, vosi_rpc_owner}` on each table**
Must be applied to every table admin RPCs touch (8+ tables now, grows per task). Explicit but sprawling.

**C — `SET LOCAL ROLE authenticated` inside each SECURITY DEFINER function**
Requires A anyway (`SET ROLE` requires role membership). Extra boilerplate per function.

**D — `ALTER ROLE vosi_rpc_owner BYPASSRLS`**
Eliminates RLS for all `vosi_rpc_owner`-owned functions including non-admin RPCs. Not acceptable.

### Recommended action

Apply **Option A** as a prerequisite migration (`GRANT authenticated TO vosi_rpc_owner;`) in slot 20261115000001b or prepended to slot 20261115000003. Then re-run smoke tests for Task 2 — no changes to the existing RPC or VIEW code needed.

---

## Smoke Test Results (current state)

| Case | Description | Result |
|------|-------------|--------|
| 1 | Non-admin → P0403 | **PASS** |
| 2 | No-filter returns Garindo | FAIL — RLS blocker |
| 3 | plan_code=PREMIUM → Garindo | FAIL — RLS blocker |
| 4 | plan_code=STARTER → 0 rows | PASS (0 rows, correct but for wrong reason) |
| 5 | page=2, page_size=1 → 0 rows | PASS (0 rows, correct but for wrong reason) |
| 6 | sort_by=created_at,sort_dir=desc | FAIL — RLS blocker |
| 7 | search=Garindo | FAIL — RLS blocker |
| 8 | Unknown filter key → 22023 | **PASS** |
| 9 | v_tenant_usage_summary has Garindo row | **PASS** |

Cases 2/3/6/7 will all pass once `GRANT authenticated TO vosi_rpc_owner` is applied.

---

## Verified Prod State

- `v_tenant_usage_summary`: EXISTS, COMMENT set, returns Garindo correctly
- `list_tenants_admin`: EXISTS, owner=`vosi_rpc_owner`, EXECUTE granted to `authenticated`
- Auth gate: P0403 fires correctly for non-admin callers
- Key whitelist: 22023 fires for unknown filter keys
- `sort_by=created_at` alias mapping: fixed and deployed

Garindo inner-query row (confirmed via direct SQL as postgres/bypassrls):
`plan_code=PREMIUM, status=ACTIVE, expiry_mode=ACTIVE, expires_at=2099-12-31, days_until_expiry=26842, user_count=3, sku_count=474, industry=Retail/Toko umum, employee_range=4-19 orang (Kecil), txn_7d=0, avg_daily_txn=0, usage_status=IDLE`.
