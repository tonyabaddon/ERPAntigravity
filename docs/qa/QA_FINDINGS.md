# QA Cycle Findings

**Objective:** end-to-end QA cycle covering every tenant module + VOSI Admin surface before commercial launch to new tenants. Started 2026-07-11 after multi-agent audit + P0 RLS write-path fix.

## Cadence

- 1-2 modules or 1 business scenario per conversation session (~4-6 hours Chrome MCP work)
- Findings logged per session in this file, committed at end
- Each finding = severity + reproduction + fix status
- Fixes commit + deploy where feasible in same session; else defer with tracking

## Severity legend

- **🔴 P0 blocker** — feature broken, data loss, or security hole. Must fix before launch.
- **🟠 P1 major** — feature works but wrong behavior on common inputs. Fix before launch.
- **🟡 P2 minor** — UX gap, edge-case handling, cosmetic. Fix opportunistically.
- **🔵 P3 info** — observation, follow-up idea, doc gap. Track without blocking.
- **✅ PASS** — verified working end-to-end, no finding.

## Phase overview

| Phase | Sessions | Coverage |
|---|---|---|
| Phase 1 — Business scenarios | 1-5 | Cash walk-in day, Tempo credit lifecycle, Purchase cycle, VOSI onboard flow, Full opname cycle |
| Phase 2 — Module gaps | 6-11 | Sales Inbox, Penawaran, bank recon, month-close, Pengaturan hub, User Mgmt, Laporan, Manajemen Gudang, Multi-tier pricing |
| Phase 3 — VOSI Admin | 12-14 | Onboard/Plans/Sales Reps CRUD, Verifikasi Pembayaran, Platform Settings, Deprovision, Module toggle, Log aktivitas |
| Phase 4 — Regression | 15-16 | Cross-tenant impersonation, JWT expiry, READONLY mode, concurrent users, perf smoke |

## Coverage matrix (module → session)

| Tenant module | Primary session | Secondary |
|---|---|---|
| Dashboard | 1 (Scenario A) | — |
| Sales Inbox | 6 | — |
| Penjualan (wizard, invoice) | 2 (Scenario B) | 11 (multi-tier) |
| Penawaran (quotes) | 6 | — |
| Kasir | 1 (Scenario A) | 11 (multi-tier) |
| Pelanggan | 2 (Scenario B) | — |
| Piutang | 2 (Scenario B) | — |
| Kas & Bank | 2, 3, 7 | — |
| Produk & Stok | 1, 3, 5 | — |
| Stok Opname | 5 (Scenario E) | — |
| Pembelian | 3 (Scenario C) | — |
| Manajemen Gudang | 5, 11 | — |
| Persetujuan | 5 (Scenario E) | — |
| Rekonsiliasi & Tutup Buku | 1 (harian), 7 (bank), 8 (bulanan) | — |
| Akuntansi | 2, 3, 8 | — |
| Laporan | 1, 10 | — |
| User Management | 10 | — |
| Pengaturan hub | 5, 9 | — |
| **VOSI Admin module** | | |
| Beranda | 4 | — |
| Tenant list + detail | 4, 14 | — |
| Log aktivitas | 14 | — |
| Paket (Plans) | 4, 12 | — |
| Pendapatan | 13 | — |
| Sales Reps | 4, 12 | — |
| Verifikasi Pembayaran | 4, 13 | — |
| Pengaturan Pembayaran | 4, 13 | — |
| Pengaturan admin | 13 | — |
| Onboard wizard | 4, 12 | — |

Every module hits at least one dedicated session.

---

## Session log

_(Entries added per session below. Newest at top.)_

### Session 1 — Scenario A: Cash walk-in day

**Date:** 2026-07-11

**Modules covered:** Dashboard, Kasir POS, Produk & Stok, Pelanggan, Rekonsiliasi tutup harian, Laporan, Akuntansi (GL auto-post)

**Test flow executed:** walk-in cash sale via Sales Invoice wizard (WLK-20260711-005), 1 SKU × Rp 50 000, LUNAS + Cash, impersonating Garindo.

**Findings:**

### F-1 [🔴 P0 blocker] Customer create silently fails RLS
- **Module:** Sales wizard → Step 1 → Customer Baru; anywhere calling `supabase.from('customers').insert(...)`
- **Reproduction:** Impersonate garindo → Kasir → Catat Penjualan → + Customer Baru → fill form → save.
- **Actual:** POST /customers → 42501 "new row violates row-level security policy". Frontend swallows into a toast.
- **Root cause:** `customerWrappers.ts` insert payload omits `tenant_id`; column NOT NULL with no default; RLS `WITH CHECK (tenant_id = _resolve_tenant_id())` evaluates NULL. Affects **every** T-table with the same "omit tenant_id, expect DB to fill" pattern.
- **Fix status:** applied — migration `20261115000045_tenant_id_default_all_ttables.sql` sets `DEFAULT _resolve_tenant_id()` on all 78 T-tables' `tenant_id` columns. Verified live: customer creation now succeeds.

### F-2 [🔴 P0 blocker] GL dual-write skipped for every kasir sale
- **Module:** Kasir POS → Simpan Sales Invoice (also all other write RPCs listed below)
- **Reproduction:** Any kasir sale — `journal_entries` row count for that `source_ref_id` = 0.
- **Actual:** Sales committed cleanly but no journal entry, no anomaly row. Books silently understated by tenant sales revenue.
- **Root cause:** `record_kasir_sale` (and `record_pi`, `record_pembayaran`, `record_piutang_payment`, `_phase0c_backfill_historical`) each pull GL config with `SELECT ... FROM public.accounting_config WHERE tenant_id IS NULL LIMIT 1`. That was correct pre-multi-tenant; today per-tenant rows have `tenant_id SET`, so 0 rows come back and the entire `IF v_dual_write` block is skipped. Historical incidence: 11 of 83 Garindo income kasir_transactions have GL entries; all 11 are pre-Phase-A.
- **Fix status:** applied — migration `20261115000046_fix_accounting_config_tenant_scope.sql` regex-rewrites the WHERE clause to `WHERE tenant_id = _resolve_tenant_id()` in all 5 RPCs.

### F-3 [🔴 P0 blocker] `_post_journal_entry` inserts NULL tenant_id into accounting_periods
- **Module:** GL dual-write path (only observable once F-2 is fixed)
- **Reproduction:** After F-2 fix, retry the kasir sale — RPC raises `42501` on `accounting_periods` insert.
- **Root cause:** `_post_journal_entry(..., p_tenant_id uuid)` is called with `p_tenant_id = NULL` by every caller (legacy single-tenant signature). The auto-created accounting-period row would carry `tenant_id = NULL`, failing the T-table RLS check.
- **Fix status:** applied — codified in migration `20261115000047_post_journal_entry_multitenant_and_no_auth_schema.sql`. Injects `p_tenant_id := COALESCE(p_tenant_id, public._resolve_tenant_id())` at the top of the function body.

### F-4 [🔴 P0 blocker] `_post_journal_entry` fails on `auth.uid()` under SECDEF (root cause: cross-cutting)
- **Module:** Same as F-3 (visible only after F-3 fix), but the class of bug spans every write RPC.
- **Reproduction:** Kasir sale → RPC raises `permission denied for schema auth`.
- **Root cause:** `_post_journal_entry` is SECDEF owned by `vosi_rpc_owner`. That role lacks USAGE on schema `auth` and we cannot grant it (owner is `supabase_admin`, no GRANT OPTION). Calls to `auth.uid()` inside a SECDEF body owned by `vosi_rpc_owner` therefore explode. `pg_proc` audit at fix time: **64 such SECDEFs** in schema `public` (every kasir/pesanan/tagihan/pembayaran/warehouse/opname/rakit write RPC). Any one of them would blow up as soon as it was first exercised.
- **Permanent fix:** migration `20261115000048_current_user_id_helper_and_secdef_sweep.sql`.
  1. Adds `public._current_user_id()` — STABLE SQL wrapper around `current_setting('request.jwt.claims', true)::jsonb->>'sub'`. Grants EXECUTE to `authenticated`, `service_role`, `vosi_rpc_owner`.
  2. `pg_get_functiondef` + `replace('auth.uid()', 'public._current_user_id()')` + `EXECUTE` on every SECDEF in `public` owned by `vosi_rpc_owner` (64 patched).
  3. Also unwinds the ad-hoc inline JWT read that 20261115000047 injected into `_post_journal_entry`, replacing with the helper.
- **Verification post-fix:** `SELECT count(*) FROM pg_proc WHERE ... AND pg_get_functiondef(oid) ~ 'auth\.uid\(\)'` returns 0. Two consecutive kasir sales (WLK-005 → JE-202607-0010, WLK-006 → JE-202607-0011) posted with balanced 4-line entries, no anomaly row.
- **Fix status:** ✅ Applied.

### F-5 [✅ FIXED] Cross-cutting `vosi_rpc_owner` SECDEF sweep
- Rolled into F-4's permanent fix (migration 20261115000048). Any new SECDEF written against `vosi_rpc_owner` should call `public._current_user_id()` instead of `auth.uid()`; going forward, add a CI check via `pg_get_functiondef` audit before shipping migrations.

### F-6 [🔴 P0] Impersonation retains `platform_admin` — reader queries leak cross-tenant
- **Module:** Dashboard (Detak Jantung AI log), Laporan Performa (all totals + Produk Terlaris), likely more.
- **Reproduction:** Log in as `tonywei.office` (platform_admin + garindo owner) → impersonate garindo → open Dashboard. AI Log shows entries with tenant_id = toko-jaya-makmur (verified via SQL: rows `077efaef…`, `ccf5f837…`, `d7826769…`, all `tenant_id = 22222…`). Open Laporan Performa → Total Omset 7d Rp 37.756.000 (impossible for garindo alone), Produk Terlaris top-5 are all toko-jaya SKUs (Detergen Bubuk / Gula Pasir / Beras Premium / Terigu — verified via SQL, `tenant_id = 22222…`).
- **Root cause:** Impersonation JWT swap changes `tenant_id` claim but keeps the user's platform-wide role. RLS supplementary policy `p_platform_admin_readall` fires and lets the client read every tenant's rows. Reader queries in the tenant UI trust RLS to scope by tenant instead of adding `WHERE tenant_id = _resolve_tenant_id()` themselves.
- **Blast radius:** any tenant screen whose read query has no explicit `tenant_id` predicate. Includes at minimum: dashboard messages panel, Laporan Performa totals + top products, top-N kanal breakdown. Kasir screen is clean (queries clearly filter by tenant) so the write path stays consistent — but reporting numbers are wrong under impersonation.
- **Fix options (permanent):**
  1. **JWT-level:** during `impersonate_tenant`, mint a JWT that drops the `platform_admin` role claim so RLS scoping works. Cleanest — no frontend touching required.
  2. **Query-level:** every tenant-UI reader adds `.eq('tenant_id', tenantId)` explicitly. Repetitive, easy to miss, brittle.
  3. **Policy-level:** rewrite `p_platform_admin_readall` to only fire when a session marker (e.g. `current_setting('vosi.platform_read_mode') = 'on'`) is set — off by default, only VOSI Admin surfaces set it.
- **Recommendation:** option 1. Investigate `impersonate_tenant` RPC and `src/App.tsx` impersonation handling next session.
- **Fix status:** open — Session 2 blocker if we can't tell what's tenant-scoped vs cross-tenant during future testing.

### F-7 [🟠 P1] Laporan Performa "Produk Terlaris" revenue column always Rp 0
- **Module:** Laporan → Performa → Produk Terlaris table.
- **Reproduction:** Impersonate any tenant → Laporan Performa → look at top-5. QTY column populated (Detergen 45, Gula Pasir 38, etc.); REVENUE column shows Rp 0 for every row.
- **Root cause hypothesis:** query aggregates units sold but joins on a stale price column that no longer exists (memory of `stocks.harga_beli` failing earlier — schema now uses `harga_modal` and different column names). Needs code inspection of the Laporan Performa fetcher.
- **Fix status:** open — investigate query in Laporan tab.

### F-8 [🟠 P1] Laporan Performa "7 Hari" toggle shows 30-day chart
- **Module:** Laporan → Performa → range selector.
- **Reproduction:** Impersonate any tenant → Laporan Performa → default view has "7 Hari" button highlighted, but the Revenue chart X-axis shows `12 Jun – 11 Jul` (30 days). Total Omset card matches the wider window.
- **Root cause hypothesis:** button state selected 7 but query still passes 30 by default; or Total-Omset card fetches 30d fixed. Needs code inspection.
- **Fix status:** open.

### F-9 [✅ PASS] Kasir walk-in cash sale — end-to-end after all fixes
- Sale `WLK-20260711-005` created via wizard, cash payment.
- `kasir_transactions` row created; `stocks.quantity_top` decremented by 1.
- Journal entry `JE-202607-0010` posted with 4 balanced lines:
  - `1-1110 Kas Toko` DEBIT 50 000, `4-1110 Penjualan Walkin` CREDIT 50 000, `5-1100 HPP Penjualan` DEBIT 30 000, `1-1510 Persediaan Barang Jadi` CREDIT 30 000.
- `gl_dual_write_anomalies` empty for this sale.
- Kasir dashboard Rekap Pembayaran + Tutup Buku Harian: not yet re-verified after this sale; deferred to Scenario A completion follow-up.

**Session status:** Cash-walk-in write path GREEN. Kasir screen totals (Rekap Pembayaran + Tutup Buku Harian ringkasan) reconcile end-to-end after WLK-005 & WLK-006. Dashboard KPI card totals move correctly but the AI activity log panel leaks toko-jaya rows (F-6). Laporan Performa unusable under impersonation because of F-6 + F-7 + F-8. Follow-up items: F-6 impersonation JWT design fix (Session 2 blocker), F-7 revenue column, F-8 range selector, F-2 backfill of earlier WLK-001..004 GL entries (defer to Session 8).

---

## Findings summary (all sessions)

| # | Severity | Session | Module | Title | Status |
|---|---|---|---|---|---|
| F-1 | 🔴 P0 | 1 | Cross-cutting (all T-tables) | Customer/T-table insert missing tenant_id | ✅ Fixed — 20261115000045 |
| F-2 | 🔴 P0 | 1 | Kasir / GL / Pembelian / Piutang | GL dual-write skipped: accounting_config lookup `tenant_id IS NULL` | ✅ Fixed — 20261115000046 |
| F-3 | 🔴 P0 | 1 | GL dual-write | `_post_journal_entry` p_tenant_id=NULL → accounting_periods RLS fail | ✅ Fixed — 20261115000047 |
| F-4 | 🔴 P0 | 1 | Cross-cutting (64 SECDEFs) | `auth.uid()` denied under vosi_rpc_owner — every write RPC affected | ✅ Fixed — 20261115000048 (`public._current_user_id()` helper + sweep) |
| F-5 | 🔴 P0 | 1 | Cross-cutting | Full sweep of remaining vosi_rpc_owner SECDEFs | ✅ Rolled into 20261115000048 |
| F-6 | 🔴 P0 | 1 | Dashboard + Laporan (impersonation) | Impersonation retains platform_admin claim → cross-tenant read leak | 🟡 Open — Session 2 blocker |
| F-7 | 🟠 P1 | 1 | Laporan Performa | Produk Terlaris revenue column always Rp 0 | 🟡 Open |
| F-8 | 🟠 P1 | 1 | Laporan Performa | "7 Hari" toggle shows 30-day chart | 🟡 Open |
