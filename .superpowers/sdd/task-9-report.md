# Task 9 Report (Wave 5) — FE: AdminRevenue dashboard `/admin/revenue`

**Status:** DONE  
**Commit:** `2dc009a`  
**Branch:** `worktree-phase-b-wave5`

---

## What was built

### Chart decision
Hand-rolled SVG (no recharts). Reasons: keeps deploy surface small (no new npm dep), VOSI palette adherence is straightforward in raw SVG, and Wave 4a socket-timeout concerns make any additional dependency risk worth avoiding.

### Files created (12 new)

| File | Purpose |
|------|---------|
| `src/lib/formatIDR.ts` | `formatIDR(n) → "Rp X.XXX.XXX"` — Indonesian locale, no cents, Math.trunc |
| `src/lib/formatIDR.test.ts` | 8 tests (1234567, 0, 1000, 3.6M, truncation, 1B) |
| `src/components/admin/AdminRevenue.tsx` | Orchestrator: parallel fetch, loading/error/empty/happy, coverage gaps callout |
| `src/components/admin/AdminRevenue.test.tsx` | 12 tests: loading, happy, empty, error/retry, coverage gaps, ARR/MRR computation, page title |
| `src/components/admin/RevenueKPIRow.tsx` | 4 KPI cards: Bulan ini (↑/↓ vs prev month), YTD, MRR estimasi, ARR estimasi |
| `src/components/admin/RevenueKPIRow.test.tsx` | 8 tests: computeMonthlyKPIs unit + 5 render tests |
| `src/components/admin/RevenuePlanBreakdown.tsx` | Horizontal bar chart SVG per plan (STARTER/PRO/PREMIUM), sorted PREMIUM→PRO→STARTER |
| `src/components/admin/RevenuePlanBreakdown.test.tsx` | 6 tests |
| `src/components/admin/RevenueMonthlyTrend.tsx` | 12-month polyline SVG with area fill, month labels, accessible fallback table |
| `src/components/admin/RevenueMonthlyTrend.test.tsx` | 5 tests |
| `src/components/admin/RevenueTopTenants.tsx` | Top-10 table: Rank/Nama/Paket badge/Total/Coverage badge; rows clickable → /admin/tenants/{slug}?tab=pembayaran |
| `src/components/admin/RevenueTopTenants.test.tsx` | 8 tests including row-click navigation, limit-to-10 |

### Files modified

- `src/components/admin/AdminSidebar.tsx` — Added "Pendapatan" nav item with `Coins` lucide-react icon after "Paket"
- `src/components/admin/AdminRoutes.tsx` — Imported `AdminRevenue`; added `/admin/revenue` pattern match

### Data fetching design

Parallel `Promise.all` for:
1. `getRevenueStats({ group_by: 'plan' })`
2. `getRevenueStats({ group_by: 'month' })`
3. `getRevenueStats({ group_by: 'tenant' })`
4. `listTenantsAdmin({ page_size: 50 })`
5. `listPlansAdmin()`

Then separately: `supabase.from('v_tenant_payment_coverage').select('*').eq('coverage_status', 'OVERDUE')` for coverage gaps.

### MRR / ARR computation

```
ARR = SUM(plans.price_annual for each ACTIVE tenant's plan_code)
MRR = ARR / 12
```

Computed client-side from `listTenantsAdmin` + `listPlansAdmin`. Empty state (0 active tenants or all null prices) → ARR=0, MRR=0.

---

## Test summary

| Suite | Tests | Result |
|-------|-------|--------|
| formatIDR | 8 | PASS |
| RevenueKPIRow | 8 | PASS |
| RevenuePlanBreakdown | 6 | PASS |
| RevenueMonthlyTrend | 5 | PASS |
| RevenueTopTenants | 8 | PASS |
| AdminRevenue | 12 | PASS |
| **Total new** | **47** | **PASS** |

Full `src/` suite: 4 test files failed (adminToast, AdminLayout, AdminRoutes stub, productWrappers) — all 7 failures are **pre-existing** from prior tasks, verified via `git stash` baseline. No new failures introduced.

---

## TypeScript

`npx tsc --noEmit` — 0 errors in any of the 14 new/modified files. Pre-existing 9 errors (pg/yaml/sonner/jsonwebtoken type stubs) unchanged.

---

## Concerns

1. **v_tenant_payment_coverage client-side SELECT** — View is admin-readable via Row Level Security (`p_platform_admin_readall` on the underlying view per Task 6). Platform admin JWT is always present in AdminRevenue context so direct client SELECT works correctly. No additional grants needed.

2. **SVG chart accessibility** — Each SVG chart has an accessible fallback `<table class="sr-only">` with all data. The main SVG has `role="img"` + `aria-label`. Individual data points have `<title>` tooltips. This satisfies basic a11y without recharts.

3. **Top-10 tenant join by key** — `getRevenueStats({ group_by: 'tenant' })` returns `breakdown[].key` which is the tenant_id (UUID) per the migration's `jsonb_build_object('key', t.tenant_id, ...)`. Client-side join uses tenant_id match first, slug fallback for robustness.

4. **Coverage gaps callout reuses RecordPaymentModal** — "Catat pembayaran" CTA opens RecordPaymentModal with the matching AdminTenantRow. If the tenant row isn't in the first 50 results from listTenantsAdmin, the CTA falls back to navigation link (`/admin/tenants/{slug}?tab=pembayaran`). This is acceptable as OVERDUE tenants will typically be in the top 50 active tenants.

---

# Task 9 Report (Wave 6) — Edge Function `create-tenant-owner`

**Status:** DONE
**Wave:** Wave 6 (Self-Service Tenant Onboarding)

## What was built

4 files created under `supabase/functions/create-tenant-owner/`:

- **`blocklist.ts`** — exports `SLUG_RE` (`/^[a-z0-9][a-z0-9-]{2,29}$/`) and `RESERVED_SLUGS` (20 entries: admin, api, auth, login, logout, register, signup, signin, www, mail, blog, docs, help, support, settings, pengaturan, t, select-tenant, onboarding, billing)
- **`deno.json`** — Deno config with `@supabase/supabase-js@2` import from esm.sh + `deno test --allow-net` task
- **`index.ts`** — Full Edge Function implementing:
  - CORS OPTIONS handler
  - JWT extraction + `platform_admin_role` claim check (E1/E2) for `super_admin` or `sales_rep`
  - Input validation: required fields (E11), slug format (E3), slug reserved (E4), email format (E6)
  - Two Supabase clients: `sb` (caller JWT, RLS-gated) and `sbAdmin` (service_role, for auth admin ops)
  - Slug uniqueness pre-check against `tenants` table → 409 E5
  - `inviteUserByEmail` with email-taken detection (E7) and general auth error (E8)
  - `provision_tenant` RPC call with all 7 params per Note A signature
  - Compensating rollback via `deleteUser` on RPC failure (E9 if rollback OK, E10 orphan if rollback fails)
  - `platform_admin_audit` insert of `PROVISION_TENANT` event (non-fatal on failure)
  - 201 success response: `{ tenant_id, slug, owner_user_id, expires_at }`
- **`index.test.ts`** — 13 Deno.test cases covering: valid slugs, too-short, too-long, leading-dash, uppercase, underscores, special chars, 30-char boundary, reserved list coverage, non-reserved slugs

## Syntax verification approach

Deno CLI not available on machine. Verification done via:
1. Visual eyeball of all files
2. Node.js brace-balance check — `index.ts` balanced 55/55 `{}`; `index.test.ts` balanced 29/29
3. Import paths verified: `./blocklist.ts`, `https://esm.sh/@supabase/supabase-js@2`, `https://deno.land/std@0.224.0/assert/mod.ts`

## Deploy note

Do NOT deploy from Agent context. Human must run:
```bash
supabase functions deploy create-tenant-owner
```

Deno tests can be run once Deno CLI is installed:
```bash
cd supabase/functions/create-tenant-owner && deno test --allow-net
```

## Concerns

1. **Deno CLI unavailable** — 13 tests written but not executed; human must run `deno test --allow-net` before relying on function in production
2. **inviteUserByEmail error matching** — E7 detection relies on substring match against Supabase auth error messages; if Supabase changes wording, E7 silently falls to E8
3. **`sb` client RPC** — if caller JWT expires between slug-check and provision_tenant call, RPC fails as E8/E9 rather than E1; acceptable for short-lived requests
4. **Audit non-fatal** — `platform_admin_audit` insert failure is logged but does not fail the 201 response; intentional since tenant is already provisioned

---

## Post-Review Fix

**Status:** DONE  
**Commit:** `e6e0562`  
**Fix:** Replaced try/catch on `deleteUser()` with `{ error }` return inspection (sbAdmin.auth.admin.deleteUser returns {data, error}, not throws)  
**Report path:** `/.superpowers/sdd/task-9-report.md`

---

# Task 9 Report — Caleo Phase 1 Hardening (Day 9): Idempotency batch 2 + health probe split

**Status:** DONE_WITH_CONCERNS  
**Date:** 2026-07-17 (autonomous session)

---

## What shipped

### Part A: Idempotency

#### `record_pembayaran` — DONE (migration slot 315)

**File:** `supabase/migrations/20261115000315_idempotency_record_pembayaran.sql`

Changes vs slot 239:
1. New overload: `record_pembayaran(payload jsonb, p_idempotency_key uuid DEFAULT NULL)` — backward compatible via DEFAULT NULL
2. Added `SET search_path TO 'public'` — slot 239 omitted this (pre-existing security gap fixed as side benefit)
3. `v_tenant_id := public._resolve_tenant_id()` extracted at function start (needed for idempotency lookup)
4. Idempotency short-circuit at top: checks `t_rpc_idempotency` by `(tenant_id, rpc_name, idempotency_key)` — returns stored `{pembayaran_number, pembayaran_id}` on replay
5. Stores result on success — no refetch needed (simpler than kasir_transactions pattern)
6. Both overloads GRANTed: `record_pembayaran(jsonb)` AND `record_pembayaran(jsonb, uuid)` — avoids the slot-314 overload-grant gap that affected Task 8

FE update: `src/lib/pembayaranService.ts` — `record()` now passes `p_idempotency_key: crypto.randomUUID()`.

#### `initiate_warehouse_transfer` — SKIPPED (intentional deviation from brief)

Slot 229 already implements idempotency via `p_client_request_id text`. The RPC checks `warehouse_transfers.client_request_id`, returns `{transfer_id, doc_no, idempotent: true}` on replay. FE already passes `clientRequestId`. Adding `t_rpc_idempotency` wrapping on top would create two overlapping sources of truth. No gap identified — existing mechanism covers network retry, timeout retry, and double-submit. No migration allocated.

### Part B: Health probe split

Files modified: `backend-go/main.go`, `cloudbuild.yaml`

- `/api/v1/live` — liveness probe. Returns 200 + "ok" unconditionally. No dep checks. Process-alive signal for Cloud Run restart.
- `/api/v1/ready` — readiness probe. Pings `dbClient.DB` with 2s timeout. Returns 503 if nil or Postgres unreachable. Returns 200 + "ready" when DB confirmed.
- `/api/v1/health` — preserved for backward compat.

Go structural fix: `var dbClient *db.Client` moved before mux handler setup (matches `var waClient *whatsapp.Client` pattern) so the `/api/ready` closure can reference it before assignment.

cloudbuild.yaml probe flags (syntax verified against `gcloud run deploy --help`):
- `--startup-probe=httpGet.path=/api/v1/ready,initialDelaySeconds=5,periodSeconds=5,failureThreshold=12`
- `--liveness-probe=httpGet.path=/api/v1/live,periodSeconds=30,failureThreshold=3`

---

## Gates

| Gate | Status |
|---|---|
| `npm run lint` (tsc --noEmit) | PASS |
| `npm run audit:numinput` | PASS |
| `npm run audit:secdef-null-tenant` | PASS |
| `npx vitest run --changed` | PASS (no changed test files) |
| `go build ./...` | PASS |
| Migration smoke test (pre-apply, RAISE EXCEPTION rollback) | PASS |
| Post-apply overload verification | PASS — both overloads confirmed |
| Advisors (post-migration) | PASS — no new findings |

---

## Migration slots

| Slot | Purpose | Status |
|---|---|---|
| 315 | `record_pembayaran` idempotency | Applied to prod |
| (316) | Originally `initiate_warehouse_transfer` | NOT USED — skipped (rationale above) |

Next free slot: **316**

---

## Concerns

1. **Prod curl verification pending** — `/live` + `/ready` probe endpoints registered in code and cloudbuild.yaml but not yet deployed. Stage 2 (Cloud Build) + Stage 3 (curl `/api/v1/live` + `/api/v1/ready` on prod URL) must follow commit + push.

2. **`initiate_warehouse_transfer` deviation from brief** — Founder may prefer consolidating to a single mechanism. Options: (a) keep `client_request_id` as-is; (b) deprecate `client_request_id` in favor of `t_rpc_idempotency` for consistency with other RPCs. Currently: option (a). No action needed unless founder disagrees.

3. **Old 1-arg `record_pembayaran(jsonb)` still has mutable search_path** — pre-existing WARN from slot 239. New 2-arg overload is clean (`SET search_path = public`). A future migration can DROP the old overload once all callers are confirmed passing the idempotency key.

---

## Return values

- **Status:** DONE_WITH_CONCERNS
- **Commit SHA:** pending (follows this session)
- **RPCs modified:** `record_pembayaran` (slot 315)
- **RPCs skipped:** `initiate_warehouse_transfer` (existing mechanism sufficient)
- **Probe endpoints verified:** registered + `go build` clean; prod curl pending deploy
