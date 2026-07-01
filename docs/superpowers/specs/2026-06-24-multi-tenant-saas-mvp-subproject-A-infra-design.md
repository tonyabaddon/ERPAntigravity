# Multi-Tenant SaaS MVP — Sub-Project A: Tenant Infrastructure

> **Status:** Design (locked decisions, ready for writing-plans)
> **Date:** 2026-06-24
> **Owner:** Tony (tonywei.office@gmail.com)
> **Parent vision:** Onboard customer #2 (post-Garindo) tanpa retrofit. VOSI bisa onboard tenant + assign scope + plan semester/yearly. Tenant Garindo zero impact selama migrasi.
> **Sibling specs (akan dibuat):**
> - Sub-Project B — VOSI Admin Panel (assign scope, list tenant, super-admin role)
> - Sub-Project C — Plan & Billing MVP (semester/yearly, grace, suspension, manual payment)

---

## 1. Goal & Success Criteria

### Goal

Transformasi backend dari **single-tenant Garindo hardcoded** menjadi **multi-tenant infrastructure** yang siap menerima tenant baru lewat satu RPC `create_tenant()` — dengan URL terpisah (`<slug>.vosi.id`), data isolation enforced di RLS layer, dan **zero downtime/regression untuk Garindo** sepanjang migrasi.

### Success criteria (acceptance)

1. **Tenant baru bisa di-provision via SQL:** `SELECT public.create_tenant('tokopanelxyz', 'owner@example.com', 'Toko Panel XYZ');` membuat tenant row + admin user + seed COA + default tenant_settings.
2. **Garindo invariance:** Setelah semua phase rollout, smoke test full kasir-to-laporan flow Garindo masih jalan tanpa code change di frontend.
3. **Data isolation enforced di DB layer:** Login sebagai user tenant A, query semua tabel business — tidak boleh ada baris tenant B di hasil. Cross-tenant isolation test pass.
4. **Subdomain routing live:** `garindo.vosi.id` load Garindo, `tokopanelxyz.vosi.id` load tenant baru. Akar `vosi.id` = landing/redirect. Reserved subdomain (`www`, `admin`, `api`, dst) tidak bisa diambil tenant.
5. **Per-tenant Supabase Auth:** Login terisolasi per tenant subdomain. Session cookie scoped ke subdomain.
6. **WA backend tenant-aware:** Incoming WA message di-route ke tenant berdasarkan nomor WA tujuan (lookup `wa_numbers.tenant_id`).
7. **Storage isolation:** File upload (invoice PDF, payment proof, foto produk) path = `<tenant_id>/...`, bucket policy enforce.
8. **Sequence per tenant:** Invoice number sequence (`record_kasir_sale`, `create_sales_order`, dst.) reset & isolated per tenant.

### Non-goals (explicit out-of-scope, defer ke sub-project lain)

- **VOSI Admin Panel UI** — sub-project B
- **Plan tier billing + payment flow** — sub-project C
- **Tenant self-serve signup** — Phase 4 GTM
- **Tenant switcher UI** (multi-tenant per user) — Phase 4
- **Custom domain support** (`app.garindo.co.id` CNAME) — Phase 4
- **Migration tooling Excel/Jurnal import** — sub-project tersendiri MVP-closure
- **Cross-tenant consolidation reports** — Phase 4
- **CSM/observability dashboard** — Phase 4
- **Backup/restore per-tenant** — Phase 4
- **OAuth server Mekari-style** (`account.vosi.id`) — defer sampai multi-product portfolio terjadi
- **Compliance (PPN/e-Faktur/PPh/SPT)** — defer total per Q1/Q8 PRD

---

## 2. Architecture

### 2.1 Data model — new tables

```sql
-- Tenant root
CREATE TABLE public.tenants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT UNIQUE NOT NULL,           -- subdomain segment, e.g. 'garindo'
  display_name TEXT NOT NULL,                  -- e.g. 'Garindo Jaya Panel'
  status       TEXT NOT NULL DEFAULT 'ACTIVE'  -- ACTIVE | SUSPENDED | ARCHIVED
                 CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at  TIMESTAMPTZ
);
CREATE INDEX idx_tenants_slug ON public.tenants(slug) WHERE status = 'ACTIVE';

-- Slug constraints: lowercase, alphanumeric+dash, 3-30 chars, NOT in reserved list
ALTER TABLE public.tenants
  ADD CONSTRAINT slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$');

-- Reserved subdomains (enforced via trigger on insert)
CREATE TABLE public.reserved_subdomains (
  slug TEXT PRIMARY KEY  -- 'www', 'admin', 'api', 'app', 'staging', 'auth', 'mail',
                          -- 'support', 'help', 'docs', 'blog', 'status', 'vosi'
);

-- User ↔ Tenant mapping (1 user = 1 tenant for MVP)
CREATE TABLE public.tenant_users (
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'owner'
                 CHECK (role IN ('owner', 'admin', 'staff', 'viewer', 'superadmin')),
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
-- MVP constraint: 1 user appears in at most 1 tenant_users row (besides superadmin)
CREATE UNIQUE INDEX idx_tenant_users_one_per_user
  ON public.tenant_users(user_id)
  WHERE role <> 'superadmin';
```

### 2.2 Data model — modify existing tables

**~25-30 business tables get `tenant_id UUID NOT NULL`.** List final ditentukan di plan execution; awal scan:

```
Sales: orders, kasir_transactions, sales_orders, customers, leads, conversations
Inventory: products, stocks, stock_movements, stock_lots, warehouses, stock_opname_*
Purchasing: purchase_orders, suppliers, tagihan, payments, bnl, tukar_faktur, replacements
Accounting: chart_of_accounts, journal_entries, journal_entry_lines, accounting_config,
            cash_accounts, fiscal_periods, opening_balances
System: approval_requests, admin_users, wa_numbers, permissions, notification_settings,
        tenant_settings (already nullable tenant_id → make NOT NULL)
```

**Migration pattern per tabel:**
```sql
-- 1. Add nullable column
ALTER TABLE public.<table> ADD COLUMN tenant_id UUID
  REFERENCES public.tenants(id) ON DELETE RESTRICT;

-- 2. Backfill existing rows to Garindo
UPDATE public.<table> SET tenant_id = (SELECT id FROM tenants WHERE slug = 'garindo')
  WHERE tenant_id IS NULL;

-- 3. Lock down to NOT NULL
ALTER TABLE public.<table> ALTER COLUMN tenant_id SET NOT NULL;

-- 4. Index for RLS performance
CREATE INDEX idx_<table>_tenant ON public.<table>(tenant_id);

-- 5. RLS policy
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY <table>_tenant_isolation ON public.<table>
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
```

### 2.3 Helper functions

```sql
-- Resolve current tenant from auth.uid()
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT tenant_id FROM public.tenant_users
    WHERE user_id = auth.uid() AND role <> 'superadmin'
    LIMIT 1;
$$;

-- Superadmin bypass check (VOSI only)
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.tenant_users
      WHERE user_id = auth.uid() AND role = 'superadmin'
  );
$$;
```

RLS policy extended untuk superadmin:
```sql
CREATE POLICY <table>_tenant_isolation ON public.<table>
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_superadmin())
  WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_superadmin());
```

### 2.4 RPC sweep strategy (136 SECURITY DEFINER files)

Tiap RPC dengan SECURITY DEFINER perlu:
1. **Resolve tenant**: `v_tenant_id := public.current_tenant_id();` di awal RPC.
2. **Assert referenced rows in same tenant**: setiap FK lookup di-AND-kan dengan `AND tenant_id = v_tenant_id`.
3. **Inject `tenant_id`** di setiap INSERT.
4. **Reject NULL tenant** (kalau RPC dipanggil tanpa session tenant valid).

Pattern boilerplate:
```sql
CREATE OR REPLACE FUNCTION public.record_kasir_sale(...) RETURNS ...
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tenant_id UUID := public.current_tenant_id();
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant context required' USING ERRCODE = '42501';
  END IF;
  -- ... existing logic, but every SELECT/INSERT/UPDATE includes tenant_id
END;
$$;
```

### 2.5 Sequence per tenant

Current pattern (mis. `next_sales_order_number(channel, date)`) — rebuild jadi `next_sales_order_number(tenant_id, channel, date)`. Hold counter di tabel `sequences`:

```sql
CREATE TABLE public.sequences (
  tenant_id UUID NOT NULL,
  scope     TEXT NOT NULL,   -- e.g. 'SO-WLK-20991201'
  next_val  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, scope)
);
```

### 2.6 Storage isolation

Supabase Storage buckets:
- `invoices` → path: `<tenant_id>/SO-WLK-20991201-002.pdf`
- `payment-proofs` → path: `<tenant_id>/PO-20260601-001.jpg`
- `product-photos` → path: `<tenant_id>/<sku>.jpg`

Bucket RLS policy:
```sql
CREATE POLICY tenant_storage_isolation ON storage.objects
  FOR ALL TO authenticated
  USING (
    (storage.foldername(name))[1]::uuid = public.current_tenant_id()
    OR public.is_superadmin()
  );
```

Frontend file upload helpers (`uploadInvoicePdf`, `uploadPaymentProof`) di-update untuk auto-inject tenant_id prefix.

### 2.7 WhatsApp backend routing (backend-go)

Current state: `wa_numbers` table holds Garindo's WA numbers; webhook routes by number → conversation.

Change: tambah `tenant_id` ke `wa_numbers`. Incoming message handler:
```go
func RouteIncoming(msg WAMessage) {
    waNum := msg.To
    tenant, err := db.QueryRow("SELECT tenant_id FROM wa_numbers WHERE phone = $1", waNum).Scan(&tenantID)
    if err != nil { /* drop msg, log */ return }
    ctx := WithTenant(ctx, tenant)
    handleMessage(ctx, msg)
}
```

Semua AI prompt builder, conversation state, lead creation menerima `tenant_id` dari context. Supabase service-role client tetap, tapi semua INSERT inject `tenant_id`.

### 2.8 Frontend bootstrap

```typescript
// src/lib/tenant/bootstrap.ts
function detectTenantSlug(): string | null {
  const hostname = window.location.hostname;
  // 'garindo.vosi.id' → 'garindo'
  // 'localhost' or '127.0.0.1' → from ?tenant= query param (dev mode)
  if (hostname === 'vosi.id' || hostname === 'www.vosi.id') return null; // landing
  const parts = hostname.split('.');
  if (parts.length >= 3 && parts.slice(-2).join('.') === 'vosi.id') {
    const slug = parts[0];
    if (RESERVED.has(slug)) return null;
    return slug;
  }
  // local dev fallback
  return new URLSearchParams(location.search).get('tenant');
}

// App.tsx mount
const slug = detectTenantSlug();
if (!slug) {
  window.location.href = 'https://vosi.id'; // marketing landing
  return null;
}
const tenant = await fetchTenantBySlug(slug);
if (!tenant || tenant.status !== 'ACTIVE') {
  return <TenantUnavailableScreen />;
}
// Pass tenant to context, Supabase Auth uses tenant.id for session resolution
```

Supabase Auth redirect URL whitelist: `https://*.vosi.id/auth/callback`. Supabase project dashboard mendukung wildcard.

### 2.9 Cookie & auth scope

Per Opsi 1: setiap subdomain memiliki Supabase Auth session terisolasi.
- Cookie name: `sb-<project-ref>-auth-token`
- Scope: tenant subdomain only (default Supabase behavior dengan `cookieOptions.domain` tidak di-set).
- Owner Garindo login di `garindo.vosi.id` — session tidak terlihat di `tokopanelxyz.vosi.id`.

---

## 3. Phased Rollout Plan

Tiap phase = 1 PR. Tiap PR Garindo tetap operasional. Smoke test full Garindo flow setiap phase.

| Phase | Scope | Smoke test sebelum merge |
|---|---|---|
| **A.0 Foundation** | `tenants` + `tenant_users` + `reserved_subdomains` + `current_tenant_id()` + `is_superadmin()` helpers. Seed Garindo + Garindo owner di tenant_users. **`tenant_settings.tenant_id` ALTER NOT NULL & backfill Garindo.** Tidak ada RLS yet. | Garindo login, semua screen jalan (zero behavior change). |
| **A.1 Auth & Routing** | Frontend subdomain detection + `fetchTenantBySlug` + `TenantContext` provider. Supabase Auth redirect whitelist `*.vosi.id`. Hosting: setup Vercel (atau Cloud Run+LB) + DNS wildcard + SSL. | `garindo.vosi.id` load Garindo, login flow OK. Local dev (`localhost?tenant=garindo`) jalan. |
| **A.2 Sales domain** | `tenant_id` ke `orders`, `kasir_transactions`, `sales_orders`, `customers`, `leads`, `conversations`. RLS. Sweep RPC: `record_kasir_sale`, `record_kasir_sale_v2`, `create_sales_order`, `close_sales_order`, `mark_sales_order_converted`, `mark_lunas`, `record_piutang_payment`, `mark_walkin_order_paid`. Per-tenant invoice sequence. Cross-tenant isolation test (faux tenant B). | Garindo: catat penjualan walkin/tokped/grosir, mark lunas, piutang flow, sales order. Tidak ada regresi. |
| **A.3 Inventory domain** | `tenant_id` ke `products`, `stocks`, `stock_movements`, `stock_lots`, `warehouses`, opname-related. RLS. Sweep RPC: `seed_stock_row`, `record_stock_adjustment`, opname RPCs, `transfer_warehouse`. | Garindo: stock adjust, opname session, transfer atas↔bawah. Tidak regresi. |
| **A.4 Pembelian domain** | `tenant_id` ke `purchase_orders`, `suppliers`, `tagihan`, `payments`, `bnl`, `tukar_faktur`, `replacements`. RLS. Sweep RPC: `record_po`, `record_pi`, `record_pembayaran`, BNL RPCs, TF RPCs. | Garindo: PO → receive → tagihan → bayar → BNL → TF cycle. Tidak regresi. |
| **A.5 Akuntansi domain** | `tenant_id` ke `chart_of_accounts`, `journal_entries`, `journal_entry_lines`, `accounting_config`, `cash_accounts`, `fiscal_periods`, `opening_balances`. RLS. Sweep RPC: `_post_journal_entry`, `close_fiscal_period`, `close_fiscal_year`, manual JE, COA update, opening balance wizard. Views (`trial_balance`, `cash_account_balances`) tenant-scoped. | Garindo: Trial Balance balance, P&L period, Neraca balance, Cash Flow, manual JE, close period. Tidak regresi. |
| **A.6 System & wrap-up** | `tenant_id` ke `approval_requests`, `admin_users`, `wa_numbers`, `notification_settings`, `permissions`, dst. RLS. Sweep RPC: approval workflow, owner PIN, notification settings. Storage bucket migration + RLS. backend-go WA routing. `tenant_settings` final RLS (drop singleton index). | Garindo: full end-to-end (penjualan → akuntansi → laporan). WA AI test message route correctly. File upload PDF/foto OK. |
| **A.7 Tenant creation RPC + isolation tests** | `create_tenant(slug, owner_email, display_name)` RPC: insert tenant + seed default COA + tenant_settings + invite owner user via Supabase admin API. Suite cross-tenant isolation tests (Pattern C smoke): create faux Tenant B, write data both sides, assert RLS blocks cross-read/write. | Provision faux tenant via RPC, smoke kasir sale di tenant B, verify Garindo unaffected. |

**Estimated effort:** 4-5 minggu engineering focused (1 dev). Bisa parallel A.2/A.3/A.4 setelah A.0+A.1 selesai kalau ada 2 dev.

---

## 4. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **RPC sweep miss satu function** — kasir sale Garindo tiba-tiba inject tenant_id NULL → constraint violation | Per phase: list semua RPC affected, mark off satu-satu. Smoke test per phase WAJIB ke Garindo data. Phase A.6 cross-tenant isolation test = final guard. |
| **RLS policy bug** — Garindo user lihat data tenant lain | Pattern C smoke test pada setiap phase. Dedicated isolation test suite di A.7. Code review: tiap policy harus pakai `current_tenant_id()`, no `auth.uid()` directly. |
| **Sequence collision** — invoice number duplicate setelah split | Schema sequence table `(tenant_id, scope, next_val)` PRIMARY KEY (tenant_id, scope). Migrasi: backfill Garindo current max → next_val. |
| **Subdomain DNS / SSL setup error** — `garindo.vosi.id` tidak jalan saat cutover | Setup di staging dulu (`*.staging.vosi.id`). Cutover production hanya setelah staging OK. Punya rollback DNS plan. |
| **Vercel migration risk** — build/deploy gagal | Phase A.1 isolated: setup Vercel parallel dengan Cloud Run existing. Test deploy di staging. Cutover DNS hanya saat Vercel build verified. Cloud Run tetap warm sebagai fallback selama 1 minggu. |
| **WA backend regression** — message Garindo nyasar | backend-go `wa_numbers` lookup test. Fallback: kalau tenant_id NULL di wa_numbers, default ke Garindo (transition mode) — remove fallback setelah A.6 settled. |
| **Storage path migration** — old file path tanpa tenant prefix | Phase A.6 migration script: move existing Garindo files dari root ke `<garindo_tenant_id>/...`. Storage policy support legacy path read sampai migration complete. |
| **Realtime subscription leak** — Supabase Realtime broadcast cross-tenant | Realtime channels named per tenant_id (`tenant:<uuid>:approvals`). RLS-enforced (Realtime respects RLS). Audit all `supabase.channel()` calls. |
| **VOSI superadmin RLS bypass exploit** | `is_superadmin()` checks `tenant_users.role = 'superadmin'`. Grant superadmin role hanya via direct SQL (no UI), audited. VOSI account login pakai 2FA mandatory. |

---

## 5. Migration Order Verification

Sebelum phase merge, smoke test minimum:

```sql
-- Pattern C: simulate Garindo user, run Garindo's most common RPC
DO $$
DECLARE
  v_garindo_user uuid := (SELECT user_id FROM tenant_users tu
                            JOIN tenants t ON t.id = tu.tenant_id
                            WHERE t.slug = 'garindo' AND tu.role = 'owner' LIMIT 1);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_garindo_user::text, true);
  -- e.g. for Phase A.2:
  PERFORM record_kasir_sale(...);  -- with realistic Garindo payload
  -- assert resulting kasir_transaction.tenant_id = Garindo tenant
  -- assert RLS blocks select dengan user tenant lain
  RAISE EXCEPTION 'rollback for smoke test'; -- per memory pattern
END $$;
```

Cross-tenant isolation final test (Phase A.7):
```sql
-- Create faux Tenant B + user_b
-- Login as user_b, run record_kasir_sale → should write only Tenant B rows
-- Login as Garindo user → should NOT see Tenant B data anywhere
-- Login as VOSI superadmin → can see both
```

---

## 6. Infrastructure Tasks (out of code)

1. **DNS:** Beli `vosi.id` (kalau belum). Setup CNAME `*.vosi.id` → Vercel (atau A record kalau Cloud Run+LB).
2. **SSL:** Vercel auto-provision wildcard cert. Cloud Run path: provision Google-managed wildcard cert.
3. **Hosting:** Setup Vercel project, connect repo, env vars (`VITE_SUPABASE_URL`, dst.). Verify build success.
4. **Supabase Auth dashboard:** Add `https://*.vosi.id/auth/callback` to redirect URL whitelist. Optionally email template branding per-tenant (Phase 4).
5. **Reserved subdomain list seed:** `www`, `admin`, `api`, `app`, `auth`, `staging`, `mail`, `support`, `help`, `docs`, `blog`, `status`, `vosi`, `test`, `dev`.

---

## 7. Frontend Changes Summary

- `src/lib/tenant/bootstrap.ts` (NEW): subdomain detection, tenant config fetcher
- `src/lib/tenant/TenantContext.tsx` (NEW): React context for current tenant
- `src/App.tsx`: mount tenant bootstrap before AuthScreen
- `src/components/AuthScreen.tsx`: pass tenant_id ke Supabase Auth call
- `src/lib/supabaseClient.ts`: pakai tenant_id di session metadata (kalau perlu)
- Reserved subdomain handler: redirect `vosi.id` ke landing page; `admin.vosi.id` ke superadmin (sub-project B)
- `src/components/TenantUnavailableScreen.tsx` (NEW): suspended/archived tenant page

---

## 8. Backend (backend-go) Changes Summary

- `wa_numbers` table query needs tenant_id in WHERE clause (auto via RLS service-role bypass — need to manually scope).
- Incoming WA webhook handler: extract `to` phone → lookup `wa_numbers.tenant_id` → context propagate.
- All Supabase service-role calls inject `tenant_id` di SET LOCAL atau di-WHERE.
- Tests: write to faux Tenant B via service role, assert isolation.

---

## 9. Out-of-Scope Reminders (jangan terseret)

- ❌ Jangan build VOSI Admin Panel UI di Sub-Project A (B).
- ❌ Jangan build plan billing flow (C).
- ❌ Jangan refactor existing screens kecuali butuh tenant context.
- ❌ Jangan implement OAuth server (Mekari pattern) — defer.
- ❌ Jangan tambah multi-tenant per user / switcher.
- ❌ Jangan tambah PPN/e-Faktur fitur.
- ❌ Jangan support custom domain (CNAME). Phase 4.

---

## 10. Definition of Done

- [ ] Phase A.0–A.7 semua merged ke main.
- [ ] Smoke test Garindo full flow (Pattern C) pass di semua phase.
- [ ] Cross-tenant isolation test suite pass (Tenant A read/write tidak terlihat di Tenant B; vice versa; superadmin lihat semua).
- [ ] `create_tenant()` RPC functional: provisioning faux tenant 3-5 detik, COA seeded, default settings present.
- [ ] `garindo.vosi.id` live (DNS + SSL + Vercel deploy).
- [ ] Login flow per subdomain test OK.
- [ ] backend-go WA routing test: 2 nomor WA, 2 tenant, no cross-talk.
- [ ] Storage bucket policy enforced (manual test: tenant A upload, tenant B URL request → 403).
- [ ] `progress.md` updated dengan summary phase A.0–A.7.
- [ ] Hand-off ke Sub-Project B (Admin Panel) — superadmin role functional, tenant table populated, ready for UI.

---

## 11. Open Questions (decide selama plan/exec)

1. **Hosting final:** Vercel direkomendasi tapi belum lock. Kalau ada concern compliance/data residency, Cloud Run+LB. Decide di awal Phase A.1.
2. **Slug ownership:** Kalau tenant A sudah daftar `garindo`, ada tenant B yang juga punya nama Garindo — bagaimana resolve? MVP: first-come-first-serve. Phase 4: trademark dispute process.
3. **WA backend service-role vs RLS:** backend-go pakai service role (bypass RLS). Apakah kita move backend-go ke per-user JWT? MVP: tetap service role, manual tenant_id injection. Phase 2: evaluate.
4. **Realtime channel naming convention:** standardize `tenant:<uuid>:<feature>` (mis. `tenant:abc-123:approvals`). Audit existing `supabase.channel()` calls di Phase A.6.
5. **Phase A.1 hosting cutover sequence:** Big bang DNS switch atau gradual rollout via header-based routing? Default: big bang setelah staging full test.

---

**Next step:** Invoke `writing-plans` skill untuk break down spec ini jadi per-phase implementation plan dengan TDD tasks.
