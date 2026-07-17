# Phase 1 + Phase 2 Final Plan (2026-07-17)

**Status**: Ready for founder final review.
**Reversibility**: MOST irreversible items in Phase 1 finalization. Phase 2 mostly additive.
**Total effort**: ~11-14 hours actual work for Phase 1 finalization, ~10-15 hours for Phase 2. Wall clock 20-30 hours across multiple sessions.

## Where we are now

**Tasks 1-9 DONE and verified in prod** (16 commits, migrations 300-315):
- Chat-media + 6 buckets tenant-scoped (Tasks 1-2 + Concerns 1/2/3)
- Custom domain `app.caleo.id` live serving ERP with Google SSL (Task 3 partial)
- API `/api/v1/*` prefix + backward compat (Task 4)
- Composite PK on 5 high-volume tables (Tasks 5-6)
- Structured logging with tenant_id/user_id/request_id (Task 7)
- Idempotency tokens on 4 critical RPCs (Tasks 8-9)
- Health probe split /live + /ready (Task 9)
- All 8 subdomain placeholders live with SSL

**Blockers RESOLVED overnight**:
- B-1: app.caleo.id Cloud Run mapping (via tinythinkers gcloud + Search Console TXT)
- B-2: admin.staging.caleo.id 4-level SSL (via dedicated Cloud Run + Google-managed cert)

## Phase 1 finalization — architectural revisions per founder feedback

### URL architecture (locked)

```
Production                        Staging (renamed staging-prefix pattern)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
caleo.id → Landing (Task 15+)
app.caleo.id → Tenant app         staging.app.caleo.id → Tenant app (staging)
admin.caleo.id → VOSI admin       staging.admin.caleo.id → VOSI admin (staging)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cloud Run: existing frontend      Cloud Run: NEW frontend-staging + backend-staging
Supabase: same project (test tenants for staging — Toko Jaya Makmur, Warung Sinar Rezeki)
```

### Deploy pipeline (locked)

**Single Cloud Build trigger, sequential steps**:
```
git push origin main
   ↓
Step 1: CI test gate — npm run lint + audit:numinput + audit:secdef-null-tenant + npx vitest run
   ↓
Step 2: docker build
   ↓
Step 3: Deploy to STAGING (100% traffic on staging service)
   ↓
Step 4: Automated smoke tests against staging:
   BE checks (curl):
   - curl staging.app.caleo.id/ → 200 + HTML content-type
   - Bundle hash verify (matches commit SHA)
   - Backend /api/v1/live, /ready, /health → 200
   - Sample RPC via anon key → 200
   FE checks (Playwright — 5 initial tests):
   - staging.app.caleo.id/ loads without JS console errors
   - Login page renders (input fields present)
   - staging.admin.caleo.id/ auto-redirects to /admin route
   - /admin/tenants page renders (given platform_admin session)
   - Backend /api/v1/ready reachable from browser context
   ↓
IF smoke passes:
   Step 5: Deploy same image SHA to PROD (100% traffic)
IF smoke fails:
   Build fails, prod NOT deployed, Cloud Build notification triggers
```

**Zero manual intervention per deploy** — auto-promote after validation.

**Rollback pattern** (documented in SOP):
```bash
gcloud run services update-traffic <service> --to-revisions=<prev>=100 \
  --project=gen-lang-client-0410251117
```

**Upgrade path**: Basic smoke NOW → Playwright E2E at Day 14 (drop-in replacement for Step 4).

### Phase 1 finalization scope (5 subagent dispatches)

**Sub A** — admin routing + staging rename + FP-1 + cross-subdomain session cookie (~2-3h)
- FE App.tsx hostname detection: `admin.caleo.id` + `staging.admin.caleo.id` → auto-route `/admin`
- Cloud Run domain mapping: `admin.caleo.id` → existing frontend service
- Migrate `admin.caleo.id` DNS from CF Worker → Cloud Run
- Delete CF Worker route for `admin.caleo.id`
- Rename: delete `staging.caleo.id` DNS + Worker route → add `staging.app.caleo.id`
- Rename: delete `admin.staging.caleo.id` mapping → add `staging.admin.caleo.id` mapping
- Delete old `caleo-placeholder-admin-staging` service (will be replaced by real staging in Sub E)
- Create `scripts/apply-migration.sh` (FP-1: multi-target migration script)
- Investigate + configure Supabase cookie domain `.caleo.id` for cross-subdomain SSO

**Sub B** — CI/CD test gate + fix pre-existing test failures (~2-3h)
- Fix or exclude 9 pre-existing test failures (from `.claude/worktrees/warehouse-transfer/` divergence)
- Add test steps to `cloudbuild.yaml` + `cloudbuild.frontend.yaml`
- Test steps run BEFORE docker build; failure blocks deploy

**Sub E** — Real staging environment + gated auto-promote (~4-5h)
- Create Cloud Run services:
  - `garindo-jaya-panel-msme-erp-frontend-staging` (scaled-to-zero)
  - `garindo-jaya-panel-msme-erp-staging` (backend Go, scaled-to-zero)
- Domain mappings: `staging.app.caleo.id` + `staging.admin.caleo.id` → staging frontend service
- Cloudbuild config restructure (single trigger, 5-step sequential: test → build → staging → smoke → prod)
- Automated smoke test script (`scripts/staging-smoke.sh`)
- SOP documentation (`docs/superpowers/specs/staging-deploy-sop.md`)
- Env var config for staging (same Supabase, same Gemini key — shares quota)

**Sub D** — Secret Manager move for SUPABASE_SERVICE_KEY (~1h)
- Create Secret Manager entry
- Update `cloudbuild.yaml` to reference via `availableSecrets` + env var
- Verify backend Go still connects to Supabase after cutover
- Rotate the exposed key (invalidate old, use new)

**Sub C** — kasir_transactions composite PK + record_pembayaran cleanup (~3h)
- Migration slot 316: kasir_transactions PK → (tenant_id, id). Handle 5 child FKs carefully.
- Migration slot 317: DROP record_pembayaran(jsonb) 1-arg overload (2-arg with idempotency remains)
- EXPLAIN ANALYZE hot queries pre/post to verify no plan regression
- get_advisors after each migration

### Phase 1 finalization ordering (SERIAL per SDD skill mandate)

SDD skill explicitly says NEVER dispatch implementation subagents in parallel (git working tree conflicts). Serial ordering:

**Order** (revised):
1. **Sub A** — admin routing + staging rename + FP-1 + cookie (~2-3h)
2. **Sub B** — CI test gate + fix pre-existing tests (~2-3h)
3. **Sub E** — staging environment + gated auto-promote + Playwright (~6-8h)
4. **Sub D** — Secret Manager move (~1h)
5. **Sub C** — kasir_transactions PK + record_pembayaran cleanup (~3h)

**Total wall clock**: ~14-18 hours (serial, safer). Could reduce to ~8-10h using worktrees (per memory `parallel_terminals_worktree`) if needed — but adds complexity.

Founder decision: serial is safe default. Worktree parallel is optional acceleration if time-critical.

### Phase 1 finalization validation checkpoints

Before declaring Phase 1 COMPLETE:
- ✅ `https://admin.caleo.id/` → 200, routes to VOSI admin (not tenant login)
- ✅ `https://staging.app.caleo.id/` + `https://staging.admin.caleo.id/` → 200, serves staging FE
- ✅ Push deliberately broken commit → CI gate BLOCKS deploy (verify safety net works)
- ✅ Push valid commit → auto-deploys staging → smoke passes → auto-promotes to prod
- ✅ `git grep SUPABASE_SERVICE_KEY cloudbuild.yaml` → no hardcoded value
- ✅ Backend Go still connects to Supabase (via Secret Manager)
- ✅ `\d kasir_transactions` shows composite PK (tenant_id, id)
- ✅ Sample kasir sale via prod smoke → works with new PK
- ✅ `record_pembayaran(jsonb)` 1-arg overload dropped, only 2-arg remains
- ✅ Cross-subdomain SSO working (login `app.caleo.id`, visit `admin.caleo.id`, session preserved)

## Phase 2 — post-Phase-1 (revised, obsolete items removed)

**Original Phase 2 items removed** (moved to Phase 1 finalization or superseded):
- ~~Build platform admin app~~ — OBSOLETE (existing admin, routed via Sub A)
- ~~Build staging environments~~ — DONE in Sub E

**Revised Phase 2 scope** (5 items):

1. **Cost tracking per tenant MVP** (~2-4h)
   - Table `t_tenant_cost_daily (tenant_id, date, gemini_calls, cloud_run_requests, storage_bytes)`
   - Aggregation script (from logs — Task 7 structured logging enables this)
   - Simple dashboard at `/admin/billing` (within VOSI admin)
   - Alert if tenant > 3× median

2. **Rate limiting per tenant** (~3-4h)
   - Go middleware token bucket per tenant_id
   - Default 100 req/s per tenant
   - Configurable via `tenant_subscriptions.rate_limit_override` (schema add)
   - 429 response on rate limit

3. **Audit log completeness verification** (~2-3h)
   - Sweep all write RPCs, verify each writes to audit_log
   - Add missing entries
   - Cross-tenant audit trail viewable at `/admin/audit`

4. **Per-tenant export/import RPC** (~3-4h)
   - Export: SQL dump WHERE tenant_id = $1 + storage files bundle
   - Import: restore into scratch project (via Storage Move API + INSERT ... FROM JSON)
   - Trigger from `/admin/tenants/<id>/export`

5. **Async job infrastructure** (~5-8h)
   - Cloud Tasks or Pub/Sub client integration
   - Migrate `internal/scheduler/timeout.go` from `time.AfterFunc` (in-memory, lost on restart) to queue-backed
   - Idempotent task handlers

### Phase 2 ordering

**Round 1 (parallel, ~4h)**:
- P2-A: Cost tracking MVP
- P2-B: Rate limiting per tenant

**Round 2 (sequential, ~5-7h)**:
- P2-C: Audit log completeness verification (2-3h)
- P2-D: Per-tenant export/import RPC (3-4h) — needs audit log active for tracking exports

**Round 3 (~5-8h)**:
- P2-E: Async job infrastructure (biggest, riskiest, last)

**Total wall clock**: 14-19 hours.

### Phase 2 validation checkpoints

- Cost tracking dashboard shows per-tenant usage
- Rate limit enforced (test: script hammering 1 tenant → 429, others unaffected)
- All write RPCs verified in audit_log via sweep script
- Export/import RPC works — bundle produced + restorable
- Async jobs survive Cloud Run restart

## After Phase 1 + Phase 2 validated → continue with Task 10-17

Task 10-17 unchanged from original Phase 1 spec (Task 10-17 remain in original scope):

- **Task 10**: Monitoring baseline (Cloud Monitoring alerts + Uptime Robot)
- **Task 11**: Error tracking (Sentry FE + BE)
- **Task 12**: PITR restore + tenant deprovision + secret rotation doc + rollback runbook
- **Task 13**: Cold-start policy + load test baseline + feature flag reference impl
- **Task 14**: Onboarding runbook + FE error boundary + 404 + E2E smoke test (Playwright)
- **Task 15**: Landing rewrite (Vosi → Caleo) + Privacy Policy + Terms of Service
- **Task 16**: Firebase deploy + Zoho Mail + HTTP security headers grade A
- **Task 17**: DNS cutover caleo.id root → Firebase + full journey E2E

**Total wall clock for Tasks 10-17**: ~40-50 hours (across several sessions).

## Overall roadmap

```
NOW  (~8-10h wall clock, 3 rounds)
├── Phase 1 finalization
│   ├── Round 1: Sub A + Sub B (parallel)
│   ├── Round 2: Sub E
│   └── Round 3: Sub C + Sub D (parallel)
└── VALIDATE Phase 1 (10-item checklist above)

THEN (~14-19h wall clock, 3 rounds)
├── Phase 2
│   ├── Round 1: P2-A + P2-B (parallel)
│   ├── Round 2: P2-C → P2-D (sequential)
│   └── Round 3: P2-E
└── VALIDATE Phase 2 (checklist above)

THEN (~40-50h wall clock, multiple sessions)
Task 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17
```

## Key decisions locked

- **URL architecture**: 5-subdomain with staging-first pattern (staging.app.caleo.id, staging.admin.caleo.id)
- **Supabase**: same project, test tenants for staging (Option X — zero cost, upgrade to separate at Phase 3+)
- **Deploy pipeline**: Single trigger, gated auto-promote (staging → smoke → prod), no manual button
- **CI gate**: vitest + audits run BEFORE deploy in Cloud Build
- **Secret management**: SUPABASE_SERVICE_KEY moves to GCP Secret Manager
- **Composite PK**: extend to kasir_transactions (last high-volume table)
- **admin.caleo.id**: routes to existing VOSI admin (hostname detection), NOT rebuilt

## Zero-cost constraint MAINTAINED

- Cloud Run: scaled-to-zero (both new staging services + admin subdomain placeholders)
- Supabase: same project, no upgrade needed
- Cloud Build: within free tier (2h/day builds sufficient)
- Cloud Monitoring / Sentry / Uptime Robot: all free tier at 10-tenant scale
- No new SaaS subscriptions

## Deferred / rejected items (with rationale)

- **httpOnly cookie session** — requires @supabase/ssr refactor, Phase 3+
- **Separate Supabase for staging** — YAGNI at 1-10 tenants; migrate at 50+ tenants
- **Multi-region** — only if regulator/customer demand
- **PII in logs audit** — founder explicitly deferred earlier, respect
- **Chaos testing, 100-tenant load test** — Phase 4

## Change log

| Date | Change | Author |
|---|---|---|
| 2026-07-17 | Initial end-to-end plan post overnight sessions + audit findings | Claude + Founder |
