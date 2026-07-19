# QA Session 4 — Findings + Draft Fixes + Playwright Scaffolding

**Date:** 2026-07-19 (autonomous continuation, ~1.5h)
**Mode:** Findings-first + review-ready draft artifacts. No prod-mutating changes.

**Related:**
- Session 1-3 findings: `docs/qa-week/2026-07-19-session{1,2,3}-findings.md`
- Design: `docs/superpowers/specs/2026-07-19-qa-week-comprehensive-design.md`
- All pending fixes: `docs/qa-week/pending-fixes/`
- Playwright specs: `tests/e2e/tests/qa-week/`

---

## New artifacts delivered

### Draft fix SQLs (review-ready)
1. `pending-fixes/pending-fix-p1-01-revoke-debug-secdef.sql` — REVOKE debug SECDEF from authenticated (from Session 2)
2. `pending-fixes/pending-fix-p1-02-storage-bucket-limits.sql` — bucket size + MIME limits (from Session 2)
3. `pending-fixes/pending-fix-p1-06-tenant-fk-constraints.sql` — **NEW** — add FK on 20 tables + orphan cleanup
4. `pending-fixes/pending-fix-p1-05-wib-timezone-plan.md` — **NEW** — 36-site fix plan with prioritized clusters
5. `pending-fixes/pending-fix-p1-07-jspdf-upgrade.md` — **NEW** — DOMPurify CVE upgrade plan + rollout
6. `pending-fixes/pending-memory-correction.md` — memory drift correction queued (from Session 2)

### Playwright QA-week E2E scaffolding
Created `tests/e2e/tests/qa-week/`:
- `README.md` — how to run + write-gate rules
- `t0-auth-readonly.spec.ts` — auth + session + role gates
- `t0-multi-tenant-isolation-readonly.spec.ts` — UI-path isolation attempts
- `t1-master-data-readonly.spec.ts` — Produk / Pelanggan / Stok / Kas & Bank
- `t2-pos-golden-path-write.spec.ts` — Kasir POS write path (gated by `PLAYWRIGHT_ALLOW_WRITES=1`)
- `t2-pembelian-po-golden-path-write.spec.ts` — PO → Receive → Tagihan → Bayar (write, gated)
- `t2-warehouse-transfer-readonly.spec.ts` — WT list + detail
- `t3-akuntansi-readonly.spec.ts` — GL + Neraca balance assertion + P&L + Laba Rugi
- `t3-rekonsiliasi-readonly.spec.ts` — wizard entry states
- `t7-admin-readonly.spec.ts` — admin dashboard + tenants + revenue + audit + impersonation banner

Total: 10 spec files skeleton + README. Uses existing `tests/e2e/fixtures/auth.ts` — no infra changes needed. Credentials already in `.env` (`PLAYWRIGHT_TOKO_*`, `PLAYWRIGHT_ADMIN_*`).

**Status:** skeletons only — each `test('...')` has `TODO(qa-week)` marker with concrete next step. Founder to expand + run.

---

## Session 4 verification adjustments

### Session 2 P1-06 refined

Session 2 report said "8-10 tables missing FK on tenant_id". Session 4 corrected via faster `pg_catalog` query (info_schema was hanging):

- **Actual: 20 tables** missing FK
- Financial tables (accounting_config, accounting_periods, cash_accounts, chart_of_accounts, opening_ap_lines, opening_ar_lines) — **0 orphan rows** each
- `tenant_settings` — **3 orphan rows** (tenant_ids `ca45dc8c...`, `ee6d5fd9...`, `1fc9f3f5...` — likely test tenants deleted without cascade)
- Other tables: 0 orphans

Draft P1-06 SQL includes 2-phase apply: (Phase 1) orphan cleanup + backup, (Phase 2) FK add on all 20 tables with `ON DELETE CASCADE`.

---

## New Session 4 findings

### P2-14 — Main bundle 3.13 MB / 813 KB gzipped (over Vite warn threshold)

**Category:** Performance / N/A infra
**Module:** Cross-cutting FE build

**Details:** `npm run build` produced:
- `index-DC6HOeH1.js` — 3,132 KB / gzip 813 KB — **exceeds Vite's 500 KB warn**
- `html2canvas.esm` — 202 KB (used by PDF flow)
- `purify.es` — 22 KB (DOMPurify via jspdf)
- `index.es` — 160 KB (React runtime)

**Impact:** First-load on 3G/slow-mobile Indonesian tenants painful. TTI (time-to-interactive) high.

**Recommendation:**
1. Dynamic import PDF generators — 8 files under `src/lib/pdf/` + `src/lib/sales/pdf/` — split into async chunk loaded only when user triggers PDF export.
2. Lazy-load admin routes — admin bundle (~20+ components) separate chunk since only ~5% of users are admin.
3. Consider `manualChunks` in `vite.config.ts` for vendor splitting.

**Priority:** P2 — no bug, but MSME UX impact. Ship after P1s.

---

## Cumulative status (4 sessions)

| Severity | Session 1 | Session 2 net | Session 3 net | Session 4 net | Open |
|---|---|---|---|---|---|
| P0 | 0 | 0 | 0 | 0 | **0** |
| P1 | 4 | −1 corrected, +2 new | +1 new | +0 (all draft) | **6** |
| P2 | 8 | +3 | 0 | +1 (bundle size) | **12** |
| P3 | 6 | 0 | 0 | 0 | **6** |

### P1 open detail (with draft status)
| # | Description | Draft ready? | Session |
|---|---|---|---|
| P1-01 | REVOKE debug SECDEF | ✅ SQL | S2 |
| P1-02 | Storage bucket limits | ✅ SQL | S2 |
| ~~P1-03~~ | ~~Migration 331 idempotency~~ | ✅ CORRECTED (S2) — false positive | S1 |
| ~~P1-04~~ | ~~Backend Go tests failing~~ | ✅ RECATEGORIZED (S2) — historical baseline | S1 |
| P1-05 | WIB timezone (36 FE sites) | ✅ Plan | S2/S4 |
| P1-06 | 20 tables no FK on tenant_id | ✅ SQL | S2/S4 |
| P1-07 | DOMPurify CVE via jspdf | ✅ Upgrade plan | S3/S4 |

**All 6 open P1s have review-ready drafts.** Zero autonomous prod changes applied.

---

## Ready for founder review

**Batch 1 (small SQL, low blast radius, high confidence):**
- P1-01 REVOKE debug SECDEF — 2 REVOKE statements, no data touched, fully reversible
- P1-02 Storage bucket limits — 5 UPDATE statements, reversible

**Batch 2 (medium, needs FK planning):**
- P1-06 FK constraints — 20 tables + 3-row orphan cleanup. 2-phase apply for review checkpoint.

**Batch 3 (large, needs planning):**
- P1-05 WIB timezone — 36 file edits, needs regression tests, high value (financial)
- P1-07 jspdf upgrade — breaking bump, needs PDF regression testing on 8+ generators

**Not urgent (P2/P3):**
- Bundle size split (S4)
- IDR formatting consolidation (S2)
- Realtime subscription filter add (S2)
- Migration idempotency systemic cleanup (S2)
- Various P3 cleanup

**Testing infrastructure:**
- Playwright QA-week specs scaffolded — ready for founder to expand + run
- Credentials already in `.env` — no setup needed
- Read-only smokes safe to run against prod; write tests gated

---

## For founder discussion when returning

1. Apply P1-01 + P1-02 as batch 1 (recommended — small, high-confidence, immediate win)?
2. Apply P1-06 phase 1 (orphan cleanup) + verify before phase 2 (FK add)?
3. Prioritize P1-05 vs P1-07 — WIB timezone (real MSME books impact) vs DOMPurify CVE (low prod exploit) — which first?
4. Green-light Playwright QA-week execution (read-only smokes safe; write tests need `PLAYWRIGHT_ALLOW_WRITES=1`)?
5. Bundle size P2-14 — schedule for post-P1 or defer to Phase 3?
6. Memory correction for `guard_expiry_write_broken_predicate` — apply?
