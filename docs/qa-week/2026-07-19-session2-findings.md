# QA Session 2 — Findings Report

**Date:** 2026-07-19 (autonomous, ~2h execution after founder's second 5h-away)
**Mode:** Findings-first (per advisor guidance, no prod-mutating changes).
**Scope:** Corrections to Session 1 + expanded static-analysis sweep. Prepared draft fix SQLs in `docs/qa-week/pending-fixes/` — ready for founder review + one-command apply.

**Related docs:**
- Design: `docs/superpowers/specs/2026-07-19-qa-week-comprehensive-design.md`
- Session 1 findings: `docs/qa-week/2026-07-19-session1-findings.md`
- Pending fixes: `docs/qa-week/pending-fixes/`

---

## Session 1 corrections (2)

### C1: P1-03 is FALSE POSITIVE — migration 331 IS idempotent

**Session 1 said:** `20261115000331_export_tenant_data_rpc.sql` has 0 IF EXISTS guards → not idempotent.

**Reality:** Migration uses `CREATE OR REPLACE FUNCTION` (idempotent by design) + `REVOKE ALL ... FROM PUBLIC` (always idempotent) + `GRANT EXECUTE ... TO authenticated` (idempotent — re-grants don't error). No CREATE TABLE / CREATE INDEX / CREATE POLICY in the file.

**Root cause of false positive:** Session 1 grep was too narrow — only counted `IF (NOT )?EXISTS` pattern. `CREATE OR REPLACE` is a different, equally-idempotent form.

**Verdict:** Downgrade P1-03 → resolved. Migration is compliant with CLAUDE.md idempotency rule.

### C2: P1-04 confirmed HISTORICAL BASELINE — not autonomous fix scope

**Session 1 said:** Backend Go `db` + `notification` test packages fail.

**Reality:** Last touched 2026-07-02 (2+ weeks ago). Same failures reproduce on re-run. Root cause is test seed setup: tests attempt FK inserts on `customers` / `suppliers` / `stock_movements` with hardcoded tenant_ids that don't exist in prod `tenants` table. Test-DB bootstrap layer missing on my machine.

Notification package builds AND tests pass individually — the `[build failed]` from `go test ./...` was a transient race in the parallel build phase (couldn't reproduce on retry).

**Verdict:** Not a regression I caused. Fixing autonomously = rewriting test scaffolding (out-of-scope autonomous action per advisor). Test-DB seed setup is a task for founder to green-light.

Actionable: separate ticket to bootstrap test DB with valid tenant fixtures. Estimate: 2-4h investigation.

---

## New findings (Session 2)

### P1 candidate — WIB timezone bug across 37 FE sites

**Category:** F6 (boundary/numeric — date rollover) + F12 (data integrity)
**Module:** T3 Financial (RecordPaymentModal is highest risk) + T2 misc UI

**Impact:** `new Date().toISOString().slice(0, 10)` returns UTC-based YYYY-MM-DD. At 17:00-23:59 WIB, UTC has already rolled to H+1 → returns tomorrow's date. `src/lib/format.ts` has a helper docstring explicitly warning: *"same day happens to work but at 17:00-23:59 WIB the sale lands on the wrong day in the books"*.

37 occurrences bypass the helper. Highest impact:
| File | Line | Impact |
|---|---|---|
| `admin/RecordPaymentModal.tsx` | 45, 51 | **FINANCIAL** — payment records posted with wrong date after 17:00 WIB. Books misaligned. |
| `pengaturan/saldoAwal/Step1KasBank.tsx` | 34, 87 | Opening balance date wrong |
| `pengaturan/PromoProdukPanel.tsx` | 375 | Promo `min` date picker off — user can't select "today" after 17:00 |
| `pengaturan/saldoAwal/SaldoAwalWizard.tsx` | 172 | Same UI issue on max date |
| `admin/CostDashboard.tsx` | 17 | Displays wrong "today" label |
| `admin/AuditLogViewer.tsx` | 68 | CSV filename shows tomorrow's date |
| `pengaturan/PajakSettingsPanel.tsx` | 17 | Tax expiry date formatting |

Full list: `grep -rnE "\.toISOString\(\)\.slice\(0, 10\)" src/ --include='*.tsx' --include='*.ts' | grep -v test` (37 hits).

**Recommendation:** Replace all with `formatDateJakarta()` helper (or similar) from `src/lib/format.ts`. Priority within the 37: RecordPaymentModal first (financial).

**Blast radius:** Existing prod records posted with wrong date since ship-date of each site — need forensic query to identify.

---

### P1 candidate — 8-10 tables with tenant_id but no FK to tenants

**Category:** F12 (data integrity — orphan risk)
**Module:** T1 Master data + T5 Cross-cutting

**Query:**
```sql
SELECT c.table_name
FROM information_schema.columns c
WHERE c.table_schema='public' AND c.column_name='tenant_id'
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND constraint_type='FOREIGN KEY' AND table_name=c.table_name
  );
```

**Tables (excluding v_* views):** approval_settings, piutang_settings, product_units, product_brands, saldo_awal_snapshots, warehouses, service_types, tenant_settings, cash_account_balances (view?), t_rpc_idempotency, t_tenant_cost_daily.

**Impact:** If a tenant is deleted (cascade path from `tenants` table), these tables retain orphan rows. Also allows insertion of tenant_id values pointing to non-existent tenants (RLS prevents at runtime BUT DB-level trust is weaker).

**Recommendation:** Add FK constraints in a systemic cleanup migration. `ON DELETE CASCADE` matches existing pattern on `audit_log` and other tables.

---

### P2-11 — IDR formatting fragmented (4+ implementations)

**Category:** N/A UI consistency
**Module:** T2-T3 cross-cutting

**Implementations found:**
- `formatIDR` (`src/lib/formatIDR.ts`) — Math.trunc + `Rp ${n}` (admin dashboard convention)
- `formatRp` (`src/lib/format.ts`) — Intl currency style (POS/sales)
- `fmtRp` inline in `src/lib/pdf/*` — Math.round + `Rp ` + toLocaleString
- Inline `.toLocaleString('id-ID')` scattered across screens
- Local `formatIDR` in `OwnerDecisionInbox.tsx` — 4th implementation

Some use Math.trunc (0.99 → 0), others Math.round (0.99 → 1). Users see different totals for same input.

**Recommendation:** Consolidate to `formatIDR` (admin) + `formatRp` (POS) shared helpers. Deprecate inline versions. `formatRpDelta` for signed deltas.

---

### P2-12 — Migration idempotency: 48/435 files non-idempotent per grep

**Category:** DB compliance
**Module:** T5 Cross-cutting

**Query:**
```bash
grep -lE "^CREATE (TABLE|INDEX|POLICY|VIEW|MATERIALIZED VIEW|TRIGGER|TYPE|EXTENSION|...)" supabase/migrations/ | \
  xargs -I {} sh -c 'if ! grep -qE "IF NOT EXISTS|^-- .*[Ii]dempotent" "{}"; then echo "{}"; fi'
# 48 files
```

**Impact:** These migrations were successfully applied to prod. But if we ever need to fresh-provision (test-DB bootstrap, disaster recovery), 48 will fail with "already exists" or "duplicate object".

**Note:** Some may be false positives — `CREATE POLICY foo` preceded by `DROP POLICY IF EXISTS foo` is idempotent. My heuristic didn't check for prior DROP. Manual audit needed to differentiate real gaps.

**Recommendation:** Not a per-file bug fix — systemic cleanup task. Audit → refactor to add `DROP IF EXISTS ... CREATE ...` or `CREATE ... IF NOT EXISTS` pattern uniformly. Priority: low, defer to when test-DB bootstrap becomes needed.

---

### P2-13 — 13 realtime subscriptions lack client-side tenant filter

**Category:** F11 (multi-tenant isolation — defense in depth)
**Module:** T5 Cross-cutting

**Findings:** Subscriptions in `OrderHistoryScreen`, `PiutangBadge`, `SalesInboxBadge`, `useRealtimeConversations` (multi), `sales/queries.ts`, `SalesChannelsContext.tsx`, `WhatsappAiScreen`, `useWarehouses` — none use the `filter: 'tenant_id=eq.<id>'` parameter.

**Impact assessment:** Modern Supabase realtime enforces RLS on postgres_changes events. Since all tables have RLS on, cross-tenant events are already blocked at the server. **This is NOT a leak.**

However:
1. Bandwidth waste — server has to check RLS for every event across all subscribers.
2. Defense-in-depth — if RLS ever gets misconfigured (e.g., a new table added without proper policy), realtime becomes leak vector.
3. Best practice per Supabase docs.

**Recommendation:** Add explicit `filter: 'tenant_id=eq.<currentTenantId>'` to all 13 subscriptions. Minor refactor, no visible behavior change (unless RLS regression). Low priority — RLS is the real gate.

---

### Positive Session 2 findings

- ✅ **Discount computation defensive** — `computeDiscountAmount` handles null/NaN/negative/zero-base cases. Caps at base. Rounded to nearest Rp.
- ✅ **Sequence exhaustion: 0 pressure.** Max usage is `wa_recipients_id_seq` at 34/2.1B. All sequences use bigint (9.2 quintillion max) or int (2.1B max).
- ✅ **231 FK constraints** on public schema. Good referential integrity coverage overall.
- ✅ **CHECK constraint coverage on purchase_invoice_items** — 8 constraints (discount triple, XOR, ranges).
- ✅ **`pembayaran_items_xor`** — enforces XOR between tagihan_id + tukar_faktur_id. Business rule at DB level.
- ✅ **`pi_type_linkage_check`** — enforces "type=STOCK requires pesanan_id/tukar_faktur_id/TF-quick-add" (memory `tagihan_requires_pesanan`).
- ✅ **stock_movements immutable** — `trg_deny_sm_delete` + `trg_deny_sm_update` triggers.
- ✅ **Cron jobs clean** — `auto_resume_expired_locks` runs every 60s, last 10 runs all succeeded with "1 row" processed.
- ✅ **Async job queue clean** — 2 SUCCEEDED jobs in `t_jobs`, no failed/pending.
- ✅ **Split-pool healthy** — `claim_next_job` 169K calls at 0.32ms mean (Session 1 finding, unchanged).
- ✅ **Backend Go recon engine** — 8 files with tests covering classifier, matcher, name_similarity, special_cash/edc/internal. All test packages pass except db/notification (documented as historical).
- ✅ **WIB timezone helper exists** in `src/lib/format.ts` with explanatory docstring — the fix path is available, just under-adopted.

---

## Pending fixes ready for founder review

Located in `docs/qa-week/pending-fixes/`:

1. **`pending-fix-p1-01-revoke-debug-secdef.sql`** — REVOKE EXECUTE ON `_debug_jwt_claims_visible` + `_debug_secdef_probe` FROM authenticated, service_role. Zero app callers verified. Reversible.

2. **`pending-fix-p1-02-storage-bucket-limits.sql`** — UPDATE storage.buckets with file_size_limit + allowed_mime_types on 5 buckets (branding, product-photos, stock-evidence, chat-media, purchase-documents). Reversible via UPDATE ... SET NULL.

3. **`pending-memory-correction.md`** — narrative correction for `guard_expiry_write_broken_predicate` memory (was "~100 policies", reality is 6 residual).

**Apply command (when approved):**
```bash
# via MCP Supabase (recommended for RLS/GRANT changes)
mcp__plugin_supabase_supabase__apply_migration --sql "$(cat docs/qa-week/pending-fixes/pending-fix-p1-01-revoke-debug-secdef.sql)"

# via psql (fallback if MCP unavailable)
DB_CONN=$(python3 -c "with open('backend-go/.env') as f:
    for line in f:
        if line.startswith('SUPABASE_DB_CONNECTION='):
            print(line.rstrip('\n').split('=', 1)[1]); break")
psql "$DB_CONN" -f docs/qa-week/pending-fixes/pending-fix-p1-01-revoke-debug-secdef.sql
```

---

## Not applied (queued for review)

- **All P1/P2 fixes** — prepared as reviewable SQL, not applied to prod.
- **Memory correction** — narrative in `pending-memory-correction.md`, memory file itself untouched.
- **Backend Go db test seed bootstrap** — out of autonomous scope.
- **48 non-idempotent migrations refactor** — systemic cleanup, needs founder decision on scope.
- **WIB timezone bug fix (37 sites)** — needs founder priority call. RecordPaymentModal first-line-of-defense.
- **Realtime subscription filter add (13 sites)** — refactor, low priority.
- **Tables missing FK on tenant_id** — 8-10 tables — new migration needed.

---

## Cumulative status (Session 1 + 2)

| Severity | Session 1 | Session 2 corrections | Session 2 new | Total open |
|---|---|---|---|---|
| P0 | 0 | 0 | 0 | 0 |
| P1 | 4 | −1 (P1-03 false pos), P1-04 recategorized | +2 (WIB tz, missing FK) | ~5 |
| P2 | 8 | 0 | +3 (IDR fragment, mig idempotency, realtime filter) | 11 |
| P3 | 6 | 0 | 0 | 6 |

**Zero critical (P0) findings across both sessions.** Foundation remains strong.

**Blocking onboarding: none** — all P1s are either localized fixes, or need founder scope decisions (WIB tz priority order, backend Go test bootstrap).

---

## For founder review

**Priority discussion topics:**
1. **P1-01/P1-02 draft fixes** — apply this week? Any objection to bucket size limits I chose?
2. **WIB timezone bug (37 sites)** — is RecordPaymentModal top priority? Order of fix?
3. **P1-04 backend Go test bootstrap** — dedicated task or defer?
4. **P2-13 realtime filter** — worth the refactor or leave as YAGNI (RLS-enforced)?
5. **Memory correction** — approve applying the update?
6. **Green-light Day 1 UI phase** — needs your login to spin QA tenants + interactive sweep.
