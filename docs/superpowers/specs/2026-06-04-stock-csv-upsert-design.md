# Stock CSV Import — Add + Update Design

**Date:** 2026-06-04
**Status:** Approved for implementation

---

## Problem

Template CSV di StockManagerScreen hanya bisa menambah produk baru. Tidak ada cara untuk bulk-update harga atau stok produk yang sudah ada via CSV.

---

## Goal

- Template punya kolom `sku` dan `nama`
- Tombol "Download Template" tetap ada untuk input produk baru (sku & nama kosong)
- Tambah tombol "Export Stok" untuk export produk aktif (sku + nama pre-filled) — berguna saat produk sudah banyak
- Import logic: upsert by SKU → fallback upsert by nama → tambah baru
- Import langsung persist ke Supabase (bukan hanya update state lokal)

---

## Files Changed

| File | Change |
|---|---|
| `src/components/StockManagerScreen.tsx` | Template columns, Export Stok button, import upsert logic |
| `src/lib/supabaseClient.ts` | Tambah `stockService.bulkUpsert(items[])` |

---

## Template Columns

```
sku, nama, kategori, harga, harga_modal, stok, material, tipe_pasang, tinggi_cm, lebar_cm, tebal_cm, ketebalan_mm, finishing, kelengkapan, mcb_merek, mcb_ampere, mcb_phase, kabel_tipe, kabel_mm2, kabel_panjang, deskripsi
```

- `sku` — kosong untuk produk baru, diisi untuk update produk existing
- `nama` — jika diisi dan cocok nama existing → update; jika baru → dipakai sebagai nama produk; jika kosong → auto-generate dari kategori + specs

---

## Download Template (blank)

Baris contoh: kolom `sku` dan `nama` kosong.

```
,,Panel,850000,,24,Besi,Indoor,60,40,20,1.5,RAL7032,Kosong,,,,,,,
,,MCB,45000,,200,,,,,,,,,,Schneider,16,1P,,,
,,Kabel,380000,,50,,,,,,,,,,,,NYM,2.5,100m/Rol,
,,Aksesori,25000,,10,,,,,,,,,,,,,,,Klem Kabel 16mm
```

---

## Export Stok (current data)

Export semua item dari `stockList` dengan kolom `sku` dan `nama` pre-filled. User edit di Excel (ubah harga/stok/harga_modal), bisa tambah baris baru di bawah, lalu re-import.

---

## Import Logic (upsert — 3 level matching)

```
for each row in CSV (skip header):
  skuFromCsv = row['sku'].trim()
  namaFromCsv = row['nama'].trim()

  // Level 1: match by SKU
  existingIdx = stockList.findIndex(s => s.sku === skuFromCsv)  // skuFromCsv non-empty

  // Level 2: fallback match by nama (case-insensitive)
  if existingIdx === -1 and namaFromCsv non-empty:
    existingIdx = stockList.findIndex(s => s.name.toLowerCase() === namaFromCsv.toLowerCase())

  if existingIdx >= 0:
    UPDATE existing item: price, harga_modal, stock, name (only if non-empty in CSV row)
    status = stock < 10 ? 'Stok Tipis' : 'Sinkron'
    updateCount++
  else:
    ADD new item
    sku = skuFromCsv if non-empty, else generateSkuId()
    name = namaFromCsv if non-empty, else generateName(kategori, specs)
    addCount++

onStockUpdate(updatedList)
await stockService.bulkUpsert(allChangedItems)
toast: "X produk ditambah, Y produk diperbarui."
```

**Partial update rule:** Field yang kosong di CSV tidak menimpa nilai existing. Contoh: kolom `harga_modal` kosong → nilai lama tetap dipertahankan.

---

## `stockService.bulkUpsert` (supabaseClient.ts)

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
}
```

---

## UI Changes

- Rename existing download button menjadi **"Download Template"**
- Tambah tombol **"Export Stok"** di sebelah "Download Template"
- Kedua tombol di atas drop zone import yang sama

---

## Error Handling

- Jika `bulkUpsert` gagal: state lokal tetap terupdate (`onStockUpdate` sudah dipanggil), tampilkan toast warning "Data berhasil diimport tapi gagal disimpan ke server. Coba refresh."
- Baris CSV yang tidak punya kolom `kategori` valid → skip baris tersebut, lanjut ke baris berikutnya

---

## Out of Scope

- Delete produk via CSV
- Backdate `created_at` saat import
