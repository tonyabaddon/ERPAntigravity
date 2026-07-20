# QA Week Phase 1 Report

## F5-05 Impact Analysis (2026-07-20)

**Direct importers of GetOrCreateCustomer:**
- `backend-go/internal/whatsapp/handler.go` (3 call sites: lines 176, 431, 463)

**Indirect callers:** none (helper is package-scoped, only handler consumes)

**Tests exercised:** 0 (no test mocks reference GetOrCreateCustomer)

**DB touchpoints:** `customers` table (INSERT), reads `gjp_cust_seq` sequence (to be deprecated)

**FE ID-format assumptions:** 0 grep matches for `GJP-CUST` or prefix startsWith

**Data safety:** 0 existing customer duplicates on (tenant_id, wa_number)

**Conversation struct:** `models.Conversation` has `TenantID` field available in handler.go context (verified line 162: `conv, created, err := h.db.GetOrCreateConversation(senderPhone, h.waNumberID)`)

**Verdict:** 3 call sites, 0 tests, 1 DB touchpoint. Plan updates 3 handlers to pass tenantID from conv.TenantID. Sequence gjp_cust_seq left intact (deprecated, not dropped). FE unaffected. Data safe for composite (tenant_id, wa_number) unique constraint.

## P2-03 Impact Analysis (2026-07-20)

**audit_log FKs referencing it:** 0 direct FKs to audit_log as parent; audit_log table has FK to tenants (audit_log_tenant_id_fkey)

**pembayaran FKs referencing it:** 1 (`pembayaran_items_pembayaran_id_fkey` references pembayaran.id)

**pembayaran_items has tenant_id column:** YES (uuid, NOT NULL)

**pembayaran_items data consistency:** 0 mismatched tenant_id vs parent pembayaran (verified via JOIN on pembayaran_id with tenant_id match check)

**Verdict:** audit_log migration = simple ADD CONSTRAINT composite PK on (tenant_id, id); safe since leaf table (no child FKs). pembayaran migration MUST drop FK first, add composite PK (tenant_id, pembayaran_id), re-add FK from pembayaran_items as composite.

---

## Phase 1 SHIPPED (2026-07-20)

### F5-05 (Option A — tenant-aware customer)
- Backend refactor: `4a673e5` (GetOrCreateCustomer signature) + `fc2198f` (uuid.Nil early-skip guard) + `b8416ad` (FE friendly BID error) + `33059a4` (regression SQL)
- Migration `501` (`800072b`): swap `uq_customers_wa (wa_number)` → `uq_customers_wa_tenant (tenant_id, wa_number)`; also backfilled `schema_migrations` for Session-7 migrations 471/472/473 that were untracked
- Regression PASS 3/3 (`tests/sql/qa-week/f5-05-regression.sql`): cross-tenant create OK, same-tenant conflict blocked
- Stage 3 chrome smoke: **DEFERRED to founder** (chrome-devtools MCP profile held by parallel session); backend + DB fix already proven by regression

### P2-03 (composite PK on high-volume tables)
- Migration `502` (`8cb1955`): DROP `pembayaran_items_pembayaran_id_fkey` → DROP PK → ADD composite `PRIMARY KEY (tenant_id, id)` on both `audit_log` + `pembayaran` → RE-ADD composite FK preserving `ON DELETE CASCADE`
- Decision memo: `docs/superpowers/specs/2026-07-20-audit-pembayaran-composite-pk-decision.md`
- Advisor consulted pre-apply: REPLICA IDENTITY default verified, backend Go grep for bare `WHERE id=$1` returned 0 (no single-col lookups broken by composite PK), row counts updated to verified (audit_log 210, pembayaran 9)
- Regression PASS 3/3 (`tests/sql/qa-week/p2-03-regression.sql`): both PKs `(tenant_id, id)` + FK composite
- Idempotency guard fix caught by subagent: brief's `ORDER BY attnum` sorts by table-column ordinal (wrong); replaced with `unnest(indkey) WITH ORDINALITY` (correct index key order) — propagated to regression. Brief template flagged for future PK-change tasks
- Realtime subscription smoke: **DEFERRED to founder** (chrome-devtools MCP held); Supabase Realtime v2+ supports composite PKs per docs, no DB-level errors observed
- Controller-verified: only 1 inbound FK to pembayaran = the composite FK we re-added (verified via `pg_constraint` scan)

### P1-07 (jspdf 4.x + jspdf-autotable 5.x DOMPurify CVE)
- Bump: `83fde05` — jspdf 2.5.2 → 4.2.1, jspdf-autotable 3.8.4 → 5.0.8 (two-major jump), dompurify 2.5.9 → 3.4.12
- Zero src changes required to compile (all 13 generators use explicit `styles: {...}` + `didParseCell` hooks that override every autotable default, immunizing against library default shifts)
- Doc: `c2fa60e` (regression report follow-up)
- Regression PASS 13/13 (`docs/qa-week/pdf-regression/2026-07-20-jspdf-4.2.1-visual-diff.md`):
  - `pdftotext -layout` diff = 0 lines drift on all 13 pairs
  - `magick compare -metric AE` at 100dpi = 0 diff pixels on all 13 pairs
  - `magick compare -metric AE` at 300dpi = 0 diff pixels on saldoAwal / neraca / purchaseOrder / invoiceDp (spot-check)
  - `/Producer` metadata verified pre=`jsPDF 2.5.2` vs post=`jsPDF 4.2.1` (rules out Vite dep-cache pollution)
- Baselines committed at `docs/qa-week/pdf-regression/{pre,post}/*.pdf` for future re-runs
- New dump-test infra: `tests/pdf-regression/dump.test.ts` (13 tests <1s)

### Multi-tenant re-verify
- 3-tenant × 6-table matrix (36 attempts): **0 leaks** confirmed post-Phase-1
- Tables tested: customers, purchase_invoices, pembayaran, journal_entries, kasir_transactions, bank_accounts
- Tenants: Garindo (`11111111-…`), Toko Jaya (`22222222-…`), Warung (`49cbbc94-…`)

### Success criteria hit
- 6 commits tagged `[qa-week-followup]` in git log (db0e005, 4a673e5, fc2198f, b8416ad, 33059a4, 800072b, 8cb1955, 83fde05, c2fa60e)
- Cloud Build all SUCCESS (backend + frontend triggers)
- `get_advisors` sweep: 1 NEW INFO finding (`unindexed_foreign_keys` on `pembayaran_items(tenant_id, pembayaran_id)`) triaged defer at 9 rows; add covering index at ~1M row threshold. All other 480+ findings pre-existing
- 3 regression test files added: F5-05 SQL, P2-03 SQL, P1-07 dump.test.ts
- 3-tenant matrix: 0 leaks (36 attempts)
- `supabase_migrations.schema_migrations`: 501 + 502 tracked (plus backfill of 471/472/473 from Session 7)

### Follow-ups
- Founder chrome-devtools MCP smoke on Toko Jaya: (a) cross-tenant customer create UI + friendly error mapping, (b) Realtime subscription on SalesInboxScreen or similar
- Update memory `guard_expiry_write_broken_predicate` (Session 5 correction pending: 100→6 residual policies)
- Drop `gjp_cust_seq` sequence in Phase 3 cleanup migration
- Add `CREATE INDEX CONCURRENTLY idx_pmi_tenant_pembayaran ON pembayaran_items (tenant_id, pembayaran_id)` when table nears 1M rows
- 100M+ audit_log threshold → separate design memo for `PARTITION BY RANGE (created_at)`

### Rollback plan (per fix)

| Fix | Trigger | Command |
|---|---|---|
| F5-05 backend | WA bot fails on Garindo customer lookup post-deploy | Revert commit + Cloud Run traffic switch to previous revision |
| F5-05 migration 501 | New constraint blocks legitimate insert | `ALTER TABLE customers DROP CONSTRAINT uq_customers_wa_tenant; ADD CONSTRAINT uq_customers_wa UNIQUE (wa_number);` |
| P2-03 migration 502 | PK-dependent query breaks OR Realtime subscription fails | Inverse migration — see decision memo for exact SQL (drop composite FK on pembayaran_items → drop composite PK → add single-col PK → re-add single-col FK) |
| P1-07 jspdf | PDF layout regression discovered post-deploy | `cp /tmp/package.json.pre-jspdf-bump package.json && npm install` OR `git revert 83fde05` |
