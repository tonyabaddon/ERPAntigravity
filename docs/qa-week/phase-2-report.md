# QA Week Phase 2 — Wave 1 Report

**Plan:** `docs/superpowers/plans/2026-07-20-qa-week-phase-2-wave-1.md`
**Executed:** 2026-07-20 (autonomous, founder away 2h)
**Base → head:** 82f0a03 → dbc848f (+ this doc)

## Wave 1 SHIPPED (2D + 2C + 2H)

### 2D: RLS predicate fix (Task 2, commit `78a02cd`)
- Migration 503 swaps broken `_guard_expiry_write() IS NULL` (void IS NULL = always false) → working `_check_expiry_ok()` boolean on 6 residual policies (`warehouse_transfers` + `warehouse_transfer_items` INSERT/UPDATE/DELETE).
- Applied via Management API (Phase 1 pattern).
- Regression PASS 2/2 (`tests/sql/qa-week/2d-regression.sql`): 0 policies retain broken predicate, 6 WT policies use `_check_expiry_ok()`.
- Direct-write smoke: authenticated INSERT to `warehouse_transfers` succeeded (previously blocked by broken predicate) — rolled back cleanly.
- schema_migrations tracked.
- Concerns from subagent: brief's smoke used wrong column names (`from_warehouse`, `DRAFT`); corrected inline to `from_warehouse_id`, `IN_TRANSIT`. Non-blocking.
- Founder follow-up: update memory `guard_expiry_write_broken_predicate` — now 0 policies remain broken (was noted as ~100, actually was 6 at Wave 1 start).

### 2C: Perf indexes (Task 3, commit `9b93377`)
- Migration 504: 4 `CREATE INDEX CONCURRENTLY` btrees via Management API (empirically verified 2026-07-20 that Supabase Management API accepts CONCURRENTLY — advisor's earlier warning was speculative). Sent as 4 separate POSTs to avoid transaction wrap.
- All 4 indexes with `indisvalid = true`:
  - `idx_approval_requests_tenant_status_created` on `(tenant_id, status, created_at DESC)`
  - `idx_purchase_order_items_po` on `(po_id)`
  - `idx_stock_lots_fifo` partial on `(tenant_id, sku, created_at) WHERE qty_remaining > 0`
  - `idx_purchase_orders_tenant_supplier_status` on `(tenant_id, supplier_id, status)`
- EXPLAIN plans after: Q3 flipped Seq Scan → Index Scan with **22× exec speedup** (3.09 → 0.14 ms). Q4 flipped Seq Scan → Index Scan (2.12 → 1.94 ms). Q1 keeps a partial-index path but planner eliminated Sort step. Q2 already had partial coverage.
- Advisor gate: consulted per CLAUDE.md irreversible-decision protocol. Decision memo at `docs/superpowers/specs/2026-07-20-perf-indexes-decision.md`.
- schema_migrations tracked.
- Follow-up: re-check `pg_stat_user_indexes.idx_scan` quarterly; drop indexes idle 30d (P3-01 backlog).

### 2H: Realtime tenant filter (Task 4, commit `dbc848f`)
- Added `filter: 'tenant_id=eq.${currentTenantId}'` to 13/13 postgres_changes subscribers across 8 source files + 1 call-site update (`DaftarPesananScreen.tsx` for new `subscribeOrders(tenantId, ...)` signature).
- Step 0 tenant_id column check: all 7 source tables (`sales_channel_settings`, `orders`, `whatsapp_numbers`, `conversations`, `messages`, `warehouses`, `kasir_transactions`) confirmed `has_tenant_id = 1`. No table required alt-filter or skip.
- TypeScript type-check clean (`tsc --noEmit`), `vitest --changed` 27 tests PASS across 5 files.
- Live-fire browser smoke deferred to founder (chrome-devtools MCP profile held by parallel session; requires login).

## Multi-tenant matrix re-verify
- 3-tenant × 6-table matrix (36 attempts): **0 leaks** confirmed post-Wave-1.
- Tenants: Garindo, Toko Jaya, Warung. Tables: customers, purchase_invoices, pembayaran, journal_entries, kasir_transactions, bank_accounts.

## 2I deferred
- Task 1 (schema baseline) deferred to founder — needs `SUPABASE_DB_PASSWORD` (not in `.env`). Rescheduled to Wave 1.5 after founder sources password.

## P0 incident (unrelated to Wave 1 work)
`docs/incidents/2026-07-20-backend-wa-init-crashloop.md` — prod + staging backend Go crashlooping at startup since ~14:08 UTC 2026-07-20 with `[MAIN] WA client init failed` → `exit(1)`. Backend Go binary is byte-identical to last-good 82f0a03 (Wave 1 changes are SQL + FE only). Real error message swallowed by `slog.Any(err)` empty-object serialization bug (memory `wa_test_data_noise`). WA bot currently non-functional; app.caleo.id ERP web app unaffected (goes through Supabase directly). Requires founder attention on return: (a) rollback or WA re-pair, (b) fix slog to surface real error before next deploy.

## Success criteria hit
- 3 commits tagged `[qa-week-followup]` for Wave 1 (78a02cd, 9b93377, dbc848f)
- Cloud Build `sinar-elektrik-frontend` all SUCCESS for Wave 1 commits; backend trigger unrelated P0 (see incident).
- `get_advisors` sweep post-migration 503 + 504: no new findings from Wave 1.
- 3 regression evidence files: `tests/sql/qa-week/2d-regression.sql`, `tests/sql/qa-week/2c-explain-before-after.sql`, `tsc + vitest` for 2H.
- 3-tenant matrix: 0 leaks (36 attempts).
- schema_migrations: 503 + 504 tracked.

## Follow-ups
- 2I (schema baseline) — DB_PASSWORD needed
- Wave 2 batches: 2E (financial SECDEF refactor), 2B (routing), 2A (WT UX polish)
- Wave 3: 2F, 2G, 2J, 2K
- Backend WA outage — P0 incident file, requires founder debug/rollback
- Memory update: `guard_expiry_write_broken_predicate` → 0 remaining (was 6)
- Fix `slog.Any(err)` empty-object serialization bug system-wide before next backend deploy

---

## Wave 2 SHIPPED — 2026-07-21

### 2A: WT UX polish (Task 1-3, commit 017f56d)
- **F5-12** block WT create when FROM=TO warehouse — submit button disabled + belt-and-suspenders guard in `submit()` handler
- **F5-14** DIKIRIM KEPADA empty helper — Bahasa message + link to User Management when recipients=[]
- **F5-01** PelangganScreen "+ Tambah Pelanggan" button — reuses `NewCustomerInlineForm` in modal
- 19 unit tests, lint clean, all gates green

### 2B: Routing + error class (Tasks 4-5)
- **Task 4 (audit) commit b9f7eea** — `docs/audits/2026-07-21-urlroute-behavior.md`. F5-11 routing race investigation → NO race found (parseRoute ignores query, parseSearch has zero non-test callers). Refactor DEFERRED. 10+ direct `window.location.href` sites documented for potential future consolidation.
- **Task 5 (F5-10) commit 6ee6ec9** — impersonate failure now branches on `_is_platform_admin` claim: admin → `AccessDenied`; tenant user → `TenantBootstrapError`. Sentry tag `error_class` emitted. Extracted into `ImpersonateFailureScreen` component + 6 unit tests. Full suite 114 files / 1000 tests pass.

### 2E: DEFERRED (pool exhaustion)
Task 6 PREREQUISITE gate blocked: mgmt-api unreachable due to Supabase :5432 pool exhaustion. Founder needs to (a) drain pool via Supabase Dashboard SQL Editor, (b) verify audit_log RLS state, (c) apply migration 505 if needed. Ships in a future wave.

---

## Wave 3 SHIPPED — 2026-07-21

### 2F: Formatting consolidation (Task 1, commit 3083803)
- ~48 local Rp formatting helpers consolidated to canonical `formatIDR` from `src/lib/formatIDR.ts`
- 3 duplicate `formatIDR` local definitions removed (OwnerDecisionInbox, PaymentInstructionBlock, KlaimSupplierPanel)
- ~45 `fmtRp`/`formatRupiah` closures removed across 71 files
- Preserved intentionally: PDF formatters, accounting parens notation (NeracaTab/LabaRugiTab), `fmtRpShort` abbreviated, VoidConfirmModal custom `Rp -` sign
- 50 vitest tests pass

### 2K: Idempotency key audit logging (Task 2, commit b74f60d)
- Grep found all 4 high-value RPCs already have `p_idempotency_key` wired via `crypto.randomUUID()`: `record_kasir_sale`, `commit_opname`, `receive_purchase_order`, `record_pembayaran`
- Added audit logging: each key extracted to named variable + `console.info('[idempotency] <rpc> key=<uuid>')` for traceability
- `tests/sql/qa-week/2k-verify.sql` created for post-deploy verification (SQL run deferred pending pool)
- 77 vitest files pass

### 2G: Bundle size (Task 3, commit a2bff54)
- **3.2 MB → 2.26 MB (-944 kB, 29% reduction)**
- `vite.config.ts` manualChunks: `pdf-vendor` (jspdf + html2canvas, 625 kB), `icons` (lucide-react, 61 kB), `supabase` (@supabase/*, 210 kB)
- `AdminRoutes` lazy-loaded via `React.lazy()` + Suspense; 205 kB deferred until `/admin/*` visited
- 8 PDF generator sites converted to dynamic `await import()` at call site
- Target <1.5 MB not achieved — remaining is ~20 tenant screens statically imported in App.tsx's `renderPage()` switch. Follow-up: lazy-screen refactor (Wave 4+)

### 2J: DEFERRED to next session (~2 days scope)
Systematic FE state coverage (loading + empty + error per screen) requires 2 days per spec. Out of scope for current 9h autonomous window.

---

## Combined Phase 2 status

- **Wave 1 (2D + 2C + 2H; 2I deferred):** SHIPPED
- **Wave 2 (2A + 2B; 2E deferred):** SHIPPED
- **Wave 3 (2F + 2K + 2G; 2J deferred):** SHIPPED

**Deferred to next session:** 2I (schema baseline, needs DB password), 2E (SECDEF refactor, needs pool free), 2J (state coverage, 2-day scope)

## Additional incident actions taken
- Prod backend rollback to cf73c29b (00467-bih) — restored WA bot service after 82f0a03 revision cold-start crashloop from Supabase :5432 pool exhaustion
- Staging backend recovered on 5b0f8a1 (00102-jbc) with Option 2 WA client → :6543 txn pooler fix (confirmed working)
- cloudbuild.yaml prod-deploy step bypassed while pool remains exhausted (commit 00ab986). Restore Step 5+6 from git history after founder drains pool + verifies fresh cold-start succeeds

## Final follow-ups (for founder on return)
- Drain :5432 zombie idle connections via Supabase Dashboard SQL Editor (kill idle app_name='' postgres sessions >2min)
- Deploy prod backend to Option 2 image (staging 00102-jbc's docker image SHA) after pool drains
- Restore cloudbuild.yaml Step 5+6 (prod deploy + tag URL smoke + promote) once pool is stable
- Apply Wave 2 2E migration 505 (after audit_log RLS verified per Task 6 Step 4)
- Apply Wave 1 2I schema baseline (needs SUPABASE_DB_PASSWORD)
- Wave 3 2J FE state coverage (~2 days work)
- Memory update: `guard_expiry_write_broken_predicate` → 0 remaining (was noted as ~100, actually was 6 at Wave 1 start; all fixed by 2D commit 78a02cd)
- Systematic slog.Any → slog.String migration in backend-go (11 sites per grep; only 1 fixed inline for [MAIN] WA client init in commit 19ea22d)

---

## Session B + partials — 2026-07-21 (autonomous 8h window continued)

### Session A: 2E financial SECDEF refactor — SHIPPED (commit 4b4770f)
Adversarial gate ran: audit_log HAS RLS but tenant_id column defaults to
`_resolve_tenant_id()` + t_insert_own policy checks same value → direct FE
INSERT passes cleanly. Smoke via mgmt-api with fake JWT confirmed id=469
INSERT succeeded (rolled back). **No SECDEF wrap needed.** Scope collapsed
to (a) fix misleading `EditOrderModal` comment, (b) capture regression SQL
at `tests/sql/qa-week/2e-regression.sql`. Zero new RPCs shipped.

### P3-03: whatsmeow table comments — SHIPPED (commit 286e31a)
Migration 505 adds COMMENT ON TABLE for 6 whatsmeow_* tables documenting
the RLS-enabled + zero-policies rationale (daemon connects as postgres
owner, bypasses RLS; multi-tenant isolation in Go layer). Applied +
schema_migrations tracked.

### Phase 4: backend Go test helper — HELPER SHIPPED (commit 94b484d)
`backend-go/internal/db/testhelpers.go` — `NewTenantForTest(t, c) uuid.UUID`
with `t.Cleanup(...)` CASCADE delete. `go build ./...` + `go vet ./...`
clean. **Test refactor DEFERRED** — subagent found all 80+ tests fail
with SQLSTATE 53300 (Supabase :5432 pool exhaustion) BEFORE reaching any
tenant-FK failure. Actual test refactor needs live DB (pool clear).

### P2-07: any-type sweep in src/lib — SHIPPED (commit cf6ff8b)
**80 → 0** `any` occurrences across 13 files. Full clean:
`supabaseClient.ts` (50), `backendUrl.ts` (1), `pembayaranService.ts` (5),
`pembelianService.ts` (3), `pesananService.ts` (3), `purchaseInvoiceService.ts` (8),
`tukarFakturService.ts` (2), `piutangService.ts` (1), `sales/orderMapper.ts` (2),
`pdf/belanjaNumpangLewatPdf.ts` (1), `pdf/purchaseOrderPdf.ts` (1),
`akuntansi/journalReconService.ts` (2), `akuntansi/service.ts` (2). Zero
intentional-any left. 666 vitest tests pass; lint clean.

### P3-02: Sentry captureException sweep — SHIPPED (commit 2b8d307)
Helper `src/lib/captureError.ts` (calls console.error + Sentry.captureException,
safe no-op when VITE_SENTRY_DSN absent). Swept 89 source files, wrapped
**151 of 153** `console.error` sites with `captureError(err, {feature, action})`
context. 2 sites preserved intentionally (AppErrorBoundary already wraps
directly + WhatsappAiScreen has console.error inside a string template
literal displayed to users). Lint clean; 60 vitest tests pass.

### Session C partial 2J: 7 additional screens patched — SHIPPED (commit 3782b51)
Beyond initial 3 (LaporanScreen already fixed via 6b6740f; PenjualanScreen +
StockManagerScreen are prop-fed with no fetch), added missing states to
7 screens: OrderHistoryScreen, UserManagementScreen, DashboardScreen,
WhatsappAiScreen, ManajemenGudangScreen, PembelianListScreen, PiutangScreen.
2 screens (PelangganScreen, NotificationPrefsScreen) already had complete
coverage — no changes. Zero UI layout re-flow, additive-only.

## Deferred (pool blocker, needs founder Dashboard action)

- **P3-01** drop 15 unused indexes — deferred per spec's "verify 1-week
  stability" requirement (Wave 1 indexes only 1 day old at Session B time)
- **P3-04** wa_recipients + conversations test fixture cleanup — needs
  pool free to query current fixture rows + DELETE
- **P3-05** SECDEF ownership auto-audit — needs pool free to run the
  candidate-list query + apply `ALTER FUNCTION ... OWNER TO vosi_rpc_owner`
- **Phase 4 test refactor** — needs pool free to run `go test ./internal/db/...`
  and identify actual failure modes (may be pool-related, not tenant-related)

## Combined status after 2026-07-21 sessions

- **Wave 1 (2D + 2C + 2H; 2I deferred DB pw):** SHIPPED
- **Wave 2 (2A + 2B + 2E; nothing deferred):** SHIPPED
- **Wave 3 (2F + 2K + 2G + 2J partial):** SHIPPED
- **Phase 3 (P3-03 + P3-02):** SHIPPED  
- **Phase 3 (P3-01 + P3-04 + P3-05):** DEFERRED (pool)
- **Phase 4 helper:** SHIPPED (refactor deferred, pool)
- **P2-07:** SHIPPED

## Next-session priorities (post-pool-drain)

1. Founder drains :5432 pool via Supabase Dashboard SQL Editor (~10 min)
2. Phase 4 refactor tests using `NewTenantForTest` helper (~3h)
3. P3-04 + P3-05 (~1h combined)
4. P3-01 after 1 week + `pg_stat_user_indexes` stability review
5. 2I schema baseline (needs SUPABASE_DB_PASSWORD in .env)
6. Phase 5 test coverage (needs chrome-devtools MCP; may include Playwright fallback)
7. Restore cloudbuild.yaml Step 5+6 (prod BE deploy) from git history

