# Task 17 Report — Integration Tests + Regression Sweep

**Status: COMPLETE**
**Date: 2026-06-23**

---

## Files Added

| File | Tests |
|---|---|
| `tests/integration/diskon/_setup.ts` | (shared setup, no tests) |
| `tests/integration/diskon/kasir-wizard.test.ts` | 18 tests |
| `tests/integration/diskon/tagihan-pi.test.ts` | 13 tests |
| `tests/integration/diskon/toggle-bc.test.ts` | 12 tests |
| **Total** | **43 tests, 3 files** |

## Files Modified

- `progress.md` — Task 17 entry appended.

---

## Test Results

### Diskon integration suite (`npx vitest run tests/integration/diskon`)
```
Test Files  3 passed (3)
     Tests  43 passed (43)
```

### Full unit suite (`npm test`)
```
Test Files  51 passed (51)
     Tests  410 passed (410)   ← no regression
```

### Lint (`npm run lint`)
```
(clean — tsc --noEmit exits 0)
```

---

## Scenarios Covered

1. **Kasir Path B** (`kasir-wizard.test.ts`):
   - `record_kasir_sale` 25-param signature verified (3 new discount params exist).
   - 4 discount validation guards fire correctly: `DISCOUNT_TRIPLE_INVALID`, `MARKUP_NOT_ALLOWED`, `EXCESSIVE_LINE_DISCOUNT`, `DISCOUNT_EXCEEDS_SUBTOTAL`.
   - `kasir_transactions` schema: 3 new discount columns queryable.

2. **Wizard TEMPO** (`kasir-wizard.test.ts`):
   - `create_tempo_invoice` signature verified.
   - Same 4 validation guards fire.
   - `orders` schema: 3 new discount columns queryable.
   - COA 4-1900 Diskon Penjualan accessible.
   - `KASIR_SALE` journal entry source enum accessible.

3. **Tagihan PI** (`tagihan-pi.test.ts`):
   - `record_pi` signature verified (uses `payload` arg, not `p_payload`).
   - Same 4 validation guards fire.
   - `purchase_invoices` schema: 3 new discount columns.
   - `purchase_invoice_items` schema: 4 new columns (`master_unit_cost` + 3 discount).
   - COA 5-1900 Diskon Pembelian seeded + active + `CREDIT` normal_balance.
   - `PI_TAGIHAN` journal entry source enum accessible.

4. **Toggle backward-compat** (`toggle-bc.test.ts`):
   - `tenant_settings` has `modul_diskon_kasir`, `modul_diskon_penjualan`, `modul_diskon_tagihan`.
   - All 3 default TRUE (UI enabled on deploy).
   - `set_tenant_modul` deployed: fires `NOT_AUTHENTICATED` without auth (function present).
   - All 3 diskon keys accepted by whitelist.
   - Legacy RPC calls without discount params still work (backward-compat via DEFAULT values).

---

## Test Pattern

Follows Pattern C from `tests/integration/akuntansi-phase0c/_setup.ts`. Key difference: `_setup.ts` uses `dotenv` (`config as dotenvLoad`) instead of vite's `loadEnv` to avoid the Node 24 / esbuild TextEncoder invariant issue that breaks vite-based test files in this environment.

---

## PDF Visual Checks — DEFERRED (Manual Founder Smoke)

No headless rendering pipeline available in this environment. Founder should run `npm run dev` and verify:

1. **Kasir**: Create sale with discount → Struk PDF shows Diskon row (11-12px font per `feedback_font_sizing.md`).
2. **Wizard TEMPO**: Create TEMPO order with discount → `SalesInvoicePDF` shows Diskon row before TOTAL TAGIHAN.
3. **Tagihan PI**: Record PI with supplier discount → `TagihanDetailPage` shows Diskon Item column + order-level Diskon row in footer.

---

## Pre-existing Integration Failures (NOT caused by Task 17)

The full `npm run test:integration` suite shows 46 failing files (pre-existing). These are:
- Schema cache staleness: `tokped_order_no` column missing from PostgREST cache in several `sales-recording.test.ts` tests.
- Vite `loadEnv` + Node 24 esbuild TextEncoder issue: affects `akuntansi-phase0b/c/d` test files that use vite setup pattern.
- Data-dependent tests: sales_channel_settings row count, warehouse data.

The 3 diskon test files are in the **9 passing** test files (up from 6 before Task 17 added them).

---

## Ledger Entry

```
Task 17: complete (integration tests added; full 43-test suite PASS; unit 410/410; lint clean; PDF visual deferred manual founder smoke).
```

---

## Final Review Fixes (2026-06-23)

### Finding I-1: SalesInvoicePDF + InvoicePreviewScreen line-discount display

**Problem**: `SalesInvoicePDF.tsx` and `InvoicePreviewScreen.tsx` showed only order-level discount (Task 15), not per-line discounts. `Subtotal` was the DB net column — customer couldn't verify: Gross − Diskon = Total.

**Fix applied:**
- `SalesInvoicePDF.tsx` (InvoiceBody): Computed `grossSubtotal = sum(master_price_at_sale ?? unit_price × qty)`, `lineDiscount = sum(items[].discount_amount_rp)`, `orderDiscount = t.discount_amount_rp`. Displays gross Subtotal + single Diskon row = `lineDiscount + orderDiscount`. Smart label matches KasirInvoiceModal pattern (Diskon baris / Diskon Order / Diskon (baris + order) / Diskon (order X%)).
- `InvoicePreviewScreen.tsx` (mini-preview card): Mirrors same logic via IIFE; gross Subtotal + totalDiscount row.

**Math transparency**: Gross − totalDiscount = total_amount ✓ (same identity as KasirInvoiceModal).

**Files changed:**
- `src/components/penjualan/SalesInvoicePDF.tsx`
- `src/components/penjualan/InvoicePreviewScreen.tsx`

---

### Finding I-2: Live JE 4-1900 / 5-1900 verification gap

**Problem**: All 43 existing integration tests used Pattern C (signature/guard probes). No test verified that discounted transactions actually posted `journal_entry_lines` with 4-1900 / 5-1900.

**Fix applied:**
- Added `tests/integration/diskon/journal-lines.test.ts`.
- 5 auto-run structural tests: `journal_entries.source_ref_id` queryable for PI_TAGIHAN + KASIR_SALE, `journal_entry_lines` joins to `chart_of_accounts`, COA 4-1900 DEBIT + 5-1900 CREDIT normal_balance accessible.
- 2 happy-path tests (`.skip` with comment): `record_pi` 5-1900 JE + `record_kasir_sale` 4-1900 JE. Skipped because cleanup requires deleting `pesanan_items.qty_received_total` and `stock_levels` adjustments — risky on live DB. Founder removes `.skip` for manual pre-close verification.

**Decision**: `.skip` chosen per task guidance: "If cleanup is fragile, mark `.skip` with a clear comment — founder must run manual smoke before going live with monthly close."

**Test results**: 48 pass + 2 skip (was 43 pass). Unit suite 410/410. Lint clean.

---

## Commit SHAs

See `git log --oneline -3` after final review commits.

---

## Founder Smoke Checklist

Before merging worktree-diskon → main:
- [ ] `npm run dev` → Kasir → add item → drag Harga lower → confirm Diskon auto-fills.
- [ ] `npm run dev` → Kasir → save discounted sale → open struk PDF → confirm Diskon row visible (gross Subtotal + Diskon row = Total).
- [ ] `npm run dev` → Wizard TEMPO → add item with discount → proceed → confirm SalesInvoicePDF Diskon row.
- [ ] `npm run dev` → Tagihan → add PI with supplier discount → save → open detail → confirm Diskon row.
- [ ] `npm run dev` → Pengaturan → toggle modul_diskon_kasir OFF → Kasir → confirm discount UI hidden.
- [ ] `npm run dev` → Pengaturan → toggle modul_diskon_kasir ON → Kasir → confirm discount UI visible.
- [ ] Before monthly close: remove `.skip` from `journal-lines.test.ts`, run `npx vitest run tests/integration/diskon/journal-lines.test.ts`, verify JE lines land correctly, then re-add `.skip`.
