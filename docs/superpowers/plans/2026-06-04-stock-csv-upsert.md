# Stock CSV Import — Add + Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CSV import supports both adding new products and updating existing ones (by SKU, then by name as fallback), and persists directly to Supabase.

**Architecture:** Two files change. `supabaseClient.ts` gets a `bulkUpsert` method on `stockService`. `StockManagerScreen.tsx` gets an updated CSV header (adds `sku`, `nama` columns), a new `handleExportStock` function, updated `parseAndUploadCSV` with 3-level upsert logic, and a new "Export Stok" button in the UI.

**Tech Stack:** React 18, TypeScript, Supabase JS client, Tailwind CSS

---

### Task 1: Add `stockService.bulkUpsert` to `supabaseClient.ts`

**Files:**
- Modify: `src/lib/supabaseClient.ts` (after the existing `fetchAll` method, around line 684)

- [ ] **Step 1: Add `bulkUpsert` method to `stockService`**

Open `src/lib/supabaseClient.ts`. Find the `stockService` object. After the `fetchAll` method (which ends around line 684), add:

```typescript
  async bulkUpsert(items: SupabaseStockItem[]): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('stocks')
      .upsert(
        items.map(item => ({
          sku: item.sku,
          name: item.name,
          category: item.category,
          price: item.price,
          stock: item.stock,
          status: item.status,
          specs: item.specs,
          harga_modal: item.harga_modal ?? null,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'sku' }
      );
    if (error) throw error;
  },
```

The result should be:
```typescript
export const stockService = {
  async updateHargaModal(...) { ... },
  async decrementStock(...) { ... },
  async fetchAll(): Promise<SupabaseStockItem[]> { ... },
  async bulkUpsert(items: SupabaseStockItem[]): Promise<void> {
    // new method above
  },
};
```

- [ ] **Step 2: Build to verify no TypeScript errors**

```bash
npm run build
```

Expected: `✓ built in X.XXs` with no errors (chunk size warning is fine).

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "feat(stock): add stockService.bulkUpsert for CSV import"
```

---

### Task 2: Update StockManagerScreen — template, export, import logic, UI

**Files:**
- Modify: `src/components/StockManagerScreen.tsx`

Context on the file:
- Line 93: `CSV_HEADER` constant — needs `sku` and `nama` prepended
- Lines 248–265: `handleDownloadTemplate` — needs updated sample rows
- Lines 268–291: `parseAndUploadCSV` — full rewrite with upsert logic
- Lines 294–321: `handleFileUpload` — call site, needs to handle async `parseAndUploadCSV`
- Lines 393–416: UI grid with download and upload sections — add Export Stok button
- Imports at top: add `stockService` to the import from `supabaseClient`

- [ ] **Step 1: Update imports**

Find the existing import line (around line 12):
```typescript
import { isSupabaseConfigured } from '../lib/supabaseClient';
```

Replace with:
```typescript
import { isSupabaseConfigured, stockService } from '../lib/supabaseClient';
import type { SupabaseStockItem } from '../lib/supabaseClient';
```

- [ ] **Step 2: Update `CSV_HEADER` constant (line 93)**

Find:
```typescript
const CSV_HEADER = ['kategori', 'harga', 'harga_modal', 'stok', ...CSV_SPEC_COLS].join(',');
```

Replace with:
```typescript
const CSV_HEADER = ['sku', 'nama', 'kategori', 'harga', 'harga_modal', 'stok', ...CSV_SPEC_COLS].join(',');
```

- [ ] **Step 3: Update `handleDownloadTemplate` sample rows**

Find the `rows` array inside `handleDownloadTemplate`:
```typescript
    const rows = [
      CSV_HEADER,
      'Panel,850000,,24,Besi,Indoor,60,40,20,1.5,RAL7032,Kosong,,,,,,,',
      'MCB,45000,,200,,,,,,,,,Schneider,16,1P,,,,',
      'Kabel,380000,,50,,,,,,,,,,,,NYM,2.5,100m/Rol,',
      'Aksesori,25000,,10,,,,,,,,,,,,,,,Klem Kabel 16mm',
    ];
```

Replace with (two empty leading columns for `sku` and `nama`):
```typescript
    const rows = [
      CSV_HEADER,
      ',,Panel,850000,,24,Besi,Indoor,60,40,20,1.5,RAL7032,Kosong,,,,,,,',
      ',,MCB,45000,,200,,,,,,,,,,Schneider,16,1P,,,',
      ',,Kabel,380000,,50,,,,,,,,,,,,NYM,2.5,100m/Rol,',
      ',,Aksesori,25000,,10,,,,,,,,,,,,,,,Klem Kabel 16mm',
    ];
```

- [ ] **Step 4: Add `handleExportStock` function**

Add this function directly after the closing brace of `handleDownloadTemplate`:

```typescript
  const handleExportStock = () => {
    if (stockList.length === 0) {
      showToast('Belum ada produk untuk diekspor.', 'warning');
      return;
    }
    const rows = [
      CSV_HEADER,
      ...stockList.map(item => {
        const specVals = CSV_SPEC_COLS.map(col => item.specs?.[col] ?? '');
        return [
          item.sku,
          item.name,
          item.category,
          item.price,
          item.harga_modal ?? '',
          item.stock,
          ...specVals,
        ].join(',');
      }),
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Stok_Sinar_Elektrik.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('📤 Data stok berhasil diekspor.');
  };
```

- [ ] **Step 5: Replace `parseAndUploadCSV` with upsert logic**

Find and replace the entire `parseAndUploadCSV` function (lines 268–291):

```typescript
  const parseAndUploadCSV = async (text: string) => {
    const lines = text.trim().split('\n');
    const header = lines[0].split(',').map(h => h.trim());
    const updatedStock = [...stockList];
    let addCount = 0;
    let updateCount = 0;
    const changedItems: SupabaseStockItem[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      const row: Record<string, string> = {};
      header.forEach((h, idx) => { row[h] = cols[idx] || ''; });

      const skuFromCsv = row['sku']?.trim() ?? '';
      const namaFromCsv = row['nama']?.trim() ?? '';
      const category = row['kategori'] || 'Aksesori';
      const price = parseInt(row['harga']) || 0;
      const harga_modal = row['harga_modal'] ? parseFloat(row['harga_modal']) : null;
      const stock = parseInt(row['stok']) || 0;
      const specs: Record<string, string> = {};
      CSV_SPEC_COLS.forEach(col => {
        if (row[col] && row[col] !== '—' && row[col] !== '-') specs[col] = row[col];
      });

      // Level 1: match by SKU
      let existingIdx = skuFromCsv
        ? updatedStock.findIndex(s => s.sku === skuFromCsv)
        : -1;

      // Level 2: fallback match by name (case-insensitive)
      if (existingIdx === -1 && namaFromCsv) {
        existingIdx = updatedStock.findIndex(
          s => s.name.toLowerCase() === namaFromCsv.toLowerCase()
        );
      }

      if (existingIdx >= 0) {
        const existing = updatedStock[existingIdx];
        const updatedItem = {
          ...existing,
          price: row['harga'] ? price : existing.price,
          stock: row['stok'] ? stock : existing.stock,
          harga_modal: row['harga_modal'] ? harga_modal : existing.harga_modal,
          name: namaFromCsv || existing.name,
          status: ((row['stok'] ? stock : existing.stock) < 10 ? 'Stok Tipis' : 'Sinkron') as 'Stok Tipis' | 'Sinkron',
        };
        updatedStock[existingIdx] = updatedItem;
        changedItems.push(updatedItem as SupabaseStockItem);
        updateCount++;
      } else {
        const sku = skuFromCsv || generateSkuId();
        const name = namaFromCsv || generateName(category, specs);
        const newItem = {
          sku, name, category, price, harga_modal, stock,
          status: (stock < 10 ? 'Stok Tipis' : 'Sinkron') as 'Stok Tipis' | 'Sinkron',
          specs,
        };
        updatedStock.push(newItem);
        changedItems.push(newItem as SupabaseStockItem);
        addCount++;
      }
    }

    onStockUpdate(updatedStock);
    showToast(`✅ ${addCount} produk ditambah, ${updateCount} produk diperbarui.`);

    if (isSupabaseConfigured && changedItems.length > 0) {
      try {
        await stockService.bulkUpsert(changedItems);
      } catch {
        showToast('Data diimport tapi gagal disimpan ke server. Coba refresh.', 'warning');
      }
    }
  };
```

- [ ] **Step 6: Update `handleFileUpload` call site to handle async**

Find inside `handleFileUpload` the call to `parseAndUploadCSV`:
```typescript
          parseAndUploadCSV(text);
```

Replace with:
```typescript
          void parseAndUploadCSV(text);
```

(`void` suppresses the floating promise lint warning — the async errors are handled inside `parseAndUploadCSV` itself.)

- [ ] **Step 7: Update UI — rename button label and add Export Stok**

Find the entire download template `div` (the blue card with `handleDownloadTemplate`):
```tsx
          <div
            onClick={handleDownloadTemplate}
            className="bg-[#eff4ff] rounded-3xl p-8 border border-transparent hover:border-[#1e3d60]/20 hover:bg-blue-100/40 transition-all cursor-pointer group flex flex-col items-center justify-center text-center select-none"
          >
            <div className="w-16 h-16 rounded-full bg-[#1e3d60] text-white flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform duration-300">
              <Download className="w-6 h-6" />
            </div>
            <h4 className="font-extrabold text-[#012749] text-xs uppercase tracking-wider">UNDUH TEMPLATE EXCEL (*.CSV)</h4>
            <p className="text-[11px] text-[#43474e] mt-1.5 font-medium">Kolom spek Panel, MCB, Kabel &amp; Aksesori. SKU &amp; nama auto.</p>
          </div>
```

Replace with two cards, and change the outer grid from `md:grid-cols-2` to `md:grid-cols-3`:

First, find the outer grid div:
```tsx
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
```
Replace with:
```tsx
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
```

Then replace the single download div with two divs (Download Template + Export Stok):
```tsx
          <div
            onClick={handleDownloadTemplate}
            className="bg-[#eff4ff] rounded-3xl p-8 border border-transparent hover:border-[#1e3d60]/20 hover:bg-blue-100/40 transition-all cursor-pointer group flex flex-col items-center justify-center text-center select-none"
          >
            <div className="w-16 h-16 rounded-full bg-[#1e3d60] text-white flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform duration-300">
              <Download className="w-6 h-6" />
            </div>
            <h4 className="font-extrabold text-[#012749] text-xs uppercase tracking-wider">DOWNLOAD TEMPLATE</h4>
            <p className="text-[11px] text-[#43474e] mt-1.5 font-medium">Template kosong untuk input produk baru. SKU &amp; nama auto.</p>
          </div>

          <div
            onClick={handleExportStock}
            className="bg-violet-50 rounded-3xl p-8 border border-transparent hover:border-violet-300 hover:bg-violet-100/40 transition-all cursor-pointer group flex flex-col items-center justify-center text-center select-none"
          >
            <div className="w-16 h-16 rounded-full bg-violet-700 text-white flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform duration-300">
              <Download className="w-6 h-6" />
            </div>
            <h4 className="font-extrabold text-[#012749] text-xs uppercase tracking-wider">EXPORT STOK</h4>
            <p className="text-[11px] text-[#43474e] mt-1.5 font-medium">Export semua produk aktif dengan SKU. Edit lalu re-import untuk update.</p>
          </div>
```

- [ ] **Step 8: Build to verify no TypeScript errors**

```bash
npm run build
```

Expected: `✓ built in X.XXs` — no errors.

- [ ] **Step 9: Manual test checklist**

1. Click **Download Template** → file `Template_Stok_Sinar_Elektrik.csv` downloads. Open in Excel/Sheets — confirm columns: `sku, nama, kategori, harga, harga_modal, stok, material, ...`. First two columns empty in sample rows. ✓
2. Click **Export Stok** → file `Stok_Sinar_Elektrik.csv` downloads. Open — confirm all existing products listed with their SKU and name pre-filled. ✓
3. Edit one row in the exported CSV (change `harga` value), re-import → toast shows "0 produk ditambah, 1 produk diperbarui." Stock list shows updated price. ✓
4. Add a new row to the exported CSV (empty `sku`), re-import → toast shows "1 produk ditambah, X produk diperbarui." New product appears in list. ✓
5. Add a row with an existing product's `nama` but no `sku`, re-import → matches by name, updates that product. ✓

- [ ] **Step 10: Commit**

```bash
git add src/components/StockManagerScreen.tsx
git commit -m "feat(stock): CSV upsert — add/update by SKU or name, Export Stok button, Supabase persist"
```

- [ ] **Step 11: Push to deploy**

```bash
git push origin main
```
