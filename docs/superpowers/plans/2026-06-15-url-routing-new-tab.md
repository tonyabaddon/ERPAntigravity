# URL Routing & "Buka di Tab Baru" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User bisa buka sidebar item di browser tab baru via Ctrl/Cmd+click, middle-click, right-click "Open in new tab" — sebagai konsekuensi URL jadi single source of truth (F5/back/forward/bookmark/share langsung jalan).

**Architecture:** Custom hook `src/lib/urlRoute.ts` (zero new runtime deps) — pure functions (`buildHref`, `parseSearch`, `shouldInterceptClick`) untuk unit test, plus DOM-touching helpers (`navigate`, `useURLRoute`, `handleSPAClick`) untuk integrasi. `App.tsx` refactor: `useState<ActivePage>` → derived dari `useURLRoute()`, 24 call sites `setActivePage` jadi `navigate()`. `Sidebar.tsx` `<button>` → `<a href={buildHref(id)} onClick={handleSPAClick(...)}>`.

**Tech Stack:** React 19 + Vite 6 + TypeScript + Vitest (existing). Tidak install router lib, tidak install jsdom — pure functions saja yang di-unit-test, DOM-touching pakai manual smoke test di `npm run dev`.

**Spec:** `docs/superpowers/specs/2026-06-15-url-routing-new-tab-design.md`

---

## File Structure

**Create:**
- `src/lib/urlRoute.ts` — semua routing primitive di satu file:
  - Pure: `ACTIVE_PAGES` (Set untuk validation), `buildHref`, `parseSearch`, `shouldInterceptClick`
  - DOM: `navigate`, `useURLRoute` (React hook), `handleSPAClick`
- `src/lib/urlRoute.test.ts` — unit tests untuk pure functions saja

**Modify:**
- `src/App.tsx` — replace `useState<ActivePage>` dengan `useURLRoute()` driven; semua `setActivePage(x)` → `navigate(x[, params])`; generalize deep-link block (drop `if (screen !== 'pembelian') return;`); generalize sessionStorage post-login restore; tambah `replaceState` untuk fallback paths.
- `src/components/Sidebar.tsx` — `<button onClick>` jadi `<a href onClick={handleSPAClick}>`.

**NOT touched:**
- `package.json` (zero new runtime deps).
- Screen components (DashboardScreen, PelangganScreen, dll) — props shape tidak berubah.
- `OrderBnlSection.tsx`, `BelanjaNumpangLewatDetailPage.tsx` — `window.open` existing biarkan.
- Supabase auth flow.

---

### Task 1: Create `urlRoute.ts` with `buildHref` (pure)

**Files:**
- Create: `src/lib/urlRoute.ts`
- Test: `src/lib/urlRoute.test.ts`

- [ ] **Step 1: Write failing test for `buildHref`**

Create `src/lib/urlRoute.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import { buildHref } from './urlRoute';

describe('urlRoute.buildHref', () => {
  test('no params returns ?screen=<screen>', () => {
    expect(buildHref('dashboard')).toBe('?screen=dashboard');
  });

  test('with single param', () => {
    expect(buildHref('pembelian', { po: 'PO-001' })).toBe('?screen=pembelian&po=PO-001');
  });

  test('with multiple params (sorted by key for deterministic output)', () => {
    expect(buildHref('pembelian', { po: 'PO-001', tab: 'detail' })).toBe('?screen=pembelian&po=PO-001&tab=detail');
  });

  test('encodes special characters', () => {
    expect(buildHref('pembelian', { po: 'PO/2026#1' })).toBe('?screen=pembelian&po=PO%2F2026%231');
  });

  test('drops undefined / null / empty string params (no key=&)', () => {
    expect(buildHref('pelanggan', { customer: '' })).toBe('?screen=pelanggan');
    expect(buildHref('pelanggan', { customer: undefined as unknown as string })).toBe('?screen=pelanggan');
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

Run: `npx vitest run src/lib/urlRoute.test.ts`
Expected: FAIL with `Cannot find module './urlRoute'` or similar.

- [ ] **Step 3: Implement `buildHref`**

Create `src/lib/urlRoute.ts`:

```typescript
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ActivePage } from '../types';

/**
 * Pure: build URL query string for a screen + params.
 * Used as `href` attribute on anchor tags so Ctrl+click / middle-click / right-click
 * open-in-new-tab work natively via the browser.
 */
export function buildHref(screen: ActivePage, params?: Record<string, string | undefined | null>): string {
  const search = new URLSearchParams();
  search.set('screen', screen);
  if (params) {
    // Sort keys for deterministic output (makes tests stable and URLs predictable).
    const keys = Object.keys(params).sort();
    for (const key of keys) {
      const value = params[key];
      if (value === undefined || value === null || value === '') continue;
      search.set(key, value);
    }
  }
  return '?' + search.toString();
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npx vitest run src/lib/urlRoute.test.ts`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: tsc check**

Run: `npm run lint` (which is `tsc --noEmit`)
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/urlRoute.ts src/lib/urlRoute.test.ts
git commit -m "feat(routing): urlRoute.ts — buildHref pure URL builder

First piece of URL-routing primitive. Pure function used for anchor
hrefs in sidebar + future in-screen tabs. Tests cover encoding,
multi-param sorting, and undefined/null/empty param drop behavior.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add `parseSearch` + `ACTIVE_PAGES` validation

**Files:**
- Modify: `src/lib/urlRoute.ts`
- Test: `src/lib/urlRoute.test.ts`

- [ ] **Step 1: Write failing tests for `parseSearch`**

Append to `src/lib/urlRoute.test.ts`:

```typescript
import { parseSearch } from './urlRoute';

describe('urlRoute.parseSearch', () => {
  test('empty string returns dashboard + empty params', () => {
    expect(parseSearch('')).toEqual({ screen: 'dashboard', params: {} });
  });

  test('?screen=dashboard returns dashboard + empty params', () => {
    expect(parseSearch('?screen=dashboard')).toEqual({ screen: 'dashboard', params: {} });
  });

  test('?screen=pembelian&po=PO-001 returns pembelian + po param', () => {
    expect(parseSearch('?screen=pembelian&po=PO-001')).toEqual({
      screen: 'pembelian',
      params: { po: 'PO-001' },
    });
  });

  test('unknown screen falls back to dashboard', () => {
    expect(parseSearch('?screen=xyz-not-real')).toEqual({ screen: 'dashboard', params: {} });
  });

  test('missing screen param falls back to dashboard', () => {
    expect(parseSearch('?other=value')).toEqual({ screen: 'dashboard', params: { other: 'value' } });
  });

  test('decodes URL-encoded values', () => {
    expect(parseSearch('?screen=pembelian&po=PO%2F2026%231')).toEqual({
      screen: 'pembelian',
      params: { po: 'PO/2026#1' },
    });
  });

  test('handles search without leading "?"', () => {
    expect(parseSearch('screen=dashboard')).toEqual({ screen: 'dashboard', params: {} });
  });
});
```

- [ ] **Step 2: Run tests, confirm fail**

Run: `npx vitest run src/lib/urlRoute.test.ts`
Expected: FAIL — `parseSearch is not a function`.

- [ ] **Step 3: Implement `parseSearch` + `ACTIVE_PAGES`**

Append to `src/lib/urlRoute.ts`:

```typescript
/**
 * Authoritative whitelist of valid screens. Mirrors the `ActivePage` union
 * in src/types.ts. Used to silently fall back to 'dashboard' when a URL
 * carries an unknown screen value (e.g. typo, deprecated screen, malicious).
 *
 * NOTE: when adding a new entry to ActivePage, add it here too.
 */
export const ACTIVE_PAGES: ReadonlySet<ActivePage> = new Set<ActivePage>([
  'dashboard',
  'sales-inbox',
  'ai-stock',
  'manajemen-gudang',
  'stok-opname',
  'user-management',
  'notifications',
  'auth',
  'whatsapp-ai',
  'settings',
  'pipeline',
  'order-history',
  'pelanggan',
  'laporan',
  'pembelian',
  'kasir',
  'penjualanBaru',
  'persetujuan',
  'rekonsiliasi',
  'wip-list',
  'penjualan',
]);

export interface RouteState {
  screen: ActivePage;
  params: Record<string, string>;
}

/**
 * Pure: parse a query-string ("?key=val&...") into a RouteState.
 * Unknown screens silently fall back to 'dashboard' (web-standard behavior).
 */
export function parseSearch(search: string): RouteState {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const rawScreen = params.get('screen') ?? '';
  const screen: ActivePage = ACTIVE_PAGES.has(rawScreen as ActivePage)
    ? (rawScreen as ActivePage)
    : 'dashboard';
  // Strip the `screen` key from params output — it's already on the state object.
  params.delete('screen');
  const out: Record<string, string> = {};
  params.forEach((value, key) => { out[key] = value; });
  return { screen, params: out };
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npx vitest run src/lib/urlRoute.test.ts`
Expected: PASS — 12 tests pass (5 from Task 1 + 7 from Task 2).

- [ ] **Step 5: tsc check**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/urlRoute.ts src/lib/urlRoute.test.ts
git commit -m "feat(routing): parseSearch + ACTIVE_PAGES whitelist

Pure parser for query-string → RouteState. Unknown screen values
silently fall back to dashboard. ACTIVE_PAGES Set mirrors ActivePage
union as authoritative whitelist for validation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Add `shouldInterceptClick` (pure)

**Files:**
- Modify: `src/lib/urlRoute.ts`
- Test: `src/lib/urlRoute.test.ts`

- [ ] **Step 1: Write failing tests for `shouldInterceptClick`**

Append to `src/lib/urlRoute.test.ts`:

```typescript
import { shouldInterceptClick } from './urlRoute';

// Minimal MouseEvent-like shape — only the fields the function reads.
type MockEvent = {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

const ev = (overrides: Partial<MockEvent> = {}): MockEvent => ({
  button: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides,
});

describe('urlRoute.shouldInterceptClick', () => {
  test('plain left-click → intercept (true)', () => {
    expect(shouldInterceptClick(ev())).toBe(true);
  });

  test('Ctrl+left-click → no intercept (false)', () => {
    expect(shouldInterceptClick(ev({ ctrlKey: true }))).toBe(false);
  });

  test('Cmd+left-click → no intercept (false)', () => {
    expect(shouldInterceptClick(ev({ metaKey: true }))).toBe(false);
  });

  test('Shift+left-click → no intercept (false)', () => {
    expect(shouldInterceptClick(ev({ shiftKey: true }))).toBe(false);
  });

  test('Alt+left-click → no intercept (false)', () => {
    expect(shouldInterceptClick(ev({ altKey: true }))).toBe(false);
  });

  test('middle-click (button=1) → no intercept (false)', () => {
    expect(shouldInterceptClick(ev({ button: 1 }))).toBe(false);
  });

  test('right-click (button=2) → no intercept (false)', () => {
    // React onClick does not fire for right-click in practice; still test defensively.
    expect(shouldInterceptClick(ev({ button: 2 }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, confirm fail**

Run: `npx vitest run src/lib/urlRoute.test.ts`
Expected: FAIL — `shouldInterceptClick is not a function`.

- [ ] **Step 3: Implement `shouldInterceptClick`**

Append to `src/lib/urlRoute.ts`:

```typescript
/**
 * Pure: decide whether this click should be intercepted for SPA navigation
 * (preventDefault + pushState) or left to the browser's native handling
 * (which is what opens new tabs / new windows).
 *
 * Intercept only plain left-click. Any modifier (Ctrl/Cmd/Shift/Alt) or
 * non-left button falls through to the browser.
 */
export function shouldInterceptClick(e: {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  if (e.button !== 0) return false;
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return false;
  return true;
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npx vitest run src/lib/urlRoute.test.ts`
Expected: PASS — 19 tests pass (12 prior + 7 new).

- [ ] **Step 5: tsc check**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/urlRoute.ts src/lib/urlRoute.test.ts
git commit -m "feat(routing): shouldInterceptClick — modifier-key gating logic

Pure predicate that decides SPA-navigate vs browser-native handling.
Plain left-click → intercept. Any modifier or non-left-button → let
the browser open new tab / new window.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Add `navigate` + `handleSPAClick` + `useURLRoute` (DOM-touching)

**Files:**
- Modify: `src/lib/urlRoute.ts`

DOM-touching functions are NOT unit tested (no jsdom dep). Manual smoke test in Task 7 verifies these work end-to-end.

- [ ] **Step 1: Implement `navigate`, `handleSPAClick`, `useURLRoute`**

Append to `src/lib/urlRoute.ts`:

```typescript
import { useSyncExternalStore } from 'react';
import type React from 'react';

const ROUTE_CHANGE_EVENT = 'urlroute:change';

/**
 * Push a new URL into history and notify subscribers. Used for in-place
 * SPA navigation (the path triggered by plain left-click — modifier-key
 * clicks bypass this and let the browser handle).
 */
export function navigate(screen: ActivePage, params?: Record<string, string | undefined | null>): void {
  const href = buildHref(screen, params);
  window.history.pushState({}, '', href);
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
}

/**
 * Replace the current URL without adding to history. Use for fallback
 * cases (unknown screen, permission denied) where we want the URL to
 * reflect reality but not pollute back-button history.
 */
export function replaceRoute(screen: ActivePage, params?: Record<string, string | undefined | null>): void {
  const href = buildHref(screen, params);
  window.history.replaceState({}, '', href);
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
}

/**
 * Click handler for anchor tags that should behave as SPA navigation
 * on plain left-click and as native browser navigation (new tab, new
 * window) under any modifier key.
 *
 * Usage:
 *   <a href={buildHref('pelanggan')}
 *      onClick={(e) => handleSPAClick(e, 'pelanggan')}>
 *     Pelanggan
 *   </a>
 */
export function handleSPAClick(
  e: React.MouseEvent,
  screen: ActivePage,
  params?: Record<string, string | undefined | null>,
): void {
  if (!shouldInterceptClick(e)) return;
  e.preventDefault();
  navigate(screen, params);
}

/**
 * React hook returning the current route. Re-renders the component
 * whenever the route changes via navigate(), replaceRoute(), or the
 * browser's back/forward buttons.
 *
 * Implemented via useSyncExternalStore for safety with React 19
 * concurrent rendering.
 */
function subscribe(callback: () => void): () => void {
  window.addEventListener('popstate', callback);
  window.addEventListener(ROUTE_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener(ROUTE_CHANGE_EVENT, callback);
  };
}

// Cache the last-parsed route so useSyncExternalStore can return a stable
// reference between renders when the URL hasn't actually changed. Without
// this, every render would parse and create a fresh object → infinite loop
// or unnecessary work.
let lastSearch: string | null = null;
let lastRoute: RouteState = { screen: 'dashboard', params: {} };
function getSnapshot(): RouteState {
  const current = window.location.search;
  if (current !== lastSearch) {
    lastSearch = current;
    lastRoute = parseSearch(current);
  }
  return lastRoute;
}
function getServerSnapshot(): RouteState {
  return { screen: 'dashboard', params: {} };
}

export function useURLRoute(): RouteState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
```

- [ ] **Step 2: Run all urlRoute tests to confirm nothing broke**

Run: `npx vitest run src/lib/urlRoute.test.ts`
Expected: PASS — still 19 tests pass.

- [ ] **Step 3: tsc check**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/urlRoute.ts
git commit -m "feat(routing): navigate, replaceRoute, handleSPAClick, useURLRoute hook

DOM-touching helpers built on top of the pure primitives. navigate
pushes a new URL + dispatches a custom event. useURLRoute uses
useSyncExternalStore for React 19 concurrent-safe subscription to
both popstate (back/forward) and the custom event. handleSPAClick
composes shouldInterceptClick + preventDefault + navigate.

Manual smoke tests verify end-to-end in Task 7 (no jsdom test dep).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Refactor `Sidebar.tsx` — `<button>` → `<a href onClick>`

**Files:**
- Modify: `src/components/Sidebar.tsx` (line 185-217 — the `itemsInCategory.map` block)

- [ ] **Step 1: Add imports**

In `src/components/Sidebar.tsx`, find the existing import block (~line 26):

```typescript
import { ActivePage, PermissionSet } from '../types';
```

Add below it:

```typescript
import { buildHref, handleSPAClick } from '../lib/urlRoute';
```

- [ ] **Step 2: Replace `<button>` with `<a>` in the menu loop**

Find this block (currently at line 185-217):

```tsx
{itemsInCategory.map(item => {
  const IconComponent = item.icon;
  const isActive = activePage === item.id;
  return (
    <button
      key={item.id}
      onClick={() => onPageChange(item.id)}
      className={`w-full flex items-center gap-3 py-2.5 px-4 rounded-full text-left transition-all duration-200 cursor-pointer group/item ${
        isActive
          ? 'bg-white/15 text-emerald-300 font-bold shadow-lg shadow-white/5'
          : 'text-white/70 hover:bg-white/10 hover:text-white'
      }`}
      title={!isExpanded ? item.label : undefined}
    >
      <div className="relative shrink-0">
        <IconComponent className={`w-5 h-5 transition-transform duration-200 group-hover/item:scale-110 ${isActive ? 'text-emerald-300' : ''}`} />
        {item.id === 'persetujuan' && pendingCount > 0 && !isExpanded && (
          <span className="absolute -top-1.5 -right-1.5">
            <PendingApprovalBadge count={pendingCount} size="sm" />
          </span>
        )}
      </div>
      <span className={`text-sm font-semibold flex-1 whitespace-nowrap transition-opacity duration-300 ${isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        {item.label}
      </span>
      {item.id === 'persetujuan' && pendingCount > 0 && isExpanded && (
        <span className="transition-opacity duration-300 opacity-100 shrink-0">
          <PendingApprovalBadge count={pendingCount} size="md" />
        </span>
      )}
    </button>
  );
})}
```

Replace with:

```tsx
{itemsInCategory.map(item => {
  const IconComponent = item.icon;
  const isActive = activePage === item.id;
  return (
    <a
      key={item.id}
      href={buildHref(item.id)}
      onClick={(e) => {
        handleSPAClick(e, item.id);
        // SPA path: still notify parent so existing side-effects (e.g. clearing
        // openCustomerId / initialDetailPoNumber in App.tsx) run. The parent
        // currently treats onPageChange as the canonical entrypoint; once the
        // App.tsx refactor lands (Task 6) this becomes a no-op because the
        // parent reads from useURLRoute() directly. Keep the call for now to
        // make this task independently shippable.
        if (e.defaultPrevented) onPageChange(item.id);
      }}
      className={`w-full flex items-center gap-3 py-2.5 px-4 rounded-full text-left transition-all duration-200 cursor-pointer group/item no-underline ${
        isActive
          ? 'bg-white/15 text-emerald-300 font-bold shadow-lg shadow-white/5'
          : 'text-white/70 hover:bg-white/10 hover:text-white'
      }`}
      title={!isExpanded ? item.label : undefined}
    >
      <div className="relative shrink-0">
        <IconComponent className={`w-5 h-5 transition-transform duration-200 group-hover/item:scale-110 ${isActive ? 'text-emerald-300' : ''}`} />
        {item.id === 'persetujuan' && pendingCount > 0 && !isExpanded && (
          <span className="absolute -top-1.5 -right-1.5">
            <PendingApprovalBadge count={pendingCount} size="sm" />
          </span>
        )}
      </div>
      <span className={`text-sm font-semibold flex-1 whitespace-nowrap transition-opacity duration-300 ${isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        {item.label}
      </span>
      {item.id === 'persetujuan' && pendingCount > 0 && isExpanded && (
        <span className="transition-opacity duration-300 opacity-100 shrink-0">
          <PendingApprovalBadge count={pendingCount} size="md" />
        </span>
      )}
    </a>
  );
})}
```

Three differences vs. original:
1. Tag: `<button>` → `<a>`
2. Added `href={buildHref(item.id)}` so Ctrl/middle-click work natively
3. `onClick`: now calls `handleSPAClick` first; if it intercepted (preventDefault called), also notifies parent via `onPageChange` to preserve existing side-effect contract in App.tsx until Task 6
4. `className` adds `no-underline` (defensive against default anchor styling)

- [ ] **Step 3: tsc check**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 4: Manual smoke test (sidebar only — App.tsx not refactored yet)**

Run: `npm run dev` (port 3000). In Chrome:
1. Login normally.
2. Click sidebar items — should navigate in-place; URL bar should now show `?screen=...` updating per click.
3. Ctrl+click (or Cmd+click on Mac) a sidebar item — new tab opens, loads the corresponding screen (deep-link via the existing `?screen=pembelian&po=...` handler only works for `pembelian`; other screens will land on dashboard at this stage — that's expected and fixed in Task 6).
4. Middle-click a sidebar item — new tab opens (same caveat).
5. Right-click a sidebar item — browser native menu shows "Open in new tab".
6. F5 — current state: refreshing on a non-pembelian screen still falls back to dashboard. **This is the gap that Task 6 closes.**

If steps 2-5 work, this task is done. Step 6 is a known-incomplete state.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat(routing): Sidebar items become <a href> with handleSPAClick

Each sidebar entry is now an anchor tag, so Ctrl/Cmd+click, middle-click,
and right-click "Open in new tab" all work via native browser handling.
Plain left-click still calls onPageChange for App.tsx side-effects until
the App.tsx URL-driven refactor lands in the next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Refactor `App.tsx` — `useURLRoute()` driven state

**Files:**
- Modify: `src/App.tsx` (24 `setActivePage` call sites + 3 derived states)

This is the meaty refactor. Single-file sweep. **Do all changes in one commit** — partial state across files would be inconsistent.

- [ ] **Step 1: Add import + read route**

In `src/App.tsx`, add to the existing import block (~line 21):

```typescript
import { useURLRoute, navigate, replaceRoute, ACTIVE_PAGES } from './lib/urlRoute';
import type { RouteState } from './lib/urlRoute';
```

Replace lines 54-60 (the `useState` declarations):

```typescript
export default function App() {
  // Gating system: start at 'auth' or direct bypass for immediate interaction 
  const [activePage, setActivePage] = useState<ActivePage>('auth');
  const [openCustomerId, setOpenCustomerId] = useState<string | null>(null);
  const [initialDetailPoNumber, setInitialDetailPoNumber] = useState<string | null>(null);
  const [penjualanInitialChannel, setPenjualanInitialChannel] = useState<KasirChannel | undefined>(undefined);
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; role: string; permissions: PermissionSet; avatarUrl: string; storeName: string } | null>(null);
```

With:

```typescript
export default function App() {
  // URL is single source of truth for navigation. activePage and screen-scoped
  // params (customer, po, channel) all derive from the current route.
  const route = useURLRoute();
  // Pre-auth, activePage is forced to 'auth' regardless of URL — the AuthScreen
  // gate below uses `!currentUser` to decide what to render. Post-auth, the URL
  // wins.
  const activePage: ActivePage = route.screen;
  const openCustomerId: string | null = route.params.customer ?? null;
  const initialDetailPoNumber: string | null = route.params.po ?? null;
  // Validate channel param against KasirChannel; invalid → undefined.
  const penjualanInitialChannel: KasirChannel | undefined = isKasirChannel(route.params.channel)
    ? (route.params.channel as KasirChannel)
    : undefined;
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; role: string; permissions: PermissionSet; avatarUrl: string; storeName: string } | null>(null);
```

- [ ] **Step 2: Add `isKasirChannel` helper near top of file**

After the imports, before `export default function App()`, add:

```typescript
// Local type guard for the channel URL param. Defensive — if URL is hand-edited
// with a bogus channel, fall back to undefined (UI shows default channel picker).
function isKasirChannel(value: string | undefined): value is KasirChannel {
  if (!value) return false;
  // Mirror the union shape — keep this list in sync with the KasirChannel type.
  // (No runtime values in TS unions; manual whitelist is the standard pattern.)
  return ['offline', 'tokopedia', 'shopee', 'tiktok', 'lazada', 'blibli', 'whatsapp', 'walkin', 'bukalapak', 'transfer', 'reseller', 'qris', 'corporate', 'voucher'].includes(value);
}
```

Verify the channel list matches the actual `KasirChannel` union by reading `src/types.ts` and the existing `src/lib/salesChannels.ts` `CHANNEL_VISUAL` keys. Adjust as needed.

- [ ] **Step 3: Generalize the deep-link mount effect**

Replace lines 77-100 (the original `useEffect` reading deep-link params):

```typescript
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

With:

```typescript
  // Read deep-link query params on boot. URL is already source of truth for
  // logged-in users (useURLRoute reads it directly). For logged-out users,
  // we stash the route in sessionStorage so we can restore after login.
  useEffect(() => {
    if (currentUser) return; // Logged in — URL already drives state.
    const search = window.location.search;
    if (!search || search === '?') return;
    try {
      sessionStorage.setItem('pendingDeepLink', search);
    } catch {
      // sessionStorage unavailable (e.g., private window quota) — ignore.
    }
  }, []);
```

- [ ] **Step 4: Update post-login restore in the auth-restore effect**

Find lines 134-153 in the existing `supabase.auth.getSession()` block:

```typescript
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
        // Use functional setter: if activePage has already been moved off 'auth'
        // by a prior run of this effect (React StrictMode double-mount in dev),
        // don't override — a previous setActivePage('pembelian') from the
        // deep-link branch should win over a no-stash fallback in the re-run.
        setActivePage(current => current !== 'auth' ? current : nextPage);
```

Replace with:

```typescript
        // Default destination is dashboard; deep-link overrides if present.
        try {
          const stashedSearch = sessionStorage.getItem('pendingDeepLink');
          if (stashedSearch) {
            sessionStorage.removeItem('pendingDeepLink');
            // Restore the stashed route by replacing the URL. parseSearch in
            // urlRoute.ts gates against unknown screens, so we don't need to
            // pre-validate here.
            window.history.replaceState({}, '', stashedSearch);
            window.dispatchEvent(new Event('urlroute:change'));
          } else {
            // No stash — go to dashboard (idempotent: if URL is already
            // ?screen=dashboard, this is effectively a no-op).
            replaceRoute('dashboard');
          }
        } catch {
          // Stash unreadable — fall through to dashboard.
          replaceRoute('dashboard');
        }
```

- [ ] **Step 5: Replace logout `setActivePage('auth')` with `navigate`**

Find at line 159 (inside `onAuthStateChange` handler):

```typescript
      if (!session) {
        setCurrentUser(null);
        setActivePage('auth');
      }
```

Replace with:

```typescript
      if (!session) {
        setCurrentUser(null);
        // Don't push 'auth' into URL — let the !currentUser gate render AuthScreen.
        // The next login will replaceRoute() to dashboard or stashed deep-link.
      }
```

And at line 304 (inside `handleLogout`):

```typescript
    setCurrentUser(null);
    setActivePage('auth');
```

Replace with:

```typescript
    setCurrentUser(null);
    // Clear URL params so a refresh post-logout starts clean. AuthScreen renders
    // via the !currentUser gate, not via ?screen=auth.
    window.history.replaceState({}, '', window.location.pathname);
    window.dispatchEvent(new Event('urlroute:change'));
```

- [ ] **Step 6: Replace `handleLoginSuccess` deep-link logic**

Find lines 269-287:

```typescript
  // Handle successful login
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

Replace with:

```typescript
  // Handle successful login
  const handleLoginSuccess = (user: { id: string; name: string; role: string; permissions: PermissionSet; avatarUrl: string; storeName: string }) => {
    setCurrentUser(user);
    // Restore stashed deep-link if present; otherwise go to dashboard.
    try {
      const stashedSearch = sessionStorage.getItem('pendingDeepLink');
      if (stashedSearch) {
        sessionStorage.removeItem('pendingDeepLink');
        window.history.replaceState({}, '', stashedSearch);
        window.dispatchEvent(new Event('urlroute:change'));
        return;
      }
    } catch {
      // Stash unreadable — fall through.
    }
    replaceRoute('dashboard');
  };
```

- [ ] **Step 7: Replace remaining inline `setActivePage` calls in render**

Find at line 289-292:

```typescript
  const handleOpenCustomer = (customerId: string) => {
    setOpenCustomerId(customerId);
    setActivePage('pelanggan');
  };
```

Replace with:

```typescript
  const handleOpenCustomer = (customerId: string) => {
    navigate('pelanggan', { customer: customerId });
  };
```

Find at line 325 (DashboardScreen onNavigate):

```typescript
            onNavigate={(page) => setActivePage(page)}
```

Replace with:

```typescript
            onNavigate={(page) => navigate(page)}
```

Find at line 331 (SalesInboxScreen onNavigate):

```typescript
            <SalesInboxScreen onNavigate={setActivePage} />
```

Replace with:

```typescript
            <SalesInboxScreen onNavigate={(page) => navigate(page)} />
```

Find at line 340 (StockManagerScreen onNavigateToOpname):

```typescript
            onNavigateToOpname={() => setActivePage('stok-opname')}
```

Replace with:

```typescript
            onNavigateToOpname={() => navigate('stok-opname')}
```

Find at line 384 (WhatsappAiScreen onNavigate):

```typescript
            onNavigate={setActivePage}
```

Replace with:

```typescript
            onNavigate={(page) => navigate(page)}
```

Find at line 394 (PengaturanScreen onNavigate):

```typescript
            onNavigate={setActivePage}
```

Replace with:

```typescript
            onNavigate={(page) => navigate(page)}
```

Find at line 403 (PipelineScreen onNavigate):

```typescript
            onNavigate={setActivePage}
```

Replace with:

```typescript
            onNavigate={(page) => navigate(page)}
```

Find at line 419 (PelangganScreen onNavigate):

```typescript
            onNavigate={setActivePage}
```

Replace with:

```typescript
            onNavigate={(page) => navigate(page)}
```

Find lines 434 (PembelianScreen onDetailConsumed):

```typescript
            onDetailConsumed={() => setInitialDetailPoNumber(null)}
```

Replace with:

```typescript
            onDetailConsumed={() => {
              // Strip ?po=... from URL while staying on pembelian screen.
              navigate('pembelian');
            }}
```

Find lines 442-446 (KasirScreen onOpenPenjualanBaru):

```typescript
            onOpenPenjualanBaru={(channel) => {
              setPenjualanInitialChannel(channel);
              setActivePage('penjualanBaru');
            }}
```

Replace with:

```typescript
            onOpenPenjualanBaru={(channel) => {
              navigate('penjualanBaru', { channel });
            }}
```

Find lines 454-466 (PenjualanScreen handlers):

```typescript
            onBack={() => {
              setPenjualanInitialChannel(undefined);
              setActivePage('kasir');
            }}
            onSaved={(_txId) => {
              setPenjualanInitialChannel(undefined);
              setActivePage('kasir');
            }}
            onNavigate={(page) => {
              setPenjualanInitialChannel(undefined);
              setActivePage(page);
            }}
```

Replace with:

```typescript
            onBack={() => navigate('kasir')}
            onSaved={(_txId) => navigate('kasir')}
            onNavigate={(page) => navigate(page)}
```

(The `setPenjualanInitialChannel(undefined)` is no longer needed — channel is derived from URL and the new URL `?screen=kasir` has no channel param so it'll be undefined automatically.)

Find lines 475-486 (PenjualanBaruScreen handlers — same pattern):

```typescript
            onBack={() => {
              setPenjualanInitialChannel(undefined);
              setActivePage('kasir');
            }}
            onSaved={(_txId) => {
              setPenjualanInitialChannel(undefined);
              setActivePage('kasir');
            }}
            onNavigate={(page) => {
              setPenjualanInitialChannel(undefined);
              setActivePage(page);
            }}
```

Replace with:

```typescript
            onBack={() => navigate('kasir')}
            onSaved={(_txId) => navigate('kasir')}
            onNavigate={(page) => navigate(page)}
```

Find at line 569-573 (Sidebar onPageChange):

```typescript
        onPageChange={(page) => {
          if (page !== 'pelanggan') setOpenCustomerId(null);
          setInitialDetailPoNumber(null);
          setActivePage(page);
        }}
```

Replace with:

```typescript
        onPageChange={(page) => navigate(page)}
```

(Clearing `openCustomerId` and `initialDetailPoNumber` is no longer needed — they derive from the new URL which has no `customer` or `po` param so they'll be `null` automatically.)

Find at line 613 (notification bell onClick):

```typescript
              onClick={() => setActivePage('notifications')}
```

Replace with:

```typescript
              onClick={() => navigate('notifications')}
```

- [ ] **Step 8: Update permission-fallback effect to also fix URL**

Find the existing `useEffect` in Sidebar.tsx (line 133-140 of Sidebar.tsx, but the logic that handles it is in App.tsx — re-verify by reading). Actually the permission fallback in Sidebar.tsx already calls `onPageChange('dashboard')`, which we just rewired to call `navigate('dashboard')`. That handles the URL fix automatically. ✅ No further change needed for permission fallback — it inherits from the navigate rewire.

Verify by tracing: invalid screen for current user → Sidebar useEffect → `onPageChange('dashboard')` → `navigate('dashboard')` → URL updates. ✅

- [ ] **Step 9: Verify zero residual `setActivePage`**

Run: `grep -rn "setActivePage" src/`
Expected: **0 hits** (no more occurrences in any file).

If any remain, find them and convert to `navigate()`. Do not commit until grep is clean.

- [ ] **Step 10: Verify `setInitialDetailPoNumber`, `setOpenCustomerId`, `setPenjualanInitialChannel` are gone**

Run:

```bash
grep -rn "setInitialDetailPoNumber\|setOpenCustomerId\|setPenjualanInitialChannel" src/
```

Expected: **0 hits**. These are now derived from URL; their setters should no longer exist.

- [ ] **Step 11: tsc check**

Run: `npm run lint`
Expected: 0 errors.

Common issues at this stage:
- Imported `setActivePage` etc. types lingering — remove.
- `useState` import unused — that's fine, leave it (other state vars still use it).
- `ActivePage` import unused if no more direct annotations — verify.

- [ ] **Step 12: Run all existing unit tests to confirm no regression**

Run: `npm test`
Expected: All tests pass, including the urlRoute tests (19) and salesChannels tests (6).

- [ ] **Step 13: Commit**

```bash
git add src/App.tsx
git commit -m "feat(routing): App.tsx — URL as single source of truth

Replace useState<ActivePage> with useURLRoute() driven state. 24
setActivePage call sites → navigate(). openCustomerId,
initialDetailPoNumber, penjualanInitialChannel now derive from URL
params. Post-login restore generalized from pembelian-only to all
screens via sessionStorage.pendingDeepLink.

Behavior side-effects:
- Sidebar click pushes URL via history.pushState (no reload)
- F5 stays on current screen (was: always dashboard)
- Browser back/forward jalan
- ?screen=<any> deep-link sekarang works for all screens, bukan
  cuma pembelian
- Bookmark dan share-link langsung jalan

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Manual smoke tests + progress.md

**Files:**
- Verify: behavior in browser
- Modify: `progress.md`

- [ ] **Step 1: Run dev server**

Run: `npm run dev`
Expected: server starts on port 3000.

- [ ] **Step 2: Run the 10 manual smoke tests from spec**

Open Chrome to `http://localhost:3000`. Login normally. Run each test, note pass/fail:

1. **Click sidebar item** → URL bar updates to `?screen=...`, screen renders in-place, no reload.
2. **Ctrl+click** (Cmd on Mac) sidebar item → new tab opens, loads correct screen.
3. **Middle-click** sidebar item → new tab opens.
4. **Right-click** sidebar item → browser native menu shows "Open in new tab".
5. **F5 on Stok screen** → stays on Stok (URL preserved, not redirected to dashboard).
6. **Browser back button** after navigating through 3 screens → returns step-by-step to previous screens.
7. **Paste `?screen=pembelian&po=PO-XXXX` in URL bar of new tab** (use a real PO from your data) → opens Pembelian with that PO context. Should match existing chromeless detail behavior.
8. **Logout in tab A while tab B is on a non-auth screen** → tab B auto-redirects to AuthScreen (existing Supabase listener).
9. **Open `?screen=laporan` while logged out** → AuthScreen renders → login → auto-routes to Laporan.
10. **Bookmark `?screen=ai-stock`** → open the bookmark in a new tab → lands on Stok screen.

- [ ] **Step 3: If any smoke test fails, fix the underlying issue**

For each failure, identify the root cause (route fallback wrong, sessionStorage key mismatch, screen-component side-effect broken, etc.). Fix and re-run.

Do not move on until all 10 tests pass.

- [ ] **Step 4: Update progress.md**

Add this entry at the top of `progress.md` (after the title line):

```markdown
## 2026-06-15 — URL Routing & "Buka di Tab Baru" — SHIPPED

- **Spec**: `docs/superpowers/specs/2026-06-15-url-routing-new-tab-design.md`
- **Plan**: `docs/superpowers/plans/2026-06-15-url-routing-new-tab.md`
- **Files changed**:
  - NEW `src/lib/urlRoute.ts` — buildHref, parseSearch, shouldInterceptClick (pure) + navigate, replaceRoute, handleSPAClick, useURLRoute hook (DOM)
  - NEW `src/lib/urlRoute.test.ts` — 19 unit tests for pure functions
  - MOD `src/App.tsx` — useState<ActivePage> → useURLRoute() driven; 24 setActivePage call sites → navigate()
  - MOD `src/components/Sidebar.tsx` — `<button>` → `<a href onClick={handleSPAClick}>`
- **Smoke tests**: 10/10 passed (Ctrl+click, middle-click, right-click, F5 preserve, back/forward, deep-link new-tab, multi-tab logout sync, bookmark).
- **Side benefits delivered as part of one refactor**: F5 stays in-place (was: dashboard reset), browser back/forward jalan, bookmark URL works, share-link works, `?screen=<any>` deep-link generalized dari pembelian-only.
- **NOT touched**: window.open existing di OrderBnlSection/BNL detail (cosmetic cleanup follow-up), in-screen tab UI (defer ke spec Stok Round 5).
```

- [ ] **Step 5: Commit**

```bash
git add progress.md
git commit -m "docs(progress): URL routing & new-tab — shipped, 10/10 smoke tests passed

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

### Spec coverage check

| Spec section | Implemented by task |
|---|---|
| URL Scheme | Task 1 (buildHref), Task 2 (parseSearch) |
| URL Param → State Mapping | Task 6 step 1 (route.params destructure) |
| Initial mount empty URL → replaceState dashboard | Task 6 step 4 (handleLoginSuccess + auth restore) |
| `useURLRoute` hook | Task 4 |
| `navigate` function | Task 4 |
| `buildHref` | Task 1 |
| `handleSPAClick` | Task 4 |
| Fallback unknown screen → dashboard | Task 2 (parseSearch) |
| App.tsx `useState<ActivePage>` → `useURLRoute()` | Task 6 |
| Generalize `if (screen !== 'pembelian') return;` | Task 6 step 3 |
| Sidebar `<button>` → `<a href>` | Task 5 |
| Existing permission-fallback adds replaceState | Task 6 step 8 (inherited via navigate rewire) |
| sessionStorage post-login restore generalized | Task 6 step 3-6 |
| Edge: unknown screen | Task 2 |
| Edge: permission denied | Task 6 step 8 |
| Edge: middle-click button=1 | Task 3 (shouldInterceptClick) |
| Edge: shift modifier | Task 3 |
| Behavior matrix (5 trigger combos) | Task 3 |
| Unit tests (15+ cases) | Tasks 1-3 (19 cases total) |
| Manual smoke tests (10) | Task 7 step 2 |
| Regression `setActivePage` grep zero | Task 6 step 9 |

All spec requirements mapped to tasks. ✅

### Placeholder check

- No "TBD", "TODO", "implement later" in any task.
- No "Similar to Task N" — every code block is repeated/complete.
- All file paths absolute relative to repo root.

### Type consistency

- `RouteState` defined in Task 2, used in Task 4 (`useURLRoute` return type) ✅
- `ActivePage` consistent throughout (from `src/types.ts`) ✅
- `buildHref`, `parseSearch`, `shouldInterceptClick`, `navigate`, `replaceRoute`, `handleSPAClick`, `useURLRoute` — names consistent across tasks ✅
- `ROUTE_CHANGE_EVENT = 'urlroute:change'` — used consistently in Task 4 (subscribe + dispatch) and Task 6 (manual dispatch in stashed-restore paths) ✅
- `KasirChannel` import already present in App.tsx — `isKasirChannel` guard added in Task 6 step 2 ✅

No type drift detected.

### Risks called out

- **Task 6 is the long one** (13 sub-steps in one commit) — if it gets too large, can split sidebar wire + App.tsx refactor across commits, but spec recommends single-commit sweep for setActivePage to avoid inconsistent state.
- **`isKasirChannel` channel list** in Task 6 step 2 must be verified against current `KasirChannel` union — adjust if mismatched. Failure mode: a valid channel from URL gets rejected and falls back to undefined, harmless degraded UX.
- **`isDetailTab` logic** in current App.tsx (line 508-513) reads `window.location.search` directly. Task 6 doesn't explicitly rewire it — recommend rewriting to use `route.screen === 'pembelian' && route.params.po != null` for consistency. Add this as a sub-step if missed during execution.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-15-url-routing-new-tab.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Saya dispatch fresh subagent per task, review antar task, iterate cepat. Bagus untuk plan dengan banyak file + TDD cycle ketat.

**2. Inline Execution** — Eksekusi task-by-task di session ini pakai executing-plans, batch with checkpoints. Bagus kalau kamu mau monitor langsung.

Mau pakai yang mana?
