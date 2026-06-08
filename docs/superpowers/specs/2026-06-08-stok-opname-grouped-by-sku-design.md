# Stok Opname — Grouped Row by SKU (Atas + Bawah)

**Date:** 2026-06-08
**Status:** Approved for implementation
**File touched:** `src/components/stok/StockOpnameSessionView.tsx` (1 file)
**Backend / migration changes:** none

## Background

Layout sesi opname saat ini menampilkan 1 baris tabel per `(sku, warehouse)`. Karena setiap SKU punya 2 row gudang (Atas + Bawah), 1 SKU menempati 2 baris terpisah. Counter harus pindah-pindah baris untuk menyelesaikan 1 SKU, kurang efisien dan mudah salah sasar saat input cepat.

Schema database dan RPC sudah dirancang per-warehouse (`stock_opname_counts` PK = `(session_id, sku, warehouse)`, RPC `record_opname_count` per warehouse). Perubahan yang diminta murni layout/UX di komponen React.

## Goal

Satu SKU dirender sebagai satu **card** dengan header SKU + Nama, lalu dua sub-row sejajar (Atas, Bawah) yang masing-masing punya input "Hitung" sendiri. Counter bisa menyelesaikan 1 SKU (isi Atas → Bawah) tanpa pindah baris yang jauh.

## Non-Goals

- Tidak mengubah schema, RPC, atau client API (`recordOpnameCount`, `fetchOpnameCounts`).
- Tidak mengubah flow witness acknowledge, submit, atau status sesi.
- Tidak menambahkan validasi baru ("wajib isi keduanya", dll.) — partial fill tetap valid karena banyak SKU memang stoknya hanya di salah satu gudang.

## Design

### Layout

```
┌─ ABC-123 · Sabun Mandi 250ml ─────────────────────────┐
│ Atas    Sistem 20    Hitung [   20  ]    Var  0       │
│ Bawah   Sistem 25    Hitung [   24  ]    Var -Rp1.000 │
└────────────────────────────────────────────────────────┘
```

- Header card: SKU (font mono) + `·` separator + Nama Barang (`skuMeta[sku].name`).
- Dua sub-row, masing-masing menampilkan label gudang (Atas/Bawah), Sistem (qty snapshot), input Hitung, Varians (format Rupiah dengan sign).
- Border kiri card jadi `border-l-4 border-l-emerald-500` ketika kedua warehouse sudah punya `countedQty != null` — indikator visual "SKU selesai dihitung".

### Data Flow

- `useMemo` baru `groupedBySku`: reduce `filteredCounts` jadi `Map<string, { atas?: OpnameCount; bawah?: OpnameCount }>`. Iteration order mengikuti urutan asli `filteredCounts` (first-seen).
- Render: `Array.from(groupedBySku).map(([sku, group]) => <Card sku={sku} group={group} />)`.
- Per sub-row tetap pakai `key = \`${sku}-${warehouse}\`` untuk `draft[key]` dan `busy === key`.
- Tab order natural mengikuti urutan DOM: input Atas → input Bawah dalam card yang sama → input Atas card berikutnya.

### Save Behavior

- **Auto-save on blur per field** — sama dengan implementasi current. Tiap blur trigger `recordOpnameCount` untuk warehouse itu saja, lalu `refresh()`.
- Input sedang processing → `disabled` (state `busy === key`).
- Validasi angka: `parseInt`; kalau `NaN` → toast "Angka hitung tidak valid"; kalau sama dengan `countedQty` lama → skip RPC.
- Tidak ada validasi "isi keduanya" — partial fill diperbolehkan.

### Preserved Functionality (no change)

- Header sesi: status pill, info penghitung/saksi, total varians, counter `Diisi: X/Y` (X = jumlah `countedQty != null` per warehouse-row, Y = total warehouse-row = 2 × jumlah SKU).
- Filter input `Cari SKU atau nama barang` — logic filtering sama (di sku + skuMeta name), diaplikasikan **sebelum** grouping.
- Witness acknowledge button + flow.
- Submit ke Owner button + flow + validasi `filledCount > 0`.
- Status banner (pending_owner / committed / rejected).
- Loading + not-found state.
- Permission gate: `isEditable` → input disabled saat sesi tidak in-progress atau user bukan counter/witness.
- Empty state: "Sesi ini belum punya scope" / "Tidak ada SKU cocok dengan pencarian".

## Implementation Steps

1. Tambah `useMemo` `groupedBySku` setelah `filteredCounts`.
2. Hapus block grid header (12-column header row `<div className="grid grid-cols-12 ...">`).
3. Ganti `filteredCounts.map(c => <row>)` jadi rendering card per SKU.
4. Render setiap card sebagai `<div>` dengan border-left conditional + header + 2 sub-row.
5. Setiap sub-row reuse existing `draft[key]`, `onBlurCount(c)`, `busy === key`, `isEditable`.
6. Empty state untuk grouped layout: kalau `groupedBySku.size === 0` tampilkan pesan yang sudah ada.

## Testing

Manual test di browser dengan dev server:

- Buat sesi opname baru → cek tampil card per SKU (bukan 2 row terpisah).
- Isi input Atas → blur → save sukses, spinner saat busy, varians ter-update.
- Isi input Bawah → blur → save sukses, card border kiri jadi hijau.
- Partial fill (Atas only) → card tidak berubah border (stay netral).
- Filter cari SKU → card filtered correctly, masih menampilkan kedua sub-row.
- Status non-editable (sesi committed / bukan counter/witness) → input disabled.
- Witness ack + Submit flow → tidak terpengaruh, tetap berjalan.
- Sesi existing in-progress → reload → tampil layout baru, data utuh.

Tidak ada unit test eksisting untuk komponen ini di codebase; tidak ada test baru yang ditambahkan untuk perubahan layout.

## Risks

- **Visual regression saat reload sesi in-progress** — schema tetap, data utuh; resiko hanya visual layout shift yang sudah diharapkan.
- **Banyak SKU per sesi** — grouping O(n) tetap cepat untuk ratusan SKU; card lebih vertical-heavy dari flat table sehingga scroll lebih panjang, tapi grouping membuat scan per-SKU lebih cepat secara workflow.
