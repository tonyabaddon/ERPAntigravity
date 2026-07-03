# Multi-Tenant Foundation — Phase A Design Spec

**Date:** 2026-07-03
**Status:** Approved (design)
**Author:** Founder + Claude
**Scope:** Phase A of the VOSI multi-tenant onboarding platform — the foundation layer that transforms the current single-tenant Garindo panel into a multi-tenant system, so tenant #2 can be created safely without cross-tenant data leaks.

---

## 0. Context

VOSI is the platform product name (see `docs/vosi-landing/`). Today it runs as a single-tenant app for Garindo Jaya. The goal is to evolve it into a proper multi-tenant SaaS where the founder (super-admin) can onboard tenant #2 and beyond, assign features per tenant via plan tiers and per-feature overrides, and enforce subscription expiry — all on the current free-tier infrastructure.

This spec covers **Phase A only**. Phases B and C are named but out-of-scope here:

```
PHASE A — Foundation                                    ← THIS SPEC
  S1. Tenant registry + Layer-A auth hook
  S2. RLS audit + isolation validation
  S4. Path prefix routing /t/<slug>
  S5a. Plans catalog + tenant_subscriptions data model

PHASE B — Admin & Onboarding UX                         ← Later spec
  S3. Super-admin panel /admin (list/create/edit tenants, impersonate)
  S5b. Onboarding form: pilih paket + override
  S5c. Expiration UI: 7-day grace, read-only banner
  S5d. Data migration / Excel import (products, customers, suppliers, kas/bank)
  S6. Feature entitlement service (useFeature + RPC gate)

PHASE C — Later (deferred)                              ← Not planned yet
  S7. Custom domain (optional per-tenant)
  S8. Billing / subscription (Stripe / Xendit)
  S9. Self-serve signup
```

**Key design decisions (locked from brainstorming):**
- URL model: `erpapp.id/t/<slug>/*` path prefix. `custom_domain` field kept as future-optional.
- Branding: platform-branded default. Custom subdomain is a Phase C paid upgrade.
- Feature model: **hybrid** — 3 plans (STARTER/PRO/PREMIUM) auto-tick features, with per-tenant JSONB overrides.
- Plans editable in `/admin` (Phase B UI); seeded in Phase A migrations.
- Super-admin auth: extend Supabase Auth OTP + `platform_admins` allowlist table + impersonation via header.
- Onboarding: super-admin fills everything; tenant just logs in via OTP magic link.
- Expiry behavior: 7-day grace (full write) → then read-only permanent until renewed.
- Data import scope: products/stock, customers (with piutang), suppliers (with utang), kas/bank/COA (with opening balance). Format: Excel/CSV templates only. **Phase B.**
- Testing infra: Supabase local Docker for isolation testing (free, unlimited). Preview environment optional.
- Rollout: 4-file migration bundle with halt gates. Auto-generated RLS hardening. Zero paid-service dependency in Phase A.

---

## 1. Architecture

### 1.1 Purpose

Transform the current single-tenant Garindo panel into a multi-tenant foundation where:

1. Multiple tenants can coexist safely in one Supabase database.
2. No cross-tenant data leaks are possible (defense-in-depth: application filter + Postgres RLS + FORCE RLS + isolation test suite in CI).
3. Every request knows which tenant it belongs to (via URL path prefix → header → PostgREST pre-request hook → GUC).
4. Existing Garindo data is preserved without disruption; users continue business-as-usual through the migration.

### 1.2 Tenant identity flow

```
Browser
   │ URL: erpapp.id/t/<slug>/dashboard
   ▼
Frontend router
   │ ekstrak slug → set TenantContext
   │ setiap Supabase call bawa header: x-tenant-slug: <slug>
   ▼
Supabase (PostgREST)
   │ pre-request hook: _pgrst_pre_request()
   │   1. baca header x-tenant-slug (and x-impersonate-tenant untuk super-admin)
   │   2. baca auth.uid() dari JWT
   │   3. lookup tenants.id by slug
   │   4. verify auth.uid() ∈ tenant_users(tenant_id)
   │      (kecuali platform_admins → boleh impersonate via header)
   │   5. set_config('app.current_tenant_id', tenant_id, true)  ← transaction-local
   │   6. hitung expiry state (ACTIVE / GRACE / READONLY) → GUC juga
   │   7. audit-log jika impersonation
   ▼
RLS policies (menggunakan _resolve_tenant_id() helper existing)
   │ Filter setiap row: WHERE tenant_id = _resolve_tenant_id()
   │ FORCE ROW LEVEL SECURITY di semua T-category tables
   ▼
Write RPCs
   │ Cek app.tenant_expiry_mode ≠ 'READONLY' via _guard_expiry_write()
   │ (READONLY → raise SUBSCRIPTION_EXPIRED_READONLY)
   ▼
Data returned, scoped ke tenant
```

### 1.3 Architectural principles

1. **Single-point tenant setter** — PostgREST `db-pre-request` runs `_pgrst_pre_request()` before every query. No need to modify hundreds of existing RPCs.
2. **Existing `_resolve_tenant_id()` unchanged** — 56+ existing migrations that already call it stay compatible. Semantic shift: it used to return the sentinel UUID `00000000-...`; after Phase A ships, it returns the real tenant UUID.
3. **Impersonation via HTTP header, not JWT claim** — super-admin can switch tenants without re-issuing tokens.
4. **Expiry enforced at RPC layer, not RLS** — RLS filters rows; expiry blocks writes. Separation avoids RLS complexity.
5. **Transaction-local GUCs mandatory** — `set_config(..., true)` always. PgBouncer transaction pool safety.
6. **Defense-in-depth** — application filter + RLS policy + FORCE RLS + isolation test CI gate.

---

## 2. Data Model

> **Note on presentation:** SQL blocks in this section show the *conceptual final state* — CREATE TABLE, functions, triggers, all in one place per table. §4 (Migration Plan) shows how the same DDL is split across four migration files with staged trigger attachment for backfill safety. If they differ, §4 is authoritative for what actually runs on production.

### 2.1 New tables

**`tenants`** — root registry

```sql
CREATE TABLE tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT UNIQUE NOT NULL
                  CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,29}$'
                         AND slug NOT IN ('admin','api','auth','login','signup','www','t','static','assets','public','app','support','help')),
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','SUSPENDED','ARCHIVED')),
  custom_domain TEXT UNIQUE,           -- deferred to Phase C
  suspended_at  TIMESTAMPTZ,
  suspended_reason TEXT,
  archived_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES auth.users(id)
);
CREATE INDEX idx_tenants_slug_active ON tenants(slug) WHERE status = 'ACTIVE';

-- Slug immutability trigger — prevent broken URLs
CREATE OR REPLACE FUNCTION _forbid_slug_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.slug <> OLD.slug THEN
    RAISE EXCEPTION 'Tenant slug is immutable' USING errcode = '55006';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_tenants_slug_immutable
BEFORE UPDATE OF slug ON tenants FOR EACH ROW EXECUTE FUNCTION _forbid_slug_change();
```

**`platform_admins`** — super-admin allowlist

```sql
CREATE TABLE platform_admins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,                 -- denormalized for audit readability
  role       TEXT NOT NULL DEFAULT 'super_admin'
               CHECK (role IN ('super_admin','support')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID
);
```

**`tenant_users`** — tenant membership

```sql
CREATE TABLE tenant_users (
  id         BIGSERIAL PRIMARY KEY,
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'staff'
               CHECK (role IN ('owner','admin','staff','kasir')),
  status     TEXT NOT NULL DEFAULT 'ACTIVE'
               CHECK (status IN ('ACTIVE','DISABLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX idx_tenant_users_user ON tenant_users(user_id) WHERE status = 'ACTIVE';
```

**`plans`** — subscription catalog

```sql
CREATE TABLE plans (
  code            TEXT PRIMARY KEY
                    CHECK (code ~ '^[A-Z][A-Z0-9_]{2,29}$'),
  name            TEXT NOT NULL,
  feature_bundle  JSONB NOT NULL,          -- {"modul_kasir":true, ...} for all 11 modules
  price_reference NUMERIC,                 -- informational; no billing in Phase A
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID
);
```

**`tenant_subscriptions`** — one active subscription per tenant

```sql
CREATE TABLE tenant_subscriptions (
  id                 BIGSERIAL PRIMARY KEY,
  tenant_id          UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  plan_code          TEXT NOT NULL REFERENCES plans(code),
  feature_overrides  JSONB NOT NULL DEFAULT '{}'::jsonb,   -- override plan defaults
  activated_at       DATE NOT NULL,
  expires_at         DATE NOT NULL,
  grace_expires_at   DATE GENERATED ALWAYS AS (expires_at + INTERVAL '7 day') STORED,
  notes              TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         UUID,
  CHECK (expires_at >= activated_at)
);
CREATE INDEX idx_tenant_sub_expiry ON tenant_subscriptions(grace_expires_at);
```

**`platform_admin_audit`** — impersonation & admin action log (PDP UU 27/2022 compliance)

```sql
CREATE TABLE platform_admin_audit (
  id            BIGSERIAL PRIMARY KEY,
  admin_user_id UUID NOT NULL REFERENCES auth.users(id),
  admin_email   TEXT NOT NULL,
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  action        TEXT NOT NULL
                  CHECK (action IN ('IMPERSONATE_START','IMPERSONATE_END','CREATE_TENANT','CHANGE_PLAN','CHANGE_FEATURES','SUSPEND','ACTIVATE','ARCHIVE')),
  detail        JSONB,                     -- e.g., {"old_plan":"STARTER","new_plan":"PRO"}
  ip_address    INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_audit_tenant_time ON platform_admin_audit(tenant_id, created_at DESC);
CREATE INDEX idx_admin_audit_admin_time  ON platform_admin_audit(admin_user_id, created_at DESC);
```

**`tenant_activity_daily`** — activity/cost telemetry skeleton (populated in Phase C when billing arrives)

```sql
CREATE TABLE tenant_activity_daily (
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL,
  rpc_calls     BIGINT NOT NULL DEFAULT 0,
  writes        BIGINT NOT NULL DEFAULT 0,
  wa_messages   BIGINT NOT NULL DEFAULT 0,
  ai_tokens     BIGINT NOT NULL DEFAULT 0,
  storage_bytes BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, activity_date)
);
```

No populator job deployed in Phase A. Table exists solely to make Phase C billing rollout a zero-migration event.

### 2.2 Derived view — effective features per tenant

```sql
CREATE OR REPLACE VIEW v_tenant_effective_features AS
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
FROM tenant_subscriptions s
JOIN plans p ON p.code = s.plan_code;
```

### 2.3 Backward compat for `tenant_settings` — sync via trigger

To avoid touching 100+ frontend/RPC callsites that already read `tenant_settings.modul_*`, we keep `tenant_settings` as the read source of truth. A trigger recomputes it whenever `tenant_subscriptions` or `plans.feature_bundle` changes.

```sql
CREATE OR REPLACE FUNCTION sync_tenant_settings_from_subscription()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_effective JSONB;
BEGIN
  SELECT p.feature_bundle || NEW.feature_overrides INTO v_effective
  FROM plans p WHERE p.code = NEW.plan_code;

  INSERT INTO tenant_settings (tenant_id,
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

CREATE TRIGGER trg_sync_settings_from_sub
AFTER INSERT OR UPDATE ON tenant_subscriptions
FOR EACH ROW EXECUTE FUNCTION sync_tenant_settings_from_subscription();

-- When a plan's feature_bundle changes, resync all tenants on that plan by
-- touching updated_at on each affected tenant_subscriptions row — the
-- AFTER UPDATE trigger `trg_sync_settings_from_sub` re-fires per row and
-- recomputes tenant_settings for that tenant.
CREATE OR REPLACE FUNCTION resync_all_tenants_on_plan_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE tenant_subscriptions
  SET updated_at = now()
  WHERE plan_code = NEW.code;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_resync_on_plan_change
AFTER UPDATE OF feature_bundle ON plans
FOR EACH ROW EXECUTE FUNCTION resync_all_tenants_on_plan_change();
```

### 2.4 `tenant_settings` schema adjustments

Existing table has a singleton index (`tenant_id IS NULL` = 'SINGLETON'). After backfill:

```sql
UPDATE tenant_settings SET tenant_id = '11111111-1111-1111-1111-111111111111' WHERE tenant_id IS NULL;
DROP INDEX IF EXISTS idx_tenant_settings_singleton;
ALTER TABLE tenant_settings ADD CONSTRAINT uk_tenant_settings_tenant UNIQUE (tenant_id);
ALTER TABLE tenant_settings ALTER COLUMN tenant_id SET NOT NULL;
```

Writes to `tenant_settings` are no longer user-driven (deprecated `updateModul()` in frontend). All writes come through the sync trigger. Super-admin edits plan or overrides via `/admin` (Phase B).

### 2.5 `company_settings` multi-tenant conversion

Existing structure: `id INT PK DEFAULT 1` singleton with columns `company_name`, `address`, `phone`, `email`, `logo_url`, `npwp`, `opname_require_witness`, `costing_method`, `updated_at`. No foreign keys reference `company_settings.id` (verified via grep).

Migration:

```sql
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

UPDATE company_settings
SET tenant_id = '11111111-1111-1111-1111-111111111111'
WHERE tenant_id IS NULL;

ALTER TABLE company_settings DROP CONSTRAINT IF EXISTS company_settings_pkey;
ALTER TABLE company_settings ADD PRIMARY KEY (tenant_id);
ALTER TABLE company_settings ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE company_settings DROP COLUMN IF EXISTS id;

DROP POLICY IF EXISTS "anon write company_settings" ON company_settings;
DROP POLICY IF EXISTS "public read company_settings" ON company_settings;

CREATE POLICY "t_select" ON company_settings FOR SELECT TO authenticated
  USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_update" ON company_settings FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id());

ALTER TABLE company_settings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON company_settings FROM anon;
GRANT SELECT, UPDATE ON company_settings TO authenticated;

-- Auto-seed a company_settings row on new tenant creation
CREATE OR REPLACE FUNCTION _seed_company_settings_for_new_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO company_settings (tenant_id, company_name)
  VALUES (NEW.id, NEW.name)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_seed_company_settings
AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION _seed_company_settings_for_new_tenant();
```

Frontend `companySettingsService` refactor (in `src/lib/supabaseClient.ts`):

- All `.eq('id', 1)` filters removed. RLS + pre-request hook ensures the caller sees only their tenant's row.
- Updates use `.eq('tenant_id', <resolved-id-from-TenantContext>)` for defense-in-depth.
- `DbCompanySettings` type in `src/types.ts`: remove `id: number`, add `tenant_id: string`.

Files touched: `src/lib/supabaseClient.ts`, `src/types.ts`, `src/components/PengaturanScreen.tsx`, `src/components/StockManagerScreen.tsx`, `src/components/stok/StockOpnameScreen.tsx`, `src/components/stok/StockOpnameSessionView.tsx`. ~15 lines net change.

---

## 3. Auth Hook & Tenant Identity Mechanism

> **Architecture pivot (2026-07-03 spike):** Original design used PostgREST `db-pre-request` role setting. Verified via Task 0 spike that Supabase Cloud managed does NOT honor this setting (ALTER ROLE succeeds, PostgREST listens on channel, but function never fires). See `docs/superpowers/spikes/2026-07-03-phase-a-architecture-spike.md`.
>
> **Pivoted to Supabase Auth Hook `custom_access_token_hook`** — officially supported on free tier, JWT-baked tenant identity, zero per-request overhead, tamper-proof.

### 3.1 Supabase Auth Hook — JWT tenant claim

Registration (Supabase Dashboard → Authentication → Hooks → Custom Access Token → select `public.custom_access_token_hook`):

The hook fires at JWT issue and refresh. It receives the default claims and returns claims to bake into the token. RLS policies then read tenant identity from `auth.jwt()` — no header injection, no GUC, no per-request DB lookup.

```sql
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id                uuid;
  v_is_platform_admin      boolean;
  v_impersonating_slug     text;
  v_tenant_id              uuid;
  v_tenant_status          text;
  v_expiry_state           text;
  v_claims                 jsonb;
BEGIN
  v_claims := event->'claims';
  v_user_id := (v_claims->>'sub')::uuid;

  -- 1. Platform admin membership
  v_is_platform_admin := EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_user_id);
  v_claims := jsonb_set(v_claims, '{is_platform_admin}', to_jsonb(v_is_platform_admin));

  -- 2. Impersonation state (super-admin only; source: platform_admin_active_impersonation)
  IF v_is_platform_admin THEN
    SELECT tenant_slug INTO v_impersonating_slug
    FROM public.platform_admin_active_impersonation
    WHERE admin_user_id = v_user_id;
  END IF;

  -- 3. Resolve tenant_id
  IF v_impersonating_slug IS NOT NULL THEN
    -- Impersonation path — super-admin acts as tenant
    SELECT id, status INTO v_tenant_id, v_tenant_status
    FROM public.tenants WHERE slug = v_impersonating_slug;
    v_claims := jsonb_set(v_claims, '{impersonating}', to_jsonb(true));
    v_claims := jsonb_set(v_claims, '{impersonating_slug}', to_jsonb(v_impersonating_slug));
  ELSE
    -- Normal path — user's active tenant membership.
    -- For MSME context, users typically have exactly one active tenant.
    -- Deterministic pick: earliest-joined tenant_users membership.
    SELECT t.id, t.status INTO v_tenant_id, v_tenant_status
    FROM public.tenant_users tu
    JOIN public.tenants t ON t.id = tu.tenant_id
    WHERE tu.user_id = v_user_id AND tu.status = 'ACTIVE' AND t.status IN ('ACTIVE','SUSPENDED')
    ORDER BY tu.created_at ASC
    LIMIT 1;
  END IF;

  -- 4. Bake tenant claims (nullable — super-admin browsing /admin without impersonation has no tenant)
  IF v_tenant_id IS NOT NULL THEN
    v_claims := jsonb_set(v_claims, '{tenant_id}', to_jsonb(v_tenant_id::text));
    v_claims := jsonb_set(v_claims, '{tenant_status}', to_jsonb(v_tenant_status));

    -- 5. Expiry state from view
    SELECT expiry_state INTO v_expiry_state
    FROM public.v_tenant_effective_features WHERE tenant_id = v_tenant_id;
    v_claims := jsonb_set(v_claims, '{tenant_expiry_mode}', to_jsonb(COALESCE(v_expiry_state, 'ACTIVE')));
  END IF;

  RETURN jsonb_build_object('claims', v_claims);
END $$;

-- Supabase requires the hook to be executable by supabase_auth_admin role
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, PUBLIC;
```

**Impersonation state table** (feeds the hook):

```sql
CREATE TABLE IF NOT EXISTS public.platform_admin_active_impersonation (
  admin_user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_slug   TEXT NOT NULL REFERENCES public.tenants(slug),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.platform_admin_active_impersonation IS 'category=P';
GRANT SELECT ON public.platform_admin_active_impersonation TO supabase_auth_admin;
```

**Impersonation flow (client-side):**

1. Super-admin clicks "Impersonate garindo" at `/admin`.
2. Frontend calls RPC `impersonate_tenant('garindo')` — SECDEF, verifies caller is platform admin, UPSERTs `platform_admin_active_impersonation`.
3. Frontend calls `supabase.auth.refreshSession()` — triggers JWT re-issue.
4. Hook fires, reads `platform_admin_active_impersonation`, bakes new tenant claim.
5. Subsequent queries authorize as garindo tenant.
6. Exit: RPC `stop_impersonation()` deletes row + `refreshSession()`.

**JWT claim schema (added by hook):**

| Claim | Type | Meaning |
|---|---|---|
| `tenant_id` | UUID string | Active tenant. NULL for super-admin not impersonating. |
| `tenant_status` | text | `ACTIVE`\|`SUSPENDED`\|`ARCHIVED` |
| `tenant_expiry_mode` | text | `ACTIVE`\|`GRACE`\|`READONLY` |
| `is_platform_admin` | boolean | From `platform_admins` allowlist |
| `impersonating` | boolean | True when super-admin has active impersonation |
| `impersonating_slug` | text | Which tenant is being impersonated (for UI display) |

Existing standard claims (`sub`, `aud`, `role`, `exp`, `iat`) are preserved untouched.

### 3.2 `_resolve_tenant_id()` — semantic update (reads from JWT)

The helper defined in migration `20260614000011_resolve_tenant_helper.sql` keeps its signature. Body is rewritten to read the JWT claim baked by the Auth Hook:

```sql
CREATE OR REPLACE FUNCTION public._resolve_tenant_id()
RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_claims_text text;
  v_tenant_id_text text;
BEGIN
  v_claims_text := current_setting('request.jwt.claims', true);
  IF v_claims_text IS NULL OR v_claims_text = '' THEN
    RETURN '00000000-0000-0000-0000-000000000000'::uuid;  -- sentinel: no auth context
  END IF;
  v_tenant_id_text := (v_claims_text::jsonb)->>'tenant_id';
  IF v_tenant_id_text IS NULL THEN
    RETURN '00000000-0000-0000-0000-000000000000'::uuid;  -- sentinel: super-admin without impersonation
  END IF;
  RETURN v_tenant_id_text::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN '00000000-0000-0000-0000-000000000000'::uuid;  -- defensive
END $$;
```

- **Before Phase A:** returned sentinel UUID (GUC unset).
- **After Phase A:** returns real tenant UUID from JWT claim. Sentinel is reachable only for authenticated super-admin at `/admin` without active impersonation, or for the anon/login flow — both cases the caller has no legitimate tenant reads pending, so RLS returns empty result sets.

RLS policies keep the shape `WHERE tenant_id = _resolve_tenant_id()` — no policy rewrite needed. This is why we keep the helper: 56+ existing migrations reference it.

### 3.3 Expiry write-guard (reads from JWT)

```sql
CREATE OR REPLACE FUNCTION public._guard_expiry_write()
RETURNS void LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_mode text;
BEGIN
  v_mode := (current_setting('request.jwt.claims', true)::jsonb)->>'tenant_expiry_mode';
  IF v_mode = 'READONLY' THEN
    RAISE EXCEPTION USING errcode = 'P0402',
      message = 'SUBSCRIPTION_EXPIRED_READONLY',
      hint = 'Renew subscription to enable writes.';
  END IF;
EXCEPTION WHEN invalid_text_representation OR null_value_not_allowed OR undefined_object THEN
  NULL;  -- Missing/malformed claim = allow (unauth flow, tests, etc.). Defense: RLS elsewhere.
END $$;
```

Invoked in two places (defense-in-depth):

1. **RPC bodies** — bulk auto-wrapped by plan Task 8 with `PERFORM _guard_expiry_write();` at start of every write RPC.
2. **RLS `WITH CHECK` clauses** — see §5.3 template. Policy evaluates `_guard_expiry_write() IS NULL`: void returns satisfy `IS NULL`; raise cancels the transaction.

### 3.4 Frontend — no header injection needed

Because the Auth Hook bakes tenant identity into the JWT itself, the frontend does **not** need to send `x-tenant-slug` or `x-impersonate-tenant` headers on Supabase requests. The Supabase JS SDK automatically attaches the JWT bearer token, which contains the tenant claims.

`src/lib/supabaseClient.ts` initialization stays close to the codebase's existing pattern — no custom `global.fetch` wrapper needed for tenant identity. (URL slug still exists for routing / display; it is authoritative for UI but not for authorization.)

**Session refresh trigger.** When a super-admin starts or stops impersonation, the tenant identity in the JWT must change. Frontend calls `await supabase.auth.refreshSession()` immediately after the impersonation RPC succeeds. The hook re-fires; the new JWT carries the updated claims. Same mechanism handles plan changes made by super-admin while a user is signed in: after any change to `tenant_subscriptions` or `feature_overrides`, admins can trigger a "force resync" by sending a Supabase realtime broadcast to affected user sessions, prompting a refresh.

### 3.5 Impersonation flow (RPCs + hook-driven JWT re-issue)

Two RPCs manage the impersonation state that the Auth Hook reads:

```sql
CREATE OR REPLACE FUNCTION public.impersonate_tenant(p_slug text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'Not a platform admin' USING errcode = 'P0403';
  END IF;

  SELECT id INTO v_tenant_id FROM public.tenants WHERE slug = p_slug AND status = 'ACTIVE';
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND';
  END IF;

  INSERT INTO public.platform_admin_active_impersonation (admin_user_id, tenant_slug)
  VALUES (v_uid, p_slug)
  ON CONFLICT (admin_user_id) DO UPDATE SET tenant_slug = EXCLUDED.tenant_slug, started_at = now();

  INSERT INTO public.platform_admin_audit
    (admin_user_id, admin_email, tenant_id, action, detail)
  VALUES (v_uid, (SELECT email FROM auth.users WHERE id = v_uid),
          v_tenant_id, 'IMPERSONATE_START',
          jsonb_build_object('slug', p_slug));
END $$;

CREATE OR REPLACE FUNCTION public.stop_impersonation()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prev_slug text;
  v_tenant_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'Not a platform admin' USING errcode = 'P0403';
  END IF;

  SELECT tenant_slug INTO v_prev_slug FROM public.platform_admin_active_impersonation
  WHERE admin_user_id = v_uid;

  DELETE FROM public.platform_admin_active_impersonation WHERE admin_user_id = v_uid;

  IF v_prev_slug IS NOT NULL THEN
    SELECT id INTO v_tenant_id FROM public.tenants WHERE slug = v_prev_slug;
    INSERT INTO public.platform_admin_audit
      (admin_user_id, admin_email, tenant_id, action, detail)
    VALUES (v_uid, (SELECT email FROM auth.users WHERE id = v_uid),
            v_tenant_id, 'IMPERSONATE_END',
            jsonb_build_object('slug', v_prev_slug));
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.impersonate_tenant(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stop_impersonation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.impersonate_tenant(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stop_impersonation() TO authenticated;
```

Client sequence when super-admin enters impersonation:

```typescript
await supabase.rpc('impersonate_tenant', { p_slug: 'garindo' });
await supabase.auth.refreshSession();  // triggers hook re-fire → new JWT has tenant claims
navigate('/t/garindo/dashboard');
```

Exit:
```typescript
await supabase.rpc('stop_impersonation');
await supabase.auth.refreshSession();
navigate('/admin');
```

The audit trail lives in `platform_admin_audit` — same table as before, populated by the impersonate RPCs directly (not by a global pre-request hook). No noisy per-RPC audit inserts.

### 3.6 Backend Go — JWT-aware follow-up

`backend-go/` currently issues its own DB queries. Post-Phase A, every Go request handler must forward the incoming Supabase JWT and rely on it for tenant identity:

1. Read `Authorization: Bearer <jwt>` header from the incoming HTTP request.
2. Pass the same JWT to Supabase-facing PostgREST calls (Go can use `supabase-community/postgrest-go` with the user's JWT), so PostgREST sets `request.jwt.claims` naturally — `_resolve_tenant_id()` reads tenant from the JWT the client already carries.
3. If Go bypasses PostgREST and hits Postgres directly (via pgx pool), it must set the JWT claims GUC per-transaction: `SET LOCAL request.jwt.claims = '<json>'` at the start of each transaction, where JSON is decoded from the bearer token.

Tracked as **Phase A polish task** — not blocking initial Phase A merge, but required before tenant #2 real go-live. Documented in §7.3 risks.

---

## 3.5 Scalability & Production Guardrails

### 3.5.1 GUC leakage via connection pooling — best practice (downgraded post-pivot)

Post-Auth-Hook pivot (§3.1), tenant identity is carried in the JWT and read via `request.jwt.claims` — which is set by PostgREST **per request** (not per connection) and is transaction-local by design. So the original PgBouncer-transaction-pool GUC-leak risk no longer applies to the primary auth path.

However, the general rule still holds for any custom GUCs we introduce elsewhere: all `set_config(..., true)` in every migration/RPC — never `false`. Enforced as CI grep-check regardless.

### 3.5.2 RLS default-deny posture + `SECURITY DEFINER` ownership hardening

Existing policies with `TO anon USING (true)` (e.g., `admin_users`, pre-refactor `company_settings`, `kasir_*`) are treated as bugs by Phase A. The RLS hardening migration (Section 5) drops each such policy and replaces it with a tenant-scoped policy or revokes anon access entirely.

`FORCE ROW LEVEL SECURITY` is set on all `T`-category tables — this forces RLS even for the table owner.

**IMPORTANT CORRECTION (audit finding):** `FORCE ROW LEVEL SECURITY` does **NOT** override the `BYPASSRLS` role attribute. Superusers (`postgres`) and roles with `BYPASSRLS` — which includes Supabase's `service_role` and the `postgres` role that migrations run as — bypass all RLS regardless of `ENABLE`/`FORCE`. This means:

- A `SECURITY DEFINER` function owned by `postgres` (the default when migrations create functions) runs with `postgres`'s effective role → RLS bypassed → no tenant filter → cross-tenant leak.
- The `SET row_security = on` GUC does NOT fix this (`row_security` has no effect on BYPASSRLS roles, per Postgres docs).

**Fix — two layers, both required:**

1. **Ownership change (systemic).** Create a dedicated role `vosi_rpc_owner` **without** `BYPASSRLS`. All tenant-touching `SECURITY DEFINER` functions must be owned by this role. FORCE RLS then applies as intended.
   ```sql
   CREATE ROLE vosi_rpc_owner NOINHERIT;
   -- (no BYPASSRLS, no SUPERUSER)
   GRANT vosi_rpc_owner TO postgres;  -- so migration user can ALTER OWNER
   ALTER FUNCTION public.<fn>(...) OWNER TO vosi_rpc_owner;
   -- Grant the owner role read/write on the tables it needs
   GRANT SELECT, INSERT, UPDATE, DELETE ON <T-tables> TO vosi_rpc_owner;
   ```
2. **Explicit tenant filter in RPC body (belt-and-suspenders).** Every `SECURITY DEFINER` RPC that reads or writes a T-category table must filter by `WHERE tenant_id = _resolve_tenant_id()` explicitly, not rely on RLS alone. This protects against ownership-change regressions and makes the guarantee legible in code review.

**Migration scope for Phase A:** every existing tenant-touching `SECURITY DEFINER` function must be re-owned and audited. This is a discrete work-item (see plan Task 8.5 — SECURITY DEFINER audit + ownership migration).

**Special case — `custom_access_token_hook()` itself.** The Auth Hook must be able to read `platform_admins`, `tenant_users`, `tenants`, `v_tenant_effective_features`, and `platform_admin_active_impersonation` from within its body. These are P/A category tables with FORCE RLS. Solution: `custom_access_token_hook()` is owned by `postgres` (BYPASSRLS) — the ONE deliberate exception. It runs only under the `supabase_auth_admin` role at JWT-issue time (not from tenant sessions), and it returns opaque claims to Supabase Auth — not tenant data to the caller.

**`impersonate_tenant()` / `stop_impersonation()`** (§3.5) also need cross-tenant reach (they operate on the platform-admin-scoped impersonation table). These are **kept postgres-owned** — the ONE additional exception alongside the Auth Hook. Their bodies check `platform_admins` membership as the first statement; a non-admin caller raises before any mutation.

Every other tenant-touching SECURITY DEFINER RPC in the codebase is re-owned to `vosi_rpc_owner` in Task 8.5. Explicit `WHERE tenant_id = _resolve_tenant_id()` filters are added to the top-N high-risk write RPCs in Task 8.5 Step 8 as belt-and-suspenders.

### 3.5.3 Per-tenant activity telemetry skeleton

`tenant_activity_daily` table exists (Section 2.1) but no populator job is deployed in Phase A. Phase C will add batch aggregation.

### 3.5.4 Suspension lifecycle semantics

- `ACTIVE`: normal operation.
- `SUSPENDED`: login blocked, no writes. Admin (via `/admin`) can still read for support/debug via impersonation.
- `ARCHIVED`: hidden from default `/admin` list. Data retained, restorable via UNARCHIVE action.

Every state transition is written to `platform_admin_audit`.

### 3.5.5 Slug immutability

Enforced via trigger `trg_tenants_slug_immutable` (Section 2.1). Renames require creating a new tenant and migrating data manually — a rare, deliberate event, not a silent operation. Phase C may add a `tenant_slug_aliases` redirect table.

### 3.5.6 Backward-compat rolling migration policy

Cloud Run deploys are rolling — old code and new code hit the same DB during a deploy. Migration rules:

- Add columns as NULLable first; backfill; set NOT NULL in a **separate** migration.
- Do not drop or rename columns in place — deprecate first, remove in a later release.
- All migrations idempotent (`IF NOT EXISTS`, `ON CONFLICT`, etc.).

### 3.5.7 Statement timeout per role

Supabase Cloud already sets `statement_timeout=8s` on `authenticator` by default (verified in Task 0 spike). We only add explicit caps for `authenticated`/`anon` if we want tighter isolation, and raise `service_role` cap for admin operations:

```sql
-- Optional: tighten user-facing roles to match authenticator's 8s.
-- Skip if Supabase defaults are already acceptable.
ALTER ROLE authenticated SET statement_timeout = '8s';
ALTER ROLE anon SET statement_timeout = '3s';
-- service_role handles background jobs, migrations, admin ops — allow longer
ALTER ROLE service_role SET statement_timeout = '60s';
```

Prevents one tenant's slow query from starving connections for others.

### 3.5.8 Slug uniqueness race

Two super-admins creating tenants with the same slug simultaneously: DB-level `UNIQUE` on `tenants.slug` catches it. API layer surfaces `SLUG_ALREADY_TAKEN`.

---

## 4. Migration Plan (Garindo Backfill)

### 4.1 Fixed Garindo UUID

```
tenant_id = '11111111-1111-1111-1111-111111111111'
slug      = 'garindo'
name      = 'Garindo Jaya'
```

Hardcoded for determinism — referenced in test fixtures, isolation harness, and rollback scripts.

### 4.2 Four migration files

**File 1 — `20261001000001_phase_a_schema.sql`**

- Create tables: `tenants`, `platform_admins`, `tenant_users`, `plans`, `tenant_subscriptions`, `platform_admin_audit`, `tenant_activity_daily`.
- Create view `v_tenant_effective_features`.
- Create `_forbid_slug_change()` trigger function and attach.
- Create `_seed_company_settings_for_new_tenant()` function (trigger attached in File 2 after `tenants` seeded to avoid firing during backfill).
- Create `sync_tenant_settings_from_subscription()` and `resync_all_tenants_on_plan_change()` functions (triggers attached in File 3 for the same reason).
- Set `statement_timeout` per role.

**File 2 — `20261001000002_phase_a_seed_and_backfill.sql`**

- Seed `plans` (STARTER, PRO, PREMIUM — bundles per §4.3).
- Insert Garindo tenant row with fixed UUID.
- Insert Garindo `tenant_subscriptions` (PREMIUM plan, activated 2026-01-01, expires 2099-12-31).
- Insert `platform_admins` for founder email.
- Insert `tenant_users` linking known Garindo staff to the tenant.
- Backfill `tenant_id` on **all** business tables in one dynamic loop:
  ```sql
  DO $$
  DECLARE r RECORD; v_garindo UUID := '11111111-1111-1111-1111-111111111111'; v_count BIGINT;
  BEGIN
    FOR r IN
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'tenant_id'
        AND table_name NOT IN ('tenants','tenant_users','tenant_settings','tenant_subscriptions','tenant_activity_daily','platform_admin_audit')
    LOOP
      EXECUTE format($fmt$UPDATE public.%I SET tenant_id = %L
                         WHERE tenant_id IS NULL
                            OR tenant_id = '00000000-0000-0000-0000-000000000000'::uuid$fmt$,
                     r.table_name, v_garindo);
      GET DIAGNOSTICS v_count = ROW_COUNT;
      RAISE NOTICE 'Backfilled %: % rows', r.table_name, v_count;
    END LOOP;
  END $$;
  ```
- Handle `tenant_settings` (drop singleton index, add UNIQUE(tenant_id), backfill).
- Handle `company_settings` restructure (§2.5) — add tenant_id, backfill, drop id column, replace PK, tighten RLS.
- Attach `trg_seed_company_settings` trigger.
- Handle tables without `tenant_id` column that need one (e.g., `admin_users`, others surfaced by inspection): `ALTER TABLE ... ADD COLUMN tenant_id UUID REFERENCES tenants(id); UPDATE ... SET tenant_id = <garindo>; ...`.

**File 3 — `20261001000003_phase_a_not_null_and_rls.sql`**

- Promote all business tables' `tenant_id` from NULLable to `NOT NULL` (separate file for rollback isolation).
- Attach `trg_sync_settings_from_sub` on `tenant_subscriptions`.
- Attach `trg_resync_on_plan_change` on `plans`.
- Apply the RLS hardening migration output from Section 5.2 (auto-generated by `scripts/generate-rls-audit-migration.ts`, then human-reviewed): DROP old anon policies, CREATE T/G/P/A/S template policies, `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`.

**File 4 — `20261001000004_phase_a_wire_layer_a.sql`**

- Create `_pgrst_pre_request()` function (Section 3.1).
- Create `_guard_expiry_write()` function (Section 3.3).
- Create `log_impersonation_start(text)` and `log_impersonation_end(text)` RPCs (Section 3.6).
- Create `bootstrap_tenant_context()` RPC (returns tenant meta + effective features + expiry state for frontend `TenantContext`).
- Create `is_platform_admin()` RPC (returns boolean for frontend `/admin` gate).
- Bulk auto-wrap write RPCs with `PERFORM _guard_expiry_write();` — via inspection of `pg_proc.prosrc` for write keywords, skipping SELECT-only and `get_*`/`list_*`/`resolve_*` names. Migration body is a `DO $$` block that iterates and `CREATE OR REPLACE`s each matched function.
- `ALTER ROLE authenticator SET pgrst.db_pre_request = 'public._pgrst_pre_request';`
- `NOTIFY pgrst, 'reload config';`

Rollback for File 4 (in case pre-request breaks production):

```sql
ALTER ROLE authenticator RESET pgrst.db_pre_request;
NOTIFY pgrst, 'reload config';
```

The system reverts to pre-Layer-A behavior — `_resolve_tenant_id()` returns sentinel; Garindo continues single-tenant-style.

### 4.3 Default feature bundles per plan

Seeded in File 2. Editable via `/admin` (Phase B).

| Module | STARTER | PRO | PREMIUM |
|---|---|---|---|
| `modul_kasir` | ✅ | ✅ | ✅ |
| `modul_tempo` | ❌ | ✅ | ✅ |
| `modul_pengiriman` | ❌ | ✅ | ✅ |
| `modul_multi_warehouse` | ❌ | ❌ | ✅ |
| `modul_akuntansi` | ❌ | ✅ | ✅ |
| `modul_jasa_layanan` | ❌ | ✅ | ✅ |
| `modul_bom_recipe` | ❌ | ❌ | ✅ |
| `modul_diskon_kasir` | ✅ | ✅ | ✅ |
| `modul_diskon_penjualan` | ❌ | ✅ | ✅ |
| `modul_diskon_tagihan` | ❌ | ✅ | ✅ |
| `modul_multi_tier_price` | ❌ | ❌ | ✅ |

Rationale: STARTER = warung kecil, PRO = toko + accounting + tempo, PREMIUM = distributor / multi-warehouse / manufaktur.

### 4.4 Testing before production apply

Use **Supabase local Docker** (`supabase start`) — free, unlimited, runs on laptop:

1. Apply all four migrations locally.
2. Verify: `SELECT COUNT(*) FROM tenants` = 1; `SELECT COUNT(*) FROM plans` = 3; Garindo `tenant_subscriptions` PREMIUM row exists.
3. Smoke test: read `stocks` as Garindo user via simulated auth (Section 5.4).
4. Isolation test: seed test tenant B, verify Garindo user cannot see B's rows.
5. Rollback test: `RESET pgrst.db_pre_request`, verify pre-Layer-A behavior still works.

### 4.5 Rollback plan per file

| If this breaks | Rollback |
|---|---|
| File 1 (schema) | `DROP TABLE ... CASCADE;` per new table. No production data affected. |
| File 2 (seed + backfill) | Manual: reset backfilled tenant_id columns to NULL. Garindo tenant row leftover but harmless. |
| File 3 (NOT NULL + RLS) | `ALTER TABLE ... ALTER COLUMN tenant_id DROP NOT NULL;` per table. Restore prior policies from backup. |
| File 4 (wire Layer-A) | `ALTER ROLE authenticator RESET pgrst.db_pre_request; NOTIFY pgrst, 'reload config';` |

---

## 5. RLS Audit & Isolation Test Suite

### 5.1 Table categorization

Every table in schema `public` must belong to exactly one of five categories:

| Category | Definition | Target policy shape |
|---|---|---|
| **T (tenant-scoped)** | Has `tenant_id`; data is per-tenant. | `USING (tenant_id = _resolve_tenant_id())` + FORCE RLS |
| **G (global config)** | Reference data shared across tenants (e.g., `plans`, tax reg master tables). | `USING (true)` for SELECT to authenticated; writes revoked. |
| **P (platform)** | Platform meta (e.g., `tenants`, `platform_admins`, `platform_admin_audit`). | `USING (current_setting('app.is_platform_admin', true) = 'true')` |
| **A (auth-adjacent)** | Ties to `auth.users` (e.g., `tenant_users`). | Self-row + tenant-mate visibility |
| **S (storage / RPC-only)** | Accessed only via RPCs; direct client access revoked. | Deny direct; RPC-mediated only |

The category is stamped as a table comment: `COMMENT ON TABLE stocks IS 'category=T'`. The CI gate (Section 5.5) refuses to merge if a new table is uncategorized.

### 5.2 Audit + migration generation

`scripts/generate-rls-audit-migration.ts` (new script, Deno or Node):

1. Connects to a local Supabase instance loaded with the current schema.
2. Queries `information_schema.tables`, `information_schema.columns`, `pg_policies` for schema `public`.
3. For each table:
   - If `tenant_id` column present → default category T.
   - Otherwise, look up in `scripts/rls-audit-config.yaml` (skiplist / manual overrides).
   - If neither → error out ("uncategorized table, add to config").
4. Emits SQL to `supabase/migrations/20261001000003_phase_a_not_null_and_rls.sql` (concatenated with the NOT NULL block):
   - `DROP POLICY` statements for every existing policy matching `USING (true)` or missing tenant filter.
   - `CREATE POLICY` statements per §5.3 templates.
   - `ALTER TABLE ... ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;` per T/P/A table.
   - `COMMENT ON TABLE ... IS 'category=X'` per table.
   - Grants/revokes aligned with policy.
5. Human reviews the diff before committing. This is not run as part of production migrations — the output IS the migration.

Example `rls-audit-config.yaml`:

```yaml
overrides:
  storage_objects: { category: skip, reason: 'Supabase-managed' }
  admin_users:
    category: T
    require_backfill_tenant_id: true
    note: 'POS staff table; predates tenant_id concept'
  plans: { category: G }
  tenants: { category: P }
  platform_admins: { category: P }
  platform_admin_audit: { category: P }
  tenant_users: { category: A }
```

### 5.3 Policy templates

**Category T (tenant-scoped):**

```sql
CREATE POLICY "t_select_own" ON <table>
  FOR SELECT TO authenticated
  USING (tenant_id = _resolve_tenant_id());

CREATE POLICY "t_insert_own" ON <table>
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);

CREATE POLICY "t_update_own" ON <table>
  FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);

CREATE POLICY "t_delete_own" ON <table>
  FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);

ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;
REVOKE ALL ON <table> FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO authenticated;
```

**Category P (platform):**

```sql
CREATE POLICY "p_platform_admin_only" ON <table>
  FOR ALL TO authenticated
  USING (current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_platform_admin', true) = 'true');

ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;
REVOKE ALL ON <table> FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO authenticated;
```

**Category A (auth-adjacent, e.g., `tenant_users`):**

```sql
CREATE POLICY "a_self_or_tenant_admin" ON tenant_users
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (tenant_id = _resolve_tenant_id()
        AND EXISTS (SELECT 1 FROM tenant_users me
                    WHERE me.tenant_id = tenant_users.tenant_id
                      AND me.user_id = auth.uid()
                      AND me.role IN ('owner','admin')))
  );

CREATE POLICY "a_admin_write" ON tenant_users
  FOR ALL TO authenticated
  USING (tenant_id = _resolve_tenant_id()
         AND EXISTS (SELECT 1 FROM tenant_users me
                     WHERE me.tenant_id = tenant_users.tenant_id
                       AND me.user_id = auth.uid()
                       AND me.role IN ('owner','admin')));
```

### 5.4 Cross-tenant leak test harness

Location: `tests/isolation/`. Runs in CI on every PR.

**Seed fixtures** (`tests/isolation/setup.ts`):

- Two tenants: A (`aaaa1111-...`, slug `test-a`), B (`bbbb2222-...`, slug `test-b`).
- Two users: A-user, B-user (in `auth.users` via Supabase Admin API).
- `tenant_users` rows linking each user to their tenant with role `owner`.
- `tenant_subscriptions` PREMIUM for both.
- Seed one row per T-category table for each tenant (via superuser insert bypassing RLS).

**Parametrized test** (`tests/isolation/rls-cross-tenant.test.ts`):

```typescript
import { getTablesInCategory, simulateAuth, TENANT_A, TENANT_B, USER_A } from './setup';

describe('RLS: cross-tenant isolation', () => {
  const TABLES_T = getTablesInCategory('T');

  for (const table of TABLES_T) {
    describe(table, () => {
      it('User A cannot SELECT any row of tenant B', async () => {
        await simulateAuth(USER_A, 'test-a');
        const { data } = await supabase.from(table).select('tenant_id');
        expect(data?.every(row => row.tenant_id === TENANT_A)).toBe(true);
      });

      it('User A cannot UPDATE tenant B row', async () => {
        await simulateAuth(USER_A, 'test-a');
        const { count } = await supabase.from(table)
          .update({ updated_at: new Date().toISOString() })
          .eq('tenant_id', TENANT_B);
        expect(count).toBe(0);
      });

      it('User A cannot INSERT row with tenant_id = B', async () => {
        await simulateAuth(USER_A, 'test-a');
        const { error } = await supabase.from(table)
          .insert({ tenant_id: TENANT_B, ...minimalValidRowFor(table) });
        expect(error).toBeTruthy();
      });

      it('User A cannot DELETE tenant B row', async () => {
        await simulateAuth(USER_A, 'test-a');
        const { count } = await supabase.from(table).delete().eq('tenant_id', TENANT_B);
        expect(count).toBe(0);
      });
    });
  }

  describe('Expiry', () => {
    it('Expired READONLY tenant cannot INSERT', async () => { /* ... */ });
    it('Expired GRACE tenant CAN still INSERT', async () => { /* ... */ });
    it('READONLY tenant CAN still SELECT', async () => { /* ... */ });
  });

  describe('Platform admin', () => {
    it('Platform admin CAN SELECT tenant B via impersonation', async () => { /* ... */ });
    it('Non-admin CANNOT impersonate', async () => { /* ... */ });
    it('Impersonation writes an audit row', async () => { /* ... */ });
  });
});
```

**`simulateAuth()` helper** — sets JWT claim and headers, then invokes the pre-request function:

```typescript
async function simulateAuth(userId: string, tenantSlug: string, impersonate?: string) {
  await sql`SELECT set_config('request.jwt.claims',
    ${JSON.stringify({ sub: userId })}::text, true)`;
  const headers: any = { 'x-tenant-slug': tenantSlug };
  if (impersonate) headers['x-impersonate-tenant'] = impersonate;
  await sql`SELECT set_config('request.headers',
    ${JSON.stringify(headers)}::text, true)`;
  await sql`SELECT public._pgrst_pre_request()`;
}
```

### 5.5 CI gate

`.github/workflows/isolation-audit.yml`:

- Trigger: every pull request that touches `supabase/migrations/**` or `src/**`.
- Steps:
  1. Checkout.
  2. Setup Node + Supabase CLI.
  3. `supabase start` (local Docker).
  4. Apply all migrations.
  5. Run `tests/isolation/**/*.test.ts`.
  6. Grep-check: fail if `set_config(..., false)` appears in new migration files.
  7. Grep-check: fail if a new table in `supabase/migrations/` this PR lacks a `COMMENT ON TABLE ... IS 'category=...'` and is not in `scripts/rls-audit-config.yaml`.

**Rollout:** the CI gate starts as **warn-only** (posts violations as a PR comment, does not block merge) for the first 2 weeks. After that period, tighten to hard-fail.

### 5.6 Definition of Done — Phase A

| Criterion | Bar |
|---|---|
| All existing tables categorized (T/G/P/A/S) | Every table has `COMMENT ON TABLE` tag or is in `rls-audit-config.yaml`. |
| No `TO anon USING (true)` policies remain (except storage `branding` bucket) | Grep-check passes. |
| FORCE RLS enabled on all T + P + A tables | `SELECT relname FROM pg_class WHERE relforcerowsecurity = false AND ...` returns empty. |
| Cross-tenant isolation tests pass for all T tables | Full isolation suite green in CI. |
| Expiry tests pass (ACTIVE / GRACE / READONLY) | Three explicit cases green. |
| Impersonation tests pass (admin can, non-admin cannot, audit row written) | Three cases green. |
| CI gate wired and warn-only | Job runs on every PR. |
| Backfill migrations idempotent and tested locally | Manual verify: apply twice, no error. |
| Rollback plan documented per migration file | This spec §4.5. |
| `_pgrst_pre_request` deployed and `NOTIFY pgrst` sent | Manual verify on preview. |

---

## 6. Frontend Routing & Error UX

### 6.1 Router restructure

Existing pattern (`src/lib/urlRoute.ts` + `useURLRoute` hook) parses flat routes (`dashboard`, `sales`, `stok`, etc.) from `window.location.pathname`. Refactor:

```
Legacy         →  New
/dashboard     →  /t/garindo/dashboard
/sales         →  /t/garindo/sales
/stok?sku=x    →  /t/garindo/stok?sku=x
/admin/*       →  /admin/* (unchanged; super-admin, no tenant context)
/login         →  /login (unchanged)
```

Changes to `src/lib/urlRoute.ts`:

- `useURLRoute()` returns `{ tenantSlug, screen, params, isPlatformAdminArea }`.
- Slug regex: `/^\/t\/([a-z0-9][a-z0-9-]{2,29})(\/|$)/`.
- Backward-compat window (30 days): if `pathname` matches a legacy screen name without `/t/<slug>/` prefix AND user's `tenant_users` count is exactly 1, redirect to `/t/<slug>/<screen>`. Bookmarks and pre-Phase-A email links keep working. After 30 days, the compat shim is removed.

`src/App.tsx` changes:

- Route matching updated for `/t/:slug/*`, `/admin/*`, `/login`, `/select-tenant`.
- Wrap authenticated routes with `<TenantProvider slug={tenantSlug}>`.
- Add auth gate: unauthenticated → `/login`; authenticated + no `tenant_users` → `/select-tenant` (or error); authenticated platform admin at `/` → `/admin`.

### 6.2 `TenantContext`

`src/contexts/TenantContext.tsx` (new file):

```typescript
interface TenantContextValue {
  slug: string;
  tenantId: string;
  name: string;
  expiryMode: 'ACTIVE' | 'GRACE' | 'READONLY';
  expiresAt: string;
  graceExpiresAt: string;
  effectiveFeatures: Record<string, boolean>;
  isPlatformAdmin: boolean;
  impersonating: boolean;
}

export const TenantProvider: React.FC<{ slug: string }> = ({ slug, children }) => {
  const [state, setState] = useState<TenantContextValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    resolveTenantBootstrap(slug)
      .then(setState)
      .catch(err => setError(err.code ?? 'BOOTSTRAP_FAILED'));
  }, [slug]);

  if (error) return <TenantBootstrapError code={error} slug={slug} />;
  if (!state) return <TenantBootstrapLoading />;
  return <TenantContext.Provider value={state}>{children}</TenantContext.Provider>;
};

export const useTenant = () => useContext(TenantContext);
export const useFeature = (key: string): boolean => {
  const { effectiveFeatures } = useTenant() ?? { effectiveFeatures: {} };
  return effectiveFeatures[key] ?? false;
};
```

`resolveTenantBootstrap(slug)` calls a single RPC `bootstrap_tenant_context()` that returns tenant meta + effective features + expiry state. Called once per tenant switch. In-memory cache.

### 6.3 Error taxonomy

Server error codes from Section 3.1 map to client actions:

| Server code | HTTP | Client action |
|---|---|---|
| `TENANT_NOT_FOUND` | 404 | Render `<TenantNotFound slug={slug}>`. Show "Back to login" button. |
| `TENANT_SUSPENDED` | 403 | Render `<TenantSuspended>`. Show contact-support message. |
| `NOT_A_MEMBER` | 403 | Render `<AccessDenied>`. Show logout button. |
| `SUBSCRIPTION_EXPIRED_READONLY` | 403 (write only) | Toast + read-only banner. UI write actions disabled. Read continues. |
| `MISSING_TENANT_CONTEXT` | 400 | Log to console (internal bug); redirect to `/login`. |

Implementation: `src/lib/supabaseErrorInterceptor.ts` (new file) inspects response errcodes and dispatches events consumed by top-level React error boundaries and toast infrastructure.

### 6.4 Read-only mode UI

`expiryMode === 'READONLY'`:

- Global banner at top of viewport: "⚠️ Subscription VOSI kamu expired [X hari lalu]. Mode read-only aktif. Hubungi kami untuk renew: [WA link]"
- Global CSS: `.tenant-readonly [data-write="true"] { pointer-events: none; opacity: 0.4; }`
- Class `.tenant-readonly` applied to `<body>` when `expiryMode === 'READONLY'`.
- Every write control (form submit, action buttons, deletions) gains attribute `data-write="true"`. This is a declarative pattern audit-able via grep. New write controls added in future PRs must include the attribute — enforced by a CI grep check on PRs touching write-shaped JSX (buttons with `onClick` that call mutation RPCs).
- Defense-in-depth: backend RLS `WITH CHECK` clauses block writes independently; UI is UX only.

`expiryMode === 'GRACE'`:

- Warning banner: "⚠️ Subscription expired [X hari lalu]. Read-only akan aktif dalam [7 - X] hari. Renew sekarang."
- Writes still allowed (backend does not raise `SUBSCRIPTION_EXPIRED_READONLY` during grace).

### 6.5 `/admin` skeleton

`src/components/admin/AdminShell.tsx` (new, minimal for Phase A):

- Route `/admin/*` — no `TenantProvider`, no `x-tenant-slug` header injection.
- Auth gate: on mount, calls RPC `is_platform_admin()` → if `false`, redirect to `/login`.
- Placeholder screens: "Tenants — coming Phase B", "Plans — coming Phase B", "Audit log — coming Phase B".
- Impersonation control (Phase A must-have): input to type a tenant slug → sets local state `impersonating = slug` → navigates to `/t/<slug>/dashboard`. The client-side `getImpersonateSlug()` returns this value, injecting `x-impersonate-tenant` header on all subsequent Supabase calls. Exit impersonation: button in the header banner that clears state and navigates back to `/admin`.

### 6.6 Login routing

```
User opens erpapp.id → redirect to /login (if unauthenticated)
Login OTP success →
  ├─ platform_admin? → /admin
  ├─ tenant_users count = 1 → /t/<slug>/dashboard
  └─ tenant_users count > 1 → /select-tenant (picker)
```

`/select-tenant` (new, minimal): lists tenants the user belongs to (joined `tenant_users` × `tenants`). Click → navigate. MSME users typically have exactly one, so this screen is rarely reached but must exist.

### 6.7 Files touched — frontend scope estimate

| File | Change | LOC est. |
|---|---|---|
| `src/lib/urlRoute.ts` | Parse `/t/<slug>/*` + legacy redirect | ~30 |
| `src/App.tsx` | Wire `TenantProvider`, add `/admin`, `/select-tenant` routes | ~50 |
| `src/lib/supabaseClient.ts` | Header injection + `companySettingsService` refactor + `resolveTenantBootstrap` RPC wrapper | ~40 |
| `src/contexts/TenantContext.tsx` | New | ~80 |
| `src/components/AuthScreen.tsx` | Post-login routing decision | ~20 |
| `src/lib/supabaseErrorInterceptor.ts` | New | ~60 |
| `src/components/errors/{TenantNotFound,TenantSuspended,AccessDenied,TenantBootstrapError}.tsx` | New | ~80 |
| `src/components/admin/AdminShell.tsx` | New, minimal | ~80 |
| `src/components/ReadonlyBanner.tsx`, `src/components/GraceBanner.tsx` | New | ~50 |
| `src/types.ts` | `DbCompanySettings` shape update | ~10 |
| `src/components/PengaturanScreen.tsx`, `src/components/StockManagerScreen.tsx`, `src/components/stok/*.tsx` | Remove `.eq('id', 1)` calls | ~15 |

Total: ~500–700 LOC net change.

---

## 7. Testing, Rollout, Risks

### 7.1 Testing pyramid

| Level | What | Where | Runtime |
|---|---|---|---|
| DB-unit (pgTAP) | `_pgrst_pre_request()` branches, `_guard_expiry_write()`, `sync_tenant_settings_from_subscription()` | `supabase/tests/pgtap/phase_a_*.sql` | seconds |
| Vitest unit | `urlRoute` parser, `TenantContext` bootstrap, `supabaseErrorInterceptor` | `src/**/*.test.tsx` | <30s |
| Integration | Refactored `companySettingsService`, `tenant_users` role gates, plan-override sync | `tests/integration/*.test.ts` (new folder) | 1–2 min |
| Isolation harness | Parametrized cross-tenant leak per T table (§5.4) | `tests/isolation/*.test.ts` | 2–5 min |
| Migration replay | Apply all four Phase A migrations on fresh DB, assert schema matches | `scripts/verify-migrations.sh` | 1 min |

**Playwright E2E is deferred to Phase B** (when admin panel UI needs coverage). Phase A relies on manual smoke test checklist (~30 min per release).

### 7.2 Rollout plan — 4 days

**Day 1 — Schema + platform tables on local + preview**

- Apply migration files 1 & 2 on local Supabase Docker.
- Verify: all 7 new tables + view present; Garindo tenant + PREMIUM subscription seeded.
- Apply on preview Supabase project (shared free-tier project); smoke read of `stocks` works.
- Halt gate: preview smoke clean → proceed to Day 2.

**Day 2 — Backfill + RLS hardening**

- Apply file 3 on local + preview.
- Run isolation test suite on local (all T tables): must be all green.
- Run migration replay verification.
- Halt gate: green isolation suite + no unexpected leaks → proceed.

**Day 3 — Wire Layer-A + FE refactor**

- Apply file 4 on preview.
- Deploy FE (`TenantContext`, `x-tenant-slug` header, error interceptor, `/admin` skeleton, read-only banner) to preview Cloud Run.
- Manual smoke on preview: login as Garindo user, navigate every existing screen, confirm no regression.
- Halt gate: manual smoke green → proceed to Day 4.

**Day 4 — Production apply + monitoring**

- Merge preview to `main` branch.
- Apply all four migrations to production Supabase, sequential, monitor logs per step.
- Deploy FE to production Cloud Run.
- Monitor for 4 hours: error logs, Supabase advisor output, isolation-audit CI job on subsequent PRs.
- Success criteria (Section 7.5) validated.

### 7.3 Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ~~`pgrst.db_pre_request` may not persist on Supabase Cloud~~ **CONFIRMED unavailable; pivoted to Auth Hook (§3.1)** | — | — | **Resolved via architecture pivot.** Task 0 spike verified Supabase Cloud does not honor the setting. Design now uses `custom_access_token_hook` instead — officially supported, zero per-request overhead. Spike report: `docs/superpowers/spikes/2026-07-03-phase-a-architecture-spike.md`. |
| **Auth Hook not registered in Supabase Dashboard** (manual step) | LOW | HIGH | Migration files 1–5 create the SQL function, but Supabase Dashboard → Authentication → Hooks → Custom Access Token must be toggled ON manually and pointed at `public.custom_access_token_hook`. Rollout checklist (§7.2 Day 4) includes this step explicitly. Missing this = login works but JWT lacks tenant claim → all RLS returns empty. |
| **JWT claim staleness on plan/subscription changes** | MEDIUM | LOW | User's JWT is baked at login; a super-admin changing that user's plan won't reflect until the next JWT refresh (typically 1 hour). Mitigation: Supabase realtime broadcast to prompt affected clients to call `refreshSession()`. Acceptable for MSME context where plan changes are rare. |
| **`SECURITY DEFINER` + `BYPASSRLS` role bypasses FORCE RLS** (§3.5.2) | HIGH | **CRITICAL — cross-tenant leak** | **Ownership migration** (plan Task 8.5): create `vosi_rpc_owner` role WITHOUT `BYPASSRLS`; `ALTER FUNCTION ... OWNER TO vosi_rpc_owner` for the 163 tenant-touching RPCs verified in spike. Belt-and-suspenders: explicit `WHERE tenant_id = _resolve_tenant_id()` in high-risk RPC bodies. |
| **Auto-wrap regex misses `DECLARE`-block RPCs silently** | ~~HIGH~~ → LOW | HIGH | **Regex verified in spike (Task 0 Step 2).** Line-anchored `\nBEGIN\n` correctly wraps `_apply_price_change` (a real DECLARE RPC). Spike also confirmed 112 of 162 SECDEF+write RPCs use DECLARE — so the fix is essential. |
| Existing RPC with SECURITY DEFINER bypasses tenant filter (residual after ownership migration) | LOW (post-fix) | HIGH | Task 8.5 also audits RPC bodies for tenant filter; high-risk RPCs (record_kasir_sale, create_tempo_invoice, receive_po, etc.) get explicit filters even after ownership fix. |
| Existing data with `tenant_id` values other than sentinel/NULL | MEDIUM | HIGH | Pre-migration query `SELECT DISTINCT tenant_id FROM <table>` per table. Manual investigation if non-Garindo UUIDs surface. Skeptic script fails migration if unexpected values found. |
| `kasir_transactions` — currently uses anon writes | MEDIUM | HIGH | Field-check whether POS device uses anon key or an authenticated kiosk user. If anon → RLS tightening breaks POS flow. Resolution: introduce a tenant-scoped kiosk service user; POS device authenticates as that user. Track as Phase A blocker before tenant #2 real go-live. |
| `admin_users` (POS staff) — schema pre-tenant, `anon USING (true)` | HIGH | MEDIUM | Category T treatment: add `tenant_id`, backfill Garindo, tighten RLS. Frontend `UserManagementScreen` refactor is minor. Included in migration file 2 backfill block. |
| Write RPC misses `_guard_expiry_write()` (auto-wrap script imperfect) | LOW | MEDIUM | Auto-wrap script inspects `pg_proc.prosrc` for INSERT/UPDATE/DELETE/TRUNCATE. RLS `WITH CHECK _guard_expiry_write() IS NULL` is the defense-in-depth net. |
| Backend Go bypasses Layer-A | MEDIUM | MEDIUM | Post-Phase-A polish task (§3.7). Each Go handler must `SET LOCAL app.current_tenant_id` at transaction start. Blocker before tenant #2 real go-live. |
| Storage `branding` bucket is public — logo files shared globally | LOW | LOW | Acceptable in Phase A (logo not sensitive). Phase C: per-tenant bucket + signed URLs if branding becomes competitive. |
| Grace/expiry timezone edge case | LOW | LOW | Supabase Postgres server TZ = UTC. Function forces `SET TIME ZONE 'UTC'`. Test at `expires_at = today, current local time = 23:00 Jakarta`. |

### 7.4 Open questions confirmed / pending

Resolved during brainstorming:

1. URL model — path prefix `/t/<slug>/*`, custom domain deferred to Phase C.
2. Feature model — hybrid plans + per-tenant JSONB overrides.
3. Super-admin auth — `platform_admins` allowlist + Supabase Auth OTP + **impersonation via RPC + JWT refresh** (was: header; changed after Task 0 spike pivot to Auth Hook).
4. Onboarding UX — super-admin fills, tenant just logs in via magic link (no wizard).
5. Expiry behavior — 7-day grace (full write) → read-only permanent.
6. Data import scope — 4 entities (products, customers, suppliers, kas/bank), Excel template only. **Phase B.**
7. Testing infra — Supabase local Docker (no paid branching).
8. Migration bundle — 4 files, warn-only CI initially.
9. `platform_admin_audit` — write inserts in Phase A; view UI in Phase B.
10. `tenant_activity_daily` — schema only, populator in Phase C.

Pending confirmation (address during implementation kickoff):

- `kasir_transactions` POS device auth model — field-check needed before RLS tightening.
- Backend Go audit scope — Phase A polish or Phase B blocker?
- Additional non-Garindo `auth.users` who currently access the system — confirm the full `tenant_users` seed list for File 2 migration.

### 7.5 Success metrics

- Zero cross-tenant data incident within 30 days post-ship.
- Onboarding tenant #2 (dummy, via SQL insert) end-to-end: < 2 min.
- Zero regression complaints from Garindo users within 7 days post-ship.
- Isolation test suite runtime: < 5 min (CI budget).
- Latency overhead of `_pgrst_pre_request()`: < 5 ms p95 (measured via Supabase logs).

### 7.6 Free-tier alignment (honest note)

Phase A adds no paid-service dependency **at build time**. All build-time resources fit within free tier: Supabase free (500 MB DB, 1 GB storage, 50k MAU), Cloud Run free (2M req/mo), GitHub Actions free (2000 min/mo private), pgTAP embedded, Vitest, Supabase local Docker. Playwright E2E, Supabase Branching, billing (Stripe/Xendit) are deferred.

**However — production reality on free tier has landmines:**

1. **Supabase free-tier auto-pauses the database after 7 days of inactivity.** For a solo-founder MSME with 1–2 early tenants, a 7-day quiet stretch is realistic. When paused, all logins fail with cryptic errors until manually resumed via dashboard. This is a **customer-facing UX disaster** for a real SaaS.
2. **500 MB DB cap** — Garindo's current data (sales history + kasir + pembelian ledger) likely already consumes ~100–300 MB. Adding 1 more MSME tenant (typical size 50–150 MB after 6 months) pushes into cap territory.
3. **2 GB storage cap** — logos, PDF invoices, product images. Realistic 1-year runway for 2–3 tenants.
4. **Supabase free project cap of 2** — using free-tier + a preview project consumes both slots.

**Honest recommendation:** the design *fits* free tier at build time, but running a **real production SaaS** requires upgrading Garindo's production DB to **Supabase Pro ($25/month)** at go-live of tenant #2 for real. This kills auto-pause, raises limits, and enables branch environments. The design does NOT require code changes when upgrading — it is billing-only.

**Do not promise "free forever" to onboarded tenants.** Phase A ships on free tier for development / testing; production go-live decision is a separate founder call per `feedback_cost_upgrade_approval` memory — flagged here so the decision isn't a surprise.

### 7.7 Effort estimate

Approximately 2–2.5 weeks solo focused work (post-spike + pivot):

| Component | Days |
|---|---|
| ~~Task 0: Architecture spike~~ | ~~1~~ (done: ~30 min) |
| Migration files 1–4 (schema, seed, backfill, RLS) | 3 |
| RLS audit script (`generate-rls-audit-migration.ts`) + manual review | 2 |
| `custom_access_token_hook` + `_resolve_tenant_id` rewrite + `_guard_expiry_write` + `impersonate_tenant`/`stop_impersonation` RPCs + bulk auto-wrap | 1 |
| **Task 8.5: SECURITY DEFINER ownership migration + high-risk RPC patches** | 2 |
| Frontend: TenantContext, URL refactor, error interceptor, read-only banner (no more header injection — simpler) | 2.5 |
| `companySettingsService` refactor + affected screen updates | 1 |
| pgTAP + Vitest tests (hook branches replace pre-request branches) | 2 |
| Isolation test harness + fixtures + CI wiring | 2 |
| Manual smoke + rollout (Supabase Dashboard hook registration + halt-gate deploys) | 1 |

Total ~16.5 days. **2 weeks full-time or 3 weeks part-time**. The pivot to Auth Hook shaved ~1.5 days (simpler frontend + simpler DB function) from the pre-pivot 18-day estimate.

---

## 8. Phase B & C — Explicit Deferrals

For clarity on what is NOT in Phase A:

**Phase B — Admin Panel & Onboarding UX**

- `/admin` full UI (list tenants, create tenant form, edit tenant, plan management, feature toggle grid, subscription renewal, audit log viewer, impersonate button in tenant list).
- Onboarding form: pick plan → auto-tick features → per-feature manual override → OTP invite email to tenant owner.
- Data import wizard: 4 Excel templates (products, customers, suppliers, kas/bank) with preview/validation/commit/rollback.
- `useFeature()` frontend hook driven by `v_tenant_effective_features`; write-path RPC feature gates (RPC-level rejection of writes to disabled modules).
- Renewal UI + expiration warning banners refined.

**Phase C — Later**

- Custom domain per tenant (`tenants.custom_domain`) with DNS verification + wildcard SSL + reverse proxy.
- Billing / subscription — Stripe or Xendit integration; `tenant_activity_daily` populator; automated renewal invoicing.
- Self-serve tenant signup with anti-abuse (captcha, email verify, rate limit).
- Multi-region readiness.
- Per-tenant `branding` bucket + signed URL access.

---

## 9. Related Documents & Prior Art

- Existing `_resolve_tenant_id()` helper: `supabase/migrations/20260614000011_resolve_tenant_helper.sql`.
- Existing `tenant_settings`: `supabase/migrations/20260622000003_tenant_settings_table.sql`.
- Existing `admin_users` (POS staff, category T after Phase A): `supabase/migrations/20260603000003_admin_users.sql`.
- Existing `company_settings`: `supabase/migrations/20260603000001_company_settings.sql` + `20260607000002_company_settings_logo.sql` + `20260616000020_company_settings_costing_method.sql`.
- Vosi product positioning: `docs/vosi-landing/2026-06-04-vosi-landing-page-design.md`.
