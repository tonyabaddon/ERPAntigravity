# Multi-Tenant Prerequisites — Design Spec

**Date:** 2026-06-13
**Status:** Draft — pending user review
**Scope:** Pre-requisites to onboard a second paying tenant (and beyond) onto a shared-DB SaaS deployment. This is a **decomposition spec** — each of the four layers below will get its own implementation spec when scheduled.

---

## Decisions locked at brainstorm

| | |
|---|---|
| Architecture | **Option 1 — shared DB. Garindo Jaya Panel becomes tenant #1.** Reasoning: dogfood the multi-tenant code against real workload before any paying customer joins. Bug-catcher mechanic puts construction-phase risk on the founder's own toko, not paying customers. |
| Layer sequence | **D-min → A → C-min → B → C-full → D-full** |
| Cross-tenant isolation | **Defense-in-depth, 5 layers** — RLS as floor, migration linter, SECURITY DEFINER RPC discipline, automated leak tests, audit log + monitoring |
| Module gating | Declarative `modules.requires_caps` + `tenants.capabilities` + compatibility check at 3 enforcement points (UI, DB trigger, runtime guard) |
| Packages | Snapshot-at-apply template (not live binding). `tenants.package_id` is metadata; `tenant_modules` is source of truth at runtime |
| Subscription | `subscription_expires_at` + 7-day grace + auto read-only mode + manual suspend |
| Retention | 90-day read-only → archive to GCS Coldline → hard delete after 1 year |
| WhatsApp | Garindo keeps whatsmeow (legacy). Paying tenants use Meta Cloud API. Calista + Sales Inbox + Pipeline + Notifications + Followup gated on `wa_backend` capability |
| Operator console | **Separate frontend app**, shared DB. Super-admin defined in separate `super_admin_users` table (not a boolean on `admin_users`) |
| Owner invitation | Magic link via Resend |
| Tenant-isolated FK | Composite FK `(tenant_id, ref_id)` on every cross-table relation |
| Monitoring | Sentry + PostHog + BetterUptime + internal health dashboard + email alerting via Resend |
| Tech ops AI | Investigation agent (Claude API) produces root-cause + draft PR. **Human review required before merge/deploy.** No autonomous fixes |

---

## 1. Goal & Scope

### 1.1 Goal

Make Vosi ready to onboard a second tenant — and grow to ~5-10 tenants — without rewriting the foundation, without leaking data across tenants, and without breaking Garindo (which is wife-owned and runs the business that funds development).

The owner wants three concrete capabilities, all delivered by this prerequisite phase:

1. An **operator dashboard** that onboards tenants and assigns modules from a catalog.
2. **Per-tenant module entitlements** so different packages serve different tenant needs.
3. **Safe production deployments** that don't disrupt running tenants.

### 1.2 Success criteria

- Garindo Jaya Panel runs on the multi-tenant code path with no data loss, no downtime longer than the agreed cutover window, no broken business operations.
- A second tenant (tenant #2) can be provisioned end-to-end from the operator console in under one operator-day.
- A cross-tenant data leak is structurally prevented by RLS + composite FK + RPC discipline + automated tests — verified by a CI-run leak-test suite that exercises every tenant-scoped table and every SECURITY DEFINER RPC.
- A deploy to production does not interrupt an in-flight kasir transaction for any tenant.
- A bug discovered in production has an investigation report generated automatically (with human review required before any fix is applied).

### 1.3 Out of scope (deferred to Phase 2+)

- Billing automation (Xendit/Midtrans). First tenants pay via manual bank transfer; operator extends `subscription_expires_at`.
- 2FA / MFA. Supabase auth supports it; enable per tenant on request.
- Public status page (`status.vosi.id`).
- Sandbox / demo environment for self-serve trial.
- Per-tenant rate limiting beyond Supabase defaults.
- Customer support ticketing system (WhatsApp/email to founder is enough for ≤5 tenants).
- Full Jurnal/Mekari migration tooling beyond the CSV wizard already roadmapped.
- PPN / e-Faktur / Coretax (conditional on PKP coherence check in roadmap §4).
- Mobile native app.
- Multi-language UI.
- GL / Neraca / Arus Kas (roadmap Phase 1 long pole — separate spec).
- Hutang-piutang feature build (separate Phase 1 spec).
- Returns from customer flow (separate spec).
- Barcode scan UX (separate spec).
- Calista Meta Cloud API integration (separate spec — until first paying tenant requests it).

### 1.4 Non-goals

- We are **not** building autonomous bug-fixing (AI may *investigate* and *propose*, but a human approves and merges).
- We are **not** moving Garindo to a separate dogfood instance. Garindo becomes tenant #1 in the shared DB.
- We are **not** building per-tenant Cloud Run services for the WhatsApp daemon (Garindo keeps its single existing daemon; paying tenants use Meta API which is stateless).
- We are **not** designing for >50 tenants in this spec. Shared-DB economics assume ≤20-30 tenants comfortably; rearchitecture for higher scale is a future problem.

---

## 2. Architecture decision: Option 1 — shared DB, Garindo as tenant #1

### 2.1 Decision

One Supabase project. One Cloud Run service for the tenant-facing app. One additional Cloud Run service for the operator console. The Garindo daemon (whatsmeow) is a third Cloud Run service that stays as-is. All tenant data lives in the same Postgres DB, isolated by `tenant_id` columns + RLS.

### 2.2 Alternatives rejected and why

| Alternative | Why rejected |
|---|---|
| **Per-instance deploys** (each tenant their own Supabase + Cloud Run) | Solo founder ops ceiling at ~3-5 tenants. Migration drift across tenants. Multi-tenant code never tested against real data until tenant #2 joins (= they become the canary). |
| **Garindo stays on separate instance, paying tenants on fresh shared-DB** | Code fork into two shapes. Construction-phase bugs surface against the paying tenant, not Garindo. Loses the dogfood validation entirely. Costs 2 Supabase projects forever. |
| **Schema-per-tenant in one Postgres** | Migration complexity scales linearly. Search-path and connection-pool overhead. Not solo-friendly. |

### 2.3 What Option 1 explicitly does NOT solve

These are surfaced again in the Residual Risk section so they cannot be quietly forgotten:

- A cross-tenant RLS policy bug = data of all tenants potentially exposed simultaneously.
- A migration that fails halfway affects every tenant at once.
- A SECURITY DEFINER RPC that forgets to assert tenant ownership = silent bypass.
- A noisy neighbor (high-traffic tenant) can degrade query performance for others.
- A bad frontend deploy hits all tenants at once (mitigated, not eliminated, by feature flags in Layer D-full).

---

## 3. Four-layer overview

```
┌──────────────────────────────────────────────────────────────┐
│  Layer D — Release safety                                   │
│    D-min: staging env + migration dry-run + off-peak deploy │
│    D-full: feature flags, canary, maintenance windows       │
├──────────────────────────────────────────────────────────────┤
│  Layer C — Operator console                                 │
│    C-min: separate frontend, super_admin_users, provision   │
│    C-full: entitlement editor UI, usage dashboard, audit    │
├──────────────────────────────────────────────────────────────┤
│  Layer B — Module / entitlement system                      │
│    modules + tenants + tenant_modules + packages +          │
│    compatibility check + 3 enforcement points               │
├──────────────────────────────────────────────────────────────┤
│  Layer A — Tenant foundation                                │
│    tenant_id everywhere + composite FK + RLS + auth         │
│    + storage tenant-scoping + RPC audit + per-tenant tz     │
└──────────────────────────────────────────────────────────────┘
```

### 3.1 Sequence and rationale

```
D-min   (3-5 days)   — staging + migration dry-run + off-peak discipline
   ↓
A       (3-5 weeks)  — tenant_id + RLS + composite FK + auth + storage
   ↓
C-min   (3-5 days)   — operator console: provision + subscription_expires_at
   ↓
[ ← Tenant #2 can onboard from here ]
   ↓
B       (1-2 weeks)  — entitlement matrix + Calista as first toggle
   ↓
C-full  (1-2 weeks)  — full entitlement editor + usage dashboard + impersonation
   ↓
D-full  (1-2 weeks)  — feature flags, canary, maintenance window per tenant
```

**D-min comes first** because Layer A involves ~40 migrations adding `tenant_id` to every table. Without staging, every migration is high-risk against Garindo's live data. D-min unlocks Layer A safety.

**B can wait** because roadmap §5 explicitly says: start with one flat tier + Calista as the gated add-on; don't design 3-tier pricing before customers ask. A single Calista toggle (already a primitive via `whatsapp_numbers.is_ai_enabled`) is enough until B lands.

**C-full and D-full are post-revenue** because they exist to support multiple tenants. They are not needed for tenant #2 onboarding.

---

## 4. Layer details

Each layer lists: **what it delivers**, **entry gate**, **exit gate**, **key prereqs at shape level**. Implementation detail is deferred to per-layer specs.

### 4.1 Layer D-min — staging environment + migration safety

**Delivers**

- Separate Supabase project for staging (free tier).
- Separate Cloud Run service for staging.
- `apply-pending-migrations.sh` runs against staging first, then prod (manual promote).
- Off-peak deploy discipline documented in `docs/runbooks/deploy.md`.
- Disaster recovery runbook in `docs/runbooks/disaster-recovery.md` covering Supabase outage, migration corruption, service-role key rotation.
- Supabase paid tier enabled on prod for PITR (~$25/month).

**Entry gate**

Garindo is running on prod (already true).

**Exit gate**

- A test migration on staging is verified to produce the expected schema.
- One end-to-end staging deploy is performed (no prod traffic; just smoke).
- The disaster recovery runbook is written and one rollback drill is performed against staging.

**Out of scope for D-min**

Feature flags, canary rollouts, per-tenant maintenance windows — these belong to D-full and need multi-tenant to be useful.

### 4.2 Layer A — Tenant foundation

**Delivers** (at shape level; implementation in per-layer spec)

- `tenants` table (id, name, package_id, capabilities jsonb, subscription_*, timezone, grace_period_days, read_only_mode, suspended).
- `super_admin_users` table (separate from `admin_users` — privilege escalation surface isolated).
- `tenant_id uuid NOT NULL` column on every tenant-scoped table. Pattern: nullable first, backfill, then `NOT NULL`.
- `admin_users` gains `tenant_id` column.
- **Composite FK** on every cross-table relation. Example: `orders` has `FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id)`. Each parent table gets `UNIQUE (tenant_id, id)` to make this possible.
- RLS enabled on every tenant-scoped table with uniform policy: `USING (tenant_id = current_tenant_id())` plus `OR EXISTS (SELECT 1 FROM super_admin_users WHERE user_id = auth.uid())`.
- `current_tenant_id()` helper function reads from `admin_users.tenant_id WHERE user_id = auth.uid()`.
- Every SECURITY DEFINER RPC audited; `assert_tenant_owns(p_table, p_id, p_tenant_id)` helper used at the top of each.
- Every storage bucket usage updated to use `{tenant_id}/...` path. Storage RLS policy filters by tenant. Audit list: invoice PDFs, payment proof uploads, bank statement OCR PDFs, company logo, payment proof of kasir transactions.
- `tenants.timezone` field (default `'Asia/Jakarta'`). Every view/RPC that computes "today" or "this month" for a tenant is updated to use `(now() AT TIME ZONE current_tenant_timezone())::date` instead of `now()::date`. Scope: kasir daily totals, expiry checks, anomaly comparisons, period close logic, heartbeat business-hours gate. System-level cron jobs (e.g. global cleanup) keep server time.
- Migration linter (pre-commit hook + CI check) that rejects `CREATE TABLE` migrations missing `tenant_id NOT NULL`, RLS enabled, and at least one policy.
- Automated cross-tenant leak test suite. Creates 2 tenants in CI, iterates all tables via `information_schema`, attempts cross-tenant access, asserts 0 leak.
- `security_audit_log` table for RLS denials, RPC tenant assertion failures, super-admin operations.
- Storage quota monitoring cron (daily) writing to `tenant_health_summary`; alert at >80% of plan quota.

**Entry gate**

D-min complete; staging available for migration dry-run.

**Exit gate**

- Garindo data has been backfilled with its tenant UUID (see §5).
- `security_audit_log` monitored for 2 weeks post-cutover: zero unexpected RLS denials, zero `assert_tenant_owns()` failures from app traffic.
- Cross-tenant leak test suite passes 100%.
- Composite FK constraints in place; no orphaned cross-tenant references.
- Migration linter is active in CI.

**Migrations involved**

- Each new table from this point onward follows the linter-enforced template.
- Existing tables get `tenant_id` added in batched migrations, ordered by domain (auth & users first, then catalog & stock, then transactions, then audit/log tables). Approximate count: 40-50 ALTER TABLE migrations.

### 4.3 Layer C-min — operator console MVP

**Delivers**

- New Vite app at `vosi-operator/` (separate from `src/` tenant app).
- Separate Cloud Run service (or single service with route-based serving — implementation decision deferred to per-layer spec).
- Hosted at separate URL (`operator.vosi.id` planned; alias acceptable for first deploy).
- Operator authenticates via Supabase auth pool. Routes only accept JWTs whose `user_id` matches a `super_admin_users` row.
- "Provision Tenant" form: name + owner email + package selector + subscription duration → creates tenant row, applies package template (populates `tenant_modules` from `packages.included_modules`), creates Supabase auth user for the owner, sends magic link via Resend, writes audit.
- Owner accepts magic link, sets password, lands in tenant app at `app.vosi.id`. First Owner is flagged `is_first_owner=true`.
- Subscription controls: extend `subscription_expires_at`, suspend, reactivate. Every action goes through `tenant_subscription_audit`.
- Tenant offboarding action (manual trigger): triggers 90-day read-only mode → 9-month archive countdown → cold-storage export + hard delete. Implementation of archive job itself is Phase 2; the trigger and timeline metadata land in Phase 1.

**Entry gate**

Layer A exit gate passed. `super_admin_users` exists. RLS verified.

**Exit gate**

- Tenant #2 can be provisioned end-to-end (operator clicks → owner receives email → owner logs in → owner sees empty tenant app ready to use).
- Operator can extend or suspend subscription; audit log records every action.

### 4.4 Layer B — Module / entitlement system

**Delivers**

- `modules` table seeded with the agreed catalog (kasir, stock, purchasing, recon, reports, ar, returns as core; pengawasan, gl, marketplace, rakit, barcode as toggleable Pro; calista, sales_inbox, pipeline, notifications, followup_poller as `wa_backend`-gated).
- `packages` table seeded with Starter, Pro, Premium, and `garindo_legacy` (internal-only, all modules including Calista).
- `tenant_modules` populated at provisioning from package template (snapshot semantics — package edits don't propagate to existing tenants).
- `tenant_module_compatibility(p_tenant_id, p_module_id)` function returning `(can_enable, missing_caps)`.
- DB trigger `enforce_module_compatibility` on `tenant_modules` BEFORE INSERT/UPDATE.
- Frontend sidebar reads `tenant_modules` at login; hides entries for disabled modules.
- Every protected RPC adds a guard: `IF NOT module_enabled('calista') THEN RAISE EXCEPTION 'module not enabled'; END IF`.
- Calista becomes the first real toggle: Garindo's `wa_backend = 'whatsmeow'`, paying tenants' `wa_backend = NULL` until Meta API integration ships (out of scope here).
- "Fail closed" runtime: if a module is enabled but tenant capability is missing, owner sees a banner ("Calista paused: WhatsApp backend not configured"). No crash, no data leak.

**Entry gate**

Tenant #2 has been provisioned and is running (C-min done) — entitlement system is not blocking onboarding.

**Exit gate**

- Operator can toggle any module per tenant; incompatible modules are greyed out with clear reason.
- Runtime guard tested: enabling Calista without `wa_backend` capability returns the fail-closed banner, never crashes.
- DB trigger rejects direct INSERT into `tenant_modules` with incompatible state.

### 4.5 Layer C-full — operator console full features

**Delivers**

- Entitlement matrix editor (the visual grid in operator console).
- Per-tenant usage dashboard reading from `tenant_health_summary` + PostHog.
- Internal Tenant Health dashboard (the green/yellow/red per-tenant view).
- Investigation reports page (tech ops AI output review).
- Impersonate-tenant flow with required reason + red banner + audit.
- Subscription extend / suspend / package-change UI flows (manual UI for what was raw SQL in C-min).

**Entry gate**

Layer B complete.

**Exit gate**

- Each operator workflow is doable in the UI, not requiring direct DB access.
- Audit log captures every super-admin action (including reads via impersonation).

### 4.6 Layer D-full — release safety machinery

**Delivers**

- `release_flags` table (distinct from `tenant_modules` entitlements — different lifecycle).
- Feature flag evaluation in frontend (boot-time fetch + cache).
- Canary rollout: flip flag for one tenant first, watch metrics for N hours, then promote.
- Per-tenant maintenance window config in `tenants.maintenance_window_*`.
- Frontend bundle versioning: in-flight kasir transactions complete on the bundle they started with, even after a new deploy.

**Entry gate**

Layer B complete. 2+ tenants live.

**Exit gate**

- A canary rollout is demonstrated end-to-end (flag flipped for Garindo, watched, then flipped for all).
- A kasir transaction initiated 5 seconds before a frontend deploy completes successfully after the deploy.

---

## 5. Garindo cutover plan

This is the **single riskiest operation** in the project. Garindo is wife-owned and her livelihood; a botched cutover risks her business and the marriage. Treat this with maximum discipline.

### 5.1 Pre-cutover prep (all must be true)

- Supabase paid tier active on prod with PITR enabled.
- Manual snapshot of Garindo's DB taken via `pg_dump` and downloaded to two physically separate locations (local + GCS).
- Staging Supabase project has the **exact same schema as prod** (verified by `pg_dump --schema-only` diff = 0 lines).
- Layer A migrations (40-50 of them) have been dry-run on staging against a recent copy of Garindo's prod data — completed without error, schema diff matches expectations.
- Cross-tenant leak test suite is in place and passes against staging.
- Garindo UUID is pre-allocated and stored in a known constant: `GARINDO_TENANT_ID = '<fixed uuid>'`.
- Cutover window scheduled: WIB 23:00-04:00 (toko closed, lowest activity).
- Rollback SQL prepared and dry-run on staging.
- Wife is informed of the maintenance window and agrees to it.

### 5.2 Cutover steps

1. **T-30 min** — Banner in Garindo app: "Maintenance in 30 minutes."
2. **T-0** — Banner: "Maintenance in progress." App goes to read-only mode for 60-90 min.
3. **T+0:05** — Apply Layer A migrations to prod in batched order:
   - First batch: create `tenants`, `super_admin_users`, `packages`, `modules`, `tenant_modules` tables; INSERT Garindo row with `GARINDO_TENANT_ID`; INSERT all packages; INSERT all modules; INSERT `tenant_modules` rows for Garindo with all modules enabled.
   - Second batch: `ALTER TABLE` adds `tenant_id uuid` (nullable) on every tenant-scoped table.
   - Third batch: `UPDATE` every tenant-scoped table to set `tenant_id = GARINDO_TENANT_ID` for all existing rows. Run as separate transactions per table; verify row counts.
   - Fourth batch: `ALTER TABLE ... ALTER COLUMN tenant_id SET NOT NULL` once verified.
   - Fifth batch: add composite FK constraints. Each parent table first gets `UNIQUE (tenant_id, id)`; each child table's FK changes from `(parent_id)` to `(tenant_id, parent_id)`.
   - Sixth batch: enable RLS on every table; create policies.
4. **T+0:45** — Verification queries:
   - `SELECT COUNT(*) FROM orders WHERE tenant_id IS NULL` → must be 0.
   - Same check for every tenant-scoped table.
   - Existing API endpoints respond with same data as pre-cutover (smoke test from staging copy of frontend).
5. **T+0:50** — Deploy new frontend + new backend that resolve tenant via `current_tenant_id()`. RLS is active and enforcing from this point. SECURITY DEFINER RPCs that received a fresh `assert_tenant_owns()` assertion are initially configured to **log-only** (write to `security_audit_log` on mismatch, but do not raise) — this is the "shadow mode" for the RPC-level guard. RLS itself is fully enforcing immediately.
6. **T+1:00** — Lift maintenance banner. Owner does 1 test kasir transaction; verify it lands with correct tenant_id.

### 5.3 Verification (post-cutover, 2-week window)

- Daily check of `security_audit_log` for unexpected RLS denials.
- Daily check that all 40-50 cron jobs and pollers (heartbeat, expiry, followup) continue to behave normally.
- After 2 weeks of zero anomalies, **shadow mode → enforcement mode**: the few RPCs that still log-only-on-tenant-mismatch are switched to raise-on-mismatch.

### 5.4 Rollback SQL (must be ready BEFORE cutover starts)

If verification at T+0:45 fails:

```sql
-- 1. Drop new composite FKs (reverse order)
-- 2. Drop new RLS policies
-- 3. ALTER TABLE ... DROP COLUMN tenant_id (every table)
-- 4. DROP TABLE tenant_modules, modules, packages, tenants, super_admin_users
-- 5. Restore frontend bundle to previous version (Cloud Run revision rollback — single command)
```

This rollback is verified on staging before the prod cutover starts. If staging rollback works in <30 min, prod rollback budget is 60 min before invoking PITR restore.

If rollback fails or takes >60 min: invoke Supabase PITR restore to T-5min snapshot. Wife loses ~5 min of business activity (typically <1 transaction at that hour). Acceptable.

### 5.5 Go/no-go criteria

Cutover **proceeds** only if all are true at T-0:
- Staging dry-run completed without error in the past 7 days.
- Rollback SQL dry-run on staging succeeds in <30 min.
- PITR confirmed working (one restore drill performed on a test project).
- Wife is informed and on standby.
- Founder is well-rested and unhurried.

Cutover **aborts** at T-0 if any are false. There is no shame in aborting; pick a new window.

---

## 6. Cross-tenant isolation — 5-layer defense

| Layer | Mechanism | Scales by |
|---|---|---|
| 1 | RLS policy on every tenant-scoped table — `USING (tenant_id = current_tenant_id())` | Template migration; every new table inherits the pattern |
| 2 | Migration linter (pre-commit + CI) that rejects tables without `tenant_id NOT NULL` + RLS + policy | Centralized rule; new tables can't bypass |
| 3 | SECURITY DEFINER RPC discipline: `assert_tenant_owns()` helper called at top of every RPC; code review checklist | Helper is shared; every RPC reuses the same primitive |
| 4 | Automated cross-tenant leak test suite (CI gate): creates 2 tenants, enumerates tables and RPCs from `information_schema`, attempts cross-tenant access, asserts 0 leak | Test enumerates dynamically; new tables auto-covered |
| 5 | Runtime monitoring: `security_audit_log` records every denial; alerting fires on spikes | Single audit log; alert rules centralized |

The scaling property: as new tables and RPCs are added, the isolation guarantee does not degrade because new code automatically inherits the patterns from layers 1, 2, and 4. There is no manual step to repeat per table.

---

## 7. Module catalog, packages, subscription

### 7.1 Module catalog (initial seed)

| Category | Modules |
|---|---|
| Always-on core | kasir, stock, purchasing, recon, reports, ar, returns, approvals |
| Toggleable Pro/Premium | pengawasan, gl, marketplace, rakit, barcode |
| WA-backend-gated (requires `wa_backend:any`) | calista, sales_inbox, pipeline, notifications, followup_poller |

### 7.2 Packages (initial seed)

| Package | Modules |
|---|---|
| Starter | kasir, stock, purchasing, recon, reports, ar, returns |
| Pro | Starter + pengawasan + barcode |
| Premium | Pro + gl |
| garindo_legacy | All modules including calista (`wa_backend = 'whatsmeow'`) |

Calista is **not** in any paid package. It is sold as an add-on once Meta Cloud API integration ships.

### 7.3 Subscription lifecycle

```
Active (now < expires_at)
   ↓ T-14d → banner "Subscription expires in 14 days"
   ↓ T-7d  → banner red
   ↓ T-0   → grace period (default 7 days)
   ↓ T+grace → read_only_mode = true (auto via cron or login check)
              banner persists: "Subscription expired — contact admin to renew"
   ↓ +90 days → archive trigger fires (Layer C-full)
   ↓ +9 months → cold-storage export to GCS Coldline
   ↓ +1 year → hard delete
```

Manual `suspended = true` bypasses lifecycle; login is blocked entirely. Reactivation requires operator action + audit.

Garindo gets `subscription_expires_at = '2099-01-01'` — same code path, no special-casing.

### 7.4 Three enforcement points (recap)

1. **Operator UI** — `tenant_module_compatibility()` called when rendering the entitlement matrix; incompatible modules are visually greyed out.
2. **DB trigger** — `BEFORE INSERT/UPDATE OF enabled ON tenant_modules WHEN (NEW.enabled = true)` — raises if incompatible.
3. **Runtime guard** — every protected RPC checks `module_enabled()` at entry and fails closed.

---

## 8. Operator console architecture

- Frontend: separate Vite app `vosi-operator/`. Shares types/components with tenant app via npm workspace package.
- Hosting: separate Cloud Run service (cleanest) or same service with path-based routing (cheaper). Decision deferred to per-layer spec.
- URL: `operator.vosi.id` (or initial deploy at subpath until DNS is configured).
- Auth: same Supabase auth pool. Operator login flow uses the standard Supabase magic-link form but the operator app rejects any JWT whose `user_id` is not in `super_admin_users`.
- Privilege escalation surface: `super_admin_users` has no UI that writes to it. Rows are inserted manually via Supabase Studio SQL editor. A tenant admin cannot promote themselves through any application path.
- Audit: every super-admin action writes to `super_admin_audit_log`. Impersonation sessions are tagged separately and shown with full query log.

---

## 9. Monitoring & tech ops

### 9.1 Five-layer monitoring stack

1. **Sentry** — frontend + backend exceptions, tagged with `tenant_id`, `user_id`, `module`.
2. **PostHog** — business event tracking, per-tenant funnels, anomaly detection.
3. **BetterUptime** (or UptimeRobot) — external health checks against `/healthz`.
4. **Internal health dashboard** in operator console — green/yellow/red per tenant, surfaces anomalies, drills into events.
5. **Email alerting via Resend** — anomaly detector cron writes to `alert_queue`; dispatcher sends to founder's email.

### 9.2 Tech ops investigation agent

When an alert fires (Sentry, anomaly, monitor failure):

1. `investigation_queue` row inserted.
2. Investigation worker (Cloud Run Job) fetches: Sentry event, recent commits in stack-trace files, Cloud Run logs around timestamp, `system_events` for the tenant.
3. Worker calls Claude API with a structured prompt asking for: likely root cause, suggested fix as a diff, confidence level. Cost estimate: $0.15-0.30 per investigation. Hard cap $1.
4. Worker writes `investigation_reports` row and optionally opens a GitHub Draft PR.
5. Email sent to founder with link to operator console review screen.
6. Founder reviews, accepts/rejects/iterates with additional prompt. Accepted fix → standard PR review → merge → standard deploy through Layer D safety machinery.

**No autonomous merge or deploy.** Confidence HIGH does not bypass human review. Software handles wife's livelihood and (eventually) paying customers' books; the 5% catastrophic case is unacceptable.

### 9.3 Predefined auto-remediation (runtime patterns, not AI)

These are code patterns built into the application, not decisions made by AI:

- RPC deadlock → exponential backoff retry in Go client and frontend.
- Daemon Cloud Run crash → Cloud Run auto-restart (built-in).
- Frontend chunk-load error after deploy → hard reload trigger.
- Sentry quota exceeded → sample rate auto-reduce.
- RLS denial spike from one user → auto-suspend user after N denials (potential attack).

### 9.4 Email infrastructure (Resend)

One Resend integration serves: owner invitation, subscription notifications, alert emails, password resets, investigation summaries. Single integration eliminates the question "which email service for X."

---

## 10. Residual risk surface — explicit

Option 1 (shared DB) gives the bug-catcher advantage but does **not** eliminate these risks. They are surfaced here so the project doesn't pretend they don't exist.

| Risk | Mitigation in this plan | Residual |
|---|---|---|
| RLS misconfig leak | 5-layer defense; shadow mode; CI leak tests | A bug that passes all 5 layers leaks all tenants simultaneously. The mitigation is rigor of testing, not architecture. |
| Migration blast radius | Staging dry-run; off-peak window; PITR | A migration that fails halfway in prod affects every tenant. Rollback is fast (Cloud Run revision); data damage may need PITR restore for all tenants. |
| SECURITY DEFINER RPC bypass | `assert_tenant_owns()` helper; code review; audit log | A new RPC that forgets the assertion is the highest-likelihood individual leak vector. Migration linter and CI test cover schema; only code review covers RPC code. |
| Noisy neighbor | Supabase Pooler; monitoring | One tenant's heavy query slows others. Not mitigated by architecture; needs query-level optimization or per-tenant resource caps (Phase 2). |
| Shared deploy blast radius | Off-peak deploy in D-min; feature flags in D-full | Between D-min and D-full, a bad frontend deploy hits every tenant. Manual rollback (Cloud Run revision) is the recourse. |
| whatsmeow ban risk for Garindo | Isolated to Garindo only (paying tenants use Meta) | Garindo could lose WA access; the rest of Vosi keeps working. Wife is informed of this risk. |
| Garindo cutover failure | Rollback SQL + PITR + staging dry-run | A botched cutover impacts Garindo only (no other tenants exist at that point). Rollback budget 60 min before PITR. |
| Operator console compromise | Separate frontend; `super_admin_users` not writable from UI; audit log | An attacker who gains a super-admin session has read/write access to all tenants. Mitigation: long sessions disabled, all actions audited, optional Phase 2 IP allowlist. |

---

## 11. Sequencing summary

```
Phase 1 build sequence:

  D-min          ┐
                 ├─→  A           ─→  C-min  ─→ [tenant #2 onboardable]  ─→  B  ─→  C-full  ─→  D-full
  Disaster       │
  recovery       │
  runbook        ┘

Entry/exit per layer summarized in §4. Total estimated solo effort: 5-7 weeks for
D-min + A + C-min (the must-haves before tenant #2). B/C-full/D-full add 3-5 more
weeks but can be paced based on tenant demand.
```

### 11.1 Gates summary

| Gate | Condition |
|---|---|
| Start A | D-min exit gate passed (staging works, runbook written, drill completed) |
| Start C-min | A exit gate passed (Garindo cut over, 2-week shadow-mode clean, leak tests pass) |
| Tenant #2 onboard | C-min exit gate passed |
| Start B | Tenant #2 has been running ≥2 weeks without incident |
| Start C-full | B exit gate passed |
| Start D-full | C-full exit gate passed; 2+ tenants live |

### 11.2 Dependencies that cross layers

- **Resend (email)** is needed in C-min (owner invites) and in monitoring alerting; provision the integration once during Layer A.
- **PostHog** is wired in Layer A (event capture starts day 1) but the dashboards are built during C-full.
- **Sentry** is wired in D-min (so even staging errors are captured).
- **GitHub repo access** for the investigation agent is configured during Layer A (the integration is set up; the agent itself is built in C-full).

---

## 12. Deferred to Phase 2+ — explicit

The following appear in roadmap §2-9 or in the brainstorming discussion and are **intentionally not** in this Phase 1 prereq scope:

- Billing automation (Xendit/Midtrans). Manual bank transfer for first ≤5 tenants.
- 2FA / MFA. Per-tenant opt-in when requested.
- Public status page.
- Sandbox / demo environment.
- Per-tenant rate limiting beyond Supabase defaults.
- Customer support ticketing.
- Full GL / Neraca / Arus Kas implementation (roadmap Phase 1 long pole — separate spec).
- Calista Meta Cloud API integration (separate spec, triggered by first paying tenant requesting it).
- Hutang-piutang full implementation (separate spec).
- Returns from customer flow (separate spec).
- Barcode UX (separate spec).
- Marketplace API sync.
- PPN / e-Faktur / Coretax (conditional on PKP demand per roadmap §4 coherence check).
- Per-tenant cold-storage archive job implementation (Layer A provides the metadata; the archive worker itself is Phase 2).
- Public ToS / DPA / privacy policy (legal-quality drafts require a lawyer; placeholder docs land in Phase 1, refined in Phase 2).
- Mobile native app.
- Multi-language UI.
- Per-module subscription billing (currently subscription is per-tenant, not per-module).

---

## 13. Per-layer specs to follow

This decomposition spec is the parent. Each of the following will become its own implementation spec when scheduled:

1. `2026-MM-DD-layer-d-min-staging-deploy-safety-design.md`
2. `2026-MM-DD-layer-a-tenant-foundation-design.md` (the long pole — may further decompose)
3. `2026-MM-DD-garindo-cutover-runbook.md`
4. `2026-MM-DD-layer-c-min-operator-console-mvp-design.md`
5. `2026-MM-DD-layer-b-module-entitlement-system-design.md`
6. `2026-MM-DD-layer-c-full-operator-console-design.md`
7. `2026-MM-DD-layer-d-full-release-safety-design.md`
8. `2026-MM-DD-tech-ops-investigation-agent-design.md`

Plus standalone docs:

- `docs/runbooks/disaster-recovery.md`
- `docs/runbooks/deploy.md`
- `docs/runbooks/cutover-garindo.md`

---

*End of decomposition spec. Implementation detail belongs to per-layer specs above.*
