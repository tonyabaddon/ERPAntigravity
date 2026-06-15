# URL Routing & "Buka di Tab Baru" — Design Spec

**Date**: 2026-06-15
**Status**: Awaiting user review
**Branch**: TBD (feature branch dari `main` setelah `feat/piutang-tempo-v2` di-merge)

## Goal

User bisa buka sidebar item dan tab di dalam screen di **browser tab baru** lewat pola web standard (Ctrl/Cmd+click, middle-click, right-click → "Open in new tab"). Sebagai konsekuensi (dan motivasi sekunder yang sama pentingnya), URL menjadi single source of truth untuk navigasi — sehingga browser back/forward, F5 refresh, bookmark, dan share-link semua jalan native tanpa pekerjaan tambahan.

## Scope Boundary — Penting (re: User Q&A)

User saat brainstorming menjawab "sub menu = tab di dalam screen". **Saat ini di codebase belum ada satupun screen yang punya multi-tab pattern aktif** (verified via grep + sidebar inspection). Spec `2026-06-14-product-photo-search-design.md` Round 5 mengusulkan tab struktur untuk Stok screen, tapi belum di-implement.

**Konsekuensi konkret untuk scope spec ini**:

- Spec ini **menyediakan primitive routing** (`useURLRoute`, `buildHref`, `handleSPAClick`) yang siap dipakai screen-tab.
- Spec ini **tidak ikut wire up screen-tab UI** karena UI-nya belum ada untuk di-wire-up.
- Saat spec Stok multi-tab di-implementasi (atau screen-tab lain), implementor wajib pakai `urlRoute.ts` ini, tidak boleh bikin pola sendiri.
- Kalau user ingin Stok multi-tab digabung ke spec ini, scope membengkak ~1 hari extra (refactor `StockManagerScreen.tsx` 1051 baris jadi tabbed). Default = **defer ke spec Stok**.

User perlu confirm: OK defer screen-tab UI ke spec masing-masing? Atau bundle Stok multi-tab ke spec ini?

## Non-Goals

- **Tidak install router library** (no `react-router-dom`, no `wouter`, dll). Custom hook ringan ~80 baris cukup untuk scope kebutuhan.
- **Tidak refactor in-screen tab pattern yang belum ada.** Lihat "Scope Boundary" di atas — diferensiasi penting yang user perlu sadari.
- **Tidak ubah Supabase auth flow.** Session listener existing (multi-tab logout sync) tetap.
- **Tidak migrate `OrderBnlSection` / `BelanjaNumpangLewatDetailPage` existing** yang sudah pakai `window.open(url, '_blank')`. Mereka sudah berfungsi, bukan inti task. Bisa di-clean-up sebagai follow-up jika perlu konsistensi.
- **Tidak persist state non-navigasi ke URL** (filter, sort order, scroll position). YAGNI — bisa per-screen incremental kemudian.
- **Tidak ubah keyboard shortcut.** Tidak bikin `Ctrl+1..9` atau `Ctrl+Shift+T`. Browser sudah punya semantik own untuk itu.
- **Tidak tambah UI "↗" eksplisit di samping menu/tab.** Anchor-tag standard + native browser modifier sudah market standard (Gmail, Linear, Jira, GitHub, Notion).

## Background

App saat ini adalah single-page React (Vite + React 19, no router). State `activePage` di `App.tsx:56` adalah satu-satunya source of truth untuk screen yang aktif:

```ts
const [activePage, setActivePage] = useState<ActivePage>('auth');
```

`ActivePage` adalah string union 21 nilai (`src/types.ts:397`). Sidebar (`src/components/Sidebar.tsx:185-217`) render `<button onClick={() => onPageChange(item.id)}>` per item — tidak ada anchor tag, sehingga Ctrl+click, middle-click, dan right-click "Open in new tab" tidak berfungsi.

Pola deep-link sudah **eksis untuk Pembelian saja** (`App.tsx:83-101`):
- URL `?screen=pembelian&po=PO-...&bnl=BNL-...` dibaca di mount
- Jika logged in: apply langsung
- Jika logged out: stash di `sessionStorage`, restored di `handleLoginSuccess`
- Hardcoded guard `if (screen !== 'pembelian') return;` — pola tidak generalize ke screen lain.

Existing usages `window.open(url, '_blank')`:
- `OrderBnlSection.tsx:40` — buka Pembelian baru pre-filled saat user klik "Buat PI dari order ini"
- `BelanjaNumpangLewatDetailPage.tsx:48` — sama
- `OrderHistoryScreen.tsx:725`, `PembelianScreen.tsx:591`, `PembelianDetailPage.tsx:133` — buka URL file proof, di luar scope (file URL, bukan in-app navigation)

## Approach

URL query params adalah single source of truth. Click sidebar/tab dengan modifier key fall-through ke browser native handling. Click biasa di-intercept SPA-style via `preventDefault` + `history.pushState`.

### URL Scheme

```
?screen=<ActivePage>[&<screen-specific-params>]
```

Examples:
```
?screen=dashboard
?screen=ai-stock&tab=katalog
?screen=ai-stock&tab=stok-per-gudang
?screen=pembelian&po=PO-2026-001                  # existing pattern preserved
?screen=pembelian&bnl=BNL-2026-007                # existing pattern preserved
?screen=pembelian&bnl-new-for-order=ord_xxx&bnl-new-customer=Nama%20Customer
?screen=pelanggan&customer=cust_abc123
?screen=laporan&tab=penjualan
?screen=penjualanBaru&channel=offline
```

Tiap screen baca param yang ia kenal, ignore yang tidak. Tidak ada per-screen schema validation (silent ignore = standard web behavior).

### URL Param → State Mapping (per screen)

Mapping eksplisit antara URL param dan state internal `App.tsx`. Implementor harus pakai mapping ini saat refactor `setActivePage` → `navigate(...)`. Per-screen mapping bisa di-extract ke fungsi `routeToState(routeState)` di `urlRoute.ts`:

| Screen | URL params | App.tsx state derived |
|---|---|---|
| `dashboard` | (none) | — |
| `sales-inbox` | (none) | — |
| `pelanggan` | `customer=<id>` | `openCustomerId` |
| `pembelian` | `po=<no>` | `initialDetailPoNumber` |
| `pembelian` | `bnl=<no>` | `initialBnlPiNumber` |
| `pembelian` | `bnl-new-for-order=<id>` + `bnl-new-customer=<name>` | `initialBnlPrefill = { orderId, customerName }` |
| `penjualanBaru` | `channel=<offline\|tokopedia\|whatsapp>` | `penjualanInitialChannel: KasirChannel` |
| `kasir` | (none for v1) | — |
| (lainnya) | (none for v1) | — |

Param yang tidak ada di mapping → ignore. Validasi enum (mis. `channel` harus salah satu dari `KasirChannel`): kalau invalid, treated as not set (silent fallback).

**Initial mount tanpa `?screen=` param** (user buka root URL):
- Setelah login → default `dashboard`, **disertai `history.replaceState({}, '', '?screen=dashboard')`** supaya back-button behavior konsisten (URL bar selalu reflect state, F5 idempotent).
- Sebelum login (AuthScreen) → URL dibiarkan tanpa param, post-login restore default ke `dashboard`.

### File Inventory

**New files (2):**

1. `src/lib/urlRoute.ts` (~80 lines)
   - `type RouteState = { screen: ActivePage; params: Record<string, string> }`
   - `useURLRoute(): RouteState` — React hook, subscribe to `popstate` + custom `'urlroute:change'` event
   - `navigate(screen: ActivePage, params?: Record<string, string>): void` — call `history.pushState`, dispatch event
   - `buildHref(screen: ActivePage, params?: Record<string, string>): string` — pure URL builder, output `?screen=...&key=val`
   - `handleSPAClick(e: React.MouseEvent, screen: ActivePage, params?): void` — intercept plain left-click for SPA navigation; modifier-key clicks fall through to browser
   - Fallback: invalid/unknown screen → `'dashboard'`

2. `src/lib/urlRoute.test.ts` — unit tests (~15 cases, lihat section Testing)

**Files modified (3):**

1. `src/App.tsx`
   - Replace `useState<ActivePage>('auth')` dengan state yang derived dari `useURLRoute()`.
   - Generalize existing deep-link block (line 83-101) — drop `if (screen !== 'pembelian') return;` guard; support semua `ActivePage` values.
   - State seperti `openCustomerId`, `initialDetailPoNumber`, `initialBnlPiNumber`, `initialBnlPrefill`, `penjualanInitialChannel` di-derive dari URL params via small mapping object (screen → expected params).
   - Existing permission-fallback `useEffect` (line 133-140) — tambahkan `history.replaceState` agar URL ikut update saat fallback ke dashboard (cegah F5-loop).
   - Pertahankan `sessionStorage` pattern untuk post-login restore; extend dari `pembelian`-only ke semua screens.

2. `src/components/Sidebar.tsx`
   - `<button onClick={() => onPageChange(item.id)}>` → `<a href={buildHref(item.id)} onClick={(e) => handleSPAClick(e, item.id)}>`.
   - Visual styling (className) tidak berubah — `<a>` di-style sama dengan button existing (tailwind `inline-flex` / `block` class compatibility).
   - Reset default link styles (no underline, inherit color) via tailwind classes.

3. Screens dengan in-screen tab pattern *yang sudah ada saat ini*. Berdasarkan grep awal: **tidak ada screen yang punya multi-tab pattern di codebase saat ini**. Spec `2026-06-14-product-photo-search-design.md` Round 5 mengusulkan tab struktur untuk Stok screen, tapi belum di-implementasikan. **Scope v1**: tidak ada perubahan di screen-level tabs; ketika tab pattern diimplementasikan (spec Stok), implementor mengikuti pattern `urlRoute` ini.

**Files NOT touched:**
- `OrderBnlSection.tsx`, `BelanjaNumpangLewatDetailPage.tsx` — existing `window.open(url, '_blank')` calls jalan, biarkan.
- Komponen screen individu (DashboardScreen, PelangganScreen, dll) — tidak ubah state shape, cuma akan menerima props sama seperti sebelumnya.
- `Supabase` auth listener — tetap.
- `package.json` — zero new deps.

### Data Flow

**Mount / refresh / new tab (semua sama):**
1. Browser load (typed URL, new tab, F5, bookmark, share link)
2. `App.tsx` mount → `useURLRoute()` baca `window.location.search`
3. Auth gate: tidak logged in → stash route ke `sessionStorage.postLoginRoute`, render `AuthScreen`. Logged in → render screen sesuai param.

**In-place navigation (plain left-click):**
1. User click `<a href="?screen=pelanggan&customer=cust_abc">`
2. `handleSPAClick(e)`: tidak ada modifier key, `e.button === 0` → `e.preventDefault()`
3. `navigate('pelanggan', {customer: 'cust_abc'})` → `history.pushState` + dispatch `'urlroute:change'`
4. `useURLRoute()` subscribers re-render

**New-tab navigation (Ctrl/Cmd+click, middle-click):**
1. User Ctrl+click `<a href="?screen=pelanggan&customer=cust_abc">`
2. `handleSPAClick(e)`: ada modifier key atau `e.button !== 0` → return tanpa preventDefault
3. Browser handle natively → tab baru terbuka dengan href tersebut
4. Tab baru ikut path "Mount" di atas

**Right-click "Open in new tab":**
- Native browser context menu (karena element-nya `<a href>` proper)
- React `onClick` tidak fire untuk right-click → tidak ada interferensi

**Back/forward:**
1. User press browser back button
2. `popstate` event fires
3. `useURLRoute()` listener picks up → re-read URL → re-render

**Post-login restore:**
1. User buka `?screen=pembelian&po=PO-001` saat logged out
2. App detect tidak ada `currentUser` → `sessionStorage.setItem('postLoginRoute', '?screen=pembelian&po=PO-001')` → render AuthScreen
3. User login → `handleLoginSuccess()` baca `postLoginRoute`, parse, call `navigate(...)`, hapus storage entry.

### Edge Cases

| Case | Behavior |
|------|----------|
| `?screen=xyz123` (unknown) | Silent fallback ke `dashboard`. `history.replaceState` agar URL bar clean. |
| `?screen=` (empty) | Fallback ke `dashboard`. |
| No `screen` param | Default landing setelah login = `dashboard`. |
| User has permission denied for target screen | Existing `useEffect` (App.tsx:133-140) fallback ke dashboard; tambah `history.replaceState` cegah F5-loop. |
| Irrelevant param (`?screen=dashboard&po=PO-001`) | Dashboard render, `po` di-ignore (tiap screen baca param sendiri). |
| Browser tanpa History API | Tidak handled (Vite + React 19 sudah minimum modern browser). |
| Race: `currentUser` async restore vs URL params | URL params dipegang di state sampai `currentUser` resolved, lalu apply. Reuse pola existing App.tsx:83-101. |
| Multi-tab logout sync | Supabase auth listener (existing) trigger di semua tab via shared storage; tab lain auto-redirect ke AuthScreen. |
| Bookmark URL dari screen yang dihapus | Sama dengan "unknown screen" — fallback dashboard, replaceState clean. |
| `e.button === 1` (middle-click) | Tidak preventDefault → browser handle = new tab. |
| `e.button === 2` (right-click) | React tidak fire onClick → no interference, browser menu shows. |
| `shiftKey` modifier | Tidak preventDefault → browser opens new window (standard). |

### Behavior Matrix

| Trigger | Modifier | Mouse button | Result |
|---|---|---|---|
| Click | none | left (0) | SPA in-place navigation |
| Click | Ctrl/Cmd | left (0) | Browser opens new tab |
| Click | Shift | left (0) | Browser opens new window |
| Click | any | middle (1) | Browser opens new tab |
| Click | any | right (2) | React onClick not fired; native menu shows |

## Testing

### Unit tests — `src/lib/urlRoute.test.ts`

- `buildHref('dashboard')` → `'?screen=dashboard'`
- `buildHref('pembelian', {po: 'PO-001'})` → `'?screen=pembelian&po=PO-001'`
- `buildHref` properly encodes special chars (e.g. `PO/2026#1` → `PO%2F2026%231`)
- `handleSPAClick` plain left-click (button=0, no modifier) → calls `preventDefault` + triggers navigate
- `handleSPAClick` Ctrl key → does NOT preventDefault
- `handleSPAClick` Cmd key (`metaKey`) → does NOT preventDefault
- `handleSPAClick` middle-click (button=1) → does NOT preventDefault
- `handleSPAClick` Shift key → does NOT preventDefault
- `useURLRoute` returns `{screen: 'dashboard', params: {}}` saat `window.location.search === ''`
- `useURLRoute` updates on `popstate`
- `useURLRoute` updates on custom `'urlroute:change'`
- `useURLRoute` fallback `screen: 'dashboard'` untuk `?screen=invalid-xyz`
- `navigate('ai-stock', {tab: 'katalog'})` → `history.pushState` called dengan URL benar
- `navigate` dispatch `'urlroute:change'` event
- `buildHref` no params → tetap valid (`?screen=dashboard`)

### Manual smoke tests (Chrome DevTools MCP setelah `npm run dev`)

1. Click sidebar item → URL update, screen render in-place
2. Ctrl+click sidebar item → new tab opens with correct screen
3. Middle-click sidebar item → new tab opens
4. Right-click sidebar item → browser native menu shows "Open in new tab"
5. F5 di Stok screen → tetap di Stok (tidak balik ke dashboard)
6. Browser back button setelah pindah 3 screen → kembali ke screen sebelumnya
7. Paste `?screen=pembelian&po=PO-2026-001` di URL bar new tab → buka langsung Pembelian dengan PO context (preserve existing)
8. Logout di tab A → tab B auto-redirect ke AuthScreen (via Supabase listener)
9. Buka `?screen=laporan` saat logged out → AuthScreen → login → auto-route ke Laporan
10. Bookmark `?screen=ai-stock` → buka bookmark → langsung ke Stok

### Regression risk surface — `setActivePage` blast radius

`grep -rn "setActivePage" src/` (verified pada saat spec ditulis): **24 call sites, semua di `src/App.tsx`** (single-file refactor, tidak nyebar ke files lain). Breakdown:
- 1× declarasi (`useState`)
- ~3× di mount/auth flow (line 90, 153, 159)
- ~3× di explicit handler (logout `'auth'`, after-login restore)
- ~9× di passthrough props (`onNavigate={setActivePage}` ke child screens) — child component tidak perlu diubah; cuma replace passthrough jadi `(page) => navigate(page)` wrapper di App.tsx
- ~8× di inline lambda dalam JSX (mis. `() => setActivePage('penjualanBaru')`)

**Verification protocol setelah refactor**:
1. `grep -rn "setActivePage" src/` harus return **0 hits** (kecuali kalau ada call site yang ditahan secara sengaja, harus di-comment dengan alasan).
2. `tsc --noEmit` clean.
3. Manual smoke tests (10 cases di bawah) semua lulus.

Strategy: refactor sweep-style — buka satu file (App.tsx), ganti semua call dari atas ke bawah dalam 1 commit. Tidak perlu split per-call-site.

### TypeScript

`tsc --noEmit` clean.

## Out of Scope (Follow-ups)

- **In-screen tab routing implementations** (Stok screen tabs, Laporan tabs, Pengaturan tabs): masing-masing di-handle saat spec screen tersebut diimplementasikan, mengikuti pattern `urlRoute` di spec ini.
- **State non-navigasi di URL** (filter, sort, pagination, scroll): per-screen as needed, future enhancement.
- **Cleanup `window.open(url, '_blank')` ke `<a href target="_blank">`**: konsistensi cosmetic, low priority.
- **Path-based routing** (`/pembelian/po/PO-001`): jika butuh pretty URL future, migration ke `react-router` atau extend custom hook.
- **Route guards declarative** (per-screen permission declaration): existing `useEffect` fallback sudah cukup untuk sekarang.

## Decisions Locked (per Brainstorm Q&A)

- **Tab type**: browser tab baru (window.open / native), bukan in-app tabs.
- **Scope**: semua sidebar items + (future) in-screen tabs.
- **Trigger**: anchor-tag standard, native browser modifier keys (Ctrl/Cmd+click, middle-click, right-click). Tidak ada tombol "↗" eksplisit, tidak ada custom context menu, tidak ada keyboard shortcut yang fight dengan browser.
- **URL routing**: full SPA routing (URL = source of truth). Bonus: F5/back/forward/bookmark/share jalan.
- **Routing library**: custom hook (`src/lib/urlRoute.ts`), zero new deps. Lebih fit dengan pola existing query-param di App.tsx:83-101.
