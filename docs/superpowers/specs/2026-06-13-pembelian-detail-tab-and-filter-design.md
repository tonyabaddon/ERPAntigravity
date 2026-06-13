# Pembelian: PO detail in new tab, KPI redesign, date filter — design

**Status:** Spec • brainstormed 2026-06-13
**Surface area:** `PembelianScreen.tsx` (list + KPI cards + new filter bar), `PoDetailView.tsx` (modal → standalone page), `App.tsx` (URL routing), one new shared component `KpiCard`.
**Mockup:** `tmp/pembelian-mockup.html` — interactive prototype (filter chips, custom popover, click-Detail-opens-new-tab, in-page Buat PO Baru, dynamic KPI cards).

## 1. Why

Two operational gaps in today's `PembelianScreen`:

1. **PO detail is cramped in a modal** (`PoDetailView`, `max-w-2xl`, `max-h-[90vh]`). Items, totals, damaged-goods retur status, attachments — all crammed inside a popup. Operators can't keep the list visible while inspecting a PO, can't compare two POs side-by-side, and can't bookmark or share a PO link.
2. **KPI cards diverge from the design system.** Today's four cards (`bg-white rounded-xl border-gray-200 p-4`, `text-2xl font-bold`) are flat and inconsistent with the `KpiCard` pattern used in `DashboardScreen` and `LaporanScreen` (rounded-3xl, icon chip top-left, badge top-right, `#012749` extrabold value, hover-lift). Re-rendering them in the canonical style was explicitly requested.
3. **KPIs and list are MTD-only** — there's no way to look at last month, last 30 days, or a custom range without an SQL console. Reconciliation periods (e.g., "what did we buy in Mei 2026?") force the operator out of the app.

This spec addresses all three in one coherent change to keep the Pembelian screen internally consistent.

## 2. Scope

**In scope**

- **PO detail moves to a standalone full-page route**, opened in a new browser tab via URL routing. The `Detail` button on each PO row triggers `window.open()` to a URL the SPA understands.
- **`App.tsx` learns to parse a query-string route** (`?screen=pembelian&po=PO-2026-0042`) on boot so the new tab can deep-link directly into the detail page.
- **`PoDetailView` is rewritten as a full-page component** (`PembelianDetailPage`) with status-driven action buttons (Edit / Pesan / Hapus on DRAFT, Terima on ORDERED, Tandai Lunas on RECEIVED) mirroring the row actions, plus the existing Download PDF + Print.
- **A new shared `KpiCard` component** (`src/components/ui/KpiCard.tsx`) lifted out of the file-local helper currently in `LaporanScreen.tsx`. `PembelianScreen` adopts it for the four summary cards; `LaporanScreen` switches its file-local helper to the shared one (consolidation, zero behavior change there).
- **A date filter bar** between the page header and the KPI cards: three preset chips (`Bulan Ini` default, `30 Hari`, `90 Hari`) + a `Custom` button that opens a date-range popover. A resolved-range label (`1 Jun – 13 Jun 2026`) is always visible on the right.
- **KPI cards 1/2/4 react live to the filter**; "Terlambat Bayar" is a "right now" card that explicitly ignores the filter (subtext makes the exception clear).
- **PO list filters by `coalesce(ordered_at, created_at)`** within the resolved range — DRAFT POs without an `ordered_at` fall into the period of their creation date so they don't disappear from "Bulan Ini".
- **Tab-sync after detail-tab actions** — when the detail tab performs an action (Terima / Bayar / etc.), the list tab refreshes on next `visibilitychange` (tab refocus). Simplest mechanism that covers the common flow.

**Out of scope** (named so the user doesn't expect them)

- A real router (`react-router-dom`) — keeping `App.tsx`'s state-driven nav, only adding query-param parsing on boot.
- Modifying the existing in-page form flows (`PurchaseOrderFormPage` for Buat PO Baru / Edit DRAFT). They stay same-tab, state-driven, no URL change.
- Filtering by `received_at` or `payment_due_at` as alternative date axes — the filter uses `coalesce(ordered_at, created_at)` everywhere, full stop.
- Saving filter state in localStorage or URL — filter resets to `Bulan Ini` on every page load (acceptable for a workflow surface; can be added later if anyone asks).
- Changes to `SupplierTab`, the Receive / Mark-as-Paid / Receive-Replacement modals, or the Supplier modal.
- Mobile-specific layouts — current Pembelian is desktop-only; the new tab + filter bar inherit that.

## 3. Routing model

### 3.1 URL shape

The new detail tab opens at:

```
/?screen=pembelian&po=PO-2026-0042
```

Query-string form (not path form) chosen deliberately: the app already serves `index.html` for every route, but a path like `/pembelian/po/PO-2026-0042` would 404 on hard-refresh without a backend rewrite. Query strings work today with zero infra changes (Cloud Run + Vite preview both serve `index.html` at `/`).

### 3.2 `App.tsx` boot parsing

`App.tsx` reads `URLSearchParams` once on mount:

- If `screen` is present, set the active screen accordingly (currently only `pembelian` is recognized; other values are ignored).
- If `po` is also present, pass it down as `initialDetailPoNumber` so `PembelianScreen` opens the detail page directly instead of the list.
- If neither param is present, behavior is unchanged from today (default screen, default view).

After parsing, the params remain in the URL so the operator can refresh / bookmark the page without losing context. We do **not** rewrite the URL via `history.replaceState` — that would surprise the user who pasted the link.

### 3.3 Detail-page entry contract

`PembelianScreen` accepts an optional `initialDetailPoNumber` prop. On mount, if set, it:
1. Switches its internal `viewMode` to `{ kind: 'detail', poNumber }`.
2. Fetches the PO by number (a thin wrapper around `purchaseOrderService.fetchAll()` filtered, or a new `fetchByNumber(poNumber)` — see §5.1).
3. Renders the new `PembelianDetailPage`.

### 3.4 Closing the detail tab

The detail page's top-left `×` button calls `window.close()`. If the tab was not opened via `window.open` (e.g., user pasted the URL), `window.close()` is a no-op — they navigate via the sidebar instead. Acceptable; no fallback needed.

### 3.5 Tab-sync after detail-tab actions

When the detail tab finishes Terima / Bayar / etc., the list tab needs to refresh. Mechanism:

- `PembelianScreen` (list view) subscribes to `document.visibilitychange`. On `visibilityState === 'visible'`, it re-calls `reload()`.
- No `BroadcastChannel` or `storage` event needed — refocus-refresh covers 100% of the "I just did something in the other tab" flow, costs almost nothing, and avoids cross-tab message plumbing.
- Trade-off: if the operator stays focused on the list tab while the detail tab finishes an action, the list won't auto-update. Acceptable — the list reflects state on next interaction (refocus, manual refresh, or after the operator's own action triggers a reload).

## 4. UI design

### 4.1 Filter bar

Placement: between the page header (`Pembelian` title row) and the KPI card grid. **Not sticky** — filter is set-once, browse-many; sticky would clutter the list-scroll experience.

Layout (single row, wraps below the resolved-range label on narrow widths):

```
[ Periode  (Bulan Ini)  (30 Hari)  (90 Hari)  (📅 Custom ▾) ]      📅 Bulan Ini · 1 Jun – 13 Jun 2026
```

- **Active chip** uses brand `bg-[#012749] text-white shadow`. Inactive chips: `bg-white border border-gray-200 text-gray-600 hover:border-[#012749] hover:text-[#012749]`.
- **Custom** is itself a chip that turns active when the user applies a custom range. The icon (`calendar`) and chevron-down clarify it opens a popover.
- **Resolved-range label** on the right: `<period name> · <from> – <to>`. Always visible so the operator (and any screenshot) knows exactly what's being counted.

#### 4.1.1 Custom popover

Opens below the Custom chip, absolutely positioned. Width 360px. Contains:
- `Dari` and `Sampai` date inputs side-by-side (native `<input type="date">`).
- Inline validation: if `Sampai < Dari`, show `Tanggal 'Sampai' harus setelah 'Dari'.` in rose-600 below the inputs; Terapkan stays disabled visually until valid.
- `Batal` (text button) + `Terapkan` (primary `bg-[#012749]`).
- Click-outside closes the popover without applying.

### 4.2 KPI cards

Four cards in a `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6`. Each uses the shared `KpiCard` component:

| # | Label | Icon | Tint | Badge | Value | Subtext (filter-aware) |
|---|---|---|---|---|---|---|
| 1 | **Total PO** | `ShoppingCart` | `bg-blue-50` / `text-[#1e3d60]` | `<period label>` blue chip | `Rp <totalMtd>` | `X purchase order dibuat di <period.toLowerCase()>` |
| 2 | **Jatuh Tempo** | `Calendar` | `bg-amber-50` / `text-amber-600` | `<dueCount> PO` amber chip | `Rp <dueAmount>` | `Belum dibayar, jatuh tempo di <period.toLowerCase()>` |
| 3 | **Terlambat Bayar** | `AlertTriangle` | rose if >0 else gray | `Tindakan!` rose or `Aman` emerald | `Rp <overdueAmount>` | `X PO melewati jatuh tempo — selalu hari ini, tidak ikut filter` (or "Semua PO dilunasi tepat waktu") |
| 4 | **Jumlah PO** | `FileText` | `bg-emerald-50` / `text-[#2d8a4e]` | `<period label>` emerald chip | `<count>` | `Purchase order dibuat di <period.toLowerCase()>` |

**Card 3 (Terlambat Bayar) alarming state**: when `overdueAmount > 0`, the card itself switches to `bg-rose-50/50 border-rose-100 shadow-rose-50/50` — mirrors `DashboardScreen`'s low-stock alert pattern. Icon chip flips to `bg-rose-100 text-rose-700`. Badge becomes `Tindakan!` in rose.

**Card 3 always ignores the date filter.** This is the deliberate exception. Subtext makes it explicit. Rationale: overdue is a "right now, needs action" signal — hiding January's still-unpaid PO because the user is browsing "Mei 2026" would be unsafe.

**Card labels stay short** — period scope is communicated by the badge + subtext, not the label itself. Avoids ugly labels like "Total PO 30 Hari Terakhir" or "Total PO Mei 2026".

### 4.3 PO list

Layout, columns, sort order, and row actions are **unchanged**. The only differences:

1. **Source data is now `POS.filter(inPeriod)`** — the same period the cards use (for cards 1, 2, 4). The list always reflects the same scope as the filter bar.
2. **The `Detail` button** triggers `window.open(detailUrl, '_blank')` instead of opening the modal. The `PoDetailView` modal is deleted (replaced by `PembelianDetailPage` on the new route).
3. **Empty state when filter has no matches** — friendly icon + `Tidak ada purchase order di periode <label>. Coba periode lain, atau buat PO baru.`

Row click is **not** added. Only the `Detail` button navigates (matches user's explicit "all fields stay the same, only changing the page-vs-tab behavior").

### 4.4 `PembelianDetailPage` (new tab)

A standalone page (not a modal). Layout:

- **Top bar** (`bg-white border-b`): `×` close button → `window.close()`; indigo `ShoppingCart` chip; `PO-2026-0042` title; supplier name + status pill subtitle. On the right: status-driven action buttons (see below) + Download PDF + Print.
- **Body** (max-w-4xl centered, `bg-gray-50`):
  - PO meta card (3-col: Tanggal Pesan, Tanggal Terima, Jatuh Tempo).
  - Items card (table with margin column — unchanged from current modal).
  - Damaged-goods section (unchanged, only shown if `damagedItems.length > 0`).
  - Attachments (invoice URL, payment proof URL — unchanged).

**Status-driven actions** (mirror row buttons so the operator can act without switching tabs):
- `DRAFT`: `Edit` (replaces the detail body with `PurchaseOrderFormPage` in the same tab — see §6), `Tandai Dipesan`, `Hapus`.
- `ORDERED`: `Terima Barang` (opens `ReceiveGoodsModal` inside the detail tab).
- `RECEIVED`: `Tandai Lunas` (opens `MarkAsPaidModal` inside the detail tab).
- All non-DRAFT statuses: `Download PDF`.
- All statuses: `Print`.

After any action that mutates the PO, the detail page re-fetches itself (so it reflects the new status). The list tab refreshes on refocus per §3.5. After `Hapus` succeeds, the detail tab redirects back to the list URL (`/?screen=pembelian`) so the user isn't stranded on a deleted-PO URL.

## 5. Data & service changes

### 5.1 `purchaseOrderService` — new method

```ts
fetchByNumber(poNumber: string): Promise<DbPurchaseOrder | null>
```

Thin Supabase select with the same joins as `fetchAll()` (`supplier`, `items`), filtered by `po_number`. Returns `null` if not found (detail page shows `PO tidak ditemukan` empty state).

Rationale: `fetchAll()` is heavy. The detail tab only needs one PO. Adding `fetchByNumber` keeps the boot cost minimal.

### 5.2 No DB schema changes

All four KPI numbers and the list rows are derived client-side from the already-fetched PO list + the active filter. Cards 1, 2, and 4 use `POS.filter(inPeriod)`; card 3 uses `POS.filter(isPaymentOverdue)` regardless of period.

`purchaseOrderService.fetchSummary()` is **removed**. It returned only a server-side MTD aggregate, which no longer matches what any card displays once the filter is per-period. The full PO list is already fetched for the table; reusing it for all four cards costs nothing extra and keeps the data source single.

### 5.3 Filter state shape

```ts
type FilterPreset = 'bulan_ini' | '30_hari' | '90_hari' | 'custom';
interface PembelianFilter {
  preset: FilterPreset;
  customFrom?: string; // 'YYYY-MM-DD', only when preset === 'custom'
  customTo?: string;
}
```

Single React state object inside `PembelianScreen`. Default: `{ preset: 'bulan_ini' }`. Reset on screen mount (no persistence).

### 5.4 `resolveRange` and `periodLabel` helpers

Pure functions in `PembelianScreen.tsx` (or in a small `src/lib/dateRange.ts` if any other screen wants the same presets later). Logic:

- `bulan_ini` → `[firstDayOfMonth(today), today]`
- `30_hari` → `[today - 29d, today]` (rolling, inclusive)
- `90_hari` → `[today - 89d, today]`
- `custom` → `[customFrom, customTo]`

`periodLabel` returns:
- `Bulan Ini`, `30 Hari Terakhir`, `90 Hari Terakhir` for presets.
- For custom: if the range is exactly one full calendar month, `Mei 2026`. Otherwise `<dari> – <sampai>` (e.g., `15 Apr – 30 Mei 2026`).

`resolvedRangeShort` returns the always-visible right-side label.

## 6. `Edit` from detail tab — locked behavior

When the operator clicks `Edit` on a DRAFT PO from the detail tab, `PurchaseOrderFormPage` replaces the detail body in the **same tab** (the detail tab). On save:
- If saved as DRAFT, returns to the detail view of the same PO.
- If saved as ORDERED, returns to the detail view (status now ORDERED, action buttons update accordingly).

Rationale: the operator opened this tab to focus on this PO. Bouncing them back to the list tab — which may or may not still be open — is jarring. `PurchaseOrderFormPage` already accepts a `po` prop for editing; only the entry point (now reachable from both the list and the detail page) changes. The list tab still refreshes on refocus per §3.5.

Rejected alternative: closing the detail tab and forcing the operator to use the list tab's Edit. Required reasoning about whether the list tab was still open and led to an awkward focus-and-close UX.

## 7. Component map

```
src/components/
├── PembelianScreen.tsx               # MODIFIED — filter bar, KpiCard adoption, list view-mode 'detail' added
├── pembelian/
│   ├── PembelianDetailPage.tsx       # NEW — replaces PoDetailView modal
│   ├── PoDetailView.tsx              # DELETED
│   ├── PurchaseOrderFormPage.tsx     # unchanged
│   ├── ReceiveGoodsModal.tsx         # unchanged (now invoked from PembelianDetailPage too)
│   ├── MarkAsPaidModal.tsx           # unchanged (now invoked from PembelianDetailPage too)
│   ├── ReceiveReplacementModal.tsx   # unchanged
│   └── SupplierModal.tsx             # unchanged
├── LaporanScreen.tsx                 # MODIFIED — file-local KpiCard removed, imports shared component
└── ui/
    └── KpiCard.tsx                   # NEW — shared component (props per §7.1)
```

### 7.1 `KpiCard` props

```ts
interface KpiCardProps {
  icon: React.ReactNode;       // lucide icon element, e.g. <ShoppingCart className="w-6 h-6" />
  iconBg: string;              // tailwind class, e.g. 'bg-blue-50'
  iconColor: string;           // tailwind class, e.g. 'text-[#1e3d60]'
  badge: string;
  badgeClass: string;          // tailwind class, e.g. 'bg-blue-50 text-[#1e3d60]'
  label: string;
  value: string;
  sub: string;
  alarming?: boolean;          // when true: card uses rose-tinted bg
}
```

Body mirrors the current `LaporanScreen.KpiCard` (lines 267-281). Hover-lift transition included.

## 8. Behaviors & edge cases

| Case | Behavior |
|---|---|
| User opens app at `/?screen=pembelian&po=PO-XYZ` directly (typed/pasted) | `App.tsx` reads params, sets `pembelian` screen + `initialDetailPoNumber=PO-XYZ`. `PembelianScreen` fetches the PO via `fetchByNumber`. If found, renders `PembelianDetailPage`. If not found, falls back to list with a toast "PO tidak ditemukan." |
| User reloads the detail tab | Same as above — query string survives reload, the page renders cleanly. |
| User clicks Detail on a row, target PO is later deleted from list tab | Detail tab still shows the cached PO data; next refetch (after an action attempt) errors. User closes tab. Acceptable. |
| Filter is `Bulan Ini` and no PO has been ordered this month | All four cards show `Rp 0` / `0`, subtext clarifies "Belum ada PO di periode ini". List shows empty state. Terlambat Bayar still independently shows current state. |
| Custom range with `from > to` | Terapkan disabled, inline error shown. |
| User picks Custom range entirely in the future | Filter applies normally. Cards show `Rp 0`, list shows empty state. Not a bug — user asked for that range. |
| `Detail` button clicked twice in quick succession | Each click opens its own tab (browser default). Acceptable. |
| Action button on detail tab fails (network error) | Existing modal/service error toast surfaces in the detail tab. Detail page refetches. List tab unaffected until refocus. |
| User has popup blocker that blocks `window.open` | Browsers fire `window.open` from a trusted user click → blockers typically allow it. If blocked, the link does nothing. We surface a one-time tooltip "Aktifkan popup untuk membuka PO di tab baru" only if the returned window handle is null. |

## 9. Testing

- **Unit:** `resolveRange` and `periodLabel` covering all four presets, full-month custom, partial-month custom, year-crossing range.
- **Unit:** `inPeriod` predicate against POs with `ordered_at`, with `ordered_at === null`, and with both null (defensive — shouldn't happen but should not throw).
- **Integration (manual smoke):**
  - Filter chip switching updates card numbers + list rows in the same tick.
  - Custom popover applies on Terapkan, dismisses on Batal and click-outside, validates `from <= to`.
  - Clicking `Detail` opens a new tab at the right URL; reloading the tab keeps the view.
  - Action buttons on detail tab open the existing modals (Receive / MarkAsPaid / etc.) and refresh detail on success.
  - List tab refreshes on refocus after detail tab finishes an action.
  - `Buat PO Baru` still opens form in the same tab (not new tab).
  - Edit on DRAFT row still opens form in the same tab.
- **Permission gating:** existing `currentUserPermissions` checks on the action buttons survive the modal → page move.

## 10. Rollout

Single deploy. No DB migration. No feature flag — the surface is internal-facing, low-risk, and the previous behavior (modal) is fully replaced by the new behavior (tab). The KpiCard extraction is mechanical (one new file, two files reference it). Lint + typecheck via existing `npm run lint`.

## 11. Out-of-scope follow-ups (note for later)

- Persist filter state in localStorage so the operator's last-used period survives page reloads.
- Encode filter in URL (`?period=30_hari` or `?from=...&to=...`) so screenshots / shared links carry the period scope.
- `BroadcastChannel` for tab-sync if focus-refresh proves insufficient (e.g., operator works split-screen with both tabs visible).
- Sticky filter bar option if list scroll proves annoying with the bar scrolling away.
- Row click → new tab (in addition to the Detail button) — explicitly deferred per the user's "minimal change" preference.
