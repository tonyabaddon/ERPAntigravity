# QA Session 5 — Live Interactive Testing Findings

**Date:** 2026-07-19 (autonomous, ~5+h execution)
**Mode:** Live interactive testing via chrome-devtools MCP + Playwright + SQL smoke.
**Auth:** Real Supabase sessions injected for `playwright-toko-owner@caleo.id` (Toko Jaya Makmur owner) and `playwright-admin@caleo.id` (platform admin).
**Fix policy:** Fix-as-you-go for trivial+local; advisor gate for architectural.

**Related:**
- Sessions 1-4: `docs/qa-week/2026-07-19-session{1,2,3,4}-findings.md`
- Design: `docs/superpowers/specs/2026-07-19-qa-week-comprehensive-design.md`
- Cleanup script: `docs/qa-week/pending-fixes/cleanup-qa-week-testdata.sql`

---

## Executive summary

**5 sessions, ~15h total autonomous testing. Cumulative coverage across static-analysis, DB integrity, backend Go, and live UI interactive = ~55-65% of the 7-day plan.**

**Fixes shipped this session (3 commits):**
- F5-02 KasirScreen "Catat Penjualan" URL `[object Object]` bug
- F5-03/F5-07 error stringify sweep across 11 files (20+ toast sites now show real errors)
- F5-09 App.tsx IMPERSONATE_FAILED same class

**Findings deferred to founder review (needs coordinated fix):**
- F5-05 `uq_customers_wa` cross-tenant unique constraint — needs backend + FE coordinated migration
- F5-06 `GetOrCreateCustomer` uses `gjp_cust_seq` hardcoded Garindo — backend refactor needed

---

## Methodology correction (important)

**Session 1 multi-tenant sweep was incomplete.** My JWT setup used only `sub`, so `_resolve_tenant_id()` returned zero-UUID → RLS trivially blocked EVERYTHING (both own and other tenant). The "0 leaks across 30 tables" result was a false positive of methodology — I wasn't testing isolation, I was testing "RLS blocks unauth requests" (which it does).

**Session 5 rerun with proper JWT (`sub` + `tenant_id` claim, Shape 2 per `_resolve_tenant_id()` body):**

| Test | Result |
|---|---|
| As tenant A (Garindo), read tenant B (Toko Jaya) rows across 20 tables | 0 read leaks |
| As tenant A, attempt UPDATE tenant B rows | 0 write leaks |
| Positive control: as Toko Jaya owner, own reads | 10 customers, 20 stocks, 19 kasir txn — matches DB baseline exactly |

**Multi-tenant isolation VERIFIED — the confidence is now real.** Session 1 finding upgraded to VERIFIED.

Additionally, cross-tenant UI navigation as Toko Jaya owner trying `/t/garindo/dashboard` was BLOCKED with a `TenantBootstrapError` render — defense-in-depth at UI layer works.

---

## Bugs found (fix-as-you-go)

### F5-02 [P1 — FIXED] — Kasir "Catat Penjualan" button URL bug

**Symptom:** Clicking "📋 Catat Penjualan" in Kasir screen navigated to `?screen=penjualanBaru&channel=[object Object]` (URL-encoded).

**Root cause:** `<button onClick={onOpenPenjualanBaru}>` passed React MouseEvent as the first argument `channel`. Handler in App.tsx line 804 populated URL with it via `stringify(channel)` → `[object Object]`.

**Fix:** wrap in arrow function `onClick={() => onOpenPenjualanBaru?.()}`.

**Blast radius:** cosmetic — wizard rendered correctly despite ugly URL. But breaks bookmarks / URL sharing.

**Commit:** `39e017d`

---

### F5-03 + F5-07 + F5-09 [P1 — FIXED (11 sites)] — Error stringify bug

**Symptom:** New customer save failed with toast `"Gagal simpan customer: [object Object]"`. Same pattern surfaced in cross-tenant navigation (`IMPERSONATE_FAILED: [object Object]`), rekonsiliasi save failures, sales inbox actions.

**Root cause:** Pattern `err instanceof Error ? err.message : String(err)` — Supabase PostgrestError is a plain object with `.message` but NOT an Error subclass. `instanceof` returns false → falls through to `String(err)` → `[object Object]`.

**Fix:** replace with existing `lib/extractErrorMessage` helper (already handles both cases). Swept 11 files → ~20 toast sites now show real DB error.

**Files:** App.tsx, OwnerDecisionInbox (3), RekonsiliasiScreen (3), SalesInboxScreen (4), PengaturanScreen (1), WhatsappAiScreen (1), PromoProdukPanel (3), SaldoAwalPanel (2), ApprovalGateEditor (1), WriteOffRequestModal (1), RevertWriteOffConfirmModal (1), NewCustomerInlineForm (1).

**Blast radius:** ZERO — no behavioral change beyond visible error text.

**Commits:** `39e017d`, `3347833`.

---

### F5-05 [P1 — DEFERRED for coordinated fix] — `uq_customers_wa` cross-tenant unique constraint

**Symptom:** As Toko Jaya owner, tried to create customer with phone `081234567890`. Save failed 409 (masked by F5-03 bug). Underlying cause: the phone number exists in Garindo's tenant.

**Root cause:** `UNIQUE (wa_number)` — table-global, not per-tenant. Should be `UNIQUE (tenant_id, wa_number)`.

**Impact classification (per advisor):**
- Not P0 (no auth bypass, no data leak beyond side-channel existence)
- Not a "cross-tenant leak" — just info disclosure sliver (409 tells you phone X exists somewhere)
- P1 due to FUNCTIONAL block: legitimate customer whose phone happens to collide with another tenant's customer cannot be added

**Why deferred:**
1. Backend `db/customers.go:16` uses `ON CONFLICT (wa_number)` — hard-depends on the current constraint
2. Backend function `GetOrCreateCustomer` uses `gjp_cust_seq` — Garindo-hardcoded; ID scheme won't work for other tenants either
3. Migration must be coordinated with backend fix + redeploy

**Recommended coordinated fix (advisor-approved plan):**
1. Migration slot X: `ALTER TABLE customers DROP CONSTRAINT uq_customers_wa; ADD CONSTRAINT uq_customers_wa_tenant UNIQUE (tenant_id, wa_number);`
2. Backend commit: rewrite `GetOrCreateCustomer` to take `tenantID` param, use `ON CONFLICT (tenant_id, wa_number)`, use tenant-aware ID scheme
3. Cloud Build deploy backend
4. Regression test: as tenant A insert phone X; as tenant B insert same phone X → both succeed; same-tenant same-phone still 409

**Blast radius (safe by construction, per advisor):** Existing data satisfies both constraints (old is stronger). Migration cannot fail on live data.

---

### F5-06 [P2 — DEFERRED] — Hardcoded Garindo in backend WA bot

**Location:** `backend-go/internal/db/customers.go:8-26` — `GetOrCreateCustomer` generates IDs via `gjp_cust_seq` (Garindo-specific sequence). Not tenant-aware.

**Impact:** WA bot's customer auto-create currently works only for Garindo. If any other tenant onboards WA bot, either:
- Their customers get Garindo-prefixed IDs (`GJP-CUST-0001`), or
- Sequence collision if backend attempts for their tenant

**Fix:** Refactor to tenant-aware ID generation. Bundle with F5-05 fix.

---

### F5-10 [P2 — DEFERRED] — Wrong error class for cross-tenant nav

**Symptom:** As tenant user navigating to `/t/other-tenant/dashboard`, error shows "IMPERSONATE_FAILED" — but this isn't impersonation, it's a regular access denied.

**Fix (product decision):** Detect if caller is platform_admin vs regular user; render "Access denied" or "Tenant not found" for regular users, not "IMPERSONATE_FAILED".

Not fixed autonomously — needs product/UX call.

---

## UI-side positive verifications

- ✅ Zero 5xx across all 23 screens navigated as authenticated tenant user (Playwright)
- ✅ Zero DOM/console errors during 20-screen batch nav sweep (chrome-devtools MCP)
- ✅ Multi-tenant isolation UI-side: no leak of "Garindo Jaya Panel" or "Warung Sinar Rezeki" in DOM across 5 screens
- ✅ localStorage does not leak other tenant IDs
- ✅ Cross-tenant URL nav (`/t/garindo/*` as Toko Jaya) blocked with error render
- ✅ Login page reachable + validation blocks malformed email
- ✅ Admin dashboard renders correctly (as super_admin)
- ✅ Admin tenant list shows 3 tenants with correct plan/status/expiry data
- ✅ Impersonation "No access" button correctly gated per tenant (needs Support Access grant)
- ✅ Audit log shows real recent activity (IMPERSONATE_START/END, PROVISION_TENANT, RECORD_PAYMENT, GRANT_ISSUED/REVOKED)
- ✅ Kasir POS wizard renders + channel selector + customer picker + inline customer create form
- ✅ Pembelian PO create form functional (supplier picker, tax %, item add, save draft/send buttons)
- ✅ Pengaturan Umum panel with all sub-sections (Identitas Toko, Jam Ops, PIN Owner, Costing FIFO/Average, CLIP monitor)
- ✅ Stok Opname empty-state renders correctly
- ✅ Laporan Performa: KPI cards + Revenue per Channel chart + Slow Movers + Top Customers (20+ SKUs listed)
- ✅ Laporan Akuntansi Laba Rugi: full income statement with Pendapatan → HPP → Laba → Beban → Pajak → Laba Neto structure
- ✅ Laporan Akuntansi Neraca: aset/liabilitas/ekuitas **BALANCES** (Rp 45.400 = Rp 45.400) with visible "Persamaan akuntansi terverifikasi ✓"

---

## Positive DB verifications (rerun with proper JWT)

- ✅ **Toko Jaya Makmur GL:** total_debit = total_credit = Rp 269.600 across 3 journal entries — perfectly balanced
- ✅ **Garindo GL:** total_debit = total_credit = Rp 309.046.131 across 292 journal entries — perfectly balanced
- ✅ **0 JE line-sum mismatches** across all tenants
- ✅ **0 stock_movements** with impossible qty math
- ✅ Own-tenant reads work correctly: 10 customers, 20 stocks, 19 kasir_txn matches baseline
- ✅ Multi-tenant isolation VERIFIED across 20 tables (proper JWT test)
- ✅ Discount computation formula matches FE (`base * pct / 100`, rounded, capped)
- ✅ RPC surface consistent with Session 1 (233 SECDEF callable, 207 vosi_rpc_owner + 52 postgres)
- ✅ Cron `auto_resume_expired_locks` running clean every 60s
- ✅ Async job queue clean (2 SUCCEEDED, 0 failed)

---

## Cumulative status (all 5 sessions)

| Severity | Session 1-4 open | Session 5 net | Total open |
|---|---|---|---|
| P0 | 0 | 0 | **0** |
| P1 | 6 (with drafts) | +1 (F5-05 deferred) −3 (F5-02/03/09 FIXED) | 4 open + 3 fixed |
| P2 | 12 | +3 (F5-06/07/10 deferred) | 15 |
| P3 | 6 | +1 (F5-01 no add-customer button in PelangganScreen) | 7 |

### Open P1 detail

| # | Description | Session | Draft ready? | Status |
|---|---|---|---|---|
| P1-01 | REVOKE debug SECDEF | S2 | ✅ SQL | Awaiting founder apply |
| P1-02 | Storage bucket file_size_limit | S2 | ✅ SQL | Awaiting founder apply |
| P1-05 | WIB timezone (36 sites) | S2/S4 | ✅ Plan | Awaiting founder priority |
| P1-06 | 20 tables no FK on tenant_id | S2/S4 | ✅ SQL | Awaiting founder apply (phase 1+2) |
| P1-07 | DOMPurify CVE via jspdf | S3/S4 | ✅ Plan | Awaiting founder priority |
| **F5-05** | uq_customers_wa cross-tenant | **S5** | ⏳ Coordinated fix plan | Backend refactor + migration coord needed |

### Session 5 shipped fixes (deployed autonomously)

- ~~F5-02~~ KasirScreen [object Object] URL — FIXED commit 39e017d
- ~~F5-03/07~~ 11-file stringify sweep — FIXED commit 3347833
- ~~F5-09~~ App.tsx IMPERSONATE_FAILED (part of F5-07 sweep)

---

## Cleanup

Test data tagged with `note LIKE 'QA-WEEK-%'`. Cleanup script:

```bash
DB_CONN=$(python3 -c "
with open('backend-go/.env') as f:
    for line in f:
        if line.startswith('SUPABASE_DB_CONNECTION='):
            print(line.rstrip('\n').split('=', 1)[1]); break")
psql "$DB_CONN" -f docs/qa-week/pending-fixes/cleanup-qa-week-testdata.sql
```

**Note:** Session 5 write-attempts were mostly ROLLED BACK via `RAISE EXCEPTION` at the end of each DO block (SQL smoke pattern). The one attempted UI write (create customer via wizard) FAILED with 409 (F5-05 bug) → nothing to clean. Cleanup script is idempotent — safe to run.

---

## For founder review

**Immediate applyable (batch 1, low risk, ~5 min):**
- P1-01 REVOKE debug SECDEF
- P1-02 storage bucket file_size_limit
- Cleanup script (no-op if nothing to clean)

**Needs quick decision (batch 2):**
- F5-05 + F5-06 coordinated fix — schema migration + backend refactor + Cloud Build deploy. Total ~2-4h founder-time.
- P1-05 WIB timezone plan — 36 sites, prioritize which first (recommend RecordPaymentModal since it's financial)

**Deferred (batch 3, product decisions):**
- F5-10 error class for cross-tenant nav (UX decision)
- P1-07 jspdf major upgrade (breaking bump, needs QA time)
- P1-06 phase 2 FK add (requires phase 1 orphan cleanup first)

**Green-light next:**
- Continue Playwright/chrome-devtools coverage into T4-T7 modules (Approval PIN, Warehouse Transfer create/detail, Rekonsiliasi wizard end-to-end, Sales inbox interactive)
- Backend Go test bootstrap (P1-04, deferred as historical baseline)

---

## Honest coverage assessment

- **Total plan:** 7 days, ~50 module clusters, 500-700 scenario cells per matrix
- **Executed to date:** ~15h across 5 sessions
- **Effective coverage:** ~55-65% of plan (higher than earlier estimate because Session 5 unlocked live UI testing)
- **Still uncovered:** Interactive Rekonsiliasi wizard end-to-end, Approval PIN flow, Warehouse Transfer 2-step full, PDF layout visual audit, Sales inbox WA action interactions, file upload edge cases, Sentry synthetic error verify E2E
- **Onboarding readiness:** Solid on DB/isolation/data integrity. UI-side has real bugs (F5-05 flag customer creation), but no P0 or blockers found. Recommend addressing F5-05 batch + P1-01/02 before onboarding new tenant #4.
