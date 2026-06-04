# WIB Timezone Fix — Dashboard & Laporan Metrics Design

**Goal:** Fix all dashboard and laporan metrics that show zero despite real kasir/order data existing, by correcting client-side date calculations to use Asia/Jakarta (WIB, UTC+7) instead of UTC.

**Architecture:** Single shared helper function `wibDateString()` replaces all `setHours(0,0,0,0).toISOString().slice(0,10)` and `.slice(0,10)` date patterns in `supabaseClient.ts` and `LaporanScreen.tsx`. No DB changes required.

**Tech Stack:** TypeScript, Supabase JS client, `Intl.DateTimeFormat` (via `toLocaleDateString`)

---

## Root Cause

JavaScript's `setHours(0,0,0,0).toISOString()` converts midnight WIB to UTC, producing a date string that is one calendar day behind the actual WIB date. This causes:

1. **Exact date filter** (`eq('date', todayDate)`) on `kasir_transactions` returns 0 rows — the date string doesn't match.
2. **Weekly chart bucket lookup** drops all fetched rows — bucket keys are off by one day, so `key in buckets` never matches.

Conversations work because they use a `gte` range filter on `created_at` (timestamptz), which is forgiving of a small offset.

---

## Fix

### Helper function (add to `supabaseClient.ts`)

```typescript
function wibDateString(date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  // Returns 'YYYY-MM-DD' in WIB timezone — correct for kasir DATE column comparisons
}
```

### Changes in `src/lib/supabaseClient.ts`

| Location | Current | Fix |
|---|---|---|
| `periodStart()` | `d.setHours(0,0,0,0); return d.toISOString()` | `return wibDateString(d)` |
| `groupByDay()` bucket keys | `d.toISOString().slice(0,10)` | `wibDateString(d)` |
| `groupByDay()` row key | `row.created_at.slice(0,10)` | `wibDateString(new Date(row.created_at))` |
| `fetchTodayStats()` | `const todayDate = iso.slice(0,10)` | `const todayDate = wibDateString()` |
| `fetchWeeklyRevenueByChannel()` bucket keys | `d.toISOString().slice(0,10)` | `wibDateString(d)` |
| `fetchWeeklyRevenueByChannel()` row key | `o.created_at.slice(0,10)` | `wibDateString(new Date(o.created_at))` |
| `reportsService.fetchSummary()` | `sinceDate = since.slice(0,10)` | `sinceDate = since` (since is already WIB date after periodStart fix) |
| `reportsService.fetchDailyRevenueByChannel()` bucket keys | `d.toISOString().slice(0,10)` | `wibDateString(d)` |
| `reportsService.fetchDailyRevenueByChannel()` row key | `o.created_at.slice(0,10)` | `wibDateString(new Date(o.created_at))` |
| `reportsService.fetchChannelTotals()` | `sinceDate = since.slice(0,10)` | `sinceDate = since` |
| `reportsService.fetchTopProducts()` | `sinceDate = since.slice(0,10)` | `sinceDate = since` |

### Changes in `src/components/LaporanScreen.tsx`

| Location | Current | Fix |
|---|---|---|
| Local `periodStart()` | `d.setHours(0,0,0,0); return d.toISOString()` | return WIB date string using `toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })` |
| `sinceDate` derivation passed to reportsService | Not applicable — `since` is now already a WIB date string | No extra `.slice(0,10)` needed in service calls |

### No changes needed

- `fetchWeeklyConversations()` / `fetchDailyConversations()` — uses `gte('created_at', since)` range filter; off-by-hours doesn't drop rows
- `reportsService.fetchDailyRevenue()` — same, timestamptz range filter
- All other `created_at`-based range filters — WIB date string is valid for PostgreSQL `gte` on timestamptz

---

## Testing

After fix, with at least one kasir walk-in transaction for today WIB:
- Dashboard "Total Omset" shows non-zero value
- Dashboard "Pesanan Terproses" shows non-zero count
- Dashboard weekly chart shows bar for today
- Laporan 7d/30d/90d summary shows non-zero revenue
- Laporan "Revenue per Channel" chart shows bars
- Laporan "Produk Terlaris" shows products
