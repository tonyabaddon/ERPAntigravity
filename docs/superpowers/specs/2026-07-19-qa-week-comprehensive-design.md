# QA Week — Comprehensive Test & Fix (Pre-Onboarding Freeze)

**Author:** Autonomous QA session, 2026-07-19
**Duration:** 7 hari kerja (Day 1 = 2026-07-20, Day 7 = 2026-07-26)
**Trigger:** Sebelum onboarding tenant real baru, founder ingin zero-bug pass across the whole ERP (kecuali WA — sudah ditest di Terminal 26).
**Related memories:** `smoke_test_security_definer_rpcs`, `check_constraints_before_rpc_rewrite`, `guard_expiry_write_broken_predicate`, `secdef_returning_gap`, `all_buckets_tenant_scoped`, `custom_domain_live`, `sentry_setup`, `deploy_verify_after_push`, `parallel_terminals_worktree`.

---

## 1. Goal & non-goals

### Goal
Sebelum tenant real berikutnya di-onboard:
- **Zero P0/P1 open bugs** di seluruh modul in-scope.
- **Multi-tenant isolation clean** — 0 cross-tenant leak lewat URL/API/subscription.
- **UI/UX konsisten** ke design system yang ada — semua state (empty/loading/error/success/edge) ke-cover.
- **Backend RPC contracts stable & idempotent** — retry-safe, atomic, well-mapped errors.
- **Observability lengkap** per CLAUDE.md (entry log + error log + usage counter).

### Non-goals (explicitly out of scope)
- WhatsApp AI + WA notification framework (sudah ditest Terminal 26).
- Landing/marketing pages (caleo.id) — non-tenant-facing. DNS routing tetap dites di T5.
- Load / stress test (YAGNI di 3 tenant scale — memory: no Task 13 heavy load test).
- Feature freezing tidak berarti feature deletion — hanya no-new-feature during QA week; hotfix boleh.
- New architectural changes (semua flagged, tunggu approval — tidak fix autonomous).

### Success in one line
> Onboard tenant baru = zero surprise. Kalau ada surprise = tercatat di bug backlog dengan owner + timeline.

---

## 2. Scope — module coverage (8 tier, ~50 cluster)

Ordering by criticality. Kalau overrun, skip dari bawah (T7 → T4 promo → T3 piutang advanced).

### T0 — Foundation (SEC-critical, never skip)

| Cluster | Sub-items | Migration/table touch |
|---|---|---|
| **Auth flow** | AuthScreen (login/signup), SelectTenant, TenantErrorScreen (`not-found`/`suspended`/`denied`/`bootstrap`), deep-link restore, post-login route | `auth.users`, tenant memberships |
| **Multi-tenant isolation (cross-cutting)** | Parallel track — test di setiap cluster + dedicated deep sweep Day 6 | Semua `t_*` policies + SECDEF RPCs |
| **Billing / Grace / Readonly** | GraceBanner, ReadonlyBanner, billing state machine, tenant status transitions | `tenant.status`, billing tables |
| **Admin impersonation** | TenantImpersonationBanner, impersonation grants, audit log per session | `impersonation_grants`, `audit_log` |
| **User Management** | UserManagementScreen, PermissionSet, role CRUD, invite flow | `user_roles`, `permissions` |
| **Error boundaries & routing** | AppErrorBoundary, AccessDenied, NotFound, TenantBootstrapError, TenantNotFound, TenantSuspended | Client routing |
| **Pengaturan foundational (11 panel)** | IdentitasToko, JamOperasional, Pajak, CostingMethod, ModulSwitches, SaldoAwal, RekeningBank, ApprovalGate, ApprovalRules, SalesChannelConfig, SupportAccess | `tenant_settings.modul_*`, `sales_channels`, `pajak_config` |
| **Rate limit per tenant** | Verify per-tenant rate cap enforced (migration 319) | `rate_limit_per_tenant` |

### T1 — Master data (never skip)

| Cluster | Sub-items |
|---|---|
| **Produk** | ProductForm, BulkUpdateGrosir, BulkUpload, CatalogGridView, CatalogListView, StockTableView, StokGudangInline, PreviewCard, categorySpecs, photoValidation, productFormValidate, InlineExpandPanel, ViewModeSwitcher |
| **Stok inti** | StockManagerScreen, StockAdjustmentModal, PriceChangeRequestModal, DamageFlagModal |
| **Stock Opname** | StockOpnameScreen, StockOpnameSessionView, commit_opname RPC, idempotency (mig 313) |
| **Manajemen Gudang** | ManajemenGudangScreen, WarehousePicker |
| **Pelanggan** | PelangganScreen, customer CRUD, credit limit, CustomerCreditActivate approval flow |
| **Kas & Bank** | KasBankScreen, AccountDetailScreen, AccountFormModal (BANK/KAS/E_WALLET — memory `garindo_account_types`) |

### T2 — Core transactions (never skip)

| Cluster | Sub-items |
|---|---|
| **Pembelian: PO** | PesananList/Detail/Form, StockPicker, SupplierPicker, InlineSupplierForm, ItemRow |
| **Pembelian: Receive Goods** | ReceiveGoodsModal, ReceiveReplacementModal, receive_purchase_order RPC + idempotency (mig 312) |
| **Pembelian: Tagihan** | TagihanList/Detail/Form (CHECK constraint: type=STOCK requires Pesanan — memory) |
| **Pembelian: Pembayaran** | PembayaranList/Detail/Form, MarkAsPaidModal, record_pembayaran + idempotency (mig 315) |
| **Pembelian: BNL** (Belanja Numpang Lewat) | BNL List/Detail/Form, MarkPaid, OrderPicker, PaymentMethodPicker, PiNumberBadge, PiStatusBadge, SkuPickerWithInlineCreate, VoidConfirm |
| **Pembelian: Tukar Faktur** (optional per memory) | TF List/Detail/Form, TfQuickAddTagihanModal |
| **Pembelian: Klaim Supplier** | KlaimSupplierPanel |
| **Penjualan: Kasir POS** | KasirScreen, KasirInvoiceModal, composite PK kasir_transactions (mig 316 — partition-ready) |
| **Penjualan: Wizard** | CatatPenjualanWizard multi-step, CartRows, ChannelSelector, CustomerPanel, PaymentMethodSelector, RakitButtonsRow, RakitInlineForm, TambahLayananModal, LockSubmissionModal, MarkLunasModal |
| **Penjualan: Invoice/Quotation** | InvoicePreviewScreen, DaftarPenawaranScreen, InvoiceModal, SalesInvoicePDF |
| **Warehouse Transfer (2-step)** | WarehouseTransferList/Create/Detail, SKUPicker, InTransitChip, warehouseTransferPDF |
| **Sales pipeline external** | SalesLandingScreen, DaftarPesananScreen, EditOrderModal, OrderRow, PaymentProofLightbox/Thumbnail/Upload, StageStrip, SubStageSection, TypeTabs, ReasonInputModal, RiwayatPersetujuanPanel, StatsCards, UrgentOrdersPreview, QuickActionPill |
| **Owner Decision Inbox** | OwnerDecisionInbox |
| **Sales Inbox / Order History** | SalesInboxScreen, OrderHistoryScreen |
| **Discount (cross-cutting)** | DiscountInlineInput, DiscountRow, computeDiscountAmount, useDiscountBinding — dipakai di Kasir/Penjualan/Pembelian |

### T3 — Financial (never skip inti)

| Cluster | Sub-items |
|---|---|
| **Akuntansi GL** | AkuntansiScreen, GL queries, CashAccountPicker, dualWrite |
| **Manual Journal** | manual/ CRUD, manualEntry, journalReconService |
| **Opening Balance** | OpeningBalanceWizard, SaldoAwal panel, period close |
| **Laporan** | LaporanScreen, Neraca, P&L, Laba Rugi, TopCustomerTable, SlowMoverTable, LayananSection, sub-akuntansi reports |
| **Piutang (AR)** | PiutangScreen, PiutangBadge, WriteOffRequestModal, RevertWriteOffConfirmModal, TempoWriteOff approval |
| **Rekonsiliasi wizard** | Full wizard (WizardSteps, MappingDrawer, ClassificationModal, CashColumn/JournalColumn/MutasiColumn/OrdersColumn, POSellThrough, SplitMode, TallyBar, NextActionBanner, CompletionSummary, MultiAccountStatus, UploadPDFModal, AddBankAccountModal) |

### T4 — Approval + workflow

| Cluster | Sub-items |
|---|---|
| **Approval** | ApprovalInboxScreen, ApprovalRequestRow, CustomerCreditActivate, RakitLock, TempoWriteOff, OwnerPinPad, PendingApprovalBadge |
| **Notification Settings** (non-WA) | NotificationSettingsScreen — email/push toggles (verify tidak overlap WA) |
| **Promo / Diskon** | PromoInlineEdit, PromoProdukPanel, PromoProdukCard (dashboard), useActivePromos |
| **Dashboard** | DashboardScreen, TodayStripCard, MaintenanceCard, PreOrderFulfillmentsCard, PromoProdukCard, DashboardMaintenanceSection |

### T5 — Cross-cutting (test bareng applicable modules)

| Cluster | Sub-items |
|---|---|
| **PDF generation** (6 PDF) | SalesInvoicePDF, purchaseOrderPdf, belanjaNumpangLewatPdf, warehouseTransferPDF, tandaTerimaPdf, akuntansi/pdfExport — layout, IDR format, page break, unicode |
| **File upload** | product-photos, chat-media, payment proof (JPG/PNG), bank statement PDF — tenant-scoped RLS per memory `all_buckets_tenant_scoped`, size/mimetype limits |
| **Audit logging** | AuditLogViewer, AuditTable, audit_row_trigger (mig 332), audit_kasir_and_pembelian (mig 325), retention (mig 328) |
| **Async job queue** | claim_next_job RPC (memory Bug E split-pool fix), job retry, DLQ, followup_failed_attempts (mig 330), scheduler timeout |
| **Rate limit enforcement** | Verify per-tenant cap (migration 319) — attempt burst → 429 → recovery |
| **Tenant cost aggregation** | tenant_cost_daily (mig 318), scheduler_backfill_tenant_cost (mig 329), CostDashboard display |
| **Export tenant data** | export_tenant_data_rpc (mig 331) — data portability, verify all tenant tables covered |
| **Sentry error capture** | @sentry/react + sentry-go — synthetic FE + BE error → land di caleo-frontend / caleo-backend project |
| **Security headers** | CSP + HSTS + X-Frame-Options di semua subdomain (app.caleo.id, staging.caleo.id, admin.staging.caleo.id, caleo.id via Cloudflare Worker) |
| **Custom domain routing** | app.caleo.id health, staging.caleo.id, admin.staging.caleo.id (memory `custom_domain_live`) |
| **Observability audit** | Per CLAUDE.md wajib: entry log + error log + usage counter per new user-facing feature — sweep semua modul, list gap |
| **Idempotency** | 4 RPC di-verify retry-safe: receive_purchase_order, commit_opname, record_pembayaran + async job claim |

### T6 — Backend Go (0 test coverage saat ini — high risk)

| Package | Fokus test |
|---|---|
| `api/` | approval_webhook (+ existing test), context_middleware, csp_report_handler, rate_limit_middleware (+ test), security_headers_middleware, version_middleware |
| `db/` | Split-pool: queryDB via txn pooler (:6543), listenDB direct (:5432). Verify prepared-stmt fix (memory Bug E), connection saturation di rolling deploy |
| `jobs/` | worker + handlers + smoke_test — claim, retry, DLQ, deadline |
| `followup/` | poller — failed_attempts tracking (mig 330) |
| `scheduler/` | timeout handling |
| `heartbeat/` | /api/v1/live + /api/v1/ready — 200 OK, response shape |
| `gemini/` + `llm/` + `clip/` | Calista prompt multi-tenant (memory `calista_tenant_identity_env`), tenant identity via env var, no cross-tenant leak |
| `recon/` | classifier, closer, engine, matcher, name_similarity, special_cash, special_edc, special_internal — PDF parse → journal match accuracy |
| `rules/` + `engine/` + `approvals/` | Business rule engine — verify rule evaluation, approval routing |
| `assets/` + `storage/` | Asset serving, storage bucket access via signed URL |
| `sentryutil/` | Error capture wired |
| `logging/` | Structured slog (memory `wa_test_data_noise` — slog.String not slog.Any for errors) |
| `models/` | Data model validation |
| `whatsapp/` | **SKIP** — sudah ditest Terminal 26 |

### T7 — Admin platform (founder-facing, can skip if overrun)

| Cluster | Sub-items |
|---|---|
| **Admin shell** | AdminHome, AdminLayout, AdminSidebar, AdminRoutes, AdminRouteGuard, EmptyHomeState, KPICard |
| **Tenant management** | TenantsList, TenantsTable, TenantWizard (create), TenantDetail (Audit/Users/Overview/Pembayaran/ModuleToggle/DangerZone tabs), DeleteTenantModal, SuspendTenantModal, RenewSubscriptionModal |
| **Revenue analytics** | AdminRevenue, RevenueKPIRow, RevenueMonthlyTrend, RevenuePlanBreakdown, RevenueTopTenants |
| **Ops workflow** | AttentionQueue, AuditLogViewer, AuditTable, CoverageStatusBadge |
| **Billing verification** | PendingPaymentsQueue, PendingPaymentRow, PaymentInstructionBlock, RejectPaymentModal |
| **Sales reps management** | SalesRepsList, SalesRepCreateModal, SalesRepDeactivateModal |
| **Cost dashboard** | CostDashboard (per-tenant $ tracking) |

---

## 3. Scenario categories & matrix per tier

### Categories (12 functional + 5 non-functional)

**Functional:**

| # | Category | Contoh |
|---|---|---|
| F1 | Positive (happy path) | Login sukses, PO sukses submit |
| F2 | Input validation | Missing required, wrong type, XSS `<script>`, SQL escape `'`, panjang string >MAX |
| F3 | Character encoding | Nama unicode (`Toko Süß`), emoji (`Product 🚀`), apostrophe (`O'Brien`) |
| F4 | State/lifecycle | Cancel PO yang sudah PAID, edit invoice yang sudah locked, submit form 2x |
| F5 | Concurrency/race | 2 user edit stok sama, double-click submit, stale token retry |
| F6 | Boundary/numeric | 0, negative, MAX_INT, decimal 4-place, tax rounding IDR (0 desimal) |
| F7 | Empty state | 0 record, first-time-user, empty search |
| F8 | Loading state | Spinner, skeleton, slow network 3G throttle |
| F9 | Error state | 500 server, network drop, RPC error mapped, DB constraint 42501/23xxx |
| F10 | Permission/auth | No role, expired session, wrong tenant, direct URL bypass, admin bypass |
| F11 | Multi-tenant isolation | Tenant A baca/tulis tenant B via URL param, direct API call, realtime subscription |
| F12 | Data integrity | Atomic tx, rollback pada partial fail, orphan setelah parent delete, cascade rules |

**Non-functional (cross-cutting):**

| # | Category | Cek |
|---|---|---|
| N1 | Accessibility | Keyboard nav (Tab+Enter), focus trap di modal, ARIA labels, contrast WCAG AA |
| N2 | Responsive | Mobile 375px (iPhone SE), tablet 768px (iPad), desktop 1440px |
| N3 | Observability | Entry log + error log + usage counter present per CLAUDE.md |
| N4 | Idempotency | Retry safe, natural unique key, tidak duplicate |
| N5 | Regression | Nearby flows tidak broken (grep + test call sites) |

**Security-specific untuk write path:**
- S1: SECDEF smoke test (fake `auth.uid` + `RAISE EXCEPTION`) — memory `smoke_test_security_definer_rpcs`
- S2: CHECK constraint enumeration sebelum modify — memory `check_constraints_before_rpc_rewrite`
- S3: RLS predicate hit indexed column (EXPLAIN ANALYZE)
- S4: Sensitive field masking di log (PII scrub verified)

### Matrix per tier (which categories apply)

| Tier | Functional | Non-functional | Security |
|---|---|---|---|
| **T0 Auth/Foundation** | F1, F2, F4, F9, F10, F11 | N1, N2, N3 | S1, S4 |
| **T0 Billing/Grace** | F1, F4, F8, F9 | N3 | — |
| **T0 Admin impersonation** | F1, F4, F10, F11 | N3 | S1, S4 (audit entry) |
| **T0 User Mgmt/Permission** | F1, F2, F4, F10, F11 | N1, N3 | S1, S2 |
| **T0 Pengaturan panels** | F1, F2, F4, F9, F10 | N1, N2, N3 | S1 |
| **T1 Master data** | F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12 | N1, N2, N3, N4 | S1, S2, S3 |
| **T2 Core txns** | **ALL 12** | N1, N2, N3, N4, N5 | S1, S2, S3, S4 |
| **T3 Financial** | F1, F2, F5, F6 (**critical**), F9, F11, F12 | N3, N4 | S1, S2, S3 |
| **T4 Approval/Workflow** | F1, F2, F4, F10, F11 | N1, N3 | S1 |
| **T5 Cross-cutting** | Applied per feature (PDF: F1+F3+F6; upload: F1+F9+F11) | N3 | S3, S4 |
| **T6 Backend Go** | F1, F2, F5 (concurrency crit), F9, F12 | N3, N4 | S1, S4 |
| **T7 Admin** | F1, F10, F11 (admin bypass RLS but audit), F12 (delete cascade) | N1, N3 | S1, S4 |

**"ALL 12" untuk T2** karena core txn = revenue/inventory/money. Miss satu = tenant komplain.

---

## 4. 7-day daily schedule

**Freeze period:** 2026-07-20 (Senin) → 2026-07-26 (Minggu). No feature work — hanya QA + fix.

**Waktu daily:** ~8 jam efektif (deep work). Sisanya buffer + shipping.

### Day 1 — Setup + scenario matrix authoring (2026-07-20)

**Morning (4h):**
- Setup 2 QA tenants di prod: "QA Tenant A" + "QA Tenant B" (via TenantWizard)
- Seed data: masing-masing 20 produk, 5 kategori, 3 supplier, 5 pelanggan, 3 warehouse (varying), 3 kas/bank account (BANK+KAS+E_WALLET)
- Playwright config sanity check + fixtures multi-tenant (login helper per tenant)
- Bug tracker directory: `docs/qa-week/YYYY-MM-DD/` — per-day bug reports
- Baseline `mcp__plugin_supabase_supabase__get_advisors` snapshot

**Afternoon (4h):**
- Author detailed scenario matrix per module → `docs/qa-week/scenarios/T{N}-<cluster>.md`
- Structure per scenario: preconditions, steps, expected, category tag (F1-F12/N1-N5/S1-S4)
- Estimate: ~15-25 scenarios per major cluster, ~5-10 per minor → ~500-700 total
- Prioritize scenarios by risk (auth/isolation first)

**Deliverable Day 1:**
- 2 QA tenants live + seeded
- Scenario matrix files complete (all T0-T7 clusters)
- Day 1 report: setup log, gotchas, baseline advisors output

### Day 2 — T0 Foundation execution (2026-07-21)

- Auth flow (all error screens)
- Multi-tenant isolation quick sweep (deep sweep Day 6)
- Billing/Grace/Readonly transition testing
- Admin impersonation (verify audit log entry per session)
- User Management + role/permission matrix
- Pengaturan foundational (11 panel)
- Rate limit enforcement (burst → 429 → recovery)

**Bug workflow:** trivial fixes same-day. Shared-code queued to `docs/qa-week/2026-07-21/day2-bugs-shared.md`.

**Ship & verify:** Stage 1 (lint/audit/vitest) per fix. Stage 2/3 batched EOD kalau ada FE/BE deploy.

### Day 3 — T1 Master data + T5 PDF/upload (2026-07-22)

- Produk (form, bulk upload, bulk grosir, catalog views)
- Stok inti + Stock Opname + Damage + Adjustment + PriceChangeReq
- Manajemen Gudang
- Pelanggan
- Kas & Bank
- PDF generation (6 PDF, IDR format, unicode)
- File upload (4 path: product-photos, chat-media, payment proof, bank statement)

### Day 4 — T2 Core transactions (part 1: Pembelian) (2026-07-23)

- PO → Receive → Tagihan → Bayar chain (dengan idempotency verify)
- BNL sub-flow (10 komponen)
- Tukar Faktur (kalau time allows — optional per memory)
- Klaim Supplier
- Discount system (cross-cutting)

### Day 5 — T2 Core transactions (part 2: Penjualan) + T3 Financial (2026-07-24)

**Morning:**
- Kasir POS + composite PK kasir_transactions validation
- Wizard + Invoice + Quotation
- Warehouse Transfer (2-step)
- Sales pipeline external + Owner Decision Inbox

**Afternoon:**
- Akuntansi GL + Manual Journal + Opening Balance
- Laporan (Neraca, P&L, Laba Rugi + sub-reports)
- Piutang (WriteOff/Revert)
- Rekonsiliasi wizard

### Day 6 — Shared-code batch fix + multi-tenant deep sweep + T6 Backend (2026-07-25)

**Morning (batch fix):**
- Review `docs/qa-week/*/day*-bugs-shared.md` (cumulative)
- Group by category (RLS gaps, missing empty states, PDF layout issues, etc.)
- Batch-fix by category — one consolidated migration if DB-side
- Verify cross-module ripple (retest downstream flows after each batch)
- `mcp__plugin_supabase_supabase__get_advisors` after each migration

**Afternoon (multi-tenant deep sweep):**
- Login tenant A, note tenant_id
- Systematically attempt cross-tenant access via URL manipulation (change tenant_id in URL, direct API call with tenant A JWT but tenant B data)
- Verify realtime subscription filters
- Verify storage bucket paths tenant-scoped
- Verify SECDEF RPCs don't leak (fake auth.uid pattern)
- Verify admin impersonation properly logged
- Backend Go: split-pool health, worker jobs, heartbeat, followup, scheduler

### Day 7 — T4 Approval + T7 Admin + regression + sign-off (2026-07-26)

**Morning:**
- Approval (3 types + OwnerPinPad)
- Notification Settings (non-WA)
- Promo/Diskon
- Dashboard sub-cards
- Admin platform (kalau tidak overrun)

**Afternoon (regression + sign-off):**
- Full E2E regression: run all Playwright specs from Day 1
- Manual re-verify golden path per T0-T4 module (5-10 min per module)
- Final `get_advisors` sweep
- **Sign-off checklist** (Section 7)
- Write `docs/qa-week/final-report.md` (summary + backlog + follow-ups)
- Commit + `progress.md` updated

**Ship & verify Stage 3 (prod smoke on Toko Jaya Makmur)** at end of each day for deployed changes.

---

## 5. Tooling & test tenant setup

### Tooling stack

| Tool | Purpose | Where |
|---|---|---|
| **Playwright** | E2E untuk critical flows (~15 spec) | `tests/e2e/tests/qa-week/` (new folder) |
| **chrome-devtools MCP** | Manual sweep — click through, screenshot, console/network monitor | Interactive per module |
| **SQL smoke test pattern** | Fake `auth.uid` + `RAISE EXCEPTION` — memory `smoke_test_security_definer_rpcs` | `tests/sql/qa-week/` |
| **get_advisors** (Supabase MCP) | Post-migration perf/security findings | After every migration in Day 6 batch |
| **vitest** | Component + unit test additions | `src/**/*.test.tsx` |
| **Go test** | Backend Go — where 0 today | `backend-go/internal/**/*_test.go` |
| **Bruno/curl** | Direct API call untuk multi-tenant isolation attempts | Ad-hoc |
| **Lighthouse** (via chrome-devtools MCP) | a11y + perf per critical screen | Sample at Day 6 |

### QA tenant setup (Day 1 morning)

**QA Tenant A** — Warung-style profile:
- Nama: "QA Warung Sinar (A)"
- Owner: qa-warung-a@caleo.id
- Modul aktif: dashboard, kasir, produk, pelanggan, pembelian dasar
- Modul off: advanced (BNL, Tukar Faktur, warehouse transfer)
- 1 warehouse, 3 kas/bank account
- Seed: 20 produk, 5 pelanggan, 3 supplier

**QA Tenant B** — Toko/Distributor-style profile:
- Nama: "QA Distributor Meta (B)"
- Owner: qa-distributor-b@caleo.id
- Modul aktif: ALL (termasuk BNL, Tukar Faktur, warehouse transfer, sales pipeline)
- 3 warehouse, 5 kas/bank account
- Seed: 50 produk, 10 pelanggan, 5 supplier, 3 sales rep

**Toko Jaya Makmur** — existing prod-testing tenant, unchanged. Untuk existing-data scenarios + Stage 3 smoke.

**Post-QA cleanup:** Day 8+, delete QA Tenant A + B via `DeleteTenantModal`. Verify cascade (all tenant data gone).

### Bug tracker format

Structure: `docs/qa-week/YYYY-MM-DD/`
- `day{N}-bugs-fixed.md` — trivial fixes done same-day
- `day{N}-bugs-shared.md` — shared-code, queued for Day 6 batch
- `day{N}-architectural-findings.md` — flagged, wait for founder approval
- `day{N}-verify-notes.md` — verified working, no issues

Bug entry template:
```md
### #<seq> [P0/P1/P2/P3] <one-line>
- **Module:** T2 Pembelian → Receive Goods
- **Category:** F4 (state) — attempt receive on already-received PO succeeds
- **Repro:** 1) create PO qty 10 2) receive 10 3) receive again 5
- **Expected:** RPC error 23xxx
- **Actual:** succeeds, inventory qty=15
- **Root cause:** (filled after diagnosis)
- **Fix:** (link commit or "queued")
- **Regression test:** (path or "none")
```

### Severity taxonomy

| Severity | Definition | Action |
|---|---|---|
| **P0 Blocker** | Data corruption, cross-tenant leak, money math wrong, security bypass, unrecoverable state | Fix immediately, hotfix same-day, freeze other work |
| **P1 Major** | Feature broken for common use case, workflow blocker, RLS gap, wrong tax calc | Fix same-day if local, batch Day 6 if shared |
| **P2 Minor** | Edge case broken, UI state missing (empty/loading/error), a11y gap | Batch Day 6, must-close before onboard |
| **P3 Cosmetic** | Label typo, color contrast weak (AA passes), minor UX polish | Backlog, doesn't block onboarding |

### CLAUDE.md gates per fix (Stage 1 mandatory)

Before every commit:
- `npm run lint`
- `npm run audit:numinput`
- `npm run audit:secdef-null-tenant`
- `npx vitest run --changed`

For SQL migration: claim slot dari memory `migration_slot_allocation` (kita mau di 100+ range). Verify idempotency (DROP IF EXISTS, CREATE IF NOT EXISTS, guarded backfills). Run `get_advisors` after apply.

For deploy (Stage 2/3):
- Push → `gcloud builds list --limit=2` verify STATUS != FAILURE (memory `deploy_verify_after_push`)
- Chrome-devtools MCP re-verify on Toko Jaya Makmur (Stage 3, prod-testing tenant per memory `production-testing-tenant`)

---

## 6. Bug workflow & hotfix policy

### Hybrid model (confirmed with founder)

| Bug type | Definition | When to fix |
|---|---|---|
| **Trivial + local** | Single-file UI (typo, missing state, hardcoded IDR format, empty state, contrast, ARIA label). Zero blast radius. | Same-day. Push through Stage 1-3. |
| **Shared code** | RPC dipakai >1 screen, komponen shared (`<CustomerPicker>`, `<StockPicker>`), RLS policy, migration | Catalogue Day 2-5 → batch-fix Day 6 by category → verify cross-module ripple |
| **Architectural** | Redesign RLS, ubah PK shape, cost upgrade, contract change ke client, migration >1000 rows, financial-impact change | **STOP** — Flag di `day{N}-architectural-findings.md`, invoke `advisor()`, tunggu approval founder |
| **Blocker cascade** | Bug di modul upstream blocks downstream testing (e.g., Receive broken → can't test Tagihan) | Fix same-day (kalau local) or mock/hardcode data (kalau butuh migration) supaya downstream jalan |

### Escalation criteria

Auto-escalate ke founder approval (invoke `advisor()` first):
- Diff >100 lines OR touching >3 files (per CLAUDE.md)
- RLS/SECDEF policy change
- Migration touching >1000 rows OR carrying data
- Financial-impact (billing, pricing, tax calc, ledger)
- Cost upgrade (new paid tier, larger instance)
- "Final fix" claim untuk class-problem

### Fix verification (mandatory)

Every fix — trivial atau shared — harus:
1. Stage 1 gates green
2. Regression test added (bug that had no test → now has a test)
3. Impact analysis: `grep -rn` on modified function/symbol, list call sites, verify
4. `progress.md` line: root cause + fix summary
5. If shared code: retest ALL call sites in chrome-devtools MCP
6. If SECDEF/RLS: fake auth.uid smoke test

### Multi-tenant isolation bug — SPECIAL

Any cross-tenant leak = **automatic P0**. Response protocol:
1. **Reproduce** with 2 tenants, screenshot the leak
2. **Isolate** — is it RLS gap, SECDEF gap, missing tenant_id filter di WHERE clause, subscription filter?
3. **Fix** — RLS policy per T0 memory `guard_expiry_write_broken_predicate` (SECDEF RPC route)
4. **Verify** — 5-tenant matrix test (A→B, A→C, B→A, etc.) — expand beyond 2 QA tenants if needed
5. **Regression test** — SQL smoke test with fake auth.uid + attempted cross-tenant access
6. **Advisor()** — irreversible RLS change requires advisor gate
7. **Document** — memo di `docs/superpowers/specs/` if pattern (not one-off)

---

## 7. Success criteria & sign-off

### Quantitative

- **0 P0 open** (any P0 during week = must fix before sign-off)
- **0 P1 open** (all must fix or downgrade dengan explicit justification)
- **P2 documented** — semua tercatat di `docs/qa-week/final-report.md`, dengan owner + timeline
- **P3 backlog** — logged, no time pressure
- **Multi-tenant isolation: 0 cross-tenant leak** (across A↔B↔TokoJaya matrix)
- **Coverage:** all T0-T4 module cluster ke-cover (T5 cross-cutting per feature, T6 backend, T7 admin — nice-to-have)
- **Scenario coverage:** all functional F1-F12 executed per applicable module (target 90%+ pass, failure documented)
- **Regression suite:** all existing 112 vitest + 5 Playwright + 15 new Playwright QA-week specs green

### Qualitative

- **UI/UX konsisten** — design system ditaati (font sizing per memory, no ad-hoc styles)
- **Observability** — per CLAUDE.md, sweep gap: setiap feature user-facing punya entry log + error log + usage counter
- **Idempotency verified** — 4 critical RPC (receive_purchase_order, commit_opname, record_pembayaran, claim_next_job) retry-safe
- **`get_advisors` bersih** — final sweep Day 7 no new perf/security findings post-fix
- **Docs updated** — every fix touching shared code = memory update jika behavior change

### Sign-off checklist (Day 7)

- [ ] All P0/P1 closed atau explicitly downgraded dengan justification
- [ ] Multi-tenant deep sweep: 0 cross-tenant leak
- [ ] Regression suite green (vitest + Playwright)
- [ ] `get_advisors` final sweep clean
- [ ] `docs/qa-week/final-report.md` written
- [ ] `progress.md` updated
- [ ] 2 QA tenants deletion planned (Day 8+, verify cascade)
- [ ] Onboarding runbook (`docs/tenant-onboarding-runbook.md`) revisited — any gap discovered → documented
- [ ] Memory prune — any stale memory referencing outdated behavior updated
- [ ] Rollback rehearsal (per CLAUDE.md quarterly rhythm) — if 3 months elapsed sejak last, run drill

**Sign-off = founder explicit approval on final report.** Not autonomous.

---

## 8. Deliverables

Committed to git by Day 7:

1. `docs/superpowers/specs/2026-07-19-qa-week-comprehensive-design.md` (this doc)
2. `docs/superpowers/plans/2026-07-19-qa-week-plan.md` (writing-plans output — daily concrete tasks)
3. `docs/qa-week/scenarios/T*-<cluster>.md` — scenario matrix per module (500-700 scenarios total)
4. `docs/qa-week/2026-07-{20..26}/` — daily bug reports (fixed/shared/architectural/verify)
5. `docs/qa-week/final-report.md` — sign-off summary
6. `tests/e2e/tests/qa-week/*.spec.ts` — ~15 new Playwright E2E specs
7. `tests/sql/qa-week/*.sql` — SQL smoke test files
8. Backend Go tests — new `*_test.go` where gap identified
9. Memory updates — stale memories refreshed, new memories from discoveries
10. Commit trail — every fix labeled `[qa-week]` in commit message for later audit

---

## 9. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **7 days terlalu pendek untuk full coverage** | High | Medium | Priority ordering; skip T7 → T4 promo → T3 piutang advanced if overrun. T0-T3 core wajib. |
| **Bug discovery cascade** — one bug blocks 3 downstream flows | Med | High | Blocker cascade rule: fix same-day (local) or mock/hardcode data. Never leave downstream un-testable. |
| **Multi-tenant leak turns out systemic** | Low | Critical | Halt other testing, dedicate to fix, invoke `advisor()`. Founder gate before merge. |
| **Architectural finding — irreversible** | Med | High | Do NOT autonomous fix. Flag → memo → advisor → founder. Backlog for post-week. |
| **QA tenant seed data doesn't cover edge cases** | Med | Med | Augment seed as discoveries emerge. Not upfront-perfect. |
| **Backend Go 0 test coverage — writing tests eats time** | High | Med | Focus tests on critical packages (jobs, recon, db split-pool). Skip low-risk (assets, logging). |
| **Prod deploy fails during hotfix** | Low | High | Per memory `deploy_verify_after_push`: `gcloud builds list --limit=2` after every push, verify STATUS != FAILURE before treating as shipped. |
| **PDF layout regressions across 6 PDFs** | Med | Low | Sample generation with edge data (long product names, many rows), visual diff manually. |
| **Overrun ends Day 7 with P1 unaddressed** | Med | High | Priority triage Day 6 morning — if P1 count > 5, communicate ke founder + downgrade or defer onboarding |

---

## 10. Post-QA follow-ups (backlog seeded now)

Anticipated items that will spill past week (write to backlog, don't attempt in-week):

- Backend Go pgx migration (lib/pq → pgx with simple_protocol) — memory Bug E follow-up
- Calista prompt multi-tenant full refactor (Phase 3, memory `calista_prompt_multitenant`)
- Task 13 cold-start/load test (deferred per progress.md)
- Feature-flag migration (currently `tenant_settings.modul_*` — good enough at 3-5 tenants)
- CSP enforce flip (24h clean observation window)
- Sentry alert tuning (default rules → tenant-aware)
- Rollback rehearsal calendar (quarterly per CLAUDE.md)
- Onboarding runbook automation (`docs/tenant-onboarding-runbook.md` — script tenant creation)

---

## 11. Advisor gate

Per CLAUDE.md, invoke `advisor()` before executing this plan if:
- Diff estimate >100 lines OR touching >3 files ✓ (very likely across 7 days)
- RLS/SECDEF policy changes anticipated ✓
- Migration touching >1000 rows anticipated (audit_log cleanup?) — possible
- Financial-impact fix anticipated (tax calc, ledger balance) — possible

**Recommendation:** invoke `advisor()` at start of Day 1 (before executing) AND at end of Day 6 (before batch fix goes to prod).

---

## Appendix A — Files/dirs referenced

- `src/App.tsx` — 29 routes enumerated
- `src/components/` — 40+ major clusters
- `src/lib/` — 15+ service folders
- `backend-go/internal/` — 19 packages
- `supabase/migrations/` — 435 files (as of 2026-07-19)
- `docs/qa-week/` — new folder created Day 1
- `tests/e2e/tests/qa-week/` — new folder created Day 1

## Appendix B — Memory references (must read before Day 1)

Auth/RLS:
- `guard_expiry_write_broken_predicate`
- `secdef_returning_gap`
- `phase_a_secdef_authenticated_gap`

DB:
- `check_constraints_before_rpc_rewrite`
- `smoke_test_security_definer_rpcs`
- `migration_slot_allocation` (claim 100+ range for QA week)
- `all_buckets_tenant_scoped`

Multi-tenant:
- `calista_tenant_identity_env`
- `custom_domain_live`

Ops:
- `deploy_verify_after_push`
- `parallel_terminals_worktree`
- `production-testing-tenant` (Toko Jaya Makmur)
- `sentry_setup`

Feedback:
- `no_wa_owner_approval` (skip WA button verification)
- `push_back_dont_follow` (surface tradeoffs actively)
- `no_fake_numbers` (no assumed metrics)
- `font_sizing` (UI base 13-14px, PDF 11-12px)
