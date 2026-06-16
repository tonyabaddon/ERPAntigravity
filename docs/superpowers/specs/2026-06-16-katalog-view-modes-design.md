# Katalog View Modes — Foto Grid + List + Inline Expand

**Status:** Brainstorming done (2026-06-16), pending user spec review
**Owner:** tonywei
**Mockups:**
- `docs/superpowers/mockups/2026-06-16-katalog-view-modes.html` (3-mode comparison)
- `docs/superpowers/mockups/2026-06-16-katalog-click-behaviors.html` (click behavior comparison)
- `docs/superpowers/mockups/2026-06-16-katalog-inline-expand.html` (chosen inline expand panel, big photo)

**Estimated effort:** Small-to-medium (~2-3 hari dev, depending on test coverage)
**Depends on:** spec `2026-06-14-product-photo-search-design.md` (must ship `CatalogGridView.tsx` + `ProductForm.tsx` extraction first, since this spec adds sibling components and modifies the catalog screen header). This spec **can be implemented in parallel** with photo-search backend (AI indexing) since both touch different files; but the catalog UI components must be sequenced.

---

## 1. Scope & Goals

### Problem

Tampilan Katalog dengan grid foto besar (current design per spec `2026-06-14-product-photo-search-design.md`, 4 kolom, ~12 produk per layar) **menyulitkan operasi cari barang spesifik**:

1. Terlalu sedikit produk per layar — scroll panjang untuk lewatin 50 SKU.
2. SKU/nama/harga jadi sekunder, foto dominan.
3. Susah bandingin harga/stok antar produk side-by-side.
4. Workflow keyboard-first (toko sudah tahu produknya) ke-distract foto.

### Goals

1. **Tambah mode "List"** sebagai tampilan tabular yang dominan teks: kolom SKU, Nama, Brand, Harga, Stok Total + breakdown. ~25 produk per layar (3x lebih padat dari grid Foto).
2. **List jadi default view** (bukan Foto) — toko Sinar workflow operasional, bukan eksploratif. Mode Foto tetap tersedia, switchable dengan 1 klik segmented control.
3. **Klik foto thumb di mode List → inline expand panel** di bawah baris, foto besar 280x280 + gallery thumbs + bonus stok breakdown per gudang + tombol Edit / Tambah Foto / Riwayat Stok.
4. **Multi-expand** — user bisa buka panel di banyak baris sekaligus untuk bandingin foto.
5. **Smooth slide-down animasi** ~120ms supaya transisi gak kaget.

### Non-goals (definitif skip di spec ini)

- **Mode "Padat"** (compromise grid 6-col dense) — di-skip (user explicit).
- **Lightbox modal** — alternative untuk klik foto, di-skip (user pilih inline expand).
- **Klik untuk buka di tab baru** — di-skip karena route `produk` standalone belum ada. Bisa di-add nanti via spec berbeda saat detail-page dibikin.
- **Persist preferensi view mode** — selalu mulai List, gak ingat pilihan terakhir user (user explicit).
- **Setting Pengaturan untuk default toko-wide** — over-engineering.
- **Drag-resize panel inline expand** — fixed size, simpel.
- **Foto fullscreen / zoom** — kalau user mau lihat lebih detail, bisa klik thumb gallery untuk ganti foto utama atau (future) navigate ke detail page.
- **Keyboard shortcut Esc untuk tutup** — karena multi-expand, Esc ambigu (tutup yang mana?). Skip dulu.
- **Arrow ↑↓ navigation di tabel** — power-user feature, future enhancement.
- **Virtualisasi tabel** untuk 487+ baris — current data size (487 produk) masih OK di browser modern; tambahkan virtual scrolling kalau >2000 row.

### Multi-tenant readiness

Spec ini netral terhadap multi-tenant. Tidak ada DB schema change, tidak ada tenant-specific data. View mode state hanya UI state in-memory, gak perlu kolom DB. Implementation pattern sama untuk semua tenant.

### Boundaries

Semua perubahan UI-only di frontend React:

- **Modifikasi**: `src/components/produk/CatalogGridView.tsx` (yang akan dibuat di spec product-photo-search) — wrap dengan `ViewModeSwitcher`, conditional render Foto vs List.
- **Modifikasi**: `src/components/StockManagerScreen.tsx` orchestrator — tambahkan toolbar slot untuk view-mode switcher.
- **Komponen baru**: `src/components/produk/CatalogListView.tsx`, `src/components/produk/InlineExpandPanel.tsx`, `src/components/produk/StokGudangInline.tsx`, `src/components/produk/ViewModeSwitcher.tsx`.
- **No DB migration**.
- **No backend API change** — semua data sudah tersedia dari `stockService.list()` + `warehousesService.list()`.

---

## 2. View Mode Switcher

### UI

Segmented pill control di toolbar tab Katalog, di sebelah kanan search bar dan filter chips. 2 pill:

| Pill | Icon (Material Symbols) | Label | Aktif highlight |
|---|---|---|---|
| Foto | `grid_view` | "Foto" | bg `#012749` + text white |
| List | `view_list` | "List" | bg `#012749` + text white |

Inactive: `bg-slate-100`, `text-slate-600`, hover `bg-white`.

Container: `flex bg-slate-100 rounded-full p-1 gap-0.5` (matches existing pattern di mockup product-photo-search Round 5).

### State

- React local state di `CatalogGridView.tsx` (atau renamed `CatalogView.tsx`): `const [viewMode, setViewMode] = useState<'foto' | 'list'>('list')`.
- **Default value = `'list'`** — every fresh mount.
- **No persistence** — gak save ke localStorage / DB / URL. Tiap kali user open `produk-stok` page atau switch tab keluar-masuk Katalog, state reset ke `'list'`.
- Switching antar mode hanya re-render, **search query + filter state preserved** (live di state parent / context).

### Sequence

```
User open Produk & Stok
  └─ Tab "Katalog" (default)
       └─ CatalogView renders, viewMode = 'list'
            └─ User clicks "Foto" pill → setViewMode('foto')
                 └─ Conditional render switches to <CatalogGridView photos />
            └─ User scroll, type search, etc.
            └─ User switches tab to "Stok per Gudang" then back
                 └─ CatalogView re-mounts, viewMode resets to 'list'
```

---

## 3. Mode A — Foto (existing design)

Tetap sesuai spec `2026-06-14-product-photo-search-design.md`:

- Grid 4 kolom (desktop ≥1280px), 3 kolom (md), 2 kolom (sm)
- Card 1:1 aspect ratio
- Photo dominant, nama + SKU + kategori + harga + stok di bawah
- Hover: shadow elevate
- Klik card → buka edit modal (existing behavior dari `StockManagerScreen`)

**No change** di spec ini. Komponen `CatalogGridView.tsx` jadi sibling dari `CatalogListView.tsx`, masing-masing di-render conditional sesuai `viewMode`.

---

## 4. Mode B — List (new, default)

### Layout

Tabel padat 1 baris per produk. Container card: `bg-white rounded-3xl border border-[#e5eeff] shadow-sm overflow-hidden`. Tabel `w-full text-sm` (13px body).

### Kolom

| # | Kolom | Lebar | Konten | Note |
|---|---|---|---|---|
| 1 | Foto | `w-14` (~56px) | Thumb 40x40 (`w-10 h-10 rounded-lg`) atau placeholder dashed border kalau no photo | **Click target**: buka inline expand |
| 2 | SKU | auto | `font-mono text-[12px] text-slate-600` | |
| 3 | Nama Produk | auto (flex-1) | `font-bold text-[#012749]`, truncate kalau panjang | |
| 4 | Kategori / Brand | auto | "MCB · **Schneider**" (kategori dengan separator, brand bold) | |
| 5 | Harga | auto | `text-right font-extrabold text-[#012749]` | |
| 6 | Stok | auto | Total prominent + breakdown inline. Lihat §4.3 | |
| 7 | Expand chevron | `w-10` | `expand_more` (idle) atau `expand_less` (expanded) | **Click target**: buka inline expand (sama dengan kolom 1) |
| 8 | Aksi | auto-right | Tombol Edit (pencil), More (`more_horiz`) | |

Header row: `border-b-2 border-slate-200 bg-slate-50/50`, label uppercase `text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider`.

Row hover: `hover:bg-blue-50/40`. Aksi buttons: `opacity-60 group-hover:opacity-100` (fade in on hover).

### Stok kolom — total + breakdown gudang inline

Format:
```
142          ← Total (text-sm font-extrabold text-emerald-700, atau amber kalau ≤ min_stock, rose kalau ≤ 3)
Atas 87 · Bawah 55  ← Breakdown top 3 gudang, sort_order ascending (default warehouse first)
                       Font: text-[10.5px] text-slate-500
```

Logic untuk breakdown:
1. Fetch `warehouses` list (already cached via `warehousesService`).
2. Untuk tiap produk, dapatkan stok per warehouse_id (existing data dari `stockService.list()`).
3. Sort warehouses by `sort_order` ascending; ambil top 3.
4. Render `nama: qty` joined dengan ` · `.
5. Kalau jumlah warehouses > 3, tampilkan 3 pertama + `+N lagi` (no click handler — full breakdown muncul saat user expand panel).

**Catatan**: Sinar saat ini 2 gudang (Atas, Bawah) — display fits comfortably. Cutover warehouse phase 3 pending (lihat memory `project_phase3_warehouse_cutover_pending`); pastikan implementasi pakai `warehouse_id` (uuid) bukan legacy text column.

### No-photo case

Cell foto: `bg-slate-50 border border-dashed border-slate-300 rounded-lg flex items-center justify-center` dengan icon `image_not_supported text-slate-400`. Tidak clickable (cursor default, no expand panel trigger — user gak punya foto untuk dilihat).

### Pagination / virtualization

- Existing implementation di `StockManagerScreen` pakai client-side list dari `stockService.list()`. Tetap pakai pendekatan sama untuk MVP.
- Kalau dataset > 2000 produk di masa depan, switch ke virtualization (react-window / TanStack Virtual). Out of scope sekarang.

---

## 5. Inline Expand Panel

### Trigger

**Open**:
- Click thumbnail foto di kolom 1, atau
- Click chevron `expand_more` di kolom 7

Both triggers identical behavior. Click on Edit / More buttons di kolom Aksi **bukan** trigger expand (separate click handlers, `e.stopPropagation()`).

**Close** (per panel):
- Click ikon X di pojok kanan-atas panel, atau
- Click foto thumb di baris induk lagi (toggle)

**Close semua**:
- Tombol "Tutup semua" di toolbar (muncul conditional kalau `expandedRows.size > 0`).

**Multi-expand**: gak ada batas. User boleh buka 1, 5, atau semua baris sekaligus.

### State management

```ts
const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
const [currentPhotoIndex, setCurrentPhotoIndex] = useState<Map<string, number>>(new Map());

const toggleRow = (sku: string) => {
  setExpandedRows(prev => {
    const next = new Set(prev);
    next.has(sku) ? next.delete(sku) : next.add(sku);
    return next;
  });
  if (!expandedRows.has(sku)) {
    // Initialize to first photo when opening
    setCurrentPhotoIndex(prev => new Map(prev).set(sku, 0));
  }
};

const closeAll = () => {
  setExpandedRows(new Set());
  setCurrentPhotoIndex(new Map());
};
```

State scope: `CatalogListView.tsx`. Reset saat unmount (switch tab atau switch viewMode → state hilang, semua panel tutup).

### Panel layout (per baris yang di-expand)

Render sebagai `<tr><td colSpan={N}>...</td></tr>` di bawah baris induk. Background `bg-violet-50/40`, separator atas-bawah `border-t-2 border-b-2 border-violet-300`. Inner card: `bg-white rounded-2xl border border-violet-200 p-5 shadow-md`.

Split horizontal:

**Left (foto utama)**:
- Container `w-[280px] h-[280px] rounded-2xl flex-shrink-0`
- Background: foto produk (atau placeholder gradient kalau foto sedang loading)
- `object-cover` untuk fit foto 1:1

**Right (controls + meta)**:
- Header: nama produk + SKU + kategori/brand + tombol "Tutup" (ikon X dengan label)
- Gallery thumb strip: `flex gap-2`, thumbs `w-16 h-16 rounded-xl`, foto aktif border `border-violet-500`, lainnya `opacity-60 hover:opacity-100`
- Stok breakdown: `bg-slate-50 rounded-xl px-3 py-2`, list semua gudang format `Nama: qty` dipisah spasi
- Action buttons (bottom): "Edit Produk" (primary, navy), "Tambah Foto" (secondary, slate), "Riwayat Stok" (secondary, slate)

### Gallery navigation

- Click thumb di strip → update `currentPhotoIndex[sku]`, foto utama swap. Tidak buka panel baru, gak unmount.
- Kalau produk cuma punya 1 foto, gallery strip hidden (cuma 1 thumb = no point).
- Maksimum 5 foto per produk (sesuai spec foto-search).
- Kalau no foto sama sekali: panel tidak boleh terbuka (foto thumb di baris induk juga sudah disabled).

### Animation

Slide down + fade in:

```css
.expand-panel-enter {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
}
.expand-panel-enter-active {
  max-height: 360px;
  opacity: 1;
  transition: max-height 120ms ease-out, opacity 120ms ease-out;
}
.expand-panel-exit {
  max-height: 360px;
  opacity: 1;
}
.expand-panel-exit-active {
  max-height: 0;
  opacity: 0;
  transition: max-height 120ms ease-in, opacity 120ms ease-in;
}
```

Atau pakai `framer-motion` `<AnimatePresence>` kalau library sudah included (check existing `package.json`); else pakai plain CSS transition seperti di atas.

### "Tutup semua" toolbar button

Conditional render di toolbar (di sebelah view-mode switcher atau sebagai pill terpisah):

```tsx
{viewMode === 'list' && expandedRows.size > 0 && (
  <button onClick={closeAll}
          className="px-3 py-2 bg-violet-50 hover:bg-violet-100 text-violet-700 rounded-full text-xs font-bold inline-flex items-center gap-1.5">
    <span className="material-symbols-outlined text-base">unfold_less</span>
    Tutup {expandedRows.size} panel
  </button>
)}
```

Counter label informatif (`Tutup 3 panel`) supaya user tau berapa yang akan tertutup.

---

## 6. Komponen file structure

Berdasarkan refactor `StockManagerScreen.tsx` yang sudah direncanakan di spec `2026-06-14-product-photo-search-design.md`:

```
src/components/produk/
├── CatalogView.tsx              ← Orchestrator (NEW, atau rename CatalogGridView)
│                                  - Owns viewMode state, expandedRows state
│                                  - Renders ViewModeSwitcher in toolbar
│                                  - Conditional renders <CatalogGridView /> atau <CatalogListView />
├── CatalogGridView.tsx          ← Mode Foto, existing (per spec foto-search)
├── CatalogListView.tsx          ← Mode List, NEW
│                                  - Tabel padat + InlineExpandPanel rows
├── InlineExpandPanel.tsx        ← Panel besar foto + gallery + actions, NEW
├── StokGudangInline.tsx         ← Renderer untuk kolom Stok di list, NEW
│                                  - Show total + breakdown top 3
├── ViewModeSwitcher.tsx         ← Segmented pill control, NEW
├── ProductForm.tsx              ← Form tambah/edit, existing (per spec foto-search)
├── StockTableView.tsx           ← Tab "Stok per Gudang", existing
├── BulkUploadSection.tsx        ← Tab "Bulk Upload", existing
└── PreviewCard.tsx              ← Live preview untuk form, existing
```

`StockManagerScreen.tsx` (orchestrator) cuma routing tab, gak owning state CatalogView.

---

## 7. Data flow

```
StockManagerScreen.tsx
  ↓ (props: stocks, warehouses, etc.)
CatalogView.tsx
  ├─ state: viewMode ('foto' | 'list'), expandedRows (Set), currentPhotoIndex (Map)
  ├─ derived: filteredStocks (search + filter applied)
  ↓ (conditional)
  ├─ {viewMode === 'foto'} → <CatalogGridView stocks={filteredStocks} />
  └─ {viewMode === 'list'} → <CatalogListView
                                stocks={filteredStocks}
                                warehouses={warehouses}
                                expandedRows={expandedRows}
                                currentPhotoIndex={currentPhotoIndex}
                                onToggle={toggleRow}
                                onCloseAll={closeAll}
                                onPhotoSelect={setPhotoIndex}
                              />
                                ├─ map filteredStocks → <tr>
                                ├─ if (expandedRows.has(sku)) → <tr><td><InlineExpandPanel /></td></tr>
                                └─ <StokGudangInline> di kolom Stok
```

Photos data: assume `stocks[i].photos: PhotoMeta[]` populated dari Supabase query (existing per spec foto-search). `PhotoMeta = { id, url, thumb_url, sort_order, is_primary }`.

---

## 8. Error handling

| Skenario | Behavior |
|---|---|
| `stocks[i].photos` undefined / `[]` | Render placeholder cell (icon `image_not_supported`), no click handler |
| Foto URL gagal load (404) | `<img onError>` fallback ke placeholder SVG (sama dengan foto-search spec) |
| `warehouses` list belum loaded | Stok kolom show total saja tanpa breakdown (skeleton placeholder atau dash) |
| User klik thumb saat panel sedang animating | Block toggle (`pointerEvents: none` selama 120ms) untuk avoid race |
| Expanded panel di-trigger lalu produk dihapus dari list | Cleanup: filter `expandedRows` saat `stocks` array berubah, drop SKU yang gak ada di list lagi |

---

## 9. Testing

### Unit

`src/components/produk/__tests__/`:

- `ViewModeSwitcher.test.tsx`: render + click switches mode + tooltip text
- `StokGudangInline.test.tsx`: render dengan 1, 2, 3, 4, 5 gudang — check format string + top-3 logic
- `InlineExpandPanel.test.tsx`: render dengan 1, 3, 5 photos — gallery thumbs visibility + active border
- `CatalogListView.test.tsx`: toggle row → state change, multi-expand independence, closeAll drops semua

### Integration

- Switch dari Foto ke List preserves search + filter state
- Switch dari List ke Foto closes all expanded panels (state reset)
- Tab switch (Katalog → Stok per Gudang → Katalog) resets viewMode ke 'list' dan expandedRows ke empty Set

### Manual smoke test (per `verify` skill convention)

Setelah deploy ke local dev server:
1. Open `?screen=produk-stok` → default tab Katalog, default view List.
2. Verify ~25 produk visible (desktop 1280px width).
3. Klik foto thumb baris pertama → panel slide-down dengan animasi halus, foto 280x280 muncul.
4. Klik thumb produk berbeda → panel kedua terbuka, panel pertama TETAP terbuka (multi-expand verify).
5. Klik chevron baris ke-3 → buka panel via chevron path (verify alternate open trigger).
6. Klik foto thumb panel pertama lagi → panel pertama tutup, panel kedua + ketiga tetap.
7. Klik ikon X di panel kedua → tutup panel kedua.
8. Tombol "Tutup 1 panel" muncul, klik → panel terakhir tutup, button hilang.
9. Switch ke Foto via segmented control → list view hilang, grid foto muncul. Switch balik ke List → fresh state (semua panel tutup).

---

## 10. Accessibility

- Foto thumb `<button>` dengan `aria-label="Lihat foto MCB Easy9 1P 6A"` (composed dari nama produk).
- Chevron `<button>` dengan `aria-expanded={expandedRows.has(sku)}`.
- Panel `<tr>` dengan `role="region"` + `aria-label="Detail foto {nama produk}"`.
- Gallery thumb `<button>` dengan `aria-label="Foto {n} dari {total}"` dan `aria-current={n === currentPhotoIndex[sku] ? 'true' : 'false'}`.
- Tab order: row foto thumb → row chevron → row Edit/More → next row foto thumb. Panel content (gallery + actions) di-tab setelah row content.

---

## 11. Performance

- 487 row × (2 thumbnails image element per row di list = 1) = ~487 `<img>` di DOM. Browser modern handle OK.
- `<img loading="lazy">` untuk thumb foto supaya off-screen rows gak load image network.
- Inline expand panel: render conditional, gak mount kalau bukan expanded. Saat tutup, unmount → free DOM.
- Re-render minimization: `React.memo` di `CatalogListView` row component, key by `sku`.

---

## 12. Migration / rollout

- **No DB migration needed**.
- **No feature flag** — UI-only change, low risk, ship langsung saat merge.
- **Sequencing**: ship setelah spec `2026-06-14-product-photo-search-design.md` Phase 1 (form + multi-foto upload + `CatalogGridView` extraction) merged. Spec ini adalah delta on top of that.
- **Rollback**: kalau ada masalah, revert commit (single PR scope). Tidak ada user data yang ter-affected.

---

## 13. Open questions for implementation phase

(To be resolved during writing-plans / implementation, not blocking spec approval)

1. `framer-motion` sudah ada di `package.json`? Kalau ya, pakai untuk animasi. Kalau enggak, plain CSS transition.
2. Cara dapatkan `warehouses` list di komponen `StokGudangInline` — context, prop drilling, atau new hook `useWarehouses()`?
3. Saat user buka `InlineExpandPanel` untuk pertama kali, apakah lazy-fetch full-resolution photos (kalau thumb URL beda dari main URL), atau langsung pakai thumb URL?
4. Tombol "Edit Produk" di panel — buka modal Edit yang existing, atau navigate ke form Edit inline?
