# Task 2J Report — FE State Coverage (3 Priority Screens)

Date: 2026-07-21  
Scope: Wave 3 partial — loading / empty / error states on PenjualanScreen, LaporanScreen, StockManagerScreen

---

## Summary

- **1 screen modified** (LaporanScreen.tsx)
- **2 screens unchanged** (PenjualanScreen, StockManagerScreen — rationale below)
- **1 test file added** (LaporanScreen.test.tsx)
- **9 tests** — all pass
- Lint clean, audit:numinput clean, audit:secdef-null-tenant clean, vitest --changed green

---

## Per-screen analysis

### 1. PenjualanScreen.tsx — NO CHANGES (correct as-is)

**Architecture:** Pure tab router. Zero data fetching. Delegates entirely to:
- `CatatPenjualanWizard` (Input Baru tab)  
- `OrderHistoryScreen` (Riwayat tab — which has loading/empty/error states already)

**Current states:**
- Loading: N/A — no fetch at this level
- Empty: `tabs.length === 0` → renders "Akses Penjualan terbatas." (covers permission-denied edge case)
- Error: N/A — no fetch at this level

**Decision:** Adding loading/error states here would require prop-drilling from App.tsx (out of scope), or would represent fake UI unconnected to real data fetching (violates `no_fake_numbers` memory). Children own their own states. No change warranted.

---

### 2. StockManagerScreen.tsx — NO CHANGES (correct as-is)

**Architecture:** `stockList` is a **prop** injected from App.tsx. The screen does not fetch product data itself. Its three own `useEffect`s are:
1. `listPendingApprovals()` — explicitly silent-catch, non-critical (only shows a count badge)
2. `fetchStoreSettings()` — explicitly silent-catch, affects only CSV filename
3. `tenantSettingsService.fetch()` — affects `showGrosir` column visibility

None of these drive the main product list view. Adding loading state here would mean scaffolding a state not connected to the actual data lifecycle.

**Decision:** No change. If `stockLoading` is needed it should be prop-drilled from App.tsx in a future task scoped to that.

---

### 3. LaporanScreen.tsx — CHANGES ADDED

**Gap identified:** `Promise.allSettled` resolves all 4 fetches, but only checked `allFailed` (all 4 failed). When `getPerformaSummaryWithDelta` failed alone, `perfSummary` was never set (stayed `null`), causing KPI cards to display "..." and "Memuat..." **indefinitely** — error disguised as loading. Similarly for `getProfitPerChannel` and `fetchDailyRevenueByChannel`.

**Previous state coverage:**
- Loading: ✅ `perfSummary === null` → KPI cards show `'...'`
- Empty: ✅ `topProducts.length === 0` → "Belum ada data produk"
- Empty: ✅ `profitPerChannel.length === 0` → "Belum ada data"
- Error: ❌ Per-widget error invisible; allFailed-only toast (never triggered in practice)

**Changes made (additive, no layout reflow):**

1. **State type change:** `perfSummary` → `PerformaSummaryWithDelta | null | false` (null=loading, false=error)
2. **State type change:** `profitPerChannel` → `ChannelProfitRow[] | false`
3. **New state:** `revenueChartError: boolean`
4. **useEffect:** When `perfRes` rejected → `setPerfSummary(false)`. When `profitRes` rejected → `setProfitPerChannel(false)`. When `revRes` rejected → `setRevenueChartError(true)`. Toast fires on `anyFailed` (lowered from `allFailed`).
5. **KPI grid:** When `perfSummary === false` → renders `role="alert"` red-50 error card instead of 4 KPI cards.
6. **Chart area:** When `revenueChartError` → renders centered error text instead of `<ResponsiveContainer>`.
7. **Profit channel list:** When `profitPerChannel === false` → renders `role="alert"` error text instead of list.

**States now covered:**
- Loading: ✅ `perfSummary === null` → "Memuat..." shown in KPI sub-text
- Empty: ✅ `profitPerChannel === []` → "Belum ada data"
- Empty: ✅ `topProducts === []` → "Belum ada data produk untuk periode ini"  
- Error: ✅ `perfSummary === false` → error alert card replaces KPI grid
- Error: ✅ `revenueChartError` → error message in chart area
- Error: ✅ `profitPerChannel === false` → error text in channel list

---

## Files modified

| File | Action |
|---|---|
| `src/components/LaporanScreen.tsx` | Modified — error state added for 3 widgets |
| `src/components/LaporanScreen.test.tsx` | Created — 9 tests covering loading/empty/error |

Total: 2 files

---

## Tests added

File: `src/components/LaporanScreen.test.tsx`

| Test | Coverage |
|---|---|
| loading: shows "Memuat..." in KPI sub-text | loading state |
| loading: shows "..." as KPI value placeholders | loading state |
| success: renders KPI values after successful fetch | success state |
| success: shows empty state for Produk Terlaris | empty state |
| success: shows "Belum ada data" for empty channel | empty state |
| error: shows KPI error alert when perfSummary fails | error state |
| error: shows chart error when revenueByChannel fails | error state |
| error: shows channel error when profitPerChannel fails | error state |
| error: calls showToast when any fetch fails | toast behavior |

**Total: 9 tests — all pass**

---

## Verification

```
npm run lint          → tsc --noEmit: CLEAN
npm run audit:numinput → CLEAN
npm run audit:secdef-null-tenant → CLEAN (461 migrations)
npx vitest run --changed → 9 passed (1 file)
```

---

## Commit SHA

`6b6740f` — feat(qa): add per-widget error states to LaporanScreen (Wave 3 2J)
