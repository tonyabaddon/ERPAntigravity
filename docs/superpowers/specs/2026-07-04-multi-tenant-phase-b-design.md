# Multi-Tenant Phase B — Design Spec

**Date:** 2026-07-04
**Status:** Draft
**Author:** Founder + Claude
**Depends on:** [Phase A](2026-07-03-multi-tenant-phase-a-design.md) — live in production as of `1526f1f` + `41b98b2` (retro-fix) + Auth Hook enabled via Management API.
**Scope:** Super-admin panel UI + Onboarding wizard + Feature entitlement enforcement + Data import + Renewal UX + Audit log viewer. Everything super-admin (founder) touches to onboard and manage tenants.

---

## 0. Context

Phase A shipped the invisible foundation: tenants can exist safely in one DB, Auth Hook bakes tenant identity into JWT, RLS enforces isolation, super-admin can impersonate. Tenant #2 is currently onboardable only via SQL insert.

Phase B makes this founder-usable:
- **A working `/admin` UI** — currently just AdminShell skeleton with impersonation control.
- **Onboarding wizard** — clicks not SQL, atomic commit including optional Excel import.
- **Feature entitlement** — plans + overrides actually gate what modules the tenant sees.
- **Renewal/expiry management** — extend subscriptions, warn before expiry, act on ReadonlyBanner.
- **Data import** — 8 Excel templates: 4 master (products/customers/suppliers/COA+kasbank) + 4 historical transactional (sales invoices / purchase invoices / journal entries / stock movements). Context = tenant migrating from another system (paper, spreadsheet, or another ERP).
- **Audit log viewer** — see impersonation events + plan changes + suspensions.

**Phase C deferrals** (not in this spec):
- Custom domain per tenant.
- Billing / Stripe / Xendit / automated invoicing.
- Self-serve signup with anti-abuse.
- Multi-region.

**Locked brainstorming decisions:**
- Super-admin does everything; tenant owner just logs in.
- First-login via Supabase Auth OTP magic link (super-admin clicks "Kirim OTP invite").
- Admin panel = sidebar nav (Home / Tenants / Plans / Import Queue / Audit) + drill-down detail with sub-tabs.
- Onboarding = 6-step wizard: Identity → Plan & Features → Owner Invite → Company Info (opt) → Data Import (opt) → Review.
- Data import = 8 parallel cards (4 master + 4 transactional; 2 waves 3a/3b) with row-level error handling, dependency ordering, and "GL as-is" strategy (no double-book).
- Feature entitlement = plan-driven bundle + JSONB per-tenant overrides + `useFeature()` FE hook + RPC-level write gate.

---

## 1. Architecture

Phase B is almost entirely additive to Phase A. No new tables, no schema breaking changes.

### 1.1 What Phase A already provided

- `tenants`, `platform_admins`, `tenant_users`, `plans`, `tenant_subscriptions`, `tenant_activity_daily`, `platform_admin_audit`, `platform_admin_active_impersonation`.
- `v_tenant_effective_features` view — resolves plan bundle ⊕ overrides.
- `sync_tenant_settings_from_subscription()` trigger — pushes computed features into `tenant_settings` on subscription mutations.
- Auth Hook injects `tenant_id`, `is_platform_admin`, `impersonating*` into JWT.
- Impersonation via `impersonate_tenant()`/`stop_impersonation()` RPCs + client `supabase.auth.refreshSession()`.
- Frontend `AdminShell` skeleton with impersonation input.
- Frontend `TenantContext` + `useTenant()` + `useFeature()` hook (already implemented in Phase A Task 19).
- `ReadonlyBanner` + `GraceBanner` for expiry UX.
- Category-P RLS on platform tables reads JWT via `_is_platform_admin_from_jwt()`.

### 1.2 What Phase B adds

**Every new RPC below is SECDEF, granted to authenticated, and MUST include the following admin-gate at the top of its body:**

```sql
IF NOT public._is_platform_admin_from_jwt() THEN
  RAISE EXCEPTION USING errcode = 'P0403',
    message = 'PLATFORM_ADMIN_REQUIRED';
END IF;
```

Reviewers should reject any RPC in this section that omits this pattern.

**New RPCs:**
- `create_tenant_atomic(payload jsonb) → jsonb` — the wizard's final commit. See §4.7 for exact payload contract.
- `check_slug_available(p_slug text) → boolean` — server-side slug uniqueness check for wizard Step 1 blur.
- `send_owner_invite(p_tenant_id uuid, p_email text) → jsonb` — triggers Supabase Auth OTP magic link. Idempotent: repeat calls invalidate previous OTP and generate a new one; records `RESEND_OWNER_INVITE` audit event on repeat.
- `renew_subscription(p_tenant_id uuid, p_new_expires_at date, p_new_plan_code text default null, p_notes text default null) → jsonb` — extend expiry, optionally change plan. Updates `tenant_subscriptions`, resets `expiry_mode` to ACTIVE if in GRACE/READONLY, cascades to `tenant_settings` via existing trigger.
- `set_feature_overrides(p_tenant_id uuid, p_overrides jsonb) → jsonb` — writes to `tenant_subscriptions.feature_overrides`.
- `suspend_tenant(p_tenant_id uuid, p_reason text) / activate_tenant(p_tenant_id uuid) → jsonb` — status transitions with audit log. Suspension does NOT force-logout owner sessions immediately; owner receives `TENANT_SUSPENDED` error on next RPC call (write-lock behavior parallels READONLY).
- `list_tenants_admin(p_filters jsonb) → setof jsonb` — returns tenant list joined with subscription + user count + storage size + expiry state for admin table.
- `list_audit_events(p_filters jsonb) → setof jsonb` — returns paginated `platform_admin_audit` rows filtered by tenant/admin/action/date.
- `promote_tenant_user_to_owner(p_tenant_id uuid, p_user_id uuid) → jsonb` — demotes current owner to staff, promotes target to owner. Used before removing an owner from Users tab.
- `update_plan(p_plan_code text, p_feature_bundle jsonb, p_description text default null, p_target_segment text default null) → jsonb` — edits `plans` row. Wave 4.
- `abandon_import(p_upload_id uuid) → jsonb` — marks `import_uploads.status = 'ABANDONED'`; used by Import Queue "Abandon" button.
- Import parsing + validation RPCs (see §6): `create_import_upload(entity_type, filename, raw_rows jsonb, draft_key text) → uuid`, `preview_import_<entity>(upload_id) → jsonb`, `commit_import_<entity>(p_tenant_id, upload_id, skip_errors bool) → jsonb`, `undo_import(upload_id) → jsonb`.

**New tables:**
- `import_uploads` — staging area for uploaded Excel content, per super-admin session, so preview/validate/commit can span multiple requests.
- `plans_reference` — display metadata for plans (description, price_reference display, target segment). Optional; can be flat text in the `plans` table itself. Decision: extend existing `plans` table with a `description` column instead of new table.

**Frontend components:**
- `AdminHome.tsx` — home dashboard with KPI cards + attention queue + recent activity.
- `TenantsList.tsx` — table with filters + search + pagination + bulk actions.
- `TenantDetail.tsx` — sub-tabs: Overview / Plan & Features / Users / Import History / Audit / Billing (Phase C stub).
- `OnboardingWizard.tsx` — 6-step wizard with draft save, per-step validation.
- `ImportCard.tsx` — one card per entity (Products, Customers+Piutang, Suppliers+Utang, COA+Kas/Bank).
- `ImportPreviewTable.tsx` — preview rows with row-level error highlights.
- `PlansManagement.tsx` — plans editor (edit feature_bundle per plan).
- `AuditLogViewer.tsx` — audit_log table with filters.
- `RenewalDialog.tsx` — subscription renewal modal.
- `FeatureToggleGrid.tsx` — reusable grid for showing 11 modul with auto-tick from plan + per-feature override.
- New feature-guard components/hooks — `useFeatureOrHide`, `<FeatureGate>` wrapper.

**Enforcement layer:**
- `useFeature()` already exists (Phase A). Phase B extends: every screen that depends on a `modul_*` toggle wraps its route in `<FeatureGate feature="modul_akuntansi">`; hides menu items via `Sidebar.tsx` filter.
- RPC-level write gate — new helper `_assert_feature_enabled(feature_key text)` reads `tenant_settings` for current tenant, raises `P0405 FEATURE_DISABLED` if false. Wraps in write RPCs that touch feature-scoped tables (e.g., `record_kasir_sale` checks `modul_kasir`, `create_tempo_invoice` checks `modul_tempo`, etc.). Applied only to a curated list — not bulk auto-wrap like `_guard_expiry_write`.

---

## 2. Data model additions

### 2.1 `plans` table extension

```sql
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS target_segment TEXT,
  ADD COLUMN IF NOT EXISTS is_recommended BOOLEAN NOT NULL DEFAULT false;

UPDATE public.plans SET
  description = 'Warung / kios kecil dengan operasi minimal',
  target_segment = 'MSME 1-3 karyawan'
WHERE code = 'STARTER';

UPDATE public.plans SET
  description = 'Toko retail dengan tempo + accounting',
  target_segment = 'MSME 5-15 karyawan',
  is_recommended = true
WHERE code = 'PRO';

UPDATE public.plans SET
  description = 'Distributor / manufaktur multi-gudang',
  target_segment = 'B2B 20+ karyawan'
WHERE code = 'PREMIUM';
```

### 2.1b `company_settings` extension (business profile)

Add `industry` + `employee_range` to enable segmentation analytics + plan-recommendation UX during onboarding.

```sql
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS industry TEXT,
  ADD COLUMN IF NOT EXISTS employee_range TEXT
    CHECK (employee_range IS NULL OR employee_range IN (
      '1-3 orang (Mikro)',
      '4-19 orang (Kecil)',
      '20-99 orang (Menengah)',
      '100+ orang (Besar)'
    )),
  ADD COLUMN IF NOT EXISTS annual_revenue_range TEXT
    CHECK (annual_revenue_range IS NULL OR annual_revenue_range IN (
      '< 300 juta (Mikro)',
      '300 juta - 2.5 miliar (Kecil)',
      '2.5 - 15 miliar (Menengah)',
      '15 - 50 miliar (Besar)',
      '> 50 miliar (Enterprise)'
    ));
-- Buckets aligned with UU UMKM 2020 (Indonesian MSME classification) so
-- segmentation analytics pair naturally with employee_range.

-- Industry: free-text with dropdown-suggested values on the UI (not enum-
-- constrained to avoid migration churn when adding categories). Suggested
-- categories rendered as <optgroup>:
--   Retail: Retail/Toko umum, Apotek/Farmasi, Elektronik, Fashion/Textile,
--           Bahan bangunan, Otomotif
--   F&B: Restoran/Cafe/Warung, Katering, Bakery/Roti
--   B2B: Grosir/Distribusi, Manufaktur/Produksi, Trading/Import-export
--   Jasa: Jasa umum/Service, Konstruksi/Kontraktor, Kesehatan (klinik),
--         Pertanian/Perikanan/Peternakan
--   Fallback: Lain-lain
```

Existing `company_settings` columns leveraged as-is: `company_name`, `address`, `phone`, `email`, `npwp`, `logo_url`, `costing_method` (FIFO|Average CHECK), `opname_require_witness`.

**Explicit backfill of existing Garindo tenant** — required at migration apply time:

```sql
-- Garindo predates Phase B; backfill to a plausible value so it doesn't
-- appear as "unprofiled" in analytics. Founder can revise later via
-- Pengaturan.
UPDATE public.company_settings
SET
  industry = COALESCE(industry, 'Retail/Toko umum'),
  employee_range = COALESCE(employee_range, '4-19 orang (Kecil)')
WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug = 'garindo');
```

New tenants created via the onboarding wizard must supply both fields at Step 4 (enforced in `create_tenant_atomic` validation, not by NOT NULL constraint — kept nullable for pre-Phase-B Garindo compatibility and for API-created tenants in Phase C).

### 2.2 `import_uploads` — Excel import staging

```sql
CREATE TABLE IF NOT EXISTS public.import_uploads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id         UUID REFERENCES public.tenants(id) ON DELETE CASCADE,   -- NULL while onboarding (before tenant creation)
  draft_key         TEXT NOT NULL,            -- Groups uploads belonging to a single wizard draft; format 'draft-<uuid>'
  entity_type       TEXT NOT NULL CHECK (entity_type IN (
    -- Master (Wave 3a)
    'products', 'customers', 'suppliers', 'coa_kasbank',
    -- Transactional (Wave 3b — historical migration)
    'sales_invoices', 'purchase_invoices', 'journal_entries', 'stock_movements'
  )),
  filename          TEXT NOT NULL,
  raw_rows          JSONB NOT NULL,           -- entire Excel content, parsed to JSONB rows (may include nested 'header' + 'lines' for dual-sheet imports)
  validation_report JSONB,                    -- {valid: [...], errors: [{row: N, field, message}], summary: {...}}
  status            TEXT NOT NULL DEFAULT 'UPLOADED'
                      CHECK (status IN ('UPLOADED','VALIDATING','VALIDATED','COMMITTING','COMMITTED','FAILED','ABANDONED')),
  committed_row_ids JSONB,                    -- {table1: [pk1,pk2,...], table2: [...]} — populated on commit for undo
  committed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours')
);
CREATE INDEX idx_import_uploads_admin_pending ON public.import_uploads(admin_user_id, created_at DESC)
  WHERE status NOT IN ('COMMITTED','ABANDONED');
CREATE INDEX idx_import_uploads_draft ON public.import_uploads(draft_key)
  WHERE status NOT IN ('COMMITTED','ABANDONED');
COMMENT ON TABLE public.import_uploads IS 'category=P';
```

- P-category (super-admin only, no cross-tenant visibility).
- Auto-expires after 24 hours (cleanup job / cron in Phase C).
- `draft_key` links a set of uploads to a wizard draft. Server-side identity of a draft; `localStorage` on FE tracks form state and the current `draft_key`. Resume across devices requires copying `draft_key` (out of Phase B scope; noted).
- Stores the entire uploaded content in `raw_rows` (JSONB) — MSME onboarding scale (up to 10k rows per file); revisit if hitting DB size ceiling.
- `committed_row_ids` records exact PKs inserted per business table for FK-safe undo (see §6.8).

### 2.3 New audit action codes

Extend `platform_admin_audit.action` CHECK constraint:

```sql
ALTER TABLE public.platform_admin_audit
  DROP CONSTRAINT platform_admin_audit_action_check;
ALTER TABLE public.platform_admin_audit
  ADD CONSTRAINT platform_admin_audit_action_check
  CHECK (action IN (
    'IMPERSONATE_START','IMPERSONATE_END',
    'CREATE_TENANT','CHANGE_PLAN','CHANGE_FEATURES',
    'SUSPEND','ACTIVATE','ARCHIVE',
    'RENEW_SUBSCRIPTION','SEND_OWNER_INVITE','RESEND_OWNER_INVITE',
    'IMPORT_COMMIT','IMPORT_UNDO',
    'PLAN_EDIT'
  ));
```

### 2.4 Feature entitlement helper (SQL)

```sql
CREATE OR REPLACE FUNCTION public._assert_feature_enabled(p_feature_key text)
RETURNS void LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_tid uuid;
  v_enabled boolean;
BEGIN
  v_tid := public._resolve_tenant_id();
  IF v_tid = '00000000-0000-0000-0000-000000000000'::uuid THEN
    -- Sentinel means no tenant context; let the caller decide via RLS
    RETURN;
  END IF;

  -- Read from tenant_settings (kept in sync by trigger from tenant_subscriptions)
  EXECUTE format('SELECT %I FROM public.tenant_settings WHERE tenant_id = $1', p_feature_key)
    INTO v_enabled USING v_tid;

  IF v_enabled IS NOT DISTINCT FROM false THEN
    RAISE EXCEPTION USING errcode = 'P0405',
      message = 'FEATURE_DISABLED',
      hint = format('Fitur %I tidak aktif di plan tenant ini.', p_feature_key);
  END IF;
END $$;

REVOKE ALL ON FUNCTION public._assert_feature_enabled(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._assert_feature_enabled(text) TO authenticated, vosi_rpc_owner;
```

- Used inside curated write RPCs (e.g., top of `record_kasir_sale` body).
- Raises P0405; frontend interceptor maps to a "Fitur tidak aktif — hubungi admin" toast.

---

## 3. Admin panel UX + navigation

### 3.1 Global chrome

```
┌─────────────────────────────────────────────────────────┐
│ 🛡️ VOSI Admin              tonywei.office@gmail.com ▾ │  ← Top header (fixed, 40px)
├─────────────────────────────────────────────────────────┤
│ Impersonating: garindo — Exit ▸                          │  ← Yellow banner (only when active)
├─────────────────────┬───────────────────────────────────┤
│ Manage              │                                    │
│  🏠 Home           │      Main content area            │
│  🏢 Tenants (2)    │                                    │
│  💳 Plans (3)      │                                    │
│  📥 Import queue [2]│                                    │
│  📊 Audit log      │                                    │
│ System             │                                    │
│  ⚙️ Settings       │                                    │
│  ❓ Docs           │                                    │
└─────────────────────┴───────────────────────────────────┘
```

- Sidebar 200px, main content flex.
- Sidebar item badges show unresolved counts (import queue pending items, expiring tenants).
- Top-right user menu: logout + docs link.

### 3.2 Route map

| Path | Component | Access |
|---|---|---|
| `/admin` | `AdminHome` | platform_admin only |
| `/admin/tenants` | `TenantsList` | platform_admin only |
| `/admin/tenants/new` | `OnboardingWizard` | platform_admin only |
| `/admin/tenants/:slug` | `TenantDetail` (default Overview tab) | platform_admin only |
| `/admin/tenants/:slug?tab=plan` | `TenantDetail` (Plan & Features tab) | " |
| `/admin/tenants/:slug?tab=users` | `TenantDetail` (Users tab) | " |
| `/admin/tenants/:slug?tab=imports` | `TenantDetail` (Import history tab) | " |
| `/admin/tenants/:slug?tab=audit` | `TenantDetail` (Audit tab) | " |
| `/admin/plans` | `PlansManagement` | platform_admin only |
| `/admin/import-queue` | `ImportQueue` (pending imports across all tenants) | " |
| `/admin/audit` | `AuditLogViewer` (global) | " |

Non-admin hitting any `/admin/*` → redirect `/login` (Phase A behavior).

### 3.3 Home dashboard content

- **4 KPI cards row**:
  1. **Tenant terdaftar** — total count with delta vs bulan lalu
  2. **Aktif pakai sistem** — `N / total` yang login + transaksi dalam 7 hari terakhir (green ✓)
  3. **Kadaluarsa <45 hari** — count + amber if >0
  4. **Impor tertunda** — count + amber if >0 (Wave 3+)
- **Aktivitas tenant hari ini** table (NEW) — per-tenant usage summary:
  - Kolom: Tenant, Login terakhir, Transaksi (7d), Rata-rata harian, Status pakai
  - Status pakai badge: **Sangat aktif** (>100 txn/hari), **Aktif** (1-100 txn/hari), **Idle** (0 txn 7d), **Vakum** (tidak login 30d)
  - Purpose: super-admin bisa langsung lihat apakah tenant benar-benar pakai sistem atau abandoned
- **Recent activity feed** (last 20 audit events) — clickable rows navigate to context.
- **Attention needed queue** — grouped by type: expiring subs (with Renew link), failed imports (with Fix link), suspended tenants (with Activate link).
- **Primary CTA top-right**: `+ Daftarkan tenant baru` → `/admin/tenants/new`.

### 3.4 Tenants list

- Search bar (matches slug, name, or owner email).
- 3 filters: Plan, Status, Expiry range.
- Sortable columns: Nama, Slug, Paket, Status, **Pakai sistem** (usage badge + login mnt ago + txn/hari), Kadaluarsa, Pengguna, SKU, Aksi.
- Row actions: Impersonate, Edit (→ detail page); Perpanjang muncul untuk tenant yang mendekati kadaluarsa.
- Bulk actions (checkbox per row): Ubah paket (opens plan picker), Suspend, Ekspor CSV.
- Pagination: 25 per page, standard prev/next.

### 3.4b Tenant activity source

Data sources for the "Pakai sistem" column + Home dashboard "Aktivitas tenant hari ini":
- `tenant_activity_daily` table (Phase A stub) — populated by nightly job aggregating audit + transaction counts per tenant per day. Phase B seeds a minimal populator: a trigger on write RPCs increments today's row.
- `auth.users.last_sign_in_at` for the tenant's owner user (JOIN via `tenant_users`).
- Aggregation view `v_tenant_usage_summary` (new, Wave 1) computes:
  - `last_login_at` = MAX(auth.users.last_sign_in_at) across all users in tenant
  - `txn_7d` = SUM of activity_daily.transaction_count where date >= today - 7
  - `avg_txn_per_day` = txn_7d / 7
  - `usage_status` = derived: `SANGAT_AKTIF` if avg > 100, `AKTIF` if avg >= 1, `IDLE` if txn_7d = 0 AND last_login < 7d, `VAKUM` if last_login > 30d.

### 3.5 Tenant detail — 6 tabs

**Overview** — read-mostly summary (identity, subscription, quick stats).

**Plan & Features** — plan selector card + FeatureToggleGrid + renewal action.

**Users** — list of `tenant_users` for this tenant, add/remove staff, promote to owner, resend OTP.

**Import history** — list of past `import_uploads` for this tenant with status, row counts, undo (if within 24h).

**Audit timeline** — timeline of `platform_admin_audit` events for this tenant only.

**Billing** — stub with "Coming in Phase C" message. Keeps the tab visible so users understand the roadmap.

### 3.6 Empty state — before tenant #2

Home dashboard when only Garindo exists shows a friendlier layout:

- Big illustration + "Baru mulai? Ayo onboard tenant kedua"
- Prominent primary CTA "+ Onboard tenant baru"
- Small link "Lihat 1 tenant existing (Garindo)"

Once `tenants` count > 1, revert to full dashboard layout.

---

## 4. Onboarding wizard

### 4.1 Flow

```
Step 1 Identity ──▶ Step 2 Plan & Features ──▶ Step 3 Owner Invite ──▶
Step 4 Company Info (opt) ──▶ Step 5 Data Import (opt) ──▶ Step 6 Review & Commit
```

- Steps 1–3 required.
- Steps 4–5 skippable with a single click each.
- Every step has: `← Back`, `Save draft`, `Next →` buttons.
- Draft persists in `localStorage` per admin user; resumes on reload.

### 4.2 Step 1 — Identity

Fields:

| Field | Type | Required | Validation |
|---|---|---|---|
| `name` | text | yes | 3-60 chars |
| `slug` | text | yes | regex `^[a-z0-9][a-z0-9-]{2,29}$`; reserved words (from Phase A CHECK): `admin, api, auth, login, signup, www, t, static, assets, public, app, support, help`; server-side uniqueness check on blur |

- Slug auto-generated on `name` blur: lowercase, replace non-alnum with hyphen, trim consecutive hyphens.
- Live preview: `https://vosi.id/<slug>/dashboard`.
- **URL structure changed (Phase B decision):** dropped `/t/` prefix; tenants live directly under `vosi.id/<slug>/*`. Consequence: reserved slug list expands beyond the Phase A set to cover ALL top-level routes. Extended reserved slug list (implemented in `check_slug_available` + wizard client-side validation):
  - Auth/system: `admin, api, auth, login, signup, logout, verify, callback, oauth, health`
  - App routes: `dashboard, kasir, pembelian, penjualan, piutang, utang, akuntansi, gudang, pengaturan, laporan, jasa, kas`
  - Marketing/public: `www, about, contact, terms, privacy, docs, pricing, blog, support, help`
  - Static/infra: `static, assets, public, app, cdn, media, uploads`
  - Backward-compat historical: `t` (kept reserved to prevent old bookmarks from clashing)
- Domain: `vosi.id` (production). Existing Garindo URL `erpapp.id/t/garindo/*` gets deployment-level rewrite → `vosi.id/garindo/*` (Cloud Run routing config; Phase C DNS + SSL provisioning).
- Slug uniqueness check calls `check_slug_available(text) → boolean` RPC.

### 4.3 Step 2 — Plan & Features

Fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `plan_code` | radio | yes | STARTER / PRO / PREMIUM |
| `activated_at` | date | yes | default today |
| `expires_at` | date | yes | default +12 months; CHECK `>=activated_at` |
| `feature_overrides` | JSONB | no | expandable accordion, per-feature checkbox |

- Plan cards visual: 3-column grid with description, target segment, recommended badge (PRO).
- Feature grid: 11 rows for the 11 `modul_*` keys.
  - Green background = default from plan
  - Red background = enabling a feature that's not in the plan bundle (override)
  - Muted background = disabling a feature that IS in the plan (override)
- Info box: "Manual override akan disimpan sebagai `feature_overrides` JSONB. Bisa diubah kapan saja di tenant detail."

### 4.4 Step 3 — Owner invite

Fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `owner_email` | email | yes | RFC 5322 validation; server checks existing auth.users |
| `owner_name` | text | no | display name |
| `send_invite_now` | boolean | — | default true; checkbox with helper text |

- If `owner_email` already exists in `auth.users`: show info banner "Email sudah terdaftar — akan di-link ke tenant ini sebagai owner". No new user created.
- If not: user will be created via `send_owner_invite` RPC when the wizard commits (Step 6).
- Preview email content shown inline (subject + body preview).

### 4.5 Step 4 — Company info (business profile required; rest optional)

Fields:

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `company_name` | text | no | Step 1 name | overwritable |
| `industry` | select | **yes** | none | 4 categories × ~16 options + "Lain-lain"; stored as TEXT |
| `employee_range` | select | **yes** | none | 4 buckets: Mikro / Kecil / Menengah / Besar |
| `annual_revenue_range` | select | **yes** | none | 5 buckets aligned to UU UMKM 2020; see below |
| `address` | textarea | no | empty | |
| `phone` | text | no | empty | |
| `email` | email | no | empty | |
| `npwp` | text | no | empty | 15-digit format optional |
| `logo` | file | no | none | PNG/JPG max 2MB → `branding` bucket |
| `costing_method` | radio | no | FIFO | FIFO / Average |

- `industry` + `employee_range` + `annual_revenue_range` are the required fields — used for MSME segmentation analytics + plan-recommendation UX ("Based on your industry, headcount, and revenue tier, PRO is a good fit"). Employee AND revenue together disambiguate cases where one signal is misleading (e.g., 3-person software house with 5B revenue = Menengah not Mikro).
- Annual revenue dropdown (aligned to UU UMKM 2020 thresholds):
  - `< 300 juta (Mikro)`
  - `300 juta - 2.5 miliar (Kecil)`
  - `2.5 - 15 miliar (Menengah)`
  - `15 - 50 miliar (Besar)`
  - `> 50 miliar (Enterprise)`
- "Skip contact + branding" button → wizard sets only industry+employee_range; auto-seed trigger from `_seed_company_settings_for_new_tenant` fills remaining defaults (company_name = tenant.name, costing_method = FIFO, rest empty).
- Warning banner on `costing_method`: "Ubah setelah ada transaksi bisa bikin ledger tidak konsisten."
- Industry dropdown structure (rendered as `<optgroup>`):
  - **Retail & FMCG:** Retail/Toko umum, Apotek/Farmasi, Elektronik, Fashion/Textile, Bahan bangunan, Otomotif
  - **F&B:** Restoran/Cafe/Warung, Katering, Bakery/Roti
  - **B2B / Wholesale:** Grosir/Distribusi, Manufaktur/Produksi, Trading/Import-export
  - **Jasa:** Jasa umum/Service, Konstruksi/Kontraktor, Kesehatan (klinik, lab, dokter praktek), Pertanian/Perikanan/Peternakan
  - **Fallback:** Lain-lain

### 4.6 Step 5 — Data import (all optional)

4 parallel cards — one per entity type. See §6 for detail. Each card independently:

- Download template (Excel)
- Upload file
- Preview + validate
- Commit (or skip)

Each card's status flows: `Not started → Uploaded → Validating → Validated (N valid + M error) → Committed`.

Card actions when errored:
- **Commit N valid, skip M** — moves to Committed
- **Download errors.xlsx** — for fixing in Excel then re-upload
- **Fix inline** — edit the preview table, re-validate

**Partial commit strategy:** each card commits into `import_uploads` (staged), NOT into business tables yet. Business-table INSERT happens atomically at Step 6 when the whole wizard commits. This lets super-admin undo per-card before wizard finish.

Skip semua button top-right → tenant starts empty.

### 4.7 Step 6 — Review & commit

- Summary table showing:
  - Slug / plan / expiry / feature overrides count
  - Owner + send_invite_now
  - Company info (Filled or Default)
  - Import status per entity (row count ready + skipped errors)
- Warning callout: slug immutability + owner will receive OTP within 60 seconds.
- Big green "🚀 Onboard sekarang" CTA.

**`create_tenant_atomic` payload contract:**

```jsonc
// Input (jsonb):
{
  "draft_key": "draft-<uuid>",           // links to import_uploads staged under this draft
  "identity": {
    "name": "Apotek Sehat Semarang",
    "slug": "apotek-sehat"
  },
  "subscription": {
    "plan_code": "PRO",
    "activated_at": "2026-07-04",
    "expires_at": "2027-07-04",
    "feature_overrides": { "modul_multi_warehouse": true, "modul_bom_recipe": true }
  },
  "owner": {
    "email": "owner@apoteksehat.co.id",
    "name": "Bu Sri Wahyuni",
    "send_invite_now": true
  },
  "company": {                            // Optional; if omitted or null → default seed via trigger
    "industry": "Apotek/Farmasi",
    "employee_range": "4-19 orang (Kecil)",
    "company_name": "Apotek Sehat Semarang",  // Optional; defaults to identity.name
    "address": "...", "phone": "...", "email": "...", "npwp": "...",
    "logo_object_key": "branding/apotek-sehat/logo.png",  // Client uploaded to Supabase Storage before calling RPC
    "costing_method": "FIFO"
  }
  // Note: imports are NOT in the payload. RPC discovers them by joining import_uploads
  // where draft_key = payload.draft_key AND status = 'VALIDATED'.
}

// Return (jsonb):
{
  "tenant_id": "uuid",
  "tenant_slug": "apotek-sehat",
  "owner_user_id": "uuid",
  "owner_invite_url": "https://.../verify?token=..." | null,
  "imports_committed": [
    { "entity_type": "products", "upload_id": "uuid", "rows_inserted": 456 },
    ...
  ]
}

// Errors: RAISE EXCEPTION USING errcode='P04..' with structured message:
//   P0403 PLATFORM_ADMIN_REQUIRED
//   P0409 SLUG_TAKEN
//   P0410 OWNER_EMAIL_INVALID
//   P0411 STEP_N_FAILED (message includes failed step name + detail)
```

Body executes as a single transaction:

1. Admin gate (see §1.2 template).
2. Validate payload shape (all required keys present).
3. INSERT into `tenants` (slug uniqueness enforced by UNIQUE constraint; catch `unique_violation` → P0409).
4. INSERT into `tenant_subscriptions` (fires sync trigger → seeds `tenant_settings`).
5. INSERT into `platform_admin_audit` (`CREATE_TENANT` with full payload snapshot in `detail_json`).
6. Owner resolution:
   - If `payload.owner.email` exists in `auth.users` → link existing `user_id`.
   - Else INSERT via `auth.admin_create_user_by_email(email, name)` (wrapped RPC that calls Supabase Auth admin API from server-side; specifics in plan).
7. INSERT into `tenant_users` (role=owner).
8. UPSERT `company_settings` if `payload.company` is non-null; else trigger auto-seeds default.
9. FOR each `import_uploads` row where `draft_key = payload.draft_key AND status = 'VALIDATED'`:
   - Call the appropriate `commit_import_<entity>` inline (see §6).
   - Populate `committed_row_ids` per entity.
   - Set `status = 'COMMITTED'`, `tenant_id = new_tenant_id`, `committed_at = now()`.
10. If `payload.owner.send_invite_now = true`: call `auth.admin_generate_magic_link(email)` → return URL in result.

Any step fails → whole transaction rollback, admin sees specific P04.. error with which step failed.

Success → FE redirects to `/admin/tenants/<slug>` with a confetti toast.

---

## 5. Feature entitlement service

### 5.1 Three layers of enforcement

1. **Frontend menu filter (Sidebar.tsx)** — reads `useFeature('modul_X')`; hides menu items for disabled modules.
2. **Frontend route gate (`<FeatureGate>`)** — wraps each feature-scoped route; disabled feature → redirect to dashboard with "Fitur tidak aktif" toast.
3. **Backend RPC gate** — write RPCs that touch feature-scoped tables call `_assert_feature_enabled('modul_X')` at their top. Raises `P0405` if disabled; interceptor maps to user-friendly toast.

### 5.2 Feature-to-module mapping (13 modul)

Post-audit terhadap seluruh codebase Garindo mengidentifikasi 2 fitur yang layak jadi toggle karena punya cost/integration overhead (bukan foundational). Total: 13 modul.

| Feature key | Frontend screens gated | RPCs gated |
|---|---|---|
| `modul_kasir` | KasirScreen, KasirInvoiceModal | record_kasir_sale, record_kasir_sale_with_discount, record_kasir_sale_tier |
| `modul_tempo` | PiutangScreen, TempoCreditSection, DaftarTempoScreen | create_tempo_invoice, create_tempo_invoice_tier, tempo write-off RPCs |
| `modul_pengiriman` | KasirScreen shipping row addon, PenjualanScreen shipping row | record_kasir_sale ships row logic (soft-gate at row level) |
| `modul_multi_warehouse` | ManajemenGudangScreen, WarehouseTransferModal | warehouse_transfer_*, warehouse admin RPCs |
| `modul_akuntansi` | AkuntansiScreen, LaporanScreen accounting tabs | journal_entry_lines writes, tempo GL RPCs |
| `modul_jasa_layanan` | Jasa & Layanan menu items | jasa RPCs (record_kasir_sale with service line type) |
| `modul_bom_recipe` | Recipe / BOM screens | rakit_* RPCs (assembly / recipe) |
| `modul_diskon_kasir` | Kasir cart discount column | record_kasir_sale_with_discount |
| `modul_diskon_penjualan` | CatatPenjualanWizard Step 2 discount | penjualan discount RPCs |
| `modul_diskon_tagihan` | Pembelian Tagihan discount | tagihan discount RPCs |
| `modul_multi_tier_price` | Multi-tier price columns, kasir tier switcher | record_kasir_sale_tier, create_tempo_invoice_tier |
| **`modul_barcode_photo_search`** *(NEW)* | CariByFotoScreen (Kasir + Pembelian), photo-based product search | `_cari_produk_by_photo_ai` RPC (Gemini vision API cost tier gate) |
| **`modul_wa_notification`** *(NEW)* | SalesInboxScreen, WhatsappAiScreen, NotificationSettingsScreen (WA channel) | `send_wa_notification_*` RPCs (WhatsApp Business API integration + credentials) |

**Always-on features (NOT toggle-able — foundational):** Kas & Bank, Stock Opname, Laporan, Dashboard, User Management, Rekonsiliasi. Confirmed via codebase audit.

**Plan bundle assignment:**

| Plan | Modul count | Modul included |
|---|---|---|
| STARTER | 3 | `kasir`, `akuntansi`, `pengiriman` |
| PRO | 9 | STARTER + `tempo`, `diskon_kasir`, `diskon_penjualan`, `diskon_tagihan`, **`wa_notification`**, **`barcode_photo_search`** |
| PREMIUM | 13 (semua) | PRO + `multi_warehouse`, `bom_recipe`, `multi_tier_price`, `jasa_layanan` |

Full mapping goes into implementation plan; here I list the pattern.

### 5.3 `<FeatureGate>` component contract

```typescript
interface FeatureGateProps {
  feature: ModulSwitchKey;
  children: React.ReactNode;
  fallback?: React.ReactNode;  // default: redirect to dashboard with toast
}

// Usage in App.tsx routes:
<FeatureGate feature="modul_akuntansi">
  <AkuntansiScreen />
</FeatureGate>
```

- Reads `useFeature('modul_akuntansi')`.
- If false and no fallback: triggers `navigate('/dashboard')` + shows toast "Fitur Akuntansi tidak aktif di plan kamu. Hubungi admin."
- If false and fallback provided: render fallback (used for inline UI where a section should just disappear).

### 5.4 Feature-toggle UX in tenant detail

The Plan & Features tab shows:
- Current plan card (with change dropdown)
- Feature grid — 11 rows, each with:
  - Toggle switch (current effective value)
  - "Plan default" indicator vs "Overridden"
  - Description + cascading impact (which screens/RPCs unlock)
- "Reset to plan defaults" button — clears `feature_overrides` JSONB.
- Save button → calls `set_feature_overrides()` RPC → sync trigger updates `tenant_settings` → connected clients get refreshed features on next JWT refresh.

---

## 6. Data import

### 6.1 Excel template contract per entity

Every template:
- Row 1: column headers (exact names)
- Row 2: description comment (grayed out)
- Row 3: example row
- Rows 4+: user data

Template download endpoint: `/api/import-templates/<entity>` — served as static Excel files from repo `public/import-templates/`.

**Two-wave rollout inside Wave 3 (see §10):**

- **Wave 3a — Master + Opening (4 templates):** products, customers+piutang, suppliers+utang, coa_kasbank. Sufficient for tenants migrating from paper/spreadsheet. §6.2–6.5.
- **Wave 3b — Historical Transactions (4 templates):** sales_invoices, purchase_invoices, journal_entries, stock_movements. For tenants migrating from another ERP with existing transaction history. §6.9–6.12.

**Dependency ordering (enforced by wizard):**

```
coa_kasbank ──┐
products ─────┼──▶ sales_invoices ──▶ (payment history — Phase C)
customers ────┤──▶ purchase_invoices
suppliers ────┘
              └──▶ journal_entries (as-is; no auto-post)
              └──▶ stock_movements
```

Wizard blocks transactional card upload until master card in same dependency chain is at least `VALIDATED`. Rationale: transactional rows reference master keys (customer_id, sku, supplier_id, account_code) that must resolve.

**GL strategy — "as-is":** `sales_invoices` and `purchase_invoices` import ONLY inserts into `orders`/`order_items` and `purchase_invoices`/`purchase_invoice_items`; the auto-post GL trigger is bypassed during import (`SET LOCAL vosi.import_mode = 'on'` guard). GL history comes from the separate `journal_entries` template. This matches how the source ERP already booked. Zero double-booking risk.

### 6.2 Products template — matches `stocks` schema

Columns (verbatim `stocks` column names):

| Column | Required | Type | Notes |
|---|---|---|---|
| `sku` | yes | VARCHAR(50) | UNIQUE per tenant; if empty → auto-gen |
| `name` | yes | TEXT | |
| `category` | yes | VARCHAR(100) | free-text; not a FK |
| `subcategory` | no | TEXT | |
| `price` | yes | NUMERIC | harga eceran; ≥ 0 |
| `price_grosir` | no | NUMERIC(14,2) | only if `modul_multi_tier_price` on |
| `harga_modal` | recommended | NUMERIC(15,2) | opening HPP |
| `unit` | no | TEXT | default `'pcs'` |
| `unit_alt` | no | TEXT | must pair with `unit_alt_factor` |
| `unit_alt_factor` | no | INT | must pair with `unit_alt` (CHECK constraint) |
| `stock_atas` | no | INT | default 0 · **⚠️ Garindo dual-warehouse legacy** (multi-warehouse: gunakan Wave 3c template `stock_per_warehouse` instead) |
| `stock_bawah` | no | INT | default 0 · **⚠️ Garindo dual-warehouse legacy** |
| `min_stock_per_product` | no | INT | reorder point |
| `is_passthrough` | no | BOOLEAN | default false; skips FIFO |
| `description` | no | TEXT | |
| `batch_number` | conditional | TEXT | **WAJIB untuk industri Farmasi/F&B** (validated per `company_settings.industry` OR `costing_method=BATCH`); optional untuk lain |
| `expiry_date` | conditional | DATE | required if `batch_number` filled; format `YYYY-MM-DD` |
| `days_to_expiry_alert` | no | INT | default 30; product-level alert threshold |
| `photo_url` | no | TEXT | External URL (Google Drive/Dropbox/S3 public link); system will download + copy ke Supabase Storage `product-photos/<tenant_slug>/<sku>.jpg` on commit. Supports 1-5 URLs comma-separated (matches `stocks.photo_urls` JSONB max 5 items) |

Validation:
- SKU uniqueness within upload + against existing `stocks` for tenant.
- `unit_alt` + `unit_alt_factor` must both be filled or both empty (matches CHECK constraint on the table).
- `stock_atas`, `stock_bawah` ≥ 0 (memory `feedback_allow_negative_stock_preorder` applies to runtime sales, not opening import).
- Category free-text — no FK check needed.
- **Batch/expiry conditional required:** if `company_settings.industry IN ('Apotek/Farmasi', 'Bakery/Roti', 'Katering', 'Restoran/Cafe/Warung')` OR SKU is BATCH-tracked, `batch_number` + `expiry_date` WAJIB (validation error kalau kosong). Untuk industri lain, kolom optional.
- `expiry_date` harus > today (soft warning, tidak block — mungkin tenant migrate ada stok expired yang perlu di-write-off setelah live).
- **`photo_url` async download**: kalau URL invalid/timeout, row tetap commit tapi photo_urls di-NULL + tampilkan warning "N SKU tanpa foto — Cari-by-foto akan disabled untuk SKU tersebut sampai foto di-upload manual".

Commit: INSERT into `stocks` with computed `stock = stock_atas + stock_bawah`; INSERT initial `stock_movements` row (source_type = `OPENING_BALANCE`); create `stock_lots` if FIFO costing; kalau batch_number filled, INSERT ke `stock_lots` dengan lot_id=batch_number + expiry_date; async job download photo_url URLs ke Supabase Storage bucket `product-photos` + UPDATE `stocks.photo_urls` JSONB.

**⚠️ Dual-warehouse legacy caveat:** `stock_atas`/`stock_bawah` are hardcoded from Garindo's original schema (per memory `project_phase3_warehouse_cutover_pending`). For future non-Garindo tenants, these columns are semantically arbitrary ("Warehouse 1" / "Warehouse 2"). Full warehouse-cutover to proper `warehouses` table is deferred to a later phase; Phase B imports use them as-is with an info label in the Excel template header.

### 6.3 Customers + Piutang template — matches `customers` schema

Columns (verbatim `customers` column names):

| Column | Required | Type | Notes |
|---|---|---|---|
| `wa_number` | yes | TEXT | UNIQUE; regex `^62[0-9]{8,15}$` |
| `name` | yes | TEXT | |
| `company` | no | TEXT | nama perusahaan/toko |
| `address` | no | TEXT | |
| `default_pricing_tier` | no | TEXT | enum: `eceran` \| `grosir`; default `'eceran'` |
| `allows_tempo` | no | BOOLEAN | default `false` |
| `term_days` | no | INT | default 0; jatuh tempo credit |
| `credit_limit` | no | NUMERIC(15,2) | default 0; plafon piutang |
| `piutang_outstanding` | no | NUMERIC | opening AR balance (import-only field, not a customers column) |
| `piutang_due_date` | no | DATE | required if `piutang_outstanding > 0` |

Validation:
- `wa_number` format.
- `default_pricing_tier` ∈ {`eceran`, `grosir`}.
- If `piutang_outstanding > 0` → `piutang_due_date` required.

Commit: INSERT into `customers` (id auto-generated as `<SLUG>-CUST-NNNN` — needs per-tenant prefix generator, see §6.6 below); for rows with `piutang_outstanding > 0`, INSERT an opening `orders` row + `journal_entries` for the AR debit / owner equity credit pair (if `modul_akuntansi` on).

### 6.4 Suppliers + Utang template — matches `suppliers` schema

Columns (verbatim `suppliers` column names):

| Column | Required | Type | Notes |
|---|---|---|---|
| `name` | yes | TEXT | |
| `contact_name` | no | TEXT | |
| `phone` | no | TEXT | format `^62[0-9]{8,15}$` if filled |
| `payment_term_days` | no | INT | default 0 |
| `utang_outstanding` | no | NUMERIC | opening AP balance (import-only field, not a suppliers column) |
| `utang_due_date` | no | DATE | required if `utang_outstanding > 0` |

Commit: INSERT into `suppliers`; if `utang_outstanding > 0` → INSERT opening `purchase_invoices` row + journal entries (AP credit / owner equity debit pair).

### 6.5 COA + Kas/Bank template — matches `chart_of_accounts` + `cash_accounts` schemas

Dual-sheet Excel:

**Sheet 1 — Chart of Accounts** (extends the seeded COA, `chart_of_accounts` column names):

| Column | Required | Type | Notes |
|---|---|---|---|
| `account_code` | yes | TEXT | UNIQUE per tenant (e.g., `1-1110`) |
| `account_name` | yes | TEXT | |
| `account_type` | yes | TEXT | enum: `ASET` \| `LIABILITAS` \| `MODAL` \| `PENDAPATAN` \| `BEBAN` |
| `account_subtype` | no | TEXT | e.g., `Kas`, `Bank`, `Piutang Usaha` |
| `parent_account_code` | no | TEXT | must reference another row in Sheet 1 (resolves to `parent_id` via lookup) |
| `is_control_account` | no | BOOLEAN | default `false` |
| `normal_balance` | yes | TEXT | `DEBIT` \| `CREDIT` |
| `description` | no | TEXT | |

**Sheet 2 — Kas/Bank accounts** (`cash_accounts` column names):

| Column | Required | Type | Notes |
|---|---|---|---|
| `account_type` | yes | TEXT | enum: `BANK` \| `KAS` \| `E_WALLET` |
| `internal_label` | yes | TEXT | display name (e.g., `Kas Toko`, `BCA Utama`) |
| `coa_account_code` | yes | TEXT | must reference a row in Sheet 1 (resolves to `coa_account_id` via lookup) |
| `bank_code` | conditional | TEXT | required if `account_type='BANK'`; enum: `BCA` \| `MANDIRI` \| `BRI` \| `BNI` \| `PERMATA` \| `CIMB` \| `OTHER` |
| `account_number` | conditional | TEXT | required if `account_type='BANK'` |
| `account_holder` | no | TEXT | |
| `provider` | conditional | TEXT | required if `account_type='E_WALLET'`; enum: `OVO` \| `GOPAY` \| `DANA` \| `LINKAJA` \| `SHOPEEPAY` \| `OTHER` |
| `purpose` | no | TEXT | enum: `OPERATIONAL` \| `OWNER_PERSONAL` \| `SAVINGS` \| `PETTY_CASH` \| `OTHER`; default `OPERATIONAL` |
| `opening_balance` | no | NUMERIC(15,2) | default 0 |
| `opening_balance_date` | conditional | DATE | required if `opening_balance > 0` |
| `show_in_invoice` | no | BOOLEAN | default `true` |
| `sort_order` | no | INT | default 0 |

Validation:
- Sheet 1: `account_type` ∈ 5 enum values (matches CHECK constraint); `normal_balance` ∈ `{DEBIT, CREDIT}`; `parent_account_code` must exist in Sheet 1 rows.
- Sheet 2: `account_type`-conditional required fields per CHECK constraints on `cash_accounts`.
- `coa_account_code` in Sheet 2 must resolve to a row that has `account_type='ASET'` and `account_subtype LIKE 'Kas%' OR 'Bank%'`.

Commit: INSERT Sheet 1 rows into `chart_of_accounts` (resolving `parent_account_code` → `parent_id` UUID via post-insert UPDATE pass); INSERT Sheet 2 rows into `cash_accounts` (resolving `coa_account_code` → `coa_account_id`); for each Sheet 2 row with `opening_balance > 0`, INSERT balanced opening `journal_entries` pair: `Kas/Bank DR = opening_balance` / `Modal Awal CR = opening_balance`.

### 6.6 Per-tenant customer ID prefix — collision-safe

The `customers.id` PK is TEXT and globally unique across the DB (Phase A retained this from Garindo). Format: `<TENANT_SLUG>-CUST-NNNN`, using the full slug (not a 3-char abbreviation) to guarantee no collision between tenants.

**Rejected alternative:** first 3 uppercase chars of slug. Rejected because `apotek-sehat` and `apoteker-sabang` would both produce `APS-CUST-*` and collide as global PKs.

**Chosen format:**

```
customer_id = <tenant_slug_normalized>-CUST-<zero-padded-seq>
where tenant_slug_normalized = replace(slug, '-', '_') (max 20 chars, hyphens replaced with underscores to preserve delimiter)
```

Examples:
- Garindo (backward compat): `GJP-CUST-0001` retained; new customers on Garindo use `garindo-CUST-NNNN`.
- Apotek Sehat: `apotek_sehat-CUST-0001`.
- Apoteker Sabang: `apoteker_sabang-CUST-0001`. No collision.

The sequence NNNN is per-tenant (query `SELECT MAX(...) + 1 FROM customers WHERE tenant_id = ...`). Handled inside `create_tenant_atomic()` for imports; per-customer INSERT RPC also uses this pattern.

**Garindo backward-compat:** keep existing `GJP-CUST-*` IDs unchanged (in place). Only new customers get the new prefix. Documented as a legacy artifact — no data migration.

### 6.7 Preview + validation flow

1. User uploads Excel via `<input type="file">` (SheetJS parse in-browser).
2. Frontend calls `create_import_upload(entity_type, filename, raw_rows_json)` RPC → returns `upload_id`.
3. Frontend calls `preview_import_<entity>(upload_id)` RPC → runs validation + returns `{valid_count, error_count, rows: [...], errors: [...]}`.
4. Frontend renders preview table with row-level error highlights.
5. User picks action:
   - **Commit valid, skip errors** → `commit_import_<entity>(upload_id, skip_errors=true)`.
   - **Download errors** → generate `errors.xlsx` client-side from validation report + serve for download.
   - **Fix inline** → frontend re-sends `raw_rows` with edits + re-runs `preview`.
6. Committed uploads mark status `COMMITTED` and appear in tenant detail Import History tab.

### 6.8 Undo commit window — FK-safe

For 24 hours after commit, the Import History tab shows an "Undo" button.

**Implementation:** `import_uploads.committed_row_ids` JSONB stores exact PKs inserted per business table. `undo_import(upload_id)` reads this and DELETEs those PKs. Avoids schema changes on 10+ business tables (rejected alternative: marker column per table).

**FK-safety pre-check** — undo MUST NOT proceed if downstream data references imported rows. For each imported PK the RPC checks dependent tables:

| Imported entity | Downstream tables checked |
|---|---|
| products (`stocks`) | `order_items`, `purchase_invoice_items`, `stock_movements`, `stock_lots`, `bom_lines` |
| customers | `orders`, `payments`, `journal_entries` (via source_id) |
| suppliers | `purchase_orders`, `purchase_invoices`, `payments` |
| coa_kasbank | `journal_entry_lines`, `cash_transactions` |
| sales_invoices (`orders`) | `payments`, `stock_movements`, `journal_entries` |
| purchase_invoices | `payments`, `stock_movements`, `journal_entries` |
| journal_entries | (leaf — no downstream check needed) |
| stock_movements | (leaf — no downstream check needed) |

If ANY dependent row references an imported PK → RPC raises `P0412 UNDO_BLOCKED_BY_DEPENDENCIES` with a manifest of blocking references. UX presents: "3 imports cannot be undone — 47 sales invoices reference these products. To undo: first delete downstream data."

**Simplification for onboarding-time imports:** during `create_tenant_atomic`, imports commit atomically with tenant creation. If admin discovers a mistake before any real activity in the tenant, dependent tables are still empty → undo succeeds. If tenant has already recorded any post-import activity → undo blocked (correct behavior).

---

## Wave 3b — Historical transaction templates

Only for tenants migrating from another ERP with full transaction history. Wave 3a masters MUST be committed first (dependency enforced by wizard).

### 6.9 Sales invoices history — `orders` + `order_items`

**Dual-sheet Excel:**

**Sheet 1 — Invoice headers:**

| Column | Required | Type | Notes |
|---|---|---|---|
| `invoice_number` | yes | TEXT | UNIQUE per tenant; preserved from source ERP |
| `invoice_date` | yes | DATE | historical; can be in the past |
| `customer_wa` | yes | TEXT | resolves to `customer_id` via `customers.wa_number` lookup |
| `channel` | yes | TEXT | enum: `KASIR`, `TEMPO`, `PENJUALAN` (matches KasirChannel enum) |
| `tier` | no | TEXT | `eceran` \| `grosir`; default = customer's `default_pricing_tier` |
| `payment_method` | conditional | TEXT | required if `status='PAID'`; enum: `CASH`, `BANK_TRANSFER`, `E_WALLET`, `TEMPO` |
| `subtotal` | yes | NUMERIC(15,2) | before discount/tax |
| `discount_amount` | no | NUMERIC(15,2) | default 0 |
| `tax_amount` | no | NUMERIC(15,2) | default 0 |
| `total` | yes | NUMERIC(15,2) | CHECK: subtotal - discount + tax |
| `status` | yes | TEXT | enum: `PAID`, `UNPAID`, `PARTIAL` |
| `paid_amount` | conditional | NUMERIC(15,2) | required if status IN (`PAID`,`PARTIAL`) |
| `outstanding_amount` | conditional | NUMERIC(15,2) | required if status IN (`UNPAID`,`PARTIAL`); CHECK: = total - paid_amount |
| `due_date` | conditional | DATE | required if status ≠ `PAID` and channel = `TEMPO` |
| `notes` | no | TEXT | free text |

**Sheet 2 — Invoice line items:**

| Column | Required | Type | Notes |
|---|---|---|---|
| `invoice_number` | yes | TEXT | FK to Sheet 1 |
| `sku` | yes | TEXT | resolves to product via `stocks.sku` |
| `qty` | yes | NUMERIC | can be fractional if unit supports |
| `unit_price` | yes | NUMERIC(15,2) | historical price at time of invoice |
| `discount_per_line` | no | NUMERIC(15,2) | default 0 |
| `subtotal` | yes | NUMERIC(15,2) | CHECK: qty × unit_price - discount |
| `hpp_snapshot` | no | NUMERIC(15,2) | historical HPP; if omitted, uses current `harga_modal` |

Validation:
- `customer_wa` must exist in imported customers OR existing `customers` for tenant.
- `sku` must exist in imported products OR existing `stocks`.
- `channel` must match feature enablement: `TEMPO` requires `modul_tempo` on.
- Line items subtotals sum to header `subtotal` (± 0.01 rounding tolerance).

Commit:
- Set `SET LOCAL vosi.import_mode = 'on'` (bypasses GL auto-post trigger and stock-movement auto-generation).
- INSERT into `orders` with `source_type = 'HISTORICAL_IMPORT'`, `import_upload_id` (JSONB in `metadata`).
- INSERT into `order_items` per Sheet 2 row.
- Do NOT touch `stocks.stock_atas/bawah` (opening balance already imported via Wave 3a).
- Do NOT auto-insert `journal_entries` (comes from separate template).
- If `status IN ('UNPAID','PARTIAL')`: also INSERT into `piutang_records` (or equivalent AR ledger) with outstanding_amount.

### 6.10 Purchase invoices history — `purchase_invoices` + `purchase_invoice_items`

**Dual-sheet Excel:**

**Sheet 1 — Invoice headers:**

| Column | Required | Type | Notes |
|---|---|---|---|
| `invoice_number` | yes | TEXT | UNIQUE per tenant |
| `invoice_date` | yes | DATE | |
| `supplier_name` | yes | TEXT | resolves to `supplier_id` via `suppliers.name` |
| `payment_method` | conditional | TEXT | required if status=PAID |
| `subtotal` | yes | NUMERIC(15,2) | |
| `discount_amount` | no | NUMERIC(15,2) | default 0 |
| `tax_amount` | no | NUMERIC(15,2) | default 0 |
| `total` | yes | NUMERIC(15,2) | |
| `status` | yes | TEXT | enum: `PAID`, `UNPAID`, `PARTIAL` |
| `paid_amount` | conditional | NUMERIC(15,2) | |
| `outstanding_amount` | conditional | NUMERIC(15,2) | |
| `due_date` | conditional | DATE | required if status ≠ `PAID` |
| `notes` | no | TEXT | |

**Sheet 2 — Line items:**

| Column | Required | Type | Notes |
|---|---|---|---|
| `invoice_number` | yes | TEXT | FK to Sheet 1 |
| `sku` | yes | TEXT | resolves via `stocks.sku` |
| `qty` | yes | NUMERIC | |
| `unit_cost` | yes | NUMERIC(15,2) | historical cost |
| `subtotal` | yes | NUMERIC(15,2) | |

Commit: mirror §6.9 pattern — `SET LOCAL vosi.import_mode = 'on'`, INSERT into `purchase_invoices` + `purchase_invoice_items`, skip auto-GL/stock triggers, AP outstanding written to `utang_records` if applicable.

### 6.11 Journal entries history — `journal_entries` + `journal_entry_lines` (as-is)

**Dual-sheet Excel:**

**Sheet 1 — Entry headers:**

| Column | Required | Type | Notes |
|---|---|---|---|
| `entry_number` | yes | TEXT | UNIQUE per tenant; preserved from source ERP |
| `entry_date` | yes | DATE | |
| `description` | yes | TEXT | narration |
| `source_type` | no | TEXT | default `'HISTORICAL_IMPORT'`; if source system has original codes (e.g., `SALE`, `PURCHASE`), preserve them |
| `source_reference` | no | TEXT | original ID from source system for traceability |
| `is_locked` | no | BOOLEAN | default `false`; if source was posted+locked, set `true` |

**Sheet 2 — Entry lines:**

| Column | Required | Type | Notes |
|---|---|---|---|
| `entry_number` | yes | TEXT | FK to Sheet 1 |
| `account_code` | yes | TEXT | resolves to `chart_of_accounts.account_code` |
| `debit` | conditional | NUMERIC(15,2) | one of debit/credit MUST be > 0 (matches business rule) |
| `credit` | conditional | NUMERIC(15,2) | |
| `line_description` | no | TEXT | |

Validation:
- Each entry's debit total = credit total (± 0.01 rounding tolerance) — enforced per header before commit.
- `account_code` must exist (in imported COA or existing `chart_of_accounts`).
- Warn (not block) if entry date is before `tenants.activated_at`.

Commit: INSERT into `journal_entries` with `source_type` from row (default `HISTORICAL_IMPORT`) + `journal_entry_lines`. No side effects — this table is the ledger of record for historical data.

### 6.12 Stock movements history — `stock_movements`

Single-sheet Excel:

| Column | Required | Type | Notes |
|---|---|---|---|
| `movement_date` | yes | DATE | |
| `sku` | yes | TEXT | resolves via `stocks.sku` |
| `movement_type` | yes | TEXT | enum: `IN`, `OUT`, `ADJUSTMENT`, `TRANSFER` |
| `qty_change` | yes | NUMERIC | signed: IN → positive, OUT → negative, ADJUSTMENT can be either |
| `warehouse` | no | TEXT | `atas` \| `bawah` (Garindo legacy); default `atas` |
| `unit_cost` | no | NUMERIC(15,2) | required for `IN` if using FIFO costing |
| `source_type` | no | TEXT | default `'HISTORICAL_IMPORT'`; if source has codes (`SALE`, `PURCHASE`, `OPNAME`), preserve |
| `source_reference` | no | TEXT | e.g., invoice_number from source system |
| `notes` | no | TEXT | |

Commit: INSERT into `stock_movements` with `_import_mode = true` flag → append-only trigger allows the row through. Do NOT recompute `stocks.stock_atas/bawah` — those are the final position, not the sum of history (per Garindo legacy).

**Post-commit reconciliation warning:** if sum of historical stock_movements does not reconcile with `stocks.stock_atas + stock_bawah` opening balance, wizard shows a soft warning at Step 6 review: "Historical stock movements sum ≠ opening balance for 12 SKUs. Continue?" Not blocking — some tenants intentionally reset stock via ADJUSTMENT on go-live date.

---

## Wave 3c — PREMIUM-only advanced templates

Gate: hanya tersedia untuk tenant dengan plan PREMIUM ATAU manual override untuk `modul_multi_warehouse`/`modul_bom_recipe`/`modul_multi_tier_price`. 4 template tambahan.

### 6.13 Warehouses master + stock per warehouse

**Sheet 1 — `warehouses`:**

| Column | Required | Type | Notes |
|---|---|---|---|
| `warehouse_code` | yes | TEXT | UNIQUE per tenant; e.g., `GDG-01`, `GDG-JKT` |
| `name` | yes | TEXT | Display name |
| `address` | no | TEXT | |
| `manager_name` | no | TEXT | |
| `is_default` | no | BOOLEAN | default false; exactly one warehouse per tenant WAJIB is_default=true |
| `is_active` | no | BOOLEAN | default true |

**Sheet 2 — `stock_per_warehouse`:**

| Column | Required | Type | Notes |
|---|---|---|---|
| `sku` | yes | TEXT | FK ke `stocks.sku` (masters harus imported first) |
| `warehouse_code` | yes | TEXT | FK ke Sheet 1 |
| `stock_qty` | yes | INT | ≥ 0 |
| `min_stock` | no | INT | per-warehouse reorder point |
| `batch_number` | conditional | TEXT | required kalau product BATCH-tracked |
| `expiry_date` | conditional | DATE | required kalau batch_number filled |

Commit: INSERT `warehouses`; INSERT `stock_per_warehouse` (new table Wave 3c); UPDATE `stocks.stock_atas`/`stock_bawah` = SUM per warehouse (backward-compat dengan legacy queries).

### 6.14 BOM / Recipes

**Dual-sheet:**

**Sheet 1 — `recipes` header:**

| Column | Required | Type | Notes |
|---|---|---|---|
| `recipe_code` | yes | TEXT | UNIQUE per tenant |
| `output_sku` | yes | TEXT | FK ke `stocks.sku` — produk jadi |
| `output_qty` | yes | NUMERIC | quantity yang dihasilkan per 1 kali produksi |
| `output_unit` | no | TEXT | default = `stocks.unit` |
| `yield_percentage` | no | NUMERIC | default 100; untuk waste tracking |
| `notes` | no | TEXT | |

**Sheet 2 — `recipe_ingredients` lines:**

| Column | Required | Type | Notes |
|---|---|---|---|
| `recipe_code` | yes | TEXT | FK Sheet 1 |
| `ingredient_sku` | yes | TEXT | FK ke `stocks.sku` — bahan baku |
| `qty_used` | yes | NUMERIC | per 1 kali produksi |
| `unit` | no | TEXT | default = `stocks.unit` |
| `is_optional` | no | BOOLEAN | default false |
| `notes` | no | TEXT | e.g., "boleh diganti bahan alternatif" |

Validation: `output_sku` cannot be same as any `ingredient_sku` (no circular BOM); `ingredient_sku` HARUS exist di stocks.

Commit: INSERT `recipes` + `recipe_ingredients` tables.

### 6.15 Multi-tier customer pricing

**Single sheet — `customer_price_tiers`:**

| Column | Required | Type | Notes |
|---|---|---|---|
| `customer_wa` | yes | TEXT | FK ke `customers.wa_number` |
| `sku` | yes | TEXT | FK ke `stocks.sku` |
| `custom_price` | yes | NUMERIC(15,2) | harga khusus untuk customer ini per SKU ini |
| `discount_percentage` | no | NUMERIC | alternatif: kalau diisi, sistem hitung custom_price = price × (1 - discount%) |
| `effective_from` | no | DATE | default = today |
| `effective_to` | no | DATE | NULL = no expiry |

Validation: `custom_price` OR `discount_percentage` (exactly one filled).

Commit: INSERT `customer_price_tier` table (new, Wave 3c). Kasir + Penjualan RPCs check table untuk override default `stocks.price` per customer.

### 6.16 Wave 3c wizard integration

Kalau tenant plan PREMIUM (atau override untuk modul terkait), Step 5 Data Import tampilkan **card tambahan** setelah Wave 3a/3b masters:
- Card 5: 🏭 Multi-warehouse (Sheet 1+2)
- Card 6: 🥧 BOM / Recipes (Sheet 1+2)
- Card 7: 💎 Multi-tier customer pricing (Single sheet)

Total sampai 11 cards (4 master + 4 transactional + 3 PREMIUM) untuk PREMIUM tenant. STARTER/PRO tenant hanya lihat 4 master + 4 transactional (Wave 3c cards di-hide).

Dependency ordering enforced: warehouses HARUS sebelum stock_per_warehouse; recipes HARUS setelah products; customer_price_tiers HARUS setelah customers + products.

---

## 7. Renewal + expiry UX

### 7.1 Super-admin side

- Tenant detail → Plan & Features tab has "Renewal" section.
- Button "Renew subscription" → modal:
  - New `expires_at` (date picker; default = current expires_at + 12 months)
  - Optional new plan (if changing tier)
  - Notes (free text, saved to audit)
- On save → `renew_subscription()` RPC updates `tenant_subscriptions`, logs `RENEW_SUBSCRIPTION` audit event, cascades via trigger to `tenant_settings`.

### 7.2 Attention queue on Home dashboard

Tenants with `grace_expires_at < now() + 45 days` appear in the Home dashboard's "Attention needed" queue with a direct "Renew" link.

### 7.3 Tenant-facing (existing from Phase A)

- `GraceBanner` — amber banner visible in tenant app when `expiry_mode = GRACE` (already in Phase A).
- `ReadonlyBanner` — red banner + write-lockdown when `expiry_mode = READONLY` (already in Phase A).
- No change needed in Phase B; Phase A already handles the tenant-facing UX.

### 7.4 Notification 30 days before expiry

Skip for Phase B. Requires cron/scheduled job; tie to Phase C billing notifications when Stripe/Xendit adds SMS/email flows.

---

## 8. Audit log viewer

Global `/admin/audit` route:

- Filter bar: date range, admin_user, tenant, action type.
- Table columns: Timestamp, Admin, Tenant, Action, Detail (JSONB expanded), IP.
- Actions link to related resource (impersonate_start → tenant detail).
- CSV export button.

Per-tenant audit tab: same table but pre-filtered by tenant_id.

RLS on `platform_admin_audit`: category-P (already set in Phase A); only platform admins can read.

---

## 9. Testing

### 9.1 pgTAP DB-unit

- `_assert_feature_enabled` — raise vs no-raise per feature state
- `create_tenant_atomic` — success, per-step rollback
- `renew_subscription` — audit log written, expires_at updated, sync trigger fires
- Import preview/commit RPCs for each entity type — validation matrix, partial commit semantics
- New RPCs: `send_owner_invite`, `set_feature_overrides`, `suspend_tenant`, `activate_tenant`

### 9.2 Vitest + RTL

- `OnboardingWizard` — per-step draft persistence, validation, submission
- `FeatureToggleGrid` — toggle → override JSONB serialization
- `ImportCard` — status transitions, error highlight
- `<FeatureGate>` — render/redirect logic
- `TenantsList` — filter/sort/pagination

### 9.3 Isolation tests

- Non-admin user cannot call `list_tenants_admin`, `create_tenant_atomic`, etc. — expected P0403.
- Admin can access all tenants; regular tenant users cannot see `import_uploads` from other tenants.
- Feature override for tenant A does not leak to tenant B.

### 9.4 E2E manual smoke

- Onboard a new fake tenant (e.g., `apotek-test`) end-to-end via wizard, confirm all 6 steps, then delete via SQL cleanup.
- Import a small Excel file for each of the 4 entities; check preview accuracy, commit success, undo.
- Impersonate the new tenant; verify features respect plan bundle + overrides.

---

## 10. Rollout

### 10.1 Phased sub-releases (avoid one-big-bang)

**Wave 1 — Read-only admin panel** (~3-5 days)
- AdminHome, TenantsList, TenantDetail (Overview + Users + Audit tabs), AuditLogViewer, PlansManagement read-only.
- No wizard, no write actions except impersonation (already in Phase A).
- Ship + let super-admin explore; safe to deploy since no writes.

**Wave 2 — Onboarding wizard core (no import)** (~5-7 days)
- OnboardingWizard steps 1-4 + 6 (skip step 5 initially).
- `create_tenant_atomic` RPC.
- Owner OTP invite flow.
- Feature entitlement enforcement (Sidebar filter + `<FeatureGate>` + RPC gate).

**Wave 3a — Master data import** (~6-8 days)
- OnboardingWizard step 5 wired for 4 master entities (products, customers+piutang, suppliers+utang, coa_kasbank).
- Preview/commit/undo RPCs for the 4 masters.
- Template Excel files for masters in `public/import-templates/`.
- ImportCard + ImportPreviewTable components.
- Import history tab in tenant detail.
- **After Wave 3a ships: super-admin can onboard tenant #2 with opening balance only. Sufficient for MSMEs migrating from paper/spreadsheet.**

**Wave 3b — Historical transaction import** (~5-7 days)
- 4 transactional entities: sales_invoices, purchase_invoices, journal_entries, stock_movements.
- Dual-sheet Excel parsing (header + lines) for sales/purchase/journal.
- `vosi.import_mode` guard to bypass GL auto-post + stock-movement auto-generation triggers.
- Dependency-order enforcement in wizard (masters must validate before transactionals unlock).
- Post-commit reconciliation checks (stock movement sum vs opening balance).
- **Ship as separate PR after Wave 3a stabilizes** — reduces blast radius.

**Wave 3c — PREMIUM-only advanced templates** (~5-7 days)
- 3 templates: warehouses+stock_per_warehouse, recipes+recipe_ingredients (BOM), customer_price_tiers.
- Gate: hanya tenant PREMIUM ATAU override untuk `modul_multi_warehouse`/`modul_bom_recipe`/`modul_multi_tier_price`.
- New tables `warehouses` (if not exists), `stock_per_warehouse`, `recipes`, `recipe_ingredients`, `customer_price_tier`.
- Wizard integration: tampilkan 3 card tambahan setelah Wave 3a/3b masters (hanya PREMIUM tenant).
- **Ship after Wave 3b** — dependencies on masters + transactionals.

**Wave 4a — Renewal + polish** (~2-3 days)
- Renewal dialog + `renew_subscription` RPC.
- Attention queue on Home.
- Suspend / Activate actions.
- Plans management full edit (currently read-only in Wave 1; super_admin only via §14b guard).

**Wave 4c — Owner welcome wizard** (~3-4 days)
- Extend `tenant_users` dengan `first_login_wizard_completed_at` + `first_login_wizard_progress` JSONB.
- 3 RPCs: `save_wizard_progress`, `complete_wizard`, `reset_wizard`.
- `<OwnerWelcomeWizard />` overlay component dengan dynamic slide list per active modules.
- 3 slide templates: welcome / feature-with-preview / final-with-checklist.
- Copy library per 13 modul (heading + subtitle + bullets + tip).
- Menu Pengaturan → "Tour ulang" trigger.
- **Ship parallel dengan Wave 4a atau 4b** — tenant-scoped, tidak block waves lain.

**Wave 4b — Multi-admin management** (~3-4 days)
- Extend `platform_admins` dengan `role` + `status` + invite metadata columns.
- Auth Hook adds `admin_role` JWT claim.
- New RPCs: `invite_admin`, `list_admins`, `update_admin_role`, `remove_admin`, `suspend_admin`, `resend_admin_invite`. Semua super_admin-gated.
- `_assert_super_admin_from_jwt()` helper + LAST_SUPER_ADMIN invariant.
- New route `/admin/team` + AdminTeamScreen (table + invite modal + role edit + suspend/remove).
- Sidebar section "Sistem" restructure: 🛡️ Panel admin · 💰 Pendapatan · ⚙️ Pengaturan · ❓ Bantuan.
- FE `useAdminRole()` hook + `<SuperAdminOnly>` component gate.
- Empty state hero saat cuma 1 admin.
- **Order**: ship after Wave 4a. Founder pakai Wave 4b setelah ada kebutuhan delegasi (bisa 3-6 bulan post-launch).

**Wave 5 — Payment tracking + Revenue dashboard** (~5-7 days)
- Extend plans: `price_annual` column + STARTER/PRO/PREMIUM default values.
- New table `tenant_payments` + audit action codes RECORD_PAYMENT etc.
- New Supabase Storage bucket `payment-proofs` (5MB max, JPG/PNG/PDF).
- New RPCs: `record_payment`, `list_payments`, `get_revenue_stats`, `generate_payment_proof_signed_url`.
- UI: onboarding Step 6 "Pembayaran awal" panel + renewal modal payment field + tenant detail Pembayaran tab (7th tab).
- New route `/admin/revenue` — AdminRevenue screen (4 KPI + per-plan breakdown + 12-month trend + top 10 tenants).
- Coverage status derivation (LUNAS/DP_60/DP_30/OVERDUE/UNPAID) tampil di TenantsList kolom baru + Overview panel + Attention queue.

Total: ~34-47 dev days = ~7-10 weeks calendar (Wave 3c + Wave 5 tambahan scope).

### 10.3 Rollback plan per wave

Every wave ships behind a `--no-traffic` tagged Cloud Run URL; smoke-test on the tag before promoting.

| Wave | Rollback trigger | Rollback procedure |
|---|---|---|
| Wave 1 | Admin panel crashes on load | Revert Cloud Run to previous revision (immediate); no DB rollback needed (read-only wave). |
| Wave 2 | `create_tenant_atomic` corrupts partial tenant | Revert Cloud Run + DELETE stray tenant row via SQL manually (rare — transaction should have rolled back). |
| Wave 3a | Import commits wrong rows into master tables | Use `undo_import(upload_id)` (24h window) OR manual SQL DELETE using `import_uploads.committed_row_ids` JSONB. |
| Wave 3b | Transactional import corrupts orders/purchase/GL | Same undo path; additionally, `vosi.import_mode` guard means auto-generated GL was skipped, so cleanup is scoped to the imported rows only. Manual DELETE via committed_row_ids for stale-window cases. |
| Wave 4 | Renewal dialog changes wrong tenant | `platform_admin_audit` records the RPC call; reverse via manual SQL UPDATE using the audit event's `detail_json`. |

**Golden rule:** every write RPC in Phase B writes an audit row BEFORE the business mutation. If cleanup is needed, the audit row tells us what to undo.

### 10.2 Deployment cadence

- Waves 1-2: single-tenant safe (Garindo only, no real tenant #2 yet).
- Wave 3: sufficient to onboard tenant #2 with real data.
- Wave 4: needed before first tenant approaches expiry (i.e., ~11 months after tenant #2 onboarding at earliest).

Each wave: separate PR + migration + Cloud Run deploy with `--no-traffic` tagged URL smoke → promote.

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **`create_tenant_atomic` transaction too long** if import step handles thousands of rows | Import rows go through `import_uploads` staging first (already validated); atomic commit just moves pre-validated data. Split large imports into chunks if row count > 5k. |
| **Excel parsing bugs** — locale-specific number/date formats (Indonesian: `1.000,50` vs `1,000.50`) | Use SheetJS with explicit `raw:false` to get formatted strings; parse numerics via regex handling both formats. Add pgTAP test cases with Indonesian locale data. |
| **Owner OTP email delayed or spam-filtered** | Show clear "Resend invite" button in tenant detail Users tab. Log every send attempt in audit. |
| **Feature override rules unclear to owners** | Tooltip on each feature toggle explains: "Aktif di plan X, di-override manual jadi Y". |
| **Undo import after 24h impossible** | Modal warning at import time: "Undo hanya tersedia 24 jam. Setelah itu, delete manual via SQL." — set expectation. |
| **Sidebar features disappearing after plan downgrade** | **Chosen approach: stale-until-next-login.** FE reads `useFeature()` from current JWT claims; JWT refresh happens on Supabase's own schedule (~1 hour). After a plan change, connected owner keeps old features until their session refreshes. RPC-level gate (`_assert_feature_enabled`) still catches writes at request time — no data-integrity risk. Realtime broadcast to force `refreshSession()` was considered but not adopted for Phase B (adds Supabase Realtime dep + FE listener plumbing; downgrade risk is low since super-admin controls plans). Reconsider in Phase C if MSMEs complain. |
| **Massive Excel upload (>50k rows) crashes browser** | Client-side row limit at 10k per file; error toast if exceeded. Suggest splitting into multiple uploads. |
| **Slug collision race** on concurrent creates | UNIQUE constraint on `tenants.slug`; `create_tenant_atomic` catches unique_violation → user-friendly error. |

---

## 12. Success metrics (post-ship)

- Super-admin can onboard a fresh tenant end-to-end via wizard in < 10 minutes (excluding Excel data prep).
- Zero cross-tenant data leaks from Phase B code (isolation tests green).
- Feature toggle changes reflected in tenant JWT at the next natural Supabase session refresh (~1 hour) or on next login; RPC writes gated by `_assert_feature_enabled` for immediate enforcement regardless of stale FE JWT.
- Import validation catches 100% of common Excel errors (missing required fields, format mismatches, referential integrity) — verified by curated test dataset.
- Home dashboard's "Attention needed" queue surfaces expiring subs (45d window) with zero misses.

---

## 13. Deferrals & backlog

**Phase C** (billing / commerce layer):
- Custom domain per tenant + DNS verification + wildcard SSL
- Stripe / Xendit integration + automated renewal invoicing
- Notification 30d before expiry (email + SMS)
- Self-serve tenant signup
- Per-tenant activity telemetry populator (`tenant_activity_daily`)
- MRR / churn / expansion dashboards

**Backlog carried from Phase A audit:**
- Category-P + Category-A isolation test coverage (I3)
- App.tsx legacy `/t/garindo/*` hardcode (M1)
- AdminShell UX polish — SPA nav vs full reload (M2)
- Backend Go JWT audit
- Retro-fix Phase A migration file 2 in repo (DONE: commit `41b98b2`)
- Auth Hook Dashboard registration robustness (add Management API verification post-registration to runbook)

---

## 14. Design system — VOSI Design System v1.0

**Source of truth:** [`docs/VOSI-Design-System.md`](../../VOSI-Design-System.md) — versi 1.0.

Phase B admin panel is the VOSI parent-brand surface (semut mascot, navy + gold). Follow the token catalog in the source doc verbatim; this section only calls out admin-panel-specific composition rules on top of that catalog.

### 14.1 Token summary (verbatim from VOSI-Design-System.md §3, §5)

**Inti (Core):**
- `--vosi-navy` = `#0B2545` — latar utama, teks judul, elemen struktural
- `--vosi-gold` = `#F9B233` — sorotan, tombol utama (CTA), ikon, aksen

**Netral (Neutral):**
- `--vosi-cream` = `#FAF7F0` — latar terang hangat (kartu, section)
- `--vosi-slate` = `#5A6472` — teks isi di latar terang
- `--vosi-muted` = `#9DB2CE` — teks sekunder di latar navy
- `--vosi-surface` = `#ECEEF1` — latar aplikasi / abu netral
- `--vosi-ink` = `#14161B` — teks paling gelap (mono)

**Fungsional (Semantic):**
- `--vosi-success` = `#1F8A5B` (untung, stok aman)
- `--vosi-danger` = `#C0392B` (gagal, hapus, stok habis)
- `--vosi-info` = `#2A6FDB` (informasi, edukasi)
- `--vosi-special` = `#7C5CBF` (story / highlight khusus)

**Fondasi:**
- Grid: 4px base; spacing 4/8/12/16/20/24/32/44/64
- Radius: sm `12px` · card `18-22px` · pill `100px`
- Border 1px `#E0E3E8` (terang) · `rgba(255,255,255,0.12)` (di navy)
- Shadow card: `0 16px 34px rgba(11,37,69,0.10)`
- Shadow hero: `0 26px 60px rgba(20,20,30,0.16)`
- Icon stroke: 1.8px rounded (lucide-react configured accordingly)

### 14.2 Typography (verbatim from VOSI-Design-System.md §4)

- **Sans (Display / Heading / Body):** `Plus Jakarta Sans` weights 400-800. Judul 800 dengan `letter-spacing: -0.02em`. Body 500.
- **Mono (Label / Angka / Kode):** `JetBrains Mono` weights 400-700. Label uppercase dengan `letter-spacing: 0.1em`.

Load via Google Fonts in `index.html`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
```

Tailwind config extension (`tailwind.config.js`):
```js
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
  },
}
```

### 14.3 Rule 60/30/10

Every admin screen must follow VOSI's 60/30/10:
- **60%** — Navy `#0B2545` OR Cream `#FAF7F0` dominant
- **30%** — Supporting neutral (Surface `#ECEEF1`, Slate `#5A6472`, Muted `#9DB2CE`)
- **10%** — Gold `#F9B233` accent — hanya 1 fokus per layar (CTA utama, badge admin, or 1 highlight)

Reviewers reject screens with more than one Gold focal point, Gold blocks of long text, or accent colors outside the VOSI token catalog.

**Contrast audit** (per VOSI §7 aturan minimal 4.5:1 WCAG AA):
- White on navy `#0B2545`: **14.7:1** ✓ AAA
- Navy on gold `#F9B233`: **9.4:1** ✓ AAA
- Navy on white: **16.2:1** ✓ AAA
- Navy on cream `#FAF7F0`: **15.1:1** ✓ AAA
- Slate on cream: **5.6:1** ✓ AA
- Gold on navy (untuk aksen kecil / label): **9.4:1** ✓ AAA — **hindari gold pada teks kecil di atas putih** (kontras jatuh)

### 14.4 Typography scale (verbatim from VOSI §4)

| Level | Ukuran | Bobot | Notes |
|---|---|---|---|
| Display | 48-72px | 800 | Hero landing only |
| H1 | 34-40px | 800 | Page title (`text-4xl font-extrabold tracking-tight text-vosi-navy`) |
| H2 | 26-30px | 700 | Section header (`text-3xl font-bold text-vosi-navy`) |
| Body L | 18-20px | 500 | Lead paragraphs |
| Body | 16px | 500 | Standard body (`text-base font-medium text-vosi-slate`) |
| Label mono | 13-15px | 700 uppercase tracking `0.1em` | `font-mono text-sm font-bold uppercase tracking-wider` |

Angka + mata uang: SELALU `JetBrains Mono` (`font-mono`). Ini mandatory VOSI aturan.

### 14.5 Component patterns (verbatim from VOSI §6)

**Primary button — Tombol utama:**
```
bg-vosi-gold text-vosi-navy font-extrabold rounded-full
px-6 py-3.5 (14x26px per VOSI §6)
hover:brightness-95 transition
```

**Secondary button:**
```
bg-vosi-navy text-white font-bold rounded-full
px-6 py-3.5
hover:brightness-110 transition
```

**Ghost button:**
```
bg-transparent text-vosi-navy font-bold rounded-full
border-[1.5px] border-[#C9CCD2]
px-6 py-3.5
hover:border-vosi-navy transition
```

**Success/Danger form action button (radius 12px per VOSI §6):**
```
Success: bg-vosi-success text-white rounded-xl px-5 py-3 font-bold
Danger: bg-[#FBE9E6] text-vosi-danger rounded-xl px-5 py-3 font-bold
```

**Badge / Pill:**
```
Fitur label: bg-vosi-gold text-vosi-navy font-mono uppercase text-sm rounded-full px-3 py-1
Status aktif: bg-vosi-success/10 text-vosi-success rounded-full px-3 py-1 (dot hijau prefix)
Status bahaya: bg-[#FBE9E6] text-vosi-danger rounded-full px-3 py-1
```

**Input field (VOSI §6):**
```
Default: bg-white border-[1.5px] border-[#D3D8E0] rounded-xl px-4 py-3.5 text-vosi-navy
Focus: border-vosi-gold ring-0
```

**Card container:**
```
Terang: bg-white border border-[#E0E3E8] rounded-[20px] p-8 shadow-[0_16px_34px_rgba(11,37,69,0.10)]
Gelap (hero): bg-vosi-navy text-white rounded-[20px] p-8 accent Gold
Statistik: chip gold lembut + label (mono uppercase) + angka mono besar + delta status
```

**Table (TenantsList, AuditLogViewer):**
```
Container: bg-white rounded-[20px] border border-[#E0E3E8] overflow-hidden
        shadow-[0_16px_34px_rgba(11,37,69,0.10)]
Header row: bg-vosi-cream border-b border-[#E0E3E8]
           font-mono text-sm font-bold uppercase tracking-wider text-vosi-navy
Body cell: text-base font-medium text-vosi-slate px-5 py-3 border-t border-[#E0E3E8]
Row hover: hover:bg-vosi-cream/50 transition
```

**Empty state / Loading:**
- Empty: card container with muted text (`text-vosi-muted`) center-aligned + optional gold CTA
- Loading: skeleton rectangles `bg-vosi-surface animate-pulse rounded-xl`

### 14.6 Iconography (VOSI §7)

- **Library:** `lucide-react` — configured with `strokeWidth={1.8}`, `strokeLinecap="round"` (matches VOSI ikon aturan)
- **Color:** Gold di navy surface, Navy di terang surface
- **Sizing:** `w-4 h-4` (inline text), `w-5 h-5` (default UI), `w-6 h-6` (KPI card corner)
- **Brand mascot only:** semut dari `vosi-icon-gold.png` untuk logo lockup — bukan lucide, bukan emoji
- **Hindari:** stok foto generik, gradien norak, drop-shadow tebal (VOSI §7 don't list)

### 14.7 Motion

- **Hover lift on KPI cards:** `hover:-translate-y-1 transition-transform duration-300`
- **Button hover:** `hover:brightness-95` (primary gold) atau `hover:brightness-110` (secondary navy)
- **Card shadow reveal:** `hover:shadow-[0_26px_60px_rgba(20,20,30,0.16)] transition-shadow`
- **No large scroll animations** — subtle only, per VOSI tone (meyakinkan tidak menggurui)

### 14.8 Nada bicara / Tone of voice (VOSI §1)

**Bahasa: WAJIB Bahasa Indonesia untuk SEMUA copy user-facing di admin panel.** Admin operator adalah orang Indonesia yang tidak bisa Bahasa Inggris. Tidak boleh ada label English kecuali:
- Nama teknis kode (`modul_kasir`, `create_tenant_atomic`) — code identifier, tidak diterjemahkan
- Kode error / audit action code (`P0403`, `IMPERSONATE_START`) — nama konstan
- Nama brand asli (VOSI, PRO, PREMIUM, STARTER, Google) — trademark
- URL segment (`/admin`, `/tenants`) — routing

Copy di admin panel MUST follow VOSI tone:
- **Akrab & membumi** — "juragan", "toko kamu", "daftarkan tenant baru" (bukan "provision new tenant" atau "onboard new tenant")
- **Meyakinkan tidak menggurui** — "PRO cocok buat toko kamu" (bukan "Anda harus upgrade")
- **Teknis seperlunya** — istilah POS, stok, laporan, piutang OK; jargon dev (RPC, JWT, RLS) HANYA di audit/debug view
- **Ringkas** — kalimat pendek, satu ide per kalimat

**Terjemahan wajib** (glossary sebagai kontrak reviewer):

| English | Bahasa Indonesia |
|---|---|
| Impersonate / Impersonation | **Masuk sebagai owner** (button) / **Kamu sedang login sebagai owner &lt;slug&gt;** (banner) — bukan "impersonasi" karena tidak umum di Bahasa Indonesia MSME |
| Transaction (dari usage tracking) | **Invoice** — bilang "invoice" karena tenant Indonesia terbiasa dengan kata ini (dari kasir/tempo). Bukan "transaksi" yang terlalu ambigu. |
| Daily average | **Rata-rata invoice/hari** — jelaskan unit yang di-average |
| Preview | **Isi kamu sejauh ini** (di wizard) / **Pratinjau** (untuk data preview seperti Excel row check). Tidak pakai istilah tunggal "preview". |
| Home / Dashboard | Beranda / Dashboard |
| Tenants | Tenant |
| Plans | Paket |
| Users | Pengguna |
| Settings | Pengaturan |
| Audit log | Log Aktivitas / Riwayat Audit |
| Import queue | Antrian Impor |
| Import history | Riwayat Impor |
| Onboarding | Pendaftaran |
| Renew | Perpanjang |
| Suspend | Suspend (borrowed) |
| Resume | Lanjutkan |
| Review | Tinjau |
| Search | Cari |
| Cancel | Batal |
| Save | Simpan |
| Update / Change | Ubah |
| Confirm | Konfirmasi |
| Add | Tambah |
| Remove | Hapus |
| Actions | Aksi |
| Expires / Expiry | Kadaluarsa |
| Active | Aktif |
| Committed | Tersimpan |
| Partial | Sebagian |
| Validated | Tervalidasi |
| Failed | Gagal |
| Undo | Batalkan |
| Abandon | Buang |
| Export CSV | Ekspor CSV |
| Sign-in / Login | Masuk |
| Continue with Google | Lanjutkan dengan Google |
| Overview | Ringkasan |
| Users | Pengguna |
| Billing | Penagihan |
| Loading | Memuat |
| Yesterday | Kemarin |
| N hours ago | N jam lalu |
| N days ago | N hari lalu |
| Address | Alamat |
| Warehouses | Gudang |
| Customers | Pelanggan |
| Suppliers | Pemasok |

Reviewers reject copy yang: menampilkan English di user-facing surface, pakai "Anda" formal, pakai jargon dev di user-facing surface, atau lebih dari 2 kalimat di CTA-adjacent copy.

### 14.9 Mockup vs implementation

The HTML mockups in `.superpowers/brainstorm/*/content/` use inline styles + Google Fonts CDN as visual approximations. Production implementation must:
- Load fonts via `<link>` in `index.html` (not `@import`)
- Use Tailwind config extension for VOSI tokens (see §14.2)
- Reject any color outside the VOSI token catalog
- Reject any `bg-blue-*` / `bg-emerald-*` / `bg-amber-*` / `bg-rose-*` — use `bg-vosi-*` semantic instead

Every reviewer subagent should flag deviations.

### 14.10 Branding assets & string

**Logo assets** (`docs/logo-png-final/`):
- `vosi-logo-horizontal.png` — full horizontal wordmark (dark on light — use on cream/white surfaces)
- `vosi-logo-horizontal-white.png` — white variant (use on navy hero panels)
- `vosi-icon.png` — icon only (navy variant, use on light)
- `vosi-icon-gold.png` — gold-circle ant icon (use on navy or as brand accent)

Serve via `/public/logo/` in the frontend build. Do NOT recolor via CSS filters — use the correct pre-built variant per surface.

**Strings:**
- Admin panel top-bar brand: `VOSI` wordmark + subtitle `PLATFORM CONSOLE` in gold small-caps
- Tagline strapline (VOSI parent brand): `TOKO RAPI, UNTUNG JELAS` — reuse anywhere emphasis needed
- Tenant-facing app: keeps existing per-tenant `storeName` in headers (no change from Phase A)
- Footer (admin surface): `© 2026 VOSI · Restricted access`
- Footer (tenant surface): unchanged from Phase A

**Icon convention:**
- Brand accent icon: use ant mascot (from `vosi-icon-gold.png`) — the sole VOSI mascot
- UI icons: `lucide-react` for all functional icons (Shield, ArrowRight, Search, etc.)
- No shields, no emoji in production admin panel

### 14.11 Admin sign-in page (`/admin/login`)

Reuses the existing tenant `AuthScreen.tsx` split-screen skeleton (left branding + right form card), but re-skinned with the VOSI parent brand (navy + gold) instead of the tenant's emerald. This makes the admin surface visually distinct from every tenant sign-in variant.

**Layout:**
- Desktop: 50/50 split; mobile stacks vertically
- Left panel: deep navy gradient `bg-gradient-to-br from-[#0d1f42] to-[#0a1730]`, decorative gold-tinted blurred orbs, fine dot-pattern overlay
- Right panel: cream `bg-[#faf8f2]`, decorative gold + navy tinted blurred orbs
- Form card: `bg-white rounded-3xl max-w-[360px] p-8 shadow-2xl shadow-[#0d1f42]/8`

**Left branding panel content (top to bottom):**
1. Corner badge (absolute top-right): gold pill `bg-[#f5b83d] text-[#0d1f42] rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[2px]` reading `Admin Portal`
2. Logo lockup: 56px gold circle with VOSI ant icon (use `vosi-icon-gold.png`) + wordmark `VOSI` in white 28px extrabold + strapline `TOKO RAPI, UNTUNG JELAS` in gold 9px tracked
3. Big tagline `text-2xl font-extrabold text-white` — "Panel admin untuk kelola tenant VOSI." (bukan super-admin karena admin biasa juga login lewat sini)
4. Sub-copy: "Onboarding wizard, impersonation, audit trail, plans & feature entitlement — satu tempat."
5. Feature bullets with gold ✓ marks: onboard wizard + Excel migration, impersonation, audit trail
6. Bottom-anchored footer: `© 2026 VOSI · Restricted access`

**Right form card content:**
1. Gold accent stripe at top of card `absolute top-0 left-7 right-7 h-1 bg-gradient-to-r from-[#f5b83d] to-[#d99b21] rounded-b`
2. Title `Platform Administrator` in navy `text-[18px] font-black`
3. Subtitle `Masuk dengan email admin yang terdaftar` in slate-500
4. Uppercase label `EMAIL ADMIN` in navy 10px tracked
5. Email input pill: `bg-[#f5f4ee] rounded-full border border-[#eae7dc] px-4 py-3 pl-10` with ✉ icon prefix
6. Primary CTA: `bg-gradient-to-br from-[#f5b83d] to-[#d99b21] text-[#0d1f42] rounded-full py-3 text-xs font-black uppercase tracking-wider shadow-lg shadow-[#d99b21]/35` — "Kirim OTP Login →"
7. OR divider (hairline)
8. Secondary Google button: `bg-white border border-[#e5e2d5] rounded-full text-[#0d1f42] font-bold` — "Continue with Google"
9. Invite-only notice: `bg-[#fdf5db] border border-[#f5b83d] rounded-2xl p-3` with 🔒 icon (kept as functional emoji here) + copy: "Bukan admin? Owner tenant login di `vosi.id/<nama-usaha>/login` — akses ke `/admin` hanya untuk yang di-invite."
10. Fine-print post-login hint: "Post-login: platform_admin → `/admin`"

**Admin-vs-tenant differentiators:**
- Palette: navy + gold (VOSI parent) — tenant sign-in uses tenant accent (Garindo = emerald)
- Corner tag: gold "Admin Portal" pill (tenant sign-in has no equivalent)
- Card accent stripe: gold (tenant is emerald or per-tenant)
- Title: `Platform Administrator` (tenant: `Selamat Datang Kembali`)
- **No sign-up form** — admin invited only; explicit notice routes tenant owners to `vosi.id/<slug>/login`
- Footer copy: "Restricted access" (tenant: `© 2026 TechSaaS System`)

**Auth methods:** email OTP primary, Google OAuth secondary. No password.

**Component structure:**
- Modify existing `AuthScreen.tsx` to accept a `variant?: 'tenant' | 'admin'` prop (default `tenant` preserves Phase A behavior)
- All palette values + copy strings + optional-signup gating driven by the variant
- New route `/admin/login` renders `<AuthScreen variant="admin" />`; existing `/login` unchanged

**Contrast check per admin variant:** every combo audited to WCAG AA minimum, most AAA (see §14.1 table). Reviewers reject any variant that produces white-on-white or navy-on-navy collisions.

**Post-login routing:** platform_admin → `/admin` (home dashboard); non-admin who somehow logs in via `/admin/login` → toast "Halaman khusus admin" + redirect to `/dashboard` (`AdminRouteGuard` from Wave 1 handles this).

---

## 14b. Multi-admin management (Wave 4b)

Phase A `platform_admins` currently flat — semua admin sama access. Founder butuh **role hierarchy** untuk delegasi tugas administrasi (mis. hire operations staff) tanpa memberikan akses ke plan editing / admin management yang lebih sensitif.

### 14b.1 Data model

**Extend `platform_admins`:**

```sql
ALTER TABLE public.platform_admins
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin'
    CHECK (role IN ('super_admin', 'admin')),
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('PENDING_INVITE','ACTIVE','SUSPENDED'));

-- Backfill founder as super_admin dengan semua permissions ON
UPDATE public.platform_admins
SET role = 'super_admin',
    permissions = jsonb_build_object(
      'can_manage_tenants', true,
      'can_impersonate', true,
      'can_renew_subscription', true,
      'can_suspend_tenant', true,
      'can_record_payment', true,
      'can_import_data', true,
      'can_view_audit', true,
      'can_view_revenue', true,
      'can_view_plans', true
    )
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'tonywei.office@gmail.com');
```

**Permissions catalog** (9 keys, semua boolean):

| Key | Menu / Aksi yang di-gate |
|---|---|
| `can_manage_tenants` | Menu 🏢 Tenant + onboarding wizard baru |
| `can_impersonate` | Tombol "Masuk sebagai owner" di TenantsList + tenant detail |
| `can_renew_subscription` | Tombol "Perpanjang" + modal Perpanjang |
| `can_suspend_tenant` | Tombol "Suspend / Activate" |
| `can_record_payment` | Tombol "Catat pembayaran" (ad-hoc + di modal Perpanjang section 💰) |
| `can_import_data` | Menu 📥 Antrian Impor + card impor di onboarding Step 5 |
| `can_view_audit` | Menu 📊 Log Aktivitas + tab Riwayat audit di tenant detail |
| `can_view_revenue` | Menu 💰 **Pendapatan VOSI** + tab Pembayaran di tenant detail |
| `can_view_plans` | Menu 💳 Paket (read-only) — edit tetap super_admin only |

**Default template saat undang admin baru:** semua permissions = `true` KECUALI `can_view_revenue` (default OFF karena finance-sensitive). Super_admin bisa toggle sebelum kirim undangan.

**Super_admin selalu bypass permissions check** (semua treated sebagai `true` regardless of JSONB content). Permissions hanya berlaku untuk role='admin'.

**Auth Hook extension** (Phase A `custom_access_token_hook`):

```sql
IF v_is_platform_admin THEN
  SELECT role, permissions INTO v_admin_role, v_admin_perms
    FROM public.platform_admins WHERE user_id = v_user_id;
  event.claims := jsonb_set(event.claims, '{admin_role}', to_jsonb(v_admin_role));
  event.claims := jsonb_set(event.claims, '{admin_permissions}', v_admin_perms);
END IF;
```

FE reads `admin_role` + `admin_permissions` from JWT untuk gate sidebar + button visibility.

### 14b.2 Permission matrix

| Aksi | super_admin | admin |
|---|---|---|
| Onboard tenant baru | ✓ | ✓ |
| Impersonate tenant | ✓ | ✓ |
| Perpanjang langganan | ✓ | ✓ |
| Ubah paket tenant | ✓ | ✓ |
| Suspend / aktifkan tenant | ✓ | ✓ |
| Catat pembayaran | ✓ | ✓ |
| Lihat log aktivitas / audit | ✓ | ✓ |
| Impor data (semua kartu) | ✓ | ✓ |
| **Edit definisi paket** (harga, feature bundle) | ✓ | ✗ |
| **Undang / hapus admin lain** | ✓ | ✗ |
| **Ubah role admin lain** | ✓ | ✗ |

Guard di RPC level: `_assert_super_admin_from_jwt()` (new helper) untuk 3 aksi terakhir. Kalau admin biasa call → P0403 `SUPER_ADMIN_REQUIRED`.

**Safety invariant:** system enforce minimal 1 super_admin harus ada. `remove_admin()` + `update_admin_role()` reject kalau target adalah super_admin terakhir → P0409 `LAST_SUPER_ADMIN`.

### 14b.3 New RPCs

- `invite_admin(p_email text, p_role text, p_notes text) → jsonb` — super_admin only. Create auth.users if missing (via `auth.admin_create_user_by_email`), INSERT platform_admins dengan status=`PENDING_INVITE`, trigger OTP magic link. Returns `{admin_user_id, magic_link_url}`.
- `list_admins() → setof jsonb` — any platform admin. Returns list dengan user_id, email, full_name, role, status, last_sign_in_at, invited_by (email), invited_at.
- `update_admin_role(p_user_id uuid, p_new_role text) → jsonb` — super_admin only. Enforce LAST_SUPER_ADMIN check.
- `remove_admin(p_user_id uuid) → jsonb` — super_admin only. Enforce LAST_SUPER_ADMIN check. Actually DELETE from platform_admins (revoke access) — auth.users tetap ada.
- `suspend_admin(p_user_id uuid) → jsonb` — super_admin only. Set status=SUSPENDED, mempertahankan record untuk audit.
- `resend_admin_invite(p_user_id uuid) → jsonb` — super_admin only. Trigger ulang OTP magic link untuk admin dengan status=PENDING_INVITE.

Semua audit-logged dengan action baru: `INVITE_ADMIN`, `REMOVE_ADMIN`, `CHANGE_ADMIN_ROLE`, `SUSPEND_ADMIN`, `RESEND_ADMIN_INVITE`.

### 14b.4 UI: Admin Team Panel

**New route** `/admin/team`

**Sidebar update** — section "Sistem" restructure:

```
Sistem
  🛡️ Panel admin           ← NEW route /admin/team
  💰 Pendapatan            ← Wave 5 /admin/revenue
  ⚙️ Pengaturan
  ❓ Bantuan
```

**AdminTeamScreen content:**

- Page header: "Panel admin (N)" · button "+ Undang admin baru" (super_admin only, disabled dengan tooltip untuk admin biasa)
- Table columns: Nama · Email · Role (badge: `super_admin` gold, `admin` slate) · Status (Active/Pending Invite/Suspended) · Login terakhir · Ditambahkan oleh · Aksi
- Actions per row (super_admin only): 
  - Kalau PENDING_INVITE: **Kirim ulang undangan**
  - Kalau ACTIVE: **Ubah role**, **Suspend**, **Hapus**
  - Cannot act on self (kecuali kalau ada > 1 super_admin, super_admin bisa demote diri sendiri)
- Notice info: "Minimal harus ada 1 super admin di sistem. Kalau kamu satu-satunya, kamu tidak bisa demote/hapus diri sendiri sampai ada super_admin lain."

**Invite modal:**

- Email input
- Role radio: super_admin / admin (default admin)
- Notes textarea (optional): "Contoh: Adik saya yang bantu kelola tenant harian"
- Button: "Kirim undangan OTP"
- On success: toast "Undangan terkirim ke <email>. Mereka akan dapat magic link untuk login." + redirect ke list

**Empty state:**

Kalau tenant admin count = 1 (hanya founder), show hero card:

> 🛡️ Cuma kamu sendiri di sini.
>
> Undang admin tambahan buat delegasi kerjaan administrasi (onboarding, impersonation, catat pembayaran). Founder tetap punya kontrol final via role super_admin.

### 14b.5 Frontend guard

`useAdminRole()` hook baru (mirip existing `useTenant()`):

```typescript
export function useAdminRole(): 'super_admin' | 'admin' | null {
  // Read JWT claim 'admin_role'
}

// Component gate
export function SuperAdminOnly({ children }: { children: ReactNode }) {
  const role = useAdminRole();
  if (role !== 'super_admin') return null;
  return <>{children}</>;
}
```

Wrap PlanManagement edit button + AdminTeamPanel invite button + role-change dropdowns dengan `<SuperAdminOnly>`. Sisanya admin tetap bisa akses.

Backend enforcement adalah kebenaran; FE guard hanya UX (biar tidak nunjukin tombol yang admin biasa tidak bisa klik).

---

## 14c. Owner welcome wizard (Wave 4c BARU)

Setelah super_admin onboard tenant + owner klik magic link + first login, owner butuh guided introduction. Tanpa ini, owner buka aplikasi + kebingungan menu apa aja yang aktif + bagaimana pakai. Wizard 5-8 slide dinamis per paket kasih upfront explanation.

### 14c.1 Data model

**Extend `tenant_users`:**

```sql
ALTER TABLE public.tenant_users
  ADD COLUMN IF NOT EXISTS first_login_wizard_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_login_wizard_progress JSONB DEFAULT '{}'::jsonb;
-- progress JSONB: { "last_slide_seen": 3, "started_at": "2026-07-04T09:00", "skipped_at": null }
```

**Trigger check:** kalau `role='owner' AND first_login_wizard_completed_at IS NULL` → tampilkan wizard overlay full-page saat page pertama tenant app load.

### 14c.2 Wizard slide composition

**Dinamis per paket** — hanya modul yang aktif yang jadi slide:

| Paket | Modul aktif | Total slide (Welcome + Selesai + N modul) |
|---|---|---|
| STARTER | 3 modul | 5 slide |
| PRO | 9 modul | 11 slide (bisa di-group jadi 8 dengan bundle diskon×3 jadi 1 slide) |
| PREMIUM | 13 modul | 15 slide (bisa di-group jadi 11) |

**Recommended grouping** untuk PRO (target 8 slide):
1. Welcome + tenant recap
2. Kasir 101 (+ diskon_kasir bundled)
3. Piutang tempo (+ diskon_penjualan bundled)
4. Pembelian (+ diskon_tagihan bundled)
5. Stok / Gudang
6. Akuntansi + Laporan (bundle)
7. WhatsApp AI + Cari by foto (integrations bundle)
8. Selesai + Quick start

**Template per feature slide** (2-column grid):
- **Kiri**: badge modul + heading (34px) + subtitle (14px, 2 kalimat) + 3-4 bullet manfaat + info card "Coba nanti"
- **Kanan**: mock preview UI di gradient card (rounded-3xl) untuk visual anchor
- **Bottom**: nav Sebelumnya · progress "LANGKAH N DARI M" · Selanjutnya (button emerald)

**Welcome slide (slide 1):**
- Emoji illustration 👋 di gradient emerald circle 96px
- Tagline "Halo Juragan" (mono uppercase strapline)
- Heading "Selamat datang di [Nama tenant]! 🎉"
- Body: tenant data recap ("N produk, N pelanggan, N akun COA sudah siap")
- Info card: "8 langkah singkat, total ~3 menit. Bisa di-skip"
- Buttons: "Skip untuk sekarang" (ghost) + "Mulai tour singkat →" (emerald pill)

**Final slide (slide N):**
- Big 🎉 emoji di gradient emerald 120px circle
- Heading "Selesai! Kamu siap jualan."
- Quick start checklist card (4 tasks):
  1. Buat transaksi kasir pertama (Buka Kasir →)
  2. Cek stok yang di-import (Buka Gudang →)
  3. Setup WhatsApp AI notif (Buka Pengaturan →)
  4. Lihat laporan harian pertama (Buka Laporan →)
- Support notice: "Butuh bantuan? Klik ? di kanan atas atau tonton video tutorial"
- CTA final: "✓ Sudah paham, mulai jualan →" (big emerald pill)

### 14c.3 Dismiss behavior

**Skip mid-wizard** → save progress `first_login_wizard_progress.skipped_at`, wizard tampil lagi di next login dari slide 1 (owner start over). `first_login_wizard_completed_at` tetap NULL.

**Complete + klik "Sudah paham, mulai"** → `first_login_wizard_completed_at = NOW()`, wizard dismiss forever.

**Manual re-tour**: Menu Pengaturan → "Tour ulang" set `first_login_wizard_completed_at = NULL` + reset progress → next page load tampil wizard lagi.

### 14c.4 Component + data flow

**FE component:** `<OwnerWelcomeWizard />` overlay di root of `/t/<slug>/*` layout.

- Reads `useTenant()` untuk tenant name + plan
- Reads `useTenantEffectiveFeatures()` untuk daftar modul aktif
- Reads `useTenantUser()` untuk `first_login_wizard_completed_at`
- Dynamically composes slide list berdasarkan modul aktif
- Persists progress via new RPC `save_wizard_progress(p_slide_index int)`
- Completes via RPC `complete_wizard()` → set `first_login_wizard_completed_at`

**RPCs (tenant-scoped, owner only):**

- `save_wizard_progress(p_slide_index int) → void` — SECDEF; RLS check owner = current user
- `complete_wizard() → jsonb` — SECDEF; sets completed_at + returns tenant_user row for cache invalidation
- `reset_wizard() → void` — SECDEF; menu Pengaturan → Tour ulang trigger

### 14c.5 Wave placement

**Wave 4c BARU** — ~3-4 dev days:
- 3 RPCs + tenant_users column
- OwnerWelcomeWizard component (dynamic slide list logic)
- 3 slide layout templates (welcome/feature/final)
- Copy per modul (13 modul × ~120 kata each = maintainable)
- Menu Pengaturan → Tour ulang trigger

**Ship after Wave 4b** (multi-admin) atau **parallel dengan Wave 4a** (renewal) — depends on frontend capacity. Independent, tidak block waves lain.

---

## 15. Payment tracking + Revenue dashboard (Wave 5)

Founder butuh visibility ke berapa rupiah tiap tenant sudah bayar, bukti transfernya, dan agregasi pendapatan VOSI. Ini tidak menggantikan payment gateway (Stripe/Xendit — masih Phase C), tapi memberikan manual entry + storage yang cukup untuk skala 2-50 tenant.

### 15.1 Data model

**Extend `plans`:**

```sql
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS price_annual NUMERIC(15,2);

UPDATE public.plans SET price_annual = 1200000 WHERE code = 'STARTER';  -- 1.2 jt/tahun
UPDATE public.plans SET price_annual = 3600000 WHERE code = 'PRO';       -- 3.6 jt/tahun
UPDATE public.plans SET price_annual = 9000000 WHERE code = 'PREMIUM';   -- 9 jt/tahun
```

Founder bisa edit ini via `/admin/plans` (Wave 4 already writes plans).

**New table `tenant_payments`:**

```sql
CREATE TABLE public.tenant_payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  amount              NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  currency            TEXT NOT NULL DEFAULT 'IDR',
  payment_method      TEXT NOT NULL CHECK (payment_method IN (
    'BANK_TRANSFER','CASH','E_WALLET','QRIS','VIRTUAL_ACCOUNT','OTHER'
  )),
  -- Bank name (required kalau method IN ('BANK_TRANSFER','VIRTUAL_ACCOUNT'))
  bank_name           TEXT CHECK (bank_name IN (
    'BCA','MANDIRI','BRI','BNI','PERMATA','CIMB','BSI','DANAMON',
    'BTN','MEGA','MAYBANK','PANIN','OCBC','JAGO','SEA_BANK','OTHER'
  ) OR bank_name IS NULL),
  -- E-wallet provider (required kalau method IN ('E_WALLET','QRIS'))
  ewallet_provider    TEXT CHECK (ewallet_provider IN (
    'OVO','GOPAY','DANA','LINKAJA','SHOPEEPAY','JENIUS_PAY','OTHER'
  ) OR ewallet_provider IS NULL),
  payment_date        DATE NOT NULL,
  period_from         DATE NOT NULL,
  period_to           DATE NOT NULL CHECK (period_to >= period_from),
  proof_url           TEXT,                   -- Supabase Storage path 'payment-proofs/<slug>/YYYY-MM-<uuid>.<ext>'
  bank_reference      TEXT,                   -- e.g., BCA ref number, VA number, Xendit ID
  notes               TEXT,
  recorded_by_admin   UUID NOT NULL REFERENCES auth.users(id),
  audit_id            UUID REFERENCES public.platform_admin_audit(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Method-specific validation
  CONSTRAINT payment_bank_required CHECK (
    (payment_method IN ('BANK_TRANSFER','VIRTUAL_ACCOUNT') AND bank_name IS NOT NULL)
    OR payment_method NOT IN ('BANK_TRANSFER','VIRTUAL_ACCOUNT')
  ),
  CONSTRAINT payment_ewallet_required CHECK (
    (payment_method IN ('E_WALLET','QRIS') AND ewallet_provider IS NOT NULL)
    OR payment_method NOT IN ('E_WALLET','QRIS')
  )
);
CREATE INDEX idx_tenant_payments_tenant_date ON public.tenant_payments(tenant_id, payment_date DESC);
CREATE INDEX idx_tenant_payments_period ON public.tenant_payments(period_from, period_to);
COMMENT ON TABLE public.tenant_payments IS 'category=P; VOSI revenue tracking (manual entry).';
```

**Supabase Storage bucket:** `payment-proofs`
- RLS: platform_admin full CRUD; tenant owner READ-only untuk path prefix `<own-slug>/*`
- File size: max 5MB per file
- Formats: JPG, PNG, PDF
- Path convention: `<tenant_slug>/YYYY-MM-<uuid>.<ext>`
- Public bucket: NO (signed URLs untuk display, valid 1 hour)

**Audit action codes** extend §2.3:

```sql
ALTER TABLE public.platform_admin_audit
  DROP CONSTRAINT platform_admin_audit_action_check;
ALTER TABLE public.platform_admin_audit
  ADD CONSTRAINT platform_admin_audit_action_check
  CHECK (action IN (
    ... existing ...,
    'RECORD_PAYMENT','UPDATE_PAYMENT','DELETE_PAYMENT',
    'UPLOAD_PAYMENT_PROOF'
  ));
```

### 15.2 New RPCs

```sql
-- record_payment(payload jsonb) → jsonb
-- Payload: { tenant_id, amount, payment_method, payment_date, period_from,
--            period_to, proof_object_key, bank_reference, notes }
-- Returns: { payment_id, amount_paid_ytd, coverage_ok: bool }

-- list_payments(p_filters jsonb) → setof jsonb
-- Filters: tenant_id, payment_method, from_date, to_date, min_amount

-- get_revenue_stats(p_filters jsonb) → jsonb
-- Filters: from_date, to_date, group_by ('plan'|'month'|'tenant')
-- Returns: { total, breakdown: [{key, amount, count}], monthly_trend: [...] }

-- generate_payment_proof_signed_url(p_object_key text) → text
-- Returns 1-hour signed URL for admin/owner to view proof file.
```

All include platform-admin gate template (§1.2). `list_payments` + `get_revenue_stats` also allow tenant owner read-only untuk own tenant_id.

### 15.3 UI: 3 touchpoints

**(a) Onboarding wizard Step 6 "Pembayaran awal" panel** — additive to existing Review step:

- Field: Nominal diterima (default = `plans.price_annual`)
- Field: Metode pembayaran (dropdown)
- Field: Tanggal terima
- Field: Period from/to (default: today s/d today+365)
- Upload: bukti transfer (drag/drop, preview thumbnail)
- Field: Referensi bank (optional)
- Field: Catatan
- Skip button: "Skip pembayaran (rekam nanti)" — kalau founder mau onboard duluan tanpa payment record

Kalau tenant_status akan set ACTIVE tapi tidak ada payment terekam, wizard tampilkan warning: "Tenant akan aktif tanpa payment record. Yakin?"

**(b) Renewal modal (Wave 4)** — extend existing dialog:

- Field: Nominal diterima (auto-fill dari `plans.price_annual` untuk plan yang dipilih)
- Field: Metode pembayaran
- Upload: bukti transfer (mandatory kalau method ≠ CASH)
- Otomatis link ke period_from = current expires_at, period_to = new expires_at

**(c) Tenant detail tab baru "Pembayaran"** — 7th tab:

- Ringkasan: Total dibayar YTD, Coverage sekarang (aktif s/d 2027-08-18), Status pembayaran (LUNAS / DP 60% / OVERDUE)
- Tombol "+ Catat pembayaran" — untuk ad-hoc entry (cicilan tambahan, top-up)
- Table riwayat: Tanggal, Nominal, Metode, Period, Bukti (klik → signed URL preview), Ref bank, Notes, Recorded by
- Actions per row: Edit, Delete (audit-logged), Download proof

### 15.4 Revenue dashboard `/admin/revenue`

New route + AdminRevenue screen. Content:

- **4 KPI cards**:
  1. Total bulan ini (dengan comparison vs bulan lalu)
  2. Total YTD
  3. MRR estimasi (annualized revenue / 12; assumes annual payments spread evenly)
  4. ARR estimasi (SUM of active subscriptions × plan_annual_price)
- **Breakdown per plan** — bar chart: STARTER / PRO / PREMIUM revenue YTD
- **Monthly trend** — line chart 12 bulan terakhir
- **Top 10 tenant by revenue YTD** — table dengan link ke tenant detail
- **Coverage gaps** — highlight tenant dengan status coverage OVERDUE (subscription active tapi payment belum lunas)

Sidebar tambah item baru "💰 Pendapatan" di section "Manage".

### 15.5 Payment coverage status derivation

Untuk tiap tenant:

```
total_paid = SUM(tenant_payments.amount WHERE period covers current subscription)
expected = plans.price_annual (or pro-rated jika subscription < 1 tahun)

status =
  'LUNAS'     if total_paid >= expected
  'DP_60'     if total_paid >= 0.6 × expected AND total_paid < expected
  'DP_30'     if total_paid >= 0.3 × expected AND total_paid < 0.6 × expected
  'OVERDUE'   if total_paid < 0.3 × expected AND subscription active
  'UNPAID'    if total_paid = 0
```

Coverage indicator ditampilkan di:
- Tenant detail Overview panel
- Home dashboard "Butuh perhatian" queue (tampilkan OVERDUE)
- TenantsList table kolom baru "Pembayaran"

---

## 16. Related documents

- Phase A design: `docs/superpowers/specs/2026-07-03-multi-tenant-phase-a-design.md`
- Phase A plan: `docs/superpowers/plans/2026-07-03-multi-tenant-phase-a-implementation.md`
- Phase A production rollout runbook: `docs/superpowers/plans/2026-07-04-multi-tenant-phase-a-production-rollout.md`
- Phase A architecture spike: `docs/superpowers/spikes/2026-07-03-phase-a-architecture-spike.md`
- Mockups (visual companion output): `.superpowers/brainstorm/98296-1783146883/content/*.html` — gitignored scratch, will be preserved locally
