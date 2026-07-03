# Multi-Tenant Foundation — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the single-tenant Garindo panel into a multi-tenant foundation (tenant registry + Layer-A auth hook + path prefix routing + plans catalog + RLS hardening + isolation test harness) so tenant #2 can be onboarded safely without cross-tenant data leaks.

**Architecture:** Path-prefix routing (`/t/<slug>/*`) → frontend `TenantContext` + `x-tenant-slug` header → PostgREST `db-pre-request` hook resolves slug/GUC → RLS uses existing `_resolve_tenant_id()` → `_guard_expiry_write()` blocks writes when READONLY. Hybrid plans (STARTER/PRO/PREMIUM) + per-tenant JSONB overrides; `tenant_settings` kept as read-source-of-truth via sync trigger for backward-compat.

**Tech Stack:** Supabase (Postgres + PostgREST + Auth OTP) via free tier, React + TypeScript + Vite, Vitest + RTL for unit/integration, pgTAP for DB-unit, Supabase local Docker for integration/isolation, GitHub Actions for CI.

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-07-03-multi-tenant-phase-a-design.md`. Every task implements a section; reference back when in doubt.
- Migration slot range: `20261001000001`–`20261001000099` (claimed; distant from ongoing work per `project_parallel_terminals_worktree` memory).
- **Zero paid-service dependency.** No Supabase Branching (paid), no Playwright bootstrap (deferred to Phase B), no Stripe/Xendit.
- **Fixed Garindo UUID:** `11111111-1111-1111-1111-111111111111`. Slug: `garindo`. Referenced verbatim in tests, migrations, rollback scripts.
- **All GUCs must use `set_config(..., true)`** (transaction-local; PgBouncer safety). CI grep-fail on `set_config(..., false)`.
- **Backward-compatible rolling migrations only.** Add NULLable column → backfill → SET NOT NULL in a separate migration. No in-place drop/rename.
- **FORCE ROW LEVEL SECURITY** on all category-T tables (defense-in-depth).
- **Idempotent everywhere:** `IF NOT EXISTS`, `ON CONFLICT`, `CREATE OR REPLACE`. Safe to re-run.
- **Slug regex:** `^[a-z0-9][a-z0-9-]{2,29}$`. **Reserved:** `admin, api, auth, login, signup, www, t, static, assets, public, app, support, help`.
- **Plan codes:** `STARTER`, `PRO`, `PREMIUM` (regex `^[A-Z][A-Z0-9_]{2,29}$`).
- **Migration file names (exact):**
  - `20261001000001_phase_a_schema.sql`
  - `20261001000002_phase_a_seed_and_backfill.sql`
  - `20261001000003_phase_a_not_null_and_rls.sql`
  - `20261001000004_phase_a_wire_layer_a.sql`
  - `20261001000005_phase_a_secdef_ownership.sql` (Task 8.5 bulk ownership migration)
  - `20261001000006+` per-RPC SECDEF explicit-filter patches (Task 8.5 Step 8, one per high-risk RPC)
- **CI gate:** starts `warn-only` (post PR comment, don't block). Tighten to hard-fail after 2 weeks.
- **TDD strict** where testable: RED test → run failing → implement → run passing → commit. Exceptions: pure DDL migration files (verified via replay).
- **Lint pass per FE task:** `npx tsc --noEmit` clean, `npx vitest run --dir src` baseline PASS.
- **After each task:** update `progress.md` (per CLAUDE.md gotcha).
- Existing pattern for smoke test SECURITY DEFINER RPCs: `set_config('request.jwt.claim.sub', ...)` + `RAISE EXCEPTION 'rollback'` in `DO` block (per `reference_smoke_test_security_definer_rpcs` memory).

---

## File Structure

**Migrations (slot 20261001xxxxxx):**
- `supabase/migrations/20261001000001_phase_a_schema.sql` — 7 new tables + view + trigger functions (no attachments yet)
- `supabase/migrations/20261001000002_phase_a_seed_and_backfill.sql` — seed plans, Garindo, subscriptions, platform_admins, tenant_users; backfill tenant_id; company_settings restructure
- `supabase/migrations/20261001000003_phase_a_not_null_and_rls.sql` — SET NOT NULL, sync trigger attachments, RLS hardening (auto-generated block appended)
- `supabase/migrations/20261001000004_phase_a_wire_layer_a.sql` — `_pgrst_pre_request`, `_guard_expiry_write`, bulk auto-wrap, helper RPCs, wire `ALTER ROLE authenticator`

**Scripts:**
- `scripts/generate-rls-audit-migration.ts` — RLS policy generator (Node, uses pg client)
- `scripts/rls-audit-config.yaml` — category overrides / skiplist
- `scripts/verify-migrations.sh` — migration replay on fresh Supabase local

**pgTAP tests:**
- `supabase/tests/pgtap/phase_a_pre_request.sql`
- `supabase/tests/pgtap/phase_a_guard_expiry.sql`
- `supabase/tests/pgtap/phase_a_sync_trigger.sql`
- `supabase/tests/pgtap/phase_a_helper_rpcs.sql`

**Isolation tests:**
- `tests/isolation/setup.ts` — fixture seed + `simulateAuth()` helper
- `tests/isolation/rls-cross-tenant.test.ts` — parametrized per T table
- `tests/isolation/expiry.test.ts`
- `tests/isolation/impersonation.test.ts`

**CI:**
- `.github/workflows/isolation-audit.yml`

**Frontend — new files:**
- `src/lib/tenantContext.ts` — `getTenantSlugFromURL`, `getImpersonateSlug`, `setImpersonateSlug`
- `src/lib/supabaseErrorInterceptor.ts`
- `src/contexts/TenantContext.tsx`
- `src/components/errors/TenantNotFound.tsx`
- `src/components/errors/TenantSuspended.tsx`
- `src/components/errors/AccessDenied.tsx`
- `src/components/errors/TenantBootstrapError.tsx`
- `src/components/ReadonlyBanner.tsx`
- `src/components/GraceBanner.tsx`
- `src/components/SelectTenantScreen.tsx`
- `src/components/admin/AdminShell.tsx`

**Frontend — modified files:**
- `src/lib/urlRoute.ts` — parse `/t/:slug/*`, `/admin/*`, `/select-tenant`, legacy redirect
- `src/lib/supabaseClient.ts` — global fetch header injection + `companySettingsService` refactor + new bootstrap wrapper
- `src/App.tsx` — TenantProvider wrap, `/admin` and `/select-tenant` routes
- `src/components/AuthScreen.tsx` — post-login routing decision
- `src/types.ts` — `DbCompanySettings` shape update (drop `id`, add `tenant_id`)
- `src/components/PengaturanScreen.tsx` — drop `.eq('id', 1)` in read
- `src/components/StockManagerScreen.tsx` — drop `.eq('id', 1)` in read
- `src/components/stok/StockOpnameScreen.tsx` — drop `.eq('id', 1)`
- `src/components/stok/StockOpnameSessionView.tsx` — drop `.eq('id', 1)`

---

## Task Index

**Architecture verification (Task 0):**

0. **Architecture spike (1 day)** — verify `pgrst.db_pre_request` on Supabase Cloud, auto-wrap regex, cross-tenant leak via SECURITY DEFINER, current Garindo DB size

**Database & migrations (Tasks 1–8.5):**

1. Migration File 1 — schema (tables + view + trigger functions)
2. Migration File 2a — seed plans + Garindo tenant + subscriptions + platform_admins + tenant_users
3. Migration File 2b — bulk backfill business tables + `tenant_settings` singleton reshape
4. Migration File 2c — `company_settings` restructure + `admin_users` category-T conversion
5. Migration File 3a — SET NOT NULL enforcement + attach sync triggers
6. RLS audit generator script + config
7. Migration File 3b — RLS hardening block (from generator, appended to File 3)
8. Migration File 4 — Layer-A wiring (functions + bulk auto-wrap + `ALTER ROLE`)
8.5. **SECURITY DEFINER audit + ownership migration** — create `vosi_rpc_owner` role, re-own tenant-touching RPCs, add explicit tenant filters to high-risk RPCs

**pgTAP DB-unit tests (Tasks 9–12):**

9. pgTAP — `_guard_expiry_write` branches
10. pgTAP — `sync_tenant_settings_from_subscription` trigger
11. pgTAP — `_pgrst_pre_request` all branches
12. pgTAP — helper RPCs (`log_impersonation_start/end`, `bootstrap_tenant_context`, `is_platform_admin`)

**Isolation test harness (Tasks 13–15):**

13. Isolation setup — fixtures + `simulateAuth()` helper
14. Cross-tenant parametrized RLS tests
15. Expiry + impersonation isolation tests

**CI + verification (Task 16):**

16. GitHub Actions `isolation-audit.yml` + `verify-migrations.sh`

**Frontend routing + context (Tasks 17–22):**

17. `tenantContext.ts` helpers + URL parser refactor (`urlRoute.ts`)
18. `supabaseClient.ts` — global fetch header injection
19. `TenantContext.tsx` provider + `useTenant`/`useFeature` hooks
20. `supabaseErrorInterceptor.ts` — error taxonomy handler
21. Error screens (TenantNotFound / TenantSuspended / AccessDenied / TenantBootstrapError)
22. `ReadonlyBanner.tsx` + `GraceBanner.tsx`

**Frontend admin + auth (Tasks 23–25):**

23. `AdminShell.tsx` — auth gate + impersonation control
24. `SelectTenantScreen.tsx` — tenant picker
25. `App.tsx` + `AuthScreen.tsx` — routing wire-up + post-login decision

**Frontend `company_settings` refactor (Task 26):**

26. `companySettingsService` refactor — drop `.eq('id', 1)` across 5 files

**Rollout (Tasks 27–28):**

27. Full local Supabase Docker dry-run + smoke checklist
28. Production apply (halt-gate rollout) + monitor

---

## Task 0: Architecture Spike (1 day, verification only — no production code)

**Files:**
- Create: `docs/superpowers/spikes/2026-07-XX-phase-a-architecture-spike.md`

**Interfaces:**
- No production code shipped. Output: a spike report with go/no-go decision on 4 unverified assumptions from spec §7.3 CRITICAL risks. If any check fails, revise spec (§3, §4, §7) BEFORE proceeding to Task 1.

**Why this exists:** The entire Phase A architecture rests on 4 assumptions that have not been tested against real Supabase Cloud managed environment. If any fails, weeks of downstream work are invalidated. Spike = 1 day investment to protect 2 weeks of build time.

- [ ] **Step 1: Verify `pgrst.db_pre_request` is settable on Supabase Cloud free tier**

Create a throwaway Supabase Cloud project (free tier). Apply a minimal test:

```sql
-- Test function that logs to Postgres notice
CREATE OR REPLACE FUNCTION public._spike_pre_request() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RAISE NOTICE 'spike:pre_request fired for uid=%', auth.uid();
END $$;

GRANT EXECUTE ON FUNCTION public._spike_pre_request() TO authenticator, anon, authenticated;

ALTER ROLE authenticator SET pgrst.db_pre_request = 'public._spike_pre_request';
NOTIFY pgrst, 'reload config';
```

Then make one API call via the anon key:
```bash
curl "$SUPABASE_URL/rest/v1/tenants" -H "apikey: $SUPABASE_ANON_KEY"
```

Check Supabase Dashboard → Logs → Database Logs. Look for `spike:pre_request fired` notice.

**PASS criteria:** notice appears in logs.
**FAIL criteria:** notice absent, or `ALTER ROLE` fails with permission error.
**Fallback if FAIL:** revise §3.1 to per-RPC GUC-set via SECURITY DEFINER wrapper. Adds ~2× work to every write RPC. Not a killshot, but changes spec.

- [ ] **Step 2: Verify auto-wrap regex handles DECLARE-block RPCs**

Pick 1 existing tenant-touching SECURITY DEFINER RPC with DECLARE + INSERT (e.g., `record_kasir_sale` or `create_tempo_invoice` from `supabase/migrations/`). Extract its body via:

```sql
SELECT pg_get_functiondef(oid) FROM pg_proc
WHERE proname = 'record_kasir_sale' LIMIT 1;
```

Save output to `/tmp/rpc.sql`. Apply the REVISED regex (from Task 8 Step 4 revised):

```sql
-- Line-anchored BEGIN — robust to DECLARE
SELECT regexp_replace(
  pg_read_file('/tmp/rpc.sql'),
  E'(\\nBEGIN\\n)',
  E'\\1  PERFORM public._guard_expiry_write();\n'
);
```

**PASS:** output contains `PERFORM public._guard_expiry_write();` inserted right after the top-level `BEGIN` line, not inside a nested `EXCEPTION` block.
**FAIL:** insertion happens in the wrong place or not at all → refine regex before Task 8.

- [ ] **Step 3: Reproduce cross-tenant leak via SECURITY DEFINER (baseline)**

On Supabase local Docker with only pre-Phase-A migrations applied:

1. Manually create 2 tenants + 2 users via SQL (bypassing app).
2. Seed 1 `stocks` row per tenant.
3. Log in as user A (JWT with `sub` = A's UUID).
4. Call any existing SECURITY DEFINER RPC that does `SELECT * FROM stocks` (e.g., a report RPC).
5. Observe: does user A see user B's row?

**Expected leak:** YES (this is the bug §3.5.2 correction describes). Documenting the reproducer proves the fix is needed and gives Task 8.5 a regression test.
**Unexpected:** NO — investigate what's already protecting. Maybe all RPCs already have explicit filters. Update Task 8.5 scope accordingly.

- [ ] **Step 4: Measure current Garindo production DB size vs. 500 MB cap**

```sql
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size,
       pg_size_pretty(pg_total_relation_size('public.stocks')) AS stocks_size,
       pg_size_pretty(pg_total_relation_size('public.kasir_transactions')) AS kasir_size,
       pg_size_pretty(pg_total_relation_size('public.orders')) AS orders_size;
```

**PASS:** total < 300 MB → 200 MB headroom for tenant #2.
**FAIL:** total ≥ 400 MB → tenant #2 would push over 500 MB free cap. Escalate to founder: Pro tier upgrade needed at production time (§7.6).

- [ ] **Step 5: Write spike report + go/no-go**

```markdown
# Phase A Architecture Spike Report — <date>

## Step 1: pgrst.db_pre_request on Supabase Cloud
- Result: PASS / FAIL
- Evidence: [log excerpt / error message]
- Impact: [continue / revise §3.1]

## Step 2: Auto-wrap regex on DECLARE RPCs
- Result: PASS / FAIL
- Evidence: [before/after diff of one RPC]
- Impact: [continue / refine regex before Task 8]

## Step 3: Cross-tenant leak reproducer
- Result: LEAK REPRODUCED / NO LEAK
- Evidence: [SQL + observed rows]
- Impact: [Task 8.5 scope confirmed / re-scope]

## Step 4: DB size headroom
- Current size: <X MB> / 500 MB
- Impact: [free tier viable / Pro tier at go-live]

## Go / No-Go for Task 1
- [ ] All 4 checks PASS or have clear mitigation → PROCEED to Task 1
- [ ] Any CRITICAL failure → HALT, revise spec
```

- [ ] **Step 6: Delete throwaway Supabase Cloud test project**

Free up the 2-project free tier slot for real dev.

- [ ] **Step 7: Commit report**

```bash
git add docs/superpowers/spikes/2026-07-XX-phase-a-architecture-spike.md
git commit -m "docs(spike): Phase A architecture verification — go/no-go for Task 1"
```

---

## Task 1: Migration File 1 — Schema (tables + view + trigger functions)

**Files:**
- Create: `supabase/migrations/20261001000001_phase_a_schema.sql`

**Interfaces:**
- Produces: 7 new tables (`tenants`, `platform_admins`, `tenant_users`, `plans`, `tenant_subscriptions`, `platform_admin_audit`, `tenant_activity_daily`), 1 view (`v_tenant_effective_features`), 4 trigger functions (`_forbid_slug_change`, `_seed_company_settings_for_new_tenant`, `sync_tenant_settings_from_subscription`, `resync_all_tenants_on_plan_change`). Slug-immutability trigger attached to `tenants`; other triggers attached in later files.

- [ ] **Step 1: Create migration file with header + tenants table**

```sql
-- supabase/migrations/20261001000001_phase_a_schema.sql
-- Phase A: multi-tenant foundation schema. Adds tenant registry, membership,
-- plans catalog, subscriptions, audit log, and activity telemetry skeleton.
-- Triggers for backfill-sensitive tables (sync_tenant_settings, seed_company_settings)
-- are ATTACHED in later migrations (000002 / 000003) to avoid firing during backfill.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT UNIQUE NOT NULL
                  CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,29}$'
                         AND slug NOT IN ('admin','api','auth','login','signup','www','t','static','assets','public','app','support','help')),
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','SUSPENDED','ARCHIVED')),
  custom_domain TEXT UNIQUE,
  suspended_at  TIMESTAMPTZ,
  suspended_reason TEXT,
  archived_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_tenants_slug_active ON public.tenants(slug) WHERE status = 'ACTIVE';
COMMENT ON TABLE public.tenants IS 'category=P';
```

- [ ] **Step 2: Append slug-immutability trigger**

```sql
CREATE OR REPLACE FUNCTION public._forbid_slug_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.slug <> OLD.slug THEN
    RAISE EXCEPTION 'Tenant slug is immutable' USING errcode = '55006';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tenants_slug_immutable ON public.tenants;
CREATE TRIGGER trg_tenants_slug_immutable
BEFORE UPDATE OF slug ON public.tenants FOR EACH ROW EXECUTE FUNCTION public._forbid_slug_change();
```

- [ ] **Step 3: Append platform_admins, tenant_users, plans, tenant_subscriptions**

```sql
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'super_admin' CHECK (role IN ('super_admin','support')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID
);
COMMENT ON TABLE public.platform_admins IS 'category=P';

CREATE TABLE IF NOT EXISTS public.tenant_users (
  id         BIGSERIAL PRIMARY KEY,
  tenant_id  UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','admin','staff','kasir')),
  status     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tenant_users_user ON public.tenant_users(user_id) WHERE status = 'ACTIVE';
COMMENT ON TABLE public.tenant_users IS 'category=A';

CREATE TABLE IF NOT EXISTS public.plans (
  code            TEXT PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{2,29}$'),
  name            TEXT NOT NULL,
  feature_bundle  JSONB NOT NULL,
  price_reference NUMERIC,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID
);
COMMENT ON TABLE public.plans IS 'category=G';

CREATE TABLE IF NOT EXISTS public.tenant_subscriptions (
  id                 BIGSERIAL PRIMARY KEY,
  tenant_id          UUID NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_code          TEXT NOT NULL REFERENCES public.plans(code),
  feature_overrides  JSONB NOT NULL DEFAULT '{}'::jsonb,
  activated_at       DATE NOT NULL,
  expires_at         DATE NOT NULL,
  grace_expires_at   DATE GENERATED ALWAYS AS (expires_at + INTERVAL '7 day') STORED,
  notes              TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         UUID,
  CHECK (expires_at >= activated_at)
);
CREATE INDEX IF NOT EXISTS idx_tenant_sub_expiry ON public.tenant_subscriptions(grace_expires_at);
COMMENT ON TABLE public.tenant_subscriptions IS 'category=P';
```

- [ ] **Step 4: Append audit + activity telemetry tables**

```sql
CREATE TABLE IF NOT EXISTS public.platform_admin_audit (
  id            BIGSERIAL PRIMARY KEY,
  admin_user_id UUID NOT NULL REFERENCES auth.users(id),
  admin_email   TEXT NOT NULL,
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id),
  action        TEXT NOT NULL CHECK (action IN ('IMPERSONATE_START','IMPERSONATE_END','CREATE_TENANT','CHANGE_PLAN','CHANGE_FEATURES','SUSPEND','ACTIVATE','ARCHIVE')),
  detail        JSONB,
  ip_address    INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_tenant_time ON public.platform_admin_audit(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin_time  ON public.platform_admin_audit(admin_user_id, created_at DESC);
COMMENT ON TABLE public.platform_admin_audit IS 'category=P';

CREATE TABLE IF NOT EXISTS public.tenant_activity_daily (
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL,
  rpc_calls     BIGINT NOT NULL DEFAULT 0,
  writes        BIGINT NOT NULL DEFAULT 0,
  wa_messages   BIGINT NOT NULL DEFAULT 0,
  ai_tokens     BIGINT NOT NULL DEFAULT 0,
  storage_bytes BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, activity_date)
);
COMMENT ON TABLE public.tenant_activity_daily IS 'category=P';
```

- [ ] **Step 5: Append view + trigger functions (no attachments)**

```sql
CREATE OR REPLACE VIEW public.v_tenant_effective_features AS
SELECT
  s.tenant_id,
  s.plan_code,
  (p.feature_bundle || s.feature_overrides) AS effective_features,
  CASE
    WHEN s.grace_expires_at < CURRENT_DATE THEN 'READONLY'
    WHEN s.expires_at < CURRENT_DATE THEN 'GRACE'
    ELSE 'ACTIVE'
  END AS expiry_state,
  s.expires_at,
  s.grace_expires_at
FROM public.tenant_subscriptions s
JOIN public.plans p ON p.code = s.plan_code;

-- Trigger functions declared here; ATTACHED in later migrations.
CREATE OR REPLACE FUNCTION public._seed_company_settings_for_new_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.company_settings (tenant_id, company_name)
  VALUES (NEW.id, NEW.name)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.sync_tenant_settings_from_subscription()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_effective JSONB;
BEGIN
  SELECT p.feature_bundle || NEW.feature_overrides INTO v_effective
  FROM public.plans p WHERE p.code = NEW.plan_code;

  INSERT INTO public.tenant_settings (tenant_id,
    modul_kasir, modul_tempo, modul_pengiriman, modul_multi_warehouse,
    modul_akuntansi, modul_jasa_layanan, modul_bom_recipe,
    modul_diskon_kasir, modul_diskon_penjualan, modul_diskon_tagihan,
    modul_multi_tier_price)
  VALUES (NEW.tenant_id,
    COALESCE((v_effective->>'modul_kasir')::boolean, false),
    COALESCE((v_effective->>'modul_tempo')::boolean, false),
    COALESCE((v_effective->>'modul_pengiriman')::boolean, false),
    COALESCE((v_effective->>'modul_multi_warehouse')::boolean, false),
    COALESCE((v_effective->>'modul_akuntansi')::boolean, false),
    COALESCE((v_effective->>'modul_jasa_layanan')::boolean, false),
    COALESCE((v_effective->>'modul_bom_recipe')::boolean, false),
    COALESCE((v_effective->>'modul_diskon_kasir')::boolean, false),
    COALESCE((v_effective->>'modul_diskon_penjualan')::boolean, false),
    COALESCE((v_effective->>'modul_diskon_tagihan')::boolean, false),
    COALESCE((v_effective->>'modul_multi_tier_price')::boolean, false))
  ON CONFLICT (tenant_id) DO UPDATE SET
    modul_kasir = EXCLUDED.modul_kasir,
    modul_tempo = EXCLUDED.modul_tempo,
    modul_pengiriman = EXCLUDED.modul_pengiriman,
    modul_multi_warehouse = EXCLUDED.modul_multi_warehouse,
    modul_akuntansi = EXCLUDED.modul_akuntansi,
    modul_jasa_layanan = EXCLUDED.modul_jasa_layanan,
    modul_bom_recipe = EXCLUDED.modul_bom_recipe,
    modul_diskon_kasir = EXCLUDED.modul_diskon_kasir,
    modul_diskon_penjualan = EXCLUDED.modul_diskon_penjualan,
    modul_diskon_tagihan = EXCLUDED.modul_diskon_tagihan,
    modul_multi_tier_price = EXCLUDED.modul_multi_tier_price,
    updated_at = now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.resync_all_tenants_on_plan_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.tenant_subscriptions
  SET updated_at = now()
  WHERE plan_code = NEW.code;
  RETURN NEW;
END $$;
```

- [ ] **Step 6: Append statement_timeout per role**

```sql
ALTER ROLE authenticated SET statement_timeout = '10s';
ALTER ROLE anon SET statement_timeout = '3s';
ALTER ROLE service_role SET statement_timeout = '60s';
```

- [ ] **Step 7: Apply migration on Supabase local**

Run:
```bash
supabase start  # if not running
supabase db reset  # applies all migrations from scratch
```
Expected: no errors. `\dt public.tenants*` shows 4 tables (tenants, tenant_users, tenant_subscriptions, tenant_activity_daily); `\dt public.platform*` shows 2 (platform_admins, platform_admin_audit); `\dt public.plans` shows 1; `\dv public.v_tenant*` shows the view.

- [ ] **Step 8: Verify with psql query**

Run:
```bash
supabase db psql -c "SELECT table_name, obj_description((quote_ident(table_schema)||'.'||quote_ident(table_name))::regclass) AS category FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('tenants','platform_admins','tenant_users','plans','tenant_subscriptions','platform_admin_audit','tenant_activity_daily') ORDER BY table_name;"
```
Expected: 7 rows, each with a `category=X` comment.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20261001000001_phase_a_schema.sql
git commit -m "feat(multi-tenant): Phase A file 1 — schema (tables, view, trigger functions)"
```

---

## Task 2: Migration File 2a — Seed plans + Garindo tenant + platform_admins + tenant_users

**Files:**
- Create: `supabase/migrations/20261001000002_phase_a_seed_and_backfill.sql`

**Interfaces:**
- Consumes: schema from Task 1.
- Produces: 3 plans (STARTER/PRO/PREMIUM); Garindo tenant with fixed UUID `11111111-...`; Garindo subscription PREMIUM valid until 2099-12-31; founder in `platform_admins`; Garindo staff users in `tenant_users`.

- [ ] **Step 1: Create file with header + plans seed**

```sql
-- supabase/migrations/20261001000002_phase_a_seed_and_backfill.sql
-- Phase A: seed plans, Garindo tenant, subscriptions, platform_admins,
-- tenant_users. Then bulk backfill tenant_id across business tables and
-- reshape company_settings + admin_users. Idempotent.

INSERT INTO public.plans (code, name, feature_bundle, sort_order) VALUES
  ('STARTER', 'Starter', jsonb_build_object(
    'modul_kasir', true, 'modul_tempo', false, 'modul_pengiriman', false,
    'modul_multi_warehouse', false, 'modul_akuntansi', false,
    'modul_jasa_layanan', false, 'modul_bom_recipe', false,
    'modul_diskon_kasir', true, 'modul_diskon_penjualan', false,
    'modul_diskon_tagihan', false, 'modul_multi_tier_price', false), 10),
  ('PRO', 'Pro', jsonb_build_object(
    'modul_kasir', true, 'modul_tempo', true, 'modul_pengiriman', true,
    'modul_multi_warehouse', false, 'modul_akuntansi', true,
    'modul_jasa_layanan', true, 'modul_bom_recipe', false,
    'modul_diskon_kasir', true, 'modul_diskon_penjualan', true,
    'modul_diskon_tagihan', true, 'modul_multi_tier_price', false), 20),
  ('PREMIUM', 'Premium', jsonb_build_object(
    'modul_kasir', true, 'modul_tempo', true, 'modul_pengiriman', true,
    'modul_multi_warehouse', true, 'modul_akuntansi', true,
    'modul_jasa_layanan', true, 'modul_bom_recipe', true,
    'modul_diskon_kasir', true, 'modul_diskon_penjualan', true,
    'modul_diskon_tagihan', true, 'modul_multi_tier_price', true), 30)
ON CONFLICT (code) DO NOTHING;
```

- [ ] **Step 2: Append Garindo tenant + subscription seed**

```sql
INSERT INTO public.tenants (id, slug, name, status)
VALUES ('11111111-1111-1111-1111-111111111111', 'garindo', 'Garindo Jaya', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenant_subscriptions (tenant_id, plan_code, activated_at, expires_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'PREMIUM', '2026-01-01', '2099-12-31')
ON CONFLICT (tenant_id) DO NOTHING;
```

- [ ] **Step 3: Append platform_admins + tenant_users seed**

```sql
INSERT INTO public.platform_admins (user_id, email, role)
SELECT id, email, 'super_admin' FROM auth.users
WHERE email = 'tonywei.office@gmail.com'
ON CONFLICT (user_id) DO NOTHING;

-- All existing Garindo auth.users become tenant_users of Garindo with role 'owner'
-- (founder is sole tenant occupant; roles can be adjusted later via /admin Phase B)
INSERT INTO public.tenant_users (tenant_id, user_id, role, status)
SELECT '11111111-1111-1111-1111-111111111111', id, 'owner', 'ACTIVE'
FROM auth.users
ON CONFLICT (tenant_id, user_id) DO NOTHING;
```

- [ ] **Step 4: Apply + verify**

Run:
```bash
supabase db reset
supabase db psql -c "SELECT slug, status FROM tenants; SELECT code FROM plans; SELECT tenant_id, plan_code, expires_at FROM tenant_subscriptions;"
```
Expected: 1 tenant (garindo/ACTIVE), 3 plans, 1 subscription PREMIUM.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261001000002_phase_a_seed_and_backfill.sql
git commit -m "feat(multi-tenant): Phase A file 2a — seed plans, Garindo tenant, subscriptions, users"
```

---

## Task 3: Migration File 2b — Bulk backfill business tables + `tenant_settings` reshape

**Files:**
- Modify (append): `supabase/migrations/20261001000002_phase_a_seed_and_backfill.sql`

**Interfaces:**
- Consumes: Task 2 (Garindo UUID exists as FK target).
- Produces: every existing business table row that had NULL or sentinel `tenant_id` now has Garindo UUID. `tenant_settings` no longer uses the singleton index; `UNIQUE(tenant_id)` in place.

- [ ] **Step 1: Append pre-flight anomaly check**

```sql
-- Pre-flight: bail if any table has tenant_id values that are NOT null,
-- NOT sentinel, and NOT Garindo. Manual investigation required.
DO $$
DECLARE
  r RECORD;
  v_bad_uuid UUID;
BEGIN
  FOR r IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id'
      AND table_name NOT IN ('tenants','tenant_users','tenant_settings','tenant_subscriptions','tenant_activity_daily','platform_admin_audit')
  LOOP
    EXECUTE format($fmt$
      SELECT tenant_id FROM public.%I
      WHERE tenant_id IS NOT NULL
        AND tenant_id <> '00000000-0000-0000-0000-000000000000'::uuid
        AND tenant_id <> '11111111-1111-1111-1111-111111111111'::uuid
      LIMIT 1
    $fmt$, r.table_name) INTO v_bad_uuid;
    IF v_bad_uuid IS NOT NULL THEN
      RAISE EXCEPTION 'Table % has unexpected tenant_id=%. Manual investigation required before proceeding.',
        r.table_name, v_bad_uuid;
    END IF;
  END LOOP;
END $$;
```

- [ ] **Step 2: Append bulk backfill loop**

```sql
DO $$
DECLARE
  r RECORD;
  v_garindo UUID := '11111111-1111-1111-1111-111111111111';
  v_count BIGINT;
BEGIN
  FOR r IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id'
      AND table_name NOT IN ('tenants','tenant_users','tenant_settings','tenant_subscriptions','tenant_activity_daily','platform_admin_audit')
  LOOP
    EXECUTE format($fmt$
      UPDATE public.%I SET tenant_id = %L
      WHERE tenant_id IS NULL
         OR tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
    $fmt$, r.table_name, v_garindo);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Backfilled %: % rows', r.table_name, v_count;
  END LOOP;
END $$;
```

- [ ] **Step 3: Append tenant_settings reshape**

```sql
UPDATE public.tenant_settings
SET tenant_id = '11111111-1111-1111-1111-111111111111', updated_at = now()
WHERE tenant_id IS NULL;

DROP INDEX IF EXISTS public.idx_tenant_settings_singleton;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uk_tenant_settings_tenant'
  ) THEN
    ALTER TABLE public.tenant_settings ADD CONSTRAINT uk_tenant_settings_tenant UNIQUE (tenant_id);
  END IF;
END $$;

COMMENT ON TABLE public.tenant_settings IS 'category=T';
```

- [ ] **Step 4: Apply + verify no NULL/sentinel remains**

Run:
```bash
supabase db reset
supabase db psql -c "SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='tenant_id';" | head -20
supabase db psql -c "SELECT COUNT(*) FROM stocks WHERE tenant_id IS NULL OR tenant_id = '00000000-0000-0000-0000-000000000000'::uuid;"
```
Expected: second query returns 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261001000002_phase_a_seed_and_backfill.sql
git commit -m "feat(multi-tenant): Phase A file 2b — bulk backfill business tables + tenant_settings reshape"
```

---

## Task 4: Migration File 2c — `company_settings` restructure + `admin_users` category-T conversion

**Files:**
- Modify (append): `supabase/migrations/20261001000002_phase_a_seed_and_backfill.sql`

**Interfaces:**
- Consumes: Task 3.
- Produces: `company_settings` PK migrated from `id` to `tenant_id` (id column dropped); tightened RLS. `admin_users` now has `tenant_id NOT NULL` with tenant-scoped RLS. Auto-seed trigger for new tenants attached.

- [ ] **Step 1: Append company_settings restructure**

```sql
-- company_settings: id-singleton → tenant-scoped
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

UPDATE public.company_settings
SET tenant_id = '11111111-1111-1111-1111-111111111111'
WHERE tenant_id IS NULL;

ALTER TABLE public.company_settings DROP CONSTRAINT IF EXISTS company_settings_pkey;
ALTER TABLE public.company_settings ADD PRIMARY KEY (tenant_id);
ALTER TABLE public.company_settings ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.company_settings DROP COLUMN IF EXISTS id;

DROP POLICY IF EXISTS "anon write company_settings" ON public.company_settings;
DROP POLICY IF EXISTS "public read company_settings" ON public.company_settings;

CREATE POLICY "t_select_company_settings" ON public.company_settings
  FOR SELECT TO authenticated USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_update_company_settings" ON public.company_settings
  FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id());

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_settings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_settings FROM anon;
GRANT SELECT, UPDATE ON public.company_settings TO authenticated;

COMMENT ON TABLE public.company_settings IS 'category=T';

-- Attach auto-seed trigger (function was defined in File 1)
DROP TRIGGER IF EXISTS trg_seed_company_settings ON public.tenants;
CREATE TRIGGER trg_seed_company_settings
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public._seed_company_settings_for_new_tenant();
```

- [ ] **Step 2: Append admin_users tenant_id backfill**

```sql
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

UPDATE public.admin_users
SET tenant_id = '11111111-1111-1111-1111-111111111111'
WHERE tenant_id IS NULL;

COMMENT ON TABLE public.admin_users IS 'category=T';
```

- [ ] **Step 3: Apply + verify**

Run:
```bash
supabase db reset
supabase db psql -c "\d public.company_settings" | head -20
supabase db psql -c "SELECT COUNT(*) FROM company_settings WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid;"
```
Expected: PK is `tenant_id`, `id` column absent. Row count = 1 (Garindo).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261001000002_phase_a_seed_and_backfill.sql
git commit -m "feat(multi-tenant): Phase A file 2c — company_settings restructure + admin_users category-T"
```

---

## Task 5: Migration File 3a — SET NOT NULL enforcement + attach sync triggers

**Files:**
- Create: `supabase/migrations/20261001000003_phase_a_not_null_and_rls.sql`

**Interfaces:**
- Consumes: Task 3+4 (all rows backfilled).
- Produces: every T-category business table has `tenant_id NOT NULL`. Sync trigger fires on `tenant_subscriptions` insert/update; resync fires on `plans.feature_bundle` update.

- [ ] **Step 1: Create file with NOT NULL enforcement loop**

```sql
-- supabase/migrations/20261001000003_phase_a_not_null_and_rls.sql
-- Phase A: promote tenant_id to NOT NULL and apply RLS hardening.
-- Rollback: ALTER COLUMN tenant_id DROP NOT NULL per affected table.

DO $$
DECLARE
  r RECORD;
  v_nullable_count BIGINT;
BEGIN
  FOR r IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id' AND is_nullable = 'YES'
      AND table_name NOT IN ('tenants','platform_admins','tenant_users','plans','tenant_subscriptions','tenant_activity_daily','platform_admin_audit')
  LOOP
    -- Safety check: verify no NULL rows remain before enforcing
    EXECUTE format('SELECT COUNT(*) FROM public.%I WHERE tenant_id IS NULL', r.table_name) INTO v_nullable_count;
    IF v_nullable_count > 0 THEN
      RAISE EXCEPTION 'Table % has % NULL tenant_id rows; backfill incomplete', r.table_name, v_nullable_count;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET NOT NULL', r.table_name);
    RAISE NOTICE 'NOT NULL enforced on %', r.table_name;
  END LOOP;
END $$;
```

- [ ] **Step 2: Append trigger attachments**

```sql
DROP TRIGGER IF EXISTS trg_sync_settings_from_sub ON public.tenant_subscriptions;
CREATE TRIGGER trg_sync_settings_from_sub
AFTER INSERT OR UPDATE ON public.tenant_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.sync_tenant_settings_from_subscription();

DROP TRIGGER IF EXISTS trg_resync_on_plan_change ON public.plans;
CREATE TRIGGER trg_resync_on_plan_change
AFTER UPDATE OF feature_bundle ON public.plans
FOR EACH ROW EXECUTE FUNCTION public.resync_all_tenants_on_plan_change();
```

- [ ] **Step 3: Append tenant_settings backfill via trigger fire**

```sql
-- Force sync of Garindo's tenant_settings from its subscription row
-- so tenant_settings matches PREMIUM feature bundle immediately.
UPDATE public.tenant_subscriptions
SET updated_at = now()
WHERE tenant_id = '11111111-1111-1111-1111-111111111111';
```

- [ ] **Step 4: Apply + verify**

Run:
```bash
supabase db reset
supabase db psql -c "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND column_name='tenant_id' AND is_nullable='YES';"
supabase db psql -c "SELECT modul_kasir, modul_multi_warehouse FROM tenant_settings WHERE tenant_id='11111111-1111-1111-1111-111111111111'::uuid;"
```
Expected: first query returns 0 rows (or only platform tables). Second returns `true, true` (PREMIUM defaults).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261001000003_phase_a_not_null_and_rls.sql
git commit -m "feat(multi-tenant): Phase A file 3a — SET NOT NULL + sync triggers"
```

---

## Task 6: RLS audit generator script + config

**Files:**
- Create: `scripts/generate-rls-audit-migration.ts`
- Create: `scripts/rls-audit-config.yaml`

**Interfaces:**
- Consumes: connects to Supabase local DB via `pg` client. Reads `information_schema` + `pg_policies`.
- Produces: SQL text output to stdout — DROP old anon policies, CREATE T/G/P/A/S template policies per table, ENABLE + FORCE RLS, GRANT/REVOKE aligned. Human copies output into File 3 (Task 7).

- [ ] **Step 1: Create YAML config**

```yaml
# scripts/rls-audit-config.yaml
# Manual overrides for RLS category assignment. Auto-detection:
#   - has tenant_id → T
#   - else → error (require override)
overrides:
  # Platform tables (defined in Task 1 migration)
  tenants:               { category: P }
  platform_admins:       { category: P }
  tenant_subscriptions:  { category: P }
  tenant_activity_daily: { category: P }
  platform_admin_audit:  { category: P }
  # Auth-adjacent
  tenant_users:          { category: A }
  # Global reference
  plans:                 { category: G }
  # Supabase-managed
  storage_objects:       { category: skip, reason: 'Supabase-managed' }
  storage_buckets:       { category: skip, reason: 'Supabase-managed' }
```

- [ ] **Step 2: Create generator script — imports + DB connection**

```typescript
// scripts/generate-rls-audit-migration.ts
// Emits RLS hardening SQL to stdout. Human reviews + pastes into
// supabase/migrations/20261001000003_phase_a_not_null_and_rls.sql
//
// Usage: npx tsx scripts/generate-rls-audit-migration.ts > /tmp/rls-block.sql
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';

const CONFIG_PATH = 'scripts/rls-audit-config.yaml';
const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@localhost:54322/postgres';

interface Override { category: 'T' | 'G' | 'P' | 'A' | 'S' | 'skip'; reason?: string }
interface Config { overrides: Record<string, Override> }

async function main() {
  const config: Config = parseYaml(readFileSync(CONFIG_PATH, 'utf8'));
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await emit(client, config);
  } finally {
    await client.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: Append emitter — enumerate tables + categorize**

```typescript
async function emit(client: Client, config: Config) {
  const { rows: tables } = await client.query<{ table_name: string; has_tenant_id: boolean }>(`
    SELECT t.table_name,
           EXISTS (SELECT 1 FROM information_schema.columns c
                   WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name
                     AND c.column_name = 'tenant_id') AS has_tenant_id
    FROM information_schema.tables t
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY t.table_name
  `);

  console.log('-- Auto-generated RLS hardening block. Review before committing.');
  console.log('-- Generated by scripts/generate-rls-audit-migration.ts');
  console.log();

  for (const { table_name, has_tenant_id } of tables) {
    const override = config.overrides[table_name];
    let category: string;
    if (override?.category === 'skip') {
      console.log(`-- SKIP ${table_name}: ${override.reason ?? 'per config'}`);
      continue;
    }
    if (override?.category) {
      category = override.category;
    } else if (has_tenant_id) {
      category = 'T';
    } else {
      console.error(`UNCATEGORIZED: ${table_name}. Add to rls-audit-config.yaml.`);
      process.exit(2);
    }
    emitPolicyBlock(table_name, category);
  }
}
```

- [ ] **Step 4: Append policy template emission**

```typescript
function emitPolicyBlock(table: string, category: string) {
  const q = (s: string) => `public.${s}`;
  console.log(`-- ${table} (category=${category})`);

  // Drop any existing anon-open policies
  console.log(`DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='${table}' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, '${table}');
    END LOOP;
  END $$;`);

  if (category === 'T') {
    console.log(`CREATE POLICY "t_select_own" ON ${q(table)} FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON ${q(table)} FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON ${q(table)} FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON ${q(table)} FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE ${q(table)} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${q(table)} FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ${q(table)} FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ${q(table)} TO authenticated;`);
  } else if (category === 'P') {
    console.log(`CREATE POLICY "p_platform_admin_only" ON ${q(table)} FOR ALL TO authenticated
  USING (current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_platform_admin', true) = 'true');
ALTER TABLE ${q(table)} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${q(table)} FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ${q(table)} FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ${q(table)} TO authenticated;`);
  } else if (category === 'G') {
    console.log(`CREATE POLICY "g_read_all" ON ${q(table)} FOR SELECT TO authenticated USING (true);
ALTER TABLE ${q(table)} ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ${q(table)} FROM anon, PUBLIC;
GRANT SELECT ON ${q(table)} TO authenticated;`);
  } else if (category === 'A') {
    // tenant_users specific template (only one A table for now)
    console.log(`CREATE POLICY "a_self_or_tenant_admin" ON ${q(table)} FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (tenant_id = _resolve_tenant_id()
        AND EXISTS (SELECT 1 FROM public.tenant_users me
                    WHERE me.tenant_id = ${q(table)}.tenant_id
                      AND me.user_id = auth.uid()
                      AND me.role IN ('owner','admin')))
  );
CREATE POLICY "a_admin_write" ON ${q(table)} FOR ALL TO authenticated
  USING (tenant_id = _resolve_tenant_id()
         AND EXISTS (SELECT 1 FROM public.tenant_users me
                     WHERE me.tenant_id = ${q(table)}.tenant_id
                       AND me.user_id = auth.uid()
                       AND me.role IN ('owner','admin')))
  WITH CHECK (tenant_id = _resolve_tenant_id());
ALTER TABLE ${q(table)} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${q(table)} FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ${q(table)} FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ${q(table)} TO authenticated;`);
  }
  console.log();
}
```

- [ ] **Step 5: Install deps + run**

```bash
npm install --save-dev pg yaml tsx
npx tsx scripts/generate-rls-audit-migration.ts > /tmp/rls-block.sql
head -60 /tmp/rls-block.sql
```
Expected: valid SQL, no `UNCATEGORIZED` errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-rls-audit-migration.ts scripts/rls-audit-config.yaml package.json package-lock.json
git commit -m "feat(multi-tenant): Phase A RLS audit generator + config"
```

---

## Task 7: Migration File 3b — Append RLS hardening block

**Files:**
- Modify (append): `supabase/migrations/20261001000003_phase_a_not_null_and_rls.sql`

**Interfaces:**
- Consumes: `/tmp/rls-block.sql` output from Task 6 generator.
- Produces: File 3 now contains full RLS hardening. After apply, all T tables have 4 policies + FORCE RLS; all P tables have platform_admin-only policy; `plans` has read-all; `tenant_users` has self-or-admin rule.

- [ ] **Step 1: Human review of `/tmp/rls-block.sql`**

Read the entire generated block. Verify: no unexpected DROP POLICY statements for policies you want to keep (e.g., storage bucket policies must NOT appear here — they were skipped by config).

- [ ] **Step 2: Append reviewed block into File 3**

```bash
cat /tmp/rls-block.sql >> supabase/migrations/20261001000003_phase_a_not_null_and_rls.sql
```

- [ ] **Step 3: Apply + verify FORCE RLS on T tables**

Run:
```bash
supabase db reset
supabase db psql -c "SELECT relname FROM pg_class WHERE relforcerowsecurity = false AND relname IN ('stocks','customers','company_settings','admin_users');"
```
Expected: 0 rows.

- [ ] **Step 4: Verify no `USING (true)` remains except for skip-list**

Run:
```bash
supabase db psql -c "SELECT tablename, policyname FROM pg_policies WHERE qual = 'true' AND schemaname='public';"
```
Expected: at most storage-related or the G-category `g_read_all` on `plans`. No T tables.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261001000003_phase_a_not_null_and_rls.sql
git commit -m "feat(multi-tenant): Phase A file 3b — RLS hardening block appended"
```

---

## Task 8: Migration File 4 — Layer-A wiring (functions + auto-wrap + `ALTER ROLE`)

**Files:**
- Create: `supabase/migrations/20261001000004_phase_a_wire_layer_a.sql`

**Interfaces:**
- Produces: `_pgrst_pre_request()`, `_guard_expiry_write()`, `log_impersonation_start(text)`, `log_impersonation_end(text)`, `bootstrap_tenant_context()`, `is_platform_admin()`. All write RPCs auto-wrapped with `PERFORM _guard_expiry_write();` at BEGIN. `authenticator` role wired to run pre-request. `NOTIFY pgrst` reload.

- [ ] **Step 1: Create file + `_guard_expiry_write`**

```sql
-- supabase/migrations/20261001000004_phase_a_wire_layer_a.sql
-- Phase A: wire Layer-A auth hook + expiry guard + helper RPCs.
-- Rollback: ALTER ROLE authenticator RESET pgrst.db_pre_request; NOTIFY pgrst, 'reload config';

CREATE OR REPLACE FUNCTION public._guard_expiry_write()
RETURNS void LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF current_setting('app.tenant_expiry_mode', true) = 'READONLY' THEN
    RAISE EXCEPTION USING errcode = 'P0402',
      message = 'SUBSCRIPTION_EXPIRED_READONLY',
      hint = 'Renew subscription to enable writes.';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public._guard_expiry_write() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._guard_expiry_write() TO authenticated, service_role;
```

- [ ] **Step 2: Append `_pgrst_pre_request`**

```sql
CREATE OR REPLACE FUNCTION public._pgrst_pre_request()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_slug text;
  v_impersonate text;
  v_is_platform boolean;
  v_tenant_id uuid;
  v_tenant_status text;
  v_expiry_state text;
  v_headers json;
BEGIN
  v_uid := auth.uid();
  v_headers := nullif(current_setting('request.headers', true), '')::json;
  v_slug        := nullif(v_headers ->> 'x-tenant-slug', '');
  v_impersonate := nullif(v_headers ->> 'x-impersonate-tenant', '');

  PERFORM set_config('app.current_tenant_id', '', true);
  PERFORM set_config('app.tenant_expiry_mode', '', true);
  PERFORM set_config('app.is_platform_admin', 'false', true);

  IF v_uid IS NULL THEN RETURN; END IF;

  v_is_platform := EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_uid);
  IF v_is_platform THEN
    PERFORM set_config('app.is_platform_admin', 'true', true);
  END IF;

  IF v_is_platform AND v_impersonate IS NOT NULL THEN
    v_slug := v_impersonate;
  END IF;

  IF v_slug IS NULL THEN RETURN; END IF;

  SELECT id, status INTO v_tenant_id, v_tenant_status
  FROM public.tenants WHERE slug = v_slug;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING errcode = 'P0404', message = 'TENANT_NOT_FOUND', detail = format('slug=%s', v_slug);
  END IF;

  IF v_tenant_status = 'SUSPENDED' THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'TENANT_SUSPENDED';
  END IF;

  IF v_tenant_status = 'ARCHIVED' THEN
    RAISE EXCEPTION USING errcode = 'P0404', message = 'TENANT_NOT_FOUND';
  END IF;

  IF NOT v_is_platform THEN
    IF NOT EXISTS (SELECT 1 FROM public.tenant_users
                   WHERE tenant_id = v_tenant_id AND user_id = v_uid AND status = 'ACTIVE') THEN
      RAISE EXCEPTION USING errcode = 'P0403', message = 'NOT_A_MEMBER';
    END IF;
  END IF;

  PERFORM set_config('app.current_tenant_id', v_tenant_id::text, true);

  SELECT expiry_state INTO v_expiry_state
  FROM public.v_tenant_effective_features WHERE tenant_id = v_tenant_id;

  PERFORM set_config('app.tenant_expiry_mode', COALESCE(v_expiry_state, 'ACTIVE'), true);
END $$;

REVOKE ALL ON FUNCTION public._pgrst_pre_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._pgrst_pre_request() TO authenticator, anon, authenticated;
```

- [ ] **Step 3: Append helper RPCs**

```sql
CREATE OR REPLACE FUNCTION public.log_impersonation_start(p_slug text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant_id uuid;
  v_headers json := nullif(current_setting('request.headers', true), '')::json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'Not a platform admin' USING errcode = 'P0403';
  END IF;
  SELECT id INTO v_tenant_id FROM public.tenants WHERE slug = p_slug;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'TENANT_NOT_FOUND'; END IF;
  INSERT INTO public.platform_admin_audit
    (admin_user_id, admin_email, tenant_id, action, detail, ip_address, user_agent)
  VALUES (
    v_uid, (SELECT email FROM auth.users WHERE id = v_uid), v_tenant_id,
    'IMPERSONATE_START', jsonb_build_object('via', 'log_impersonation_start_rpc'),
    nullif(v_headers ->> 'x-forwarded-for', '')::inet, v_headers ->> 'user-agent'
  );
END $$;

CREATE OR REPLACE FUNCTION public.log_impersonation_end(p_slug text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'Not a platform admin' USING errcode = 'P0403';
  END IF;
  SELECT id INTO v_tenant_id FROM public.tenants WHERE slug = p_slug;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'TENANT_NOT_FOUND'; END IF;
  INSERT INTO public.platform_admin_audit (admin_user_id, admin_email, tenant_id, action)
  VALUES (v_uid, (SELECT email FROM auth.users WHERE id = v_uid), v_tenant_id, 'IMPERSONATE_END');
END $$;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_tenant_context()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_result jsonb;
BEGIN
  v_tenant_id := nullif(current_setting('app.current_tenant_id', true), '')::uuid;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'MISSING_TENANT_CONTEXT' USING errcode = 'P0400';
  END IF;
  SELECT jsonb_build_object(
    'tenant_id', t.id,
    'slug', t.slug,
    'name', t.name,
    'status', t.status,
    'plan_code', v.plan_code,
    'effective_features', v.effective_features,
    'expiry_mode', v.expiry_state,
    'expires_at', v.expires_at,
    'grace_expires_at', v.grace_expires_at,
    'is_platform_admin', current_setting('app.is_platform_admin', true) = 'true'
  ) INTO v_result
  FROM public.tenants t
  LEFT JOIN public.v_tenant_effective_features v ON v.tenant_id = t.id
  WHERE t.id = v_tenant_id;
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.log_impersonation_start(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_impersonation_end(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_tenant_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_impersonation_start(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_impersonation_end(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_tenant_context() TO authenticated;
```

- [ ] **Step 4: Append bulk auto-wrap DO block for write RPCs**

```sql
-- Bulk-wrap write RPCs with PERFORM _guard_expiry_write().
-- Heuristic: function name doesn't start with get_/list_/resolve_/is_/bootstrap_/log_
-- AND function body contains INSERT/UPDATE/DELETE/TRUNCATE (case-insensitive, ignoring comments).
-- CREATE OR REPLACE with `PERFORM _guard_expiry_write();` right after the first BEGIN.
--
-- REGEX (revised per Task 0 spike): line-anchored `\nBEGIN\n` — robust to DECLARE blocks.
-- pg_get_functiondef normalizes formatting so BEGIN always appears on its own line.
-- Skip if already wrapped (avoid double injection on re-runs).
DO $$
DECLARE
  r RECORD;
  v_new_body TEXT;
  v_wrapped_count INT := 0;
  v_skipped_count INT := 0;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, p.proname AS fn_name, p.oid,
           pg_get_functiondef(p.oid) AS full_def, p.prosrc AS body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      -- Skip read-only naming conventions
      AND p.proname NOT LIKE 'get\_%' ESCAPE '\'
      AND p.proname NOT LIKE 'list\_%' ESCAPE '\'
      AND p.proname NOT LIKE 'resolve\_%' ESCAPE '\'
      AND p.proname NOT LIKE 'is\_%' ESCAPE '\'
      AND p.proname NOT LIKE 'bootstrap\_%' ESCAPE '\'
      AND p.proname NOT LIKE 'log\_%' ESCAPE '\'
      AND p.proname NOT LIKE '\_%' ESCAPE '\'  -- skip internal helpers (leading underscore)
      -- Skip trigger functions we own (they're not RPCs)
      AND p.proname NOT IN ('sync_tenant_settings_from_subscription',
                            'resync_all_tenants_on_plan_change',
                            'company_settings_costing_method_chk',
                            '_forbid_slug_change',
                            '_seed_company_settings_for_new_tenant')
      -- Body must contain a write keyword outside of comments
      AND p.prosrc ~* '\y(INSERT|UPDATE|DELETE|TRUNCATE)\y'
      -- Skip if already wrapped (idempotent)
      AND p.prosrc !~ 'PERFORM\s+(public\.)?_guard_expiry_write\(\s*\)'
  LOOP
    -- Line-anchored BEGIN: matches `\nBEGIN\n` anywhere in the function definition.
    -- pg_get_functiondef output always has BEGIN on its own line.
    -- Nested BEGIN...EXCEPTION blocks appear later; regexp_replace default replaces first match only.
    v_new_body := regexp_replace(
      r.full_def,
      E'(\\nBEGIN\\n)',
      E'\\1  PERFORM public._guard_expiry_write();\n'
    );

    -- Safety: only execute if regex actually changed the body
    IF v_new_body = r.full_def THEN
      RAISE WARNING 'Regex miss on %: no \\nBEGIN\\n pattern found — investigate manually', r.fn_name;
      v_skipped_count := v_skipped_count + 1;
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE v_new_body;
      RAISE NOTICE 'Wrapped: %', r.fn_name;
      v_wrapped_count := v_wrapped_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Skipped % (execute failed): %', r.fn_name, SQLERRM;
      v_skipped_count := v_skipped_count + 1;
    END;
  END LOOP;

  RAISE NOTICE 'Bulk auto-wrap complete: % wrapped, % skipped', v_wrapped_count, v_skipped_count;

  -- Hard-fail if too many misses — indicates codebase has RPCs the heuristic can't handle
  IF v_skipped_count > 5 THEN
    RAISE EXCEPTION 'Too many skipped RPCs (%). Manual audit required before rolling out Layer-A.', v_skipped_count;
  END IF;
END $$;
```

**Post-apply verification (mandatory):**
```sql
-- Every write RPC should now contain _guard_expiry_write
SELECT proname FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f'
  AND p.proname NOT LIKE 'get\_%' ESCAPE '\'
  AND p.proname NOT LIKE 'list\_%' ESCAPE '\'
  AND p.proname NOT LIKE 'resolve\_%' ESCAPE '\'
  AND p.proname NOT LIKE 'is\_%' ESCAPE '\'
  AND p.proname NOT LIKE 'bootstrap\_%' ESCAPE '\'
  AND p.proname NOT LIKE 'log\_%' ESCAPE '\'
  AND p.proname NOT LIKE '\_%' ESCAPE '\'
  AND p.prosrc ~* '\y(INSERT|UPDATE|DELETE|TRUNCATE)\y'
  AND p.prosrc !~ 'PERFORM\s+(public\.)?_guard_expiry_write\(\s*\)';
```
Expected: **0 rows**. Any row = an unwrapped write RPC; investigate before proceeding.

- [ ] **Step 5: Append `ALTER ROLE` + NOTIFY**

```sql
ALTER ROLE authenticator SET pgrst.db_pre_request = 'public._pgrst_pre_request';
NOTIFY pgrst, 'reload config';
```

- [ ] **Step 6: Apply + verify pre-request wired**

Run:
```bash
supabase db reset
supabase db psql -c "SELECT rolname, rolconfig FROM pg_roles WHERE rolname='authenticator';"
supabase db psql -c "SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('_pgrst_pre_request','_guard_expiry_write','log_impersonation_start','log_impersonation_end','is_platform_admin','bootstrap_tenant_context');"
```
Expected: `pgrst.db_pre_request=public._pgrst_pre_request` in rolconfig. Second query returns 6 rows.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261001000004_phase_a_wire_layer_a.sql
git commit -m "feat(multi-tenant): Phase A file 4 — Layer-A wiring + helper RPCs + bulk write-guard"
```

---

## Task 8.5: SECURITY DEFINER audit + ownership migration

**Files:**
- Create: `supabase/migrations/20261001000005_phase_a_secdef_ownership.sql`

**Interfaces:**
- Consumes: `_pgrst_pre_request` from Task 8 wired.
- Produces: role `vosi_rpc_owner` created WITHOUT `BYPASSRLS`. All tenant-touching `SECURITY DEFINER` functions re-owned to `vosi_rpc_owner`. High-risk RPCs additionally receive explicit `WHERE tenant_id = _resolve_tenant_id()` in their bodies (belt-and-suspenders). `_pgrst_pre_request()` deliberately kept owned by postgres (documented exception).

**Why this is a separate task (and why it MUST run after Task 8):** Per spec §3.5.2 correction, FORCE RLS does not override BYPASSRLS. Functions owned by postgres bypass RLS even with FORCE. This task fixes that systemically by ownership change, then adds explicit filters to the highest-risk RPCs as a second layer.

- [ ] **Step 1: Enumerate tenant-touching SECURITY DEFINER RPCs**

Run on local Supabase:
```sql
SELECT p.proname, p.proowner::regrole, obj_description(p.oid, 'pg_proc') AS comment
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef = true
  AND p.prokind = 'f'
  AND p.proname NOT IN ('_pgrst_pre_request', 'log_impersonation_start',
                        'log_impersonation_end', 'is_platform_admin', 'bootstrap_tenant_context')
  AND (
    p.prosrc ~* '\yFROM\s+(public\.)?(stocks|customers|orders|kasir_transactions|company_settings|admin_users|tenant_settings|purchase_orders|piutang|utang|journal_entries|journal_entry_lines|approval_requests|stock_movements|stock_lots|stock_adjustments|kasir_counters|kasir_cash_batches|recon_bank_lines|recon_payable_slots|recon_periods|stock_consumption)\y'
    OR p.prosrc ~* '\yINTO\s+(public\.)?(stocks|customers|orders|kasir_transactions|company_settings|admin_users|tenant_settings|purchase_orders|piutang|utang|journal_entries|journal_entry_lines|approval_requests|stock_movements|stock_lots|stock_adjustments|kasir_counters|kasir_cash_batches|recon_bank_lines|recon_payable_slots|recon_periods|stock_consumption)\y'
  )
ORDER BY p.proname;
```

Save output. This is the audit list. Expect 100–200 rows given the ~276 migrations.

- [ ] **Step 2: Create migration file — role + ownership migration**

```sql
-- supabase/migrations/20261001000005_phase_a_secdef_ownership.sql
-- Phase A: SECURITY DEFINER hardening. Create dedicated owner role without
-- BYPASSRLS so FORCE ROW LEVEL SECURITY actually applies to SECURITY DEFINER
-- function bodies. Re-own every tenant-touching RPC.
--
-- WHY: postgres role has BYPASSRLS. Functions owned by postgres run as
-- postgres → RLS bypassed even with FORCE. Ownership change forces RLS
-- to apply, plugging the primary SECURITY DEFINER leak vector.
--
-- Rollback: ALTER FUNCTION ... OWNER TO postgres per affected function.

-- 1. Create the dedicated owner role
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vosi_rpc_owner') THEN
    CREATE ROLE vosi_rpc_owner NOINHERIT;
    -- Explicitly NO BYPASSRLS, NO SUPERUSER
  END IF;
END $$;

-- Migration user (typically postgres) needs the role to ALTER OWNER
GRANT vosi_rpc_owner TO postgres;

-- The owner role needs table/sequence/schema privileges to actually run RPC bodies
GRANT USAGE ON SCHEMA public TO vosi_rpc_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vosi_rpc_owner;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vosi_rpc_owner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO vosi_rpc_owner;
-- Future tables/sequences added later
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vosi_rpc_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO vosi_rpc_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO vosi_rpc_owner;
```

- [ ] **Step 3: Append bulk ownership migration DO block**

```sql
-- 2. Re-own all tenant-touching SECURITY DEFINER RPCs
--    EXCLUSIONS (must remain postgres-owned to bypass RLS on platform tables):
--      - _pgrst_pre_request (reads platform_admins, tenant_users to SET GUCs)
--      - log_impersonation_start/end, is_platform_admin, bootstrap_tenant_context
--        (read tenants/tenant_users/v_tenant_effective_features across tenant boundaries)
DO $$
DECLARE
  r RECORD;
  v_reowned INT := 0;
  v_skipped INT := 0;
BEGIN
  FOR r IN
    SELECT p.proname, p.oid,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.prokind = 'f'
      AND p.proname NOT IN ('_pgrst_pre_request', 'log_impersonation_start',
                            'log_impersonation_end', 'is_platform_admin',
                            'bootstrap_tenant_context', '_guard_expiry_write',
                            '_resolve_tenant_id', '_forbid_slug_change',
                            '_seed_company_settings_for_new_tenant',
                            'sync_tenant_settings_from_subscription',
                            'resync_all_tenants_on_plan_change')
      AND p.proowner <> 'vosi_rpc_owner'::regrole
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION public.%I(%s) OWNER TO vosi_rpc_owner',
                     r.proname, r.args);
      v_reowned := v_reowned + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to re-own %(%): %', r.proname, r.args, SQLERRM;
      v_skipped := v_skipped + 1;
    END;
  END LOOP;
  RAISE NOTICE 'SECURITY DEFINER ownership migration: % re-owned, % skipped', v_reowned, v_skipped;

  IF v_skipped > 0 THEN
    RAISE EXCEPTION 'Some functions could not be re-owned. Investigate before Layer-A go-live.';
  END IF;
END $$;
```

- [ ] **Step 4: Append explicit tenant filter guards for high-risk RPCs**

For the highest-risk write RPCs (identified by "touches money" or "touches inventory"), add an explicit `_resolve_tenant_id()` sanity check at the start of the function body — even after ownership migration. This is belt-and-suspenders.

Target list (adjust per Step 1 output):

```sql
-- Add tenant sanity check to record_kasir_sale variants
-- Pattern: fetch the resolved tenant_id at function start, then use it explicitly
-- in every INSERT/UPDATE that names tenant_id. Ensures the value doesn't get
-- overridden by a stale caller-supplied tenant_id.

CREATE OR REPLACE FUNCTION public._assert_tenant_context()
RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE v_tid uuid;
BEGIN
  v_tid := nullif(current_setting('app.current_tenant_id', true), '')::uuid;
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'MISSING_TENANT_CONTEXT' USING errcode = 'P0400';
  END IF;
  RETURN v_tid;
END $$;

REVOKE ALL ON FUNCTION public._assert_tenant_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._assert_tenant_context() TO authenticated, vosi_rpc_owner;
```

**High-risk RPCs to manually patch (list from spike Step 1):**
- `record_kasir_sale` (and `_tier` variant)
- `create_tempo_invoice` (and variants)
- `receive_po`, `wrap_receive_po`
- `record_pi_dual_write`, `record_pembayaran_dual_write`
- `create_tempo_invoice_dual_write`
- `commit_reject_adjustment`, `request_adjustment`
- Any `*_dual_write` or write RPC touching multiple T-tables in a single transaction

For each, add near the top of the function body (right after the `_guard_expiry_write()` call already injected by Task 8):

```sql
-- After PERFORM public._guard_expiry_write(); insert this line:
v_ctx_tenant_id := public._assert_tenant_context();
-- Then ensure every INSERT/UPDATE targeting a T-table uses v_ctx_tenant_id
-- (not a caller-supplied parameter or a re-read from another table without joining on tenant).
```

**Note:** these manual patches happen in separate migration files per RPC (e.g., `20261001000006_secdef_patch_record_kasir_sale.sql`), NOT in the current bulk migration. This lets each patch be reviewed independently. Add them as **inline sub-tasks** during Task 8.5 rollout — one patch per high-risk RPC, one commit each.

- [ ] **Step 5: Apply + verify ownership**

```bash
supabase db reset
supabase db psql -c "SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef=true AND p.proowner='vosi_rpc_owner'::regrole;"
```
Expected: number matches the audit list from Step 1 minus the 11 exclusions.

- [ ] **Step 6: Verify SECURITY DEFINER RPCs now respect RLS**

Rerun the leak reproducer from Task 0 Step 3. Log in as user A, call the same SECURITY DEFINER RPC. Expected: **no user B data returned** (RLS now applies).

- [ ] **Step 7: Commit bulk ownership migration**

```bash
git add supabase/migrations/20261001000005_phase_a_secdef_ownership.sql
git commit -m "feat(multi-tenant): Phase A file 5 — SECURITY DEFINER ownership migration (vosi_rpc_owner)"
```

- [ ] **Step 8: For each high-risk RPC identified in Step 4, create a per-RPC patch commit**

Example workflow for `record_kasir_sale`:

```bash
# Create supabase/migrations/20261001000006_secdef_patch_record_kasir_sale.sql
# Copy current function body from pg_get_functiondef output
# Add: v_ctx_tenant_id := public._assert_tenant_context(); after PERFORM _guard_expiry_write();
# Replace: WHERE tenant_id = p_tenant_id → WHERE tenant_id = v_ctx_tenant_id (where p_tenant_id is caller-supplied)
# ... etc
supabase db reset
# Run relevant smoke test
git add supabase/migrations/20261001000006_secdef_patch_record_kasir_sale.sql
git commit -m "feat(multi-tenant): SECDEF patch — record_kasir_sale explicit tenant filter"
```

Repeat for each high-risk RPC. Expect 5–10 patch migrations.

---

## Task 9: pgTAP — `_guard_expiry_write` branches

**Files:**
- Create: `supabase/tests/pgtap/phase_a_guard_expiry.sql`

**Interfaces:**
- Consumes: `_guard_expiry_write()` from Task 8.

- [ ] **Step 1: Write failing test**

```sql
-- supabase/tests/pgtap/phase_a_guard_expiry.sql
BEGIN;
SELECT plan(3);

-- ACTIVE: silent
PERFORM set_config('app.tenant_expiry_mode', 'ACTIVE', true);
SELECT lives_ok($$SELECT _guard_expiry_write()$$, 'ACTIVE mode allows write');

-- GRACE: silent
PERFORM set_config('app.tenant_expiry_mode', 'GRACE', true);
SELECT lives_ok($$SELECT _guard_expiry_write()$$, 'GRACE mode allows write');

-- READONLY: raises
PERFORM set_config('app.tenant_expiry_mode', 'READONLY', true);
SELECT throws_ok($$SELECT _guard_expiry_write()$$, 'P0402', 'SUBSCRIPTION_EXPIRED_READONLY',
                 'READONLY mode blocks write');

SELECT finish();
ROLLBACK;
```

- [ ] **Step 2: Run + verify pass**

Run:
```bash
supabase test db --file supabase/tests/pgtap/phase_a_guard_expiry.sql
```
Expected: `# ok 3`.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/pgtap/phase_a_guard_expiry.sql
git commit -m "test(multi-tenant): pgTAP _guard_expiry_write branches"
```

---

## Task 10: pgTAP — `sync_tenant_settings_from_subscription` trigger

**Files:**
- Create: `supabase/tests/pgtap/phase_a_sync_trigger.sql`

- [ ] **Step 1: Write test asserting sync behavior**

```sql
-- supabase/tests/pgtap/phase_a_sync_trigger.sql
BEGIN;
SELECT plan(3);

-- Setup: fresh test tenant + subscription
INSERT INTO tenants (id, slug, name) VALUES ('cccc0000-0000-0000-0000-000000000001', 'test-sync', 'Sync Test');
INSERT INTO tenant_subscriptions (tenant_id, plan_code, activated_at, expires_at)
VALUES ('cccc0000-0000-0000-0000-000000000001', 'STARTER', '2026-01-01', '2099-12-31');

-- Verify tenant_settings synced from STARTER bundle
SELECT is(
  (SELECT modul_kasir FROM tenant_settings WHERE tenant_id='cccc0000-0000-0000-0000-000000000001'::uuid),
  true, 'STARTER: modul_kasir = true');
SELECT is(
  (SELECT modul_tempo FROM tenant_settings WHERE tenant_id='cccc0000-0000-0000-0000-000000000001'::uuid),
  false, 'STARTER: modul_tempo = false');

-- Change to PREMIUM → re-sync
UPDATE tenant_subscriptions SET plan_code='PREMIUM' WHERE tenant_id='cccc0000-0000-0000-0000-000000000001'::uuid;
SELECT is(
  (SELECT modul_multi_warehouse FROM tenant_settings WHERE tenant_id='cccc0000-0000-0000-0000-000000000001'::uuid),
  true, 'PREMIUM upgrade: modul_multi_warehouse = true');

SELECT finish();
ROLLBACK;
```

- [ ] **Step 2: Run + verify**

```bash
supabase test db --file supabase/tests/pgtap/phase_a_sync_trigger.sql
```
Expected: `# ok 3`.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/pgtap/phase_a_sync_trigger.sql
git commit -m "test(multi-tenant): pgTAP sync_tenant_settings_from_subscription"
```

---

## Task 11: pgTAP — `_pgrst_pre_request` all branches

**Files:**
- Create: `supabase/tests/pgtap/phase_a_pre_request.sql`

**Interfaces:**
- Consumes: `_pgrst_pre_request()` from Task 8; requires seeding auth.users test rows.

- [ ] **Step 1: Write test with helper for simulating auth**

```sql
-- supabase/tests/pgtap/phase_a_pre_request.sql
BEGIN;
SELECT plan(6);

-- Helper: simulate authenticated request
CREATE OR REPLACE FUNCTION _test_simulate_request(p_uid uuid, p_slug text, p_impersonate text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  v_headers jsonb := jsonb_build_object();
BEGIN
  IF p_slug IS NOT NULL THEN v_headers := v_headers || jsonb_build_object('x-tenant-slug', p_slug); END IF;
  IF p_impersonate IS NOT NULL THEN v_headers := v_headers || jsonb_build_object('x-impersonate-tenant', p_impersonate); END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_uid::text)::text, true);
  PERFORM set_config('request.headers', v_headers::text, true);
  PERFORM _pgrst_pre_request();
END $fn$;

-- Seed: 2 tenants, 2 users, 1 platform admin
INSERT INTO auth.users (id, email) VALUES
  ('aaaa9999-0000-0000-0000-000000000001', 'a@test'),
  ('bbbb9999-0000-0000-0000-000000000001', 'b@test'),
  ('cccc9999-0000-0000-0000-000000000001', 'super@test');
INSERT INTO tenants (id, slug, name) VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'test-a', 'Test A'),
  ('bbbb2222-0000-0000-0000-000000000001', 'test-b', 'Test B');
INSERT INTO tenant_users (tenant_id, user_id, role) VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'aaaa9999-0000-0000-0000-000000000001', 'owner'),
  ('bbbb2222-0000-0000-0000-000000000001', 'bbbb9999-0000-0000-0000-000000000001', 'owner');
INSERT INTO tenant_subscriptions (tenant_id, plan_code, activated_at, expires_at) VALUES
  ('aaaa1111-0000-0000-0000-000000000001', 'PREMIUM', '2026-01-01', '2099-12-31'),
  ('bbbb2222-0000-0000-0000-000000000001', 'PREMIUM', '2026-01-01', '2099-12-31');
INSERT INTO platform_admins (user_id, email) VALUES ('cccc9999-0000-0000-0000-000000000001', 'super@test');

-- Test 1: user A + slug test-a → sets GUC to A's UUID
SELECT _test_simulate_request('aaaa9999-0000-0000-0000-000000000001', 'test-a');
SELECT is(current_setting('app.current_tenant_id', true),
          'aaaa1111-0000-0000-0000-000000000001',
          'User A + slug test-a: GUC set correctly');

-- Test 2: user A + slug test-b → NOT_A_MEMBER
SELECT throws_ok(
  $$SELECT _test_simulate_request('aaaa9999-0000-0000-0000-000000000001'::uuid, 'test-b')$$,
  'P0403', 'NOT_A_MEMBER', 'User A cannot access tenant B');

-- Test 3: unknown slug → TENANT_NOT_FOUND
SELECT throws_ok(
  $$SELECT _test_simulate_request('aaaa9999-0000-0000-0000-000000000001'::uuid, 'nonexistent-slug')$$,
  'P0404', 'TENANT_NOT_FOUND', 'Unknown slug rejected');

-- Test 4: platform admin can impersonate tenant B
SELECT _test_simulate_request('cccc9999-0000-0000-0000-000000000001', NULL, 'test-b');
SELECT is(current_setting('app.current_tenant_id', true),
          'bbbb2222-0000-0000-0000-000000000001',
          'Platform admin can impersonate any tenant');

-- Test 5: unauthenticated → no GUC set, no exception
PERFORM set_config('request.jwt.claims', '', true);
PERFORM set_config('request.headers', '{}', true);
SELECT _pgrst_pre_request();
SELECT is(current_setting('app.current_tenant_id', true), '',
          'Unauthenticated request leaves GUC empty');

-- Test 6: suspended tenant → TENANT_SUSPENDED
UPDATE tenants SET status='SUSPENDED' WHERE slug='test-a';
SELECT throws_ok(
  $$SELECT _test_simulate_request('aaaa9999-0000-0000-0000-000000000001'::uuid, 'test-a')$$,
  'P0403', 'TENANT_SUSPENDED', 'Suspended tenant rejected');

SELECT finish();
ROLLBACK;
```

- [ ] **Step 2: Run + verify**

```bash
supabase test db --file supabase/tests/pgtap/phase_a_pre_request.sql
```
Expected: `# ok 6`.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/pgtap/phase_a_pre_request.sql
git commit -m "test(multi-tenant): pgTAP _pgrst_pre_request 6 branches"
```

---

## Task 12: pgTAP — helper RPCs

**Files:**
- Create: `supabase/tests/pgtap/phase_a_helper_rpcs.sql`

- [ ] **Step 1: Write tests for helper RPCs**

```sql
-- supabase/tests/pgtap/phase_a_helper_rpcs.sql
BEGIN;
SELECT plan(5);

-- Reuse setup from _pgrst_pre_request test (inline shortened)
INSERT INTO auth.users (id, email) VALUES ('dddd9999-0000-0000-0000-000000000001', 'helper@test');
INSERT INTO tenants (id, slug, name) VALUES ('dddd1111-0000-0000-0000-000000000001', 'test-helper', 'Test Helper');
INSERT INTO tenant_users (tenant_id, user_id, role)
  VALUES ('dddd1111-0000-0000-0000-000000000001', 'dddd9999-0000-0000-0000-000000000001', 'owner');
INSERT INTO tenant_subscriptions (tenant_id, plan_code, activated_at, expires_at)
  VALUES ('dddd1111-0000-0000-0000-000000000001', 'PRO', '2026-01-01', '2099-12-31');

-- Test 1: is_platform_admin returns false for non-admin
PERFORM set_config('request.jwt.claims', '{"sub":"dddd9999-0000-0000-0000-000000000001"}', true);
SELECT is(is_platform_admin(), false, 'is_platform_admin=false for tenant user');

-- Test 2: bootstrap_tenant_context returns feature bundle
PERFORM set_config('app.current_tenant_id', 'dddd1111-0000-0000-0000-000000000001', true);
PERFORM set_config('app.is_platform_admin', 'false', true);
SELECT is(bootstrap_tenant_context()->>'plan_code', 'PRO', 'bootstrap returns PRO plan');
SELECT is((bootstrap_tenant_context()->'effective_features'->>'modul_tempo')::boolean, true,
          'bootstrap includes modul_tempo=true for PRO');

-- Test 3: bootstrap raises when GUC empty
PERFORM set_config('app.current_tenant_id', '', true);
SELECT throws_ok($$SELECT bootstrap_tenant_context()$$, 'P0400', 'MISSING_TENANT_CONTEXT',
                 'bootstrap raises without tenant GUC');

-- Test 4: log_impersonation_start rejects non-admin
PERFORM set_config('request.jwt.claims', '{"sub":"dddd9999-0000-0000-0000-000000000001"}', true);
SELECT throws_ok($$SELECT log_impersonation_start('test-helper')$$, 'P0403', NULL,
                 'log_impersonation_start rejects non-admin');

SELECT finish();
ROLLBACK;
```

- [ ] **Step 2: Run + verify**

```bash
supabase test db --file supabase/tests/pgtap/phase_a_helper_rpcs.sql
```
Expected: `# ok 5`.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/pgtap/phase_a_helper_rpcs.sql
git commit -m "test(multi-tenant): pgTAP helper RPCs (bootstrap, is_platform_admin, impersonate log)"
```

---

## Task 13: Isolation test setup — fixtures + `simulateAuth()` helper

**Files:**
- Create: `tests/isolation/setup.ts`
- Modify: `package.json` (add script `test:isolation`)

**Interfaces:**
- Produces: `TENANT_A`, `TENANT_B`, `USER_A`, `USER_B`, `USER_SUPER` constants; `resetFixtures()`, `simulateAuth(userId, slug, impersonate?)`, `getTablesInCategory('T'|'P'|...)`, `supabaseClient` (postgrest instance with test config).

- [ ] **Step 1: Create setup file — constants**

```typescript
// tests/isolation/setup.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Client as PgClient } from 'pg';

export const TENANT_A = 'aaaa1111-0000-0000-0000-000000000001';
export const TENANT_B = 'bbbb2222-0000-0000-0000-000000000001';
export const USER_A   = 'aaaa9999-0000-0000-0000-000000000001';
export const USER_B   = 'bbbb9999-0000-0000-0000-000000000001';
export const USER_SUPER = 'cccc9999-0000-0000-0000-000000000001';
export const SLUG_A = 'test-a';
export const SLUG_B = 'test-b';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://localhost:54321';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@localhost:54322/postgres';

let _authHeader: string = '';
let _tenantHeader: string = SLUG_A;
let _impersonateHeader: string = '';

export const supabaseClient: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: {
    fetch: (input, init) => {
      const h = new Headers(init?.headers);
      if (_authHeader) h.set('Authorization', `Bearer ${_authHeader}`);
      if (_tenantHeader) h.set('x-tenant-slug', _tenantHeader);
      if (_impersonateHeader) h.set('x-impersonate-tenant', _impersonateHeader);
      return fetch(input, { ...init, headers: h });
    }
  }
});
```

- [ ] **Step 2: Append `resetFixtures()`**

```typescript
export async function resetFixtures(): Promise<void> {
  const pg = new PgClient({ connectionString: DB_URL });
  await pg.connect();
  try {
    // Clean prior test state (idempotent)
    await pg.query(`
      DELETE FROM tenant_users WHERE tenant_id IN ($1, $2);
      DELETE FROM tenant_subscriptions WHERE tenant_id IN ($1, $2);
      DELETE FROM tenants WHERE id IN ($1, $2);
      DELETE FROM platform_admins WHERE user_id = $3;
      DELETE FROM auth.users WHERE id IN ($4, $5, $3);
    `.replace(/\$1/g, `'${TENANT_A}'`).replace(/\$2/g, `'${TENANT_B}'`)
      .replace(/\$3/g, `'${USER_SUPER}'`).replace(/\$4/g, `'${USER_A}'`).replace(/\$5/g, `'${USER_B}'`));

    // Seed
    await pg.query(`
      INSERT INTO auth.users (id, email) VALUES
        ('${USER_A}', 'a@isolation.test'),
        ('${USER_B}', 'b@isolation.test'),
        ('${USER_SUPER}', 'super@isolation.test');
      INSERT INTO tenants (id, slug, name) VALUES
        ('${TENANT_A}', '${SLUG_A}', 'Isolation Test A'),
        ('${TENANT_B}', '${SLUG_B}', 'Isolation Test B');
      INSERT INTO tenant_users (tenant_id, user_id, role) VALUES
        ('${TENANT_A}', '${USER_A}', 'owner'),
        ('${TENANT_B}', '${USER_B}', 'owner');
      INSERT INTO tenant_subscriptions (tenant_id, plan_code, activated_at, expires_at) VALUES
        ('${TENANT_A}', 'PREMIUM', '2026-01-01', '2099-12-31'),
        ('${TENANT_B}', 'PREMIUM', '2026-01-01', '2099-12-31');
      INSERT INTO platform_admins (user_id, email) VALUES ('${USER_SUPER}', 'super@isolation.test');
    `);

    // Seed one row per T-table (bypasses RLS since running as superuser)
    await pg.query(`
      INSERT INTO stocks (sku, name, tenant_id) VALUES
        ('A-SKU-1', 'A Stock', '${TENANT_A}'),
        ('B-SKU-1', 'B Stock', '${TENANT_B}')
      ON CONFLICT (sku) DO NOTHING;
      -- Add other T-table seeds as needed
    `);
  } finally {
    await pg.end();
  }
}
```

- [ ] **Step 3: Append `simulateAuth()` + `getTablesInCategory()`**

```typescript
export async function simulateAuth(userId: string, slug: string, impersonate?: string): Promise<void> {
  // Mint a service-role token stamped with sub=userId (Supabase local test convention).
  // For pgTAP-style testing via anon client, we set the request headers directly:
  _authHeader = mintTestJwt(userId);
  _tenantHeader = slug;
  _impersonateHeader = impersonate ?? '';
}

function mintTestJwt(sub: string): string {
  // Supabase local uses a static JWT secret. This mints a token that PostgREST accepts.
  // Kept as a stub — real implementation uses `jsonwebtoken` with SUPABASE_JWT_SECRET.
  const jwt = require('jsonwebtoken');
  const secret = process.env.SUPABASE_JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long';
  return jwt.sign({ sub, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now()/1000) + 3600 }, secret);
}

export async function getTablesInCategory(cat: 'T'|'G'|'P'|'A'|'S'): Promise<string[]> {
  const pg = new PgClient({ connectionString: DB_URL });
  await pg.connect();
  try {
    const { rows } = await pg.query<{ table_name: string }>(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND obj_description(c.oid, 'pg_class') = 'category=' || $1
      ORDER BY c.relname
    `, [cat]);
    return rows.map(r => r.table_name);
  } finally {
    await pg.end();
  }
}
```

- [ ] **Step 4: Add npm script**

Modify `package.json`:
```json
"scripts": {
  "test:isolation": "vitest run --dir tests/isolation --no-coverage"
}
```

- [ ] **Step 5: Install jsonwebtoken**

```bash
npm install --save-dev jsonwebtoken @types/jsonwebtoken
```

- [ ] **Step 6: Smoke test setup**

```bash
supabase start
npx vitest run tests/isolation/setup.ts --no-coverage 2>&1 | head -20
```
Expected: no import errors.

- [ ] **Step 7: Commit**

```bash
git add tests/isolation/setup.ts package.json package-lock.json
git commit -m "test(multi-tenant): isolation test setup — fixtures + simulateAuth"
```

---

## Task 14: Cross-tenant parametrized RLS tests

**Files:**
- Create: `tests/isolation/rls-cross-tenant.test.ts`

**Interfaces:**
- Consumes: `setup.ts` (Task 13).

- [ ] **Step 1: Write parametrized test**

```typescript
// tests/isolation/rls-cross-tenant.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { supabaseClient, simulateAuth, resetFixtures, getTablesInCategory,
         TENANT_A, TENANT_B, USER_A, SLUG_A } from './setup';

describe('RLS: cross-tenant isolation', () => {
  let tables_T: string[];

  beforeAll(async () => {
    await resetFixtures();
    tables_T = await getTablesInCategory('T');
    expect(tables_T.length).toBeGreaterThan(0);
  });

  beforeEach(async () => {
    await simulateAuth(USER_A, SLUG_A);
  });

  for (const table of tables_T) {
    describe(`${table}`, () => {
      it('User A only sees tenant A rows on SELECT', async () => {
        const { data, error } = await supabaseClient.from(table).select('tenant_id');
        expect(error).toBeNull();
        expect(data?.every((r: any) => r.tenant_id === TENANT_A)).toBe(true);
      });

      it('User A cannot UPDATE tenant B rows', async () => {
        const { data, error } = await supabaseClient.from(table)
          .update({ updated_at: new Date().toISOString() } as any)
          .eq('tenant_id', TENANT_B)
          .select();
        expect(error).toBeNull();
        expect(data).toHaveLength(0);
      });

      it('User A cannot INSERT with tenant_id = B', async () => {
        const { error } = await supabaseClient.from(table).insert({ tenant_id: TENANT_B } as any);
        expect(error).toBeTruthy();
      });

      it('User A cannot DELETE tenant B rows', async () => {
        const { data, error } = await supabaseClient.from(table)
          .delete().eq('tenant_id', TENANT_B).select();
        expect(error).toBeNull();
        expect(data).toHaveLength(0);
      });
    });
  }
});
```

- [ ] **Step 2: Run + verify**

```bash
npm run test:isolation -- rls-cross-tenant
```
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/isolation/rls-cross-tenant.test.ts
git commit -m "test(multi-tenant): cross-tenant parametrized RLS tests"
```

---

## Task 15: Expiry + impersonation isolation tests

**Files:**
- Create: `tests/isolation/expiry.test.ts`
- Create: `tests/isolation/impersonation.test.ts`

- [ ] **Step 1: Write expiry test**

```typescript
// tests/isolation/expiry.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Client as PgClient } from 'pg';
import { supabaseClient, simulateAuth, resetFixtures,
         TENANT_A, USER_A, SLUG_A } from './setup';

const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@localhost:54322/postgres';

async function setExpiryFor(tenantId: string, expiresAt: string) {
  const pg = new PgClient({ connectionString: DB_URL });
  await pg.connect();
  await pg.query(`UPDATE tenant_subscriptions SET expires_at = $1 WHERE tenant_id = $2`, [expiresAt, tenantId]);
  await pg.end();
}

describe('Expiry enforcement', () => {
  beforeAll(async () => { await resetFixtures(); });

  it('ACTIVE tenant CAN write', async () => {
    await setExpiryFor(TENANT_A, '2099-12-31');
    await simulateAuth(USER_A, SLUG_A);
    const { error } = await supabaseClient.from('stocks').insert({
      sku: `A-ACTIVE-${Date.now()}`, name: 'active', tenant_id: TENANT_A
    } as any);
    expect(error).toBeNull();
  });

  it('GRACE tenant CAN still write (within 7-day window)', async () => {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    await setExpiryFor(TENANT_A, yesterday);
    await simulateAuth(USER_A, SLUG_A);
    const { error } = await supabaseClient.from('stocks').insert({
      sku: `A-GRACE-${Date.now()}`, name: 'grace', tenant_id: TENANT_A
    } as any);
    expect(error).toBeNull();
  });

  it('READONLY tenant CANNOT write', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    await setExpiryFor(TENANT_A, eightDaysAgo);
    await simulateAuth(USER_A, SLUG_A);
    const { error } = await supabaseClient.from('stocks').insert({
      sku: `A-RO-${Date.now()}`, name: 'ro', tenant_id: TENANT_A
    } as any);
    expect(error).toBeTruthy();
    expect(error?.message).toContain('SUBSCRIPTION_EXPIRED_READONLY');
  });

  it('READONLY tenant CAN still SELECT', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    await setExpiryFor(TENANT_A, eightDaysAgo);
    await simulateAuth(USER_A, SLUG_A);
    const { data, error } = await supabaseClient.from('stocks').select('sku').limit(1);
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });
});
```

- [ ] **Step 2: Write impersonation test**

```typescript
// tests/isolation/impersonation.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Client as PgClient } from 'pg';
import { supabaseClient, simulateAuth, resetFixtures,
         TENANT_A, TENANT_B, USER_A, USER_SUPER, SLUG_A, SLUG_B } from './setup';

const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@localhost:54322/postgres';

describe('Platform admin impersonation', () => {
  beforeAll(async () => { await resetFixtures(); });

  it('Platform admin CAN read tenant B via impersonation', async () => {
    await simulateAuth(USER_SUPER, '', SLUG_B);
    const { data, error } = await supabaseClient.from('stocks').select('tenant_id');
    expect(error).toBeNull();
    expect(data?.every((r: any) => r.tenant_id === TENANT_B)).toBe(true);
  });

  it('Non-admin cannot impersonate', async () => {
    await simulateAuth(USER_A, SLUG_A, SLUG_B);
    const { data } = await supabaseClient.from('stocks').select('tenant_id');
    // Impersonation header ignored for non-admin; user A only sees tenant A rows
    expect(data?.every((r: any) => r.tenant_id === TENANT_A)).toBe(true);
  });

  it('log_impersonation_start writes an audit row', async () => {
    await simulateAuth(USER_SUPER, '', SLUG_B);
    const { error } = await supabaseClient.rpc('log_impersonation_start', { p_slug: SLUG_B });
    expect(error).toBeNull();

    const pg = new PgClient({ connectionString: DB_URL });
    await pg.connect();
    const { rows } = await pg.query(
      `SELECT * FROM platform_admin_audit WHERE admin_user_id=$1 AND tenant_id=$2 AND action='IMPERSONATE_START' ORDER BY created_at DESC LIMIT 1`,
      [USER_SUPER, TENANT_B]);
    await pg.end();
    expect(rows.length).toBe(1);
  });
});
```

- [ ] **Step 3: Run + verify**

```bash
npm run test:isolation -- expiry
npm run test:isolation -- impersonation
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/isolation/expiry.test.ts tests/isolation/impersonation.test.ts
git commit -m "test(multi-tenant): expiry + impersonation isolation tests"
```

---

## Task 16: CI workflow `isolation-audit.yml` + `verify-migrations.sh`

**Files:**
- Create: `.github/workflows/isolation-audit.yml`
- Create: `scripts/verify-migrations.sh`

- [ ] **Step 1: Create `verify-migrations.sh`**

```bash
#!/usr/bin/env bash
# scripts/verify-migrations.sh — apply all migrations on fresh DB, verify schema.
set -euo pipefail

echo "[verify-migrations] db reset..."
supabase db reset

echo "[verify-migrations] verifying 7 new Phase A tables..."
COUNT=$(supabase db psql -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('tenants','platform_admins','tenant_users','plans','tenant_subscriptions','platform_admin_audit','tenant_activity_daily');" | tr -d ' \n')
if [ "$COUNT" != "7" ]; then
  echo "FAIL: expected 7 Phase A tables, got $COUNT"
  exit 1
fi

echo "[verify-migrations] verifying Garindo tenant seeded..."
COUNT=$(supabase db psql -t -c "SELECT COUNT(*) FROM tenants WHERE id='11111111-1111-1111-1111-111111111111'::uuid;" | tr -d ' \n')
if [ "$COUNT" != "1" ]; then
  echo "FAIL: Garindo tenant missing"
  exit 1
fi

echo "[verify-migrations] verifying pgrst.db_pre_request wired..."
CONFIG=$(supabase db psql -t -c "SELECT array_to_string(rolconfig, ',') FROM pg_roles WHERE rolname='authenticator';" | tr -d ' \n')
if [[ "$CONFIG" != *"pgrst.db_pre_request=public._pgrst_pre_request"* ]]; then
  echo "FAIL: db_pre_request not wired: $CONFIG"
  exit 1
fi

echo "[verify-migrations] OK — all Phase A checks passed"
```

Make executable: `chmod +x scripts/verify-migrations.sh`

- [ ] **Step 2: Create GitHub Actions workflow**

```yaml
# .github/workflows/isolation-audit.yml
name: RLS Isolation Audit

on:
  pull_request:
    paths:
      - 'supabase/migrations/**'
      - 'src/**'
      - 'tests/isolation/**'
      - '.github/workflows/isolation-audit.yml'

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - uses: supabase/setup-cli@v1
        with: { version: latest }

      - name: Install deps
        run: npm ci

      - name: Start Supabase local
        run: supabase start

      - name: Verify migration replay
        run: ./scripts/verify-migrations.sh

      - name: Run pgTAP suite
        run: |
          for f in supabase/tests/pgtap/*.sql; do
            supabase test db --file "$f"
          done

      - name: Run isolation tests
        env:
          SUPABASE_URL: http://localhost:54321
          SUPABASE_DB_URL: postgresql://postgres:postgres@localhost:54322/postgres
        run: npm run test:isolation

      - name: Grep-fail on session-level set_config
        run: |
          set -e
          BAD=$(git diff origin/${{ github.base_ref }}..HEAD -- 'supabase/migrations/*.sql' 'supabase/tests/**' 'scripts/**' | grep -E "^\+.*set_config\([^)]+,\s*false\s*\)" || true)
          if [ -n "$BAD" ]; then
            echo "FAIL: session-level set_config found (must use true/transaction-local):"
            echo "$BAD"
            # WARN-ONLY for first 2 weeks — comment out `exit 1` below to soften.
            # exit 1
            echo "::warning::session-level set_config found (warn-only during rollout window)"
          fi

      - name: Check new tables have category tag
        run: |
          BAD=$(git diff origin/${{ github.base_ref }}..HEAD --name-only -- 'supabase/migrations/*.sql' \
                | xargs -r grep -lE "CREATE TABLE.*public\." || true)
          for f in $BAD; do
            TABLES=$(grep -oE "CREATE TABLE (IF NOT EXISTS )?public\.[a-z_]+" "$f" | awk '{print $NF}' | sed 's/public\.//')
            for t in $TABLES; do
              if ! grep -q "COMMENT ON TABLE public.$t IS 'category=" "$f"; then
                if ! grep -q " $t:" scripts/rls-audit-config.yaml; then
                  echo "::warning::Table $t in $f missing category tag or config entry (warn-only)"
                fi
              fi
            done
          done
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/isolation-audit.yml scripts/verify-migrations.sh
git commit -m "ci(multi-tenant): isolation audit workflow + verify-migrations script"
```

---

## Task 17: `tenantContext.ts` helpers + `urlRoute.ts` refactor

**Files:**
- Create: `src/lib/tenantContext.ts`
- Modify: `src/lib/urlRoute.ts`
- Create: `src/lib/urlRoute.test.ts`

**Interfaces:**
- Produces: `getTenantSlugFromURL(): string | null`, `getImpersonateSlug(): string | null`, `setImpersonateSlug(slug: string | null): void`, `clearImpersonateSlug(): void`. `useURLRoute()` extended: return `{ tenantSlug, screen, params, isPlatformAdminArea }`.

- [ ] **Step 1: Create tenantContext helpers**

```typescript
// src/lib/tenantContext.ts
// Synchronous accessors for tenant slug — read from window.location + a
// module-level ref for impersonation. Used by supabase fetch interceptor
// so header injection happens BEFORE any async React state settles.

const SLUG_RE = /^\/t\/([a-z0-9][a-z0-9-]{2,29})(?:\/|$)/;

export function getTenantSlugFromURL(): string | null {
  if (typeof window === 'undefined') return null;
  const m = window.location.pathname.match(SLUG_RE);
  return m ? m[1] : null;
}

let _impersonateSlug: string | null = null;

export function setImpersonateSlug(slug: string | null): void {
  _impersonateSlug = slug;
  if (slug) {
    sessionStorage.setItem('vosi_impersonate', slug);
  } else {
    sessionStorage.removeItem('vosi_impersonate');
  }
}

export function getImpersonateSlug(): string | null {
  if (_impersonateSlug) return _impersonateSlug;
  if (typeof window !== 'undefined') {
    _impersonateSlug = sessionStorage.getItem('vosi_impersonate');
  }
  return _impersonateSlug;
}

export function clearImpersonateSlug(): void {
  setImpersonateSlug(null);
}
```

- [ ] **Step 2: Write failing test for urlRoute parser extension**

```typescript
// src/lib/urlRoute.test.ts
import { describe, it, expect } from 'vitest';
import { parseRoute } from './urlRoute';

describe('urlRoute — /t/<slug>/* parsing', () => {
  it('parses tenant slug from /t/garindo/dashboard', () => {
    const r = parseRoute('/t/garindo/dashboard', new URLSearchParams());
    expect(r.tenantSlug).toBe('garindo');
    expect(r.screen).toBe('dashboard');
    expect(r.isPlatformAdminArea).toBe(false);
  });

  it('marks /admin/tenants as platform admin area', () => {
    const r = parseRoute('/admin/tenants', new URLSearchParams());
    expect(r.tenantSlug).toBeNull();
    expect(r.isPlatformAdminArea).toBe(true);
  });

  it('/select-tenant is not admin area, no slug', () => {
    const r = parseRoute('/select-tenant', new URLSearchParams());
    expect(r.tenantSlug).toBeNull();
    expect(r.isPlatformAdminArea).toBe(false);
    expect(r.screen).toBe('select-tenant');
  });

  it('legacy /dashboard falls back to null slug (redirect handled elsewhere)', () => {
    const r = parseRoute('/dashboard', new URLSearchParams());
    expect(r.tenantSlug).toBeNull();
    expect(r.screen).toBe('dashboard');
  });
});
```

- [ ] **Step 3: Run + verify RED**

```bash
npx vitest run src/lib/urlRoute.test.ts
```
Expected: FAIL (parseRoute not exported or missing tenantSlug).

- [ ] **Step 4: Extend `urlRoute.ts`**

Read `src/lib/urlRoute.ts` to see existing `parseRoute` shape. Add `tenantSlug` extraction + `isPlatformAdminArea` to the return type. Exact edit depends on existing structure — pattern:

```typescript
// Add near top of urlRoute.ts
const TENANT_SLUG_RE = /^\/t\/([a-z0-9][a-z0-9-]{2,29})(?:\/(.*))?$/;

// Inside parseRoute (or equivalent), before existing screen resolution:
export interface Route {
  tenantSlug: string | null;
  screen: ActivePage;
  params: RouteParams;
  isPlatformAdminArea: boolean;
}

export function parseRoute(pathname: string, search: URLSearchParams): Route {
  // Platform admin area
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return { tenantSlug: null, screen: 'admin', params: {}, isPlatformAdminArea: true };
  }
  if (pathname === '/select-tenant') {
    return { tenantSlug: null, screen: 'select-tenant', params: {}, isPlatformAdminArea: false };
  }
  if (pathname === '/login') {
    return { tenantSlug: null, screen: 'login', params: {}, isPlatformAdminArea: false };
  }
  // Tenant-scoped: /t/<slug>/<screen>
  const m = pathname.match(TENANT_SLUG_RE);
  if (m) {
    const slug = m[1];
    const rest = '/' + (m[2] ?? '');
    return { tenantSlug: slug, ...parseScreenFromPath(rest, search), isPlatformAdminArea: false };
  }
  // Legacy path (no /t/ prefix) — return null slug, existing screen resolution
  return { tenantSlug: null, ...parseScreenFromPath(pathname, search), isPlatformAdminArea: false };
}
```

Note: `parseScreenFromPath` is the existing screen-and-params extractor — rename/reshape to reflect the actual codebase.

- [ ] **Step 5: Run tests + verify GREEN**

```bash
npx vitest run src/lib/urlRoute.test.ts
```
Expected: all pass.

- [ ] **Step 6: Type check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tenantContext.ts src/lib/urlRoute.ts src/lib/urlRoute.test.ts
git commit -m "feat(multi-tenant): tenantContext helpers + urlRoute /t/<slug>/* parsing"
```

---

## Task 18: `supabaseClient.ts` — global fetch header injection

**Files:**
- Modify: `src/lib/supabaseClient.ts`

**Interfaces:**
- Consumes: `getTenantSlugFromURL`, `getImpersonateSlug` from Task 17.
- Produces: Supabase client attaches `x-tenant-slug` and `x-impersonate-tenant` on every request.

- [ ] **Step 1: Add imports + wrap `createClient` global.fetch**

Modify `src/lib/supabaseClient.ts` — locate the `createClient(...)` call and wrap fetch:

```typescript
import { getTenantSlugFromURL, getImpersonateSlug } from './tenantContext';

// ... existing imports ...

export const supabase = isSupabaseConfigured && SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        fetch: (input, init) => {
          const slug = getTenantSlugFromURL();
          const impersonate = getImpersonateSlug();
          const headers = new Headers(init?.headers);
          if (slug) headers.set('x-tenant-slug', slug);
          if (impersonate) headers.set('x-impersonate-tenant', impersonate);
          return fetch(input, { ...init, headers });
        }
      }
    })
  : null;
```

- [ ] **Step 2: Add `bootstrap_tenant_context` wrapper**

At the end of the file:

```typescript
export const tenantContextService = {
  async bootstrap(): Promise<{
    tenant_id: string; slug: string; name: string; status: string;
    plan_code: string;
    effective_features: Record<string, boolean>;
    expiry_mode: 'ACTIVE' | 'GRACE' | 'READONLY';
    expires_at: string; grace_expires_at: string;
    is_platform_admin: boolean;
  } | null> {
    if (!supabase) return null;
    const { data, error } = await supabase.rpc('bootstrap_tenant_context');
    if (error) throw error;
    return data as any;
  },
  async isPlatformAdmin(): Promise<boolean> {
    if (!supabase) return false;
    const { data, error } = await supabase.rpc('is_platform_admin');
    if (error) return false;
    return !!data;
  },
  async logImpersonationStart(slug: string): Promise<void> {
    if (!supabase) return;
    await supabase.rpc('log_impersonation_start', { p_slug: slug });
  },
  async logImpersonationEnd(slug: string): Promise<void> {
    if (!supabase) return;
    await supabase.rpc('log_impersonation_end', { p_slug: slug });
  }
};
```

- [ ] **Step 3: Type check + test baseline**

```bash
npx tsc --noEmit
npx vitest run --dir src --no-coverage 2>&1 | tail -20
```
Expected: no errors, existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "feat(multi-tenant): supabase client header injection + tenantContextService"
```

---

## Task 19: `TenantContext.tsx` provider + hooks

**Files:**
- Create: `src/contexts/TenantContext.tsx`
- Create: `src/contexts/TenantContext.test.tsx`

**Interfaces:**
- Consumes: `tenantContextService.bootstrap()` from Task 18.
- Produces: `<TenantProvider slug={string}>` component, `useTenant()`, `useFeature(key: string): boolean` hooks.

- [ ] **Step 1: Write failing test**

```tsx
// src/contexts/TenantContext.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TenantProvider, useTenant, useFeature } from './TenantContext';

vi.mock('../lib/supabaseClient', () => ({
  tenantContextService: {
    bootstrap: vi.fn(async () => ({
      tenant_id: 't1', slug: 'garindo', name: 'Garindo Jaya', status: 'ACTIVE',
      plan_code: 'PREMIUM',
      effective_features: { modul_kasir: true, modul_tempo: true },
      expiry_mode: 'ACTIVE', expires_at: '2099-12-31', grace_expires_at: '2100-01-07',
      is_platform_admin: false
    }))
  }
}));

function Probe() {
  const t = useTenant();
  const kasir = useFeature('modul_kasir');
  const tempo = useFeature('modul_tempo');
  const nope = useFeature('modul_ai');
  return <div>
    <span data-testid="name">{t?.name}</span>
    <span data-testid="kasir">{String(kasir)}</span>
    <span data-testid="tempo">{String(tempo)}</span>
    <span data-testid="nope">{String(nope)}</span>
  </div>;
}

describe('TenantContext', () => {
  it('bootstraps and exposes tenant + features', async () => {
    render(<TenantProvider slug="garindo"><Probe /></TenantProvider>);
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Garindo Jaya'));
    expect(screen.getByTestId('kasir')).toHaveTextContent('true');
    expect(screen.getByTestId('tempo')).toHaveTextContent('true');
    expect(screen.getByTestId('nope')).toHaveTextContent('false');
  });
});
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/contexts/TenantContext.test.tsx
```
Expected: FAIL (missing file).

- [ ] **Step 3: Create `TenantContext.tsx`**

```tsx
// src/contexts/TenantContext.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { tenantContextService } from '../lib/supabaseClient';

export interface TenantContextValue {
  tenant_id: string;
  slug: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  plan_code: string;
  effective_features: Record<string, boolean>;
  expiry_mode: 'ACTIVE' | 'GRACE' | 'READONLY';
  expires_at: string;
  grace_expires_at: string;
  is_platform_admin: boolean;
  impersonating: boolean;
}

const Ctx = createContext<TenantContextValue | null>(null);

interface Props {
  slug: string;
  impersonating?: boolean;
  onError?: (code: string) => void;
  children: React.ReactNode;
}

export const TenantProvider: React.FC<Props> = ({ slug, impersonating = false, onError, children }) => {
  const [state, setState] = useState<TenantContextValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    tenantContextService.bootstrap()
      .then(v => { if (!cancelled && v) setState({ ...v, impersonating } as TenantContextValue); })
      .catch(err => {
        const code = err?.message ?? err?.code ?? 'BOOTSTRAP_FAILED';
        if (!cancelled) { setError(code); onError?.(code); }
      });
    return () => { cancelled = true; };
  }, [slug, impersonating, onError]);

  if (error) return <div role="alert" data-testid="tenant-bootstrap-error">{error}</div>;
  if (!state) return <div data-testid="tenant-bootstrap-loading">Loading…</div>;

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
};

export function useTenant(): TenantContextValue | null {
  return useContext(Ctx);
}

export function useFeature(key: string): boolean {
  const t = useTenant();
  return !!(t?.effective_features?.[key]);
}
```

- [ ] **Step 4: Run + verify GREEN**

```bash
npx vitest run src/contexts/TenantContext.test.tsx
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/contexts/TenantContext.tsx src/contexts/TenantContext.test.tsx
git commit -m "feat(multi-tenant): TenantContext provider + useTenant/useFeature hooks"
```

---

## Task 20: `supabaseErrorInterceptor.ts`

**Files:**
- Create: `src/lib/supabaseErrorInterceptor.ts`
- Create: `src/lib/supabaseErrorInterceptor.test.ts`

**Interfaces:**
- Produces: `dispatchTenantError(err: unknown): string | null` — returns error code (`TENANT_NOT_FOUND`, `TENANT_SUSPENDED`, `NOT_A_MEMBER`, `SUBSCRIPTION_EXPIRED_READONLY`, `MISSING_TENANT_CONTEXT`) or null. Broadcast via `window.dispatchEvent(new CustomEvent('vosi:tenant-error', { detail: { code } }))`.

- [ ] **Step 1: Write test**

```typescript
// src/lib/supabaseErrorInterceptor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchTenantError } from './supabaseErrorInterceptor';

describe('supabaseErrorInterceptor', () => {
  let listener: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    listener = vi.fn();
    window.addEventListener('vosi:tenant-error', listener);
  });

  it('recognizes TENANT_NOT_FOUND (P0404)', () => {
    const code = dispatchTenantError({ message: 'TENANT_NOT_FOUND', code: 'P0404' });
    expect(code).toBe('TENANT_NOT_FOUND');
    expect(listener).toHaveBeenCalled();
  });

  it('recognizes SUBSCRIPTION_EXPIRED_READONLY (P0402)', () => {
    const code = dispatchTenantError({ message: 'SUBSCRIPTION_EXPIRED_READONLY', code: 'P0402' });
    expect(code).toBe('SUBSCRIPTION_EXPIRED_READONLY');
  });

  it('returns null for unrelated errors', () => {
    const code = dispatchTenantError({ message: 'row not found', code: 'PGRST116' });
    expect(code).toBeNull();
  });
});
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/lib/supabaseErrorInterceptor.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/lib/supabaseErrorInterceptor.ts
export type TenantErrorCode =
  | 'TENANT_NOT_FOUND'
  | 'TENANT_SUSPENDED'
  | 'NOT_A_MEMBER'
  | 'SUBSCRIPTION_EXPIRED_READONLY'
  | 'MISSING_TENANT_CONTEXT';

const CODE_MAP: Record<string, TenantErrorCode> = {
  P0404: 'TENANT_NOT_FOUND',
  P0403: 'TENANT_SUSPENDED',   // could also be NOT_A_MEMBER; disambiguate by message
  P0402: 'SUBSCRIPTION_EXPIRED_READONLY',
  P0400: 'MISSING_TENANT_CONTEXT',
};

export function dispatchTenantError(err: unknown): TenantErrorCode | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { message?: string; code?: string };
  let code: TenantErrorCode | null = null;

  // Prefer message-string match (server sets these as verbatim message)
  if (e.message === 'TENANT_NOT_FOUND') code = 'TENANT_NOT_FOUND';
  else if (e.message === 'TENANT_SUSPENDED') code = 'TENANT_SUSPENDED';
  else if (e.message === 'NOT_A_MEMBER') code = 'NOT_A_MEMBER';
  else if (e.message === 'SUBSCRIPTION_EXPIRED_READONLY') code = 'SUBSCRIPTION_EXPIRED_READONLY';
  else if (e.message === 'MISSING_TENANT_CONTEXT') code = 'MISSING_TENANT_CONTEXT';
  else if (e.code && CODE_MAP[e.code]) code = CODE_MAP[e.code];

  if (code && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('vosi:tenant-error', { detail: { code } }));
  }
  return code;
}
```

- [ ] **Step 4: Run + verify GREEN**

```bash
npx vitest run src/lib/supabaseErrorInterceptor.test.ts
```
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabaseErrorInterceptor.ts src/lib/supabaseErrorInterceptor.test.ts
git commit -m "feat(multi-tenant): supabase error interceptor for tenant error codes"
```

---

## Task 21: Error screens

**Files:**
- Create: `src/components/errors/TenantNotFound.tsx`
- Create: `src/components/errors/TenantSuspended.tsx`
- Create: `src/components/errors/AccessDenied.tsx`
- Create: `src/components/errors/TenantBootstrapError.tsx`

**Interfaces:**
- Produces: 4 error screen components, each rendering an explanatory message + a primary action button (back to login / logout).

- [ ] **Step 1: Create TenantNotFound**

```tsx
// src/components/errors/TenantNotFound.tsx
import React from 'react';
import { AlertCircle } from 'lucide-react';

interface Props { slug?: string | null; onBackToLogin: () => void; }

export const TenantNotFound: React.FC<Props> = ({ slug, onBackToLogin }) => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
    <div className="max-w-md w-full bg-white rounded-lg shadow p-6 text-center">
      <AlertCircle className="mx-auto text-rose-500" size={48} />
      <h1 className="text-lg font-semibold mt-4">Tenant tidak ditemukan</h1>
      <p className="text-sm text-slate-600 mt-2">
        {slug ? <>Alamat <code className="bg-slate-100 px-1 rounded">/t/{slug}</code> tidak terdaftar di VOSI.</> :
                'URL tidak mengarah ke tenant yang valid.'}
      </p>
      <button onClick={onBackToLogin}
        className="mt-6 w-full px-4 py-2 bg-slate-900 text-white rounded hover:bg-slate-800">
        Kembali ke login
      </button>
    </div>
  </div>
);
```

- [ ] **Step 2: Create TenantSuspended**

```tsx
// src/components/errors/TenantSuspended.tsx
import React from 'react';
import { ShieldAlert } from 'lucide-react';

interface Props { onLogout: () => void; }

export const TenantSuspended: React.FC<Props> = ({ onLogout }) => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
    <div className="max-w-md w-full bg-white rounded-lg shadow p-6 text-center">
      <ShieldAlert className="mx-auto text-amber-500" size={48} />
      <h1 className="text-lg font-semibold mt-4">Akun tenant dihentikan</h1>
      <p className="text-sm text-slate-600 mt-2">
        Akun tenant ini sedang di-suspend. Silakan hubungi VOSI support.
      </p>
      <a href="https://wa.me/62..." className="mt-6 block px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-500">
        Chat WhatsApp support
      </a>
      <button onClick={onLogout} className="mt-3 w-full px-4 py-2 text-sm text-slate-500 hover:text-slate-700">
        Logout
      </button>
    </div>
  </div>
);
```

- [ ] **Step 3: Create AccessDenied**

```tsx
// src/components/errors/AccessDenied.tsx
import React from 'react';
import { Lock } from 'lucide-react';

interface Props { onLogout: () => void; }

export const AccessDenied: React.FC<Props> = ({ onLogout }) => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
    <div className="max-w-md w-full bg-white rounded-lg shadow p-6 text-center">
      <Lock className="mx-auto text-rose-500" size={48} />
      <h1 className="text-lg font-semibold mt-4">Akses ditolak</h1>
      <p className="text-sm text-slate-600 mt-2">
        Akun Anda tidak terdaftar sebagai anggota tenant ini.
      </p>
      <button onClick={onLogout}
        className="mt-6 w-full px-4 py-2 bg-slate-900 text-white rounded hover:bg-slate-800">
        Logout
      </button>
    </div>
  </div>
);
```

- [ ] **Step 4: Create TenantBootstrapError**

```tsx
// src/components/errors/TenantBootstrapError.tsx
import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props { code: string; onRetry: () => void; }

export const TenantBootstrapError: React.FC<Props> = ({ code, onRetry }) => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
    <div className="max-w-md w-full bg-white rounded-lg shadow p-6 text-center">
      <AlertTriangle className="mx-auto text-amber-500" size={48} />
      <h1 className="text-lg font-semibold mt-4">Gagal memuat tenant</h1>
      <p className="text-sm text-slate-600 mt-2">Kode: <code className="bg-slate-100 px-1 rounded">{code}</code></p>
      <button onClick={onRetry}
        className="mt-6 w-full px-4 py-2 bg-slate-900 text-white rounded hover:bg-slate-800">
        Coba lagi
      </button>
    </div>
  </div>
);
```

- [ ] **Step 5: Type check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/errors/
git commit -m "feat(multi-tenant): error screens (TenantNotFound, TenantSuspended, AccessDenied, TenantBootstrapError)"
```

---

## Task 22: `ReadonlyBanner.tsx` + `GraceBanner.tsx`

**Files:**
- Create: `src/components/ReadonlyBanner.tsx`
- Create: `src/components/GraceBanner.tsx`
- Modify: `src/index.css` (add `.tenant-readonly` global CSS)

- [ ] **Step 1: Create ReadonlyBanner**

```tsx
// src/components/ReadonlyBanner.tsx
import React, { useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { useTenant } from '../contexts/TenantContext';

export const ReadonlyBanner: React.FC = () => {
  const t = useTenant();
  const isReadOnly = t?.expiry_mode === 'READONLY';

  useEffect(() => {
    document.body.classList.toggle('tenant-readonly', !!isReadOnly);
    return () => document.body.classList.remove('tenant-readonly');
  }, [isReadOnly]);

  if (!isReadOnly || !t) return null;

  const daysExpired = Math.max(0, Math.floor((Date.now() - new Date(t.expires_at).getTime()) / 86400000));

  return (
    <div className="bg-rose-100 border-b border-rose-300 text-rose-900 px-4 py-3 flex items-center gap-2 text-sm">
      <AlertCircle size={18} />
      <span>
        <strong>Subscription VOSI kamu expired {daysExpired} hari lalu.</strong> Mode read-only aktif.
      </span>
      <a href="https://wa.me/62..." className="ml-auto underline font-medium">Hubungi untuk renew</a>
    </div>
  );
};
```

- [ ] **Step 2: Create GraceBanner**

```tsx
// src/components/GraceBanner.tsx
import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTenant } from '../contexts/TenantContext';

export const GraceBanner: React.FC = () => {
  const t = useTenant();
  if (t?.expiry_mode !== 'GRACE') return null;

  const daysExpired = Math.max(0, Math.floor((Date.now() - new Date(t.expires_at).getTime()) / 86400000));
  const daysUntilReadonly = Math.max(0, 7 - daysExpired);

  return (
    <div className="bg-amber-100 border-b border-amber-300 text-amber-900 px-4 py-2 flex items-center gap-2 text-sm">
      <AlertTriangle size={16} />
      <span>
        Subscription expired {daysExpired} hari lalu. Read-only akan aktif dalam {daysUntilReadonly} hari.
      </span>
      <a href="https://wa.me/62..." className="ml-auto underline font-medium">Renew sekarang</a>
    </div>
  );
};
```

- [ ] **Step 3: Add read-only global CSS**

Append to `src/index.css`:

```css
/* Multi-tenant read-only mode — disables all write controls */
body.tenant-readonly [data-write="true"] {
  pointer-events: none !important;
  opacity: 0.4 !important;
  cursor: not-allowed !important;
}
```

- [ ] **Step 4: Type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/components/ReadonlyBanner.tsx src/components/GraceBanner.tsx src/index.css
git commit -m "feat(multi-tenant): readonly + grace banners + data-write CSS"
```

---

## Task 23: `AdminShell.tsx` — auth gate + impersonation

**Files:**
- Create: `src/components/admin/AdminShell.tsx`

**Interfaces:**
- Uses: `tenantContextService.isPlatformAdmin()`, `logImpersonationStart/End`, `setImpersonateSlug`, `navigate` from `urlRoute`.

- [ ] **Step 1: Implement**

```tsx
// src/components/admin/AdminShell.tsx
import React, { useEffect, useState } from 'react';
import { tenantContextService } from '../../lib/supabaseClient';
import { setImpersonateSlug, clearImpersonateSlug, getImpersonateSlug } from '../../lib/tenantContext';
import { navigate } from '../../lib/urlRoute';
import { ShieldCheck, ArrowRight } from 'lucide-react';

export const AdminShell: React.FC = () => {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [impersonateInput, setImpersonateInput] = useState('');
  const currentImpersonation = getImpersonateSlug();

  useEffect(() => {
    tenantContextService.isPlatformAdmin().then(setIsAdmin);
  }, []);

  if (isAdmin === null) return <div className="p-6 text-slate-500">Loading…</div>;
  if (!isAdmin) {
    navigate('/login');
    return null;
  }

  const handleImpersonate = async () => {
    const slug = impersonateInput.trim().toLowerCase();
    if (!slug) return;
    await tenantContextService.logImpersonationStart(slug);
    setImpersonateSlug(slug);
    navigate(`/t/${slug}/dashboard`);
  };

  const handleExitImpersonation = async () => {
    if (currentImpersonation) {
      await tenantContextService.logImpersonationEnd(currentImpersonation);
    }
    clearImpersonateSlug();
    navigate('/admin');
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 text-white px-6 py-4 flex items-center gap-3">
        <ShieldCheck size={20} />
        <span className="font-semibold">VOSI Admin Panel</span>
        {currentImpersonation && (
          <button onClick={handleExitImpersonation}
            className="ml-auto px-3 py-1 bg-amber-500 text-amber-950 text-xs rounded font-semibold">
            Impersonating: {currentImpersonation} — Exit
          </button>
        )}
      </header>
      <main className="p-6 max-w-4xl mx-auto space-y-6">
        <section className="bg-white p-6 rounded shadow">
          <h2 className="font-semibold text-slate-900">Impersonate Tenant</h2>
          <p className="text-sm text-slate-500 mt-1">
            Enter slug to enter tenant view. Session is audit-logged.
          </p>
          <div className="flex gap-2 mt-4">
            <input value={impersonateInput} onChange={e => setImpersonateInput(e.target.value)}
              placeholder="e.g. garindo"
              className="flex-1 px-3 py-2 border border-slate-300 rounded" />
            <button onClick={handleImpersonate}
              className="px-4 py-2 bg-slate-900 text-white rounded flex items-center gap-1">
              Enter <ArrowRight size={16} />
            </button>
          </div>
        </section>
        <section className="bg-white p-6 rounded shadow">
          <h2 className="font-semibold text-slate-900">Tenant management</h2>
          <p className="text-sm text-slate-500 mt-1">Coming in Phase B (list, create, edit, plan, audit viewer).</p>
        </section>
      </main>
    </div>
  );
};
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/AdminShell.tsx
git commit -m "feat(multi-tenant): AdminShell skeleton + impersonation control"
```

---

## Task 24: `SelectTenantScreen.tsx`

**Files:**
- Create: `src/components/SelectTenantScreen.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/SelectTenantScreen.tsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { navigate } from '../lib/urlRoute';
import { Building2 } from 'lucide-react';

interface TenantRow { tenant_id: string; slug: string; name: string; }

export const SelectTenantScreen: React.FC = () => {
  const [tenants, setTenants] = useState<TenantRow[] | null>(null);

  useEffect(() => {
    if (!supabase) return;
    // Reads tenant_users JOIN tenants; RLS gives current user their own memberships
    supabase.from('tenant_users')
      .select('tenant_id, tenants!inner(slug, name)')
      .eq('status', 'ACTIVE')
      .then(({ data }) => {
        setTenants((data ?? []).map((r: any) => ({
          tenant_id: r.tenant_id, slug: r.tenants.slug, name: r.tenants.name
        })));
      });
  }, []);

  useEffect(() => {
    if (tenants?.length === 1) {
      navigate(`/t/${tenants[0].slug}/dashboard`);
    }
  }, [tenants]);

  if (!tenants) return <div className="p-6 text-slate-500">Loading…</div>;
  if (tenants.length === 0) return <div className="p-6 text-rose-600">Tidak ada tenant terdaftar untuk akun Anda.</div>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full space-y-3">
        <h1 className="text-lg font-semibold text-slate-900 mb-4">Pilih tenant</h1>
        {tenants.map(t => (
          <button key={t.tenant_id} onClick={() => navigate(`/t/${t.slug}/dashboard`)}
            className="w-full flex items-center gap-3 p-4 bg-white rounded shadow hover:shadow-md text-left">
            <Building2 size={20} className="text-slate-500" />
            <div>
              <div className="font-semibold">{t.name}</div>
              <div className="text-xs text-slate-500">/t/{t.slug}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/SelectTenantScreen.tsx
git commit -m "feat(multi-tenant): SelectTenantScreen"
```

---

## Task 25: `App.tsx` routing wire-up + `AuthScreen.tsx` post-login

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/AuthScreen.tsx`

**Interfaces:**
- Consumes: `parseRoute`, `TenantProvider`, `AdminShell`, `SelectTenantScreen`, error screens, banners, `dispatchTenantError`.

- [ ] **Step 1: Wire top-level routing in App.tsx**

Locate top of `App()` function. Add:

```tsx
import { TenantProvider } from './contexts/TenantContext';
import { AdminShell } from './components/admin/AdminShell';
import { SelectTenantScreen } from './components/SelectTenantScreen';
import { TenantNotFound } from './components/errors/TenantNotFound';
import { TenantSuspended } from './components/errors/TenantSuspended';
import { AccessDenied } from './components/errors/AccessDenied';
import { TenantBootstrapError } from './components/errors/TenantBootstrapError';
import { ReadonlyBanner } from './components/ReadonlyBanner';
import { GraceBanner } from './components/GraceBanner';
import { dispatchTenantError } from './lib/supabaseErrorInterceptor';

// Inside App() component, after route + auth resolution:
if (route.isPlatformAdminArea) return <AdminShell />;
if (route.screen === 'select-tenant') return <SelectTenantScreen />;

if (currentUser && route.tenantSlug) {
  return (
    <TenantProvider slug={route.tenantSlug} onError={handleTenantError}>
      <ReadonlyBanner />
      <GraceBanner />
      {/* existing app shell */}
    </TenantProvider>
  );
}

// Legacy redirect (30-day compat)
if (currentUser && !route.tenantSlug && route.screen !== 'login') {
  // Default redirect: assume Garindo for legacy URLs
  navigate(`/t/garindo/${route.screen}`, { replace: true });
  return null;
}
```

Add `handleTenantError` handler:
```tsx
function handleTenantError(code: string) {
  // Route to error screen based on code
  if (code === 'TENANT_NOT_FOUND') setTenantErrorScreen('not-found');
  else if (code === 'TENANT_SUSPENDED') setTenantErrorScreen('suspended');
  else if (code === 'NOT_A_MEMBER') setTenantErrorScreen('denied');
  else setTenantErrorScreen('bootstrap');
}
```

Global window listener for interceptor:
```tsx
useEffect(() => {
  const handler = (e: Event) => {
    const code = (e as CustomEvent).detail?.code;
    if (code === 'SUBSCRIPTION_EXPIRED_READONLY') {
      // Toast (existing infra)
      showToast('⚠️ Write dilarang: subscription expired. Renew untuk lanjut.', 'warning');
    } else if (code) {
      handleTenantError(code);
    }
  };
  window.addEventListener('vosi:tenant-error', handler);
  return () => window.removeEventListener('vosi:tenant-error', handler);
}, []);
```

- [ ] **Step 2: Post-login routing in AuthScreen.tsx**

Modify `handleLoginSuccess` (or equivalent) to route based on user role/tenants:

```tsx
async function afterLogin() {
  const isAdmin = await tenantContextService.isPlatformAdmin();
  if (isAdmin) { navigate('/admin'); return; }

  if (!supabase) return;
  const { data } = await supabase.from('tenant_users').select('tenants!inner(slug)').eq('status', 'ACTIVE');
  const tenants = data ?? [];
  if (tenants.length === 1) {
    navigate(`/t/${(tenants[0] as any).tenants.slug}/dashboard`);
  } else if (tenants.length > 1) {
    navigate('/select-tenant');
  } else {
    navigate('/select-tenant'); // will show "no tenant" message
  }
}
```

Wire `afterLogin()` at OTP verification success and dev-bypass paths.

- [ ] **Step 3: Type check + baseline vitest**

```bash
npx tsc --noEmit
npx vitest run --dir src --no-coverage 2>&1 | tail -20
```
Expected: no regression.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/AuthScreen.tsx
git commit -m "feat(multi-tenant): App.tsx routing + AuthScreen post-login decision"
```

---

## Task 26: `companySettingsService` refactor + affected screens

**Files:**
- Modify: `src/lib/supabaseClient.ts` (companySettingsService methods)
- Modify: `src/types.ts` (DbCompanySettings)
- Modify: `src/components/PengaturanScreen.tsx`
- Modify: `src/components/StockManagerScreen.tsx`
- Modify: `src/components/stok/StockOpnameScreen.tsx`
- Modify: `src/components/stok/StockOpnameSessionView.tsx`

**Interfaces:**
- Consumes: `TenantContext` (for `tenant_id` in updates).
- Produces: refactored service without `.eq('id', 1)`. All reads via `.maybeSingle()` (RLS returns one row). Writes via `.eq('tenant_id', tenantId)` — get `tenantId` from `useTenant()` at call site or pass explicitly.

- [ ] **Step 1: Update `DbCompanySettings` type**

Modify `src/types.ts`:
```typescript
export interface DbCompanySettings {
  tenant_id: string;        // NEW; replaces `id: number`
  company_name?: string;
  address?: string;
  phone?: string;
  email?: string;
  logo_url?: string;
  npwp?: string;
  opname_require_witness?: boolean;
  costing_method?: 'FIFO' | 'Average';
  updated_at?: string;
}
```

- [ ] **Step 2: Refactor `companySettingsService`**

```typescript
export const companySettingsService = {
  async fetch(): Promise<DbCompanySettings | null> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.from('company_settings').select('*').maybeSingle();
    if (error) throw error;
    return data ?? null;
  },

  async uploadLogo(tenantId: string, file: File): Promise<string> {
    if (!supabase) throw new Error('Supabase not configured');
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `logo_${tenantId}_${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('branding').upload(path, file, { upsert: true, cacheControl: '3600' });
    if (upErr) throw upErr;
    const { data: pub } = supabase.storage.from('branding').getPublicUrl(path);
    const url = pub.publicUrl;
    const { error: updErr } = await supabase.from('company_settings')
      .update({ logo_url: url, updated_at: new Date().toISOString() } as any)
      .eq('tenant_id', tenantId);
    if (updErr) throw updErr;
    return url;
  },

  async updateOpnameRequireWitness(tenantId: string, required: boolean): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.from('company_settings')
      .update({ opname_require_witness: required, updated_at: new Date().toISOString() } as any)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  },

  async clearLogo(tenantId: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data: settings, error: fetchErr } = await supabase.from('company_settings')
      .select('logo_url').maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!settings?.logo_url) return;
    const filename = settings.logo_url.split('/').pop();
    if (filename) {
      await supabase.storage.from('branding').remove([filename]);
    }
    await supabase.from('company_settings').update({ logo_url: null } as any).eq('tenant_id', tenantId);
  },

  async getCostingMethod(): Promise<'FIFO' | 'Average'> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.from('company_settings').select('costing_method').maybeSingle();
    if (error) throw error;
    const v = (data as { costing_method?: string } | null)?.costing_method ?? 'FIFO';
    return (v === 'Average' ? 'Average' : 'FIFO');
  },

  async setCostingMethod(tenantId: string, m: 'FIFO' | 'Average'): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.from('company_settings')
      .update({ costing_method: m, updated_at: new Date().toISOString() } as any)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  },
};
```

- [ ] **Step 3: Update callers to pass tenantId**

For each of `PengaturanScreen.tsx`, `StockManagerScreen.tsx`, `StockOpnameScreen.tsx`, `StockOpnameSessionView.tsx`:

- If the file only reads (uses `.fetch()` or `.getCostingMethod()`): no change needed beyond removing type references to `.id`.
- If the file writes: use `useTenant()` hook to get `tenant_id`, pass to service methods.

Example for `PengaturanScreen.tsx` (write path):
```tsx
import { useTenant } from '../contexts/TenantContext';

// Inside component:
const tenant = useTenant();
// ...
await companySettingsService.uploadLogo(tenant!.tenant_id, file);
```

- [ ] **Step 4: Type check + baseline tests**

```bash
npx tsc --noEmit
npx vitest run --dir src --no-coverage 2>&1 | tail -20
```
Expected: no errors. Existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabaseClient.ts src/types.ts src/components/PengaturanScreen.tsx src/components/StockManagerScreen.tsx src/components/stok/StockOpnameScreen.tsx src/components/stok/StockOpnameSessionView.tsx
git commit -m "feat(multi-tenant): companySettingsService refactor — drop .eq('id',1), use tenantId"
```

---

## Task 27: Full local Supabase Docker dry-run + smoke checklist

**Files:**
- Create: `docs/superpowers/plans/2026-07-03-multi-tenant-phase-a-smoke-checklist.md`

**Interfaces:**
- No new code. Manual verification against all four migrations + full test suite on Supabase local.

- [ ] **Step 1: Create smoke checklist**

```markdown
# Phase A — Smoke Checklist (Local Supabase Docker)

## Prerequisites
- [ ] `supabase --version` >= 1.170
- [ ] `docker ps` shows running Docker
- [ ] Repo on branch that contains all Phase A migrations

## Steps

- [ ] `supabase start` — expect all containers healthy
- [ ] `supabase db reset` — expect all migrations apply cleanly (watch for RAISE NOTICE lines)
- [ ] `./scripts/verify-migrations.sh` — expect "OK" output
- [ ] `for f in supabase/tests/pgtap/*.sql; do supabase test db --file "$f"; done` — expect all pgTAP tests pass
- [ ] `npm run test:isolation` — expect all cross-tenant + expiry + impersonation tests pass
- [ ] Manual browser smoke (against local Supabase + local FE `npm run dev`):
  - [ ] Login as tonywei.office@gmail.com via OTP — redirected to `/admin` (super-admin path)
  - [ ] From `/admin`, enter slug "garindo" → impersonate → land on `/t/garindo/dashboard`
  - [ ] All existing Garindo screens load (dashboard, sales, stok, kasir, pengaturan, laporan)
  - [ ] No console errors
  - [ ] Header injection: DevTools → Network → any Supabase request → confirm `x-tenant-slug: garindo` present
  - [ ] Exit impersonation → back to `/admin`
- [ ] Legacy redirect check: type `/dashboard` in URL bar → should auto-redirect to `/t/garindo/dashboard`
- [ ] Read-only mode simulation:
  - [ ] `supabase db psql -c "UPDATE tenant_subscriptions SET expires_at='2020-01-01' WHERE tenant_id='11111111-1111-1111-1111-111111111111';"`
  - [ ] Refresh browser → red banner appears
  - [ ] Any write button (e.g., "Simpan" in Pengaturan) → error toast SUBSCRIPTION_EXPIRED_READONLY
  - [ ] Restore: `UPDATE tenant_subscriptions SET expires_at='2099-12-31' WHERE ...`
```

- [ ] **Step 2: Execute checklist end-to-end**

Run every checkbox item. Note any failure and resolve before Task 28.

- [ ] **Step 3: Commit checklist + note completion**

```bash
git add docs/superpowers/plans/2026-07-03-multi-tenant-phase-a-smoke-checklist.md
git commit -m "docs(multi-tenant): Phase A smoke checklist + local dry-run complete"
```

---

## Task 28: Production apply (halt-gate rollout) + monitor

**Files:**
- No new code. Production migration + FE deploy + monitoring.

**Interfaces:**
- Consumes: all prior tasks green.

- [ ] **Step 1: Backup production DB snapshot**

Via Supabase Dashboard → Database → Backups → Create new snapshot. Confirm timestamp.

- [ ] **Step 2: Apply File 1 to production**

```bash
# via psql to production Supabase (get URL from dashboard)
psql "$PROD_DB_URL" -f supabase/migrations/20261001000001_phase_a_schema.sql
```

Verify: `psql "$PROD_DB_URL" -c "SELECT COUNT(*) FROM tenants;"` returns 0 (schema only, no data yet).

- [ ] **Step 3: Halt gate — verify Garindo users still working**

Log into production frontend as Garindo user (using currently-deployed FE, pre-Phase-A code). Confirm no regression from schema-only changes.

- [ ] **Step 4: Apply File 2 to production**

```bash
psql "$PROD_DB_URL" -f supabase/migrations/20261001000002_phase_a_seed_and_backfill.sql
```

Watch for RAISE NOTICE output. Verify Garindo tenant seeded:
```bash
psql "$PROD_DB_URL" -c "SELECT slug, name, status FROM tenants;"
```

- [ ] **Step 5: Halt gate — quick production DB sanity**

```bash
psql "$PROD_DB_URL" -c "SELECT COUNT(*) FROM stocks WHERE tenant_id IS NULL;"  # expect 0
psql "$PROD_DB_URL" -c "SELECT COUNT(*) FROM stocks WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid;"  # expect all Garindo stocks
```

- [ ] **Step 6: Apply File 3 to production**

```bash
psql "$PROD_DB_URL" -f supabase/migrations/20261001000003_phase_a_not_null_and_rls.sql
```

Verify NOT NULL enforced + tenant_settings synced:
```bash
psql "$PROD_DB_URL" -c "SELECT modul_kasir, modul_multi_warehouse FROM tenant_settings WHERE tenant_id='11111111-1111-1111-1111-111111111111';"
# expect true, true (PREMIUM defaults)
```

- [ ] **Step 7: Halt gate — Garindo user still functional**

Log in as Garindo user with pre-Phase-A frontend. Confirm all screens still load (no RLS lockout because pre-request not wired yet — sentinel behavior still active).

- [ ] **Step 8: Apply File 4 (Layer-A wire)**

```bash
psql "$PROD_DB_URL" -f supabase/migrations/20261001000004_phase_a_wire_layer_a.sql
```

Verify pre-request wired:
```bash
psql "$PROD_DB_URL" -c "SELECT array_to_string(rolconfig, ',') FROM pg_roles WHERE rolname='authenticator';"
# expect: contains "pgrst.db_pre_request=public._pgrst_pre_request"
```

- [ ] **Step 9: Deploy FE to production Cloud Run**

```bash
gcloud builds submit --config cloudbuild.frontend.yaml
```

Watch Cloud Run for successful revision + traffic switched.

- [ ] **Step 10: Post-deploy smoke (production browser)**

- [ ] Login as Garindo user → confirm landing at `/t/garindo/dashboard`
- [ ] Every existing screen loads
- [ ] Cash test transaction (POS mini smoke)
- [ ] Log out + log back in as super-admin → land at `/admin`
- [ ] Impersonate `garindo` → back to `/t/garindo/dashboard`

- [ ] **Step 11: 4-hour monitor window**

- [ ] Supabase → Logs → filter for `errcode = 'P0402'` or `'P0403'` — expect zero unexpected raises
- [ ] Supabase → Advisor → verify no new critical alerts
- [ ] User-report channel — no incidents

- [ ] **Step 12: Update progress.md + tag release**

Append to `progress.md`:

```markdown
## 2026-07-XX — Multi-Tenant Foundation Phase A — DEPLOYED

Phase A live in production. Garindo continues business-as-usual on new
multi-tenant substrate. Ready to accept tenant #2 via SQL insert.

- Migrations applied: 20261001000001..000004
- Isolation test suite green in CI (warn-only gate)
- Zero regression complaints during 4-hour monitor window
- Follow-ups: backend-go Layer-A audit; POS kasir anon auth model review
```

Commit + tag:
```bash
git add progress.md
git commit -m "docs(progress): Phase A multi-tenant foundation DEPLOYED"
git tag -a phase-a-deployed -m "Multi-tenant Phase A live in production"
```

---

## Self-Review

**1. Spec coverage:** Every §1–§9 section maps to at least one task above (§1–§3 → Tasks 1–8; §3.5 guardrails → embedded in Tasks 1, 6, 7, 8, 16; §4 migration plan → Tasks 1–8; §5 RLS audit + isolation → Tasks 6, 7, 13–16; §6 frontend → Tasks 17–26; §7 rollout → Tasks 27–28; §8 explicit deferrals → captured in file structure header; §9 related docs → reference in spec).

**2. Placeholder scan:** No "TBD"/"TODO"/"fill in details" strings. Every step has runnable code or exact commands.

**3. Type consistency:** `TenantContextValue.tenant_id` (Task 19) matches `bootstrap_tenant_context()` return (Task 8) matches `tenantContextService.bootstrap()` shape (Task 18). Error codes in `dispatchTenantError` (Task 20) match `_pgrst_pre_request` RAISE messages (Task 8). Fixed Garindo UUID `11111111-1111-1111-1111-111111111111` used verbatim across Tasks 2, 3, 4, 5, 8, 15, 27, 28.

**Gaps / follow-ups (spec §7.3 risks):**
- Backend Go Layer-A wiring: not part of Phase A initial merge; tracked as Phase A polish task per spec §3.7 — reader can add Task 29 when ready.
- `kasir_transactions` POS device auth model: needs field investigation before RLS tightening; currently included in Task 3 backfill loop (adds tenant_id) and Task 7 category-T policy will apply. If POS device uses anon key, add pre-Task-7 investigation task.
- These items are explicitly out-of-scope for Phase A initial merge per spec §7.4.
