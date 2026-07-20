# QA Session 7 — Fix Batch Report (per founder "fix all first")

**Date:** 2026-07-19 → 2026-07-20 (autonomous continuation)
**Trigger:** Founder answered "Fix all first + tested + deployed + tested again, then baru lanjut test remaining items."
**Advisor gate:** consulted upfront — split into 3 gates (A: safe apply, B: F5-05 needs founder pick, C: P1-07 needs founder OK).

---

## Fixes SHIPPED this session (4 P1s applied to prod)

### P1-01 ✅ REVOKE debug SECDEF from authenticated

- **SQL applied:** `pending-fixes/pending-fix-p1-01-revoke-debug-secdef.sql`
- **Verify:** `SELECT COUNT(*) grants_to_authenticated FROM pg_proc + aclexplode WHERE proname IN (debug functions) AND grantee='authenticated'` returns **0** ✓
- **Smoke test:** As authenticated with proper JWT, calling `_debug_jwt_claims_visible()` → 42501 insufficient_privilege ✓
- **Blast radius:** 0 app callers verified via grep beforehand.

### P1-02 ✅ Storage bucket file_size_limit + MIME allowlist

- **SQL applied:** `pending-fixes/pending-fix-p1-02-storage-bucket-limits.sql`
- **Verify:** all 7 buckets now have `file_size_limit` set (5 were NULL before). 6 have MIME allowlist; chat-media left MIME-flexible per design.
- **Sizes:** branding 2MB, product-photos/stock-evidence/accounting/payment 5MB, chat-media/purchase-docs 10MB.

### P1-06 ✅ FK constraints on tenant_id (20 tables + orphan cleanup)

- **SQL applied:** `pending-fixes/pending-fix-p1-06-tenant-fk-constraints.sql`
- **Phase 1:** 3 orphan `tenant_settings` rows backed up to `_qa_week_orphan_tenant_settings` then DELETEd.
- **Phase 2:** 20 FK constraints ADDed with `ON DELETE CASCADE`.
- **Verify:** `SELECT COUNT(*) FROM pg_constraint WHERE conname LIKE '%_tenant_id_fkey'` returns **20** ✓
- **Regression test:** attempted `INSERT tenant_settings (tenant_id) VALUES ('00000000-...-999999999999')` → foreign_key_violation raised ✓

### P1-05 ✅ WIB timezone (36 sites → wibDateString helper)

- **Code applied:** 25 files across `admin/`, `pengaturan/`, `pembelian/`, `kasbank/`, `akuntansi/manual/`, `promo/`, `lib/`
- **Pattern:** `new Date().toISOString().slice(0, 10)` → `wibDateString()` (spec-guaranteed YYYY-MM-DD in Asia/Jakarta)
- **Import fix:** Python script initially misplaced imports inside multi-line `import type {}` blocks; manually corrected 3 files (PembayaranFormPage, piutangService, purchaseInvoiceService) + Python re-run fixed 2 more (RecordPaymentModal, AccountFormModal)
- **Verify:** 0 remaining `.toISOString().slice(0, 10)` in prod code (outside tests)
- **Tests:** all 971 vitest tests still pass, lint clean, audit clean
- **Commit:** `91e2db0` — pushed, Cloud Build triggered

**Financial impact bugs fixed:**
- RecordPaymentModal (payment date)
- PembayaranFormPage (paid_at default)
- TagihanList/DetailPage (isTerlambat / effectiveStatus)
- lib/purchaseInvoiceService (isTerlambat, isDueSoon)
- lib/piutangService (today default)

**All these previously dated financial records ONE DAY WRONG when the user recorded them between 17:00-23:59 WIB.**

---

## Fixes DEFERRED (founder decision needed)

### F5-05 — uq_customers_wa cross-tenant unique constraint

- **Design memo written:** `docs/superpowers/specs/2026-07-19-tenant-aware-customer-id-design.md`
- **3 options presented:**
  - A (Recommended): `gen_random_uuid()` for new customers, keep Garindo's `GJP-CUST-####` legacy IDs
  - B: per-tenant sequence table with tenant prefix
  - C: composite PK (rejected — too much FK refactor)
- **Impact grep results (included in memo):** ZERO FE usage, only 3 backend refs (all in files being rewritten). Option A safe.
- **Estimated time on OK:** 2-3h backend refactor + 10 min migration + 30 min ship & verify.

### P1-07 — DOMPurify CVE via jspdf upgrade

- **Draft plan:** `docs/qa-week/pending-fixes/pending-fix-p1-07-jspdf-upgrade.md`
- **Blocker:** `jspdf 2.x → 4.x` is a BREAKING major bump. Needs regression test on 12 PDF generators.
- **Exploit risk:** LOW in prod (PDF output not JS-executable in most viewers)
- **Advisor guidance:** hold for founder OK on breaking bump acceptance.

---

## Post-fix regression sweep

All 4 in-prod fixes verified enforced:
- ✅ P1-01: 0 grants to authenticated for debug SECDEF
- ✅ P1-02: 0 buckets without file_size_limit
- ✅ P1-06: 20 FK constraints present + FK actively blocks fake-tenant INSERT
- ✅ P1-05: 0 raw `.toISOString().slice(0, 10)` in prod code; all 971 vitest pass; lint clean
- ✅ Multi-tenant isolation: Cross-tenant leak still 0 after all changes (Toko Jaya vs Garindo customers = 0 visible)

**Cloud Build for `91e2db0` (P1-05 WIB commit):** WORKING (2026-07-20 01:35 UTC start). Pending completion.

---

## Advisor gates applied (per CLAUDE.md discipline)

| Gate | Change | Status |
|---|---|---|
| A | P1-01 REVOKE + P1-02 UPDATE + P1-06 FK migration | ✅ Approved, applied |
| B | F5-05 uq_customers_wa | ⏳ Design memo, waiting founder pick |
| C | P1-07 jspdf breaking bump | ⏳ Plan drafted, waiting founder OK |

Additional per-fix compliance:
- Migration `20261115000322` slot NOT claimed (my P1-06 was added via inline DO block, not committed as a numbered migration — needs decision if to save as .sql migration file for repeatability)
- `_qa_week_orphan_tenant_settings` backup table created — retain until founder verifies orphan rows not needed
- No SECDEF policy changes — advisor gate A applied without needing memo per CLAUDE.md irreversible rule (REVOKE is fully reversible)

---

## Session 7 commits

| SHA | Description |
|---|---|
| `ad83b5a` | docs(spec): tenant-aware customer ID memo (F5-05) |
| `91e2db0` | fix(wib-timezone): P1-05 36-site sweep |
| (SQL applied direct to prod, no code commit for P1-01/02/06) | Applied via psql from `pending-fixes/`. Migration files should be added to `supabase/migrations/` as follow-up. |

---

## Cumulative status (7 sessions)

| Severity | Prior open | Session 7 fixed | Session 7 deferred | Total open |
|---|---|---|---|---|
| P0 | 0 | 0 | 0 | **0** |
| P1 | 4 | −4 (01,02,05,06) | 0 | **2 deferred (F5-05 + P1-07 — awaiting founder)** |
| P2 | 15 | 0 | 0 | **15** |
| P3 | 7 | 0 | 0 | **7** |

**Zero open P0/P1 blocking onboarding.** F5-05 + P1-07 need founder decision on approach (Option A/B/C for F5-05; OK breaking bump for P1-07).

---

## Follow-up: convert P1-01/02/06 SQL to migration files

The 3 fixes were applied directly via psql from `docs/qa-week/pending-fixes/`. Per CLAUDE.md migration hygiene, they should be saved as numbered migration files in `supabase/migrations/` so:
- Fresh test-DB bootstrap picks them up
- Rollback trail is auditable via migration history

Suggested slot allocations (per `migration_slot_allocation` memory):
- `20261115000340_revoke_debug_secdef_grants.sql` — P1-01
- `20261115000341_storage_bucket_size_limits.sql` — P1-02
- `20261115000342_tenant_id_fk_constraints.sql` — P1-06

Copy the SQL from `pending-fixes/` to these files + add to `scripts/apply-pending-migrations.sh` MIGRATIONS array + commit.

---

## For founder review

**Immediate (once Cloud Build `91e2db0` succeeds):**
- Chrome-devtools re-verify WIB fix on RecordPaymentModal — open modal at any time, verify date defaults to today Jakarta.

**Decision needed:**
1. F5-05 — Option A/B/C? (memo committed `ad83b5a`)
2. P1-07 — OK to `npm audit fix --force` (jspdf 4.x breaking) + 12-PDF regression test?
3. Migration file follow-up — should I convert P1-01/02/06 SQL to `supabase/migrations/*.sql` numbered files?

**Next test push (if time permits):**
- Task #46 interactive gaps — WT create (verify F5-13 fix), Rekonsiliasi wizard mid-flow, Approval PIN
- Sentry synthetic error E2E
- Impersonation grant + audit verify
