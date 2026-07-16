# Scale-Forward Phasing Plan — Multi-Tenant Hardening

**Date**: 2026-07-15
**Author**: Founder + Claude (brainstorming session)
**Status**: DRAFT — awaiting founder review
**Reversibility**: IRREVERSIBLE / ARCHITECTURAL (per CLAUDE.md — this locks tenant-facing contracts for years)

---

## Executive Summary

Multi-tenant Supabase ERP saat ini masih single-tenant reality (Garindo Jaya). Target: 1000 tenant dalam 2 tahun, tenant #2 dalam 1-3 bulan. Audit repo 2026-07-15 menemukan **1 vulnerability aktif** (chat-media cross-tenant leak) + **~9 gap infrastruktur** yang jika di-skip sekarang akan jadi mahal / irreversible setelah tenant #2 landing.

**Rencana**: 4 phase, dibagi berdasarkan trigger (bukan waktu). Phase 1 = **2-minggu freeze** (feature-work paused) untuk beresin semua item yang **irreversible sekarang** atau **security-critical**. Phase 2-4 di-trigger oleh milestone tenant (post-tenant-#2, pre-tenant-#10, pre-tenant-#100).

**Non-goals** (deliberately deferred):
- Microservices split — modular monolith cukup untuk ≥5000 tenant. Re-evaluate hanya kalau ada bukti empiris pain spesifik.
- Multi-region / data residency — hanya trigger kalau regulator/customer besar demand.
- Timezone/currency per tenant — hanya trigger kalau expand ke Malaysia/Vietnam.

---

## Context & Problem

### Current state (audit 2026-07-15)

Repo audit menemukan status ke-10 item scale-forward + 7 gap tambahan:

| Kategori | Status | Bukti singkat |
|---|---|---|
| Custom domain | 🟡 PARTIAL | `tenants.custom_domain` schema ready; FE hardcoded ke URL Cloud Run Garindo (`cloudbuild.frontend.yaml:85`) |
| API v1 versioning | 🔴 GAP | Semua route `/api/*` unversioned di `backend-go/main.go` |
| Composite PK `(tenant_id, id)` | 🟡 PARTIAL | Warehouse transfers ✓; `stock_movements` = BIGSERIAL saja; `journal_entry_lines` = UUID saja |
| Tenant-prefixed storage | 🔴 GAP (+SECURITY) | Migration `20261115000202` documents cross-tenant read leak di bucket `chat-media` |
| Per-tenant export/import | 🔴 GAP | Tidak ada CLI/RPC selain deprovision (delete-only) |
| Feature flags per tenant | 🟢 OK | `plans.feature_bundle` + `tenant_subscriptions.feature_overrides` ready — belum dokumentasi disiplin pemakaian |
| Idempotency tokens | 🔴 GAP | Hanya `supplier_claims`; semua RPC critical (sale, PO, opname, transfer, journal) tidak ada |
| Observability + tenant_id | 🔴 GAP | Backend Go pakai `log.Printf`; tidak ada structured logging |
| Async job infra | 🔴 GAP | Scheduler pakai `time.AfterFunc` in-process; hilang saat restart Cloud Run |
| Read/write split | 🔴 GAP | Single pool di `internal/db/client.go:26-36` |
| Rate limiting per tenant | 🔴 GAP | Tidak ada quota enforcement |
| Audit log coverage | 🟡 PARTIAL | `platform_admin_audit` ada; tenant-local audit_log completeness belum diverifikasi |
| Data retention policy | 🔴 GAP | Tidak ada auto-purge/archive |
| Webhook outbound | 🔴 GAP | Hanya inbound (WA button) |
| Timezone per tenant | 🟡 PARTIAL | Hardcoded `Asia/Jakarta` di semua RPC |
| Health/readiness probe | 🟡 PARTIAL | `/api/health` ada; tidak ada `/api/ready` terpisah |
| Session/JWT refresh | 🟡 UNKNOWN | Delegasi ke Supabase Auth; behavior cross-tab belum diverifikasi |

### Why this matters now

Kalau tenant #2 onboard dengan gap-gap di atas terpasang:
- **Chat-media**: file tenant A bisa dibaca tenant B (brute-force filename by timestamp). Live security issue, blast radius menyentuh customer paying.
- **Custom domain**: tenant #2 dapat URL `xxx.a.run.app` — kalau nanti kita ganti Cloud Run service, URL tenant berubah, tenant harus reconfigure bookmark/integrasi.
- **API v1**: tenant #2 build integration ke `/api/*` unversioned. Setelah 1 integrasi berjalan, contract terkunci selamanya.
- **Composite PK**: tabel `stock_movements` di 100k row masih murah migrate (menit). Di 10M row = downtime seminggu.
- **Structured logging**: kalau tenant #2 report bug, kita tidak bisa filter log per tenant → debug scale = mustahil.
- **Idempotency**: 1 network glitch pas kasir catat sale = double-post transaksi. Trust-damaging.

Setiap item di-skip = compound tech-debt yang muncul di titik terburuk (customer facing, revenue impact).

---

## Value Axis (priority framework)

Setiap improvement di-score di 3 dimensi:

1. **Urgency (irreversibility × timing)** — Kalau di-skip sekarang, seberapa mahal untuk fix nanti?
   - Tinggi: Custom domain, composite PK, API v1 (locked-in setelah tenant #2 pakai)
   - Rendah: Read replica, retention policy (pasang kapan pun murah)

2. **Blast radius saat ini** — Kalau gagal/tidak ada hari ini, apa yang rusak?
   - Tinggi: Chat-media security (leak aktif)
   - Rendah: Rate limiting (1 tenant tidak abuse dirinya)

3. **Value multiplier ke depan** — Setelah ini ada, berapa banyak masalah masa depan yang otomatis hilang?
   - Tinggi: Structured logging (unlock semua debug ops), async infra (unlock reliable scheduling)
   - Rendah: Timezone per tenant (hanya matter untuk multi-country)

**Aturan phasing**: Item skor tinggi di ≥2 dimensi = Phase 1. Tinggi di 1 dimensi = Phase 2-3. Sisanya = defer atau trigger-based.

---

## Phase Overview

| Phase | Trigger | Durasi | Fokus | Rationale |
|---|---|---|---|---|
| **Phase 1** | Sekarang (2026-07-16 start) | 2 minggu (freeze mode) | Multi-tenant safety + irreversible-now items | Last chance murah sebelum tenant #2 landing |
| **Phase 2** | Post-tenant-#2 landing | 4-6 minggu (interleaved dgn feature) | Operational reality: async, export, rate limit, audit log completeness | Butuh 2+ tenant untuk pain jadi nyata |
| **Phase 3** | Pre-tenant-#10 (target: bulan 6-12) | Bertahap | Scale ops: read replica, monitoring/alerting, cost tracking per tenant, session refresh | Debug/observability jadi mustahil eye-scale |
| **Phase 4** | Pre-tenant-#100 (target: tahun 2) | Bertahap | Compliance & true scale: partitioning, retention, webhook, security audit, load testing | Storage growth trigger, big customer integration demand |
| **Deferred** | Trigger-based only | — | Multi-region, timezone-per-tenant, multi-currency, microservices | Hanya trigger jika expand region atau ada bukti pain spesifik |

---

## URL Architecture (LOCKED 2026-07-16)

Single-domain (`caleo.id`) architecture serving 5 distinct purposes via subdomain separation. All subdomain routing gratis (Cloudflare + Cloud Run auto SSL). Zero-cost constraint diberlakukan: placeholder pages menggunakan Cloudflare Workers (free tier), actual services scaled-to-zero saat idle.

```
caleo.id                      → Landing page (public, marketing)
                                  Day 3-14: Cloudflare Worker placeholder (FREE) — transitional
                                  Day 15-17: Landing rewrite + Firebase Hosting deploy → DNS cutover
                                  End of Phase 1: Firebase Hosting serving real landing content (FREE tier)

app.caleo.id                  → Tenant dashboard PRODUCTION
                                  Login untuk: owner Garindo, staff Garindo, dan nanti tenant lain
                                  Cloud Run frontend (existing service, cost: existing)
                                  Tenant admin functions inline: /settings, /users, /features

admin.caleo.id                → Platform admin PRODUCTION
                                  Login untuk: kamu (founder Caleo), team Caleo (nanti)
                                  Phase 1: Cloudflare Worker placeholder "Under construction" (FREE)
                                  Phase 2: Cloud Run service scaled-to-zero (~Rp 0-30k/mo)
                                  Functions: provision tenant, cost tracking, feature flags, metrics, audit

staging.caleo.id              → Staging tenant dashboard
                                  Login untuk: kamu (self-test before prod deploy)
                                  Phase 1: Cloudflare Worker placeholder (FREE)
                                  Phase 2: Cloud Run service scaled-to-zero (~Rp 0-50k/mo)
                                  Data: SAME Supabase project dengan dedicated test tenants (FREE)

admin.staging.caleo.id        → Staging platform admin
                                  Login untuk: kamu (test admin changes before prod)
                                  Phase 1: Cloudflare Worker placeholder (FREE)
                                  Phase 2: Cloud Run service scaled-to-zero (~Rp 0-30k/mo)
```

**Nomenclature choice**: `admin.staging.caleo.id` (env di parent) bukan `staging-admin.caleo.id`. Alasan: pola `<function>.<env>.caleo.id` scalable kalau tambah env lain nanti (`admin.dev.caleo.id`, `admin.qa.caleo.id`) — cleaner hierarchy.

### Auth strategy (SSO across subdomains)

Single Supabase Auth session, cookie scoped ke `.caleo.id` parent domain. User login sekali di `app.caleo.id` atau `admin.caleo.id`, session auto-available di semua subdomain.

- **Guard di `admin.caleo.id`**: middleware check `session.user.app_metadata.platform_admin === true`. Kalau false → redirect ke `app.caleo.id` atau 403.
- **Guard di `app.caleo.id/settings`**: middleware check tenant role IN ('owner', 'admin').
- **Table addition** (Phase 1 Day 3): `users.platform_admin boolean DEFAULT false` — kamu manual-set `true` untuk email sendiri; team Caleo tambah via admin dashboard nanti.

### Codebase evolution

**Phase 1 (now)**: Single repo, existing structure. `app.caleo.id` deployed dari `src/` (existing).

**Phase 2 (post tenant #2)**: Refactor jadi monorepo saat build actual admin app:
```
caleo-repo/
├─ apps/
│  ├─ tenant/     → src/ existing dipindah sini (app.caleo.id)
│  └─ admin/      → new app (admin.caleo.id)
├─ packages/
│  ├─ ui/         → shared design system
│  ├─ auth/       → shared Supabase Auth client
│  └─ lib/        → shared utils, types
├─ backend-go/    → existing (shared for both apps)
└─ supabase/      → existing (shared)
```

Monorepo refactor **BUKAN part of Phase 1** — hanya siapkan struktur URL dari sekarang.

### Zero-cost strategy per komponen (CORRECTED)

| Komponen | Phase 1 (Rp) | Phase 2 (Rp/bulan) | Notes |
|---|---|---|---|
| Domain `caleo.id` | Rp 20k/bulan (Y1 amortized) | Rp 20k/bulan | Sudah dibayar (Y1: 2.2jt, Y2+: 200k/tahun) |
| ID Protection | Rp 7k/bulan (amortized) | Rp 7k/bulan | Sudah dibayar |
| `app.caleo.id` — Cloud Run existing | Existing | Existing | Tidak berubah dari sekarang |
| `admin.caleo.id` — placeholder → real | **0** | **~0** | Cloud Run scaled-to-zero, usage founder ~100 req/hari = di dalam free tier 2M req/mo |
| `staging.caleo.id` — placeholder → real | **0** | **~0** | Cloud Run scaled-to-zero, jarang diakses = free tier |
| `admin.staging.caleo.id` — placeholder → real | **0** | **~0** | Cloud Run scaled-to-zero, jarang diakses = free tier |
| Cloudflare DNS + Workers | **0** | **0** | Free tier 100k req/hari (placeholder pages) |
| SSL certs (semua subdomain) | **0** | **0** | Google-managed cert auto-provisioned |
| Firebase Hosting untuk landing | **0** | **0** | Free tier 10GB/mo bandwidth |
| **DELTA cost dari architecture ini** | **0** | **~0-20k/bulan** | Realistically FREE untuk founder usage pattern |

**Penting untuk dipahami**: Yang bayar itu **usage Cloud Run compute**, BUKAN subdomain. Subdomain 100% gratis unlimited. Cloud Run scaled-to-zero = tidur saat tidak ada request = 0 biaya. Baru ada biaya saat request masuk (per 100ms compute). Free tier Cloud Run cover 2 juta request/bulan + 400,000 GB-seconds compute — jauh dari cukup untuk founder pakai admin dashboard personal.

### `caleo.web.id` disposition (bonus free domain)

Diperoleh promo saat beli `caleo.id`. Zero-cost disposition:

- **Phase 1 Day 3**: 301 redirect `caleo.web.id/*` → `https://caleo.id/*` via Cloudflare Page Rule (setup 5 menit, forever gratis).
- **Year 1 renewal**: decide berdasarkan usage — kalau redirect tidak pernah trigger, drop di renewal (Rp 50-100k saved).

Alternatif "reserve untuk staging" ditolak — bikin split-domain complexity yang tidak worth vs `staging.caleo.id` pattern.

---

## Phase 1: 17-Day Freeze Detail (straight, no weekend off)

**Start date**: 2026-07-16 (Kamis) — atau hari kerja pertama setelah domain terbeli & terverifikasi
**Target End date**: 2026-08-01 (Sabtu) — 17 hari straight kalau linear progression, tapi TIMELINE FLEXIBLE
**Mode**: Full feature-work freeze. Bug operasional Garindo yang blocking daily ops → tetap di-fix (safety valve).

**Total scope**: 25 discrete deliverable across 17 "days" (work units), ~115-140 jam kerja actual (dengan Claude Code parallelism via worktree). Founder confirmed willing untuk work Sabtu-Minggu supaya truly beresin infrastructure + landing + legal sekaligus.

**Execution flexibility principle (IMPORTANT)**:
- **"Day N" = task unit N**, bukan literal calendar day
- Tanggal di setiap Day heading = **target kalau linear progression 1 day = 1 unit**, tapi TIDAK RIGID
- Kalau Day 1 selesai jam 3 sore + verified green → **langsung lanjut Day 2** hari itu juga. Tidak nunggu besok.
- Kalau efficient dengan parallelism, 17 work-units bisa selesai dalam <17 calendar days (mungkin 12-15)
- Kalau ada blocker (misal SSL propagation lambat, Cloudflare issue), spill ke calendar day berikutnya
- Aturan tetap: **MERGE + VERIFY** setiap deliverable sebelum lanjut ke berikutnya. Speed via parallelism dan short-cycle, bukan skip verification.

**Prinsip eksekusi**:
- Setiap hari 1-2 deliverable yang **MERGE + VERIFY** sebelum hari berikutnya
- Setiap deliverable = 1 commit minimum + 1 progress.md update
- Migration claim slot **300-329** (jauh dari QA-sweep 054-079 dan Session 2 slot 080-099 per memory)
- Semua migrasi WAJIB idempotent (per CLAUDE.md: `DROP IF EXISTS`, `CREATE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`)
- Setelah setiap migration DB → jalankan `mcp__plugin_supabase_supabase__get_advisors` (per CLAUDE.md)

### Prerequisites (sebelum Day 1)

- ✅ Domain `caleo.id` sudah dibeli & PANDI KTP verified
- ✅ Nameserver domain sudah delegated ke Cloudflare (kalau pilih pola registrar + Cloudflare DNS)
- ✅ Cloudflare account ready dengan `caleo.id` added
- ✅ Cloud Run project `garindo-jaya-panel-msme-erp-422860632808` accessible via `gcloud`
- ✅ Feature freeze diumumkan (kalau ada stakeholder Garindo yang perlu tahu)

### Days 1-14 sequential (Sat-Sun on)

#### Day 1 (Kamis, 2026-07-16) — Chat-media security fix

**Problem**: Bucket `chat-media` public, filename cuma `{Date.now()}_{name}` → cross-tenant read leak aktif (didokumentasikan di `supabase/migrations/20261115000202_storage_bucket_policy_hardening.sql:9,24-29`).

**Fix**:
1. Migration slot 300: rename bucket path pattern → `tenants/{tenant_id}/{uuid}_{filename}`
2. Bucket policy: dari public → private + signed URL access (1-hour TTL)
3. `src/lib/supabaseClient.ts:262-265` (`uploadChatMedia()`) — update path generation
4. Data migration script: copy file existing ke path baru, update `t_chat_messages` (atau tabel serupa) untuk reference path baru
5. Signed URL helper di FE untuk generate URL saat display

**Verification**:
- Cross-tenant read test: session tenant B coba akses file tenant A URL → HTTP 403
- Existing chat display tetap render (file lama sudah migrasi ke path baru)
- Upload baru masuk ke path tenant-prefixed

**Deliverable**: PR merged, migration `20261115000300_chat_media_tenant_prefix.sql`, verification screenshot di progress.md, memory `chat-media` updated dari "gap" → "fixed"

**Effort**: ~6-8 jam (dengan agent parallelism: 1 agent bikin migration + script, 1 agent update FE)

---

#### Day 2 (Jumat, 2026-07-17) — Audit + fix semua bucket lain

**Problem**: Bucket `branding`, `product-photos`, `accounting-proofs`, `payment-proofs`, `stock-evidence` — pattern serupa belum diverifikasi.

**Fix**:
1. Spawn Explore agent: sweep semua bucket untuk pattern path + RLS policy
2. Apply tenant-prefix + signed URL untuk bucket yang belum
3. Data migration untuk file existing (per bucket)
4. Update FE upload helpers

**Verification**: Audit table di `progress.md` — bucket × path pattern × RLS status × migration status

**Deliverable**: Migration `20261115000301_bucket_security_hardening.sql` (kalau ada gap), progress.md audit table, memory update

**Effort**: ~4-6 jam (banyak agent parallelism)

---

#### Day 3 (Sabtu, 2026-07-18) — Multi-subdomain setup + `app.caleo.id` live + placeholders + cross-subdomain session verify

**Problem**: FE hardcode ke `garindo-jaya-panel-msme-erp-422860632808.asia-southeast1.run.app` di `cloudbuild.frontend.yaml:85`. Selain itu, seluruh URL architecture 5-subdomain perlu di-reserve dari sekarang supaya nanti tidak butuh migrasi.

**Fix — Part A: `app.caleo.id` live serving ERP (main task)**:
1. Cloudflare DNS: add `CNAME app.caleo.id → ghs.googlehosted.com` (Cloud Run domain mapping). **Proxy status DNS-only** (matikan orange cloud — conflict dengan Cloud Run SSL Google-managed).
2. Cloud Run domain mapping: `gcloud beta run domain-mappings create --service=<frontend-service> --domain=app.caleo.id --region=asia-southeast1`
3. SSL cert: auto-provision by Google-managed (15-60 menit wait)
4. Update `cloudbuild.frontend.yaml`: replace hardcoded Cloud Run URL dengan env var `VITE_APP_DOMAIN` (default `https://app.caleo.id`)
5. FE: `src/lib/config.ts` (buat kalau belum ada) — expose `APP_DOMAIN` from env
6. Update auth redirect URLs di Supabase Auth settings — allowlist `https://app.caleo.id/*`, cookie domain `.caleo.id` (parent scope untuk SSO cross-subdomain)

**Fix — Part B: Reserve 4 other subdomains dengan Cloudflare Worker placeholders (zero-cost)**:

Deploy 4 placeholder Workers (1 per subdomain), semua serve halaman "Under construction" atau "Coming soon" statis:

| Subdomain | Placeholder message | Worker name |
|---|---|---|
| `caleo.id` (root) | "Caleo — website segera hadir. <br>Sudah punya akun? [Login di app.caleo.id]" | `caleo-root-placeholder` |
| `admin.caleo.id` | "Platform admin — under construction. Contact founder." | `caleo-admin-placeholder` |
| `staging.caleo.id` | "Staging environment — internal only. Contact founder." | `caleo-staging-placeholder` |
| `admin.staging.caleo.id` | "Staging admin — internal only. Contact founder." | `caleo-admin-staging-placeholder` |

Per Worker: 
- 5 menit deploy (copy template dari 1 Worker, ganti message)
- Cloudflare route: pattern `<subdomain>/*` → worker
- Cloudflare Universal SSL otomatis (gratis)
- Free tier limit 100k requests/day per Worker — jauh dari cukup untuk placeholder yang jarang diakses

**Fix — Part C: `caleo.web.id` 301 redirect (zero-cost)**:
1. Cloudflare Page Rules → `*caleo.web.id/*` → `301 Permanent Redirect` → `https://caleo.id/$2`
2. Verifikasi: `curl -I https://caleo.web.id` → 301 with `Location: https://caleo.id/`

**Fix — Part D: `users.platform_admin` column migration (Phase 2 prep)**:
1. Migration slot 301: add column `platform_admin boolean NOT NULL DEFAULT false` ke tabel users (atau setara — cek exact table name)
2. Seed: `UPDATE users SET platform_admin = true WHERE email = '<founder-email>'`
3. Backend Go + FE: siapkan helper `isPlatformAdmin(session)` (tapi belum enforce di mana-mana — jaga scope Phase 1)

**Fix — Part E: Cross-subdomain session verification + full auth flow test**:
1. Login di `app.caleo.id` → cookie set dengan domain `.caleo.id` (parent scope)
2. Navigate ke `admin.caleo.id/health-check-page` (temporary endpoint di placeholder Worker) → verify session cookie readable
3. Kalau OK → SSO cross-subdomain confirmed. Kalau tidak → adjust Supabase Auth cookie config
4. **Full auth flow test** (add-in): password reset flow end-to-end (request → email → new password → login), email verification flow, session refresh cross-tab (buka 2 tab, logout di 1, verify tab lain logout), session timeout policy (verify TTL matches Supabase config)
5. Fix edge cases yang ditemukan
6. Ini prep untuk Phase 2 admin app (butuh SSO shared session) + prep untuk 10-tenant scale (auth edge cases muncul saat multi-user)

**Verification**:
- `curl -I https://app.caleo.id` → HTTP 200, login page loads
- `curl -I https://caleo.id` → 200, placeholder shows
- `curl -I https://admin.caleo.id` → 200, "under construction" placeholder
- `curl -I https://staging.caleo.id` → 200, placeholder
- `curl -I https://admin.staging.caleo.id` → 200, placeholder
- `curl -I https://caleo.web.id` → 301 → caleo.id
- Login di `app.caleo.id` sebagai Garindo owner → dashboard load OK
- SQL check: `SELECT email, platform_admin FROM users WHERE platform_admin = true` → founder email listed

**Deliverable**: 
- PR merged (config + code changes)
- 4 Cloudflare Workers deployed
- Migration 301 applied
- Screenshot semua subdomain di browser → progress.md
- DNS propagation confirmed untuk semua 5 subdomain

**Effort**: ~6-8 jam total
- Part A (`app.caleo.id` live): ~2-3 jam
- Part B (4 placeholders): ~45 menit
- Part C (redirect): ~5 menit
- Part D (`platform_admin` column): ~30 menit
- Part E (cross-subdomain session verify): ~30 menit
- SSL propagation wait: 15-60 menit (background)
- Verification: 30 menit

---

#### Day 4 (Minggu, 2026-07-19) — API `/api/v1/*` prefix

**Problem**: Semua route Go di `backend-go/main.go:86-463` unversioned. Contract terkunci setelah tenant #2 build integrasi.

**Fix**:
1. Middleware `apiVersionRouter`: accept both `/api/v1/*` (new) dan `/api/*` (legacy, log warning)
2. Rewrite semua `http.HandleFunc("/api/xxx", ...)` menjadi register both `/api/v1/xxx` dan `/api/xxx` (with deprecation header on unversioned)
3. Grep semua FE `src/**` untuk hardcoded `/api/` calls, migrate ke `/api/v1/`
4. Update `cloudbuild.yaml` env untuk expose `API_VERSION=v1`

**Verification**:
- `curl https://backend.../api/v1/health` → 200
- `curl https://backend.../api/health` → 200 + response header `X-Deprecated-Path: use /api/v1/`
- Frontend E2E smoke test → all API calls hit v1

**Deliverable**: PR merged, cURL tests documented di progress.md, deprecation timeline (v1 permanent, /api/* removed di 2027-Q3)

**Effort**: ~4-6 jam

---

#### Day 5 (Senin, 2026-07-20) — Composite PK migration batch 1 + buffer

**Problem**: `stock_movements` (BIGSERIAL only) dan `journal_entry_lines` (UUID only) — bukan composite `(tenant_id, id)`. Nanti sulit partition by tenant.

**Fix**:
1. Migration slot 302: `stock_movements` — drop PK, add composite PK `(tenant_id, id)`, verify semua FK/RLS masih valid
2. Migration slot 303: `journal_entry_lines` — same pattern
3. Verify semua RLS predicate masih hit `tenant_id` index (EXPLAIN ANALYZE untuk top 10 hot query)
4. Update semua RPC yang INSERT/UPDATE tabel ini untuk pastikan `tenant_id` di-supply

**Verification**:
- `\d stock_movements` di psql confirms composite PK
- EXPLAIN ANALYZE screenshot untuk 5 hot queries (before vs after — should be equal or better)
- No RPC regression via smoke test

**Deliverable**: Migrations applied, EXPLAIN ANALYZE screenshots, progress.md summary

**Buffer**: 2-3 jam untuk masalah tak terduga dari Day 1-4

**Effort**: ~6-8 jam

**End of Week 1 checkpoint**: Multi-tenant data isolation & URL/API stability confirmed. Tenant #2 secara teknis bisa di-onboard sekarang tanpa security leak — tapi belum idempotent, belum observable.

#### Day 6 (Selasa, 2026-07-21) — Composite PK batch 2 + inventory audit

**Fix**:
1. Migration slot 304-306: `t_sales_invoices`, `t_purchase_orders`, `t_purchase_invoices` (kalau belum composite)
2. Sweep semua `t_*` table via SQL: `SELECT table_name, indexname FROM pg_indexes WHERE ...` — buat inventory PK shape
3. Kategorikan: (a) sudah composite, (b) low-volume defer OK, (c) high-volume harus composite tapi belum done

**Verification**: Inventory table di `docs/superpowers/specs/2026-07-15-composite-pk-inventory.md`; setiap tabel row = table_name, current_pk, target_pk, priority (P1/P2/P3), migration_slot_if_needed

**Deliverable**: Inventory doc, batch 2 migrations applied

**Effort**: ~4-6 jam

---

#### Day 7 (Rabu, 2026-07-22) — Structured logging + tenant_id middleware

**Problem**: `backend-go` pakai `log.Printf` — tidak ada tenant_id context, tidak searchable.

**Fix**:
1. Adopt `log/slog` (Go stdlib 1.21+)
2. HTTP middleware: extract `tenant_id`, `user_id`, `request_id` dari JWT / header, inject ke request context
3. Custom slog handler: pull dari context, emit sebagai structured fields JSON
4. Migrate semua `log.Printf` call sites ke `slog.InfoContext(ctx, ...)` etc.
5. Configure Cloud Logging untuk index structured fields (`jsonPayload.tenant_id`)

**Verification**:
- Sample Cloud Logging entry showing `{tenant_id, user_id, request_id, msg, level, ...}`
- Query di Cloud Logging: `jsonPayload.tenant_id="xxx"` returns filtered logs
- No log site di backend-go masih pakai `log.Printf`

**Deliverable**: PR merged, sample Cloud Logging screenshot, grep count `log.Printf` = 0

**Effort**: ~6-8 jam

---

#### Day 8 (Kamis, 2026-07-23) — Idempotency tokens batch 1 (3 RPC)

**RPCs**:
1. `record_kasir_sale*` — leverage in-progress migration `20261115000237_fix_record_kasir_sale_ongkir_split.sql` untuk sekalian add `p_idempotency_key`
2. `receive_purchase_order` / `record_tagihan` — cari nama exact via grep
3. `opname_commit` — cari nama exact via grep

**Pattern**:
- Add param `p_idempotency_key uuid` (nullable untuk backward compat)
- Table `t_rpc_idempotency (tenant_id uuid, rpc_name text, idempotency_key uuid, result_json jsonb, created_at timestamptz, PRIMARY KEY (tenant_id, rpc_name, idempotency_key))`
- Pattern di RPC: check existing key → return existing result. Else execute + insert result.
- TTL cleanup job (deferred Phase 2, sekarang manual delete >30 days)
- FE: generate UUID per user action, pass sebagai param, retry-safe

**Verification**: Unit test smoke — call RPC 2× dengan key sama → return same result, no double post

**Deliverable**: Migration `20261115000307_rpc_idempotency_table.sql` + 3 RPC updated, unit tests

**Effort**: ~6-8 jam

---

#### Day 9 (Jumat, 2026-07-24) — Idempotency batch 2 (2 RPC) + health probe

**RPCs**:
4. `transfer_warehouse`
5. `record_pembayaran` / journal entry — cari via grep

**Health probe split**:
- `/api/live` — process up, no dep check (used by Cloud Run liveness)
- `/api/ready` — check DB reachable, Supabase reachable, Gemini reachable (used by Cloud Run readiness)
- Configure Cloud Run readiness probe di `cloudbuild.yaml`

**Verification**:
- 5 RPC covered (Day 8 + Day 9 total)
- `curl /api/live` → 200 always (unless process dying)
- `curl /api/ready` → 200 kalau deps healthy, 503 kalau ada yang down
- Cloud Run dashboard showing probe green

**Deliverable**: PR merged, probe verification screenshots

**Effort**: ~5-7 jam

---

#### Day 10 (Sabtu, 2026-07-25) — Monitoring + alerting baseline

**Problem**: 10-tenant tanpa monitoring = kita tahu ada masalah pas customer complain. Reactive, terlambat.

**Fix**:
1. **Cloud Monitoring alerts** — configure via GCP Console:
   - Cloud Run 5xx rate spike (>1% dari total request dalam 5-menit window)
   - Cloud Run request latency p99 spike (>3s)
   - Cloud Run instance count anomaly (spike/drop)
   - Postgres connection pool exhaustion (jika accessible via Supabase metric)
2. **Uptime Robot** (free tier 50 monitor):
   - Monitor `https://app.caleo.id` (5-min interval)
   - Monitor `https://<backend-go-url>/api/v1/health` (5-min interval)
   - Alert channel: email + WhatsApp (via free integration)
3. **Alert routing**: all alerts → founder email + WA. Documented di `docs/superpowers/specs/alerting-runbook.md` — apa artinya each alert + first-response step.

**Verification**:
- Trigger fake alert (bump env var untuk sengaja bikin 5xx) → email + WA received in <5 menit
- Dashboard: `https://console.cloud.google.com/monitoring/dashboards/*` shows tenant activity + error trend

**Deliverable**: Alert rules configured, runbook doc, screenshot alert trigger test, `alerting-runbook.md` committed

**Effort**: ~4-6 jam

---

#### Day 11 (Minggu, 2026-07-26) — Error tracking (Sentry)

**Problem**: 10-tenant hit exception di FE atau BE = kita tidak akan tahu tanpa stack trace + tenant context. Sentry = industry standard.

**Fix**:
1. **Sentry account** (free tier 5k events/month cukup untuk 10 tenant)
2. **FE integration** (`@sentry/react`): install, config DSN via env var, tag events dengan `tenant_id` dari session
3. **BE integration** (Go — `sentry-go`): install, config DSN via env var, wrap panic handlers, tag events dengan `tenant_id` dari middleware context
4. **Alert config**: Sentry → email/WA saat new error class atau spike
5. **Sample source maps upload** untuk FE (make stack trace readable)

**Verification**:
- Trigger fake error di FE (dev console `throw new Error('test')`) → appears in Sentry dashboard within 30 sec
- Trigger fake error di BE (temporary endpoint `/api/v1/test-error`) → appears with tenant_id tag
- Error class dedup working (same error 5× = 1 issue with count=5)

**Deliverable**: Sentry configured for FE + BE, test errors captured, DSN documented di `docs/superpowers/specs/error-tracking-setup.md`

**Effort**: ~4-6 jam

---

#### Day 12 (Senin, 2026-07-27) — PITR restore + tenant deprovision + secret rotation + rollback procedure docs

**Part A: PITR restore test (critical)**:
1. Buat Supabase branch/scratch project (Supabase Pro plan feature)
2. Restore point-in-time snapshot (contoh: 24 jam yang lalu) ke scratch project
3. Verifikasi data integrity: count tables, sample query per tenant, verifikasi timestamps
4. Document exact restore procedure di `docs/superpowers/specs/pitr-restore-runbook.md`
5. Backup yang belum di-test = tidak ada backup. Setelah test → dokumen "verified 2026-07-27"

**Part B: Tenant deprovision flow verification**:
1. Cari + verify RPC `deprovision_tenant_rpc` (migration `20261115000035_deprovision_tenant_rpc.sql`) — apa yang dilakukan?
2. Test end-to-end di scratch tenant: provision → seed data → deprovision → verify all data + storage + auth deleted
3. Document deprovision runbook

**Part C: Secret rotation policy doc**:
1. Audit secrets di GCP Secret Manager: apa saja secrets, siapa punya access, rotation cadence
2. Doc `docs/superpowers/specs/secret-rotation-policy.md` — rotation schedule (quarterly? annual?), rotation procedure per secret type (Supabase service role, Gemini API key, WhatsApp token, dll)

**Part D: Rollback procedure documentation**:
1. Doc `docs/superpowers/specs/rollback-runbook.md` — apa langkah revert kalau bug ship to prod:
   - Cloud Run: revert traffic ke previous revision via `gcloud run services update-traffic --to-revisions=<prev>=100`
   - Migration: revert via inverse migration atau restore point-in-time snapshot
   - Landing: Firebase Hosting rollback (`firebase hosting:rollback`)
   - DNS: kalau perlu revert Cloudflare DNS record ke old target
2. Include estimasi waktu revert per jenis change (Cloud Run ~30 sec, migration ~5-30 min, landing ~1 min, DNS ~5 min propagation)
3. Include decision tree: "prod broken → what to check first, when to revert vs hotfix"

**Verification**:
- PITR restore success + documented in runbook
- Deprovision test scratch tenant → confirmed complete cleanup
- Secret rotation doc reviewed + committed
- Rollback runbook reviewed + committed

**Deliverable**: 4 docs (PITR runbook, deprovision runbook, secret rotation policy, rollback runbook), scratch project cleaned

**Effort**: ~7-9 jam

---

#### Day 13 (Selasa, 2026-07-28) — Cold-start policy + load test baseline + feature flag reference impl

**Part A: Cloud Run cold-start policy decision + implement**:
1. Decide per service: `min-instances=0` (cost saving, ~2s cold-start) vs `min-instances=1` (~$5/mo, no cold-start)
2. Recommended:
   - `app.caleo.id` frontend: `min-instances=1` (user-facing, cold-start unacceptable)
   - Backend Go: `min-instances=1` (API latency matters)
   - `admin.caleo.id` (Phase 2): `min-instances=0` (founder-only, cold-start OK)
   - `staging.*` (Phase 2): `min-instances=0` (test env, cold-start OK)
3. Update `cloudbuild.yaml` + `cloudbuild.frontend.yaml` dengan `--min-instances` flag

**Part B: Load test baseline (k6 or Artillery)**:
1. Install k6 (open source, free)
2. Script: 100 concurrent user hit sample endpoints (login, dashboard load, sample RPC)
3. Run baseline, document: p50, p95, p99, error rate, RPS achievable
4. Save baseline di `docs/superpowers/specs/load-test-baseline.md` — nanti compare setiap major release

**Part C: Feature flag reference implementation**:
1. Pilih "Saldo Awal" module (per D4 accepted default)
2. Add feature flag check: `tenant_subscriptions.feature_overrides.saldo_awal_enabled` (default: true untuk existing tenant, configurable per tenant)
3. FE guard: hide/show menu Saldo Awal based on flag
4. BE guard: RPC check flag before execute
5. Doc pattern di `docs/superpowers/specs/feature-flag-usage.md` sebagai reference

**Verification**:
- Cloud Run config updated + verified via `gcloud run services describe`
- Load test baseline captured + trend line untuk future comparison
- Feature flag: toggle off Saldo Awal untuk Toko Jaya Makmur → menu hilang; toggle on → menu muncul

**Deliverable**: 2 docs (load-test-baseline, feature-flag-usage), 1 reference impl (Saldo Awal), Cloud Run config updated

**Effort**: ~6-8 jam

---

#### Day 14 (Rabu, 2026-07-29) — Onboarding runbook + seed script verify + FE error boundary + 404 + E2E smoke test

**Onboarding runbook**:
- `docs/superpowers/specs/tenant-onboarding-runbook.md` — step-by-step:
  1. Provision tenant record (via `create-tenant-owner` edge function)
  2. Setup URL (shared `app.caleo.id`, JWT-based tenant scope)
  3. Initial data seed (COA default, warehouse default, category seed)
  4. Feature flags default per plan (leverage Day 13 pattern)
  5. Admin invite via `send-admin-invite` edge function
  6. First-login checklist (change password, verify tenant data, seed products)

**Seed script verification (add-in)**:
- Verify `create-tenant-owner` edge function benar-benar seed complete initial data (COA, warehouse default, category default). Kalau incomplete → fix + add missing seed
- Test provision fresh scratch tenant → verify all default data present + queryable
- Document expected seed content di runbook

**Frontend error boundary + 404 page (add-in)**:
- Add React Error Boundary di top-level `src/App.tsx` — catch component crash, show fallback UI ("Sesuatu error, silakan reload atau hubungi support")
- Add proper 404 page: `src/pages/NotFound.tsx` — untuk route yang tidak match (`app.caleo.id/typo`)
- Verify error boundary tidak menutupi useful error info di dev mode (tetap tampil di console)

**E2E multi-tenant smoke test**:
- Provision "Toko Jaya Makmur" (existing prod-testing-tenant per D7) baru dari clean slate — follow runbook
- Verify isolasi (10 checks):
  - Data: query dari session Garindo tidak lihat data Toko Jaya (dan sebaliknya)
  - Storage: file upload Toko Jaya tidak accessible dari session Garindo (test cross-tenant URL)
  - URL: keduanya bisa akses `app.caleo.id/login`, tenant_id ditentukan dari JWT
  - RPC: call idempotency, verify per-tenant key isolation
  - Feature flag: toggle per tenant → beda per tenant
  - Auth: platform_admin flag hanya founder
  - Logging: log entries tag dengan correct tenant_id
  - Monitoring: cross-tenant activity visible di dashboard
  - Error tracking: fake error di Toko Jaya session → Sentry tag dengan tenant_id
  - Deprovision: kalau Toko Jaya di-deprovision, all data terhapus (kalau test scratch tenant)

**Buffer**: 2-3 jam untuk masalah tak terduga dari Day 1-13 + final validation

**Verification**: 10-item smoke test checklist all green, results documented di progress.md

**Deliverable**: onboarding runbook, smoke test report

**Effort**: ~6-8 jam

---

#### Day 15 (Kamis, 2026-07-30) — Landing content review + rewrite + Privacy Policy + Terms of Service

**Problem**: Landing page existing di `vosi-landing/index.html` (1212 baris) branded "Vosi", meta tags + sitemap reference `vosi.id`. Sudah tidak match dengan brand baru "Caleo" + domain `caleo.id`.

**Fix**:
1. **Content review**: founder baca full landing sekarang → decide: (a) content masih relevant secara value prop atau tidak, (b) mana section yang perlu rewrite substantial
2. **Rebrand pass**: find + replace di `vosi-landing/index.html`:
   - "Vosi" → "Caleo" (case-sensitive: "Vosi" → "Caleo", "vosi" → "caleo")
   - `vosi.id` → `caleo.id` (semua URL reference)
   - Meta tags: `og:title`, `og:description`, `twitter:title`, `<title>`, `<meta name="description">`, `<meta name="keywords">`
   - Sitemap.xml: `<loc>https://vosi.id/</loc>` → `<loc>https://caleo.id/</loc>`
   - robots.txt: `Sitemap: https://vosi.id/sitemap.xml` → `Sitemap: https://caleo.id/sitemap.xml`
3. **Copy refresh** (kalau content review temukan section outdated):
   - Value prop headline
   - Feature descriptions
   - Pricing/paket (kalau masih ada info lama)
   - CTA copy
   - FAQ (kalau ada pertanyaan lama tidak relevant)
4. **Folder rename**: `git mv vosi-landing/ caleo-landing/` — plus update all references di README, cloudbuild, dll

**Verification**:
- `grep -ri "vosi" caleo-landing/` returns 0 results (semua branding sudah diganti)
- Preview local (`caleo-landing/index.html` di browser) — content coherent, brand consistent
- Founder approve content sebelum lanjut Day 16 (deploy)

**Deliverable**: `caleo-landing/` folder dengan content rebrand + optional copy refresh. Git commit "chore(landing): rebrand Vosi → Caleo, refresh copy"

**Part E: Privacy Policy + Terms of Service (add-in — legal critical)**:

Kenapa perlu:
- UU PDP 2022 (Perlindungan Data Pribadi) wajib platform yang collect data pribadi punya Privacy Policy
- Trust signal untuk tenant baru (tanpa P&T = amateur perception)
- Legal protection untuk Caleo (batasi liability, define prohibited use)
- Payment gateway integration nanti (Xendit/Midtrans) wajibkan merchant punya P&T

Fix:
1. **Draft Privacy Policy** — adapt dari template Automattic/Cookiebot generator, tailor ke Caleo:
   - Data collected (email, nama, transaksi tenant, chat, files)
   - Purpose (operasi ERP, analytics, marketing)
   - Third-party access (Supabase, Google Cloud, Gemini, WhatsApp)
   - Retention (7 tahun untuk data transaksi per regulasi pajak, 2 tahun untuk data marketing)
   - User rights (access, delete, export, portabilitas)
   - Contact: `privacy@caleo.id` (setup Day 16)
2. **Draft Terms of Service** — cover:
   - Service description (ERP MSME, features included per plan)
   - Uptime SLA (target 99.5% untuk paid plan, best effort untuk free)
   - Prohibited use (abuse, scraping, sharing account, upload malware)
   - Liability limitation (batasi refund max 3× monthly fee)
   - Payment terms (kalau nanti berbayar — placeholder for now)
   - Termination (cara tenant cancel, cara Caleo suspend, refund policy)
   - IP protection + confidentiality
3. **Deploy as static pages** di `caleo-landing/`:
   - `/privacy` → `privacy.html`
   - `/terms` → `terms.html`
   - Link di footer landing
4. **Add signup consent checkbox** di app (Phase 2 saat build register flow — untuk sekarang default landing punya CTA WA, tidak ada online signup)

Effort:
- Draft Privacy Policy: 2-3 jam (adapt template)
- Draft Terms of Service: 2-3 jam
- HTML markup + Firebase Hosting page: 1 jam
- Founder review: 1-2 jam (kritis untuk semua clauses)

**Deliverable Day 15 combined**: `caleo-landing/` dengan (1) content rebrand + copy refresh, (2) `privacy.html` + `terms.html` drafted + linked di footer

**Effort Day 15 total**: ~10-13 jam (kalau Day 15 selesai malam, tidak apa spill ke Day 16 pagi per execution flexibility principle)

---

#### Day 16 (Jumat, 2026-07-31) — Firebase project setup + landing deploy + support email + security headers

**Fix**:
1. **Firebase project setup**:
   - Create GCP project `caleo-landing` (atau reuse existing project kalau ada — cek dulu)
   - Enable Firebase Hosting API
   - Install `firebase-tools` CLI kalau belum: `npm install -g firebase-tools`
   - `firebase login`
   - `firebase init hosting` di `caleo-landing/` (kalau firebase.json belum ada — sudah ada di vosi-landing per audit earlier)
2. **Update `caleo-landing/firebase.json`** kalau perlu (project reference, rewrites, cache headers)
3. **Add `.firebaserc`** dengan project ID reference
4. **First deploy**:
   ```bash
   cd caleo-landing/
   firebase deploy --only hosting
   ```
5. **Test Firebase-provided URL**: `https://<project-id>.web.app` — pastikan landing render OK
6. **Add cache/security headers** di firebase.json:
   - HTML: `max-age=300` (5 min)
   - Static assets: `max-age=604800` (7 days)
   - Security: `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`

**Verification**:
- `curl -I https://<project-id>.web.app` → 200 + expected headers
- Landing render sempurna di desktop + mobile viewport
- No console error, no failed request

**Deliverable**: `caleo-landing/` deployed to Firebase Hosting, accessible via `<project-id>.web.app`

**Part C: Support email setup (add-in)**:
1. Sign up **Zoho Mail free tier** (5 user, forever gratis): `mail.zoho.com`
2. Add domain `caleo.id`, verify via DNS TXT record di Cloudflare
3. Create catchall + dedicated aliases:
   - `founder@caleo.id` → forward ke email personal kamu
   - `support@caleo.id` → forward ke email personal kamu (nanti team saat scale)
   - `privacy@caleo.id` → forward ke email personal kamu (untuk data request per Privacy Policy)
   - `noreply@caleo.id` → sender-only untuk transactional email (Supabase Auth)
4. Configure Supabase Auth sender: replace default `noreply@mail.app.supabase.io` dengan `noreply@caleo.id` (professional)
5. Test: send email ke `support@caleo.id`, verify received di inbox personal

Effort: ~2-3 jam (termasuk DNS verify propagation)

**Part D: HTTP security headers (add-in — production hardening)**:

Configure headers di 3 layer:

1. **`caleo-landing/firebase.json`** — add headers config:
   - `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` (force HTTPS)
   - `X-Content-Type-Options: nosniff` (prevent MIME confusion)
   - `X-Frame-Options: DENY` (prevent clickjacking)
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy: geolocation=(), microphone=(), camera=()` (deny unless needed)
   - `Content-Security-Policy: default-src 'self'; ...` (customize based on landing needs — images, fonts, analytics origins)

2. **Cloud Run frontend (`app.caleo.id`)** — via Nginx config `nginx.conf`:
   - Same security headers via `add_header` directive
   - CSP customized untuk allow Supabase + Cloud Run + Cloudflare origins

3. **Cloudflare** (semua subdomain):
   - Enable HSTS via Cloudflare SSL settings
   - Enable "Always Use HTTPS" toggle
   - Configure Page Rules kalau perlu additional headers

**Verification**:
- `curl -I https://caleo.id` → verify all security headers present
- `curl -I https://app.caleo.id` → verify all security headers present
- Test via `https://securityheaders.com/` (external scanner) → target grade A minimum
- Test via `https://csp-evaluator.withgoogle.com/` → CSP passes evaluator

Effort: ~2-3 jam

**Deliverable Day 16 combined**: Firebase landing deployed + Zoho Mail configured + security headers audited grade A

**Effort Day 16 total**: ~8-11 jam

---

#### Day 17 (Sabtu, 2026-08-01) — DNS cutover caleo.id root + full-journey E2E test

**Fix**:
1. **DNS switch** di Cloudflare:
   - Remove/disable Cloudflare Worker placeholder route untuk `caleo.id/*`
   - Add DNS record baru: `A caleo.id → <Firebase Hosting IP>` (Firebase provide IP saat kamu add custom domain)
   - Atau setup Firebase custom domain: Firebase Console → Hosting → Add custom domain → `caleo.id`, follow Firebase's DNS instructions
2. **SSL cert**: Firebase auto-provision (Let's Encrypt), 15-60 menit propagation
3. **Verify DNS resolution**:
   ```bash
   dig caleo.id +short
   curl -I https://caleo.id
   # Harus return 200 + serve landing content, bukan Cloudflare Worker placeholder
   ```
4. **Full-journey E2E test**:
   - Visitor buka `https://caleo.id/` → landing render OK
   - Click "Login" CTA → redirect ke `https://app.caleo.id/login` (verify link updated di landing)
   - Login sebagai Garindo owner → dashboard
   - Balik ke landing → session preserved (SSO check)
5. **SEO check**:
   - Sitemap reachable: `https://caleo.id/sitemap.xml`
   - robots.txt reachable: `https://caleo.id/robots.txt`
   - Google can crawl (Search Console verify domain — optional, bisa Phase 2)
6. **Optional micro-fix**: kalau ada broken image/link di landing setelah cutover, fix immediately

**Verification**:
- 5-item full journey test all green
- `https://caleo.id` serving Firebase landing (not Cloudflare Worker placeholder)
- SSL cert issuer = Google Trust Services (via Firebase) atau Let's Encrypt
- Screenshot progress.md dengan caleo.id landing live

**Deliverable**: caleo.id live serving real landing content, DNS cutover complete, full journey verified. Phase 1 COMPLETE.

**Effort**: ~4-6 jam (termasuk DNS propagation wait ~30-60 menit background)

**End of Phase 1 checkpoint**: Phase 1 COMPLETE. Semua irreversible-now items shipped, semua safety-critical items shipped, monitoring + error tracking live, backup verified restorable, landing live at caleo.id, tenant #2 bisa onboard tanpa hutang teknis operasional atau observability blindness. Marketing bisa direct traffic ke caleo.id.

### Phase 1 Success Criteria (semua harus true untuk mark complete)

- ✅ Chat-media + semua bucket dengan tenant-prefixed path, no public bucket exposing tenant data
- ✅ `app.caleo.id` serving ERP frontend, no hardcoded Cloud Run URL di FE
- ✅ 4 subdomain lain (`caleo.id`, `admin.caleo.id`, `staging.caleo.id`, `admin.staging.caleo.id`) live dengan Cloudflare Worker placeholder (zero-cost)
- ✅ `caleo.web.id` 301 redirect ke `caleo.id` working
- ✅ `users.platform_admin` column exists, founder seeded `true`
- ✅ Cross-subdomain session (SSO via cookie scope `.caleo.id`) verified working
- ✅ `/api/v1/*` prefix live, backward-compat 6 bulan untuk `/api/*` legacy
- ✅ 5 high-volume tabel dengan composite PK `(tenant_id, id)`
- ✅ Structured logging aktif dengan `tenant_id` di setiap log entry
- ✅ 5 critical write RPC dengan idempotency token support
- ✅ Health probe split (live vs ready), Cloud Run probes configured
- ✅ **Monitoring baseline live**: Cloud Monitoring alerts + Uptime Robot, alert routing ke founder confirmed
- ✅ **Error tracking (Sentry) live**: FE + BE integrated, events tagged dengan tenant_id
- ✅ **PITR restore verified**: dokumen restore procedure + tested restore success
- ✅ Tenant deprovision flow verified + documented
- ✅ Secret rotation policy documented
- ✅ Cloud Run cold-start policy decided + configured (min-instances per service)
- ✅ Load test baseline captured (p50/p95/p99, RPS) untuk future compare
- ✅ Feature flag usage documented + reference impl (Saldo Awal)
- ✅ Onboarding runbook complete
- ✅ E2E multi-tenant smoke test passed (10-check isolation confirmed)
- ✅ All migrations idempotent + `get_advisors` clean
- ✅ Zero delta cost dari architecture ini di Phase 1 (semua placeholder + Sentry + Uptime Robot + Firebase Hosting = free tier)
- ✅ **Landing rewrite complete**: content rebrand Vosi → Caleo, meta tags updated, sitemap updated, folder renamed `caleo-landing/`
- ✅ **Firebase Hosting deployed**: `caleo-landing/` accessible via Firebase URL
- ✅ **caleo.id root live serving real landing** (bukan placeholder), DNS cutover complete, full journey landing→login→dashboard verified
- ✅ **Privacy Policy + Terms of Service** live di `caleo.id/privacy` + `caleo.id/terms`, linked di footer
- ✅ **Support email setup** (Zoho Mail free tier): founder@, support@, privacy@, noreply@caleo.id all configured
- ✅ **Auth flow verified end-to-end**: password reset, email verification, session refresh cross-tab, session timeout
- ✅ **Seed script verified**: fresh tenant provision → all default data (COA, warehouse, category) present
- ✅ **Frontend error boundary + 404 page** implemented, prevent white-screen crashes
- ✅ **HTTP security headers** grade A di securityheaders.com untuk semua subdomain
- ✅ **Rollback procedure documented** — Cloud Run, migration, landing, DNS revert steps + decision tree

---

## Phase 2: Post-Tenant-#2 Landing (Outline)

**Trigger**: Tenant #2 (di luar Garindo) sudah live production ≥1 minggu, ada pola pemakaian nyata untuk observability data.

**Estimasi durasi**: 4-6 minggu, interleaved dengan feature-work (bukan freeze).

**Scope (reordered by criticality — target 10-tenant readiness)**:

1. **Cost tracking per tenant (MVP)** — [PRIORITY: bring forward untuk 10-tenant target] Basic dashboard: Gemini API calls per tenant, Cloud Run request count per tenant, storage bytes per tenant. Alert ke founder kalau ada 1 tenant yang cost/month > 3× median. Deploy inline dulu (embed di admin app saat itu build), atau standalone script yang generate report weekly. **Kritis untuk 10-tenant scale** — 1 outlier tenant bisa habiskan runway silent.

2. **Build platform admin app (`admin.caleo.id`)** — [PRIORITY: bring forward] Replace Cloudflare Worker placeholder dengan real Cloud Run service. Monorepo refactor: pindah existing `src/` → `apps/tenant/`, create `apps/admin/` sebagai new SPA. Minimum viable: `/tenants` (list, provision via UI, deprovision), `/flags` (feature flag toggle per tenant), `/billing` (cost per tenant dari item #1). Deploy pipeline: same repo, separate Cloud Run service `platform-admin-prod`. Cost aktual: scaled-to-zero — untuk usage kamu personal (~100 req/hari) practically **~Rp 0/bulan** (di dalam Cloud Run free tier 2M req/bulan).

3. **Rate limiting per tenant** — [MOVED UP] API middleware Go dengan token bucket per `tenant_id`. Default 100 req/s per tenant, configurable via `tenant_subscriptions.rate_limit_override`. **Kritis untuk 10-tenant scale** — 1 tenant abuse script bisa impact 9 tenant lain.

4. **Async job infrastructure** — Cloud Tasks atau Pub/Sub. Migrate `internal/scheduler/timeout.go` dari `time.AfterFunc` ke queue-backed. Alasan: dengan 10 tenant, cron jobs collide + restart Cloud Run bikin scheduled work hilang.

5. **Build staging environments** — `staging.caleo.id` + `admin.staging.caleo.id` sebagai Cloud Run services scaled-to-zero. **Same Supabase project** dengan dedicated test tenants (reuse "Toko Jaya Makmur" pattern per memory). Deploy pipeline: same repo, deploy on merge-to-`staging` branch. Cost aktual: **~Rp 0/bulan** untuk idle-heavy usage (Cloud Run scaled-to-zero).

6. **Per-tenant export/import RPC** — SQL dump `WHERE tenant_id = $1` + storage files tenant-prefixed. Butuh Phase 1 tenant-prefixed storage done dulu. Trigger dari `admin.caleo.id/tenants/<id>/export`.

7. **Audit log completeness verification** — sweep semua data-mutating RPC, verify write ke `audit_log`. Fix yang missing. Cross-tenant audit trail available di `admin.caleo.id/audit`.

**Success criteria**: Cost per tenant visible + alert-able, admin dashboard live dengan basic tenant management, rate limit enforced, async job survive Cloud Run restart, staging environment functional, tenant bisa self-export data.

**Cost reality untuk Phase 2 (correction dari draft sebelumnya)**:
- Subdomain (DNS + SSL): **FREE selamanya** (Cloudflare + Google-managed cert)
- Cloud Run service (admin, staging, admin-staging): **scaled-to-zero → ~Rp 0/bulan** untuk usage founder personal + light traffic
- Cloud Run free tier: 2M requests/bulan + 400k GB-seconds
- Total Phase 2 DELTA cost dari architecture: **~Rp 0-20k/bulan realistically** (bukan 30-50k seperti draft sebelumnya)

---

## Phase 3: Pre-Tenant-#10 (Outline)

**Trigger**: Sekitar tenant #5-8 landing, atau 6-12 bulan dari sekarang.

**Estimasi durasi**: Bertahap sepanjang beberapa bulan, tidak perlu freeze.

**Scope**:

1. **Read replica + read/write split** — Supabase read replica (kalau plan support) atau logical replica. Refactor Go `internal/db/` jadi `dbRead`/`dbWrite`. Laporan berat + dashboard pindah ke replica.

2. **Monitoring + alerting** — Cloud Monitoring + custom alerts (per-tenant error rate spike, latency p99 spike, RPC failure rate). Uptime checks.

3. **Session/JWT refresh strategy** — verify + document Supabase behavior cross-tab, TTL, refresh trigger. Fix edge cases yang muncul.

4. **Storage bucket size monitoring per tenant** — supaya tenant besar tidak diam-diam meningkatkan storage cost.

5. **Feature flag disiplin enforcement** — sweep code base untuk hardcoded per-tenant logic, migrate ke `feature_overrides` pattern.

**Success criteria**: Alert kena sebelum tenant complain, replica cut read load ≥30% dari primary, session behavior documented + tested.

---

## Phase 4: Pre-Tenant-#100 (Outline)

**Trigger**: Sekitar tenant #50 landing, atau tahun ke-2 dari sekarang.

**Estimasi durasi**: Bertahap sepanjang beberapa bulan.

**Scope**:

1. **Table partitioning** — high-volume tables (`stock_movements`, `journal_entry_lines`, `t_orders`) partition by `(tenant_id, time_bucket)`. Butuh composite PK done (Phase 1) sebagai prerequisite.

2. **Data retention policies** — auto-archive/purge data >7 tahun per regulasi pajak Indonesia. Cold storage tier.

3. **Webhook outbound infrastructure** — Pub/Sub topic + signed webhook sender. Untuk tenant yang minta integrasi ke Xero, Jubelio, dll.

4. **Security audit / pen test** — external audit. Fix findings.

5. **Load testing** — simulate 100 tenant, 1000 concurrent user, verify latency SLA.

6. **Compliance readiness** — PP 71/2019 (Perlindungan Data Pribadi) + audit trail regulator-ready.

**Success criteria**: Storage cost stays flat per tenant despite growth, external audit passes, load test at 100 tenant scale confirmed.

---

## Deferred (Trigger-Based, No ETA)

Item ini **tidak** masuk roadmap sampai ada sinyal spesifik:

| Item | Trigger untuk mulai |
|---|---|
| **Microservices split** | Bukti empiris pain spesifik (e.g., WA pipeline overwhelm API pod, Gemini worker butuh GPU scale) — bukan "sepertinya nanti butuh" |
| **Multi-region deployment** | Regulator paksa data residency, atau customer besar demand region-specific |
| **Timezone per tenant** | Onboard tenant pertama di luar timezone Asia/Jakarta |
| **Multi-currency support** | Onboard tenant pertama di luar Indonesia |
| **SSO / SAML** | Enterprise customer demand |
| **White-label branding per tenant** | Marketing pitch require per-tenant look |

---

## Decision Points

### Resolved (Locked)

| # | Decision | Resolution | Locked |
|---|---|---|---|
| D1 | Root `caleo.id` DNS saat landing di-hold | **Cloudflare Worker placeholder** — 5 menit setup, zero-cost, brand tetap represented | 2026-07-16 |
| D2 | Multi-tenant URL pattern | **Shared `app.caleo.id` tenant via JWT** — semua tenant login di URL sama, isolasi via RLS + tenant_id | 2026-07-16 |
| D8 | Admin dashboard architecture (tenant admin vs platform admin) | **Tenant admin INLINE** di `app.caleo.id/settings` (role-gated) + **Platform admin SEPARATE** subdomain `admin.caleo.id` | 2026-07-16 |
| D9 | Staging environment strategy | **Subdomain separation**: `staging.caleo.id` + `admin.staging.caleo.id`. **Same Supabase** dengan dedicated test tenants (zero-cost until Phase 2 real deploy) | 2026-07-16 |
| D10 | `caleo.web.id` disposition (bonus free domain) | **301 redirect** ke `caleo.id` via Cloudflare Page Rule. Drop di renewal Y1 kecuali ada use case muncul. | 2026-07-16 |
| D11 | TLD choice | **`.id`** (rejected `.co.id` — no PT/CV; rejected `.com` — kalah brand Indonesian) | 2026-07-16 |

### Accepted Defaults (locked 2026-07-16 saat founder said "continue")

| # | Decision | Accepted resolution |
|---|---|---|
| D3 | Migration slot range Phase 1 | **300-329** (far dari QA-sweep 054-079 & Session 2's 080-099) |
| D4 | Feature flag reference impl | **Saldo Awal** module (baru, clean case untuk toggle) |
| D5 | Bug operasional Garindo bar selama freeze | **A — hanya blocking daily ops** (paling disiplin) |
| D7 | Test tenant smoke test Day 10 | **"Toko Jaya Makmur"** (existing prod-testing-tenant) |

### Pending (belum urgent, resolve saat execution)

| # | Decision | Note |
|---|---|---|
| D6 | Domain registrar — mana yang founder pilih untuk `.id` | Domain sudah aktif (`caleo.id`). Update spec dengan registrar name saat founder confirm (untuk memory + reference). Tidak block Phase 1 execution. |

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Domain PANDI verification lambat (>24h) | Medium | Delay Day 3 | Beli domain 1-2 hari sebelum freeze mulai; setup nameserver di Cloudflare paralel |
| Chat-media data migration break existing chat display | Medium | UX regression Garindo | Rollout dengan flag: baca dari path lama kalau path baru not found, gradual cutover |
| Composite PK migration menyentuh RLS predicate | Low | Query slowdown | EXPLAIN ANALYZE sebelum & sesudah, benchmark 5 hot query minimum |
| Structured logging migration bikin log message hilang di transition | Low | Debug harder short-term | Migrate 1 subsystem at a time, keep old + new format side-by-side selama 24 jam |
| Idempotency table jadi hot spot | Low | Write latency naik | Index `(tenant_id, rpc_name, created_at)`, TTL cleanup >30 days, monitor row growth |
| Freeze bocor karena Garindo minta feature critical | Medium | Slip 2-3 hari | Apply D5 default (bar A: hanya blocking daily ops), semua request non-blocking → post-freeze list |
| Bug baru muncul dari Phase 1 setelah tenant #2 landing | Low | Regression di prod | Comprehensive smoke test Day 10, monitoring alerts kalau tenant #2 error rate anomali |

---

## Appendix A: Domain Guide (Reference)

### TLD choice — DECIDED 2026-07-16: `.id`

Founder pilih **`caleo.id`** (rebrand dari "Vosi" pada 2026-07-16). Cost profile:
- Year 1: ~Rp 2,200,000 (premium first-year registration untuk short domain)
- Year 2+: ~Rp 200,000/tahun (PANDI wholesale rate)
- 5-year TCO: ~Rp 3,000,000

Rationale: brand asset jangka panjang (10+ tahun), positioning Indonesian, 3-huruf memorable, standard renewal setelah year 1. `.co.id` (opsi hemat) tidak dipilih karena tidak ada PT/CV.

**Alternatif yang ditolak**:
- `.co.id` — cheaper (~Rp 300k/tahun), tapi requires PT/CV yang belum ada
- `.com` — kalah brand Indonesian, sitemap sudah reference `caleo.id`
- `.my.id` — kesan personal, bukan bisnis serius

### Registrar recommendation

| Registrar | First year | Renewal | Catatan |
|---|---|---|---|
| **Domainesia** | Rp 100-150k promo | Rp 250-300k | Populer, support Bahasa, transfer OK |
| **IDwebhost** | Rp 150-200k | Rp 250-300k | Long-standing, reliable |
| **Namecheap** | ~Rp 300-400k | Sama | USD billing, API robust |

**Rekomendasi**: **Domainesia atau IDwebhost** untuk `.id`. Setup pattern: register di Domainesia/IDwebhost → nameserver delegated ke Cloudflare (gratis DNS management + API). Best of both.

### Timeline warning

`.id` PANDI verification bisa 1-24 jam. Beli domain **hari ini/besok** supaya tidak delay Day 3 Phase 1.

---

## Appendix B: Definition of Done (per CLAUDE.md)

Sebelum Phase 1 declared complete, semua ini harus true:

- Stop-hook gates green (`npm run lint`, `audit:numinput`, `audit:secdef-null-tenant`, `vitest --changed`)
- Ship & verify Stage 1 (Local) + Stage 2 (Deploy) + Stage 3 (Prod smoke on prod-testing-tenant "Toko Jaya Makmur") — untuk setiap deliverable
- Post-migration → `mcp__plugin_supabase_supabase__get_advisors` clean
- Observability: entry log + error log + usage counter untuk new features
- Cost impact: no new paid-API introduced tanpa founder approval
- Irreversible architectural decisions → memo di `docs/superpowers/specs/` (this doc IS the memo)
- Prod broke during work → incident logged to `docs/incidents/`
- `progress.md` updated dengan WHAT + WHY
- No TODO / dead code / commented block di diff
- `advisor()` consulted per expanded trigger list

---

## Change Log

| Date | Change | Author |
|---|---|---|
| 2026-07-15 | Initial draft | Claude + Founder |
| 2026-07-16 | Lock TLD decision: `.id` (rejected `.co.id` — no PT/CV yet); update Appendix A | Claude + Founder |
| 2026-07-16 | Rebrand Vosi → Caleo; domain `caleo.id` purchased; bulk update vosi.id → caleo.id references throughout | Claude + Founder |
| 2026-07-16 | Lock 5-subdomain URL architecture (best practice separation): landing/tenant/admin/staging/admin-staging. Add URL Architecture section. Update Day 3 to include multi-subdomain setup + placeholders + platform_admin column. Add build admin/staging to Phase 2 outline. Resolve D1, D2. Add D8, D9, D10, D11. Zero-cost constraint enforced (Cloudflare Workers for placeholders, Cloud Run scaled-to-zero for Phase 2 services). | Claude + Founder |
| 2026-07-16 | Reframe scope from "1-tenant now" → "10-tenant readiness" per founder correction. Confirmed 2-week Phase 1 scope is CORRECT (not over-engineered) under 10-tenant framing. Reorder Phase 2: cost tracking + admin app + rate limiting bring forward. Correct cost table — Cloud Run scaled-to-zero practically ~Rp 0/bulan untuk founder usage (free tier absorbs). Accept D3, D4, D5, D7 defaults. D6 pending (registrar name TBD, non-blocking). | Claude + Founder |
| 2026-07-16 | Expand Phase 1: 10 → 14 days (Sat-Sun on, founder willing). Add 3 CRITICAL items (PITR restore test, monitoring baseline Cloud Monitoring + Uptime Robot, error tracking Sentry) + 3 IMPORTANT (cross-subdomain session verify, tenant deprovision flow verify, Cloud Run cold-start policy + load test baseline + secret rotation doc). PII scan deferred per founder request. Restructure days sequentially (no Week 1/Week 2 split). Update Success Criteria (22 items). | Claude + Founder |
| 2026-07-16 | Expand Phase 1: 14 → 17 days. Add landing rewrite + Firebase deploy (Day 15-17): content rebrand Vosi → Caleo, meta tags/sitemap/robots updated, folder rename `vosi-landing/` → `caleo-landing/`, Firebase Hosting setup + deploy, DNS cutover caleo.id root dari Cloudflare Worker placeholder → Firebase real landing, full-journey E2E test. Add execution flexibility principle: Day = task unit (bukan calendar), maju kalau task selesai. | Claude + Founder |
| 2026-07-16 | Final gap check — add 1 CRITICAL (Privacy Policy + Terms of Service — legal PP 71/2019 requirement) fold ke Day 15; add 6 IMPORTANT fold-ins: (1) full auth flow verification → Day 3, (2) rollback procedure doc → Day 12, (3) seed script verify + FE error boundary + 404 page → Day 14, (4) support email setup Zoho Mail free tier → Day 16, (5) HTTP security headers config → Day 16. Total scope 18 → 25 items, effort 100-125j → 115-140j. Phase 1 stays 17 days (fold-ins extend per-day effort). | Claude + Founder |

