# Sidebar Categorization & Compact — Design

**Date:** 2026-06-13
**Status:** Approved (preview di `tmp/sidebar-preview.html`)
**Owner:** Tony Wei

## Goal

Sidebar saat ini menampung **18 menu flat** dengan label + deskripsi 2 baris (~56px per item). Tingginya ~1136px — meluap dari viewport laptop standar dan membebani scanability. Tujuan: kelompokkan menu ke kategori semantik dan ringkaskan tiap baris, **tanpa menghapus fitur**.

## Non-Goals

- Tidak mengubah pola interaksi (tetap hover-expand).
- Tidak menerapkan accordion (collapsible categories) — menambah friction "kemana menuku?" untuk staff non-tech.
- Tidak menyentuh permission filtering (`isPermVisible` di `Sidebar.tsx:84`).
- Tidak mengubah brand header, footer profile, atau Keluar Sistem.

## Outcome

- 18 menu &rarr; **14 menu** (4 layar di-merge sebagai tab di screen induk)
- Tinggi sidebar saat expanded: ~1136px &rarr; **~900px** (&minus;21%)
- Tinggi tiap baris (expanded): 56px &rarr; **40px** (deskripsi dihilangkan, padding lebih rapat)
- Tinggi sidebar saat collapsed: turun proporsional karena 4 item lebih sedikit (ikon-only mode)

## Structure

### 4 Kategori (urutan dari atas ke bawah)

#### 1. Operasional (6 menu)
Aktivitas harian — dipakai kasir, sales, owner setiap hari.
- `dashboard` — Dashboard *(no rename)*
- `sales-inbox` — Sales Inbox *(no rename)*
- `penjualan` — **Penjualan** *(rename dari "Catat Penjualan")*
- `kasir` — Kasir *(no rename, no merge)*
- `pelanggan` — Pelanggan *(no rename)*
- `pipeline` — Pipeline *(no rename)*

#### 2. Inventory (3 menu)
Stok, opname, dan procurement.
- `ai-stock` — **Stok** *(rename dari "AI Stock Manager")*
- `stok-opname` — Stok Opname *(no rename)*
- `pembelian` — Pembelian *(no rename)*

#### 3. Kontrol & Laporan (3 menu)
Aktivitas managerial: approval, closing, insight.
- `persetujuan` — Persetujuan *(no rename, badge dipertahankan)*
- `rekonsiliasi` — **Rekonsiliasi & Tutup Buku** *(rename dari "Rekonsiliasi")*
- `laporan` — Laporan *(no rename)*

#### 4. Sistem (2 menu)
Konfigurasi & akses.
- `user-management` — User Management *(no rename)*
- `settings` — **Pengaturan** *(no rename, sekarang jadi hub 3 tab)*

### Menu yang Di-merge sebagai Tab (4 layar)

| Screen induk | Tab baru | Pindah dari | Alasan |
|---|---|---|---|
| **Penjualan** | "Riwayat" | `order-history` (Riwayat Pesanan) | Riwayat order adalah konteks penjualan |
| **Penjualan** | "WIP Rakit" | `wip-list` (WIP Rakit) | WIP rakit adalah bagian dari proses penjualan (bukan stok) |
| **Pengaturan** | "Notifikasi" | `notifications` (Notification Settings) | Sub-config dari sistem |
| **Pengaturan** | "WhatsApp AI" | `whatsapp-ai` (WhatsApp AI) | Sub-config dari sistem |

**Tetap berdiri sendiri (tidak digabung):**
- Kasir (rekonsiliasi harian shift) — beda persona & beda waktu dari Tutup Buku
- Stok (was: AI Stock Manager) — tidak punya sub-konteks
- Rekonsiliasi & Tutup Buku — managerial flow tersendiri

## Visual Design

### Section Header
- Markup: `<div class="px-4 pt-3 pb-1.5"><p class="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400/70">{Label}</p></div>`
- Selaras dengan tagline "MSME ERP Suite" di brand header
- Group pertama pakai `pt-1` (tanpa extra spacing di atas), group lain pakai `pt-3`

### Compact Menu Item
- Sebelum: `py-3 px-4` + label `text-sm` + description `text-[10px]` (2 baris)
- Sesudah: `py-2.5 px-4` + label `text-sm` saja (1 baris)
- Gap antar item: `space-y-0.5` (was `space-y-1.5`)
- **`text-left` ditambahkan** ke class button (default `<button>` adalah `text-align: center` — bug yang ditemukan saat review)

### Collapsed State (w-20)
- Section header dihilangkan
- Group dipisahkan divider tipis: `<div class="py-1.5 px-3"><div class="h-px bg-white/10"></div></div>`
- Tooltip via `title` attribute (no new component)

### Badge Persetujuan
- Dipertahankan tanpa perubahan (`PendingApprovalBadge`)
- Posisi sama: expanded → di kanan label; collapsed → di kanan-atas icon

## Implementation Surface

### Yang berubah di `Sidebar.tsx`
1. Tambah `category: 'operasional' | 'inventory' | 'kontrol' | 'sistem'` ke type `MenuItem`
2. Tag tiap entry dengan `category`
3. Tambah const `CATEGORY_LABELS: Record<Category, string>`
4. Render: group `visibleItems` by `category`, untuk tiap group tampilkan header (saat expanded) atau divider (saat collapsed) + items
5. Rename label: "Catat Penjualan" → "Penjualan"; "AI Stock Manager" → "Stok"; "Rekonsiliasi" → "Rekonsiliasi & Tutup Buku"
6. Hapus 4 entries: `order-history`, `wip-list`, `notifications`, `whatsapp-ai`
7. Tambah `text-left` ke className button
8. Hapus `<span>` description (the second line) dari tombol

### Yang berubah di screen induk (consolidation refactor)

Pendekatan: bungkus screen yang di-merge ke dalam wrapper baru, **tanpa mengubah file existing**. Ini menjaga existing tests/imports tetap valid dan memudahkan rollback per-screen.

1. **Penjualan wrapper baru** (`PenjualanScreen.tsx`): TabBar 3 tab — Input Baru / Riwayat / WIP Rakit. Tab content masing-masing me-render `PenjualanBaruScreen`, `OrderHistoryScreen`, `WipListScreen` apa adanya.
2. **Pengaturan wrapper update** (`PengaturanScreen.tsx`): tambah TabBar 3 tab — Umum / Notifikasi / WhatsApp AI. Tab Umum me-render konten existing; Notifikasi → `NotificationSettingsScreen`; WhatsApp AI → `WhatsappAiScreen`.
3. **Komponen `<TabBar>` baru** (`src/components/ui/TabBar.tsx`): reusable, mengikuti pola tab di mockup (border-bottom indicator emerald). Dipakai di kedua wrapper.

### Routing & ActivePage
- Type `ActivePage` di `types.ts`: hapus `'order-history' | 'wip-list' | 'notifications' | 'whatsapp-ai'` — atau **pertahankan** sebagai deep-link aliases yang map ke induk + tab tertentu (lebih aman untuk bookmark/external link existing)
- Deep-link strategy direkomendasikan: routing layer di `App.tsx` menerima legacy `ActivePage` dan men-set `activePage='penjualan'` + `initialTab='riwayat'` di prop screen

## Decision Log

| Decision | Alasan |
|---|---|
| Hover-expand dipertahankan, bukan accordion | User concern: staff non-tech susah dengan accordion ("kemana menuku?") |
| Deskripsi 2-baris dihapus, bukan dipertahankan | Length reduction terbesar (~14px × 14 item ≈ 196px). Owner sudah hafal nama menu. |
| WIP Rakit pindah ke Penjualan (bukan Stok) | User feedback: WIP Rakit adalah bagian proses penjualan, bukan stok |
| Rekonsiliasi tetap menu sendiri (bukan tab di Kasir) | User feedback: Rekonsiliasi bank berbeda flow dari shift kasir harian |
| Label "Rekonsiliasi & Tutup Buku" | Screen handle 2 hal: match bank/cash ke order + `closeMonth()`. User memilih label ini dari 3 kandidat. |
| Label "Stok" (was: AI Stock Manager) | User request: lebih ringkas |
| 4 kategori (bukan 3 atau 5) | 3 terlalu kasar; 5 menambah section header dan menambah panjang. 4 adalah sweet spot. |

## Open Questions

1. **Deep-link migration:** Apakah perlu redirect `?page=order-history` ke `?page=penjualan&tab=riwayat`? Atau cukup hapus legacy ActivePage values?
2. **Tab state persistence:** Saat user switch dari Penjualan ke layar lain lalu balik, balik ke tab terakhir atau reset ke "Input Baru"? Default: reset ke first tab (lebih sederhana).
3. **Permission per tab:** `order-history` permission key (`orderHistory`) berbeda dari `kasir`. Saat tab disembunyikan oleh permission, fall-through ke tab berikut yang visible?

## Out of Scope (future iteration)

- Pinned favorites / "starred menus"
- Search/filter di sidebar
- Mobile-responsive sidebar (current implementation desktop-only)
- Dark/light theme variant
