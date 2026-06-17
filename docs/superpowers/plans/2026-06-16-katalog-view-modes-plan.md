# Katalog View Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `Foto` ↔ `List` view mode switcher to the Katalog tab, with an inline-expand photo panel that opens beneath any List row.

**Architecture:** 4 new components dropped into the existing `src/components/produk/` folder + a small state update to the already-extracted `CatalogView.tsx` orchestrator. Foto mode is the existing `CatalogGridView`; List mode is a new table view; clicking a thumb in List opens a 280×280 photo panel inline. View-mode state is local to `CatalogView`, **not persisted** — every fresh mount starts on `list`.

**Tech Stack:** React 19 + TypeScript + Vitest 4 + Tailwind CSS + Material Symbols icons. Plain CSS transitions for slide-down (no framer-motion). Test pure logic with Vitest; UI verified via manual smoke (no testing-library setup needed for this plan).

---

## Prerequisites (must be satisfied before this plan runs)

Spec `2026-06-14-product-photo-search-design.md` **Phase 1** must be merged first. Verify with `ls`:

```bash
ls src/components/produk/
# expected: CatalogGridView.tsx  CatalogView.tsx  ProductForm.tsx  StockTableView.tsx  BulkUploadSection.tsx  PreviewCard.tsx
```

Verify `StockItem` carries a photos array (added by foto-search Phase 1):

```bash
grep -n "photos" src/types.ts
# expected to find: `photos?: PhotoMeta[]` (or similar) on StockItem
# expected to find: an exported `PhotoMeta` type
```

If those grep checks fail, **stop and ship foto-search Phase 1 first.** This plan is not executable against the current `feat/piutang-tempo-v2` HEAD because `src/components/produk/` does not exist yet.

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `src/components/produk/CatalogView.tsx` | Orchestrator. Owns `viewMode` + `expandedRows` state, renders switcher + grid/list. | Modify |
| `src/components/produk/CatalogGridView.tsx` | Mode Foto: 4-column photo grid (existing). | Unchanged |
| `src/components/produk/ViewModeSwitcher.tsx` | Segmented pill (Foto/List). Pure presentational. | Create |
| `src/components/produk/CatalogListView.tsx` | Mode List: padded table + inline-expand rows. | Create |
| `src/components/produk/InlineExpandPanel.tsx` | 280×280 main photo + gallery thumb strip + stok breakdown + action buttons. | Create |
| `src/components/produk/StokGudangInline.tsx` | Stok cell render (total + top-3 named breakdown). | Create |
| `src/components/produk/stokGudangFormat.ts` | Pure helper that picks top-3 warehouse rows. Unit-tested. | Create |
| `src/components/produk/__tests__/stokGudangFormat.test.ts` | Vitest tests for the pure helper. | Create |

No DB migration. No new dev dependency. No backend API change.

---

### Task 1: ViewModeSwitcher

**Files:**
- Create: `src/components/produk/ViewModeSwitcher.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/produk/ViewModeSwitcher.tsx
import React from 'react';

export type ViewMode = 'foto' | 'list';

interface Props {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
}

const PILL_BASE =
  'px-3 py-1.5 rounded-full text-xs font-bold inline-flex items-center gap-1.5';
const PILL_ACTIVE = 'bg-[#012749] text-white';
const PILL_INACTIVE = 'text-slate-600 hover:bg-white';

export default function ViewModeSwitcher({ value, onChange }: Props) {
  return (
    <div className="flex bg-slate-100 rounded-full p-1 gap-0.5" role="group" aria-label="View mode">
      <button
        type="button"
        className={`${PILL_BASE} ${value === 'foto' ? PILL_ACTIVE : PILL_INACTIVE} ${value === 'foto' ? 'font-extrabold' : ''}`}
        onClick={() => onChange('foto')}
        aria-pressed={value === 'foto'}
        title="Mode Foto — grid besar dengan foto dominan"
      >
        <span className="material-symbols-outlined text-base">grid_view</span> Foto
      </button>
      <button
        type="button"
        className={`${PILL_BASE} ${value === 'list' ? PILL_ACTIVE : PILL_INACTIVE} ${value === 'list' ? 'font-extrabold' : ''}`}
        onClick={() => onChange('list')}
        aria-pressed={value === 'list'}
        title="Mode List — tabular, foto sebagai thumbnail"
      >
        <span className="material-symbols-outlined text-base">view_list</span> List
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/produk/ViewModeSwitcher.tsx
git commit -m "feat(produk): ViewModeSwitcher segmented pill (Foto/List)"
```

---

### Task 2: StokGudangInline (helper + component)

**Files:**
- Create: `src/components/produk/stokGudangFormat.ts`
- Create: `src/components/produk/__tests__/stokGudangFormat.test.ts`
- Create: `src/components/produk/StokGudangInline.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/produk/__tests__/stokGudangFormat.test.ts
import { describe, it, expect } from 'vitest';
import { pickTopGudang } from '../stokGudangFormat';
import type { Warehouse } from '../../../types';

const wh = (id: string, name: string, sort_order: number): Warehouse =>
  ({ id, code: id.toUpperCase(), name, sort_order, is_default: false, is_active: true, address: null } as Warehouse);

describe('pickTopGudang', () => {
  it('returns all warehouses with stock when count <= 3, sorted by sort_order asc', () => {
    const warehouses = [wh('w2', 'Bawah', 2), wh('w1', 'Atas', 1)];
    const stockByWh = new Map([['w1', 87], ['w2', 55]]);
    const result = pickTopGudang(warehouses, stockByWh);
    expect(result).toEqual({
      shown: [{ name: 'Atas', qty: 87 }, { name: 'Bawah', qty: 55 }],
      remaining: 0,
    });
  });

  it('returns top 3 by sort_order and counts the remainder when count > 3', () => {
    const warehouses = [
      wh('w1', 'A', 1), wh('w2', 'B', 2), wh('w3', 'C', 3),
      wh('w4', 'D', 4), wh('w5', 'E', 5),
    ];
    const stockByWh = new Map([['w1', 10], ['w2', 20], ['w3', 30], ['w4', 40], ['w5', 50]]);
    const result = pickTopGudang(warehouses, stockByWh);
    expect(result.shown).toEqual([
      { name: 'A', qty: 10 }, { name: 'B', qty: 20 }, { name: 'C', qty: 30 },
    ]);
    expect(result.remaining).toBe(2);
  });

  it('treats missing stock as 0', () => {
    const warehouses = [wh('w1', 'Atas', 1), wh('w2', 'Bawah', 2)];
    const stockByWh = new Map([['w1', 87]]);
    const result = pickTopGudang(warehouses, stockByWh);
    expect(result.shown).toEqual([{ name: 'Atas', qty: 87 }, { name: 'Bawah', qty: 0 }]);
    expect(result.remaining).toBe(0);
  });

  it('returns empty shown + 0 remaining when warehouses list is empty', () => {
    const result = pickTopGudang([], new Map());
    expect(result).toEqual({ shown: [], remaining: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/produk/__tests__/stokGudangFormat.test.ts
```

Expected: FAIL with `Cannot find module '../stokGudangFormat'`.

- [ ] **Step 3: Implement the helper**

```ts
// src/components/produk/stokGudangFormat.ts
import type { Warehouse } from '../../types';

export interface GudangChip {
  name: string;
  qty: number;
}

export interface TopGudangResult {
  shown: GudangChip[];
  remaining: number;
}

/**
 * Pick the first 3 warehouses by sort_order ascending and render each as
 * { name, qty }. `remaining` counts the rest so the caller can show "+N lagi".
 */
export function pickTopGudang(
  warehouses: Warehouse[],
  stockByWarehouseId: Map<string, number>,
): TopGudangResult {
  const sorted = [...warehouses].sort((a, b) => a.sort_order - b.sort_order);
  const shown = sorted.slice(0, 3).map(w => ({
    name: w.name,
    qty: stockByWarehouseId.get(w.id) ?? 0,
  }));
  const remaining = Math.max(0, sorted.length - 3);
  return { shown, remaining };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/components/produk/__tests__/stokGudangFormat.test.ts
```

Expected: PASS — all 4 tests green.

- [ ] **Step 5: Implement the render component**

```tsx
// src/components/produk/StokGudangInline.tsx
import React from 'react';
import type { Warehouse } from '../../types';
import { pickTopGudang } from './stokGudangFormat';

interface Props {
  total: number;
  warehouses: Warehouse[];
  stockByWarehouseId: Map<string, number>;
  minStock: number;
}

export default function StokGudangInline({ total, warehouses, stockByWarehouseId, minStock }: Props) {
  const { shown, remaining } = pickTopGudang(warehouses, stockByWarehouseId);

  const totalColor =
    total <= 3 ? 'text-rose-700'
      : total <= minStock ? 'text-amber-700'
      : 'text-emerald-700';

  return (
    <div className="flex flex-col items-center leading-tight">
      <span className={`text-sm font-extrabold ${totalColor}`}>{total}</span>
      {shown.length > 0 && (
        <span className="text-[10.5px] text-slate-500 mt-0.5">
          {shown.map((g, i) => (
            <React.Fragment key={g.name}>
              {i > 0 && <span className="mx-1 text-slate-300">·</span>}
              <span>{g.name} {g.qty}</span>
            </React.Fragment>
          ))}
          {remaining > 0 && <span className="ml-1 text-slate-400">+{remaining} lagi</span>}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/produk/stokGudangFormat.ts \
        src/components/produk/__tests__/stokGudangFormat.test.ts \
        src/components/produk/StokGudangInline.tsx
git commit -m "feat(produk): StokGudangInline + top-3 helper with tests"
```

---

### Task 3: InlineExpandPanel

**Files:**
- Create: `src/components/produk/InlineExpandPanel.tsx`

This component renders the 280×280 main photo + gallery thumb strip + stok breakdown + action buttons. State (current photo index, expanded set) is passed in from `CatalogListView` — this is a pure presentational component.

- [ ] **Step 1: Create the component**

```tsx
// src/components/produk/InlineExpandPanel.tsx
import React from 'react';
import type { StockItem, PhotoMeta, Warehouse } from '../../types';

interface Props {
  item: StockItem;
  warehouses: Warehouse[];
  stockByWarehouseId: Map<string, number>;
  currentPhotoIndex: number;
  onPhotoSelect: (sku: string, index: number) => void;
  onClose: (sku: string) => void;
  onEdit: (sku: string) => void;
  onAddPhoto: (sku: string) => void;
  onHistory: (sku: string) => void;
}

export default function InlineExpandPanel({
  item, warehouses, stockByWarehouseId,
  currentPhotoIndex, onPhotoSelect, onClose, onEdit, onAddPhoto, onHistory,
}: Props) {
  const photos: PhotoMeta[] = item.photos ?? [];
  const mainPhoto = photos[currentPhotoIndex];
  const sortedWarehouses = [...warehouses].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="bg-white rounded-2xl border border-violet-200 p-5 shadow-md">
      <div className="flex gap-6">
        {/* Main photo */}
        <div className="w-[280px] h-[280px] rounded-2xl flex-shrink-0 bg-slate-100 flex items-center justify-center overflow-hidden">
          {mainPhoto ? (
            <img src={mainPhoto.url} alt={item.name} className="w-full h-full object-cover" />
          ) : (
            <span className="material-symbols-outlined text-6xl text-slate-300">image_not_supported</span>
          )}
        </div>

        {/* Right: controls + meta */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-[10px] font-extrabold text-violet-700 uppercase tracking-widest">
                Foto Produk · {photos.length > 0 ? `${currentPhotoIndex + 1} dari ${photos.length}` : 'belum ada foto'}
              </p>
              <h3 className="text-base font-extrabold text-[#012749] mt-0.5">{item.name}</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                <span className="font-mono">{item.sku}</span> · {item.category}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onClose(item.sku)}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full text-[11px] font-extrabold inline-flex items-center gap-1"
              aria-label={`Tutup panel ${item.name}`}
            >
              <span className="material-symbols-outlined text-base">close</span> Tutup
            </button>
          </div>

          {/* Gallery strip — only when multi-photo */}
          {photos.length > 1 && (
            <>
              <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                Foto lain — klik untuk ganti foto utama
              </p>
              <div className="flex gap-2 mb-4">
                {photos.map((p, i) => (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => onPhotoSelect(item.sku, i)}
                    aria-label={`Foto ${i + 1} dari ${photos.length}`}
                    aria-current={i === currentPhotoIndex}
                    className={`w-16 h-16 rounded-xl overflow-hidden bg-slate-100 ${
                      i === currentPhotoIndex
                        ? 'ring-2 ring-violet-500'
                        : 'opacity-60 hover:opacity-100 ring-2 ring-transparent hover:ring-violet-300'
                    }`}
                  >
                    <img src={p.thumb_url ?? p.url} alt={`Foto ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Stok breakdown — all warehouses */}
          <div className="bg-slate-50 rounded-xl px-3 py-2 mb-3">
            <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1">
              Stok per Gudang
            </p>
            <div className="flex flex-wrap gap-4 text-[12px]">
              {sortedWarehouses.map(w => (
                <span key={w.id} className="font-bold">
                  <span className="text-slate-500">{w.name}:</span>{' '}
                  <span className="text-emerald-700">{stockByWarehouseId.get(w.id) ?? 0}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 mt-auto flex-wrap">
            <button
              type="button"
              onClick={() => onEdit(item.sku)}
              className="px-4 py-2 bg-[#012749] hover:bg-[#01345f] text-white rounded-full text-[11px] font-extrabold uppercase tracking-wider inline-flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-base">edit</span> Edit Produk
            </button>
            <button
              type="button"
              onClick={() => onAddPhoto(item.sku)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-[#012749] rounded-full text-[11px] font-extrabold uppercase tracking-wider inline-flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-base">add_a_photo</span> Tambah Foto
            </button>
            <button
              type="button"
              onClick={() => onHistory(item.sku)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-[#012749] rounded-full text-[11px] font-extrabold uppercase tracking-wider inline-flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-base">history</span> Riwayat Stok
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/produk/InlineExpandPanel.tsx
git commit -m "feat(produk): InlineExpandPanel — 280x280 photo + gallery + stok breakdown"
```

---

### Task 4: CatalogListView

**Files:**
- Create: `src/components/produk/CatalogListView.tsx`

The table view. Receives state (expandedRows, currentPhotoIndex) from parent via props. Uses `StokGudangInline` and `InlineExpandPanel`.

- [ ] **Step 1: Create the component**

```tsx
// src/components/produk/CatalogListView.tsx
import React from 'react';
import type { StockItem, Warehouse } from '../../types';
import StokGudangInline from './StokGudangInline';
import InlineExpandPanel from './InlineExpandPanel';

interface Props {
  items: StockItem[];
  warehouses: Warehouse[];
  minStockThreshold: number;
  expandedRows: Set<string>;
  currentPhotoIndex: Map<string, number>;
  onToggleRow: (sku: string) => void;
  onPhotoSelect: (sku: string, index: number) => void;
  onCloseRow: (sku: string) => void;
  onEdit: (sku: string) => void;
  onAddPhoto: (sku: string) => void;
  onHistory: (sku: string) => void;
}

/** O(1) lookup of stock per (sku, warehouse_id) for a given item. */
function buildStockMap(item: StockItem): Map<string, number> {
  const m = new Map<string, number>();
  for (const [whId, qty] of Object.entries(item.stockByWarehouseId ?? {})) {
    m.set(whId, qty as number);
  }
  return m;
}

export default function CatalogListView({
  items, warehouses, minStockThreshold,
  expandedRows, currentPhotoIndex,
  onToggleRow, onPhotoSelect, onCloseRow, onEdit, onAddPhoto, onHistory,
}: Props) {
  return (
    <div className="bg-white rounded-3xl border border-[#e5eeff] shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b-2 border-slate-200 bg-slate-50/50">
            <th className="py-2.5 pl-3 pr-2 text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider w-14">Foto</th>
            <th className="py-2.5 px-2 text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider">SKU</th>
            <th className="py-2.5 px-2 text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider">Nama Produk</th>
            <th className="py-2.5 px-2 text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider">Kategori</th>
            <th className="py-2.5 px-2 text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider text-right">Harga</th>
            <th className="py-2.5 px-2 text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider text-center">Stok</th>
            <th className="py-2.5 px-2 text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider w-10"></th>
            <th className="py-2.5 px-2 pr-3 text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider text-right">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => {
            const isExpanded = expandedRows.has(item.sku);
            const stockMap = buildStockMap(item);
            const photoIndex = currentPhotoIndex.get(item.sku) ?? 0;
            const firstPhoto = item.photos?.[0];
            const hasPhoto = !!firstPhoto;

            return (
              <React.Fragment key={item.sku}>
                <tr className={`border-b border-slate-100 hover:bg-blue-50/40 group ${isExpanded ? 'bg-violet-50/40' : ''}`}>
                  {/* Foto thumb */}
                  <td className="py-2 pl-3 pr-2">
                    {hasPhoto ? (
                      <button
                        type="button"
                        onClick={() => onToggleRow(item.sku)}
                        className={`w-10 h-10 rounded-lg overflow-hidden bg-slate-100 ${isExpanded ? 'ring-2 ring-violet-500' : 'hover:ring-2 hover:ring-emerald-400'}`}
                        aria-label={`Lihat foto ${item.name}`}
                        aria-expanded={isExpanded}
                      >
                        <img src={firstPhoto.thumb_url ?? firstPhoto.url} alt="" loading="lazy" className="w-full h-full object-cover" />
                      </button>
                    ) : (
                      <div
                        className="w-10 h-10 bg-slate-50 border border-dashed border-slate-300 rounded-lg flex items-center justify-center"
                        title="Belum ada foto"
                      >
                        <span className="material-symbols-outlined text-base text-slate-400">image_not_supported</span>
                      </div>
                    )}
                  </td>
                  <td className="py-2 px-2 font-mono text-[12px] text-slate-600">{item.sku}</td>
                  <td className="py-2 px-2 font-bold text-[#012749]">{item.name}</td>
                  <td className="py-2 px-2 text-slate-600">{item.category}</td>
                  <td className="py-2 px-2 text-right font-extrabold text-[#012749]">
                    Rp {new Intl.NumberFormat('id-ID').format(item.price)}
                  </td>
                  <td className="py-2 px-2 text-center">
                    <StokGudangInline
                      total={item.stock}
                      warehouses={warehouses}
                      stockByWarehouseId={stockMap}
                      minStock={minStockThreshold}
                    />
                  </td>
                  {/* Chevron — second open trigger */}
                  <td className="py-2 px-2 text-center">
                    <button
                      type="button"
                      onClick={() => hasPhoto && onToggleRow(item.sku)}
                      disabled={!hasPhoto}
                      className="p-1 rounded-full hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label={isExpanded ? 'Tutup panel' : 'Buka panel'}
                      aria-expanded={isExpanded}
                    >
                      <span className="material-symbols-outlined text-base text-slate-500">
                        {isExpanded ? 'expand_less' : 'expand_more'}
                      </span>
                    </button>
                  </td>
                  <td className="py-2 pr-3 px-2 text-right">
                    <button
                      type="button"
                      onClick={() => onEdit(item.sku)}
                      className="text-[#012749] hover:bg-slate-100 rounded-full p-1 opacity-60 group-hover:opacity-100"
                      aria-label={`Edit ${item.name}`}
                    >
                      <span className="material-symbols-outlined text-lg">edit</span>
                    </button>
                  </td>
                </tr>

                {isExpanded && (
                  <tr className="bg-violet-50/40 border-b-2 border-violet-300">
                    <td colSpan={8} className="px-3 pb-5 pt-1">
                      <InlineExpandPanel
                        item={item}
                        warehouses={warehouses}
                        stockByWarehouseId={stockMap}
                        currentPhotoIndex={photoIndex}
                        onPhotoSelect={onPhotoSelect}
                        onClose={onCloseRow}
                        onEdit={onEdit}
                        onAddPhoto={onAddPhoto}
                        onHistory={onHistory}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      {items.length === 0 && (
        <p className="text-center py-12 text-slate-400 font-semibold text-sm">
          Tidak ada produk yang cocok dengan filter pencarian.
        </p>
      )}
    </div>
  );
}
```

> **Perf note:** `loading="lazy"` on both thumb and gallery `<img>` keeps off-screen images out of the network. If row count grows past ~2000, consider wrapping the table body row component with `React.memo(..., (a, b) => a.item === b.item && a.isExpanded === b.isExpanded)` — defer until measured slow.
>
> **Note for implementer:** `StockItem.stockByWarehouseId` is the per-warehouse stock map added by foto-search Phase 1 (it lives alongside `stock_atas`/`stock_bawah` until the warehouse-cutover lands). If Phase 1 named the field differently, adjust the `buildStockMap` reader accordingly — do not silently fall back to `stock_atas`/`stock_bawah`, log and stop.

- [ ] **Step 2: Commit**

```bash
git add src/components/produk/CatalogListView.tsx
git commit -m "feat(produk): CatalogListView table + inline-expand wiring"
```

---

### Task 5: Wire view-mode state into CatalogView

**Files:**
- Modify: `src/components/produk/CatalogView.tsx`

`CatalogView` already exists from foto-search Phase 1 and renders `<CatalogGridView />`. We add `viewMode` + `expandedRows` + `currentPhotoIndex` state, render the switcher in the toolbar, conditional-render Grid vs List, and add the "Tutup semua" button.

- [ ] **Step 1: Read current CatalogView to find the toolbar slot**

```bash
sed -n '1,80p' src/components/produk/CatalogView.tsx
```

Locate where the search bar / filter chips render. The switcher slots in directly after the filter chips, before any "+ Tambah Barang" button.

- [ ] **Step 2: Add state + imports at the top of CatalogView**

Inside the component function, add:

```tsx
import ViewModeSwitcher, { type ViewMode } from './ViewModeSwitcher';
import CatalogListView from './CatalogListView';
// ... existing imports stay

// inside the component:
const [viewMode, setViewMode] = useState<ViewMode>('list');
const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
const [currentPhotoIndex, setCurrentPhotoIndex] = useState<Map<string, number>>(new Map());

const toggleRow = (sku: string) => {
  setExpandedRows(prev => {
    const next = new Set(prev);
    if (next.has(sku)) next.delete(sku);
    else { next.add(sku); }
    return next;
  });
  setCurrentPhotoIndex(prev => {
    if (prev.has(sku)) return prev;
    const next = new Map(prev);
    next.set(sku, 0);
    return next;
  });
};

const closeRow = (sku: string) => {
  setExpandedRows(prev => {
    const next = new Set(prev);
    next.delete(sku);
    return next;
  });
};

const closeAll = () => {
  setExpandedRows(new Set());
  setCurrentPhotoIndex(new Map());
};

const selectPhoto = (sku: string, index: number) => {
  setCurrentPhotoIndex(prev => new Map(prev).set(sku, index));
};
```

- [ ] **Step 3: Render the switcher + "Tutup semua" in the toolbar**

In the toolbar JSX (after filter chips, before "+ Tambah Barang"), insert:

```tsx
<ViewModeSwitcher value={viewMode} onChange={(next) => {
  setViewMode(next);
  // Switching modes drops all expanded panels — grid mode has none.
  closeAll();
}} />

{viewMode === 'list' && expandedRows.size > 0 && (
  <button
    type="button"
    onClick={closeAll}
    className="px-3 py-2 bg-violet-50 hover:bg-violet-100 text-violet-700 rounded-full text-xs font-bold inline-flex items-center gap-1.5"
    aria-label={`Tutup ${expandedRows.size} panel terbuka`}
  >
    <span className="material-symbols-outlined text-base">unfold_less</span>
    Tutup {expandedRows.size} panel
  </button>
)}
```

- [ ] **Step 4: Conditional render Grid vs List**

Replace the existing `<CatalogGridView ... />` invocation with:

```tsx
{viewMode === 'foto' ? (
  <CatalogGridView items={filteredItems} /* ...existing props... */ />
) : (
  <CatalogListView
    items={filteredItems}
    warehouses={warehouses}
    minStockThreshold={10}
    expandedRows={expandedRows}
    currentPhotoIndex={currentPhotoIndex}
    onToggleRow={toggleRow}
    onPhotoSelect={selectPhoto}
    onCloseRow={closeRow}
    onEdit={(sku) => { /* existing edit handler */ }}
    onAddPhoto={(sku) => { /* navigate to ProductForm photo section */ }}
    onHistory={(sku) => { /* navigate to stock history view */ }}
  />
)}
```

> **Implementer note:** the `onEdit`, `onAddPhoto`, `onHistory` handlers depend on what foto-search Phase 1 wired up. If those flows already exist in `CatalogView`, reuse them. If they don't exist yet, stub with a `showToast('TODO', 'info')` and file a follow-up — do NOT block this PR on them.

- [ ] **Step 5: Add the slide-down CSS**

Append to `src/index.css` (or wherever global styles live — `grep -rn "tailwindcss" src/index.css` to confirm path):

```css
@keyframes katalog-expand-in {
  from { max-height: 0; opacity: 0; }
  to   { max-height: 360px; opacity: 1; }
}
.katalog-expand-row > td > * { animation: katalog-expand-in 120ms ease-out; }
```

Then add `className="katalog-expand-row"` to the expanded `<tr>` in `CatalogListView.tsx` (Task 4 step 1, the `{isExpanded && (<tr ...>` block).

- [ ] **Step 6: Type-check the project**

```bash
npx tsc --noEmit
```

Expected: no errors. If TS complains about `StockItem.stockByWarehouseId`, confirm with foto-search Phase 1's actual field shape and adjust.

- [ ] **Step 7: Commit**

```bash
git add src/components/produk/CatalogView.tsx src/index.css
git commit -m "feat(produk): wire view-mode switcher + multi-expand state into CatalogView"
```

---

### Task 6: Manual smoke test

**Files:**
- Modify: `progress.md` (append entry per project CLAUDE.md)

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Wait for `Local: http://localhost:5173/` (or whichever port Vite reports).

- [ ] **Step 2: Walk the smoke checklist**

Open `http://localhost:5173/?screen=produk-stok` in a browser and verify in order:

1. Default tab = Katalog, default view = List. Switcher shows "List" pill highlighted navy.
2. ~25 rows visible at desktop width (1280px). Stok column shows total on top, "Atas N · Bawah M" below.
3. Click foto thumb on row #1 → panel slides down ~120ms, foto 280×280 visible, gallery thumbs visible if >1 photo.
4. Click foto thumb on row #3 → second panel opens. Panel #1 STAYS open (multi-expand).
5. Click chevron on row #5 → third panel opens via alternate trigger.
6. Click foto thumb on row #1 again → row #1 closes; rows #3 + #5 stay.
7. Click X in row #3 panel → row #3 closes.
8. Toolbar shows "Tutup 1 panel" pill. Click it → last panel closes, pill disappears.
9. Click "Foto" pill → list disappears, grid appears. All expanded state was already empty (closed in step 8); if you had any open, they reset.
10. Switch back to "List" → fresh, no panels open.

If any step fails, **stop and fix before continuing.** Document the failure inline rather than papering over.

- [ ] **Step 3: Run the full unit test suite**

```bash
npx vitest run
```

Expected: all tests green, including the new `stokGudangFormat.test.ts`.

- [ ] **Step 4: Update progress.md**

Append a brief entry under today's date describing what shipped (the view-mode switcher + List view + InlineExpandPanel) and link to this plan + spec.

- [ ] **Step 5: Commit progress + smoke artifacts**

```bash
git add progress.md
git commit -m "docs(progress): Katalog view modes — shipped (Foto/List switcher + inline expand)"
```

---

## Out of scope (explicit non-goals — do not implement)

- Keyboard arrow ↑↓ row navigation, Space-to-expand, Esc handling
- View-mode persistence (localStorage / DB / URL)
- Mode "Padat" dense grid (user explicitly dropped)
- Lightbox modal (user picked inline expand instead)
- Detail-page route + tab-baru-from-thumb (depends on a separate spec)
- Table virtualization (defer until > 2000 row datasets)
- Renaming/moving any existing `produk/` components

Any of the above resurfacing during implementation is signal to file a new spec, not to widen this plan.
