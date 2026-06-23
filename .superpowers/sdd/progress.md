# SDD Progress Ledger — Akuntansi Phase 0c

Plan: docs/superpowers/plans/2026-06-23-akuntansi-phase0c-hpp-pi-backfill.md
Branch: worktree-akuntansi-phase0c
Started: 2026-06-23

## Task 1 — DONE (2026-06-23)

**HPP extension to record_kasir_sale dual-write block.**

Migration: `supabase/migrations/20260724000001_phase0c_kasir_hpp_extension.sql`

Change: added `v_lines jsonb` to inner DECLARE; conditionally appends D 5-1100 / K 1-1510 lines when `v_kasir.hpp_total > 0`. Base 2-line JE unchanged when hpp=0 (back-compat).

Smoke tests: 3/3 PASS (rollback-via-RAISE pattern, zero data leakage):
- Test A: 4-line JE, balanced, hpp>0 ✓
- Test B: 2-line JE when hpp=0 ✓
- Test C: 0 JEs when flag=false ✓

Task 1: complete (commits 0e65277..0e9f6f2, 3/3 smoke PASS, HPP critical fix deployed)

## Task 2 — DONE (2026-06-23)

**record_pi dual-write: D 1-1510 Persediaan / K 2-1100 Hutang Usaha.**

Migration: `supabase/migrations/20260724000002_phase0c_record_pi_dual_write.sql`

Changes: CREATE OR REPLACE record_pi (from 20260630000006 base) with two additions:
1. `v_purchase_date` captured before INSERT for correct JE date on backdated PIs
2. Soft-fail GL dual-write block before RETURN — fetches supplier name independently
   (BELUM_LUNAS path skips outer v_supplier_name), posts D 1-1510 / K 2-1100

Documented TODOs for Phase 1: PASSTHROUGH debit account branching; LUNAS payment-leg JE gap.

Smoke tests: 3/3 PASS (real writes, cleaned up after):
- Test A: JE-202607-0002, D 1-1510 / K 2-1100, 500,000 balanced, 0 anomalies ✓
- Test B: flag=OFF → 0 JEs ✓
- Test C: closed period (strict mode) → anomaly logged (period_closed), PI returned ✓

Task 2: complete (3/3 smoke PASS)
Task 2: complete (commits 0e9f6f2..8c41d99, 3/3 smoke PASS, record_pi dual-write deployed)

## Task 3 — DONE (2026-06-23)

**Historical backfill function + auto-execute.**

Migration: `supabase/migrations/20260724000003_phase0c_historical_backfill.sql`

Function `public._phase0c_backfill_historical()` loops 3 source tables with NOT EXISTS
idempotency guard, posts BACKFILL JEs, logs anomalies to gl_dual_write_anomalies (soft-fail).

**Actual results (applied 2026-06-23):**
- kasir_transactions (income): 69 posted, 2 anomalies (qris/edc — no default_bank configured)
- purchase_invoices: 5 posted, 31 anomalies (subtotal=0 test PIs — validator rejects zero-amount JEs)
- pembayaran: 4 posted (COALESCE→default_kas), 0 anomalies
- Total posted: 78 JEs; total anomalies: 33

**Smoke verification:**
- backfill_jes: 91 (78 new + 13 pre-existing test data)
- Trial Balance imbalance: 0.00 — BALANCED ✓
- total_jes: 93

Task 3: complete (TB balanced, 78 JEs posted, 33 anomalies logged for review)
Task 3: complete (commits 8c41d99..2e596af, 78 backfill JEs + TB balanced 0.00; 33 anomalies = data quality issues, non-blocking)

## Task 4 — DONE (2026-06-23)

**Pattern C integration tests: HPP + record_pi + backfill.**

Files: 
- `tests/integration/akuntansi-phase0c/_setup.ts` — service-role client + COA IDs
- `tests/integration/akuntansi-phase0c/kasir-hpp.test.ts` — HPP extension + 22-param signature verification
- `tests/integration/akuntansi-phase0c/record-pi.test.ts` — record_pi signature + PI_TAGIHAN source_type
- `tests/integration/akuntansi-phase0c/backfill.test.ts` — backfill function + anomalies table schema

**Test coverage (26/26 PASS):**
- Kasir-HPP tests (8): COA structure, 22-param signature, KASIR_SALE source_type, 4-line JE support
- Record-PI tests (9): COA structure, record_pi signature, PI_TAGIHAN source_type, purchase_invoices tracking
- Backfill tests (9): function deployment, BACKFILL source_type, anomalies table schema, trial balance structure

**Pattern C approach:**
- Structural + deployment verification (no Owner JWT happy-path execution)
- All queries work pre/post-backfill (conditional assertions for optional data)
- Role-gate + function existence verified via RPC signature tests
- Anomalies table accessible + schema complete

Task 4: complete (26/26 tests PASS, npx tsc clean, ready for deploy)
Task 4: complete (commits 2e596af..78317f6, 26/26 tests, branch verified)

## Task 5 — DONE (2026-06-23)

**close_sales_order RPC** — manual close to terminal CLOSED state.

Migration: `supabase/migrations/20260725000005_close_sales_order_rpc.sql`

Smoke: 3/3 PASS (happy path with reason, empty reason rejected, already-CLOSED rejected).

Task 5: complete (commit 3ff8739, review clean)

## Phase A complete — 5 backend migrations applied + reviewed.

## Task 6 — DONE (2026-06-23)

**types.ts updates** — DbSalesOrder interface + ActivePage += daftarPenawaran.

File: `src/types.ts`

tsc clean; 4800/4800 tests pass.

Task 6: complete (commit fb277f5, review clean)

## Task 7 — DONE (2026-06-23)

**salesOrderService wrappers + vitest coverage.**

Files: `src/lib/salesOrderService.ts` + `src/lib/salesOrderService.test.ts`

5 wrappers (create / fetchById / fetchAll / markConverted / close) with client-side XOR + non-empty guards.

Tests: 12/12 PASS; tsc clean.

Task 7: complete (commit 1b5f930, review clean)

## Task 8 — DONE (2026-06-23)

**insertNewProduct wrapper + vitest.**

Files: `src/lib/products/productWrappers.ts` + `src/lib/products/productWrappers.test.ts`

Validation: name + category trim non-empty; price finite > 0. Defaults: stock_atas=0, stock_bawah=0, status='aktif', unit='pcs'.

Tests: 6/6 PASS.

Task 8: complete (commit 3129264, review clean)

## Phase B complete — types + wrappers ready.

## Task 9 — DONE (2026-06-23)

**NewProductInlineForm + validator.**

Files: `src/lib/wizard/newProductValidation.ts` + `.test.ts` + `src/components/penjualan/wizard/NewProductInlineForm.tsx`

Tests: 7/7 validator PASS; tsc clean.

Task 9: complete (commit 99d6318, review clean)

## Task 10 — DONE (2026-06-23)

**Step2Items — wire up + Produk Baru inline form.**

File: `src/components/penjualan/wizard/Step2Items.tsx`

Changes: imported `NewProductInlineForm`; added `showNewProductForm` state + `existingCategories` derivation from `props.stocks`; added always-visible CTA below search results with copy adapting to active search query; conditional rendering of `NewProductInlineForm` on form open; on save calls `props.onAddItem(product)` + closes form.

tsc clean; 4825/4845 tests pass (20 pre-existing failures in diskon worktree, unrelated).

Task 10: complete (commit b48b482)

## Task 10 — DONE (2026-06-23)

**Step2Items wire-up + Produk Baru.**

File: `src/components/penjualan/wizard/Step2Items.tsx`

tsc clean; 4825/4845 (20 pre-existing failures in unrelated worktree).

Task 10: complete (commit b48b482, review clean)

## Task 11 — DONE (2026-06-23)

**Step3Payment mode='quote' branch.**

File: `src/components/penjualan/wizard/Step3Payment.tsx`

`renderInvoiceMode()` extracted verbatim; `renderQuoteMode()` new light layout (info banner + catatan + amber summary + amber Simpan).

Test: tsc clean; 4825/4845.

Task 11: complete (commits c676e1f + b6cc4d0, review clean)

## Phase C complete — wizard internal extensions ready.

## Task 12 — DONE (2026-06-23)

**CatatPenjualanWizard orchestrator integration — mode + fromSalesOrderId.**

File: `src/components/penjualan/CatatPenjualanWizard.tsx`

Two new props on `CatatPenjualanWizardProps`: `mode?: 'invoice' | 'quote'` and `fromSalesOrderId?: string`.
- Pre-fill effect: on mount with `fromSalesOrderId`, fetches SO and seeds channel/customer/cart/rakit/notes.
- Save dispatch: quote branch calls `createSalesOrder` → navigate to `daftarPenawaran`.
- All three invoice paths (TEMPO/WIP/standard) call `markSalesOrderConverted` when `fromSalesOrderId` present.
- Header h1: QUOTE MODE badge + title swap (Sales Order vs Sales Invoice).
- Step 3 subtitle updates for quote mode.
- `mode` prop passed to `<Step3Payment>`.
- Emerald pre-fill banner above stepper when `fromSalesOrderId` set.

tsc clean; 4825/4845 (20 pre-existing failures in diskon worktree, unrelated).
