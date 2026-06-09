# WIB Timezone Fix — Dashboard & Laporan Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix dashboard and laporan metrics showing zero by correcting all client-side date calculations to use Asia/Jakarta (WIB, UTC+7) instead of UTC midnight.

**Architecture:** Add a single `wibDateString()` helper in `supabaseClient.ts` that uses the `Intl` API to return `YYYY-MM-DD` in WIB timezone. Replace all `setHours(0,0,0,0).toISOString().slice(0,10)` and bare `.slice(0,10)` date patterns with WIB-aware equivalents in two files. No database changes needed.

**Tech Stack:** TypeScript, Supabase JS client, `Intl.DateTimeFormat` (via `toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })`)

---

## File Structure

- Modify: `src/lib/supabaseClient.ts` — add `wibDateString` helper; fix `periodStart`, `groupByDay`, `fetchTodayStats`, `fetchWeeklyRevenueByChannel`, `fetchDailyRevenueByChannel`
- Modify: `src/components/LaporanScreen.tsx` — fix local `periodStart` function

---

### Task 1: Fix supabaseClient.ts — add helper + fix all date calculations

**Files:**
- Modify: `src/lib/supabaseClient.ts`

**Context:** There are 6 places in this file where dates are computed using UTC midnight instead of WIB. All are in the block starting around line 226 (`periodStart`, `groupByDay`, `fetchTodayStats`, `fetchWeeklyRevenueByChannel`, `fetchDailyRevenueByChannel`). The frontend has no unit test framework — verification is via `npm run build` and manual browser check.

- [ ] **Step 1: Add `wibDateString` helper immediately before `periodStart`**

In `src/lib/supabaseClient.ts`, find this line (around line 226):

```typescript
type Period = '7d' | '30d' | '90d';

function periodStart(p: Period): string {
```

Replace with:

```typescript
type Period = '7d' | '30d' | '90d';

function wibDateString(date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

function periodStart(p: Period): string {
```

- [ ] **Step 2: Fix `periodStart` to return a WIB date string**

Find the full body of `periodStart`:

```typescript
function periodStart(p: Period): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (p === '7d' ? 6 : p === '30d' ? 29 : 89));
  return d.toISOString();
}
```

Replace with:

```typescript
function periodStart(p: Period): string {
  const d = new Date();
  d.setDate(d.getDate() - (p === '7d' ? 6 : p === '30d' ? 29 : 89));
  return wibDateString(d);
}
```

- [ ] **Step 3: Fix `groupByDay` bucket keys and row keys**

Find the full body of `groupByDay`:

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
  return Object.entries(buckets).map(([key, rowsInDay]) => ({
    label: new Date(key + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
    rows: rowsInDay,
  }));
}
```

Replace with:

```typescript
function groupByDay<T extends { created_at: string }>(
  rows: T[],
  days: number
): Array<{ label: string; rows: T[] }> {
  const buckets: Record<string, T[]> = {};
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = wibDateString(d);
    buckets[key] = [];
  }
  for (const row of rows) {
    const key = wibDateString(new Date(row.created_at));
    if (key in buckets) buckets[key].push(row);
  }
  return Object.entries(buckets).map(([key, rowsInDay]) => ({
    label: new Date(key + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
    rows: rowsInDay,
  }));
}
```

- [ ] **Step 4: Fix `fetchTodayStats` date calculation**

Find this block inside `fetchTodayStats`:

```typescript
    if (!supabase) throw new Error('Supabase not configured');
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const iso = todayStart.toISOString();

    const todayDate = iso.slice(0, 10);
    const [ordersRes, convsRes, aiConvsRes, kasirRes] = await Promise.all([
      supabase.from('orders').select('total').eq('status', 'PAYMENT_VERIFIED').gte('created_at', iso),
      supabase.from('conversations').select('id', { count: 'exact', head: true }).gte('created_at', iso),
      supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('ai_active', true).gte('created_at', iso),
      supabase.from('kasir_transactions').select('subtotal').eq('type', 'income').eq('date', todayDate),
    ]);
```

Replace with:

```typescript
    if (!supabase) throw new Error('Supabase not configured');
    const todayDate = wibDateString();
    const [ordersRes, convsRes, aiConvsRes, kasirRes] = await Promise.all([
      supabase.from('orders').select('total').eq('status', 'PAYMENT_VERIFIED').gte('created_at', todayDate),
      supabase.from('conversations').select('id', { count: 'exact', head: true }).gte('created_at', todayDate),
      supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('ai_active', true).gte('created_at', todayDate),
      supabase.from('kasir_transactions').select('subtotal').eq('type', 'income').eq('date', todayDate),
    ]);
```

- [ ] **Step 5: Fix `fetchWeeklyRevenueByChannel` bucket keys and order row key**

Find this block inside `fetchWeeklyRevenueByChannel`:

```typescript
    const buckets: Record<string, { walkin: number; tokopedia: number; grosir: number; waai: number }> = {};
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      buckets[d.toISOString().slice(0, 10)] = { walkin: 0, tokopedia: 0, grosir: 0, waai: 0 };
    }
    for (const tx of (kasirRes.data ?? [])) {
      const key = (tx as any).date as string;
      if (!(key in buckets)) continue;
      const ch = (tx as any).channel as string;
      const amt = (tx as any).subtotal ?? 0;
      if (ch === 'walkin') buckets[key].walkin += amt;
      else if (ch === 'tokopedia') buckets[key].tokopedia += amt;
      else if (ch === 'grosir') buckets[key].grosir += amt;
    }
    for (const o of (ordersRes.data ?? [])) {
      const key = (o as any).created_at.slice(0, 10);
      if (!(key in buckets)) continue;
      buckets[key].waai += (o as any).total ?? 0;
    }
```

Replace with:

```typescript
    const buckets: Record<string, { walkin: number; tokopedia: number; grosir: number; waai: number }> = {};
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      buckets[wibDateString(d)] = { walkin: 0, tokopedia: 0, grosir: 0, waai: 0 };
    }
    for (const tx of (kasirRes.data ?? [])) {
      const key = (tx as any).date as string;
      if (!(key in buckets)) continue;
      const ch = (tx as any).channel as string;
      const amt = (tx as any).subtotal ?? 0;
      if (ch === 'walkin') buckets[key].walkin += amt;
      else if (ch === 'tokopedia') buckets[key].tokopedia += amt;
      else if (ch === 'grosir') buckets[key].grosir += amt;
    }
    for (const o of (ordersRes.data ?? [])) {
      const key = wibDateString(new Date((o as any).created_at));
      if (!(key in buckets)) continue;
      buckets[key].waai += (o as any).total ?? 0;
    }
```

- [ ] **Step 6: Fix `reportsService.fetchDailyRevenueByChannel` bucket keys and order row key**

Find this block inside `reportsService.fetchDailyRevenueByChannel`:

```typescript
    const buckets: Record<string, { walkin: number; tokopedia: number; grosir: number; waai: number }> = {};
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      buckets[d.toISOString().slice(0, 10)] = { walkin: 0, tokopedia: 0, grosir: 0, waai: 0 };
    }
    for (const tx of (kasirRes.data ?? [])) {
      const key = (tx as any).date as string;
      if (!(key in buckets)) continue;
      const ch = (tx as any).channel as string;
      const amt = (tx as any).subtotal ?? 0;
      if (ch === 'walkin') buckets[key].walkin += amt;
      else if (ch === 'tokopedia') buckets[key].tokopedia += amt;
      else if (ch === 'grosir') buckets[key].grosir += amt;
    }
    for (const o of (ordersRes.data ?? [])) {
      const key = (o as any).created_at.slice(0, 10);
      if (!(key in buckets)) continue;
      buckets[key].waai += (o as any).total ?? 0;
    }
```

Replace with:

```typescript
    const buckets: Record<string, { walkin: number; tokopedia: number; grosir: number; waai: number }> = {};
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      buckets[wibDateString(d)] = { walkin: 0, tokopedia: 0, grosir: 0, waai: 0 };
    }
    for (const tx of (kasirRes.data ?? [])) {
      const key = (tx as any).date as string;
      if (!(key in buckets)) continue;
      const ch = (tx as any).channel as string;
      const amt = (tx as any).subtotal ?? 0;
      if (ch === 'walkin') buckets[key].walkin += amt;
      else if (ch === 'tokopedia') buckets[key].tokopedia += amt;
      else if (ch === 'grosir') buckets[key].grosir += amt;
    }
    for (const o of (ordersRes.data ?? [])) {
      const key = wibDateString(new Date((o as any).created_at));
      if (!(key in buckets)) continue;
      buckets[key].waai += (o as any).total ?? 0;
    }
```

- [ ] **Step 7: Verify build passes**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
npm run build
```

Expected: `✓ built in X.XXs` with zero TypeScript errors. If errors appear, fix before continuing.

- [ ] **Step 8: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "fix(metrics): use WIB timezone for all date calculations in supabaseClient"
```

---

### Task 2: Fix LaporanScreen.tsx — local periodStart

**Files:**
- Modify: `src/components/LaporanScreen.tsx`

**Context:** `LaporanScreen.tsx` defines its own local `periodStart` function (lines 13–18) that uses the same UTC-midnight pattern. This is what feeds the `since` parameter to all `reportsService` calls. After this fix, `since` will be a `YYYY-MM-DD` WIB date string — valid for both `gte('created_at', since)` (PostgreSQL auto-casts date strings to timestamptz) and `gte('date', since)` (exact type match on kasir DATE column).

- [ ] **Step 1: Fix local `periodStart` in LaporanScreen.tsx**

Find this function (lines 13–18):

```typescript
function periodStart(p: Period): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (p === '7d' ? 6 : p === '30d' ? 29 : 89));
  return d.toISOString();
}
```

Replace with:

```typescript
function periodStart(p: Period): string {
  const d = new Date();
  d.setDate(d.getDate() - (p === '7d' ? 6 : p === '30d' ? 29 : 89));
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}
```

- [ ] **Step 2: Verify build passes**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
npm run build
```

Expected: `✓ built in X.XXs` with zero TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/LaporanScreen.tsx
git commit -m "fix(metrics): use WIB timezone in LaporanScreen periodStart"
```

---

### Task 3: Deploy and verify

- [ ] **Step 1: Push to trigger Cloud Build**

```bash
git push origin main
```

- [ ] **Step 2: Verify in browser after deploy**

Navigate to Dashboard and confirm:
- "Total Omset (Hari Ini)" shows the correct today's kasir revenue (not Rp 0)
- "Pesanan Terproses" shows the correct today's transaction count
- Weekly "Trend Omset" chart shows a bar on today's column

Navigate to Laporan and confirm:
- "Total Omset" KPI shows non-zero revenue for the selected period
- "Nilai Rata-rata Pesanan" shows a non-zero value
- "Revenue per Channel" chart shows bars in the Walk-in column
- "Produk Terlaris" table shows product rows
