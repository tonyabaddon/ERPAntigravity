# QA Week — Follow-up Plan (Post-Session 7)

**Date:** 2026-07-20
**Author:** Autonomous QA session (Sessions 1-7 synthesis)
**Approver:** founder
**Status:** APPROVED plan — this doc is canonical fix roadmap

**Purpose:** Comprehensive post-QA phase plan covering ALL remaining findings from Sessions 1-7 with confirmed recommendations after fact-check + advisor re-review.

**Related:**
- Sessions 1-7 findings: `docs/qa-week/2026-07-19-session{1-7}-findings.md`
- Design origin: `docs/superpowers/specs/2026-07-19-qa-week-comprehensive-design.md`
- Pending fixes drafted: `docs/qa-week/pending-fixes/`
- Customer ID memo: `docs/superpowers/specs/2026-07-19-tenant-aware-customer-id-design.md`

---

## Cumulative status entering Phase 0

**7 P1 bugs FIXED in prod (Sessions 5-7):**
- F5-02 KasirScreen [object Object] URL
- F5-03/F5-07/F5-09 error stringify 11-file sweep (extractErrorMessage)
- F5-13 WT sender UUID display
- P1-01 REVOKE debug SECDEF from authenticated
- P1-02 storage bucket file_size_limit + MIME allowlist
- P1-06 20 FK constraints on tenant_id + orphan cleanup
- P1-05 WIB timezone 36 sites → wibDateString

**Open findings:**
- P1 deferred: 2 (F5-05, P1-07) — awaiting founder Option/OK
- P2: 15
- P3: 7
- Test coverage gaps: ~30% of 500-700 scenario matrix

**Onboarding readiness: CONDITIONALLY GREEN.** Zero P0/P1 blocking. Foundation verified (multi-tenant isolation, financial integrity, RLS, business rules, audit).

---

## Phase 0 — Founder decisions (30 min founder time, blocker for Phase 1)

Two decisions blocking Phase 1 execution:

### D0.1 — F5-05 uq_customers_wa fix approach

**Pick Option A/B/C:**
- **A (Recommended):** `gen_random_uuid()` for new customers, keep Garindo `GJP-CUST-####` legacy IDs untouched. Simplest. Zero FE breakage per impact grep. No schema additions.
- **B:** Per-tenant sequence table with prefix (`<TENANT_PREFIX>-CUST-####`). Human-readable but adds `tenant_customer_sequences` table + `provision_tenant` bootstrap logic.
- **C:** Composite PK `(tenant_id, wa_number)` (rejected — too much FK refactor across kasir_transactions, orders, sales_orders, leads).

**Confirmed rationale for A:** Impact grep proves zero FE code relies on ID format. UUIDv4 acceptable at MSME scale (10K tenants × 100 customers = 1M rows; B-tree locality concerns start at 100M+, defer). `display_number` per-tenant is YAGNI — MSME users reference customers by name/phone, not ID.

### D0.2 — P1-07 DOMPurify CVE via jspdf

**Fact-check finding:** npm `overrides` won't work. jspdf 2.5.2 uses dompurify **v2.5.9** API; forcing v3.4.12 breaks jspdf (v2 → v3 is API-breaking on dompurify side). Only real path is jspdf 2.x → 4.x major bump.

**Pick:**
- **Path A (best practice):** `npm audit fix --force` = jspdf@4.2.1. Regression test 12 PDF generators (~3h manual QA). Ship.
- **Path B (pragmatic):** Accept dompurify v2 CVE as documented risk. Low exploit surface (PDF viewers don't execute JS from sanitized HTML). Reassess when Anda ada bandwidth for regression.

**Recommendation:** Path A if you have 3h QA bandwidth this week; Path B is acceptable defer if not.

---

## Phase 1 — Coordinated architectural fixes (4-6h execution)

Requires Phase 0 decisions.

### 1A — F5-05 execute chosen option (per D0.1)

**If Option A:**
1. Backend refactor `backend-go/internal/db/customers.go` `GetOrCreateCustomer(tenantID uuid, waNumber string)` — take explicit tenant, use `gen_random_uuid()` for new INSERT, `ON CONFLICT (tenant_id, wa_number) DO UPDATE`.
2. Thread `tenantID` through all callers (grep required).
3. Add backend test: (a) new customer created with UUID + tenant_id, (b) same tenant same phone returns existing, (c) different tenant same phone creates new.
4. Migration: `DROP CONSTRAINT uq_customers_wa; ADD CONSTRAINT uq_customers_wa_tenant UNIQUE (tenant_id, wa_number);`
5. Ship & verify Stage 1-3 per CLAUDE.md.

**Time:** 2-3h + 30 min ship & verify.

### 1B — P1-07 execute (if D0.2 = Path A)

1. `npm audit fix --force` → jspdf@4.2.1 in package.json.
2. Run `npm install` + `npm run lint`.
3. Manual visual regression of 12 PDFs (invoice DP, invoice lunas, invoice pelunasan, surat jalan, catatan pembatalan, PO, BNL, warehouse transfer, tanda terima, akuntansi pdfExport, sales invoice, saldo awal). Save side-by-side comparison.
4. Ship via git push + Cloud Build.
5. Stage 3: chrome-devtools verify against Toko Jaya.

**Time:** 3h.

### 1C — P2-03 audit_log + pembayaran composite PK

**Advisor gate + memo required per CLAUDE.md irreversible-decision rule.**

Migration:
```sql
BEGIN;
ALTER TABLE audit_log DROP CONSTRAINT audit_log_pkey;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (tenant_id, id);
ALTER TABLE pembayaran DROP CONSTRAINT pembayaran_pkey;
ALTER TABLE pembayaran ADD CONSTRAINT pembayaran_pkey PRIMARY KEY (tenant_id, id);
COMMIT;
```

**Data volume:** audit_log 292 rows, pembayaran 0 rows → migration in seconds. At 10M+ future = hours-of-lock painful.

**Follow-up (not in scope this phase):** at 10M+ rows, add partitioning by `(tenant_id, created_at)` monthly range. Reference in a separate spec.

**Time:** 30 min including advisor call + Stage 1-3.

---

## Phase 2 — P2 batch fixes (2-3 days, grouped by concern)

### 2A — WT UX polish (~2h)

- F5-12: client-side block WT create when FROM=TO warehouse (visual disable + toast on submit attempt)
- F5-14: WT `DIKIRIM KEPADA` empty dropdown — add helper text "Belum ada penerima; tambah user di User Management" when empty
- F5-01: PelangganScreen add "+ Tambah Pelanggan" button — reuse `NewCustomerInlineForm` component in a modal

### 2B — Routing & error handling (~4h)

- F5-11 routing race: refactor `useURLRoute` to use `?screen=` as sole source of truth; strip path segment matcher. Path `/t/<slug>/...` retained for tenant context only.
- F5-10 wrong error class: branch on `_is_platform_admin` in App.tsx `impersonateGate` failure path; render `AccessDenied` component (not `TenantBootstrapError`) for tenant users. Emit Sentry tag `error_class: impersonate|access_denied|tenant_not_found`.

### 2C — Perf indexes (~2h, advisor gate for prod migration)

P2-01 missing indexes on hot query paths:
- `approval_requests`: EXPLAIN ANALYZE common WHERE patterns → add composite index
- `purchase_order_items`: index on `(po_id)`
- `stock_lots`: index on `(sku, qty_remaining) WHERE qty_remaining > 0`
- `purchase_orders`: index on `(supplier_id, status)`

Verify via `pg_stat_user_indexes` before/after.

### 2D — RLS cleanup (~1h)

P2-02 migrate 6 residual policies:
- 3 on `warehouse_transfers` (INSERT/UPDATE/DELETE)
- 2 on `warehouse_transfer_items` (INSERT/UPDATE)

Change `_guard_expiry_write() IS NULL` (broken predicate, always false) → `_check_expiry_ok()` (working boolean predicate).

### 2E — Direct FE writes selective refactor (~4-6h)

**Confirmed pragmatic scope (financial only):**
- `pembayaranService.ts` → SECDEF RPC `record_pembayaran`
- `tukarFakturService.ts` → SECDEF RPC for TF operations
- `EditOrderModal.tsx` audit_log insert → SECDEF RPC or trigger

**Explicitly NOT refactored (RLS covers, single-user scope):**
- `supabaseClient.ts` direct writes to customers, stocks, kasir_transactions
- `customerWrappers.ts` insertNewCustomer
- `pembelianService.ts` supplier/PO delete

### 2F — Formatting consolidation (~2h)

S2-11 + P2-08: sweep 84 hardcoded `Rp {...}` sites + 4+ formatIDR implementations → converge to:
- `formatIDR()` for admin dashboard (space, "Rp 1.234.567")
- `formatRp()` for POS/sales (Intl currency)
- `formatRpDelta()` for signed values

Deprecate inline `.toLocaleString('id-ID')` + local `formatIDR` in OwnerDecisionInbox.

### 2G — Bundle size (~3h)

S2-14 main bundle 3.13 MB → target < 1.5 MB:
- Dynamic import PDF flow (jspdf, jspdf-autotable, html2canvas): 250 KB gzipped drop
- Lazy-load admin routes: ~30 KB drop
- `manualChunks` in vite.config.ts for vendor splitting

Measure before/after via `npm run build`.

### 2H — Realtime filter (~2h)

S2-13 add `filter: 'tenant_id=eq.<currentTenantId>'` to 13 subscriptions. Not a leak (Supabase realtime RLS-enforced), but defense-in-depth + bandwidth savings.

### 2I — Migration hygiene: schema baseline (~1h) [STRUCTURAL for dev velocity]

**Upgraded per advisor.** S2-12 non-idempotent 48/435 migrations = fresh test DB unbootstrappable.

Solution: create schema baseline snapshot.
1. `pg_dump --schema-only --no-owner --no-privileges "$DB_CONN" > supabase/migrations/20261115000500_baseline.sql`
2. Update `scripts/apply-pending-migrations.sh` to check schema_migrations table; if empty (fresh DB), apply baseline first, then migrations ≥ 501.
3. Existing 500 historical migrations retained in repo for git-history reference; no longer applied on fresh setup.
4. Rails/Django/Prisma standard pattern.

### 2J — FE state coverage (~2 days)

P2-06 systematic UI review per screen. Add missing:
- Loading state (spinner during fetch)
- Empty state (visible message when 0 rows)
- Error state (toast/inline on RPC failure)

Priority order: PenjualanScreen, LaporanScreen, StockManagerScreen (grep signals shortest), then rest.

### 2K — Idempotency verification (~2h)

S6-05 `t_rpc_idempotency` 0 rows means clients aren't passing idempotency keys. Verify:
1. Which SECDEF RPCs accept `p_idempotency_key`? (grep signatures)
2. Which FE callers should pass? (record_pembayaran, record_kasir_sale, commit_opname primary)
3. Add missing key generation client-side.

---

## Phase 3 — P3 cleanup (1 day)

- **P3-01** drop 15 unused indexes (verify 1-week stability of pg_stat_user_indexes zero-scan first)
- **P3-02** wrap 133 `console.error` calls with `Sentry.captureException` — write helper, sweep
- **P3-03** add single-line comment migration explaining whatsmeow tables have no policies (daemon uses service_role)
- **P3-04** cleanup 25 wa_recipients + 20 conversations test fixture (per memory `wa_test_data_noise`)
- **P3-05 auto-audit approach:** run
  ```sql
  SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  JOIN pg_authid r ON r.oid=p.proowner
  WHERE p.prosecdef AND n.nspname='public' AND r.rolname='postgres'
    AND p.proname NOT ILIKE '%hook%' AND p.proname NOT ILIKE '%_debug%'
    AND pg_get_functiondef(p.oid) ILIKE '%INSERT%INTO%public.%'
  ORDER BY p.proname;
  ```
  → candidates list. `ALTER FUNCTION ... OWNER TO vosi_rpc_owner` per candidate.
- **P3-06** test tenants use hardcoded UUIDs (`11111111...`, `22222222...`) — consider randomizing if worry about collision with real tenant onboarding. (LOW priority — probability collision ~zero for uuid space)
- **P2-07** 100 `any` types — prioritize `src/lib/**` — sweep as time allows

---

## Phase 4 — Backend Go test bootstrap (2-3h) [REVISED UP]

**Not just skip.** Create ONE helper in `backend-go/internal/db/testhelpers.go`:

```go
// newTenantForTest provisions a fresh test tenant + returns its id.
// Tests requiring tenant_id FKs call this before seeding data.
func newTenantForTest(t testing.TB, c *Client) uuid.UUID {
    // INSERT INTO tenants ... RETURNING id
    // Register cleanup with t.Cleanup(...)
}
```

Refactor 30+ failing tests in `internal/db/*_test.go` to call helper before seeding. Verify `go test ./internal/db` green.

**Fallback if founder truly deprioritizes:** mark all failing tests as `t.Skip("TODO(tenant-id-seed): fixtures need refactor")`. Unblocks CI in 30 min but leaves regression coverage gap.

---

## Phase 5 — Remaining test coverage (2-3 days)

Interactive gaps not yet executed (from original 7-day plan):

### 5A — High-value MSME flows
1. **Rekonsiliasi wizard full flow** — create period → upload bank PDF → auto-match → manual review → tutup buku
2. **Approval PIN interactive** — generate approval request → OwnerPinPad flow → verify approve/reject + audit trail
3. **Stock Opname full session** — create session → assign counter/witness → count → variance detection → PIN approve → commit
4. **PDF layout visual verify** — 12 PDFs (invoice DP/lunas/pelunasan, surat jalan, catatan pembatalan, PO, BNL, warehouse transfer, tanda terima, akuntansi export, sales invoice, saldo awal) — critical after P1-07 upgrade

### 5B — Post-fix verification
5. **File upload edges** (post P1-02) — oversized file rejected 413, wrong MIME rejected, tenant path enforced
6. **WT create submit** — verify F5-13 fix visual post-deploy (name shown, not UUID)
7. **Sentry synthetic error E2E** — trigger error client + server, verify capture in caleo-frontend + caleo-backend Sentry projects

### 5C — Multi-tenant + admin
8. **Impersonation grant + audit lifecycle** — admin grant → tenant Support Access accept → banner render → audit_log entries
9. **Realtime tenant filter** — live subscription tests confirming Supabase realtime RLS enforcement

### 5D — Scenario matrix systematic
10. **~300 remaining scenarios** from 500-700 matrix — input validation, character encoding, state transitions, concurrency, boundary/numeric per module (target 90% pass)

### 5E — Skipped (per YAGNI at MSME scale)
- Cross-browser Safari/Firefox — Indonesian MSME dominant Chrome
- Mobile responsive 375px systematic — desktop-first tenant UI
- Accessibility deep Lighthouse — WCAG AA target basic keyboard/ARIA verified
- Load/perf concurrent users — 3-tenant scale doesn't hit ceilings

---

## Revised recommendations summary (post-advisor review)

| # | Item | Category | Recommendation | Confidence |
|---|---|---|---|---|
| 1 | F5-05 Customer ID | Structural | Option A (UUID) — skip display_number YAGNI | HIGH |
| 2 | P1-07 jspdf CVE | Hygiene | Bump-and-regress OR accept v2 CVE (both valid) | HIGH |
| 3 | P2-03 composite PK | Structural | Do now + future partition note | HIGH |
| 4 | P2-04 direct FE writes | Hygiene | Selective (financial only) — advisor caught over-eng | HIGH |
| 5 | F5-11 routing race | Hygiene | Keep `?screen=` canonical (advisor caught flip w/o new fact) | HIGH |
| 6 | F5-10 error class | Hygiene | Branch on admin + Sentry tags | HIGH |
| 7 | S2-12 migrations | Structural (dev velocity) | Schema baseline snapshot (Rails/Django pattern) | HIGH |
| 8 | P3-05 SECDEF drift | Hygiene | Auto-audit query + selective migrate | HIGH |
| 9 | Go test bootstrap | Hygiene | Helper approach ~2-3h (skip if truly deprioritized) | MEDIUM |

**Structural (must fix): 3** — F5-05, P2-03, S2-12
**Hygiene (worth-doing, deferable): 6** — rest
**YAGNI (skip): 0**

---

## Success criteria (end of Phase 5)

- All P1 (open + fixed): 0 open, 100% shipped OR explicitly accepted with documented risk
- All P2 structural: shipped
- P2 hygiene: shipped OR scoped as backlog with owner
- P3: shipped OR scoped as backlog
- Test coverage: all Phase 5 items executed, findings documented
- Multi-tenant isolation: verified clean via SQL matrix (repeat Session 6 test)
- Business rules: all 6 verified enforced
- Financial integrity: Neraca balances across all tenants (spot check)
- Get_advisors: clean sweep
- Migration hygiene: fresh DB bootstrap via schema baseline works

## Deliverables

- Updated `progress.md` per phase completion
- `docs/qa-week/phase-{0-5}-report.md` per phase (findings, fixes, blockers)
- `docs/superpowers/specs/2026-07-XX-*-decision.md` for each irreversible decision (F5-05, P2-03)
- `supabase/migrations/*.sql` numbered migrations for all DB fixes
- All fixes committed with `[qa-week-followup]` tag for later audit

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Phase 1 jspdf bump breaks a PDF layout at deploy | Rollback via `npm install jspdf@2.5.2 jspdf-autotable@3.8.4`; test locally first via `npm run dev` |
| Phase 1 F5-05 backend refactor breaks WA bot for Garindo | Ship & verify Stage 3 chrome-devtools smoke on Garindo before Toko Jaya |
| Phase 2 direct-write refactor changes RPC contracts | Add regression tests before refactor; verify FE call sites still work |
| Phase 5 300-scenario execution overruns time | Prioritize by risk (financial > inventory > UI); document skipped scenarios in final report |
| Advisor gates slow execution | Batch advisor calls per phase (not per fix); expected ~2-3 advisor calls total |

---

## Estimated total time

- Phase 0: 30 min founder time (decisions)
- Phase 1: 6-9h execution (F5-05 + P1-07 + P2-03)
- Phase 2: 2-3 days
- Phase 3: 1 day
- Phase 4: 2-3h
- Phase 5: 2-3 days

**Total: ~5-7 working days after Phase 0 decisions.**
