# Task 6 Report — Embed QtyTiersEditor into ProductForm + StockTableView

**Status:** DONE
**Date:** 2026-07-31

---

## What was done

### Step 1 — types.ts: add `qty_tiers` to `StockItem`
Added `qty_tiers?: StockQtyTier[]` to `StockItem` interface (line 102). This enables the
`StockTableView` (which uses `StockItem[]`) to carry tier data through from the fetch to
the modal. `StockQtyTier` is defined later in the same file; TypeScript interface resolution
is order-independent so this is fine.

### Step 2 — supabaseClient.ts: extend `stockService.fetchAll`
Changed `.select('*')` to `.select('*, qty_tiers:stock_qty_price_tiers(id, stock_sku, min_qty, price)')`.
PostgREST uses the FK `stock_sku REFERENCES stocks(sku)` (Task 1) to resolve the relation.
Alias `qty_tiers:` matches the `SupabaseStockItem.qty_tiers` field. Return type cast
unchanged (`SupabaseStockItem[]`).

### Step 3 — ProductForm.tsx: embed QtyTiersEditor
Imported `QtyTiersEditor` and added the embed below the extra-tier price inputs inside the
"Harga & Stok" card. Guard: `{initial?.sku && (...)}` skips rendering on the create-new
path (no SKU exists yet). Passes `initial.qty_tiers ?? []` as `initialTiers` and the current
`price` state as `basePrice`. `onSaved` is a no-op (parent refetches on its own save cycle).

### Step 4 — StockTableView.tsx: "Vol" button + modal
- Added `QtyTiersEditor` import.
- Added `onDataChanged?: () => void` optional prop.
- Added `editingVolSku: string | null` state initialized to `null`.
- Added "Vol" button in each row's action cluster (after "Edit", before "Transfer").
  Button shows tier count pill `(N)` in purple-600 when tiers exist.
- Wrapped return in `<>...</>` fragment to allow sibling modal outside `<section>`.
- Added `fixed inset-0 z-50` modal overlay that renders only when `editingVolSku !== null`
  and the item exists in `stockList`. Click-outside-to-close via backdrop onClick.
  `QtyTiersEditor.onSaved` closes modal and calls `onDataChanged?.()`.

### Step 5 — StockManagerScreen.tsx: pass `onDataChanged`
Both `activeTab === 'stok'` and `activeTab === 'tipis'` StockTableView instances receive
`onDataChanged={() => { void onStocksRefresh?.(); }}` to trigger parent refetch after a tier save.

---

## Stocks fetch method name

`stockService.fetchAll` (singular — service export is `stockService`, not `stocksService`).
Located in `src/lib/supabaseClient.ts` around line 1291.

---

## Stage 1 gate results

| Gate | Result |
|---|---|
| `npm run lint` (tsc --noEmit) | CLEAN |
| `npm run audit:numinput` | CLEAN |
| `npm run audit:secdef-null-tenant` | CLEAN — 492 migrations scanned |
| `npx vitest run src/components/produk/` | 36/36 passed |
| `npx vitest run --changed` | 704 passed / 2 skipped, 85 test files |

---

## Files touched

- `src/types.ts`
- `src/lib/supabaseClient.ts`
- `src/components/produk/ProductForm.tsx`
- `src/components/produk/StockTableView.tsx`
- `src/components/StockManagerScreen.tsx`

---

## Concerns

None. All tests pass, type check clean, lint clean.
