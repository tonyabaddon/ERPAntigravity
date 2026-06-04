# Stock CSV Import — Add + Update Design

**Date:** 2026-06-04
**Status:** Approved for implementation

---

## Problem

Template CSV di StockManagerScreen hanya bisa menambah produk baru. Tidak ada cara untuk bulk-update harga atau stok produk yang sudah ada via CSV.

---

## Goal

- Template punya kolom `sku` dan `nama`
- Tombol "Download Template" tetap ada untuk input produk baru (sku kosong)
- Tambah tombol "Export Stok" untuk export produk aktif (sku pre-filled) — berguna saat produk sudah banyak
- Import logic berubah menjadi upsert: baris dengan sku yang match → update; sku kosong → tambah baru

---

## File Changed

- `src/components/StockManagerScreen.tsx` only

---

## Template Columns

```
sku, nama, kategori, harga, harga_modal, stok, material, tipe_pasang, tinggi_cm, lebar_cm, tebal_cm, ketebalan_mm, finishing, kelengkapan, mcb_merek, mcb_ampere, mcb_phase, kabel_tipe, kabel_mm2, kabel_panjang, deskripsi
```

- `sku` — kosong untuk produk baru, diisi untuk update produk existing
- `nama` — opsional; jika kosong saat tambah baru, nama di-generate dari kategori + specs

---

## Download Template (blank)

Baris contoh: kolom `sku` kosong, `nama` kosong (auto-generated saat import).

```
,, Panel, 850000, , 24, Besi, Indoor, 60, 40, 20, 1.5, RAL7032, Kosong, , , , , , ,
,, MCB, 45000, , 200, , , , , , , , , Schneider, 16, 1P, , , ,
,, Kabel, 380000, , 50, , , , , , , , , , , , NYM, 2.5, 100m/Rol,
,, Aksesori, 25000, , 10, , , , , , , , , , , , , , , Klem Kabel 16mm
```

---

## Export Stok (current data)

Export semua item dari `stockList` dengan kolom `sku` dan `nama` pre-filled. User edit di Excel, re-import.

---

## Import Logic (upsert)

```
for each row in CSV (skip header):
  skuFromCsv = row['sku'].trim()
  existingIdx = stockList.findIndex(s => s.sku === skuFromCsv)  // -1 if empty or not found

  if existingIdx >= 0:
    UPDATE: price, harga_modal, stock, nama (only if non-empty in CSV)
    status = stock < 10 ? 'Stok Tipis' : 'Sinkron'
    updateCount++
  else:
    ADD new item
    sku = skuFromCsv if non-empty, else generateSkuId()
    nama = row['nama'] if non-empty, else generateName(kategori, specs)
    addCount++

toast: "X produk ditambah, Y produk diperbarui."
```

**Partial update rule:** Untuk baris update, field yang kosong di CSV tidak menimpa nilai existing. Contoh: kalau kolom `harga_modal` dikosongkan, nilai lama tetap dipertahankan.

---

## UI Changes

- Rename existing download button label menjadi **"Download Template"** (sudah ada, label mungkin berbeda)
- Tambah tombol **"Export Stok"** di sebelah tombol Download Template
- Kedua tombol menggunakan drop zone import yang sama

---

## Out of Scope

- Delete produk via CSV
- Import ke Supabase langsung (saat ini import hanya update state lokal via `onStockUpdate`)
- Validasi duplikat nama produk
