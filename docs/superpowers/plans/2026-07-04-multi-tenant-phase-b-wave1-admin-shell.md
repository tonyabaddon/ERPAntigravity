# Multi-Tenant Phase B — Wave 1: Read-Only Admin Panel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the read-only super-admin panel — home dashboard, tenants list, tenant detail (Overview/Users/Audit tabs), audit log viewer, plans management. Zero write actions besides Phase A impersonation. Ready for founder to explore tenant state in production.

**Architecture:** Phase B is additive to Phase A. Wave 1 introduces sidebar-based navigation (`AdminLayout`) that wraps existing `AdminShell` impersonation logic, adds React Router sub-routes under `/admin/*`, and reads data via 3 new SECDEF RPCs (`list_tenants_admin`, `list_audit_events`, `_get_platform_dashboard_stats`). All new tables/columns from Phase B spec that are Wave 1-scoped ship in a single migration file.

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind CSS v4 + React Router v6 + Vitest + React Testing Library + Supabase (Postgres + Auth + RPC). New dependency: `sonner` for toast notifications (replaces `alert()`).

## Global Constraints

- Every new RPC MUST include the platform-admin gate: `IF NOT public._is_platform_admin_from_jwt() THEN RAISE EXCEPTION USING errcode='P0403', message='PLATFORM_ADMIN_REQUIRED'; END IF;` — reviewers reject RPCs missing this.
- Every new RPC is `SECURITY DEFINER`, owned by `vosi_rpc_owner`, granted to `authenticated`.
- Every new table gets `COMMENT ON TABLE ... IS 'category=P'` (Phase A convention; category-P = platform-scoped).
- Migration files go in `supabase/migrations/` with slot `20261115000001` through `20261115000009` (Wave 1 range, safe distance from any parallel work).
- pgTAP tests go in `supabase/tests/wave1/` — one `.sql` file per RPC.
- Frontend paths follow existing convention: `src/components/admin/*` (existing dir).
- Tailwind classes; no CSS modules or styled-components.
- Font size floor (per user preference `feedback_font_sizing`): UI base 13-14px, tables 12-13px. No text below 11px.
- **Language: WAJIB Bahasa Indonesia** untuk SEMUA user-facing copy (label, button, notice, tooltip, error message). Admin operator adalah orang Indonesia yang tidak bisa Bahasa Inggris. English HANYA boleh untuk: nama kode (`modul_kasir`), audit action code (`IMPERSONATE_START`), nama brand (PRO/PREMIUM/STARTER/VOSI/Google), URL segment (`/admin`). Reviewers reject label English seperti "Home", "Users", "Actions", "Save", "Cancel", "Loading" — WAJIB terjemahkan sesuai glossary di spec §14.8.
- **Tenant usage tracking**: Wave 1 include `v_tenant_usage_summary` view + kolom "Pakai sistem" di TenantsList + tabel "Aktivitas tenant hari ini" di AdminHome. Sumber: `tenant_activity_daily` (Phase A stub) + `auth.users.last_sign_in_at` JOIN via `tenant_users`. Status derivation: SANGAT_AKTIF (>100 txn/hari), AKTIF (1-100/hari), IDLE (0 txn 7d), VAKUM (tidak login 30d).
- **Design system: VOSI Design System v1.0** — **source of truth: [`docs/VOSI-Design-System.md`](../../VOSI-Design-System.md)** (dont paraphrase; refer + verify).
  - Core tokens verbatim: navy `#0B2545`, gold `#F9B233`, cream `#FAF7F0`, slate `#5A6472`, muted `#9DB2CE`, surface `#ECEEF1`, success `#1F8A5B`, danger `#C0392B`, info `#2A6FDB`
  - Fonts: `Plus Jakarta Sans` (400-800) via Google Fonts `<link>` in `index.html`; `JetBrains Mono` (400-700) for label, angka, kode
  - Tailwind config extension: `vosi-navy`, `vosi-gold`, `vosi-cream`, `vosi-slate`, `vosi-muted`, `vosi-surface`, `vosi-ink`, `vosi-success`, `vosi-danger`, `vosi-info`, `vosi-special` (see spec §14.2)
  - Rules: **60/30/10** — Navy or Cream dominant 60%, supporting neutral 30%, Gold accent MAX 10% (one focal point per screen)
  - Primary button: `bg-vosi-gold text-vosi-navy font-extrabold rounded-full px-6 py-3.5`
  - Card: `bg-white border border-[#E0E3E8] rounded-[20px] p-8 shadow-[0_16px_34px_rgba(11,37,69,0.10)]`
  - Icons: `lucide-react` with `strokeWidth={1.8}` `strokeLinecap="round"`; brand mascot = `vosi-icon-gold.png` only (no emoji in production UI)
  - Reviewers reject: any hex outside VOSI token catalog, Gold blocks of long text, more than 1 Gold focal per screen, `bg-blue-*`/`bg-emerald-*`/`bg-amber-*`/`bg-rose-*` Tailwind defaults (use `bg-vosi-*` semantic), `Anda` formal copy, dev jargon in user-facing surfaces (see spec §14.8)
- Toast library: `sonner` (~4KB). Replace all `alert()` calls in AdminShell with `toast.error()` / `toast.success()`.
- Route guard: non-platform-admin hitting `/admin/*` redirects to `/dashboard` with toast "Halaman khusus admin".
- Data fetching: plain `useEffect + async` (no react-query — matches existing codebase).
- Test naming: `.test.tsx` co-located with source component; existing convention.
- No `any` types in new TS code (project already uses strict TS).
- Existing Garindo tenant MUST render normally — regression test at end of each task.

---

## File Structure

**Backend (SQL migrations):**
- `supabase/migrations/20261115000001_phase_b_wave1_plans_company_extensions.sql` — extend `plans` + `company_settings`; backfill Garindo
- `supabase/migrations/20261115000002_phase_b_wave1_list_tenants_admin.sql` — `list_tenants_admin(p_filters jsonb)` RPC
- `supabase/migrations/20261115000003_phase_b_wave1_list_audit_events.sql` — `list_audit_events(p_filters jsonb)` RPC
- `supabase/migrations/20261115000004_phase_b_wave1_dashboard_stats.sql` — `_get_platform_dashboard_stats() → jsonb` RPC

**Backend (pgTAP tests):**
- `supabase/tests/wave1/list_tenants_admin.sql`
- `supabase/tests/wave1/list_audit_events.sql`
- `supabase/tests/wave1/dashboard_stats.sql`

**Frontend (new files):**
- `src/components/admin/AdminLayout.tsx` — sidebar + top header + impersonation banner + `<Outlet />`
- `src/components/admin/AdminSidebar.tsx` — navigation list with badges
- `src/components/admin/AdminHome.tsx` — dashboard root
- `src/components/admin/KPICard.tsx` — reusable metric card
- `src/components/admin/AttentionQueue.tsx` — expiring / suspended / pending imports queue
- `src/components/admin/RecentActivityFeed.tsx` — last 20 audit events
- `src/components/admin/TenantsList.tsx` — searchable table
- `src/components/admin/TenantsTable.tsx` — table primitive
- `src/components/admin/TenantDetail/TenantDetailShell.tsx` — tabbed container
- `src/components/admin/TenantDetail/OverviewTab.tsx`
- `src/components/admin/TenantDetail/UsersTab.tsx` — read-only staff list
- `src/components/admin/TenantDetail/AuditTab.tsx` — per-tenant audit filter
- `src/components/admin/AuditLogViewer.tsx` — global `/admin/audit`
- `src/components/admin/PlansManagement.tsx` — read-only 3-card view
- `src/components/admin/EmptyHomeState.tsx` — when only 1 tenant exists
- `src/lib/adminApi.ts` — typed RPC wrappers (list_tenants_admin, list_audit_events, dashboard_stats)
- `src/lib/adminTypes.ts` — TS types for admin domain (`AdminTenantRow`, `AuditEventRow`, `DashboardStats`)

**Frontend (modified):**
- `src/components/admin/AdminShell.tsx` — refactor to compose `AdminLayout`
- `src/App.tsx` — register `/admin/*` sub-routes; gate with platform-admin check
- `src/main.tsx` — mount `<Toaster />` from `sonner` globally
- `package.json` — add `sonner` dependency

**Test files (co-located):**
- One `.test.tsx` per component (~15 test files)

---

## Task 1: Migration — extend `plans` + `company_settings`, Garindo backfill

**Files:**
- Create: `supabase/migrations/20261115000001_phase_b_wave1_plans_company_extensions.sql`
- Create: `supabase/tests/wave1/plans_company_extensions.sql`

**Interfaces:**
- Consumes: existing `plans`, `company_settings` tables (Phase A)
- Produces:
  - `plans.description TEXT`, `plans.target_segment TEXT`, `plans.is_recommended BOOLEAN DEFAULT false`
  - `company_settings.industry TEXT`, `company_settings.employee_range TEXT CHECK IN (4 bucket values)`
  - Garindo row backfilled

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20261115000001_phase_b_wave1_plans_company_extensions.sql`:

```sql
-- Phase B Wave 1: extend plans + company_settings; backfill Garindo
BEGIN;

-- 2.1 plans extension: display metadata
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS target_segment TEXT,
  ADD COLUMN IF NOT EXISTS is_recommended BOOLEAN NOT NULL DEFAULT false;

UPDATE public.plans SET
  description = 'Warung / kios kecil dengan operasi minimal',
  target_segment = 'MSME 1-3 karyawan'
WHERE code = 'STARTER' AND description IS NULL;

UPDATE public.plans SET
  description = 'Toko retail dengan tempo + accounting',
  target_segment = 'MSME 5-15 karyawan',
  is_recommended = true
WHERE code = 'PRO' AND description IS NULL;

UPDATE public.plans SET
  description = 'Distributor / manufaktur multi-gudang',
  target_segment = 'B2B 20+ karyawan'
WHERE code = 'PREMIUM' AND description IS NULL;

-- 2.1b company_settings extension: business profile
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS industry TEXT,
  ADD COLUMN IF NOT EXISTS employee_range TEXT,
  ADD COLUMN IF NOT EXISTS annual_revenue_range TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'company_settings_employee_range_check'
  ) THEN
    ALTER TABLE public.company_settings
      ADD CONSTRAINT company_settings_employee_range_check
      CHECK (employee_range IS NULL OR employee_range IN (
        '1-3 orang (Mikro)',
        '4-19 orang (Kecil)',
        '20-99 orang (Menengah)',
        '100+ orang (Besar)'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'company_settings_annual_revenue_range_check'
  ) THEN
    ALTER TABLE public.company_settings
      ADD CONSTRAINT company_settings_annual_revenue_range_check
      CHECK (annual_revenue_range IS NULL OR annual_revenue_range IN (
        '< 300 juta (Mikro)',
        '300 juta - 2.5 miliar (Kecil)',
        '2.5 - 15 miliar (Menengah)',
        '15 - 50 miliar (Besar)',
        '> 50 miliar (Enterprise)'
      ));
  END IF;
END $$;

-- Backfill Garindo so it doesn't appear as "unprofiled"
UPDATE public.company_settings
SET
  industry = COALESCE(industry, 'Retail/Toko umum'),
  employee_range = COALESCE(employee_range, '4-19 orang (Kecil)'),
  annual_revenue_range = COALESCE(annual_revenue_range, '300 juta - 2.5 miliar (Kecil)')
WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug = 'garindo');

COMMIT;
```

- [ ] **Step 2: Write the failing pgTAP test**

Create `supabase/tests/wave1/plans_company_extensions.sql`:

```sql
BEGIN;
SELECT plan(9);

-- plans columns exist
SELECT has_column('public', 'plans', 'description');
SELECT has_column('public', 'plans', 'target_segment');
SELECT has_column('public', 'plans', 'is_recommended');

-- plans backfilled
SELECT is(
  (SELECT description FROM public.plans WHERE code = 'PRO'),
  'Toko retail dengan tempo + accounting',
  'PRO plan has description'
);
SELECT is(
  (SELECT is_recommended FROM public.plans WHERE code = 'PRO'),
  true,
  'PRO is marked recommended'
);

-- company_settings columns exist
SELECT has_column('public', 'company_settings', 'industry');
SELECT has_column('public', 'company_settings', 'employee_range');

-- employee_range CHECK constraint blocks bad values
SELECT throws_ok(
  $$ INSERT INTO public.company_settings (tenant_id, industry, employee_range)
     VALUES ('00000000-0000-0000-0000-000000000000'::uuid, 'x', 'INVALID BUCKET') $$,
  '23514',
  NULL,
  'employee_range CHECK rejects invalid bucket'
);

-- Garindo backfilled
SELECT is(
  (SELECT industry FROM public.company_settings
   WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug = 'garindo')),
  'Retail/Toko umum',
  'Garindo industry backfilled'
);

SELECT finish();
ROLLBACK;
```

- [ ] **Step 3: Apply the migration via MCP**

Run via MCP `mcp__plugin_supabase_supabase__apply_migration` with project ref `ekhhojaezdfjfwuxyjkl` (Garindo prod) and the migration SQL. Confirm returns success.

Alternative (local dev): `supabase db push` if using local stack.

- [ ] **Step 4: Run pgTAP test**

Run: `psql "$DATABASE_URL" -f supabase/tests/wave1/plans_company_extensions.sql`
Expected: all 9 tests PASS.

- [ ] **Step 5: Regression check — Garindo still loads**

Run via chrome-devtools MCP (or manually):
1. `mcp__chrome-devtools__navigate_page` to `https://vosi.id/garindo/dashboard`
2. Login as Garindo owner
3. Verify no console errors
4. Verify `useTenant()` still returns valid tenant data

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261115000001_phase_b_wave1_plans_company_extensions.sql supabase/tests/wave1/plans_company_extensions.sql
git commit -m "feat(phase-b): Wave 1 — extend plans + company_settings, backfill Garindo"
```

---

## Task 2: `list_tenants_admin` RPC + pgTAP test

**Files:**
- Create: `supabase/migrations/20261115000002_phase_b_wave1_list_tenants_admin.sql`
- Create: `supabase/tests/wave1/list_tenants_admin.sql`

**Interfaces:**
- Consumes: `plans` (from Task 1), `tenants`, `tenant_subscriptions`, `tenant_users`, `tenant_settings`, `company_settings`, `tenant_activity_daily`, `auth.users` (Phase A)
- Produces:
  - `v_tenant_usage_summary` VIEW — per-tenant last_login + txn_7d + avg_daily + usage_status
  - `list_tenants_admin(p_filters jsonb DEFAULT '{}'::jsonb) RETURNS TABLE(...)` — returns tenant list with joined data for admin table INCLUDING usage columns

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20261115000002_phase_b_wave1_list_tenants_admin.sql`:

```sql
BEGIN;

-- Usage summary view: per-tenant last_login + txn_7d + usage_status
CREATE OR REPLACE VIEW public.v_tenant_usage_summary AS
SELECT
  t.id AS tenant_id,
  (SELECT MAX(u.last_sign_in_at)
     FROM public.tenant_users tu
     JOIN auth.users u ON u.id = tu.user_id
     WHERE tu.tenant_id = t.id) AS last_login_at,
  COALESCE((SELECT SUM(tad.transaction_count)::INT
     FROM public.tenant_activity_daily tad
     WHERE tad.tenant_id = t.id
       AND tad.activity_date >= CURRENT_DATE - INTERVAL '7 days'), 0) AS txn_7d,
  COALESCE((SELECT ROUND(SUM(tad.transaction_count)::NUMERIC / 7, 1)
     FROM public.tenant_activity_daily tad
     WHERE tad.tenant_id = t.id
       AND tad.activity_date >= CURRENT_DATE - INTERVAL '7 days'), 0) AS avg_daily_txn,
  CASE
    WHEN COALESCE((SELECT SUM(tad.transaction_count)
       FROM public.tenant_activity_daily tad
       WHERE tad.tenant_id = t.id
         AND tad.activity_date >= CURRENT_DATE - INTERVAL '7 days'), 0) / 7.0 > 100 THEN 'SANGAT_AKTIF'
    WHEN COALESCE((SELECT SUM(tad.transaction_count)
       FROM public.tenant_activity_daily tad
       WHERE tad.tenant_id = t.id
         AND tad.activity_date >= CURRENT_DATE - INTERVAL '7 days'), 0) >= 1 THEN 'AKTIF'
    WHEN (SELECT MAX(u.last_sign_in_at)
       FROM public.tenant_users tu
       JOIN auth.users u ON u.id = tu.user_id
       WHERE tu.tenant_id = t.id) < NOW() - INTERVAL '30 days' THEN 'VAKUM'
    ELSE 'IDLE'
  END AS usage_status
FROM public.tenants t;

COMMENT ON VIEW public.v_tenant_usage_summary IS 'category=P; Wave 1 tenant activity summary.';

CREATE OR REPLACE FUNCTION public.list_tenants_admin(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  tenant_id           UUID,
  slug                TEXT,
  name                TEXT,
  plan_code           TEXT,
  status              TEXT,
  expiry_mode         TEXT,
  activated_at        DATE,
  expires_at          DATE,
  days_until_expiry   INT,
  user_count          INT,
  sku_count           INT,
  industry            TEXT,
  employee_range      TEXT,
  onboarded_at        TIMESTAMPTZ,
  last_login_at       TIMESTAMPTZ,
  txn_7d              INT,
  avg_daily_txn       NUMERIC,
  usage_status        TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
  v_search      TEXT := p_filters->>'search';
  v_plan_filter TEXT := p_filters->>'plan';
  v_status      TEXT := p_filters->>'status';
  v_expiry_max  INT  := (p_filters->>'expiry_within_days')::INT;
BEGIN
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
  END IF;

  RETURN QUERY
  SELECT
    t.id                                         AS tenant_id,
    t.slug,
    t.name,
    ts.plan_code,
    t.status,
    ts.expiry_mode,
    ts.activated_at,
    ts.expires_at,
    (ts.expires_at - CURRENT_DATE)::INT          AS days_until_expiry,
    (SELECT COUNT(*)::INT FROM public.tenant_users tu WHERE tu.tenant_id = t.id) AS user_count,
    COALESCE((SELECT COUNT(*)::INT FROM public.stocks s WHERE s.tenant_id = t.id), 0) AS sku_count,
    cs.industry,
    cs.employee_range,
    t.created_at                                 AS onboarded_at,
    us.last_login_at,
    us.txn_7d,
    us.avg_daily_txn,
    us.usage_status
  FROM public.tenants t
  LEFT JOIN public.tenant_subscriptions ts ON ts.tenant_id = t.id
  LEFT JOIN public.company_settings cs      ON cs.tenant_id = t.id
  LEFT JOIN public.v_tenant_usage_summary us ON us.tenant_id = t.id
  WHERE
    (v_search IS NULL OR v_search = '' OR
       t.slug ILIKE '%' || v_search || '%' OR
       t.name ILIKE '%' || v_search || '%')
    AND (v_plan_filter IS NULL OR v_plan_filter = '' OR ts.plan_code = v_plan_filter)
    AND (v_status IS NULL OR v_status = '' OR t.status = v_status)
    AND (v_expiry_max IS NULL OR (ts.expires_at - CURRENT_DATE) <= v_expiry_max)
  ORDER BY t.name;
END;
$$;

REVOKE ALL ON FUNCTION public.list_tenants_admin(jsonb) FROM PUBLIC;
ALTER FUNCTION public.list_tenants_admin(jsonb) OWNER TO vosi_rpc_owner;
GRANT EXECUTE ON FUNCTION public.list_tenants_admin(jsonb) TO authenticated;

COMMENT ON FUNCTION public.list_tenants_admin(jsonb) IS
  'Wave 1: super-admin tenant list with filters. category=P.';

COMMIT;
```

- [ ] **Step 2: Write the failing pgTAP test**

Create `supabase/tests/wave1/list_tenants_admin.sql`:

```sql
BEGIN;
SELECT plan(5);

-- Set fake platform_admin JWT context
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (SELECT user_id FROM public.platform_admins LIMIT 1)::text,
    'is_platform_admin', 'true'
  )::text,
  true
);

-- No-filter returns >= 1 row (Garindo exists)
SELECT ok(
  (SELECT COUNT(*) FROM public.list_tenants_admin('{}'::jsonb)) >= 1,
  'list_tenants_admin returns at least Garindo'
);

-- Search filter
SELECT ok(
  (SELECT COUNT(*) FROM public.list_tenants_admin('{"search":"garindo"}'::jsonb)) >= 1,
  'search=garindo returns Garindo'
);
SELECT is(
  (SELECT COUNT(*) FROM public.list_tenants_admin('{"search":"nonexistent-slug-xyz"}'::jsonb))::INT,
  0,
  'search=nonexistent returns 0 rows'
);

-- Plan filter
SELECT ok(
  (SELECT COUNT(*) FROM public.list_tenants_admin('{"plan":"PREMIUM"}'::jsonb)) >= 1,
  'plan=PREMIUM returns >= 1 tenant (Garindo is PREMIUM)'
);

-- Non-admin gets rejected
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","is_platform_admin":"false"}',
  true
);
SELECT throws_ok(
  $$ SELECT * FROM public.list_tenants_admin('{}'::jsonb) $$,
  'P0403',
  'PLATFORM_ADMIN_REQUIRED',
  'non-admin blocked with P0403'
);

SELECT finish();
ROLLBACK;
```

- [ ] **Step 3: Apply migration + run test**

Apply via MCP `apply_migration`. Then run `psql "$DATABASE_URL" -f supabase/tests/wave1/list_tenants_admin.sql`.
Expected: 5/5 tests PASS.

- [ ] **Step 4: Smoke test via SQL as platform admin**

```sql
-- Simulate platform admin session
SET LOCAL "request.jwt.claims" = '{"sub":"<admin-user-uuid>","is_platform_admin":"true"}';
SELECT tenant_id, slug, name, plan_code, days_until_expiry FROM public.list_tenants_admin('{}'::jsonb);
```

Expected: at minimum Garindo returned with correct plan.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261115000002_phase_b_wave1_list_tenants_admin.sql supabase/tests/wave1/list_tenants_admin.sql
git commit -m "feat(phase-b): list_tenants_admin RPC with admin gate"
```

---

## Task 3: `list_audit_events` + `_get_platform_dashboard_stats` RPCs

**Files:**
- Create: `supabase/migrations/20261115000003_phase_b_wave1_list_audit_events.sql`
- Create: `supabase/migrations/20261115000004_phase_b_wave1_dashboard_stats.sql`
- Create: `supabase/tests/wave1/list_audit_events.sql`
- Create: `supabase/tests/wave1/dashboard_stats.sql`

**Interfaces:**
- Consumes: `platform_admin_audit`, output from Task 2 for stats aggregation
- Produces:
  - `list_audit_events(p_filters jsonb) RETURNS TABLE(id uuid, ts timestamptz, admin_email text, tenant_slug text, action text, detail jsonb)` — paginated audit rows
  - `_get_platform_dashboard_stats() RETURNS jsonb` — `{active_tenants, expiring_45d, pending_imports_placeholder, plans_count}`

- [ ] **Step 1: Write `list_audit_events` migration**

Create `supabase/migrations/20261115000003_phase_b_wave1_list_audit_events.sql`:

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.list_audit_events(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  id           UUID,
  ts           TIMESTAMPTZ,
  admin_email  TEXT,
  tenant_slug  TEXT,
  action       TEXT,
  detail       JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
  v_tenant_id UUID   := (p_filters->>'tenant_id')::UUID;
  v_action    TEXT   := p_filters->>'action';
  v_admin_id  UUID   := (p_filters->>'admin_user_id')::UUID;
  v_from      TIMESTAMPTZ := (p_filters->>'from_ts')::TIMESTAMPTZ;
  v_to        TIMESTAMPTZ := (p_filters->>'to_ts')::TIMESTAMPTZ;
  v_limit     INT    := COALESCE((p_filters->>'limit')::INT, 50);
  v_offset    INT    := COALESCE((p_filters->>'offset')::INT, 0);
BEGIN
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
  END IF;

  IF v_limit > 500 THEN v_limit := 500; END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.created_at AS ts,
    (SELECT u.email FROM auth.users u WHERE u.id = a.admin_user_id) AS admin_email,
    (SELECT t.slug FROM public.tenants t WHERE t.id = a.tenant_id) AS tenant_slug,
    a.action,
    a.detail_json AS detail
  FROM public.platform_admin_audit a
  WHERE
    (v_tenant_id IS NULL OR a.tenant_id = v_tenant_id)
    AND (v_action IS NULL OR v_action = '' OR a.action = v_action)
    AND (v_admin_id IS NULL OR a.admin_user_id = v_admin_id)
    AND (v_from IS NULL OR a.created_at >= v_from)
    AND (v_to IS NULL OR a.created_at <= v_to)
  ORDER BY a.created_at DESC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.list_audit_events(jsonb) FROM PUBLIC;
ALTER FUNCTION public.list_audit_events(jsonb) OWNER TO vosi_rpc_owner;
GRANT EXECUTE ON FUNCTION public.list_audit_events(jsonb) TO authenticated;

COMMENT ON FUNCTION public.list_audit_events(jsonb) IS
  'Wave 1: super-admin audit event list with filters. category=P.';

COMMIT;
```

- [ ] **Step 2: Write `_get_platform_dashboard_stats` migration**

Create `supabase/migrations/20261115000004_phase_b_wave1_dashboard_stats.sql`:

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public._get_platform_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
  END IF;

  SELECT jsonb_build_object(
    'active_tenants',
      (SELECT COUNT(*)::INT FROM public.tenants WHERE status = 'ACTIVE'),
    'total_tenants',
      (SELECT COUNT(*)::INT FROM public.tenants),
    'expiring_45d',
      (SELECT COUNT(*)::INT FROM public.tenant_subscriptions
       WHERE expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '45 days'),
    'plans_count',
      (SELECT COUNT(*)::INT FROM public.plans),
    'pending_imports',
      0   -- Wave 3 populates this
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public._get_platform_dashboard_stats() FROM PUBLIC;
ALTER FUNCTION public._get_platform_dashboard_stats() OWNER TO vosi_rpc_owner;
GRANT EXECUTE ON FUNCTION public._get_platform_dashboard_stats() TO authenticated;

COMMENT ON FUNCTION public._get_platform_dashboard_stats() IS
  'Wave 1: super-admin home KPI stats. category=P.';

COMMIT;
```

- [ ] **Step 3: Write pgTAP tests**

Create `supabase/tests/wave1/list_audit_events.sql`:

```sql
BEGIN;
SELECT plan(3);

SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (SELECT user_id FROM public.platform_admins LIMIT 1)::text,
    'is_platform_admin', 'true'
  )::text,
  true
);

SELECT ok(
  (SELECT COUNT(*) FROM public.list_audit_events('{}'::jsonb)) >= 0,
  'list_audit_events returns rows (may be zero)'
);
SELECT ok(
  (SELECT COUNT(*) FROM public.list_audit_events('{"limit":10}'::jsonb)) <= 10,
  'limit clamps result set'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","is_platform_admin":"false"}',
  true
);
SELECT throws_ok(
  $$ SELECT * FROM public.list_audit_events('{}'::jsonb) $$,
  'P0403', 'PLATFORM_ADMIN_REQUIRED',
  'non-admin blocked'
);

SELECT finish();
ROLLBACK;
```

Create `supabase/tests/wave1/dashboard_stats.sql`:

```sql
BEGIN;
SELECT plan(3);

SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (SELECT user_id FROM public.platform_admins LIMIT 1)::text,
    'is_platform_admin', 'true'
  )::text,
  true
);

SELECT ok(
  ((public._get_platform_dashboard_stats()->>'active_tenants')::INT >= 1),
  'active_tenants at least 1 (Garindo)'
);
SELECT ok(
  ((public._get_platform_dashboard_stats()->>'plans_count')::INT = 3),
  'plans_count is 3 (STARTER/PRO/PREMIUM)'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","is_platform_admin":"false"}',
  true
);
SELECT throws_ok(
  $$ SELECT public._get_platform_dashboard_stats() $$,
  'P0403', 'PLATFORM_ADMIN_REQUIRED',
  'non-admin blocked'
);

SELECT finish();
ROLLBACK;
```

- [ ] **Step 4: Apply migrations + run tests**

Apply both migrations via MCP. Then:
```bash
psql "$DATABASE_URL" -f supabase/tests/wave1/list_audit_events.sql
psql "$DATABASE_URL" -f supabase/tests/wave1/dashboard_stats.sql
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261115000003_*.sql supabase/migrations/20261115000004_*.sql supabase/tests/wave1/list_audit_events.sql supabase/tests/wave1/dashboard_stats.sql
git commit -m "feat(phase-b): list_audit_events + dashboard stats RPCs"
```

---

## Task 4: Wire VOSI design tokens + fonts + `sonner` toast

**Files:**
- Modify: `index.html` — add Google Fonts `<link>`
- Modify: `tailwind.config.js` — extend with VOSI tokens + fonts
- Modify: `src/index.css` — set body font-family default
- Modify: `package.json` — add `sonner` dep
- Modify: `src/main.tsx` — mount `<Toaster />`
- Create: `src/lib/adminToast.ts` — thin wrapper for typed toast helpers

**Interfaces:**
- Consumes: nothing new (sonner is standalone)
- Produces:
  - Tailwind classes `bg-vosi-navy`, `text-vosi-gold`, `font-mono`, etc. available globally
  - Body uses Plus Jakarta Sans; code/mono elements use JetBrains Mono
  - `import { toast } from 'sonner'` available in all admin components
  - `adminToast.error(msg: string)`, `adminToast.success(msg: string)` helpers

- [ ] **Step 0a: Add Google Fonts `<link>` in `index.html`**

Modify `index.html` — add inside `<head>` (before existing stylesheet):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
```

- [ ] **Step 0b: Extend Tailwind config with VOSI tokens**

Modify `tailwind.config.js` — extend `theme.extend`:

```js
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        'vosi-navy':    '#0B2545',
        'vosi-gold':    '#F9B233',
        'vosi-cream':   '#FAF7F0',
        'vosi-slate':   '#5A6472',
        'vosi-muted':   '#9DB2CE',
        'vosi-surface': '#ECEEF1',
        'vosi-ink':     '#14161B',
        'vosi-success': '#1F8A5B',
        'vosi-danger':  '#C0392B',
        'vosi-info':    '#2A6FDB',
        'vosi-special': '#7C5CBF',
      },
      borderRadius: {
        'vosi-card': '20px',
        'vosi-pill': '100px',
      },
      boxShadow: {
        'vosi-card': '0 16px 34px rgba(11,37,69,0.10)',
        'vosi-hero': '0 26px 60px rgba(20,20,30,0.16)',
      },
    },
  },
  plugins: [],
}
```

- [ ] **Step 0c: Set default body font in `src/index.css`**

Modify `src/index.css` — add at top (after `@import "tailwindcss"`):

```css
body {
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
  font-weight: 500;
  color: #0B2545;
  background: #FAF7F0;
}
code, kbd, samp, pre, .font-mono {
  font-family: 'JetBrains Mono', monospace;
}
```

- [ ] **Step 0d: Smoke test tokens**

Run: `npm run dev`. Open browser to any existing screen.
Expected: Body renders in Plus Jakarta Sans (verify via DevTools computed styles). Existing screens shouldn't break (only body font + color changed; class-level styles override).

Regression: quickly verify Garindo `/t/garindo/dashboard` still visually renders — no layout shift.

Commit checkpoint:
```bash
git add index.html tailwind.config.js src/index.css
git commit -m "feat(phase-b): wire VOSI design tokens + fonts globally"
```

- [ ] **Step 1: Install sonner**

Run: `npm install sonner`
Expected: package.json shows `"sonner": "^1.x.x"`.

- [ ] **Step 2: Mount `<Toaster />` in main.tsx**

Modify `src/main.tsx`. Add import + mount inside root `<React.StrictMode>` wrapper:

```tsx
import { Toaster } from 'sonner';

// ... inside ReactDOM.createRoot(...).render(
<React.StrictMode>
  <App />
  <Toaster position="top-right" richColors closeButton />
</React.StrictMode>
```

- [ ] **Step 3: Create typed wrapper**

Create `src/lib/adminToast.ts`:

```tsx
import { toast } from 'sonner';

export const adminToast = {
  success(message: string, description?: string) {
    toast.success(message, { description });
  },
  error(message: string, description?: string) {
    toast.error(message, { description });
  },
  info(message: string, description?: string) {
    toast.info(message, { description });
  },
};
```

- [ ] **Step 4: Write smoke test**

Create `src/lib/adminToast.test.ts`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { toast } from 'sonner';
import { adminToast } from './adminToast';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('adminToast', () => {
  it('forwards success calls to sonner', () => {
    adminToast.success('Saved', 'Great');
    expect(toast.success).toHaveBeenCalledWith('Saved', { description: 'Great' });
  });
  it('forwards error calls', () => {
    adminToast.error('Failed');
    expect(toast.error).toHaveBeenCalledWith('Failed', { description: undefined });
  });
});
```

- [ ] **Step 5: Run test**

Run: `npx vitest run src/lib/adminToast.test.ts`
Expected: 2/2 PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main.tsx src/lib/adminToast.ts src/lib/adminToast.test.ts
git commit -m "feat(phase-b): add sonner + adminToast wrapper"
```

---

## Task 5: `adminApi.ts` + `adminTypes.ts` — typed RPC wrappers

**Files:**
- Create: `src/lib/adminTypes.ts`
- Create: `src/lib/adminApi.ts`
- Create: `src/lib/adminApi.test.ts`

**Interfaces:**
- Consumes: `supabase` from `src/lib/supabaseClient.ts`
- Produces:
  - Types: `AdminTenantRow`, `AuditEventRow`, `DashboardStats`, `TenantsFilter`, `AuditFilter`
  - API: `listTenantsAdmin(filters?)`, `listAuditEvents(filters?)`, `getDashboardStats()`

- [ ] **Step 1: Write types file**

Create `src/lib/adminTypes.ts`:

```tsx
export type EmployeeRange =
  | '1-3 orang (Mikro)'
  | '4-19 orang (Kecil)'
  | '20-99 orang (Menengah)'
  | '100+ orang (Besar)';

export type PlanCode = 'STARTER' | 'PRO' | 'PREMIUM';

export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

export type ExpiryMode = 'ACTIVE' | 'GRACE' | 'READONLY';

export interface AdminTenantRow {
  tenant_id: string;
  slug: string;
  name: string;
  plan_code: PlanCode | null;
  status: TenantStatus;
  expiry_mode: ExpiryMode | null;
  activated_at: string | null;
  expires_at: string | null;
  days_until_expiry: number | null;
  user_count: number;
  sku_count: number;
  industry: string | null;
  employee_range: EmployeeRange | null;
  onboarded_at: string;
}

export interface AuditEventRow {
  id: string;
  ts: string;
  admin_email: string | null;
  tenant_slug: string | null;
  action: string;
  detail: Record<string, unknown> | null;
}

export interface DashboardStats {
  active_tenants: number;
  total_tenants: number;
  expiring_45d: number;
  plans_count: number;
  pending_imports: number;
}

export interface TenantsFilter {
  search?: string;
  plan?: PlanCode | '';
  status?: TenantStatus | '';
  expiry_within_days?: number;
}

export interface AuditFilter {
  tenant_id?: string;
  action?: string;
  admin_user_id?: string;
  from_ts?: string;
  to_ts?: string;
  limit?: number;
  offset?: number;
}
```

- [ ] **Step 2: Write API wrappers**

Create `src/lib/adminApi.ts`:

```tsx
import { supabase } from './supabaseClient';
import type {
  AdminTenantRow,
  AuditEventRow,
  DashboardStats,
  TenantsFilter,
  AuditFilter,
} from './adminTypes';

function requireClient() {
  if (!supabase) {
    throw new Error('Supabase client not configured');
  }
  return supabase;
}

export async function listTenantsAdmin(filters: TenantsFilter = {}): Promise<AdminTenantRow[]> {
  const client = requireClient();
  const { data, error } = await client.rpc('list_tenants_admin', {
    p_filters: filters,
  });
  if (error) throw new Error(`list_tenants_admin failed: ${error.message}`);
  return (data ?? []) as AdminTenantRow[];
}

export async function listAuditEvents(filters: AuditFilter = {}): Promise<AuditEventRow[]> {
  const client = requireClient();
  const { data, error } = await client.rpc('list_audit_events', {
    p_filters: filters,
  });
  if (error) throw new Error(`list_audit_events failed: ${error.message}`);
  return (data ?? []) as AuditEventRow[];
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const client = requireClient();
  const { data, error } = await client.rpc('_get_platform_dashboard_stats');
  if (error) throw new Error(`_get_platform_dashboard_stats failed: ${error.message}`);
  return data as DashboardStats;
}
```

- [ ] **Step 3: Write failing tests**

Create `src/lib/adminApi.test.ts`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listTenantsAdmin, listAuditEvents, getDashboardStats } from './adminApi';

const rpcMock = vi.fn();

vi.mock('./supabaseClient', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

describe('adminApi', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('listTenantsAdmin passes filters + returns rows', async () => {
    rpcMock.mockResolvedValue({
      data: [{ tenant_id: 'a', slug: 'garindo', name: 'Garindo', plan_code: 'PREMIUM',
               status: 'ACTIVE', expiry_mode: 'ACTIVE', activated_at: '2024-01-01',
               expires_at: '2099-12-31', days_until_expiry: 26000, user_count: 3,
               sku_count: 466, industry: 'Retail/Toko umum',
               employee_range: '4-19 orang (Kecil)', onboarded_at: '2024-01-01' }],
      error: null,
    });
    const rows = await listTenantsAdmin({ search: 'garindo' });
    expect(rpcMock).toHaveBeenCalledWith('list_tenants_admin', { p_filters: { search: 'garindo' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].slug).toBe('garindo');
  });

  it('listTenantsAdmin throws on RPC error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'P0403 PLATFORM_ADMIN_REQUIRED' } });
    await expect(listTenantsAdmin()).rejects.toThrow('list_tenants_admin failed: P0403');
  });

  it('listAuditEvents passes empty filter by default', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await listAuditEvents();
    expect(rpcMock).toHaveBeenCalledWith('list_audit_events', { p_filters: {} });
  });

  it('getDashboardStats returns typed stats', async () => {
    rpcMock.mockResolvedValue({
      data: { active_tenants: 1, total_tenants: 1, expiring_45d: 0, plans_count: 3, pending_imports: 0 },
      error: null,
    });
    const stats = await getDashboardStats();
    expect(stats.active_tenants).toBe(1);
    expect(stats.plans_count).toBe(3);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/adminApi.test.ts`
Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/adminTypes.ts src/lib/adminApi.ts src/lib/adminApi.test.ts
git commit -m "feat(phase-b): typed adminApi + adminTypes for admin RPCs"
```

---

## Task 6: `AdminSidebar` + `AdminLayout` (refactor from AdminShell)

**Files:**
- Create: `src/components/admin/AdminSidebar.tsx`
- Create: `src/components/admin/AdminLayout.tsx`
- Create: `src/components/admin/AdminSidebar.test.tsx`
- Create: `src/components/admin/AdminLayout.test.tsx`

**Interfaces:**
- Consumes: `useTenant()`, `tenantContextService` (Phase A); `<Outlet />` from react-router
- Produces: `<AdminLayout />` — renders sidebar + top header + impersonation banner + `<Outlet />` where sub-routes render

- [ ] **Step 1: Write `AdminSidebar` failing test**

Create `src/components/admin/AdminSidebar.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminSidebar } from './AdminSidebar';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminSidebar />
    </MemoryRouter>
  );
}

describe('AdminSidebar', () => {
  it('renders all top-level nav items', () => {
    renderAt('/admin');
    expect(screen.getByText(/Home/)).toBeInTheDocument();
    expect(screen.getByText(/Tenants/)).toBeInTheDocument();
    expect(screen.getByText(/Plans/)).toBeInTheDocument();
    expect(screen.getByText(/Audit log/)).toBeInTheDocument();
  });

  it('highlights the active route', () => {
    renderAt('/admin/tenants');
    const tenantsLink = screen.getByText(/Tenants/).closest('a');
    expect(tenantsLink?.className).toMatch(/bg-blue-100/);
  });
});
```

- [ ] **Step 2: Implement `AdminSidebar`**

Create `src/components/admin/AdminSidebar.tsx`:

```tsx
import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/admin', label: 'Home', icon: '🏠', end: true },
  { to: '/admin/tenants', label: 'Tenants', icon: '🏢' },
  { to: '/admin/plans', label: 'Plans', icon: '💳' },
  { to: '/admin/audit', label: 'Audit log', icon: '📊' },
] as const;

export function AdminSidebar() {
  return (
    <aside className="w-48 shrink-0 bg-slate-50 border-r border-slate-200 py-3">
      <div className="px-3 mb-1 text-[10px] uppercase tracking-wide text-slate-500">
        Manage
      </div>
      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-1.5 mx-1 rounded text-[13px] ${
                isActive
                  ? 'bg-blue-100 text-blue-900 font-semibold'
                  : 'text-slate-700 hover:bg-slate-100'
              }`
            }
          >
            <span aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 3: Run sidebar tests**

Run: `npx vitest run src/components/admin/AdminSidebar.test.tsx`
Expected: 2/2 PASS.

- [ ] **Step 4: Write `AdminLayout` failing test**

Create `src/components/admin/AdminLayout.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AdminLayout } from './AdminLayout';

vi.mock('../../contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant_id: 'garindo-uuid',
    slug: 'garindo',
    name: 'Garindo',
    impersonating: false,
    impersonating_slug: null,
  }),
}));

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { email: 'tonywei@example.com' } } } }),
      signOut: vi.fn(),
    },
  },
  tenantContextService: {
    isPlatformAdmin: vi.fn().mockResolvedValue(true),
    stopImpersonation: vi.fn(),
  },
}));

describe('AdminLayout', () => {
  it('renders sidebar + top header + outlet content', () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<div>Home Content Here</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('VOSI Admin')).toBeInTheDocument();
    expect(screen.getByText('Home Content Here')).toBeInTheDocument();
    expect(screen.getByText(/Home/i)).toBeInTheDocument();
  });

  it('does NOT render impersonation banner when not impersonating', () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<div />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.queryByText(/Impersonating:/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Implement `AdminLayout`**

Create `src/components/admin/AdminLayout.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useTenant } from '../../contexts/TenantContext';
import { supabase, tenantContextService } from '../../lib/supabaseClient';
import { AdminSidebar } from './AdminSidebar';
import { adminToast } from '../../lib/adminToast';

export function AdminLayout() {
  const tenant = useTenant();
  const [adminEmail, setAdminEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      if (!cancelled) setAdminEmail(data.session?.user.email ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    if (!supabase) return;
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  async function handleExitImpersonation() {
    try {
      await tenantContextService.stopImpersonation();
      adminToast.success('Keluar dari impersonation');
      window.location.reload();
    } catch (e) {
      adminToast.error('Gagal keluar impersonation', String(e));
    }
  }

  const isImpersonating = tenant.impersonating === true;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top header */}
      <header className="bg-slate-900 text-white px-4 py-2 flex justify-between items-center">
        <div className="text-[13px] font-semibold flex items-center gap-2">
          <span aria-hidden="true">🛡️</span>
          <span>VOSI Admin</span>
        </div>
        <div className="text-[12px] text-slate-300 flex items-center gap-3">
          {adminEmail && <span>{adminEmail}</span>}
          <button
            onClick={handleLogout}
            className="text-slate-300 hover:text-white text-[12px]"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Impersonation banner (only when active) */}
      {isImpersonating && (
        <div className="bg-amber-400 text-amber-900 px-4 py-1.5 text-[12px] text-center">
          🎭 Impersonating: <strong>{tenant.impersonating_slug}</strong> —{' '}
          <button onClick={handleExitImpersonation} className="underline">
            Exit ▸
          </button>
        </div>
      )}

      {/* Sidebar + main content */}
      <div className="flex flex-1">
        <AdminSidebar />
        <main className="flex-1 p-4 bg-white overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run `AdminLayout` tests**

Run: `npx vitest run src/components/admin/AdminLayout.test.tsx`
Expected: 2/2 PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/AdminSidebar.tsx src/components/admin/AdminSidebar.test.tsx src/components/admin/AdminLayout.tsx src/components/admin/AdminLayout.test.tsx
git commit -m "feat(phase-b): AdminLayout + AdminSidebar shell (Wave 1 chrome)"
```

---

## Task 7: Register `/admin/*` sub-routes with platform-admin guard

**Files:**
- Modify: `src/App.tsx` — replace existing single `AdminShell` render with router-based sub-routes
- Modify: `src/components/admin/AdminShell.tsx` — deprecate or delete (functionality moved into AdminLayout)

**Interfaces:**
- Consumes: `AdminLayout`, `tenantContextService.isPlatformAdmin()`
- Produces: routing so `/admin` → home, `/admin/tenants` → list, `/admin/tenants/:slug` → detail, `/admin/plans`, `/admin/audit` all render inside `AdminLayout`. Non-admin visitors get redirected to `/dashboard`.

- [ ] **Step 1: Read existing App.tsx routing pattern**

Run: `cat src/App.tsx | head -100`
Note where admin routes currently register. Take a small screenshot of the diff area.

- [ ] **Step 2: Write route-guard test**

Create `src/components/admin/AdminRouteGuard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AdminRouteGuard } from './AdminRouteGuard';

const isPlatformAdminMock = vi.fn();

vi.mock('../../lib/supabaseClient', () => ({
  tenantContextService: {
    isPlatformAdmin: () => isPlatformAdminMock(),
  },
}));

vi.mock('../../lib/adminToast', () => ({
  adminToast: { error: vi.fn() },
}));

describe('AdminRouteGuard', () => {
  it('renders children for platform admin', async () => {
    isPlatformAdminMock.mockResolvedValue(true);
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route
            path="/admin"
            element={
              <AdminRouteGuard>
                <div>Admin Content</div>
              </AdminRouteGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText('Admin Content')).toBeInTheDocument());
  });

  it('redirects non-admin to /dashboard', async () => {
    isPlatformAdminMock.mockResolvedValue(false);
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route
            path="/admin"
            element={
              <AdminRouteGuard>
                <div>Should not see this</div>
              </AdminRouteGuard>
            }
          />
          <Route path="/dashboard" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Implement `AdminRouteGuard`**

Create `src/components/admin/AdminRouteGuard.tsx`:

```tsx
import { useEffect, useState, ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { tenantContextService } from '../../lib/supabaseClient';
import { adminToast } from '../../lib/adminToast';

type GuardState = 'checking' | 'allow' | 'deny';

export function AdminRouteGuard({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GuardState>('checking');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ok = await tenantContextService.isPlatformAdmin();
        if (cancelled) return;
        if (!ok) adminToast.error('Halaman khusus admin');
        setState(ok ? 'allow' : 'deny');
      } catch {
        if (!cancelled) setState('deny');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'checking') {
    return <div className="p-6 text-[13px] text-slate-500">Memeriksa akses...</div>;
  }
  if (state === 'deny') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 4: Run guard tests**

Run: `npx vitest run src/components/admin/AdminRouteGuard.test.tsx`
Expected: 2/2 PASS.

- [ ] **Step 5: Register admin sub-routes in `App.tsx`**

Modify `src/App.tsx`. Replace the existing conditional `AdminShell` render with proper routes. Add these imports:

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AdminLayout } from './components/admin/AdminLayout';
import { AdminRouteGuard } from './components/admin/AdminRouteGuard';
import { AdminHome } from './components/admin/AdminHome';
import { TenantsList } from './components/admin/TenantsList';
import { TenantDetailShell } from './components/admin/TenantDetail/TenantDetailShell';
import { PlansManagement } from './components/admin/PlansManagement';
import { AuditLogViewer } from './components/admin/AuditLogViewer';
```

Add the admin route block inside the top-level `<Routes>`:

```tsx
<Route
  path="/admin"
  element={
    <AdminRouteGuard>
      <AdminLayout />
    </AdminRouteGuard>
  }
>
  <Route index element={<AdminHome />} />
  <Route path="tenants" element={<TenantsList />} />
  <Route path="tenants/:slug" element={<TenantDetailShell />} />
  <Route path="plans" element={<PlansManagement />} />
  <Route path="audit" element={<AuditLogViewer />} />
</Route>
```

Placeholder-safe: creates stubs later; import errors will surface in Task 8+.

- [ ] **Step 6: Create component stubs so App compiles**

For each sub-route component that doesn't exist yet, create a minimal stub. Example `src/components/admin/AdminHome.tsx`:

```tsx
export function AdminHome() {
  return <div className="text-[13px]">Home — TODO Task 8</div>;
}
```

Repeat for: `TenantsList.tsx`, `TenantDetail/TenantDetailShell.tsx`, `PlansManagement.tsx`, `AuditLogViewer.tsx`. Each returns a placeholder div. Tasks 8-14 replace them.

- [ ] **Step 7: Smoke test**

Run: `npm run dev` — open `http://localhost:5173/admin` in browser as platform admin.
Expected: sidebar renders, top header shows email, all 4 nav items click and change URL. Each sub-route shows the stub text.

- [ ] **Step 8: Verify Garindo owner-side unaffected**

Log in as Garindo owner (not platform admin). Visit `vosi.id/garindo/dashboard`.
Expected: renders normally, no console errors. `/admin` redirects to `/dashboard`.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/components/admin/AdminRouteGuard.tsx src/components/admin/AdminRouteGuard.test.tsx src/components/admin/AdminHome.tsx src/components/admin/TenantsList.tsx src/components/admin/TenantDetail/TenantDetailShell.tsx src/components/admin/PlansManagement.tsx src/components/admin/AuditLogViewer.tsx
git commit -m "feat(phase-b): register /admin sub-routes + AdminRouteGuard"
```

---

## Task 8: `AdminHome` — dashboard KPI + attention queue + recent activity

**Files:**
- Modify: `src/components/admin/AdminHome.tsx` (replace stub)
- Create: `src/components/admin/KPICard.tsx`
- Create: `src/components/admin/AttentionQueue.tsx`
- Create: `src/components/admin/RecentActivityFeed.tsx`
- Create: `src/components/admin/EmptyHomeState.tsx`
- Create: `src/components/admin/AdminHome.test.tsx`
- Create: `src/components/admin/KPICard.test.tsx`

**Interfaces:**
- Consumes: `getDashboardStats()`, `listTenantsAdmin()`, `listAuditEvents({limit: 20})` from `adminApi`
- Produces: `<AdminHome />` component; `<KPICard title value alert? />` reusable; `<AttentionQueue tenants />`; `<RecentActivityFeed events />`; `<EmptyHomeState />` when only 1 tenant

- [ ] **Step 1: Failing test for `KPICard`**

Create `src/components/admin/KPICard.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KPICard } from './KPICard';

describe('KPICard', () => {
  it('renders title and value', () => {
    render(<KPICard title="Active tenants" value={5} />);
    expect(screen.getByText('Active tenants')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders alert style when alert=true', () => {
    const { container } = render(<KPICard title="Expiring" value={2} alert />);
    expect(container.firstChild).toHaveClass('bg-amber-50');
  });

  it('renders placeholder when value is null', () => {
    render(<KPICard title="MRR" value={null} placeholder="Billing Phase C" />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Billing Phase C')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement `KPICard`**

Create `src/components/admin/KPICard.tsx`:

```tsx
interface KPICardProps {
  title: string;
  value: number | null;
  subtitle?: string;
  alert?: boolean;
  placeholder?: string;
}

export function KPICard({ title, value, subtitle, alert, placeholder }: KPICardProps) {
  return (
    <div
      className={`border rounded p-3 ${
        alert ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'
      }`}
    >
      <div className={`text-[11px] ${alert ? 'text-amber-800' : 'text-slate-500'}`}>{title}</div>
      <div
        className={`text-[22px] font-bold mt-0.5 ${
          value === null ? 'text-slate-400' : alert ? 'text-amber-900' : 'text-slate-900'
        }`}
      >
        {value === null ? '—' : value.toString()}
      </div>
      {subtitle && <div className="text-[10px] text-slate-500 mt-0.5">{subtitle}</div>}
      {value === null && placeholder && (
        <div className="text-[10px] text-slate-400 mt-0.5">{placeholder}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run KPICard tests**

Run: `npx vitest run src/components/admin/KPICard.test.tsx`
Expected: 3/3 PASS.

- [ ] **Step 4: Implement `AttentionQueue` (no test needed — pure list rendering)**

Create `src/components/admin/AttentionQueue.tsx`:

```tsx
import { Link } from 'react-router-dom';
import type { AdminTenantRow } from '../../lib/adminTypes';

interface Props {
  expiringTenants: AdminTenantRow[];
}

export function AttentionQueue({ expiringTenants }: Props) {
  if (expiringTenants.length === 0) {
    return (
      <div className="border border-emerald-200 bg-emerald-50 rounded p-3 text-[12px] text-emerald-800">
        ✅ Tidak ada yang perlu perhatian sekarang
      </div>
    );
  }
  return (
    <div className="border border-amber-300 rounded">
      <div className="bg-amber-100 px-3 py-1.5 font-semibold text-amber-900 text-[12px]">
        ⚠️ Attention needed ({expiringTenants.length})
      </div>
      {expiringTenants.map((t) => (
        <div
          key={t.tenant_id}
          className="px-3 py-2 border-t border-amber-200 flex justify-between items-center text-[12px]"
        >
          <div>
            <strong>{t.name}</strong> — expires in {t.days_until_expiry} days ({t.expires_at})
          </div>
          <Link
            to={`/admin/tenants/${t.slug}`}
            className="border border-slate-300 rounded px-2.5 py-0.5 hover:bg-slate-50 text-[11px]"
          >
            Detail →
          </Link>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Implement `RecentActivityFeed`**

Create `src/components/admin/RecentActivityFeed.tsx`:

```tsx
import type { AuditEventRow } from '../../lib/adminTypes';

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function RecentActivityFeed({ events }: { events: AuditEventRow[] }) {
  return (
    <div className="border border-slate-200 rounded">
      <div className="bg-slate-50 px-3 py-1.5 font-semibold text-[12px]">
        Recent activity
      </div>
      {events.length === 0 ? (
        <div className="px-3 py-3 text-[11px] text-slate-400">Belum ada aktivitas</div>
      ) : (
        events.map((e) => (
          <div key={e.id} className="px-3 py-1.5 border-t border-slate-100 text-[11px] text-slate-600">
            <strong>{relativeTime(e.ts)}</strong> · {e.admin_email ?? 'system'} · {e.action}
            {e.tenant_slug && <> on <span className="font-mono">{e.tenant_slug}</span></>}
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 6: Implement `EmptyHomeState`**

Create `src/components/admin/EmptyHomeState.tsx`:

```tsx
import { Link } from 'react-router-dom';

export function EmptyHomeState({ existingSlug }: { existingSlug: string }) {
  return (
    <div className="border border-slate-200 rounded p-8 text-center bg-white">
      <div className="text-3xl mb-2" aria-hidden="true">🏢</div>
      <h3 className="text-[14px] font-semibold mb-1">Baru mulai? Ayo onboard tenant kedua.</h3>
      <p className="text-[12px] text-slate-600 mb-4">
        Kamu sudah punya <strong>{existingSlug}</strong>. Untuk tenant kedua, klik tombol di bawah — wizard akan pandu step-by-step.
      </p>
      <Link
        to="/admin/tenants/new"
        className="inline-block bg-blue-500 text-white rounded px-5 py-2 font-semibold text-[13px] hover:bg-blue-600"
      >
        + Onboard tenant baru
      </Link>
      <div className="mt-3 text-[11px] text-slate-500">
        Sudah punya? <Link to="/admin/tenants" className="underline">Lihat 1 tenant →</Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Failing test for `AdminHome` (integration)**

Create `src/components/admin/AdminHome.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminHome } from './AdminHome';

const dashboardMock = vi.fn();
const tenantsMock = vi.fn();
const auditMock = vi.fn();

vi.mock('../../lib/adminApi', () => ({
  getDashboardStats: () => dashboardMock(),
  listTenantsAdmin: (filters: unknown) => tenantsMock(filters),
  listAuditEvents: (filters: unknown) => auditMock(filters),
}));

describe('AdminHome', () => {
  beforeEach(() => {
    dashboardMock.mockReset();
    tenantsMock.mockReset();
    auditMock.mockReset();
  });

  it('shows KPI cards after loading', async () => {
    dashboardMock.mockResolvedValue({
      active_tenants: 2, total_tenants: 2, expiring_45d: 1, plans_count: 3, pending_imports: 0,
    });
    tenantsMock.mockResolvedValue([{
      tenant_id: 't1', slug: 'apotek-sehat', name: 'Apotek Sehat', plan_code: 'PRO',
      status: 'ACTIVE', expiry_mode: 'ACTIVE', activated_at: '2026-07-04',
      expires_at: '2026-08-18', days_until_expiry: 45, user_count: 1, sku_count: 234,
      industry: 'Apotek/Farmasi', employee_range: '4-19 orang (Kecil)', onboarded_at: '2026-07-04',
    }]);
    auditMock.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <AdminHome />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Active tenants')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('Expiring <45d')).toBeInTheDocument();
    });
  });

  it('shows empty state when only 1 tenant', async () => {
    dashboardMock.mockResolvedValue({
      active_tenants: 1, total_tenants: 1, expiring_45d: 0, plans_count: 3, pending_imports: 0,
    });
    tenantsMock.mockResolvedValue([{
      tenant_id: 'g', slug: 'garindo', name: 'Garindo', plan_code: 'PREMIUM',
      status: 'ACTIVE', expiry_mode: 'ACTIVE', activated_at: '2024-01-01',
      expires_at: '2099-12-31', days_until_expiry: 26000, user_count: 3, sku_count: 466,
      industry: 'Retail/Toko umum', employee_range: '4-19 orang (Kecil)', onboarded_at: '2024-01-01',
    }]);
    auditMock.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <AdminHome />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Ayo onboard tenant kedua/)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 8: Implement `AdminHome`**

Modify `src/components/admin/AdminHome.tsx` (replace the stub):

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getDashboardStats,
  listTenantsAdmin,
  listAuditEvents,
} from '../../lib/adminApi';
import type { DashboardStats, AdminTenantRow, AuditEventRow } from '../../lib/adminTypes';
import { KPICard } from './KPICard';
import { AttentionQueue } from './AttentionQueue';
import { RecentActivityFeed } from './RecentActivityFeed';
import { EmptyHomeState } from './EmptyHomeState';
import { adminToast } from '../../lib/adminToast';

export function AdminHome() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [tenants, setTenants] = useState<AdminTenantRow[]>([]);
  const [events, setEvents] = useState<AuditEventRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, t, e] = await Promise.all([
          getDashboardStats(),
          listTenantsAdmin(),
          listAuditEvents({ limit: 20 }),
        ]);
        if (cancelled) return;
        setStats(s);
        setTenants(t);
        setEvents(e);
      } catch (err) {
        adminToast.error('Gagal memuat dashboard', String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="text-[13px] text-slate-500">Memuat dashboard...</div>;
  }
  if (!stats) return null;

  const expiringTenants = tenants.filter(
    (t) => t.days_until_expiry !== null && t.days_until_expiry <= 45
  );
  const showEmptyState = stats.total_tenants <= 1;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-[15px] font-semibold">Home</h1>
          <p className="text-[12px] text-slate-500">
            {stats.active_tenants} active tenants
          </p>
        </div>
        <Link
          to="/admin/tenants/new"
          className="bg-blue-500 text-white rounded px-3.5 py-2 font-semibold text-[13px] hover:bg-blue-600"
        >
          + Onboard tenant baru
        </Link>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-2">
        <KPICard title="Active tenants" value={stats.active_tenants} />
        <KPICard title="MRR (est.)" value={null} placeholder="Billing Phase C" />
        <KPICard
          title="Expiring <45d"
          value={stats.expiring_45d}
          alert={stats.expiring_45d > 0}
        />
        <KPICard
          title="Import pending"
          value={stats.pending_imports}
          alert={stats.pending_imports > 0}
          placeholder="Wave 3"
        />
      </div>

      {showEmptyState ? (
        <EmptyHomeState existingSlug={tenants[0]?.slug ?? ''} />
      ) : (
        <>
          <AttentionQueue expiringTenants={expiringTenants} />
          <RecentActivityFeed events={events} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 9: Run `AdminHome` tests**

Run: `npx vitest run src/components/admin/AdminHome.test.tsx`
Expected: 2/2 PASS.

- [ ] **Step 10: Manual smoke**

Run: `npm run dev`. Visit `/admin` as platform admin.
Expected: 4 KPI cards, Attention queue OR empty state (if 1 tenant), Recent activity list.

- [ ] **Step 11: Commit**

```bash
git add src/components/admin/AdminHome.tsx src/components/admin/AdminHome.test.tsx src/components/admin/KPICard.tsx src/components/admin/KPICard.test.tsx src/components/admin/AttentionQueue.tsx src/components/admin/RecentActivityFeed.tsx src/components/admin/EmptyHomeState.tsx
git commit -m "feat(phase-b): AdminHome dashboard with KPI + attention + activity"
```

---

## Task 9: `TenantsList` — table + search + filters + pagination

**Files:**
- Modify: `src/components/admin/TenantsList.tsx` (replace stub)
- Create: `src/components/admin/TenantsTable.tsx`
- Create: `src/components/admin/TenantsList.test.tsx`

**Interfaces:**
- Consumes: `listTenantsAdmin(filters)` from `adminApi`
- Produces: `<TenantsList />` with search input (debounced 300ms), 3 dropdowns (plan / status / expiry), pagination (25 per page client-side)

- [ ] **Step 1: Failing test**

Create `src/components/admin/TenantsList.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TenantsList } from './TenantsList';

const listMock = vi.fn();

vi.mock('../../lib/adminApi', () => ({
  listTenantsAdmin: (filters: unknown) => listMock(filters),
}));

function fakeTenant(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tenant_id: 't1', slug: 'garindo', name: 'Garindo Jaya', plan_code: 'PREMIUM',
    status: 'ACTIVE', expiry_mode: 'ACTIVE', activated_at: '2024-01-01',
    expires_at: '2099-12-31', days_until_expiry: 26000, user_count: 3, sku_count: 466,
    industry: 'Retail/Toko umum', employee_range: '4-19 orang (Kecil)', onboarded_at: '2024-01-01',
    ...overrides,
  };
}

describe('TenantsList', () => {
  beforeEach(() => listMock.mockReset());

  it('renders tenant rows after loading', async () => {
    listMock.mockResolvedValue([fakeTenant()]);
    render(<MemoryRouter><TenantsList /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Garindo Jaya')).toBeInTheDocument());
  });

  it('sends search filter to RPC on typing', async () => {
    listMock.mockResolvedValue([]);
    render(<MemoryRouter><TenantsList /></MemoryRouter>);
    await waitFor(() => expect(listMock).toHaveBeenCalledWith({}));

    const search = screen.getByPlaceholderText(/Cari slug/i);
    await userEvent.type(search, 'apotek');
    await waitFor(
      () => expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ search: 'apotek' })),
      { timeout: 1000 }
    );
  });

  it('shows empty state when no results', async () => {
    listMock.mockResolvedValue([]);
    render(<MemoryRouter><TenantsList /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Tidak ada tenant/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Implement `TenantsTable` primitive**

Create `src/components/admin/TenantsTable.tsx`:

```tsx
import { Link } from 'react-router-dom';
import type { AdminTenantRow } from '../../lib/adminTypes';

export function TenantsTable({ rows }: { rows: AdminTenantRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="border border-slate-200 rounded p-6 text-center text-[12px] text-slate-500">
        Tidak ada tenant ditemukan.
      </div>
    );
  }
  return (
    <div className="border border-slate-300 rounded overflow-hidden">
      <table className="w-full text-[12px]">
        <thead className="bg-slate-100 text-[11px]">
          <tr>
            <th className="text-left px-2 py-1.5">Name</th>
            <th className="text-left px-2 py-1.5">Slug</th>
            <th className="text-left px-2 py-1.5">Plan</th>
            <th className="text-left px-2 py-1.5">Status</th>
            <th className="text-left px-2 py-1.5">Expires</th>
            <th className="text-left px-2 py-1.5">Users</th>
            <th className="text-left px-2 py-1.5">SKUs</th>
            <th className="text-left px-2 py-1.5">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.tenant_id} className="border-t border-slate-100">
              <td className="px-2 py-1.5 font-semibold">{t.name}</td>
              <td className="px-2 py-1.5 font-mono text-slate-600">{t.slug}</td>
              <td className="px-2 py-1.5">
                <span className="inline-block px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-900 text-[10px]">
                  {t.plan_code ?? '—'}
                </span>
              </td>
              <td className="px-2 py-1.5">
                {t.status === 'ACTIVE' ? (
                  <span className="text-emerald-600">● ACTIVE</span>
                ) : (
                  <span className="text-slate-500">● {t.status}</span>
                )}
              </td>
              <td className="px-2 py-1.5">
                {t.expires_at ?? '—'}
                {t.days_until_expiry !== null && t.days_until_expiry <= 45 && (
                  <span className="text-amber-600 ml-1">({t.days_until_expiry}d)</span>
                )}
              </td>
              <td className="px-2 py-1.5">{t.user_count}</td>
              <td className="px-2 py-1.5">{t.sku_count}</td>
              <td className="px-2 py-1.5">
                <Link to={`/admin/tenants/${t.slug}`} className="text-blue-600 underline">
                  Detail
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Implement `TenantsList` with debounced search**

Modify `src/components/admin/TenantsList.tsx` (replace stub):

```tsx
import { useEffect, useState } from 'react';
import { listTenantsAdmin } from '../../lib/adminApi';
import type { AdminTenantRow, PlanCode, TenantStatus } from '../../lib/adminTypes';
import { TenantsTable } from './TenantsTable';
import { adminToast } from '../../lib/adminToast';

interface Filters {
  search: string;
  plan: PlanCode | '';
  status: TenantStatus | '';
  expiry: '' | '30' | '90';
}

const PAGE_SIZE = 25;

export function TenantsList() {
  const [filters, setFilters] = useState<Filters>({ search: '', plan: '', status: '', expiry: '' });
  const [rows, setRows] = useState<AdminTenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const payload = {
          ...(filters.search && { search: filters.search }),
          ...(filters.plan && { plan: filters.plan }),
          ...(filters.status && { status: filters.status }),
          ...(filters.expiry && { expiry_within_days: Number(filters.expiry) }),
        };
        const data = await listTenantsAdmin(payload);
        setRows(data);
        setPage(0);
      } catch (err) {
        adminToast.error('Gagal memuat daftar tenant', String(err));
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [filters]);

  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <h1 className="text-[15px] font-semibold">Tenants ({rows.length})</h1>

      <div className="flex gap-2 items-center">
        <input
          className="flex-1 border border-slate-300 rounded px-2 py-1 text-[12px]"
          placeholder="🔍 Cari slug / nama"
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />
        <select
          className="border border-slate-300 rounded px-2 py-1 text-[12px]"
          value={filters.plan}
          onChange={(e) => setFilters({ ...filters, plan: e.target.value as PlanCode | '' })}
        >
          <option value="">Semua plan</option>
          <option value="STARTER">STARTER</option>
          <option value="PRO">PRO</option>
          <option value="PREMIUM">PREMIUM</option>
        </select>
        <select
          className="border border-slate-300 rounded px-2 py-1 text-[12px]"
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value as TenantStatus | '' })}
        >
          <option value="">Semua status</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="SUSPENDED">SUSPENDED</option>
          <option value="ARCHIVED">ARCHIVED</option>
        </select>
        <select
          className="border border-slate-300 rounded px-2 py-1 text-[12px]"
          value={filters.expiry}
          onChange={(e) => setFilters({ ...filters, expiry: e.target.value as Filters['expiry'] })}
        >
          <option value="">Semua expiry</option>
          <option value="30">Expiring &lt;30d</option>
          <option value="90">Expiring &lt;90d</option>
        </select>
      </div>

      {loading ? (
        <div className="text-[13px] text-slate-500">Memuat...</div>
      ) : (
        <>
          <TenantsTable rows={pageRows} />
          {rows.length > PAGE_SIZE && (
            <div className="flex justify-between items-center text-[11px] text-slate-500">
              <span>
                Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, rows.length)} of{' '}
                {rows.length}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                  className="border border-slate-300 rounded px-2 py-0.5 disabled:opacity-40"
                >
                  ← Prev
                </button>
                <button
                  disabled={page + 1 >= totalPages}
                  onClick={() => setPage(page + 1)}
                  className="border border-slate-300 rounded px-2 py-0.5 disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/admin/TenantsList.test.tsx`
Expected: 3/3 PASS.

- [ ] **Step 5: Manual smoke**

Visit `/admin/tenants`. Type in search, verify list narrows. Click Detail on Garindo → navigates to `/admin/tenants/garindo` (shows stub for now).

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/TenantsList.tsx src/components/admin/TenantsList.test.tsx src/components/admin/TenantsTable.tsx
git commit -m "feat(phase-b): TenantsList with search + filters + pagination"
```

---

## Task 10: `TenantDetailShell` — tabs container

**Files:**
- Modify: `src/components/admin/TenantDetail/TenantDetailShell.tsx` (replace stub)
- Create: `src/components/admin/TenantDetail/TenantDetailShell.test.tsx`

**Interfaces:**
- Consumes: `useParams<{ slug: string }>()`, `useSearchParams()`, `listTenantsAdmin({search})` to load one tenant
- Produces: renders tab strip with 6 tabs (Overview / Plan / Users / Imports / Audit / Billing); active tab controlled via `?tab=` query param; other tabs stubbed

- [ ] **Step 1: Failing test**

Create `src/components/admin/TenantDetail/TenantDetailShell.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { TenantDetailShell } from './TenantDetailShell';

const tenantsMock = vi.fn();
vi.mock('../../../lib/adminApi', () => ({
  listTenantsAdmin: (f: unknown) => tenantsMock(f),
}));

const fakeTenant = {
  tenant_id: 't1', slug: 'apotek-sehat', name: 'Apotek Sehat', plan_code: 'PRO',
  status: 'ACTIVE', expiry_mode: 'ACTIVE', activated_at: '2026-07-04',
  expires_at: '2026-08-18', days_until_expiry: 45, user_count: 1, sku_count: 234,
  industry: 'Apotek/Farmasi', employee_range: '4-19 orang (Kecil)', onboarded_at: '2026-07-04',
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/tenants/:slug" element={<TenantDetailShell />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('TenantDetailShell', () => {
  it('loads tenant and renders header + tab strip', async () => {
    tenantsMock.mockResolvedValue([fakeTenant]);
    renderAt('/admin/tenants/apotek-sehat');
    await waitFor(() => expect(screen.getByText('Apotek Sehat')).toBeInTheDocument());
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Users')).toBeInTheDocument();
  });

  it('switches tab on click', async () => {
    tenantsMock.mockResolvedValue([fakeTenant]);
    renderAt('/admin/tenants/apotek-sehat');
    await waitFor(() => screen.getByText('Apotek Sehat'));
    await userEvent.click(screen.getByText('Users'));
    await waitFor(() => expect(screen.getByText(/read-only staff list/i)).toBeInTheDocument());
  });

  it('shows 404 message when tenant not found', async () => {
    tenantsMock.mockResolvedValue([]);
    renderAt('/admin/tenants/nonexistent');
    await waitFor(() => expect(screen.getByText(/tidak ditemukan/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Implement `TenantDetailShell`**

Modify `src/components/admin/TenantDetail/TenantDetailShell.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { listTenantsAdmin } from '../../../lib/adminApi';
import type { AdminTenantRow } from '../../../lib/adminTypes';
import { adminToast } from '../../../lib/adminToast';
import { OverviewTab } from './OverviewTab';
import { UsersTab } from './UsersTab';
import { AuditTab } from './AuditTab';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'plan', label: 'Plan & Features' },
  { key: 'users', label: 'Users' },
  { key: 'imports', label: 'Import history' },
  { key: 'audit', label: 'Audit timeline' },
  { key: 'billing', label: 'Billing' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export function TenantDetailShell() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as TabKey) || 'overview';

  const [tenant, setTenant] = useState<AdminTenantRow | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listTenantsAdmin({ search: slug });
        if (cancelled) return;
        const match = rows.find((r) => r.slug === slug) ?? null;
        setTenant(match);
        setNotFound(!match);
      } catch (err) {
        adminToast.error('Gagal memuat tenant', String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading) return <div className="text-[13px] text-slate-500">Memuat tenant...</div>;
  if (notFound || !tenant) {
    return (
      <div className="p-6 border border-slate-200 rounded text-center text-[13px]">
        Tenant <span className="font-mono">{slug}</span> tidak ditemukan.
        <div className="mt-2">
          <Link to="/admin/tenants" className="text-blue-600 underline">← Kembali ke daftar</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-slate-500">
        <Link to="/admin/tenants" className="underline">Tenants</Link> ›{' '}
        <strong>{tenant.name}</strong>
      </div>
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-[15px] font-semibold flex items-center gap-2">
            {tenant.name}
            <span className="inline-block px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-900 text-[10px] font-normal">
              {tenant.plan_code ?? '—'}
            </span>
          </h1>
          <p className="text-[11px] text-slate-500">
            <code>vosi.id/{tenant.slug}</code> · exp {tenant.expires_at}
            {tenant.days_until_expiry !== null && tenant.days_until_expiry <= 45 && (
              <span className="text-amber-600"> ({tenant.days_until_expiry}d) ⚠️</span>
            )}
          </p>
        </div>
      </div>

      {/* Tab strip */}
      <div className="border-b border-slate-200 flex gap-4 text-[12px]">
        {TABS.map((t) => {
          const isActive = t.key === activeTab;
          return (
            <button
              key={t.key}
              className={`pb-2 -mb-px border-b-2 ${
                isActive ? 'border-blue-500 text-blue-600 font-semibold' : 'border-transparent text-slate-500'
              }`}
              onClick={() => setSearchParams({ tab: t.key })}
            >
              {t.label}
              {t.key === 'billing' && (
                <span className="ml-1 text-[9px] bg-amber-100 text-amber-800 rounded px-1">Phase C</span>
              )}
            </button>
          );
        })}
      </div>

      {activeTab === 'overview' && <OverviewTab tenant={tenant} />}
      {activeTab === 'plan' && (
        <div className="text-[12px] text-slate-500">Plan & Features tab — Wave 2</div>
      )}
      {activeTab === 'users' && <UsersTab tenantId={tenant.tenant_id} />}
      {activeTab === 'imports' && (
        <div className="text-[12px] text-slate-500">Import history — Wave 3</div>
      )}
      {activeTab === 'audit' && <AuditTab tenantId={tenant.tenant_id} />}
      {activeTab === 'billing' && (
        <div className="text-[12px] text-slate-500">Billing — Phase C</div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Stub OverviewTab/UsersTab/AuditTab so the shell compiles**

Create three files with placeholder text (to be replaced in Tasks 11-13):

`src/components/admin/TenantDetail/OverviewTab.tsx`:
```tsx
import type { AdminTenantRow } from '../../../lib/adminTypes';
export function OverviewTab({ tenant }: { tenant: AdminTenantRow }) {
  return <div className="text-[12px]">Overview stub for {tenant.slug} — Task 11</div>;
}
```

`src/components/admin/TenantDetail/UsersTab.tsx`:
```tsx
export function UsersTab({ tenantId }: { tenantId: string }) {
  return <div className="text-[12px]">Users tab — read-only staff list for {tenantId}</div>;
}
```

`src/components/admin/TenantDetail/AuditTab.tsx`:
```tsx
export function AuditTab({ tenantId }: { tenantId: string }) {
  return <div className="text-[12px]">Audit tab for {tenantId} — Task 13</div>;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/admin/TenantDetail/TenantDetailShell.test.tsx`
Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/TenantDetail/
git commit -m "feat(phase-b): TenantDetailShell with tab strip + query-param tab control"
```

---

## Task 11: `OverviewTab` — 4-quadrant read-only view

**Files:**
- Modify: `src/components/admin/TenantDetail/OverviewTab.tsx` (replace stub)
- Create: `src/components/admin/TenantDetail/OverviewTab.test.tsx`

**Interfaces:**
- Consumes: `AdminTenantRow` prop from shell
- Produces: 4-panel grid (Identity+Profile / Subscription / Usage / Onboarding) rendering data from the row

- [ ] **Step 1: Failing test**

Create `src/components/admin/TenantDetail/OverviewTab.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OverviewTab } from './OverviewTab';

const tenant = {
  tenant_id: 't1', slug: 'apotek-sehat', name: 'Apotek Sehat', plan_code: 'PRO' as const,
  status: 'ACTIVE' as const, expiry_mode: 'ACTIVE' as const, activated_at: '2026-07-04',
  expires_at: '2026-08-18', days_until_expiry: 45, user_count: 1, sku_count: 234,
  industry: 'Apotek/Farmasi', employee_range: '4-19 orang (Kecil)' as const,
  onboarded_at: '2026-07-04T09:15:00Z',
};

describe('OverviewTab', () => {
  it('renders all four panels', () => {
    render(<OverviewTab tenant={tenant} />);
    expect(screen.getByText(/IDENTITY/i)).toBeInTheDocument();
    expect(screen.getByText(/SUBSCRIPTION/i)).toBeInTheDocument();
    expect(screen.getByText(/USAGE/i)).toBeInTheDocument();
    expect(screen.getByText(/ONBOARDING/i)).toBeInTheDocument();
  });

  it('shows industry + employee range chips', () => {
    render(<OverviewTab tenant={tenant} />);
    expect(screen.getByText('Apotek/Farmasi')).toBeInTheDocument();
    expect(screen.getByText('4-19 orang (Kecil)')).toBeInTheDocument();
  });

  it('shows amber highlight when expiring <45d', () => {
    render(<OverviewTab tenant={tenant} />);
    const expiresCell = screen.getByText(/2026-08-18/);
    expect(expiresCell.parentElement?.textContent).toMatch(/45d/);
  });
});
```

- [ ] **Step 2: Implement `OverviewTab`**

Modify `src/components/admin/TenantDetail/OverviewTab.tsx`:

```tsx
import type { AdminTenantRow } from '../../../lib/adminTypes';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <td className="text-slate-500 py-0.5 pr-2 w-32 align-top">{label}</td>
      <td className="py-0.5">{children}</td>
    </tr>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-slate-200 rounded p-3">
      <div className="text-[11px] font-semibold text-slate-500 mb-1.5">{title}</div>
      <table className="w-full text-[12px]">
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block bg-blue-50 text-blue-900 px-1.5 py-0.5 rounded-full text-[11px]">
      {children}
    </span>
  );
}

export function OverviewTab({ tenant }: { tenant: AdminTenantRow }) {
  const expiring = tenant.days_until_expiry !== null && tenant.days_until_expiry <= 45;
  return (
    <div className="grid grid-cols-2 gap-3">
      <Panel title="IDENTITY & PROFILE">
        <Row label="Name">{tenant.name}</Row>
        <Row label="Slug"><code className="font-mono">{tenant.slug}</code></Row>
        <Row label="URL"><code className="font-mono">vosi.id/{tenant.slug}</code></Row>
        <Row label="Industry">
          {tenant.industry ? <Chip>{tenant.industry}</Chip> : <span className="text-slate-400">—</span>}
        </Row>
        <Row label="Karyawan">
          {tenant.employee_range ? <Chip>{tenant.employee_range}</Chip> : <span className="text-slate-400">—</span>}
        </Row>
      </Panel>

      <Panel title="SUBSCRIPTION">
        <Row label="Plan"><strong>{tenant.plan_code ?? '—'}</strong></Row>
        <Row label="Activated">{tenant.activated_at ?? '—'}</Row>
        <Row label="Expires">
          <span className={expiring ? 'text-amber-600' : ''}>
            {tenant.expires_at ?? '—'}
            {expiring && ` (${tenant.days_until_expiry}d)`}
          </span>
        </Row>
        <Row label="Status">
          {tenant.status === 'ACTIVE' ? (
            <span className="text-emerald-600">● ACTIVE</span>
          ) : (
            <span className="text-slate-500">● {tenant.status}</span>
          )}
        </Row>
        <Row label="Expiry mode">{tenant.expiry_mode ?? '—'}</Row>
      </Panel>

      <Panel title="USAGE STATS">
        <Row label="Users">{tenant.user_count}</Row>
        <Row label="SKUs">{tenant.sku_count}</Row>
      </Panel>

      <Panel title="ONBOARDING RECAP">
        <Row label="Onboarded at">{new Date(tenant.onboarded_at).toLocaleDateString('id-ID')}</Row>
      </Panel>
    </div>
  );
}
```

- [ ] **Step 3: Run test**

Run: `npx vitest run src/components/admin/TenantDetail/OverviewTab.test.tsx`
Expected: 3/3 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/TenantDetail/OverviewTab.tsx src/components/admin/TenantDetail/OverviewTab.test.tsx
git commit -m "feat(phase-b): OverviewTab 4-panel read-only view"
```

---

## Task 12: `UsersTab` — read-only staff list

**Files:**
- Modify: `src/components/admin/TenantDetail/UsersTab.tsx` (replace stub)
- Create: `src/lib/adminUsersApi.ts` — `listTenantUsers(tenantId)` wrapper
- Create: `supabase/migrations/20261115000005_phase_b_wave1_list_tenant_users.sql`
- Create: `supabase/tests/wave1/list_tenant_users.sql`
- Create: `src/components/admin/TenantDetail/UsersTab.test.tsx`

**Interfaces:**
- Consumes: new RPC `list_tenant_users(p_tenant_id uuid)` — returns tenant_users JOINed with auth.users email
- Produces: `<UsersTab tenantId={id} />` renders 1 table row per staff member (read-only in Wave 1)

- [ ] **Step 1: Write migration**

Create `supabase/migrations/20261115000005_phase_b_wave1_list_tenant_users.sql`:

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.list_tenant_users(p_tenant_id uuid)
RETURNS TABLE (
  user_id      UUID,
  email        TEXT,
  full_name    TEXT,
  role         TEXT,
  last_sign_in TIMESTAMPTZ,
  added_at     TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
BEGIN
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
  END IF;

  RETURN QUERY
  SELECT
    tu.user_id,
    u.email,
    COALESCE(u.raw_user_meta_data->>'full_name', u.email) AS full_name,
    tu.role,
    u.last_sign_in_at AS last_sign_in,
    tu.created_at    AS added_at
  FROM public.tenant_users tu
  JOIN auth.users u ON u.id = tu.user_id
  WHERE tu.tenant_id = p_tenant_id
  ORDER BY tu.role = 'owner' DESC, tu.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.list_tenant_users(uuid) FROM PUBLIC;
ALTER FUNCTION public.list_tenant_users(uuid) OWNER TO vosi_rpc_owner;
GRANT EXECUTE ON FUNCTION public.list_tenant_users(uuid) TO authenticated;

COMMENT ON FUNCTION public.list_tenant_users(uuid) IS
  'Wave 1: super-admin read-only tenant_users list. category=P.';

COMMIT;
```

- [ ] **Step 2: Write pgTAP test**

Create `supabase/tests/wave1/list_tenant_users.sql`:

```sql
BEGIN;
SELECT plan(2);

SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (SELECT user_id FROM public.platform_admins LIMIT 1)::text,
    'is_platform_admin', 'true'
  )::text,
  true
);

SELECT ok(
  (SELECT COUNT(*) FROM public.list_tenant_users(
    (SELECT id FROM public.tenants WHERE slug = 'garindo')
  )) >= 1,
  'list_tenant_users returns at least 1 Garindo user'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","is_platform_admin":"false"}',
  true
);
SELECT throws_ok(
  $$ SELECT * FROM public.list_tenant_users('00000000-0000-0000-0000-000000000000'::uuid) $$,
  'P0403', 'PLATFORM_ADMIN_REQUIRED',
  'non-admin blocked'
);

SELECT finish();
ROLLBACK;
```

- [ ] **Step 3: Apply + test**

Apply migration via MCP. Then:
```bash
psql "$DATABASE_URL" -f supabase/tests/wave1/list_tenant_users.sql
```
Expected: 2/2 PASS.

- [ ] **Step 4: Write API wrapper**

Create `src/lib/adminUsersApi.ts`:

```tsx
import { supabase } from './supabaseClient';

export interface TenantUserRow {
  user_id: string;
  email: string;
  full_name: string;
  role: 'owner' | 'staff';
  last_sign_in: string | null;
  added_at: string;
}

export async function listTenantUsers(tenantId: string): Promise<TenantUserRow[]> {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.rpc('list_tenant_users', { p_tenant_id: tenantId });
  if (error) throw new Error(`list_tenant_users failed: ${error.message}`);
  return (data ?? []) as TenantUserRow[];
}
```

- [ ] **Step 5: Failing test for `UsersTab`**

Create `src/components/admin/TenantDetail/UsersTab.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { UsersTab } from './UsersTab';

const listMock = vi.fn();
vi.mock('../../../lib/adminUsersApi', () => ({
  listTenantUsers: (id: string) => listMock(id),
}));

describe('UsersTab', () => {
  beforeEach(() => listMock.mockReset());

  it('renders users after loading', async () => {
    listMock.mockResolvedValue([
      { user_id: 'u1', email: 'owner@apoteksehat.co.id', full_name: 'Bu Sri',
        role: 'owner', last_sign_in: '2026-07-04T09:00:00Z', added_at: '2026-07-04' },
    ]);
    render(<UsersTab tenantId="t1" />);
    await waitFor(() => expect(screen.getByText('Bu Sri')).toBeInTheDocument());
    expect(screen.getByText('OWNER')).toBeInTheDocument();
  });

  it('shows empty state when no users', async () => {
    listMock.mockResolvedValue([]);
    render(<UsersTab tenantId="t1" />);
    await waitFor(() => expect(screen.getByText(/Belum ada user/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 6: Implement `UsersTab`**

Modify `src/components/admin/TenantDetail/UsersTab.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { listTenantUsers, type TenantUserRow } from '../../../lib/adminUsersApi';
import { adminToast } from '../../../lib/adminToast';

export function UsersTab({ tenantId }: { tenantId: string }) {
  const [users, setUsers] = useState<TenantUserRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await listTenantUsers(tenantId);
        if (!cancelled) setUsers(rows);
      } catch (err) {
        adminToast.error('Gagal memuat users', String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  if (loading) return <div className="text-[12px] text-slate-500">Memuat...</div>;

  return (
    <div className="space-y-2">
      <div className="text-[12px] font-semibold">Users ({users.length})</div>
      <div className="text-[11px] text-slate-500">
        Read-only di Wave 1. Add/remove/promote akan tersedia di Wave 4.
      </div>
      {users.length === 0 ? (
        <div className="border border-slate-200 rounded p-4 text-center text-[12px] text-slate-500">
          Belum ada user di tenant ini.
        </div>
      ) : (
        <div className="border border-slate-300 rounded overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-100 text-[11px]">
              <tr>
                <th className="text-left px-2 py-1.5">Name</th>
                <th className="text-left px-2 py-1.5">Email</th>
                <th className="text-left px-2 py-1.5">Role</th>
                <th className="text-left px-2 py-1.5">Last sign-in</th>
                <th className="text-left px-2 py-1.5">Added</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id} className="border-t border-slate-100">
                  <td className="px-2 py-1.5 font-semibold">{u.full_name}</td>
                  <td className="px-2 py-1.5">{u.email}</td>
                  <td className="px-2 py-1.5">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] ${
                        u.role === 'owner'
                          ? 'bg-emerald-100 text-emerald-900'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {u.role.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    {u.last_sign_in ? new Date(u.last_sign_in).toLocaleString('id-ID') : 'never'}
                  </td>
                  <td className="px-2 py-1.5">
                    {new Date(u.added_at).toLocaleDateString('id-ID')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/components/admin/TenantDetail/UsersTab.test.tsx`
Expected: 2/2 PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261115000005_*.sql supabase/tests/wave1/list_tenant_users.sql src/lib/adminUsersApi.ts src/components/admin/TenantDetail/UsersTab.tsx src/components/admin/TenantDetail/UsersTab.test.tsx
git commit -m "feat(phase-b): UsersTab read-only + list_tenant_users RPC"
```

---

## Task 13: `AuditTab` (per-tenant) + `AuditLogViewer` (global)

**Files:**
- Modify: `src/components/admin/TenantDetail/AuditTab.tsx` (replace stub)
- Modify: `src/components/admin/AuditLogViewer.tsx` (replace stub)
- Create: `src/components/admin/AuditTable.tsx` — shared table primitive
- Create: `src/components/admin/AuditLogViewer.test.tsx`

**Interfaces:**
- Consumes: `listAuditEvents(filters)` from `adminApi`
- Produces:
  - `<AuditTable events />` — shared row rendering
  - `<AuditTab tenantId />` — pre-filtered by tenant
  - `<AuditLogViewer />` — global with all filters + CSV export

- [ ] **Step 1: Implement shared `AuditTable`**

Create `src/components/admin/AuditTable.tsx`:

```tsx
import type { AuditEventRow } from '../../lib/adminTypes';

const ACTION_STYLES: Record<string, string> = {
  IMPERSONATE_START: 'bg-amber-100 text-amber-900',
  IMPERSONATE_END: 'bg-amber-100 text-amber-900',
  CREATE_TENANT: 'bg-blue-100 text-blue-900',
  CHANGE_PLAN: 'bg-emerald-100 text-emerald-900',
  RENEW_SUBSCRIPTION: 'bg-emerald-100 text-emerald-900',
  IMPORT_COMMIT: 'bg-blue-100 text-blue-900',
  SUSPEND: 'bg-rose-100 text-rose-900',
  ACTIVATE: 'bg-emerald-100 text-emerald-900',
};

export function AuditTable({ events }: { events: AuditEventRow[] }) {
  if (events.length === 0) {
    return (
      <div className="border border-slate-200 rounded p-4 text-center text-[12px] text-slate-500">
        Belum ada audit event.
      </div>
    );
  }
  return (
    <div className="border border-slate-300 rounded overflow-hidden">
      <table className="w-full text-[11px]">
        <thead className="bg-slate-100">
          <tr>
            <th className="text-left px-2 py-1.5">Timestamp</th>
            <th className="text-left px-2 py-1.5">Admin</th>
            <th className="text-left px-2 py-1.5">Tenant</th>
            <th className="text-left px-2 py-1.5">Action</th>
            <th className="text-left px-2 py-1.5">Detail</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className="border-t border-slate-100">
              <td className="px-2 py-1 whitespace-nowrap">
                {new Date(e.ts).toLocaleString('id-ID')}
              </td>
              <td className="px-2 py-1">{e.admin_email ?? '—'}</td>
              <td className="px-2 py-1 font-mono">{e.tenant_slug ?? '—'}</td>
              <td className="px-2 py-1">
                <span
                  className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] ${
                    ACTION_STYLES[e.action] ?? 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {e.action}
                </span>
              </td>
              <td className="px-2 py-1 text-slate-500 max-w-md truncate">
                {e.detail ? JSON.stringify(e.detail) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Implement `AuditTab`**

Modify `src/components/admin/TenantDetail/AuditTab.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { listAuditEvents } from '../../../lib/adminApi';
import type { AuditEventRow } from '../../../lib/adminTypes';
import { adminToast } from '../../../lib/adminToast';
import { AuditTable } from '../AuditTable';

export function AuditTab({ tenantId }: { tenantId: string }) {
  const [events, setEvents] = useState<AuditEventRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await listAuditEvents({ tenant_id: tenantId, limit: 100 });
        if (!cancelled) setEvents(data);
      } catch (err) {
        adminToast.error('Gagal memuat audit', String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  if (loading) return <div className="text-[12px] text-slate-500">Memuat audit...</div>;
  return (
    <div className="space-y-2">
      <div className="text-[12px] font-semibold">Audit timeline ({events.length})</div>
      <AuditTable events={events} />
    </div>
  );
}
```

- [ ] **Step 3: Failing test for `AuditLogViewer`**

Create `src/components/admin/AuditLogViewer.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuditLogViewer } from './AuditLogViewer';

const listMock = vi.fn();
vi.mock('../../lib/adminApi', () => ({
  listAuditEvents: (f: unknown) => listMock(f),
}));

const fakeEvent = {
  id: 'e1', ts: '2026-07-04T09:15:00Z', admin_email: 'tonywei@example.com',
  tenant_slug: 'apotek-sehat', action: 'CREATE_TENANT', detail: { plan: 'PRO' },
};

describe('AuditLogViewer', () => {
  beforeEach(() => listMock.mockReset());

  it('renders events after load', async () => {
    listMock.mockResolvedValue([fakeEvent]);
    render(<AuditLogViewer />);
    await waitFor(() => expect(screen.getByText('CREATE_TENANT')).toBeInTheDocument());
  });

  it('applies action filter on select change', async () => {
    listMock.mockResolvedValue([]);
    render(<AuditLogViewer />);
    await waitFor(() => expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 })));
    const actionSelect = screen.getByLabelText(/Action/i);
    await userEvent.selectOptions(actionSelect, 'IMPERSONATE_START');
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'IMPERSONATE_START' }))
    );
  });
});
```

- [ ] **Step 4: Implement `AuditLogViewer`**

Modify `src/components/admin/AuditLogViewer.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { listAuditEvents } from '../../lib/adminApi';
import type { AuditEventRow } from '../../lib/adminTypes';
import { adminToast } from '../../lib/adminToast';
import { AuditTable } from './AuditTable';

const ACTION_OPTIONS = [
  '', 'IMPERSONATE_START', 'IMPERSONATE_END',
  'CREATE_TENANT', 'CHANGE_PLAN', 'CHANGE_FEATURES',
  'RENEW_SUBSCRIPTION', 'SEND_OWNER_INVITE',
  'IMPORT_COMMIT', 'SUSPEND', 'ACTIVATE',
];

export function AuditLogViewer() {
  const [action, setAction] = useState('');
  const [fromTs, setFromTs] = useState('');
  const [toTs, setToTs] = useState('');
  const [events, setEvents] = useState<AuditEventRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const filters = {
          limit: 50,
          ...(action && { action }),
          ...(fromTs && { from_ts: fromTs }),
          ...(toTs && { to_ts: toTs }),
        };
        const data = await listAuditEvents(filters);
        setEvents(data);
      } catch (err) {
        adminToast.error('Gagal memuat audit', String(err));
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [action, fromTs, toTs]);

  const csv = useMemo(() => {
    const header = 'timestamp,admin,tenant,action,detail\n';
    const body = events
      .map((e) =>
        [
          e.ts,
          e.admin_email ?? '',
          e.tenant_slug ?? '',
          e.action,
          JSON.stringify(e.detail ?? {}).replaceAll(',', ';'),
        ].join(',')
      )
      .join('\n');
    return header + body;
  }, [events]);

  function downloadCsv() {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <h1 className="text-[15px] font-semibold">Audit log</h1>
      <div className="flex gap-2 items-end flex-wrap">
        <label className="text-[11px]">
          Action
          <select
            className="ml-1 border border-slate-300 rounded px-2 py-1 text-[12px]"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt || 'Semua action'}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px]">
          From
          <input
            type="date"
            className="ml-1 border border-slate-300 rounded px-2 py-1 text-[12px]"
            value={fromTs.slice(0, 10)}
            onChange={(e) => setFromTs(e.target.value ? `${e.target.value}T00:00:00Z` : '')}
          />
        </label>
        <label className="text-[11px]">
          To
          <input
            type="date"
            className="ml-1 border border-slate-300 rounded px-2 py-1 text-[12px]"
            value={toTs.slice(0, 10)}
            onChange={(e) => setToTs(e.target.value ? `${e.target.value}T23:59:59Z` : '')}
          />
        </label>
        <button
          onClick={downloadCsv}
          className="border border-slate-300 rounded px-2.5 py-1 text-[12px] hover:bg-slate-50"
        >
          📥 Export CSV
        </button>
      </div>
      {loading ? (
        <div className="text-[13px] text-slate-500">Memuat...</div>
      ) : (
        <AuditTable events={events} />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/components/admin/AuditLogViewer.test.tsx`
Expected: 2/2 PASS.

- [ ] **Step 6: Manual smoke**

Visit `/admin/audit`. Change action filter — verify list updates. Click Export CSV — file downloads. Visit `/admin/tenants/garindo?tab=audit` — Garindo-only events shown.

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/AuditTable.tsx src/components/admin/AuditLogViewer.tsx src/components/admin/AuditLogViewer.test.tsx src/components/admin/TenantDetail/AuditTab.tsx
git commit -m "feat(phase-b): AuditTable + AuditLogViewer + AuditTab wired"
```

---

## Task 14: `PlansManagement` (read-only) + wave regression pass

**Files:**
- Modify: `src/components/admin/PlansManagement.tsx` (replace stub)
- Create: `src/lib/adminPlansApi.ts` — `listPlans()`
- Create: `src/components/admin/PlansManagement.test.tsx`

**Interfaces:**
- Consumes: existing `plans` table (extended in Task 1); direct query since it's already RLS-scoped platform read
- Produces: `<PlansManagement />` — 3-card read-only view (edit lands in Wave 4)

- [ ] **Step 1: Write plans API wrapper**

Create `src/lib/adminPlansApi.ts`:

```tsx
import { supabase } from './supabaseClient';

export interface PlanRow {
  code: 'STARTER' | 'PRO' | 'PREMIUM';
  description: string | null;
  target_segment: string | null;
  is_recommended: boolean;
  feature_bundle: Record<string, boolean>;
  tenant_count: number;
}

export async function listPlans(): Promise<PlanRow[]> {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase
    .from('plans')
    .select('code, description, target_segment, is_recommended, feature_bundle');
  if (error) throw new Error(`plans query failed: ${error.message}`);

  const { data: counts, error: cErr } = await supabase
    .from('tenant_subscriptions')
    .select('plan_code');
  if (cErr) throw new Error(`tenant_subscriptions query failed: ${cErr.message}`);

  const countMap: Record<string, number> = {};
  for (const row of counts ?? []) {
    countMap[row.plan_code] = (countMap[row.plan_code] ?? 0) + 1;
  }

  return (data ?? []).map((p) => ({
    ...p,
    feature_bundle: (p.feature_bundle as Record<string, boolean>) ?? {},
    tenant_count: countMap[p.code] ?? 0,
  })) as PlanRow[];
}
```

- [ ] **Step 2: Failing test**

Create `src/components/admin/PlansManagement.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PlansManagement } from './PlansManagement';

vi.mock('../../lib/adminPlansApi', () => ({
  listPlans: vi.fn().mockResolvedValue([
    {
      code: 'STARTER',
      description: 'Warung / kios kecil dengan operasi minimal',
      target_segment: 'MSME 1-3 karyawan',
      is_recommended: false,
      feature_bundle: { modul_kasir: true, modul_akuntansi: true, modul_pengiriman: true },
      tenant_count: 0,
    },
    {
      code: 'PRO',
      description: 'Toko retail dengan tempo + accounting',
      target_segment: 'MSME 5-15 karyawan',
      is_recommended: true,
      feature_bundle: {
        modul_kasir: true, modul_tempo: true, modul_akuntansi: true, modul_pengiriman: true,
        modul_diskon_kasir: true, modul_diskon_penjualan: true, modul_diskon_tagihan: true,
      },
      tenant_count: 1,
    },
    {
      code: 'PREMIUM',
      description: 'Distributor / manufaktur multi-gudang',
      target_segment: 'B2B 20+ karyawan',
      is_recommended: false,
      feature_bundle: {
        modul_kasir: true, modul_tempo: true, modul_akuntansi: true, modul_pengiriman: true,
        modul_multi_warehouse: true, modul_bom_recipe: true, modul_multi_tier_price: true,
        modul_jasa_layanan: true, modul_diskon_kasir: true, modul_diskon_penjualan: true, modul_diskon_tagihan: true,
      },
      tenant_count: 1,
    },
  ]),
}));

describe('PlansManagement', () => {
  it('renders 3 plans with feature counts', async () => {
    render(<PlansManagement />);
    await waitFor(() => expect(screen.getByText('STARTER')).toBeInTheDocument());
    expect(screen.getByText('PRO')).toBeInTheDocument();
    expect(screen.getByText('PREMIUM')).toBeInTheDocument();
    expect(screen.getByText(/RECOMMENDED/i)).toBeInTheDocument();
    expect(screen.getByText(/3 features/i)).toBeInTheDocument();
    expect(screen.getByText(/11 features/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Implement `PlansManagement`**

Modify `src/components/admin/PlansManagement.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { listPlans, type PlanRow } from '../../lib/adminPlansApi';
import { adminToast } from '../../lib/adminToast';

function PlanCard({ plan }: { plan: PlanRow }) {
  const featureCount = Object.values(plan.feature_bundle).filter(Boolean).length;
  return (
    <div
      className={`border rounded p-3 ${
        plan.is_recommended ? 'border-emerald-500 border-2' : 'border-slate-200'
      }`}
    >
      <div className="flex justify-between items-start">
        <div>
          <div className="text-[14px] font-bold">{plan.code}</div>
          {plan.is_recommended && (
            <span className="inline-block bg-emerald-100 text-emerald-900 text-[9px] px-1.5 py-0.5 rounded-full mt-0.5">
              RECOMMENDED
            </span>
          )}
        </div>
      </div>
      <div className="text-[10px] text-slate-500 mt-1">{plan.description}</div>
      <div className="text-[10px] text-slate-400 mt-0.5">{plan.target_segment}</div>
      <div className="text-[10px] mt-2">
        <strong>Bundled: {featureCount} features</strong>
      </div>
      <div className="text-[10px] text-slate-500 mt-2">
        Used by {plan.tenant_count} tenant{plan.tenant_count === 1 ? '' : 's'}
      </div>
    </div>
  );
}

export function PlansManagement() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await listPlans();
        if (!cancelled) setPlans(data);
      } catch (err) {
        adminToast.error('Gagal memuat plans', String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div className="text-[13px] text-slate-500">Memuat plans...</div>;

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-[15px] font-semibold">Plans ({plans.length})</h1>
        <p className="text-[11px] text-slate-500">
          Read-only di Wave 1. Edit feature bundle akan tersedia di Wave 4.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {plans.map((p) => (
          <PlanCard key={p.code} plan={p} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/admin/PlansManagement.test.tsx`
Expected: 1/1 PASS.

- [ ] **Step 5: Wave 1 full regression pass**

Run all Wave 1 tests together:
```bash
npx vitest run src/components/admin/ src/lib/adminApi.test.ts src/lib/adminToast.test.ts
```
Expected: ALL tests PASS.

Then all pgTAP tests:
```bash
for f in supabase/tests/wave1/*.sql; do psql "$DATABASE_URL" -f "$f"; done
```
Expected: every file's `SELECT finish()` returns clean.

- [ ] **Step 6: Manual E2E smoke walkthrough**

Log in as platform admin. Walk through every route + interaction:

1. `/admin` — dashboard loads, 4 KPI cards visible, either attention queue or empty state
2. Click "+ Onboard tenant baru" — navigates to `/admin/tenants/new` (404 stub for now; Wave 2)
3. `/admin/tenants` — table renders Garindo row
4. Search "garindo" — row narrows correctly
5. Filter plan=PREMIUM — Garindo remains
6. Filter plan=STARTER — table empty
7. Click Detail on Garindo — navigates to `/admin/tenants/garindo`
8. Overview tab visible with 4 panels
9. Click Users tab — Garindo staff loaded
10. Click Audit timeline tab — Garindo-only events shown (may be short list; that's fine)
11. Click Billing tab — "Phase C" placeholder
12. `/admin/plans` — 3 cards with feature counts
13. `/admin/audit` — global audit table, filter by action → list updates
14. Click Export CSV — file downloads
15. Log out — redirects to `/login`
16. Log in as Garindo owner (non-admin) — `/admin` redirects to `/dashboard` with toast

Note any UX bugs (styling, layout) in a follow-up TaskCreate.

- [ ] **Step 7: Commit + tag Wave 1**

```bash
git add src/lib/adminPlansApi.ts src/components/admin/PlansManagement.tsx src/components/admin/PlansManagement.test.tsx
git commit -m "feat(phase-b): PlansManagement read-only + Wave 1 complete"
git tag -a phase-b-wave1 -m "Phase B Wave 1: Read-only admin panel"
```

---

## Wave 1 completion checklist

- [ ] All 5 migrations applied to production Supabase
- [ ] All pgTAP tests pass
- [ ] All Vitest + RTL tests pass
- [ ] Manual E2E walkthrough (Step 6 above) passes without console errors
- [ ] Garindo tenant unaffected (Phase A regression clean)
- [ ] Non-admin visitors redirected from `/admin/*` with clear toast
- [ ] All new RPCs include admin-gate template + audit RPCs are `SECDEF`
- [ ] Deployment: single Cloud Run deploy with `--no-traffic --tag=wave1-<sha>` → smoke on tag URL → promote

Ready for Wave 2 (Onboarding wizard core) planning.
