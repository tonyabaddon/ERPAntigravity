# G2 — Reports & Analytics Design

**Date:** 2026-06-03  
**Status:** Approved — ready for implementation

---

## Overview

Add a dedicated **Laporan** (Reports) screen and fix the Dashboard's hardcoded chart data. Admins currently see fake static bars in the Dashboard every day, which undermines trust. The Laporan screen provides period-based analysis (revenue trend, top products, AI vs manual conversion) with a simple preset picker.

**Tech Stack:** React + TypeScript, Tailwind CSS, Recharts (already installed), existing Supabase tables (`orders`, `conversations`). No backend changes.  
**Build check:** `npm run build` must pass with zero TypeScript errors after each task.  
**Do NOT touch:** `backend-go/`, any `.sql` migration files, `src/hooks/useRealtimeConversations.ts`.

---

## Architecture

### Modified files
- `src/types.ts` — add `'laporan'` to `ActivePage`
- `src/lib/supabaseClient.ts` — add `reportsService` (4 methods) + add 2 methods to `statsService` for Dashboard chart fix
- `src/components/DashboardScreen.tsx` — replace hardcoded arrays with real data; remove `WEEKLY_REVENUE_DATA` and `BOT_PERFORMANCE_DATA` constants
- `src/components/LaporanScreen.tsx` — **new file**, full reports screen
- `src/components/Sidebar.tsx` — add Laporan nav item (BarChart2 icon, between Dashboard and Sales Inbox)
- `src/App.tsx` — add `'laporan'` route case

No new hooks, no new types beyond `ActivePage`.

---

## Data Strategy

All data is fetched client-side by querying Supabase and aggregating in JavaScript. The business is small (tens of orders per day), so fetching all rows in a period and grouping in JS is simpler and faster to build than Postgres aggregation.

### Period presets

```typescript
type Period = '7d' | '30d' | '90d';

function periodStart(p: Period): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (p === '7d' ? 6 : p === '30d' ? 29 : 89));
  return d.toISOString();
}
```

### Day label for charts

```typescript
function dayLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}
```

---

## New service methods

### `statsService.fetchWeeklyRevenue()` (Dashboard fix)

Replaces `WEEKLY_REVENUE_DATA`. Fetches last 7 days of `PAYMENT_VERIFIED` orders and groups by day.

```typescript
async fetchWeeklyRevenue(): Promise<Array<{ Day: string; Revenue: number; Orders: number }>> {
  if (!supabase) return [];
  const since = periodStart('7d');
  const { data } = await supabase
    .from('orders')
    .select('total, created_at')
    .eq('status', 'PAYMENT_VERIFIED')
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  return groupByDay(data ?? [], 7).map(({ label, rows }) => ({
    Day: label,
    Revenue: rows.reduce((s, r) => s + (r.total ?? 0), 0),
    Orders: rows.length,
  }));
}
```

### `statsService.fetchWeeklyConversations()` (Dashboard fix)

Replaces `BOT_PERFORMANCE_DATA`. Fetches last 7 days of conversations and groups by day + ai_active.

```typescript
async fetchWeeklyConversations(): Promise<Array<{ Day: string; 'Dijawab AI': number; 'Respon Manual': number }>> {
  if (!supabase) return [];
  const since = periodStart('7d');
  const { data } = await supabase
    .from('conversations')
    .select('ai_active, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  return groupByDay(data ?? [], 7).map(({ label, rows }) => ({
    Day: label,
    'Dijawab AI': rows.filter(r => r.ai_active).length,
    'Respon Manual': rows.filter(r => !r.ai_active).length,
  }));
}
```

### `reportsService` (Laporan screen)

Four methods, all accept `since: string` (ISO timestamp from `periodStart`).

```typescript
export const reportsService = {
  // KPI summary for the period
  async fetchSummary(since: string): Promise<{
    revenue: number; orderCount: number; avgOrderValue: number;
    convCount: number; aiConvCount: number;
  }>

  // Daily revenue+orders for area chart (same shape as WEEKLY_REVENUE_DATA)
  async fetchDailyRevenue(since: string, days: number): Promise<Array<{ Day: string; Revenue: number; Orders: number }>>

  // Daily AI vs manual for bar chart (same shape as BOT_PERFORMANCE_DATA)
  async fetchDailyConversations(since: string, days: number): Promise<Array<{ Day: string; 'Dijawab AI': number; 'Respon Manual': number }>>

  // Top 5 products by unit count, with revenue
  async fetchTopProducts(since: string): Promise<Array<{ name: string; qty: number; revenue: number }>>
}
```

### `groupByDay` helper (internal to supabaseClient)

Used by all methods above. Not exported.

```typescript
function groupByDay<T extends { created_at: string }>(
  rows: T[],
  days: number
): Array<{ label: string; rows: T[] }> {
  const buckets: Record<string, T[]> = {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets[key] = [];
  }
  for (const row of rows) {
    const key = row.created_at.slice(0, 10);
    if (key in buckets) buckets[key].push(row);
  }
  return Object.entries(buckets).map(([key, rows]) => ({
    label: new Date(key + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
    rows,
  }));
}
```

**`fetchTopProducts` implementation detail:** Fetch all `PAYMENT_VERIFIED` orders in the period, select `items` (JSON array). Flatten `items` arrays, group by `item.name`, sum `item.qty` and `item.subtotal`. Return top 5 sorted by `qty` descending.

---

## Dashboard Fix

### Changes to `DashboardScreen.tsx`

1. Remove `WEEKLY_REVENUE_DATA` and `BOT_PERFORMANCE_DATA` constants.
2. Add state:
   ```typescript
   const [weeklyRevenue, setWeeklyRevenue] = useState<Array<{ Day: string; Revenue: number; Orders: number }>>([]);
   const [weeklyConvs, setWeeklyConvs] = useState<Array<{ Day: string; 'Dijawab AI': number; 'Respon Manual': number }>>([]);
   ```
3. Add useEffect that calls both methods on mount (same pattern as `fetchTodayStats`).
4. Pass `weeklyRevenue` to `AreaChart data={}` and `weeklyConvs` to `BarChart data={}`.
5. Chart JSX is otherwise **unchanged** — same Recharts components, same keys.

---

## Laporan Screen Layout

```
┌──────────────────────────────────────────────────────────┐
│  Laporan Performa     [7 hari] [30 hari] [90 hari]       │
├──────────────────────────────────────────────────────────┤
│  [Revenue]  [Orders]  [Avg Order]  [AI Rate]  ← 4 KPIs  │
├─────────────────────────┬────────────────────────────────┤
│  Tren Omset (area chart)│  Interaksi Chat (bar chart)    │
├──────────────────────────┴────────────────────────────────┤
│  Produk Terlaris (top 5 table)                           │
└──────────────────────────────────────────────────────────┘
```

Full-width page with `space-y-6 p-6` container.

### Header + period selector

```tsx
<div className="flex items-center justify-between">
  <div>
    <h2 className="text-[#012749] font-extrabold text-2xl tracking-tight">Laporan Performa</h2>
    <p className="text-xs text-gray-500 mt-0.5">Analisis pendapatan, pesanan, dan efisiensi AI</p>
  </div>
  <div className="flex gap-2">
    {(['7d', '30d', '90d'] as Period[]).map(p => (
      <button key={p} onClick={() => setPeriod(p)}
        className={`px-4 py-2 rounded-full text-xs font-bold ${
          period === p ? 'bg-[#012749] text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-[#012749]'
        }`}>
        {p === '7d' ? '7 Hari' : p === '30d' ? '30 Hari' : '90 Hari'}
      </button>
    ))}
  </div>
</div>
```

### 4 KPI cards

Same card style as Dashboard (`bg-white rounded-3xl p-6 border border-[#e5eeff] shadow-lg`), 4-column grid.

| # | Label | Value | Icon |
|---|-------|-------|------|
| 1 | Total Omset | `formatRupiah(summary.revenue)` | TrendingUp, blue |
| 2 | Pesanan Selesai | `summary.orderCount + ' Transaksi'` | ShoppingBag, emerald |
| 3 | Rata-rata Nilai Pesanan | `formatRupiah(summary.avgOrderValue)` | Receipt, amber |
| 4 | Tingkat Otomasi AI | `Math.round(summary.aiConvCount / Math.max(summary.convCount, 1) * 100) + '%'` | Zap, violet |

Show `'...'` / `'Memuat...'` while `summary === null`.

### Revenue trend chart

Same `AreaChart` + `Area` as Dashboard. Data from `fetchDailyRevenue`. Height `280px`.

### Chat chart

Same `BarChart` + two `Bar` as Dashboard. Data from `fetchDailyConversations`. Height `280px`.

### Top Products table

```tsx
<div className="bg-white rounded-3xl p-6 border border-[#e5eeff] shadow-xl">
  <h4 className="text-lg font-bold text-[#012749] mb-4">Produk Terlaris</h4>
  {topProducts.length === 0 ? (
    <p className="text-sm text-gray-400 italic">Belum ada data produk untuk periode ini.</p>
  ) : (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-gray-400 uppercase border-b">
          <th className="text-left pb-2 font-bold">#</th>
          <th className="text-left pb-2 font-bold">Produk</th>
          <th className="text-right pb-2 font-bold">Qty</th>
          <th className="text-right pb-2 font-bold">Revenue</th>
        </tr>
      </thead>
      <tbody>
        {topProducts.map((p, i) => (
          <tr key={i} className="border-b border-gray-50 hover:bg-[#f8f9ff]">
            <td className="py-2.5 text-gray-300 font-bold">{i + 1}</td>
            <td className="py-2.5 text-[#012749] font-semibold">{p.name}</td>
            <td className="py-2.5 text-right text-gray-600">{p.qty}</td>
            <td className="py-2.5 text-right font-bold text-[#2d8a4e]">{formatRupiah(p.revenue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )}
</div>
```

### Loading / empty / Supabase unconfigured states

| Condition | Behavior |
|-----------|----------|
| `loading === true` | KPI cards show `'...'`, charts render empty arrays (Recharts handles gracefully) |
| `!isSupabaseConfigured` | Yellow warning card at top of screen (same pattern as other screens) |
| Period returns no data | KPI cards show 0, charts empty, top products shows italic message |

---

## Sidebar Addition

Add between Dashboard and Sales Inbox:

```typescript
{
  id: 'laporan' as ActivePage,
  label: 'Laporan',
  icon: BarChart2,          // from lucide-react — add to Sidebar.tsx imports
  description: 'Analitik & Tren',
}
```

Import `BarChart2` from `lucide-react` in `Sidebar.tsx`.

---

## App.tsx Addition

```typescript
case 'laporan':
  return <LaporanScreen />;
```

`LaporanScreen` takes no props. Import from `'./components/LaporanScreen'`.

---

## Out of Scope

- Date range picker with calendar (period presets are sufficient)
- Export to CSV / PDF
- Period-over-period comparison (e.g., "vs last 30 days")
- Customer-level drill-down (handled in Pelanggan screen)
- Real-time updates on the Laporan screen (one-time load on mount + on period change)
