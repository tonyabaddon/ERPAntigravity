# Staging/Production Isolation — Design Spec

**Date:** 2026-07-22
**Approved:** founder OK'd 4-phase plan (this doc)
**Goal:** ship isolated staging + manual prod deploy gate before real tenant onboards this week.

## Problem

Real tenant onboards this week. Current pipeline auto-deploys every push to
BOTH staging and prod within one Cloud Build cycle (~10 min). No manual gate,
no data isolation. Any bug in code or accidental staging write can affect
real tenant data once onboarded.

## Requirements (from founder)

| # | Requirement | Verbatim |
|---|---|---|
| 1 | Scalable | "yang scalable" |
| 2 | Zero cost | "still zero cost karena belum ada real tenant" |
| 3 | Isolation | "tidak ada impact ke real tenants di production" |
| 4 | Auto staging, manual prod | "testing auto, deployment to production get approval dari saya dulu" |
| 5 | Dev → staging test → deploy prod → safe for real tenant | "semua yang didevelop di test dulu di staging, pastikan tidak ada bugs, baru deploy ke production, baru aman buat real tenant" |
| 6 | Best UX | "best UI/UX" — no clutter, no confusion |

## Non-goals

- **Not** replacing Supabase project with separate staging DB (would cost $25/mo). Env marker pattern gets 80% of the benefit at $0.
- **Not** implementing schema separation (Option C). Over-engineered for MSME scale.
- **Not** implementing Google Cloud Deploy. Manual promote script sufficient.
- **Not** blue/green deploys or canary. Direct traffic switch is fine at ≤10 tenants.

## Approach

**3-layer isolation defense:**

1. **Manual prod deploy gate** — bad code caught at staging, never reaches prod
2. **Env marker on `tenants` table + hostname-aware picker** — staging tenants physically separate `tenant_id` rows, only visible from `staging.app.caleo.id`
3. **Existing RLS (tenant_id-based)** — cross-tenant writes blocked at DB level regardless of app bug

## 4-Phase Rollout

### Phase 1 — Deploy control (2h + 30min gap-fill)

**What:** every push still auto-deploys to staging + auto-tests. But prod deploy stops at 0% traffic. Founder manually promotes.

**Files touched:**
- `cloudbuild.frontend.yaml` — remove Step 7 (auto-promote to 100%)
- `cloudbuild.yaml` (backend) — remove Step 6 (auto-promote to 100%)
- New: `scripts/promote-to-prod.sh <SHA>` — promote FE + BE together
- New: `scripts/rollback-prod.sh <SHA>` — revert FE + BE together
- New: `docs/runbooks/deploy-promote.md` — 1-page runbook (notification behavior, rollback path, pool-stuck troubleshooting, which services affected)

**Behavior after ship:**
- `git push origin main` → Cloud Build fires → staging deploy → smoke → **prod tag deployed at 0% traffic** → PIPELINE ENDS
- GCP emails you build success/failure
- You visit `staging.app.caleo.id`, verify feature works
- OK → `./scripts/promote-to-prod.sh <SHA>` → prod live in 5s
- Not OK → push fix → re-run cycle. Prod stays on old version.
- Bad post-promote → `./scripts/rollback-prod.sh <PREVIOUS_SHA>` → traffic revert in 5s

### Phase 2 — Data isolation (1 day + 2h gap-fill)

**What:** add `environment` column to `tenants`; create parallel staging tenants; hostname-aware picker.

**Migrations:**
- `20261115000508_tenant_environment_column.sql`:
  ```sql
  ALTER TABLE tenants
    ADD COLUMN environment TEXT NOT NULL DEFAULT 'production'
    CHECK (environment IN ('production','staging'));
  ```
  Backfill defaults all 3 existing tenants to `production`.

- `20261115000509_provision_tenant_env_param.sql`:
  ```sql
  CREATE OR REPLACE FUNCTION provision_tenant(
    p_owner_user_id UUID,
    p_slug TEXT,
    p_name TEXT,
    p_owner_name TEXT,
    p_owner_email TEXT,
    p_plan_code TEXT,
    p_expires_in_months INTEGER,
    p_environment TEXT DEFAULT 'production'
  ) RETURNS jsonb ...
  ```
  Existing signature backward-compat via default value. INSERT into tenants
  includes environment. Grant EXECUTE to authenticated (unchanged).

- `20261115000510_bootstrap_tenant_context_hostname.sql`:
  ```sql
  CREATE OR REPLACE FUNCTION bootstrap_tenant_context(p_hostname TEXT DEFAULT NULL)
  RETURNS jsonb ...
  ```
  Filter tenants by env matching hostname:
  - `staging.app.caleo.id` OR `staging.admin.caleo.id` → env `staging`
  - Everything else → env `production`
  - NULL hostname (backward compat) → env `production`

- Data seed (via `provision_tenant('...', p_environment => 'staging')`):
  - `garindo-staging`
  - `toko-jaya-makmur-staging`
  - `warung-sinar-rezeki-staging`
  - Each auto-seeded by `_seed_tenant_accounting` trigger (COA + accounting_config)
  - Add `wa_recipients`, `warehouses` (atas + bawah defaults), empty `bank_accounts`

- `tenant_users` links for existing users on staging tenants:
  - `tonywei.office@gmail.com` → all 3 staging tenants, role='owner', full permissions
  - `playwright-toko-owner@caleo.id` → toko-jaya-makmur-staging, role='owner'

**FE changes:**
- `SelectTenantScreen.tsx` — pass `window.location.hostname` to bootstrap RPC
- `tenantContextService.bootstrap()` — accepts optional hostname arg, forwards to RPC
- No changes to RLS policies (existing tenant_id-based RLS still enforces isolation)
- Ship migrations + FE **in same PR** to avoid mid-state confusion

### Phase 3 — E2E verify (2h + 1h gap-fill)

**Steps:**
1. Push a docs-only commit → Cloud Build fires
2. Verify: staging FE + BE both deploy, smoke passes, prod tag at 0% traffic (does NOT auto-promote)
3. Run `./scripts/promote-to-prod.sh <SHA>` → verify prod tag now at 100% traffic
4. Run `./scripts/rollback-prod.sh <PREVIOUS_SHA>` → verify traffic reverts to previous revision
5. Multi-tenant matrix (expanded to 6 tenants):
   ```sql
   3 prod × 3 staging tenants × 8 tables × 5 cross-pairs each = 240 checks
   ```
   Expected: 0 leaks across all combinations.
6. Playwright smoke against `staging.app.caleo.id`:
   - Login as `tonywei.office@gmail.com`
   - Verify only 3 staging tenants visible in picker
7. Playwright smoke against `app.caleo.id`:
   - Login as same user
   - Verify only 3 production tenants visible in picker
8. Cross-env leak test:
   - Login at staging.app.caleo.id → get JWT
   - Query prod tenant table via PostgREST → expect 0 rows (RLS enforced)

### Phase 4 — Real tenant onboard (founder call, ~30 min)

1. Founder visits `admin.caleo.id/admin/tenants` (or calls `provision_tenant`
   RPC directly with `p_environment='production'`)
2. New tenant row created with `environment='production'`
3. Verify: tenant appears at `app.caleo.id` (not `staging.app.caleo.id`)
4. Verify: existing playwright login at staging still shows only staging tenants (no leak)
5. Backup plan: `deprovision_tenant(new_tenant_id)` if issue emerges

## Component boundaries

Each unit does one job, isolated interface:

| Unit | Purpose | Depends on | Consumed by |
|---|---|---|---|
| `cloudbuild.frontend.yaml` | Build + staging deploy + smoke | staging BE health | Cloud Build trigger |
| `cloudbuild.yaml` | Backend build + staging deploy + smoke | Docker image, staging BE service | Cloud Build trigger |
| `scripts/promote-to-prod.sh` | `gcloud run services update-traffic --to-tags` for FE + BE | tag `c<SHORT_SHA>` exists on both services | founder CLI |
| `scripts/rollback-prod.sh` | Same as promote, different SHA | Any past tagged revision | founder CLI |
| `tenants.environment` column | Distinguish prod from staging tenants | (none, additive) | `bootstrap_tenant_context` + FE tenant picker |
| `bootstrap_tenant_context(p_hostname)` | Return tenants matching hostname env | `tenants` column | FE bootstrap |
| `provision_tenant(..., p_environment)` | Create new tenant with env | `tenants` column | Admin UI + Phase 2 seed script |

## Advisor consulted

Real advisor call before writing this spec. Advisor pushed back on:
- **Original over-engineering:** proposed Options A + B + C in parallel. Advisor:
  "founder consistently pushes back on over-engineering per memories (no_approval_workflow, defer_sop_profile, direct_launch_skip_phased). Option A is honest fit."
- **Timeline mismatch:** proposed 3-4 day build for "future risk." Advisor:
  "belum ada real tenant = zero risk today. Compress to Phase 1 now + Phase 2 before tenant #1."
- **Scope creep on approval mechanism:** advisor suggested "smallest thing = working staging URL + manual click. Not schema separation."

Founder pushback confirmed the challenge (asked if Phase 1 is wasted).
Answered honestly with the layered-protection framing (Phase 1 = code, Phase 2 = data).
Founder approved combined Phase 1 + Phase 2 for this-week-tenant-onboard timeline.

## I verified

- ✅ `provision_tenant(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER)` exists (migration 000029, extended 000031) — grep confirmed signature
- ✅ `bootstrap_tenant_context` exists (migration 000005 references it as SECDEF)
- ✅ `_seed_tenant_accounting` exists (migration 000053) — auto-seeds COA + accounting_config per new tenant
- ✅ `cloudbuild.frontend.yaml` Step 7 = auto-promote (`update-traffic --to-tags`) — read from file
- ✅ `cloudbuild.yaml` Step 6 = auto-promote (same pattern) — read from file
- ✅ `deprovision_tenant` exists (migration 000035) — Phase 4 backup path available
- ✅ Existing 3 tenants: Garindo, Toko Jaya Makmur, Warung Sinar Rezeki — from earlier user query
- ✅ Existing 8 registered users, 2 are platform admin — from earlier user query
- ✅ Sentry already wired (caleo-frontend + caleo-backend projects) via P3-02 sweep — Phase 3 monitoring covered by existing infra
- ✅ `feedback_app_caleo_routes_to_tenant_not_admin` memory + `postLoginRoute.ts` hostname-aware code already in place (dc74cdb) — Phase 2 hostname pattern reuses this

## Adversarial critique

- **(a) FE hostname at build vs runtime.** Vite bakes VITE_* env at build time. Hostname MUST be runtime (`window.location.hostname`). Confirmed hostname is runtime-only, no build-time coupling.
- **(b) `bootstrap_tenant_context` migration touches auth path — bad migration = login broken for ALL users.** Mitigation: test on staging first (which is possible after Phase 1 ships), CREATE OR REPLACE (idempotent), rollback via previous migration replay.
- **(c) `provision_tenant` signature change.** Backward-compat via `p_environment TEXT DEFAULT 'production'`. Existing callers without new param get correct default. No breakage.
- **(d) Tenant picker clutter after Phase 2.** Founder is member of 6 tenants but sees only 3 at any hostname (env filter). No clutter. ✅
- **(e) Cross-env SECDEF RPC write bypass.** SECDEF runs as owner but every SECDEF RPC filters by JWT tenant_id via `_resolve_tenant_id()`. Cross-env writes blocked at DB level regardless. ✅
- **(f) `ALTER TABLE tenants ADD COLUMN` lock.** ACCESS EXCLUSIVE for sub-second at 3 rows. No user impact.
- **(g) Staging staging URL unreachable during Phase 3.** Fallback: hit tag URL `https://c<SHA>---garindo-jaya-panel-msme-erp-frontend-xnrhcw7onq-as.a.run.app` directly.
- **(h) Real tenant created BEFORE Phase 2 ships.** Migration `ADD COLUMN ... DEFAULT 'production'` backfills all existing tenants correctly. Real tenant onboard timing doesn't matter as long as Phase 2 migration ships before onboard.
- **(i) Playwright users only linked to prod tenants.** Explicit Phase 2 seeding step adds them to staging tenants too. Without this, picker at staging would be empty.
- **(j) Pool exhaustion during Phase 2 migration apply.** Retry loop pattern (already proven in earlier Wave 1 work). If exhausted, wait/kill zombies/retry.
- **(k) What if founder onboards real tenant DURING Phase 2 build?** Race condition low but real. Founder must wait for Phase 2 verify before onboarding. Documented in Phase 4 as prerequisite: "Phase 3 verify complete."

## Success criteria

At end of Phase 3 (before real tenant onboard):
- Push to `main` → staging deploys + smokes AUTO → prod tag at 0% traffic (NO auto-promote)
- Promote script works: `./scripts/promote-to-prod.sh <SHA>` → prod live in 5s
- Rollback script works: `./scripts/rollback-prod.sh <SHA>` → traffic reverts in 5s
- `staging.app.caleo.id` shows only `environment='staging'` tenants in picker
- `app.caleo.id` shows only `environment='production'` tenants in picker
- Multi-tenant matrix 6 tenants × 8 tables × 5 cross-pairs = 0 leaks
- Playwright smoke at both hostnames pass

## Deliverables

- Migrations: 508 (env column), 509 (provision_tenant env), 510 (bootstrap_tenant_context hostname)
- Scripts: `promote-to-prod.sh`, `rollback-prod.sh`
- Runbook: `docs/runbooks/deploy-promote.md`
- Cloudbuild edits: `cloudbuild.frontend.yaml`, `cloudbuild.yaml`
- FE edits: `SelectTenantScreen.tsx`, `tenantContextService`
- Seed data: 3 staging tenants + tenant_users links
- Tests: expanded matrix + Playwright at both hostnames

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| bootstrap RPC migration breaks login | test at staging first; CREATE OR REPLACE; rollback via prior migration |
| Pool exhaustion mid-Phase-2 | retry loop pattern (proven) + optional pool-kill via Dashboard |
| Founder onboards real tenant before Phase 3 verify | documented prerequisite in Phase 4 |
| Promote script points to wrong service | script hardcodes both service names; SHA validation |
| Rollback attempt to broken revision | rollback script accepts explicit SHA; founder verifies target revision healthy first |

## Estimated total time

- Phase 1: 2h + 30min gaps = 2.5h
- Phase 2: 1 day + 2h gaps = 10h
- Phase 3: 2h + 1h expanded testing = 3h
- Phase 4: 30 min (founder-driven)
- **Total: ~2 working days + Phase 4**

## Next step

Founder reviews this spec. Once approved, invoke `writing-plans` skill to
create the implementation plan (tasks broken into 2-5 min steps per SDD
pattern).
