# Pembelian: PO detail in new tab + KPI redesign + date filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cramped `PoDetailView` modal with a standalone full-page view opened in a new browser tab via query-string routing, adopt the canonical `KpiCard` design-system pattern for the four Pembelian summary cards, and add a date filter (`Bulan Ini` / `30 Hari` / `90 Hari` / Custom) that drives both the cards and the PO list.

**Architecture:** No new router added; `App.tsx` parses `?screen=pembelian&po=PO-XYZ` from `URLSearchParams` on mount and passes an `initialDetailPoNumber` prop down. `PembelianScreen` gains a new `viewMode: 'detail'` and a `PembelianDetailPage` component. A new shared `KpiCard` is extracted to `src/components/ui/`. A new pure-function `src/lib/dateRange.ts` holds `resolveRange` / `periodLabel` / `inRange` and is unit-tested. KPI cards filter by different date fields per the spec table (cards 1/4 by `coalesce(ordered_at, created_at)`, card 2 by `payment_due_at`, card 3 ignores filter). Cross-tab sync is `visibilitychange`-on-refocus only.

**Tech Stack:** React 18, TypeScript, Tailwind, Vite, Vitest (existing), Supabase JS client, Lucide icons. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-13-pembelian-detail-tab-and-filter-design.md`
**Mockup:** `tmp/pembelian-mockup.html` (interactive prototype — useful for visual reference during implementation)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/dateRange.ts` | **NEW** | Pure `resolveRange`, `periodLabel`, `resolvedRangeShort`, `inRange`, `inMonth` helpers. WIB-based. |
| `tests/integration/dateRange.test.ts` | **NEW** | Vitest unit coverage for all four presets + WIB boundary case. |
| `src/components/ui/KpiCard.tsx` | **NEW** | Shared KPI card matching Dashboard + Laporan visual pattern. |
| `src/lib/pembelianService.ts` | **MODIFY** | Add `fetchByNumber`; remove `fetchSummary`. |
| `src/components/LaporanScreen.tsx` | **MODIFY** | Delete file-local `KpiCard` helper, import shared one. |
| `src/App.tsx` | **MODIFY** | Parse URL params on boot, deep-link auth handoff via `sessionStorage`, pipe `initialDetailPoNumber` to `PembelianScreen`, clear on sidebar nav. |
| `src/components/PembelianScreen.tsx` | **MODIFY** | Filter bar + Custom popover, adopt `KpiCard`, list filtered by `inRange`, empty state, `viewMode: 'detail'`, Detail button → `window.open`, `visibilitychange` refresh, accept `initialDetailPoNumber`. |
| `src/components/pembelian/PembelianDetailPage.tsx` | **NEW** | Full-page detail (no sidebar), loading skeleton, error state, tab title, print classes, status-driven actions (Edit/Pesan/Hapus/Terima/Bayar/PDF/Print). |
| `src/components/pembelian/PoDetailView.tsx` | **DELETE** | Replaced by `PembelianDetailPage`. |
| `progress.md` | **MODIFY** | Per-task update entry per CLAUDE.md gotchas. |

---

## Task 1: `src/lib/dateRange.ts` + unit tests (TDD)

**Files:**
- Create: `src/lib/dateRange.ts`
- Test: `tests/integration/dateRange.test.ts`

The Pembelian filter computes a `[from, to]` range from a preset key + optional custom inputs. Everything must use WIB (Asia/Jakarta) so chip math doesn't drift with operator-local timezone.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/dateRange.test.ts`:

```ts
// tests/integration/dateRange.test.ts
import { describe, test, expect } from 'vitest';
import {
  resolveRange,
  periodLabel,
  resolvedRangeShort,
  inRange,
} from '../../src/lib/dateRange';

const T = '2026-06-13'; // pretend "today WIB" for deterministic tests

describe('resolveRange', () => {
  test('bulan_ini → first of month to today', () => {
    expect(resolveRange({ preset: 'bulan_ini' }, T)).toEqual({ from: '2026-06-01', to: '2026-06-13' });
  });

  test('30_hari → 30-day rolling window inclusive of today', () => {
    expect(resolveRange({ preset: '30_hari' }, T)).toEqual({ from: '2026-05-15', to: '2026-06-13' });
  });

  test('90_hari → 90-day rolling window inclusive of today', () => {
    expect(resolveRange({ preset: '90_hari' }, T)).toEqual({ from: '2026-03-16', to: '2026-06-13' });
  });

  test('custom → uses supplied from/to', () => {
    expect(resolveRange({ preset: 'custom', customFrom: '2026-04-01', customTo: '2026-04-30' }, T))
      .toEqual({ from: '2026-04-01', to: '2026-04-30' });
  });

  test('custom without inputs → falls back to bulan_ini bounds', () => {
    expect(resolveRange({ preset: 'custom' }, T)).toEqual({ from: '2026-06-01', to: '2026-06-13' });
  });

  test('30_hari at month boundary (first of month) does not roll back', () => {
    // operator opens screen at WIB 1 Jun → today must stay 1 Jun
    const r = resolveRange({ preset: '30_hari' }, '2026-06-01');
    expect(r.to).toBe('2026-06-01');
    expect(r.from).toBe('2026-05-03');
  });
});

describe('periodLabel', () => {
  test('preset labels are Indonesian', () => {
    expect(periodLabel({ preset: 'bulan_ini' }, T)).toBe('Bulan Ini');
    expect(periodLabel({ preset: '30_hari' }, T)).toBe('30 Hari Terakhir');
    expect(periodLabel({ preset: '90_hari' }, T)).toBe('90 Hari Terakhir');
  });

  test('custom full-month → "Mei 2026"', () => {
    expect(periodLabel({ preset: 'custom', customFrom: '2026-05-01', customTo: '2026-05-31' }, T))
      .toBe('Mei 2026');
  });

  test('custom partial range → "15 Apr – 30 Mei 2026"', () => {
    expect(periodLabel({ preset: 'custom', customFrom: '2026-04-15', customTo: '2026-05-30' }, T))
      .toBe('15 Apr – 30 Mei 2026');
  });

  test('custom year-crossing → both years shown', () => {
    expect(periodLabel({ preset: 'custom', customFrom: '2025-12-20', customTo: '2026-01-05' }, T))
      .toBe('20 Des 2025 – 5 Jan 2026');
  });
});

describe('resolvedRangeShort', () => {
  test('bulan_ini at T → "1 Jun – 13 Jun 2026"', () => {
    expect(resolvedRangeShort({ preset: 'bulan_ini' }, T)).toBe('1 Jun – 13 Jun 2026');
  });
});

describe('inRange', () => {
  test('inclusive at both ends', () => {
    const r = { from: '2026-06-01', to: '2026-06-13' };
    expect(inRange('2026-06-01', r)).toBe(true);
    expect(inRange('2026-06-13', r)).toBe(true);
    expect(inRange('2026-06-07', r)).toBe(true);
  });
  test('exclusive outside', () => {
    const r = { from: '2026-06-01', to: '2026-06-13' };
    expect(inRange('2026-05-31', r)).toBe(false);
    expect(inRange('2026-06-14', r)).toBe(false);
  });
  test('null / undefined date → false (defensive)', () => {
    const r = { from: '2026-06-01', to: '2026-06-13' };
    expect(inRange(null as unknown as string, r)).toBe(false);
    expect(inRange(undefined as unknown as string, r)).toBe(false);
    expect(inRange('', r)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/integration/dateRange.test.ts`
Expected: FAIL with "Cannot find module '../../src/lib/dateRange'".

- [ ] **Step 3: Implement `src/lib/dateRange.ts`**

```ts
// src/lib/dateRange.ts
//
// Date-range helpers for the Pembelian filter bar (and any future screen that
// wants the same chip set). All math is WIB (Asia/Jakarta) so chip arithmetic
// doesn't drift with operator-local timezone.

import { wibDateString } from './format';

export type FilterPreset = 'bulan_ini' | '30_hari' | '90_hari' | 'custom';

export interface FilterState {
  preset: FilterPreset;
  customFrom?: string; // 'YYYY-MM-DD', only honoured when preset === 'custom'
  customTo?: string;
}

export interface ResolvedRange {
  from: string; // 'YYYY-MM-DD' inclusive
  to: string;   // 'YYYY-MM-DD' inclusive
}

const MONTHS_ID_LONG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
                        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const MONTHS_ID_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
                         'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function parseIso(iso: string): { y: number; m: number; d: number } {
  // Avoid Date() and its UTC drift — we just split the string.
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

function isoFromYmd(y: number, m: number, d: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(d)}`;
}

function shiftDays(iso: string, days: number): string {
  // Use UTC math to avoid local-DST drift, then format back to YYYY-MM-DD.
  const { y, m, d } = parseIso(iso);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return isoFromYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function firstOfMonth(iso: string): string {
  const { y, m } = parseIso(iso);
  return isoFromYmd(y, m, 1);
}

function lastOfMonth(y: number, m: number): number {
  // m is 1-indexed; new Date(y, m, 0).getDate() gives last day of month m
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function resolveRange(filter: FilterState, todayWib: string = wibDateString()): ResolvedRange {
  switch (filter.preset) {
    case 'bulan_ini':
      return { from: firstOfMonth(todayWib), to: todayWib };
    case '30_hari':
      return { from: shiftDays(todayWib, -29), to: todayWib };
    case '90_hari':
      return { from: shiftDays(todayWib, -89), to: todayWib };
    case 'custom':
      if (filter.customFrom && filter.customTo) {
        return { from: filter.customFrom, to: filter.customTo };
      }
      // Defensive fallback if custom inputs are missing — behave like bulan_ini.
      return { from: firstOfMonth(todayWib), to: todayWib };
  }
}

function formatDateShort(iso: string, withYear: boolean): string {
  const { y, m, d } = parseIso(iso);
  return withYear ? `${d} ${MONTHS_ID_SHORT[m - 1]} ${y}` : `${d} ${MONTHS_ID_SHORT[m - 1]}`;
}

export function periodLabel(filter: FilterState, todayWib: string = wibDateString()): string {
  if (filter.preset === 'bulan_ini') return 'Bulan Ini';
  if (filter.preset === '30_hari') return '30 Hari Terakhir';
  if (filter.preset === '90_hari') return '90 Hari Terakhir';
  const r = resolveRange(filter, todayWib);
  const f = parseIso(r.from);
  const t = parseIso(r.to);
  // Full single calendar month → "Mei 2026"
  const sameMonth = f.y === t.y && f.m === t.m;
  const fromIsFirst = f.d === 1;
  const toIsLast = t.d === lastOfMonth(t.y, t.m);
  if (sameMonth && fromIsFirst && toIsLast) {
    return `${MONTHS_ID_LONG[f.m - 1]} ${f.y}`;
  }
  // Year-crossing → show year on both sides; same-year → only on the right.
  const sameYear = f.y === t.y;
  if (sameYear) {
    return `${formatDateShort(r.from, false)} – ${formatDateShort(r.to, true)}`;
  }
  return `${formatDateShort(r.from, true)} – ${formatDateShort(r.to, true)}`;
}

export function resolvedRangeShort(filter: FilterState, todayWib: string = wibDateString()): string {
  const r = resolveRange(filter, todayWib);
  const f = parseIso(r.from);
  const t = parseIso(r.to);
  const sameYear = f.y === t.y;
  return sameYear
    ? `${formatDateShort(r.from, false)} – ${formatDateShort(r.to, true)}`
    : `${formatDateShort(r.from, true)} – ${formatDateShort(r.to, true)}`;
}

export function inRange(iso: string | null | undefined, range: ResolvedRange): boolean {
  if (!iso) return false;
  return iso >= range.from && iso <= range.to;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/dateRange.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 5: Lint passes**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dateRange.ts tests/integration/dateRange.test.ts
git commit -m "feat(pembelian): dateRange helpers (resolveRange, periodLabel, inRange) — WIB

Pure functions for the upcoming Pembelian filter bar. Presets:
bulan_ini (first of month → today), 30_hari and 90_hari (rolling
windows), custom (explicit from/to). All math is WIB so chip
arithmetic doesn't drift with operator-local timezone. periodLabel
returns 'Bulan Ini' / '30 Hari Terakhir' / 'Mei 2026' / range string
as appropriate. inRange is inclusive at both ends and defensive
against null/undefined."
```

---

## Task 2: Shared `KpiCard` component + Laporan migration

**Files:**
- Create: `src/components/ui/KpiCard.tsx`
- Modify: `src/components/LaporanScreen.tsx` (lines 256–281)

- [ ] **Step 1: Create the shared component**

```tsx
// src/components/ui/KpiCard.tsx
//
// Canonical KPI card used by Dashboard / Laporan / Pembelian. Lifted from
// the file-local helper in LaporanScreen so the visual is the same
// everywhere it's shown.

import React from 'react';

export interface KpiCardProps {
  icon: React.ReactNode;       // lucide icon element, e.g. <ShoppingCart className="w-6 h-6" />
  iconBg: string;              // tailwind class, e.g. 'bg-blue-50'
  iconColor: string;           // tailwind class, e.g. 'text-[#1e3d60]'
  badge: string;
  badgeClass: string;          // tailwind class, e.g. 'bg-blue-50 text-[#1e3d60]'
  label: string;
  value: string;
  sub: string;
  alarming?: boolean;          // when true: card uses rose-tinted bg (for cards like Terlambat Bayar)
}

export default function KpiCard({
  icon, iconBg, iconColor, badge, badgeClass,
  label, value, sub, alarming = false,
}: KpiCardProps) {
  const cardCls = alarming
    ? 'bg-rose-50/50 border-rose-100 shadow-rose-50/50'
    : 'bg-white border-[#e5eeff] shadow-primary/5';
  return (
    <div className={`rounded-3xl p-6 border shadow-lg hover:translate-y-[-4px] transition-all duration-300 ${cardCls}`}>
      <div className="flex justify-between items-start mb-4">
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${iconBg} ${iconColor}`}>
          {icon}
        </div>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${badgeClass}`}>{badge}</span>
      </div>
      <span className="text-xs font-bold text-gray-400 uppercase tracking-widest block">{label}</span>
      <h3 className="text-[#012749] font-extrabold text-2xl tracking-tight mt-1">{value}</h3>
      <p className="text-sm text-[#43474e] mt-2 leading-snug">{sub}</p>
    </div>
  );
}
```

- [ ] **Step 2: Migrate `LaporanScreen.tsx` to use the shared component**

Open `src/components/LaporanScreen.tsx`. At the top, add the import:

```tsx
import KpiCard from './ui/KpiCard';
```

Find the local `KpiCardProps` interface and `function KpiCard(...)` at the bottom (lines ~256–281). **Delete both** — the file-local helper is now redundant.

Then find the call sites where the local `KpiCard` was rendered (search for `<KpiCard `) and switch the icon prop from `icon={<Icon className="w-6 h-6" />}` if needed — confirm props line up with the new exported `KpiCardProps`. If any prop is named differently in LaporanScreen (e.g., the local helper used `icon: React.ReactNode` already), the call sites are unchanged.

- [ ] **Step 3: Verify lint passes**

Run: `npm run lint`
Expected: 0 errors. LaporanScreen call sites should still type-check with the new shared component.

- [ ] **Step 4: Verify Laporan still renders**

Run: `npm run dev` (background). Open `http://localhost:3000` in a browser, log in, click **Laporan** in the sidebar, confirm the four KPI cards render identically (hover-lift, rounded-3xl, icon chip, badge, `#012749` extrabold value). If anything looks visually different from before, the prop mapping is off — fix before continuing.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/KpiCard.tsx src/components/LaporanScreen.tsx
git commit -m "refactor(ui): extract shared KpiCard to src/components/ui

Previously file-local in LaporanScreen. Same body (rounded-3xl,
icon chip, badge, #012749 extrabold value, hover-lift), now reusable
from any screen. LaporanScreen now imports it; visual is unchanged.
Pembelian will adopt it in a follow-up task."
```

---

## Task 3: `purchaseOrderService.fetchByNumber` + remove `fetchSummary`

**Files:**
- Modify: `src/lib/pembelianService.ts` (lines 47–252)

- [ ] **Step 1: Add `fetchByNumber` to `purchaseOrderService`**

In `src/lib/pembelianService.ts`, inside the `purchaseOrderService` object, add right after the existing `fetchAll`:

```ts
  async fetchByNumber(poNumber: string): Promise<DbPurchaseOrder | null> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('*, suppliers(*), purchase_order_items(*)')
      .eq('po_number', poNumber)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      ...(data as any),
      supplier: (data as any).suppliers,
      items: (data as any).purchase_order_items ?? [],
    } as DbPurchaseOrder;
  },
```

- [ ] **Step 2: Remove `fetchSummary`**

Delete the entire `async fetchSummary(): Promise<{ totalMtd: number; ... }>` method (lines ~231–251 in the current file). It is no longer used — all four KPI cards are computed client-side from the already-fetched PO list per spec §5.2.

- [ ] **Step 3: Verify no other callers of `fetchSummary` remain**

Run: `grep -rn "fetchSummary" src/ tests/ 2>&1`
Expected: only references inside `PembelianScreen.tsx` (which we'll fix in Task 5). If anything else references it, list those file:line tuples and stop — they'll need updating too.

- [ ] **Step 4: Lint will fail until Task 5 — confirm only the expected error**

Run: `npm run lint`
Expected: error in `src/components/PembelianScreen.tsx` complaining `fetchSummary` no longer exists on `purchaseOrderService`. Any other error means a missed caller — investigate.

(This expected error is fine; we fix it in Task 5. Do not commit yet — bundle Tasks 3 + 5 so the codebase never sits in a broken state on `main`.)

- [ ] **Step 5: Do NOT commit yet**

Move on to the next task. `fetchByNumber` is added and `fetchSummary` is deleted but the tree fails lint. The commit happens at the end of Task 5 when `PembelianScreen.tsx` is updated to stop referencing `fetchSummary`.

---

## Task 4: `App.tsx` URL routing + deep-link auth handoff

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add `initialDetailPoNumber` state and URL boot parsing**

Find the existing `useState` block near the top of `App()` (lines 55–73). Right after `const [openCustomerId, setOpenCustomerId] = useState<string | null>(null);`, add:

```tsx
  const [initialDetailPoNumber, setInitialDetailPoNumber] = useState<string | null>(null);
```

- [ ] **Step 2: Add URL parser + sessionStorage stash**

Right after the `setCurrentUser`/`setActivePage` state declarations and before the `useEffect`s, add a new effect that runs once on mount. Place it BEFORE the existing Supabase session restore effect so the params are read before any auth decision:

```tsx
  // Read deep-link params on boot. Two paths:
  //  - logged in: apply immediately (handled below after auth restore).
  //  - logged out: stash in sessionStorage; restored by handleLoginSuccess.
  // sessionStorage (not localStorage) so a stale deep-link doesn't survive a closed tab.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const screen = params.get('screen');
    const po = params.get('po');
    if (!screen) return;
    // Only 'pembelian' is recognized for now.
    if (screen !== 'pembelian') return;
    if (currentUser) {
      // Logged in already — apply now.
      setActivePage('pembelian');
      if (po) setInitialDetailPoNumber(po);
    } else {
      // Not logged in — stash for after-login restore.
      try {
        sessionStorage.setItem('pembelian.pendingDeepLink', JSON.stringify({ screen, po: po ?? null }));
      } catch {
        // sessionStorage unavailable (e.g., private window quota) — ignore.
      }
    }
  }, []);
```

- [ ] **Step 3: Restore the stash inside `handleLoginSuccess`**

Find `handleLoginSuccess` (around line 205) and replace its body to:

```tsx
  const handleLoginSuccess = (user: { id: string; name: string; role: string; permissions: PermissionSet; avatarUrl: string; storeName: string }) => {
    setCurrentUser(user);
    // Default destination is dashboard; deep-link overrides if present.
    let nextPage: ActivePage = 'dashboard';
    try {
      const raw = sessionStorage.getItem('pembelian.pendingDeepLink');
      if (raw) {
        const stash = JSON.parse(raw) as { screen?: string; po?: string | null };
        if (stash.screen === 'pembelian') {
          nextPage = 'pembelian';
          if (stash.po) setInitialDetailPoNumber(stash.po);
        }
        sessionStorage.removeItem('pembelian.pendingDeepLink');
      }
    } catch {
      // Stash unreadable — fall through to dashboard.
    }
    setActivePage(nextPage);
  };
```

- [ ] **Step 4: Clear `initialDetailPoNumber` on sidebar nav**

Find the `<Sidebar ... onPageChange={...} />` JSX (around line 449). Update the handler so it clears the deep-link prop whenever the user navigates anywhere:

```tsx
        <Sidebar
          activePage={activePage}
          onPageChange={(page) => {
            if (page !== 'pelanggan') setOpenCustomerId(null);
            setInitialDetailPoNumber(null);
            setActivePage(page);
          }}
          currentUser={currentUser}
          onLogout={handleLogout}
        />
```

- [ ] **Step 5: Pipe `initialDetailPoNumber` into `PembelianScreen`**

Find the `case 'pembelian':` branch of `renderPage()` (around line 345) and add the prop:

```tsx
      case 'pembelian':
        return (
          <PembelianScreen
            stockList={stockList}
            showToast={triggerToast}
            onStockRefresh={handleStockRefresh}
            currentUserId={currentUser?.id}
            currentUserPermissions={currentUser?.permissions}
            initialDetailPoNumber={initialDetailPoNumber}
            onDetailConsumed={() => setInitialDetailPoNumber(null)}
          />
        );
```

`onDetailConsumed` is a no-arg callback that `PembelianScreen` calls AFTER it has switched into detail view, so further re-renders don't re-open the same PO. (Will be referenced in Task 6.)

- [ ] **Step 6: Lint still fails (PembelianScreen doesn't have the new props yet)**

Run: `npm run lint`
Expected: error in `src/components/PembelianScreen.tsx` — `initialDetailPoNumber` and `onDetailConsumed` are not part of `PembelianScreenProps` yet. Continue to Task 5 to fix.

- [ ] **Step 7: Do NOT commit yet**

Bundled into the Task 5 commit so the tree compiles after.

---

## Task 5: `PembelianScreen` — filter state, filter bar, KpiCard adoption, list filter, visibility-refresh, detail entry

**Files:**
- Modify: `src/components/PembelianScreen.tsx`

This is the largest change. We do it in several edits and verify lint+visual after the last one. No automated test — manual smoke covered in Task 9.

- [ ] **Step 1: Update imports + props interface**

At the top of `PembelianScreen.tsx`, replace the lucide import block to include the new icons needed for the cards + filter bar + empty state:

```tsx
import React, { useState, useEffect, useRef } from 'react';
import { ShoppingCart, Calendar, AlertTriangle, FileText, CalendarRange, ChevronDown, SearchX, Plus } from 'lucide-react';
```

Add the new types import:

```tsx
import {
  type FilterState,
  resolveRange,
  periodLabel,
  resolvedRangeShort,
  inRange,
} from '../lib/dateRange';
import KpiCard from './ui/KpiCard';
```

Remove the now-unused `PoDetailView` import (the modal goes away). The line to delete:

```tsx
import PoDetailView from './pembelian/PoDetailView';
```

Add the new detail page import (file created in Task 7):

```tsx
import PembelianDetailPage from './pembelian/PembelianDetailPage';
```

Extend the `PembelianScreenProps` interface:

```tsx
interface PembelianScreenProps {
  stockList: StockItem[];
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onStockRefresh: () => void;
  currentUserId?: string;
  currentUserPermissions?: PermissionSet;
  initialDetailPoNumber?: string | null;
  onDetailConsumed?: () => void;
}
```

- [ ] **Step 2: Update `ViewMode` and component state**

Find the `ViewMode` type (line 24):

```tsx
type ViewMode = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; po: DbPurchaseOrder };
```

Replace with:

```tsx
type ViewMode =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; po: DbPurchaseOrder }
  | { kind: 'detail'; poNumber: string };
```

Replace the function signature + state block:

```tsx
export default function PembelianScreen({
  stockList, showToast, onStockRefresh, currentUserId, currentUserPermissions,
  initialDetailPoNumber, onDetailConsumed,
}: PembelianScreenProps) {
  const [tab, setTab] = useState<Tab>('orders');
  const [orders, setOrders] = useState<DbPurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<DbSupplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>({ kind: 'list' });
  const [filter, setFilter] = useState<FilterState>({ preset: 'bulan_ini' });
  const [customPopoverOpen, setCustomPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
```

Delete the `summary` state (and the `fetchSummary` call below) — it's gone now.

- [ ] **Step 3: Update `reload` to drop the summary fetch**

Replace `reload()`:

```tsx
  async function reload() {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    try {
      const [ords, sups] = await Promise.all([
        purchaseOrderService.fetchAll(),
        supplierService.fetchAll(),
      ]);
      setOrders(ords);
      setSuppliers(sups);
    } catch (e: any) {
      console.error('Load pembelian error:', e);
      showToast(e?.message ?? 'Gagal memuat data pembelian.', 'warning');
    } finally {
      setLoading(false);
    }
  }
```

- [ ] **Step 4: Add `useEffect` for initial detail prop + visibilitychange refresh**

After the existing `useEffect(() => { reload(); }, []);` line, add:

```tsx
  // Open detail directly if invoked via deep-link (?po=...)
  useEffect(() => {
    if (initialDetailPoNumber) {
      setViewMode({ kind: 'detail', poNumber: initialDetailPoNumber });
      onDetailConsumed?.();
    }
  }, [initialDetailPoNumber, onDetailConsumed]);

  // Tab-sync: when the list tab regains focus (e.g., after the user took an action
  // in a detail tab), re-fetch so the list reflects the latest state.
  useEffect(() => {
    if (viewMode.kind !== 'list') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [viewMode.kind]);

  // Click-outside closes the Custom popover.
  useEffect(() => {
    if (!customPopoverOpen) return;
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setCustomPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [customPopoverOpen]);
```

- [ ] **Step 5: Compute summary client-side**

Anywhere convenient inside the component (before the JSX), add:

```tsx
  const range = resolveRange(filter);
  const pLabel = periodLabel(filter);
  const rangeLabel = resolvedRangeShort(filter);

  function poDateAnchor(po: DbPurchaseOrder): string | null {
    return po.ordered_at ?? po.created_at ?? null;
  }
  function inListPeriod(po: DbPurchaseOrder): boolean {
    return inRange(poDateAnchor(po) ?? undefined, range);
  }

  // Cards 1 + 4: filtered by coalesce(ordered_at, created_at) — "what did I buy?"
  const inWindow = orders.filter(inListPeriod);
  const total = inWindow.reduce((s, p) => s + Number(p.total), 0);
  const count = inWindow.length;

  // Card 2: filtered by payment_due_at AND status === 'RECEIVED' — "what do I owe in this window?"
  const dueInWindow = orders.filter(p =>
    p.status === 'RECEIVED' && p.payment_due_at && inRange(p.payment_due_at, range)
  );
  const dueAmount = dueInWindow.reduce((s, p) => s + Number(p.total), 0);
  const dueCount = dueInWindow.length;

  // Card 3: ALWAYS "right now" — ignores filter (see spec §5.2 Card 3 row).
  const todayWib = wibDateString();
  const overdueNow = orders.filter(p =>
    p.status === 'RECEIVED' && p.payment_due_at && p.payment_due_at < todayWib
  );
  const overdueAmount = overdueNow.reduce((s, p) => s + Number(p.total), 0);
  const overdueCount = overdueNow.length;
```

(You will already need `import { wibDateString } from '../lib/format';` at the top — add it if not present.)

- [ ] **Step 6: Replace the four KPI cards with `KpiCard` usage**

Inside the JSX, find the `{/* Summary cards */}` block (lines 107–129) and replace with:

```tsx
            {/* KPI cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <KpiCard
                icon={<ShoppingCart className="w-6 h-6" />}
                iconBg="bg-blue-50" iconColor="text-[#1e3d60]"
                badge={pLabel} badgeClass="bg-blue-50 text-[#1e3d60]"
                label="Total PO" value={formatRupiah(total)}
                sub={count > 0 ? `${count} purchase order dibuat di ${pLabel.toLowerCase()}` : 'Belum ada PO di periode ini'}
              />
              <KpiCard
                icon={<Calendar className="w-6 h-6" />}
                iconBg="bg-amber-50" iconColor="text-amber-600"
                badge={`${dueCount} PO`} badgeClass="bg-amber-50 text-amber-700"
                label="Jatuh Tempo" value={formatRupiah(dueAmount)}
                sub={dueCount > 0 ? `Belum dibayar, jatuh tempo di ${pLabel.toLowerCase()}` : 'Tidak ada PO jatuh tempo di periode ini'}
              />
              <KpiCard
                icon={<AlertTriangle className="w-6 h-6" />}
                iconBg={overdueAmount > 0 ? 'bg-rose-100' : 'bg-gray-50'}
                iconColor={overdueAmount > 0 ? 'text-rose-700' : 'text-gray-400'}
                badge={overdueAmount > 0 ? 'Tindakan!' : 'Aman'}
                badgeClass={overdueAmount > 0 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-50 text-[#2d8a4e]'}
                label="Terlambat Bayar" value={formatRupiah(overdueAmount)}
                sub={overdueAmount > 0
                  ? `${overdueCount} PO melewati jatuh tempo — selalu hari ini, tidak ikut filter`
                  : 'Semua PO dilunasi tepat waktu'}
                alarming={overdueAmount > 0}
              />
              <KpiCard
                icon={<FileText className="w-6 h-6" />}
                iconBg="bg-emerald-50" iconColor="text-[#2d8a4e]"
                badge={pLabel} badgeClass="bg-emerald-50 text-[#2d8a4e]"
                label="Jumlah PO" value={`${count}`}
                sub={count > 0 ? `Purchase order dibuat di ${pLabel.toLowerCase()}` : 'Belum ada PO di periode ini'}
              />
            </div>
```

- [ ] **Step 7: Insert the filter bar between the page header and the KPI cards**

Find the page-header `<div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3 flex-shrink-0">` block (lines 76–85). Immediately AFTER its closing `</div>` (line 85) and BEFORE `<div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">` (line 87), insert the filter bar (only visible in list view-mode):

```tsx
      {/* Filter bar — only visible on the list view, between page header and main scroll */}
      {viewMode.kind === 'list' && (
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between gap-4 flex-wrap flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest mr-1">Periode</span>
            {(['bulan_ini', '30_hari', '90_hari'] as const).map(key => {
              const active = filter.preset === key;
              const text = key === 'bulan_ini' ? 'Bulan Ini' : key === '30_hari' ? '30 Hari' : '90 Hari';
              return (
                <button
                  key={key}
                  onClick={() => { setFilter({ preset: key }); setCustomPopoverOpen(false); }}
                  className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
                    active
                      ? 'bg-[#012749] text-white shadow'
                      : 'bg-white border border-gray-200 text-gray-600 hover:border-[#012749] hover:text-[#012749]'
                  }`}
                >
                  {text}
                </button>
              );
            })}
            <div className="relative" ref={popoverRef}>
              <button
                onClick={() => setCustomPopoverOpen(v => !v)}
                aria-label="Pilih rentang tanggal custom"
                className={`px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-1.5 transition ${
                  filter.preset === 'custom'
                    ? 'bg-[#012749] text-white shadow'
                    : 'bg-white border border-gray-200 text-gray-600 hover:border-[#012749] hover:text-[#012749]'
                }`}
              >
                <Calendar className="w-4 h-4" /> Custom <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {customPopoverOpen && (
                <CustomPopover
                  initial={filter.preset === 'custom' ? { from: filter.customFrom, to: filter.customTo } : {}}
                  onCancel={() => setCustomPopoverOpen(false)}
                  onApply={(from, to) => {
                    setFilter({ preset: 'custom', customFrom: from, customTo: to });
                    setCustomPopoverOpen(false);
                  }}
                />
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <CalendarRange className="w-4 h-4" />
            <span className="font-semibold text-gray-700">{pLabel}</span>
            <span className="text-gray-400">·</span>
            <span>{rangeLabel}</span>
          </div>
        </div>
      )}
```

- [ ] **Step 8: Add the `CustomPopover` sub-component (in-file)**

At the bottom of `PembelianScreen.tsx` (after the `SuppliersTab` function), add:

```tsx
interface CustomPopoverProps {
  initial: { from?: string; to?: string };
  onCancel: () => void;
  onApply: (from: string, to: string) => void;
}
function CustomPopover({ initial, onCancel, onApply }: CustomPopoverProps) {
  const [from, setFrom] = useState(initial.from ?? '');
  const [to, setTo] = useState(initial.to ?? '');
  const invalid = !!from && !!to && from > to;
  const canApply = !!from && !!to && !invalid;
  return (
    <div className="absolute top-full mt-2 right-0 z-50 bg-white border border-gray-200 rounded-2xl shadow-2xl p-5 w-[360px]">
      <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Rentang Tanggal Custom</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1">Dari</label>
          <input
            type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1">Sampai</label>
          <input
            type="date" value={to} onChange={e => setTo(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
          />
        </div>
      </div>
      {invalid && (
        <p className="text-xs text-rose-600 mt-2">Tanggal 'Sampai' harus setelah 'Dari'.</p>
      )}
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="text-sm font-semibold text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-50">Batal</button>
        <button
          onClick={() => canApply && onApply(from, to)}
          disabled={!canApply}
          className="text-sm font-semibold text-white bg-[#012749] hover:bg-[#013865] disabled:opacity-40 disabled:cursor-not-allowed px-4 py-1.5 rounded-lg"
        >
          Terapkan
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Update the view-mode router to handle 'detail'**

Find the JSX `viewMode.kind !== 'list'` ternary block (lines 88–104). Replace the whole `{viewMode.kind !== 'list' ? ... : ( <>{summary cards + tabs + list}</> )}` with:

```tsx
        {viewMode.kind === 'create' || viewMode.kind === 'edit' ? (
          <PurchaseOrderFormPage
            po={viewMode.kind === 'edit' ? viewMode.po : undefined}
            suppliers={suppliers}
            orders={orders}
            stockList={stockList}
            currentUserId={currentUserId}
            currentUserPermissions={currentUserPermissions}
            onBack={() => setViewMode({ kind: 'list' })}
            onSaved={(status) => {
              reload();
              if (status === 'ORDERED') setViewMode({ kind: 'list' });
            }}
            onSupplierAdded={reload}
            showToast={showToast}
          />
        ) : viewMode.kind === 'detail' ? (
          <PembelianDetailPage
            poNumber={viewMode.poNumber}
            stockList={stockList}
            suppliers={suppliers}
            orders={orders}
            currentUserId={currentUserId}
            currentUserPermissions={currentUserPermissions}
            showToast={showToast}
            onStockRefresh={onStockRefresh}
            onBackToList={() => setViewMode({ kind: 'list' })}
          />
        ) : (
          <>
            {/* KPI cards (Step 6 already inserted), filter bar (Step 7), tabs, table — leave as-is */}
            {/* ↑ all the existing list-view JSX continues here */}
          </>
        )}
```

(Make sure the existing `{/* Summary cards */}` → `{/* Tabs */}` → `{loading ? ... : tab === 'orders' ? <OrdersTab ... /> : <SuppliersTab ... />}` chain stays inside the `else` branch. Only the conditional wrapping changed.)

- [ ] **Step 10: Filter the `OrdersTab` list + empty state**

Inside `OrdersTab` (the inner function component), find the `const filtered = orders.filter(o => { const matchSearch = ... });` block (around line 211). Add the period filter at the START of the chain. We need the period range/anchor function accessible — easiest: pass `inListPeriod` as a prop to `OrdersTab`.

Update the `OrdersTabProps` interface:

```tsx
interface OrdersTabProps {
  orders: DbPurchaseOrder[];
  suppliers: DbSupplier[];
  stockList: StockItem[];
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onRefresh: () => void;
  onStockRefresh: () => void;
  onCreate: () => void;
  onEdit: (po: DbPurchaseOrder) => void;
  inListPeriod: (po: DbPurchaseOrder) => boolean;
  periodLabel: string;
  buildDetailUrl: (poNumber: string) => string;
}
```

Update the `OrdersTab` function signature to destructure those new props and update its `filtered` chain:

```tsx
  const filtered = orders
    .filter(inListPeriod)
    .filter(o => {
      const matchSearch = o.po_number.toLowerCase().includes(search.toLowerCase()) ||
        (o.supplier?.name ?? '').toLowerCase().includes(search.toLowerCase());
      const matchStatus = !statusFilter || o.status === statusFilter;
      return matchSearch && matchStatus;
    })
    .sort(/* existing sort fn unchanged */);
```

Where `OrdersTab` is rendered (back up in `PembelianScreen`), pass the new props:

```tsx
              <OrdersTab
                orders={orders}
                suppliers={suppliers}
                stockList={stockList}
                showToast={showToast}
                onRefresh={reload}
                onStockRefresh={onStockRefresh}
                onCreate={() => setViewMode({ kind: 'create' })}
                onEdit={(po) => setViewMode({ kind: 'edit', po })}
                inListPeriod={inListPeriod}
                periodLabel={pLabel}
                buildDetailUrl={(poNumber) => `${window.location.origin}/?screen=pembelian&po=${encodeURIComponent(poNumber)}`}
              />
```

- [ ] **Step 11: Update the empty-state and Detail-button click in `OrdersTab`**

Inside `OrdersTab`, find the `{filtered.length === 0 ? ( ... ) : ...}` block. Replace the empty state with:

```tsx
          {filtered.length === 0 ? (
            <div className="py-16 text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-gray-100 text-gray-400 mb-3">
                <SearchX className="w-6 h-6" />
              </div>
              <p className="text-sm text-gray-500">
                Tidak ada purchase order di periode <span className="font-semibold">{periodLabel}</span>.
              </p>
              <p className="text-xs text-gray-400 mt-1">Coba periode lain, atau buat PO baru.</p>
            </div>
          ) : (
            filtered.map(po => ( /* existing row JSX */ ))
          )}
```

(You will need to add the `SearchX` import: see Step 1 — already in the list.)

Within the row's action cell, find the existing `<button onClick={() => setDetailPo(po)} ...>Detail</button>` (line 349) and replace with:

```tsx
                  <button
                    onClick={() => {
                      const url = buildDetailUrl(po.po_number);
                      const win = window.open(url, '_blank');
                      if (!win) {
                        showToast('Aktifkan popup untuk membuka PO di tab baru.', 'warning');
                      }
                    }}
                    className="text-xs text-gray-500 px-2 py-1 rounded border border-gray-200 hover:bg-gray-50"
                  >
                    Detail
                  </button>
```

- [ ] **Step 12: Delete the old `PoDetailView` modal usage**

In `OrdersTab`, find and remove the `const [detailPo, setDetailPo] = useState<DbPurchaseOrder | null>(null);` line and the `{detailPo && (<PoDetailView ... />)}` block. The modal is gone — the detail tab replaces it.

The `replaceItem` modal (`ReceiveReplacementModal`) was opened FROM inside `PoDetailView`. After this delete, the row no longer has access to "Receive Replacement" — but that flow now lives inside `PembelianDetailPage` (built in Task 7). So also remove:

```tsx
  const [replaceItem, setReplaceItem] = useState<DbPurchaseOrderItem | null>(null);
```

and the `{replaceItem && (...)}` block at the bottom.

- [ ] **Step 13: Update `Buat PO Baru` button with the Plus icon**

Find the `<button onClick={onCreate} ...>Buat PO Baru</button>` button (around line 282) and update:

```tsx
          <button
            onClick={onCreate}
            className="flex items-center gap-2 bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-indigo-700"
          >
            <Plus className="w-4 h-4" /> Buat PO Baru
          </button>
```

- [ ] **Step 14: Verify lint passes**

Run: `npm run lint`
Expected: 0 errors. (`PembelianDetailPage` import will resolve once Task 7 creates the file; if lint runs RIGHT NOW it will fail on the missing module. That's fine — proceed to Task 7 first and re-run lint at the end of that task.)

If lint still fails for any reason other than the missing `PembelianDetailPage` module, fix before continuing.

- [ ] **Step 15: Do NOT commit yet**

The tree still references `./pembelian/PembelianDetailPage` (which doesn't exist). Commit at the end of Task 8.

---

## Task 6: Light helper — pull `formatRupiah` / status maps into reusable form

**Files:**
- Modify: `src/components/PembelianScreen.tsx` (only if needed to share helpers with PembelianDetailPage)

Optional optimisation: `formatRupiah`, `STATUS_BADGE`, and `LEFT_BORDER` are needed by both `PembelianScreen` and the new detail page. Two reasonable approaches:

- **A:** Duplicate in both files. Cheap; both copies are tiny.
- **B:** Lift to `src/components/pembelian/poFormat.ts` and import from both.

**Use A.** Spec is short, the constants are 6 lines each, and YAGNI says don't extract for two consumers. If a third consumer appears, lift then.

No code changes here — this task only records the decision. No commit.

---

## Task 7: `PembelianDetailPage.tsx` — full-page standalone view

**Files:**
- Create: `src/components/pembelian/PembelianDetailPage.tsx`

The detail page replaces `PoDetailView` (modal). It has its own data fetch via `fetchByNumber`, status-driven action buttons, embeds `ReceiveGoodsModal` / `MarkAsPaidModal` / `ReceiveReplacementModal` / `PurchaseOrderFormPage` (for inline edit), and renders a loading skeleton / not-found state.

- [ ] **Step 1: Create the file**

```tsx
// src/components/pembelian/PembelianDetailPage.tsx
//
// Full-page standalone PO detail, opened in a new browser tab via the
// query-string route ?screen=pembelian&po=<po_number>. Replaces the
// PoDetailView modal. No sidebar — the X button closes the tab; to navigate
// elsewhere the operator returns to the list tab.

import React, { useState, useEffect } from 'react';
import {
  X, Printer, FileText, ShoppingCart, ArrowLeft, SearchX, Trash2, CheckCircle2,
} from 'lucide-react';
import {
  DbPurchaseOrder, DbPurchaseOrderItem, DbSupplier, DbCompanySettings,
  StockItem, PermissionSet,
} from '../../types';
import { purchaseOrderService } from '../../lib/pembelianService';
import { companySettingsService, adminUsersService } from '../../lib/supabaseClient';
import { generatePoPdf } from '../../lib/pdf/purchaseOrderPdf';
import ReceiveGoodsModal from './ReceiveGoodsModal';
import MarkAsPaidModal from './MarkAsPaidModal';
import ReceiveReplacementModal from './ReceiveReplacementModal';
import PurchaseOrderFormPage from './PurchaseOrderFormPage';

interface PembelianDetailPageProps {
  poNumber: string;
  stockList: StockItem[];
  suppliers: DbSupplier[];
  orders: DbPurchaseOrder[];   // for PurchaseOrderFormPage's usage-count sort when editing
  currentUserId?: string;
  currentUserPermissions?: PermissionSet;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onStockRefresh: () => void;
  onBackToList: () => void;    // called by the empty-state button when there's no opener tab
}

const DAMAGE_STATUS_OPTIONS = [
  { value: 'NONE',           label: 'None' },
  { value: 'PENDING_RETURN', label: 'Pending Return' },
  { value: 'RETURNED',       label: 'Returned' },
  { value: 'REPLACED',       label: 'Replaced' },
];
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', ORDERED: 'Dipesan', RECEIVED: 'Diterima', PAID: 'Lunas',
};
function formatRupiah(n: number): string { return 'Rp ' + Math.round(n).toLocaleString('id-ID'); }
function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PembelianDetailPage({
  poNumber, stockList, suppliers, orders,
  currentUserId, currentUserPermissions,
  showToast, onStockRefresh, onBackToList,
}: PembelianDetailPageProps) {
  const [po, setPo] = useState<DbPurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Modal state
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [replaceItem, setReplaceItem] = useState<DbPurchaseOrderItem | null>(null);

  // Inline edit mode (for DRAFT)
  const [editMode, setEditMode] = useState(false);

  // PDF/print helpers
  const [companySettings, setCompanySettings] = useState<DbCompanySettings | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);

  async function fetchPo() {
    setLoading(true);
    setNotFound(false);
    try {
      const row = await purchaseOrderService.fetchByNumber(poNumber);
      if (!row) {
        setNotFound(true);
        setPo(null);
      } else {
        setPo(row);
        document.title = `${row.po_number} — Pembelian`;
      }
    } catch (e: any) {
      console.error('Load detail error:', e);
      showToast(e?.message ?? 'Gagal memuat detail PO.', 'warning');
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    document.title = `${poNumber} — Pembelian`;
    fetchPo();
    companySettingsService.fetch().then(setCompanySettings).catch(() => {});
  }, [poNumber]);

  async function handleDownloadPdf() {
    if (!po || downloadingPdf) return;
    if (!po.supplier) {
      showToast('Data supplier tidak lengkap. Reload halaman.', 'warning');
      return;
    }
    if (!companySettings?.address || !companySettings?.phone) {
      const proceed = confirm('Alamat atau nomor telepon toko belum diisi di Pengaturan. PDF akan tampil tanpa info tersebut. Tetap generate?');
      if (!proceed) return;
    }
    setDownloadingPdf(true);
    try {
      let createdByName = '—';
      if (po.created_by_user_id) {
        try {
          const admins = await adminUsersService.fetchAll();
          const author = admins.find(a => a.id === po.created_by_user_id);
          if (author) createdByName = author.name;
        } catch { /* fallback */ }
      }
      const blob = generatePoPdf({
        po,
        supplier: po.supplier,
        items: po.items ?? [],
        companySettings,
        createdByName,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      if ('download' in a) {
        a.href = url; a.download = `${po.po_number}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
      } else {
        window.open(url, '_blank');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      console.error('PDF generation error:', e);
      showToast('Gagal generate PDF. Coba lagi.', 'warning');
    } finally {
      setDownloadingPdf(false);
    }
  }

  async function handleMarkOrdered() {
    if (!po) return;
    try {
      await purchaseOrderService.markOrdered(po.id);
      showToast(`${po.po_number} ditandai Dipesan.`, 'success');
      fetchPo();
    } catch (e: any) {
      console.error('Mark ordered error:', e);
      showToast(e?.message ?? 'Gagal mengubah status PO.', 'warning');
    }
  }

  async function handleDelete() {
    if (!po) return;
    if (!confirm(`Hapus PO "${po.po_number}"? Tindakan ini tidak bisa dibatalkan.`)) return;
    try {
      await purchaseOrderService.delete(po.id);
      showToast(`${po.po_number} dihapus.`, 'success');
      // Redirect to list URL so the operator isn't stranded on a deleted-PO URL.
      window.location.href = '/?screen=pembelian';
    } catch (e: any) {
      console.error('Delete PO error:', e);
      showToast(e?.message ?? 'Gagal menghapus PO.', 'warning');
    }
  }

  async function handleDamageStatusChange(item: DbPurchaseOrderItem, newStatus: string) {
    setUpdatingItemId(item.id);
    try {
      await purchaseOrderService.updateDamageStatus(item.id, newStatus);
      showToast('Status kerusakan diperbarui.', 'success');
      fetchPo();
    } catch (e: any) {
      console.error('Damage status update error:', e);
      showToast(e?.message ?? 'Gagal memperbarui status.', 'warning');
    } finally {
      setUpdatingItemId(null);
    }
  }

  // --- Render: loading skeleton ---
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3">
          <div className="w-5 h-5 bg-gray-200 rounded animate-pulse" />
          <div className="bg-gray-100 p-2 rounded-lg w-9 h-9 animate-pulse" />
          <div className="space-y-1">
            <div className="h-4 w-40 bg-gray-200 rounded animate-pulse" />
            <div className="h-3 w-56 bg-gray-100 rounded animate-pulse" />
          </div>
        </div>
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          <div className="bg-white rounded-2xl border border-gray-200 p-6 h-24 animate-pulse" />
          <div className="bg-white rounded-2xl border border-gray-200 h-64 animate-pulse" />
        </div>
      </div>
    );
  }

  // --- Render: not found ---
  if (notFound || !po) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3">
          <button onClick={() => window.close()} aria-label="Tutup" className="text-gray-400 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="max-w-2xl mx-auto px-6 py-16">
          <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 text-gray-400 mb-4">
              <SearchX className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-bold text-[#012749]">PO tidak ditemukan</h2>
            <p className="text-sm text-gray-500 mt-2">Nomor PO <span className="font-mono font-semibold">{poNumber}</span> sudah dihapus atau tidak pernah ada.</p>
            <button
              onClick={onBackToList}
              className="mt-6 inline-flex items-center gap-2 bg-[#012749] text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-[#013865]"
            >
              <ArrowLeft className="w-4 h-4" /> Kembali ke Daftar Pembelian
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Render: inline edit mode ---
  if (editMode && po.status === 'DRAFT') {
    return (
      <PurchaseOrderFormPage
        po={po}
        suppliers={suppliers}
        orders={orders}
        stockList={stockList}
        currentUserId={currentUserId}
        currentUserPermissions={currentUserPermissions}
        onBack={() => setEditMode(false)}
        onSaved={() => { setEditMode(false); fetchPo(); }}
        onSupplierAdded={() => { /* suppliers come from parent, no-op here */ }}
        showToast={showToast}
      />
    );
  }

  // --- Render: detail body ---
  const damagedItems = (po.items ?? []).filter(i => i.qty_damaged > 0);

  // Permission-gated action visibility (mirrors row actions on the list)
  const canEdit = currentUserPermissions?.can_edit_po !== false;
  const canDelete = currentUserPermissions?.can_delete_po !== false;
  const canPesan = currentUserPermissions?.can_edit_po !== false;
  const canReceive = currentUserPermissions?.can_receive_po !== false;
  const canPay = currentUserPermissions?.can_mark_po_paid !== false;

  return (
    <div className="min-h-screen bg-gray-50" id="po-print-area">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-3">
          <button onClick={() => window.close()} aria-label="Tutup" className="text-gray-400 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
          <div className="bg-indigo-100 p-2 rounded-lg">
            <ShoppingCart className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-base font-bold text-gray-900">{po.po_number}</h1>
            <p className="text-xs text-gray-500">{po.supplier?.name ?? '—'} · <span className="font-semibold">{STATUS_LABEL[po.status]}</span></p>
          </div>
        </div>

        <div className="flex gap-2 items-center">
          {po.status !== 'DRAFT' && (
            <button
              type="button" onClick={handleDownloadPdf} disabled={downloadingPdf}
              className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50"
            >
              <FileText className="w-3.5 h-3.5" />
              {downloadingPdf ? 'Memproses...' : 'Download PDF'}
            </button>
          )}
          <button onClick={() => window.print()} className="text-xs text-gray-600 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 flex items-center gap-1">
            <Printer className="w-3.5 h-3.5" /> Print
          </button>
          {po.status === 'DRAFT' && canEdit && (
            <button onClick={() => setEditMode(true)} className="text-xs font-semibold text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">Edit</button>
          )}
          {po.status === 'DRAFT' && canPesan && (
            <button onClick={handleMarkOrdered} className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg">Tandai Dipesan</button>
          )}
          {po.status === 'DRAFT' && canDelete && (
            <button onClick={handleDelete} className="flex items-center gap-1 text-xs font-semibold text-rose-600 px-3 py-1.5 rounded-lg border border-rose-200 hover:bg-rose-50">
              <Trash2 className="w-3.5 h-3.5" /> Hapus
            </button>
          )}
          {po.status === 'ORDERED' && canReceive && (
            <button onClick={() => setReceiveOpen(true)} className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg">Terima Barang</button>
          )}
          {po.status === 'RECEIVED' && canPay && (
            <button onClick={() => setPayOpen(true)} className="flex items-center gap-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-lg">
              <CheckCircle2 className="w-3.5 h-3.5" /> Tandai Lunas
            </button>
          )}
        </div>
      </div>

      {/* Print-only header (visible only on print) */}
      <div className="hidden print:block px-5 py-4 border-b border-gray-200">
        {companySettings?.company_name && (
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">{companySettings.company_name}</p>
        )}
        <h1 className="text-lg font-bold text-gray-900">Purchase Order</h1>
        <p className="text-sm text-gray-600">{po.po_number} · {formatDate(po.ordered_at ?? po.created_at)}</p>
        <p className="text-sm text-gray-600">Supplier: {po.supplier?.name ?? '—'}</p>
      </div>

      {/* Body */}
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* PO meta */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 grid grid-cols-3 gap-6 text-sm">
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Tanggal Pesan</p>
            <p className="font-semibold text-gray-800 mt-1">{formatDate(po.ordered_at)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Tanggal Terima</p>
            <p className="font-semibold text-gray-800 mt-1">{formatDate(po.received_at)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Jatuh Tempo</p>
            <p className={`font-semibold mt-1 ${po.payment_due_at ? 'text-amber-600' : 'text-gray-400'}`}>{formatDate(po.payment_due_at)}</p>
          </div>
        </div>

        {/* Items */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Item Pembelian</p>
          </div>
          <div className="grid grid-cols-6 px-3 py-2 bg-gray-50 border-b border-gray-200 text-[11px] font-bold uppercase tracking-wide text-gray-500">
            <span className="col-span-2">Produk</span>
            <span className="text-center">Diterima</span>
            <span className="text-right">Harga Beli</span>
            <span className="text-right">Harga Jual</span>
            <span className="text-right">Margin</span>
          </div>
          {(po.items ?? []).map(item => {
            const stockItem = stockList.find(s => s.sku === item.sku);
            const sellingPrice = stockItem?.price ?? 0;
            const margin = sellingPrice > 0 ? ((sellingPrice - item.unit_cost) / sellingPrice * 100) : 0;
            return (
              <div key={item.id} className="grid grid-cols-6 px-3 py-2.5 border-b border-gray-100 items-center">
                <div className="col-span-2">
                  <div className="font-semibold text-gray-800">{item.product_name}</div>
                  <div className="font-mono text-[11px] text-gray-400">
                    {item.sku}{item.qty_damaged > 0 && <span className="text-rose-500"> · {item.qty_damaged} rusak</span>}
                  </div>
                </div>
                <span className="text-center text-gray-600">{item.qty_received}</span>
                <span className="text-right text-gray-600">{formatRupiah(item.unit_cost)}</span>
                <span className="text-right text-gray-600">{sellingPrice > 0 ? formatRupiah(sellingPrice) : '—'}</span>
                <span className={`text-right font-bold ${margin > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>
                  {sellingPrice > 0 ? `+${margin.toFixed(1)}%` : '—'}
                </span>
              </div>
            );
          })}
          <div className="flex justify-end gap-8 px-3 py-2.5 border-t-2 border-gray-200 bg-gray-50 text-[12px]">
            <div className="text-right text-gray-400 leading-relaxed">
              Subtotal<br />
              {po.tax_rate > 0 && <>PPN ({(po.tax_rate * 100).toFixed(0)}%)<br /></>}
              <strong className="text-gray-700">Total</strong>
            </div>
            <div className="text-right text-gray-600 leading-relaxed min-w-[120px]">
              {formatRupiah(po.subtotal)}<br />
              {po.tax_rate > 0 && <>{formatRupiah(po.tax_amount)}<br /></>}
              <strong className="text-gray-800">{formatRupiah(po.total)}</strong>
            </div>
          </div>
        </div>

        {/* Damaged goods */}
        {damagedItems.length > 0 && (
          <div className="bg-white rounded-2xl border border-rose-200 overflow-hidden print:hidden">
            <div className="flex items-center gap-2 px-6 py-4 border-b border-rose-100">
              <p className="text-xs font-bold uppercase tracking-wide text-rose-500">Barang Rusak</p>
              <span className="bg-rose-100 text-rose-700 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                {damagedItems.reduce((s, i) => s + i.qty_damaged, 0)} item
              </span>
            </div>
            <div className="grid grid-cols-12 px-3 py-2 bg-rose-50 border-b border-rose-200 text-[11px] font-bold uppercase tracking-wide text-rose-400">
              <span className="col-span-3">Produk</span>
              <span className="col-span-1 text-center">Qty</span>
              <span className="col-span-4">Catatan</span>
              <span className="col-span-4 text-center">Status Retur</span>
            </div>
            {damagedItems.map(item => (
              <div key={item.id} className="grid grid-cols-12 px-3 py-2.5 items-center border-b border-rose-100 bg-white last:border-b-0">
                <div className="col-span-3">
                  <div className="font-semibold text-gray-800">{item.product_name}</div>
                  <div className="font-mono text-[11px] text-gray-400">{item.sku}</div>
                </div>
                <span className="col-span-1 text-center font-bold text-rose-600">{item.qty_damaged}</span>
                <span className="col-span-4 text-gray-500 text-[12px]">{item.damage_notes ?? '—'}</span>
                <div className="col-span-4 flex justify-center items-center gap-2">
                  {item.damage_status === 'REPLACED' ? (
                    <span className="text-[12px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg">Replaced</span>
                  ) : (
                    <>
                      <select
                        value={item.damage_status}
                        disabled={updatingItemId === item.id}
                        onChange={e => handleDamageStatusChange(item, e.target.value)}
                        className="text-[12px] border border-amber-200 rounded-lg px-2 py-1 bg-amber-50 text-amber-700 font-semibold focus:outline-none disabled:opacity-50"
                      >
                        {DAMAGE_STATUS_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      {item.damage_status === 'RETURNED' && (
                        <button
                          onClick={() => setReplaceItem(item)}
                          className="text-[12px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-2 py-1 rounded-lg whitespace-nowrap"
                        >
                          Terima Pengganti
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Attachments */}
        {(po.invoice_url || po.payment_proof_url) && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-2 print:hidden">
            {po.invoice_url && (
              <a href={po.invoice_url} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 hover:underline block">Lihat Invoice Supplier</a>
            )}
            {po.payment_proof_url && (
              <a href={po.payment_proof_url} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 hover:underline block">Lihat Bukti Pembayaran</a>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {receiveOpen && (
        <ReceiveGoodsModal
          po={po}
          onClose={() => setReceiveOpen(false)}
          onReceived={() => { setReceiveOpen(false); onStockRefresh(); fetchPo(); }}
          showToast={showToast}
        />
      )}
      {payOpen && (
        <MarkAsPaidModal
          po={po}
          onClose={() => setPayOpen(false)}
          onPaid={() => { setPayOpen(false); fetchPo(); }}
          showToast={showToast}
        />
      )}
      {replaceItem && (
        <ReceiveReplacementModal
          item={replaceItem}
          onClose={() => setReplaceItem(null)}
          onReplaced={() => { setReplaceItem(null); fetchPo(); }}
          showToast={showToast}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Permission keys — verify they exist in `types.ts`**

Run: `grep -nE "can_edit_po|can_delete_po|can_receive_po|can_mark_po_paid" src/types.ts`
Expected: All four permission keys present in `PermissionSet`. If any are missing, check the existing row actions in `PembelianScreen.tsx` to see which keys ARE used (the gating must match list behavior). Adjust the `can*` consts in `PembelianDetailPage` to match the actual permission names used today. **Do not invent new permission keys.**

- [ ] **Step 3: Verify lint passes**

Run: `npm run lint`
Expected: 0 errors. Everything imported above (`PurchaseOrderFormPage`, `ReceiveGoodsModal`, etc.) already exists from earlier work.

- [ ] **Step 4: Do NOT commit yet**

The list-tab Detail button → new tab integration was already wired in Task 5. We'll commit Tasks 3 + 4 + 5 + 7 + 8 together at the end of Task 8 so each commit leaves the tree in a working state.

---

## Task 8: Delete `PoDetailView.tsx`, final lint, smoke

**Files:**
- Delete: `src/components/pembelian/PoDetailView.tsx`

- [ ] **Step 1: Verify no remaining references**

Run: `grep -rn "PoDetailView" src/ 2>&1`
Expected: zero matches. (Task 5 step 1 removed the import; if anything still references it, the lint will catch it, but verify here first.)

- [ ] **Step 2: Delete the file**

Run: `rm src/components/pembelian/PoDetailView.tsx`

- [ ] **Step 3: Verify lint passes**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 4: Run the existing test suite**

Run: `npm run test:integration`
Expected: all existing tests pass, plus the new `dateRange.test.ts` (8+ assertions) passes.

- [ ] **Step 5: Manual smoke — full coverage from spec §9**

Start the dev server: `npm run dev`. In a browser, log in. Open **Pembelian** from the sidebar. Verify each item below:

| # | Behavior | Expected |
|---|---|---|
| 1 | KPI cards visual | Four `rounded-3xl` cards with icon chip top-left, badge top-right, `#012749` extrabold value, hover-lift. |
| 2 | Filter chip switching | Click `30 Hari` → card numbers + list re-compute. Click `90 Hari` → numbers grow. Click `Bulan Ini` → returns to default. |
| 3 | Custom popover | Click Custom → popover opens. Pick Apr 1 → Apr 30 → Terapkan. Cards + list now show only April POs. Custom chip turns brand-blue, label says "April 2026". |
| 4 | Custom validation | Pick `Dari` = May 10, `Sampai` = May 5 → inline rose-600 error appears, Terapkan disabled. |
| 5 | Custom click-outside | Open Custom, click outside the popover → popover closes without applying. |
| 6 | Empty state | Pick a custom range with no POs (e.g., Jan 2025) → list shows search-X icon + "Tidak ada purchase order..." message. |
| 7 | Card 3 ignores filter | Even with `Bulan Ini` selected, Card 3 shows ALL currently-overdue POs (including those ordered months ago). Subtext says "selalu hari ini, tidak ikut filter". |
| 8 | Card 3 alarming state | If overdue total > 0, card has rose-tinted bg + "Tindakan!" badge + AlertTriangle icon in rose. Otherwise gray icon + emerald "Aman" badge. |
| 9 | Detail button → new tab | Click Detail on any row → new browser tab opens at `/?screen=pembelian&po=<id>`. |
| 10 | Detail tab — no sidebar | New tab does NOT show the global sidebar. X close button visible top-left. |
| 11 | Detail tab — tab title | Browser tab title reads `<po_number> — Pembelian`. |
| 12 | Detail tab — loading skeleton | If you reload the detail tab quickly, you see gray skeleton blocks briefly. |
| 13 | Detail tab — actions per status | DRAFT → Edit / Tandai Dipesan / Hapus + Print. ORDERED → Terima Barang + Download PDF + Print. RECEIVED → Tandai Lunas + Download PDF + Print. PAID → Download PDF + Print only. |
| 14 | Detail tab — Edit DRAFT | Click Edit → form replaces detail body in the same tab. Save Draft → returns to detail view. |
| 15 | Detail tab — Terima Barang | On an ORDERED PO, click Terima Barang → existing `ReceiveGoodsModal` opens inside detail tab. Complete the flow → detail refreshes (status now RECEIVED), list tab (switch to it) refreshes on refocus. |
| 16 | Detail tab — Tandai Lunas | On a RECEIVED PO, click Tandai Lunas → `MarkAsPaidModal` opens. Complete → detail status now PAID. |
| 17 | Detail tab — Hapus DRAFT | Click Hapus → confirm → detail tab navigates to `/?screen=pembelian` (list URL). |
| 18 | Detail tab — Print | Cmd-P in detail tab → preview hides action bar + close X (`print:hidden` works). |
| 19 | Detail tab — bad URL | Open `/?screen=pembelian&po=PO-DOES-NOT-EXIST` → empty state with "PO tidak ditemukan" + "Kembali ke Daftar Pembelian" button. |
| 20 | Deep-link auth handoff | Log out. Paste `/?screen=pembelian&po=<existing-po>` in the URL bar. AuthScreen appears. Log in. After login, the detail page loads directly (not the dashboard, not the list). |
| 21 | Sidebar nav clears deep-link | Open Pembelian via deep-link, then click Stok in the sidebar, then click Pembelian again → opens the list, NOT the detail. |
| 22 | Buat PO Baru still in-page | `Buat PO Baru` button → form replaces list in the SAME tab (no new tab). |
| 23 | Edit on DRAFT row still in-page | Edit button on a DRAFT row → form in the same tab. |
| 24 | Laporan untouched | Open Laporan → KPI cards still render identically to before. |
| 25 | A11y smoke | Tab through the filter bar (chips → Custom → date inputs → Terapkan). Tab through the detail page header (X → action buttons). All reachable; focus ring visible; close X has aria-label "Tutup". |

If anything in 1–25 fails, fix before committing.

- [ ] **Step 6: Stop the dev server**

- [ ] **Step 7: Update progress.md**

Open `progress.md` and add this entry at the top (replacing the older spec-only entry that flagged Next steps):

```markdown
## 2026-06-13 — Pembelian: PO detail in new tab + KPI redesign + date filter — IMPLEMENTED

- **What:** Implemented the spec at `docs/superpowers/specs/2026-06-13-pembelian-detail-tab-and-filter-design.md`. Detail button on each PO row now opens a standalone full-page view in a new browser tab via query-string routing (`?screen=pembelian&po=<id>`), replacing the cramped `PoDetailView` modal. Four summary cards adopt the canonical `KpiCard` design system (rounded-3xl, icon chip, badge, `#012749` extrabold value, hover-lift) — extracted from the file-local helper in `LaporanScreen`. Added a date filter bar (Bulan Ini / 30 Hari / 90 Hari / Custom) above the cards; cards 1/2/4 + the list react live, card 3 (Terlambat Bayar) intentionally ignores the filter (subtext clarifies "selalu hari ini, tidak ikut filter").
- **Files:** new `src/lib/dateRange.ts` + `tests/integration/dateRange.test.ts` (8 assertions, all green); new `src/components/ui/KpiCard.tsx` (shared, replaces LaporanScreen file-local helper); new `src/components/pembelian/PembelianDetailPage.tsx` (full-page detail with status-driven actions); modified `src/lib/pembelianService.ts` (added `fetchByNumber`, removed `fetchSummary` — all 4 cards now client-side); modified `src/App.tsx` (URL param parsing on boot, sessionStorage deep-link handoff for auth flow, `initialDetailPoNumber` prop pipeline); modified `src/components/PembelianScreen.tsx` (filter bar, KpiCard adoption, list filter via `inListPeriod`, empty state, `viewMode: 'detail'`, Detail → `window.open`, `visibilitychange` refresh); deleted `src/components/pembelian/PoDetailView.tsx`.
- **Tab-sync:** list tab refreshes on `document.visibilitychange === 'visible'` after operator returns from a detail-tab action. No `BroadcastChannel` needed.
- **Date fields per card** (locked in spec §5.2 and implemented exactly): Card 1 + 4 = `coalesce(ordered_at, created_at)` ("what did I buy"); Card 2 = `payment_due_at` ("what do I owe"); Card 3 = filter-independent.
- **WIB throughout:** `dateRange.resolveRange` / `periodLabel` / `inRange` all parameterise on `wibDateString()` so filter math is correct regardless of operator-local timezone.
- **Print:** detail page's top bar uses `print:hidden`; a print-only company-name header was carried over from the modal.
- **Lint:** `npm run lint` → 0 errors.
- **Tests:** `npm run test:integration` → all pre-existing tests pass + new `dateRange.test.ts` passes (8 assertions covering presets, WIB-boundary case, custom full-month label, year-crossing range, inclusive bounds).
- **Manual smoke pass:** all 25 scenarios in plan §8 Step 5 verified in browser.
- **Next:** none for this spec. Out-of-scope follow-ups (§11) — session-filter persistence, URL-encoded filter, server-side period filter at scale — deferred until requested.
```

- [ ] **Step 8: Commit**

```bash
git add \
  src/lib/dateRange.ts \
  tests/integration/dateRange.test.ts \
  src/components/ui/KpiCard.tsx \
  src/components/LaporanScreen.tsx \
  src/lib/pembelianService.ts \
  src/App.tsx \
  src/components/PembelianScreen.tsx \
  src/components/pembelian/PembelianDetailPage.tsx \
  progress.md

git rm src/components/pembelian/PoDetailView.tsx

git commit -m "$(cat <<'EOF'
feat(pembelian): PO detail in new tab + KPI redesign + date filter

Implements the spec at docs/superpowers/specs/2026-06-13-pembelian-
detail-tab-and-filter-design.md.

- Detail button on each PO row now opens a standalone full-page view
  in a new browser tab via query-string routing (?screen=pembelian
  &po=<id>). PoDetailView modal deleted. App.tsx parses params on
  boot; sessionStorage carries deep-link target across the
  AuthScreen round-trip for logged-out paste-URL flow.
- Four summary cards adopt the canonical KpiCard design system
  (rounded-3xl, icon chip, badge, #012749 extrabold, hover-lift).
  KpiCard extracted to src/components/ui/, LaporanScreen migrated
  off its file-local helper (visual unchanged).
- Date filter bar above the cards: Bulan Ini (default), 30 Hari,
  90 Hari, Custom (range popover with from/sampai inputs and
  inclusive validation). Filter drives cards 1/2/4 and the list.
  Card 3 (Terlambat Bayar) intentionally ignores the filter —
  overdue is a now-state, hiding January's still-unpaid PO behind
  a "Mei 2026" filter would be unsafe.
- Per-card date fields locked: card 1 + 4 filter by
  coalesce(ordered_at, created_at) ("what did I buy"), card 2
  by payment_due_at ("what do I owe"), card 3 filter-independent.
- WIB throughout: dateRange helpers parameterise on wibDateString()
  so chip math is correct regardless of operator-local timezone.
- Tab-sync: list tab refreshes on visibilitychange refocus after
  detail-tab actions. No BroadcastChannel needed.
- purchaseOrderService.fetchSummary() removed — all four cards
  computed client-side from the already-fetched PO list.
- Print preserved (print:hidden top bar, print:block company header).
- Unit tests for dateRange helpers (presets, WIB boundary, custom
  full-month label, year-crossing range, inclusive bounds) pass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage** (every spec section mapped to a task):
- §1 Why → motivates whole plan
- §2 Scope in/out → §11 explicitly preserves Buat PO Baru / Edit row (Step 9 of Task 5; smoke #22, #23)
- §3.1 URL shape → Task 4 Step 2 + Task 5 Step 11 (`buildDetailUrl`)
- §3.2 Boot parsing → Task 4 Step 2
- §3.2.1 Auth deep-link handoff → Task 4 Step 3
- §3.3 Detail entry contract → Task 5 Step 4 (useEffect on initialDetailPoNumber)
- §3.4 Closing detail tab → Task 7 Step 1 (`window.close()`)
- §3.5 Tab-sync visibilitychange → Task 5 Step 4
- §4.1 Filter bar layout → Task 5 Steps 7 + 8
- §4.1.1 Custom popover → Task 5 Step 8
- §4.2 KPI cards mapping table → Task 5 Step 6
- §4.3 List filter + empty state → Task 5 Steps 10 + 11
- §4.4 Detail page (sidebar absent, tab title, loading skeleton, print classes, status-driven actions, error state, Hapus redirect) → Task 7 Step 1
- §5.1 fetchByNumber → Task 3 Step 1
- §5.2 fetchSummary removed + per-card date field table → Task 3 Step 2 + Task 5 Step 5
- §5.3 Filter state shape → Task 1 (type) + Task 5 Step 2 (state)
- §5.4 resolveRange + WIB → Task 1
- §6 Edit-in-tab locked behavior → Task 7 Step 1 (`editMode` branch)
- §7 Component map → Task table at the top of this plan
- §7.1 KpiCard props → Task 2 Step 1
- §8 Edge cases (paste URL, refresh, deleted PO, popup blocker, future-date custom, etc.) → Tasks 4, 5, 7 + smoke list
- §9 Testing (unit + manual smoke + permission + a11y) → Tasks 1 + 8 Step 5
- §10 Rollout (single deploy, no migration, no flag) → Task 8 Step 8 (single commit)
- §11 Out-of-scope follow-ups → notes only; no tasks

**Placeholder scan:** none. Every step has the actual code or command an engineer needs.

**Type consistency:**
- `FilterState`, `FilterPreset`, `ResolvedRange` defined in Task 1, used in Task 5 — same names.
- `KpiCardProps` defined in Task 2, used in Task 5 — same names.
- `PembelianScreenProps` extended in Task 5 Step 1 (`initialDetailPoNumber`, `onDetailConsumed`), referenced from App.tsx in Task 4 Step 5 — same names.
- `PembelianDetailPageProps` (Task 7 Step 1) consumed by Task 5 Step 9 — same names.
- `fetchByNumber` signature consistent between Task 3 (definition) and Task 7 (consumption).

**Risk note:** Task 5 is large and inter-dependent (filter state, view-mode router, OrdersTab props, click handler swap). The steps are ordered so each one leaves a coherent file; lint is deferred to after Task 7 because the new `PembelianDetailPage` import is added before the file exists. If executing inline, complete Tasks 5 + 7 in one sitting before running lint.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-13-pembelian-detail-tab-and-filter.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for this plan since Task 5 is long and benefits from focused review.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Faster context flow but more to hold in head.

**Which approach?**
