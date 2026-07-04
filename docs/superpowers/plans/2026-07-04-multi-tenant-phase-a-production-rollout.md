# Phase A Production Rollout Runbook

**Date:** 2026-07-04
**Branch merged:** `main` at `a713052` (Phase A squash) — assumes workflow file UI-added
**Target:** Supabase project `ekhhojaezdfjfwuxyjkl` (ERP MSME AI Studio, Garindo production, ap-northeast-1)
**Estimated wall-clock:** 45–90 min if all halt gates pass. Longer if smoke reveals issues.

---

## Pre-flight checklist (do BEFORE Day 0)

- [ ] **Tier decision made.** Free-tier auto-pauses after 7 days idle. If tenant #2 is a real customer, upgrade to Supabase Pro ($25/mo) before real go-live. Runbook works on free tier for the technical apply itself; the tier upgrade is UX-facing (pause elimination).
- [ ] **Read spec §7.6 landmines.** Storage cap, DB size cap, project cap.
- [ ] **`git pull origin main`** — local up-to-date with squash `1526f1f` + workflow `.github/workflows/isolation-audit.yml`.
- [ ] **Verify migration files present locally:**
  ```bash
  ls -la supabase/migrations/20261001*.sql
  # expect 5 files: schema, seed_and_backfill, not_null_and_rls, auth_hook, secdef_ownership
  ```
- [ ] **Confirm founder email in `platform_admins` seed target.** File 2 seed row (Task 2 brief) hardcodes `tonywei.office@gmail.com` — verify this email is in `auth.users` of the target project (production likely already has it).
- [ ] **Schedule window:** low-traffic hours. Garindo is Indonesia MSME — quiet window is typically 22:00–05:00 Jakarta.

---

## Day 0 — Backup + snapshot

- [ ] **Manual backup snapshot** (Supabase Dashboard):
  1. Open project `ekhhojaezdfjfwuxyjkl` (ERP MSME AI Studio) — currently ACTIVE_HEALTHY.
  2. Database → Backups → **Create backup**.
  3. Wait for status = complete. Note timestamp (e.g., `2026-07-04 22:15:00 UTC`).
- [ ] **Note current DB size** for post-apply comparison:
  ```sql
  SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size;
  -- Task 0 spike recorded 35 MB. Expect small growth from Phase A migrations.
  ```
- [ ] **List current SECDEF RPC count** (baseline for Task 8.5 re-ownership tally):
  ```sql
  SELECT COUNT(*) AS secdef_rpcs FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef=true AND p.prokind='f';
  -- Task 0 spike recorded 163. Should be close.
  ```
- [ ] **Note founder user id** (needed later for smoke test):
  ```sql
  SELECT id FROM auth.users WHERE email = 'tonywei.office@gmail.com';
  ```

**Halt gate 0:** if snapshot fails or auto-backup shows problems, STOP. Investigate before touching migrations.

---

## Day 1 — Apply migration file 1 (schema)

- [ ] Apply via MCP `apply_migration` (recommended — records in `supabase_migrations.schema_migrations`) OR via `execute_sql` (does not record).
- [ ] File: `supabase/migrations/20261001000001_phase_a_schema.sql` (199 lines)
- [ ] Verify:
  ```sql
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema='public'
    AND table_name IN ('tenants','platform_admins','tenant_users','plans','tenant_subscriptions',
                       'tenant_activity_daily','platform_admin_audit','platform_admin_active_impersonation');
  -- expect 8
  ```

**Halt gate 1:** if count ≠ 8, STOP. Investigate the missing table via error logs. No user impact yet — schema-only additions don't affect existing app.

**Rollback if needed:**
```sql
DROP TABLE IF EXISTS public.platform_admin_active_impersonation, public.tenant_activity_daily,
                     public.platform_admin_audit, public.tenant_subscriptions, public.plans,
                     public.tenant_users, public.platform_admins, public.tenants CASCADE;
DROP VIEW IF EXISTS public.v_tenant_effective_features;
DROP FUNCTION IF EXISTS public._forbid_slug_change(), public._seed_company_settings_for_new_tenant(),
                       public.sync_tenant_settings_from_subscription(), public.resync_all_tenants_on_plan_change();
```

---

## Day 2 — Apply migration file 2 (seed + backfill)

- [ ] File: `supabase/migrations/20261001000002_phase_a_seed_and_backfill.sql` (~225 lines)
- [ ] This inserts Garindo tenant row + PREMIUM subscription + all existing auth.users → tenant_users + adds `tenant_id` to ~50 business tables (Task 4.5 dynamic block) + restructures `company_settings` (drops `id` column, adds `tenant_id` PK) + adds `tenant_id` to `admin_users`.
- [ ] **This is the most invasive migration.** It touches nearly every business table.
- [ ] Verify:
  ```sql
  -- 1. Garindo seeded
  SELECT slug, name, status FROM public.tenants;                          -- expect 1 row: garindo|Garindo Jaya|ACTIVE
  SELECT COUNT(*) FROM public.plans;                                       -- expect 3
  SELECT tenant_id, plan_code, expires_at FROM public.tenant_subscriptions; -- expect 1 row: 111...111|PREMIUM|2099-12-31
  SELECT COUNT(*) FROM public.tenant_users;                                -- expect (# of existing auth.users)
  SELECT COUNT(*) FROM public.platform_admins WHERE email='tonywei.office@gmail.com'; -- expect 1

  -- 2. Business tables backfilled
  SELECT COUNT(*) FROM public.stocks WHERE tenant_id IS NULL OR tenant_id='00000000-0000-0000-0000-000000000000'::uuid; -- expect 0
  SELECT COUNT(*) FROM public.customers WHERE tenant_id IS NULL;           -- expect 0
  SELECT COUNT(*) FROM public.orders WHERE tenant_id IS NULL;              -- expect 0

  -- 3. company_settings restructured (id column gone, tenant_id is PK)
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='company_settings' AND column_name IN ('id','tenant_id');
  -- expect 1 row: tenant_id

  -- 4. admin_users has tenant_id
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='admin_users' AND column_name='tenant_id';
  -- expect 1 row
  ```

**Halt gate 2:** any of the above verifications fail → STOP. This is the most complex migration. Check `RAISE NOTICE` output in Supabase logs — the dynamic backfill DO block logs per-table.

**Common surprises:**
- Pre-flight anomaly check may raise if any existing row has `tenant_id` value other than NULL/sentinel/Garindo. In that case, manually investigate before proceeding.
- `company_settings.id` DROP fails if any FK references it — Task 0 already confirmed no FKs, but production may have added some.

**Rollback:** requires database restore from Day 0 backup. `company_settings` PK migration + column drop is not trivially reversible.

---

## Day 3 — Apply migration file 3 (NOT NULL + RLS + `_guard_expiry_write` stub + helper)

- [ ] File: `supabase/migrations/20261001000003_phase_a_not_null_and_rls.sql` (~1745 lines — the big one)
- [ ] This: (a) enforces NOT NULL on all tenant_id columns, (b) attaches sync triggers, (c) creates `_guard_expiry_write` stub + `_is_platform_admin_from_jwt` helper, (d) applies RLS hardening to 86 tables (78 T + 6 P + 1 G + 1 A).
- [ ] Verify:
  ```sql
  -- 1. NOT NULL applied
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema='public' AND column_name='tenant_id' AND is_nullable='YES'
    AND table_name NOT IN ('tenants','platform_admins','tenant_users','plans','tenant_subscriptions',
                           'tenant_activity_daily','platform_admin_audit');
  -- expect 0

  -- 2. Helper functions created
  SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace
    AND proname IN ('_guard_expiry_write','_is_platform_admin_from_jwt');
  -- expect 2 rows

  -- 3. RLS enabled + forced on T tables
  SELECT COUNT(*) FROM pg_class WHERE relname IN ('stocks','customers','orders','kasir_transactions')
    AND relforcerowsecurity = true;
  -- expect 4 (or however many T tables in the sample list)

  -- 4. No stale anon-open policies
  SELECT tablename, policyname FROM pg_policies
  WHERE schemaname='public' AND qual='true'
    AND tablename NOT IN ('plans');  -- only G tables can have USING (true)
  -- expect 0 rows
  ```

**Halt gate 3:** NOT NULL enforcement raise-exceptions if any row somehow has NULL tenant_id after migration 2 backfill. RLS creation raise-exceptions if `_resolve_tenant_id()` or `_guard_expiry_write()` don't exist. Both are defensive.

**⚠️ Between file 3 and file 4:** existing app queries will START returning 0 rows for authenticated users, because RLS is now enforced but no JWT tenant claim exists yet. Users may see "empty" screens transiently. This window is minimized by applying file 4 immediately after.

**Rollback:** disable RLS on affected tables:
```sql
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity=true LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;
```

---

## Day 4 — Apply migration file 4 (Auth Hook + guards + impersonation RPCs + bulk auto-wrap)

- [ ] File: `supabase/migrations/20261001000004_phase_a_auth_hook.sql` (~380 lines)
- [ ] This: (a) creates `custom_access_token_hook`, (b) replaces `_resolve_tenant_id` + `_guard_expiry_write` with real JWT-reading bodies, (c) creates `impersonate_tenant`, `stop_impersonation`, `is_platform_admin`, `bootstrap_tenant_context`, (d) grants supabase_auth_admin SELECT on 7 tables, (e) bulk auto-wraps write RPCs with `_guard_expiry_write` guard.
- [ ] Verify:
  ```sql
  -- 1. All 7 core functions exist
  SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace
    AND proname IN ('custom_access_token_hook','_resolve_tenant_id','_guard_expiry_write',
                    'impersonate_tenant','stop_impersonation','is_platform_admin','bootstrap_tenant_context')
  ORDER BY proname;
  -- expect 7 rows

  -- 2. Bulk auto-wrap coverage — write RPCs wrapped
  SELECT COUNT(*) AS unwrapped FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.prokind='f'
    AND p.proname NOT LIKE 'get\_%' ESCAPE '\'
    AND p.proname NOT LIKE 'list\_%' ESCAPE '\'
    AND p.proname NOT LIKE 'resolve\_%' ESCAPE '\'
    AND p.proname NOT LIKE 'is\_%' ESCAPE '\'
    AND p.proname NOT LIKE 'bootstrap\_%' ESCAPE '\'
    AND p.proname NOT LIKE 'log\_%' ESCAPE '\'
    AND p.proname NOT LIKE '\_%' ESCAPE '\'
    AND p.proname NOT IN ('impersonate_tenant','stop_impersonation','sync_tenant_settings_from_subscription',
                          'resync_all_tenants_on_plan_change','company_settings_costing_method_chk',
                          '_forbid_slug_change','_seed_company_settings_for_new_tenant')
    AND p.prosrc ~* '\y(INSERT|UPDATE|DELETE|TRUNCATE)\y'
    AND p.prosrc !~ 'PERFORM\s+(public\.)?_guard_expiry_write\(\s*\)';
  -- expect 0

  -- 3. supabase_auth_admin has SELECT on hook-reachable tables
  SELECT COUNT(*) FROM information_schema.role_table_grants
  WHERE grantee='supabase_auth_admin' AND privilege_type='SELECT'
    AND table_name IN ('platform_admins','platform_admin_active_impersonation','tenants',
                       'tenant_users','tenant_subscriptions','plans');
  -- expect 6
  ```

**Halt gate 4:** If bulk auto-wrap `unwrapped` > 0, at least one write RPC is missing the guard. Manual audit needed. The migration's own hard-fail (`IF v_skipped_count > 5 THEN RAISE`) would have already caught catastrophic cases, but zero-tolerance verification is stricter.

**Rollback:** drop the hook + revert `_resolve_tenant_id` + `_guard_expiry_write` to pre-Phase-A behavior:
```sql
DROP FUNCTION IF EXISTS public.custom_access_token_hook(jsonb) CASCADE;
CREATE OR REPLACE FUNCTION public._resolve_tenant_id() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
BEGIN RETURN '00000000-0000-0000-0000-000000000000'::uuid; END $$;
CREATE OR REPLACE FUNCTION public._guard_expiry_write() RETURNS void LANGUAGE plpgsql STABLE AS $$
BEGIN NULL; END $$;
DROP FUNCTION IF EXISTS public.impersonate_tenant(text), public.stop_impersonation(),
                       public.is_platform_admin(), public.bootstrap_tenant_context();
```

---

## Day 4 (immediate follow-up) — Register Auth Hook in Supabase Dashboard

**⚠️ CRITICAL manual step. Nothing works end-to-end until this is done.**

- [ ] Supabase Dashboard → Project `ekhhojaezdfjfwuxyjkl` → **Authentication** → **Hooks**
- [ ] Section: **Custom Access Token Hook**
- [ ] Toggle: **Enable Hook** → ON
- [ ] Hook Function dropdown: select `public.custom_access_token_hook`
- [ ] Click **Save**
- [ ] Verify by logging into your app in a fresh incognito window:
  - Login via OTP as `tonywei.office@gmail.com`
  - Decode the JWT at https://jwt.io using the access token
  - Confirm claims include `is_platform_admin: true`, `tenant_id`, `tenant_status`, `tenant_expiry_mode`
- [ ] If claims are missing, the hook is not firing. Re-check dashboard toggle + function selection.

**Halt gate 4b:** if JWT lacks claims → STOP frontend deploy. Debug hook function + registration.

---

## Day 5 — Apply migration file 5 (SECDEF ownership)

- [ ] File: `supabase/migrations/20261001000005_phase_a_secdef_ownership.sql` (~210 lines, post-fix)
- [ ] This: (a) creates `vosi_rpc_owner` role NOINHERIT no-BYPASSRLS, (b) grants schema/table/sequence/function privileges + `CREATE ON SCHEMA public` (critical fix from runtime testing), (c) creates `_assert_tenant_context` helper, (d) bulk re-owns all tenant-touching SECDEF RPCs.
- [ ] Verify:
  ```sql
  -- 1. Role created without BYPASSRLS
  SELECT rolname, rolbypassrls, rolsuper, rolinherit FROM pg_roles WHERE rolname='vosi_rpc_owner';
  -- expect: false | false | false

  -- 2. Ownership migration completed
  SELECT COUNT(*) AS still_postgres_owned FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef=true AND p.prokind='f'
    AND p.proowner = 'postgres'::regrole
    AND p.proname NOT IN ('log_impersonation_start','log_impersonation_end','is_platform_admin',
                          'bootstrap_tenant_context','_guard_expiry_write','_resolve_tenant_id',
                          '_forbid_slug_change','_seed_company_settings_for_new_tenant',
                          'sync_tenant_settings_from_subscription','resync_all_tenants_on_plan_change',
                          'custom_access_token_hook','impersonate_tenant','stop_impersonation',
                          '_assert_tenant_context');
  -- expect 0

  -- 3. New owner has functions
  SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef=true AND p.proowner='vosi_rpc_owner'::regrole;
  -- expect roughly 149 (163 total SECDEF minus 14 exclusion list)
  ```

**Halt gate 5:** any function fails to re-own → migration self-aborts via `RAISE EXCEPTION`. Log will name the failing function. Common cause: extension-owned functions in public schema. If found, add to the NOT IN skip list and re-apply.

**Rollback:** revert function ownership to postgres:
```sql
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
           FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proowner='vosi_rpc_owner'::regrole
  LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) OWNER TO postgres', r.proname, r.args);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS public._assert_tenant_context();
DROP ROLE IF EXISTS vosi_rpc_owner;
```

---

## Day 6 — Deploy frontend to Cloud Run

- [ ] Confirm branch main is deployment-ready:
  ```bash
  git status                           # clean
  npx tsc --noEmit                     # no errors
  npx vitest run --dir src --no-coverage 2>&1 | tail -5   # baseline pass
  ```
- [ ] Deploy:
  ```bash
  gcloud builds submit --config cloudbuild.frontend.yaml
  ```
- [ ] Watch Cloud Build → Cloud Run for successful revision + 100% traffic on new revision.

**Halt gate 6:** if Cloud Build fails, investigate. If deploy succeeds but frontend crashes at boot, roll back Cloud Run to previous revision immediately (`gcloud run services update-traffic <service> --to-revisions=<prev>=100`).

---

## Day 7 — End-to-end smoke test

- [ ] Open production frontend in fresh incognito.
- [ ] **Test 1 — founder login (platform admin path):**
  - Login as `tonywei.office@gmail.com` via OTP
  - Expected: redirected to `/admin` (AdminShell)
  - Verify JWT has `is_platform_admin: true` (DevTools → Network → any Supabase request → decode Authorization Bearer token)

- [ ] **Test 2 — impersonate Garindo:**
  - In `/admin`, type slug `garindo`, click Enter
  - Expected: `supabase.auth.refreshSession()` fires, redirected to `/t/garindo/dashboard`
  - Verify JWT now has `tenant_id: 11111111-...`, `impersonating: true`, `impersonating_slug: garindo`

- [ ] **Test 3 — existing Garindo functionality works:**
  - Navigate to `/t/garindo/produk` → stock table loads
  - Navigate to `/t/garindo/pelanggan` → customer list loads
  - Navigate to `/t/garindo/laporan` → reports load
  - No console errors

- [ ] **Test 4 — write path (kasir transaction):**
  - Navigate to `/t/garindo/kasir`
  - Create a small test sale (any product, IDR 1)
  - Save → expected: succeeds (JWT has `tenant_expiry_mode: ACTIVE`)
  - Verify row inserted:
    ```sql
    SELECT id, tenant_id, created_at FROM public.kasir_transactions ORDER BY created_at DESC LIMIT 1;
    -- expect tenant_id = 11111111-... , timestamp very recent
    ```

- [ ] **Test 5 — exit impersonation:**
  - Click "Exit" in AdminShell banner
  - Expected: back to `/admin`, JWT no longer has `impersonating`

- [ ] **Test 6 — expired tenant read-only (optional):**
  - In DB: `UPDATE tenant_subscriptions SET activated_at='2019-01-01', expires_at='2020-01-01' WHERE tenant_id='11111111-1111-1111-1111-111111111111';`
  - Refresh session in browser (or wait for automatic JWT refresh, or logout+login)
  - Expected: red banner "Subscription VOSI kamu expired [X hari lalu]. Mode read-only aktif."
  - Any write action returns `SUBSCRIPTION_EXPIRED_READONLY` toast
  - Reset expiry: `UPDATE tenant_subscriptions SET activated_at='2026-01-01', expires_at='2099-12-31' WHERE tenant_id='11111111-1111-1111-1111-111111111111';`

**Halt gate 7:** if any test fails, do NOT continue with real customer onboarding. Debug and re-verify.

---

## Post-rollout monitoring (first 4 hours)

- [ ] **Watch Supabase logs**: filter for errcode `P0402`, `P0403`, `P0404`, `P0400`, `55006`. Zero expected (except intentional test raises).
- [ ] **Watch Supabase advisor**: any new critical alerts?
- [ ] **Watch Cloud Run logs**: React error rates? 5xx from PostgREST?
- [ ] **Check p95 latency** for a common query (e.g., `SELECT FROM stocks`): compare pre- and post-Phase A. Expected: within 10ms (Auth Hook adds ~0 runtime overhead — it fires only at JWT issue).
- [ ] **Founder + any Garindo staff smoke**: normal-usage validation for 30 minutes each.

---

## Success criteria (Phase A ship-verified)

- [ ] Founder can log in and route to `/admin`.
- [ ] Founder can impersonate Garindo and see all data.
- [ ] Garindo staff (existing users) can log in and see business-as-usual.
- [ ] Write operations succeed (kasir sale, customer edit, stock movement).
- [ ] Zero unexpected error codes in first 4 hours.
- [ ] JWT correctly baked with tenant claims on every session.

---

## Onboarding tenant #2 (after Phase A verified)

Manual SQL for now (Phase B builds the admin UI for this):

```sql
BEGIN;

-- Choose a UUID (or let gen_random_uuid pick)
INSERT INTO public.tenants (id, slug, name, status)
VALUES ('22222222-2222-2222-2222-222222222222', 'apoteksehat', 'Apotek Sehat', 'ACTIVE');

-- Assign a plan (or use PREMIUM by default)
INSERT INTO public.tenant_subscriptions (tenant_id, plan_code, activated_at, expires_at)
VALUES ('22222222-2222-2222-2222-222222222222', 'PRO', '2026-07-04', '2027-07-04');

-- Invite owner (assumes auth.users row already exists via OTP signup)
INSERT INTO public.tenant_users (tenant_id, user_id, role, status)
VALUES ('22222222-2222-2222-2222-222222222222',
        (SELECT id FROM auth.users WHERE email='owner@apoteksehat.co.id'),
        'owner', 'ACTIVE');

COMMIT;

-- Tell owner: log out + log back in. Their new JWT will include tenant_id.
-- They'll land at /t/apoteksehat/dashboard.
```

---

## Backlog to close before scaling beyond 3 tenants

1. **Category-P + Category-A RLS test coverage** (would have caught C1 — spec §6 backlog item I3).
2. **Backend Go audit** for JWT forwarding — every Go handler must pass Authorization header to Supabase-facing calls.
3. **App.tsx legacy redirect** hardcodes `/t/garindo/*` — replace with dynamic tenant lookup post-Phase-B.
4. **AdminShell full-page reload** on redirects — UX polish, use SPA navigate.
5. **Isolation test suite runtime verification** — actually run it against a Supabase local Docker (or CI). Currently type-checked only.
6. **CI workflow soft-launch → hard-fail** transition — after 2 weeks warn-only, tighten `set_config(..., false)` grep to hard-fail per spec §5.5.
7. **Phase B planning** — admin UI (list/create tenant), onboarding form, data import wizards, feature toggle grid, audit log viewer.
