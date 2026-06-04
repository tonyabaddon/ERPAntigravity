# Kasir & Rekonsiliasi Harian — Design Spec

**Date:** 2026-06-04
**Status:** Approved for implementation

---

## Problem

Sinar Elektrik memiliki 4 saluran penjualan (WA orders, walk-in, Tokopedia, grosir) dan pengeluaran operasional harian, tetapi tidak ada satu tempat untuk melihat P&L hari itu. Owner tidak tahu keuntungan sesungguhnya karena tidak ada HPP yang dilacak. Admin perlu cara untuk mencatat walk-in sales dengan invoice yang bisa dicetak.

---

## Goal

Bangun layar **Kasir** baru yang menjadi pusat rekonsiliasi harian:
- Admin/staff mencatat semua transaksi penjualan (walk-in, Tokopedia, grosir) dan pengeluaran
- WA orders auto-sync dari sistem yang sudah ada
- Owner melihat P&L sesungguhnya: Penjualan − HPP − Biaya Operasional = Laba Bersih
- Walk-in dan grosir menghasilkan invoice A4 yang bisa dicetak
- Admin tidak bisa melihat HPP dan Laba Bersih — hanya Owner

---

## Decisions

- **`kasir_transactions` tabel baru** untuk walk-in, Tokopedia, grosir, dan pengeluaran. WA orders tidak diduplikasi — di-JOIN dari tabel `orders` yang ada (`status = 'PAYMENT_VERIFIED'`) saat menghitung P&L.
- **HPP di-snapshot saat transaksi** — bukan lookup dinamis. Jika `harga_modal` berubah besok, histori P&L kemarin tetap akurat.
- **`harga_modal` di StockManager** — properti item, diisi satu kali saat setup/terima barang, nullable. Item tanpa HPP tetap bisa dijual, tapi muncul warning di P&L owner.
- **InvoiceModal yang sudah ada diperluas** untuk handle `kasir_transactions`, tidak dibuat dari nol.
- **Role check** menggunakan `currentUser.role` yang sudah ada — cukup kondisional di React, tidak perlu endpoint terpisah.
- **Metode pembayaran** hanya untuk transaksi income (bukan expense): `cash | transfer | qris`.
- **Expense categories** sebagai enum teks: `Gaji`, `Utilitas`, `Transportasi`, `Pembelian Stok`, `Marketing`, `Lain-lain`.
- **Periode historis** — owner bisa navigasi per hari dengan date picker, default hari ini.

---

## P&L Formula

```
Pendapatan     = Σ semua transaksi income (WA + walk-in + Tokopedia + grosir)
HPP            = Σ (qty × hpp_per_unit yang di-snapshot) dari semua item terjual
Laba Kotor     = Pendapatan − HPP
Biaya Ops      = Σ semua expense transactions
Laba Bersih    = Laba Kotor − Biaya Ops
```

WA orders HPP dihitung dengan JOIN `orders.items[].sku` ke `stocks.harga_modal` (bukan snapshot — tradeoff diterima untuk simplicity karena harga modal jarang berubah drastis).

---

## Role Access

| Tampilan | Admin/Staff | Owner |
|---|---|---|
| Log transaksi lengkap | ✅ | ✅ |
| Total Pemasukan | ✅ | ✅ |
| Total Pengeluaran | ✅ | ✅ |
| Tombol entry transaksi | ✅ | ✅ |
| HPP per transaksi | ❌ | ✅ |
| Kartu Laba Bersih | ❌ | ✅ |
| Closing summary (breakdown) | ❌ | ✅ |
| Navigasi periode historis | ❌ | ✅ |

Role check: `currentUser.role === 'owner'` atau `permissions.includes('view_profit')`.

---

## Section 1: Database Changes

### 1a. Migration: `harga_modal` di tabel stocks

**File:** `supabase/migrations/20260604000005_stocks_add_harga_modal.sql`

```sql
ALTER TABLE public.stocks
  ADD COLUMN IF NOT EXISTS harga_modal NUMERIC(15,2);
```

Nullable — item lama tidak error. Warning di UI jika null saat digunakan di P&L.

### 1b. Migration: `kasir_transactions` tabel baru

**File:** `supabase/migrations/20260604000006_kasir_transactions.sql`

```sql
CREATE TYPE kasir_channel AS ENUM ('walkin', 'tokopedia', 'grosir');
CREATE TYPE kasir_payment_method AS ENUM ('cash', 'transfer', 'qris');
CREATE TYPE kasir_expense_category AS ENUM (
  'Gaji', 'Utilitas', 'Transportasi', 'Pembelian Stok', 'Marketing', 'Lain-lain'
);

CREATE TABLE IF NOT EXISTS public.kasir_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date             DATE NOT NULL DEFAULT CURRENT_DATE,
  type             TEXT NOT NULL CHECK (type IN ('income', 'expense')),

  -- Income fields
  channel          kasir_channel,
  items            JSONB NOT NULL DEFAULT '[]',
  -- items structure: [{sku, name, qty, unit_price, hpp_per_unit, subtotal, hpp_subtotal}]
  subtotal         NUMERIC(15,2) NOT NULL DEFAULT 0,
  hpp_total        NUMERIC(15,2) NOT NULL DEFAULT 0,
  payment_method   kasir_payment_method,
  customer_name    TEXT,
  invoice_number   TEXT,

  -- Expense fields
  expense_category kasir_expense_category,
  description      TEXT,

  created_by       UUID,  -- references admin_users.id
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kasir_date ON kasir_transactions(date);
CREATE INDEX idx_kasir_type ON kasir_transactions(type, date);

ALTER TABLE public.kasir_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all_kasir" ON kasir_transactions
  FOR ALL TO anon USING (true) WITH CHECK (true);
```

### 1c. Invoice number sequence (per channel)

Invoice numbers auto-generated at insert:
- Walk-in: `WLK-YYYYMMDD-NNN`
- Tokopedia: `TPD-YYYYMMDD-NNN`
- Grosir: `GRS-YYYYMMDD-NNN`

Generated client-side saat menyimpan, format: channel prefix + tanggal + 3-digit counter dari count hari itu.

---

## Section 2: StockManager Changes

### 2a. Migration sudah di atas (harga_modal column)

### 2b. UI changes di `StockManagerScreen.tsx`

- Tambah kolom `Harga Modal` di tabel stock list (setelah kolom `Harga Jual`)
- Tampilkan sebagai `Rp X.XXX` jika diisi, `—` jika null dengan tooltip "Belum diisi — P&L tidak akurat"
- Tambah field `Harga Modal` di form edit item (inline edit yang sudah ada)
- Tambah kolom `harga_modal` di CSV template download
- Handle `harga_modal` saat CSV import (parse numeric, skip jika kosong)

### 2c. `supabaseClient.ts` — stockService extension

Tambah ke `stockService`:
```typescript
updateHargaModal(sku: string, hargaModal: number): Promise<void>
decrementStock(sku: string, qty: number): Promise<void>  // baru, dipakai saat kasir simpan penjualan
```

---

## Section 3: Kasir Screen (New)

### 3a. Route & Navigation

- Tambah `'kasir'` ke `ActivePage` type di `src/types.ts`
- Tambah nav item di `Sidebar.tsx`: ikon `Receipt`, label "Kasir", description "Rekonsiliasi Harian"
- Posisi: setelah "Stok", sebelum "Pelanggan"
- Buat file `src/components/KasirScreen.tsx`

### 3b. KasirScreen layout

```
┌─ Page Header (glassmorphism) ───────────────────────────────────┐
│  "Kasir Harian" · tanggal · [date picker — owner only]          │
│  [Cetak Laporan — owner only]  [+ Catat Penjualan]              │
└─────────────────────────────────────────────────────────────────┘

┌─ KPI Strip ──────────────────────────────────────────────────────┐
│ Admin: [Total Pemasukan] [Total Pengeluaran] [Item Terjual]      │
│ Owner: + [HPP] [Laba Bersih (navy card)]                         │
└─────────────────────────────────────────────────────────────────┘

┌─ Log Transaksi ──────────┐  ┌─ Catat Transaksi ───────────────┐
│ Filter tabs:             │  │ Auto-sync badge (WA)             │
│  Semua|Walk-in|WA|       │  │ [Walk-in] [Tokopedia]           │
│  Online|Pengeluaran      │  │ [Grosir]  [Pengeluaran]         │
│                          │  │                                   │
│ Transaction rows:        │  ├─ Closing Summary (owner only) ──┤
│  channel pill + name     │  │ Breakdown formula               │
│  + amount (+ hpp owner)  │  │ Penjualan − HPP − Ops           │
│                          │  │ = Laba Bersih                   │
│                          │  │ [Cetak Laporan Harian]          │
└──────────────────────────┘  └─────────────────────────────────┘
```

### 3c. Transaction entry modals

**Modal: Catat Penjualan (Walk-in / Tokopedia / Grosir)**

1. Pilih channel (jika dibuka dari tombol utama; skip jika dari channel button langsung)
2. Nama customer (optional untuk Tokopedia, wajib untuk Grosir)
3. Item picker: search/autocomplete dari stok → pilih qty → tampilkan `unit_price` (dari stocks.price) dan `hpp_per_unit` (dari stocks.harga_modal, owner only)
4. Tambah/hapus item rows
5. Pilih metode pembayaran: Cash / Transfer / QRIS
6. Summary total di bawah
7. [Simpan & Cetak Invoice] / [Simpan Saja]

Saat simpan:
- Insert ke `kasir_transactions` dengan items + hpp snapshot
- Kurangi `stocks.stock` untuk setiap item (`stockService.decrementStock`)
- Jika cetak: buka `KasirInvoiceModal`

**Modal: Catat Pengeluaran**

1. Kategori (dropdown enum)
2. Deskripsi (free text)
3. Jumlah (Rp)
4. [Simpan]

### 3d. Data fetching — `kasirService` di `supabaseClient.ts`

```typescript
kasirService.fetchTransactions(date: string): Promise<KasirTransaction[]>
kasirService.fetchDailySummary(date: string): Promise<DailySummary>
// DailySummary: { totalIncome, totalExpense, totalHpp, labaBersih, itemsSold, byChannel }

kasirService.insertSaleTransaction(tx: NewSaleTransaction): Promise<KasirTransaction>
kasirService.insertExpense(tx: NewExpense): Promise<KasirTransaction>
kasirService.fetchWaOrdersForDate(date: string): Promise<DbOrder[]>
// Fetches orders WHERE status='PAYMENT_VERIFIED' AND updated_at::date = date
// Used for auto-sync display in log
```

### 3e. HPP untuk WA Orders

Computed di client saat render owner view:
```typescript
order.items.map(item => item.qty * (stockMap[item.sku]?.harga_modal ?? 0))
```

`stockMap` di-fetch sekali saat component mount. WA order HPP tidak di-snapshot karena data sudah ada di stocks. Warning "HPP tidak tersedia" jika `harga_modal` null.

---

## Section 4: Invoice untuk Kasir Transactions

### 4a. `KasirInvoiceModal.tsx` (baru, extend pola InvoiceModal)

Sama persis dengan `InvoiceModal.tsx` yang ada untuk WA orders, tapi menerima `KasirTransaction` bukan `DbOrder`. Reuse:
- Company header dari `companySettingsService`
- Print logic (`window.print()` + `@media print`)
- Style dan layout invoice

Perbedaan dari InvoiceModal WA order:
- Nomor invoice: format `WLK-YYYYMMDD-NNN` (bukan `GJP-XXXX`)
- Tidak ada kolom `Ongkos Kirim`
- Tambah baris `Metode Pembayaran` di footer
- Untuk Grosir: tambah nama perusahaan customer

### 4b. Print flow

- Walk-in: modal konfirmasi setelah simpan → "Cetak invoice sekarang?" → buka `KasirInvoiceModal`
- Grosir: sama seperti walk-in
- Dari log transaksi: tombol print di setiap row (ikon printer kecil)

---

## Section 5: Laporan Historis (Owner)

Date picker di page header (owner only, default today):
- Pakai `<input type="date">` styled sesuai design system
- Mengubah `selectedDate` state → re-fetch semua data untuk tanggal tersebut
- Tampilan identik untuk hari lain, hanya data berbeda

Tidak ada chart/trend di Kasir screen — itu tetap di LaporanScreen yang sudah ada.

---

## Files Changed

### New files

| File | Responsibility |
|---|---|
| `supabase/migrations/20260604000005_stocks_add_harga_modal.sql` | Kolom harga_modal di stocks |
| `supabase/migrations/20260604000006_kasir_transactions.sql` | Tabel kasir_transactions + enums |
| `src/components/KasirScreen.tsx` | Layar kasir utama |
| `src/components/KasirInvoiceModal.tsx` | Invoice print untuk kasir transactions |

### Modified files

| File | Change |
|---|---|
| `src/types.ts` | Tambah `'kasir'` ke ActivePage, tambah `KasirTransaction`, `DailySummary` types |
| `src/App.tsx` | Render `KasirScreen` untuk route `'kasir'` |
| `src/components/Sidebar.tsx` | Tambah nav item Kasir |
| `src/components/StockManagerScreen.tsx` | Kolom + form field `harga_modal` |
| `src/lib/supabaseClient.ts` | Tambah `kasirService`, extend `stockService` |

**Not changing:** backend-go, WhatsApp handler, LaporanScreen, OrderHistoryScreen, PipelineScreen, auth.

---

## Error Handling

- **Item stok habis saat entry walk-in**: warning tapi tetap boleh simpan (admin yang memutuskan)
- **HPP null**: transaksi tetap tersimpan, P&L owner menampilkan warning "⚠️ X item tanpa harga modal"
- **Supabase offline**: kasirService mengembalikan error, screen menampilkan toast warning, tidak crash
- **Cetak invoice gagal**: `window.print()` tidak punya callback error — tampilkan modal print preview saja

---

## Out of Scope (v1)

- Return/retur barang
- Tokopedia settlement tracking (pending vs received)
- Kas awal / opening balance
- Backdate transactions lebih dari 30 hari
- Multi-currency
- Laporan trend P&L bulanan di Kasir screen (pakai LaporanScreen)
