# Requirements — Improvement Cetak Sales Order / Quotation (Garindo Jaya Panel)

## 1. Tujuan
Meng-improve output cetak Sales Order/Quotation agar tampil profesional seperti contoh referensi (layout quotation standar industri panel listrik), dengan seluruh identitas perusahaan dan data customer terisi otomatis dari data sistem — bukan hardcoded.

## 2. Scope
Template cetak dokumen Sales Order/Quotation, output PDF ukuran A4 (portrait), print-ready, 1 halaman jika memungkinkan (multi-page jika item banyak, dengan header berulang dan nomor halaman).

## 3. Layout & Field Requirements

### 3.1 Header Perusahaan (kiri atas) — dinamis dari master data perusahaan
| Field | Keterangan |
|---|---|
| Logo | Logo Garindo Jaya Panel (upload/replace-able, bukan hardcoded di template) |
| Nama perusahaan | GJP / nama legal perusahaan, font besar & bold |
| Tagline | "Electrical Panel & Engineering" (editable) |
| Alamat | Alamat toko lengkap (LTC Glodok) |
| No. WhatsApp | Nomor WA aktif toko (dengan ikon), menggantikan nomor telepon lama |
| Email | Email aktif toko |

### 3.2 Blok Info Dokumen (kanan atas)
| Field | Keterangan |
|---|---|
| Judul dokumen | "QUOTATION" / "SALES ORDER" — banner dengan warna brand |
| No. | Auto-generate, format `QTN-YYMMDD-XXX` (running number per hari/bulan) |
| Date | Tanggal terbit, auto dari tanggal pembuatan |
| Valid Until | Auto-calculate: Date + masa berlaku (default 14 hari, editable) |
| Page | "1 of N" otomatis |

### 3.3 Blok Penerima ("Kepada Yth") — dinamis dari data customer
| Field | Keterangan |
|---|---|
| Nama customer | Nama kontak (Bapak/Ibu ...) |
| Nama PT | Nama perusahaan customer — **wajib ada baris terpisah** (di referensi belum ada) |
| No. HP/WA | Nomor HP customer |

Diikuti kalimat pembuka standar (editable): "Dengan Hormat, Bersama ini kami mengajukan penawaran harga komponen untuk proyek tersebut, dengan perincian harga sebagai berikut:"

### 3.4 Tabel Item
Kolom: **NO | DESCRIPTION | MANUFACTURE | QTY | UNIT PRICE | TOTAL PRICE**

- Description mendukung 2 level: judul item (bold, uppercase) + sub-komponen sebagai bullet list (mis. Box Panel Indoor Plat 1.2 mm, MCCB 3P 300A, Pilot Lamp RST, Terminal, Busbar, Rail & Duct, Pemasangan).
- Kolom Manufacture untuk brand komponen (Schneider, Chint, dsb).
- Format harga: `Rp11,350,000` atau `Rp11.350.000` (konsisten satu format, thousand separator).
- Total Price = Qty × Unit Price, auto-calculate.
- Baris **GRAND TOTAL** di bawah tabel, bold, highlight.

### 3.5 Terbilang
Auto-generate dari Grand Total dalam Bahasa Indonesia, italic. Contoh: "Terbilang: *Delapan Belas Juta Tiga Ratus Ribu Rupiah*".

### 3.6 Syarat & Kondisi Penawaran (box kiri bawah) — editable, dengan default
- Cara Pembayaran: default "50% uang muka saat penetapan order, 50% pelunasan sebelum barang diambil"
- Waktu Pengadaan: default "7–10 hari kerja setelah uang muka diterima"
- Masa Berlaku Penawaran: default 14 hari (sinkron dengan Valid Until)
- Keterangan: info rekening transfer (bank, no. rekening, a.n.) — dari master data, bukan hardcoded

### 3.7 Catatan (kanan bawah) — editable, dengan default
- Harga belum termasuk PPN 11%
- Harga sudah termasuk perakitan dan pengujian
- Pengiriman & instalasi tidak termasuk (opsional per quotation)

### 3.8 Blok Tanda Tangan
- "Hormat Kami," + area tanda tangan + nama sales + jabatan (mis. Sales Engineer), diambil dari user yang membuat dokumen.

### 3.9 Footer — editable
- Bar footer berisi: telepon kantor, no. HP/WA, email, website — default ditarik dari master data perusahaan.
- Konten footer bisa diedit per template (tambah/hapus/ubah item kontak, ubah urutan) tanpa mengubah master data.
- Bisa toggle show/hide per item (mis. sembunyikan website kalau belum ada).

## 4. Functional Requirements
1. **Master data perusahaan** (logo, nama, alamat, WA, email, rekening bank) disimpan sekali di setting, semua template menarik dari sana — ganti sekali, semua dokumen ikut berubah.
2. **Data customer** ditarik dari database customer (nama, PT, no HP) — tidak diketik ulang tiap quotation.
3. **Auto-numbering** nomor dokumen dengan format konsisten dan tidak boleh duplikat.
4. **Auto-calculation**: total per baris, grand total, terbilang, valid until.
5. **Preview sebelum cetak/export PDF.**
6. Opsi kirim langsung PDF via **WhatsApp** ke nomor customer.

## 5. Design Requirements
- Skema warna brand GJP (navy/biru tua seperti referensi, atau sesuai brand guideline GJP).
- Font sans-serif profesional, konsisten.
- Header tabel dengan background warna brand, teks putih.
- Margin aman untuk printer standar (min. 10 mm tiap sisi).

## 6. Acceptance Criteria
- [ ] Tidak ada data hardcoded milik pihak lain (logo, nama, nomor, email lama semua tergantikan data GJP).
- [ ] Quotation baru bisa dibuat hanya dengan pilih customer + input item; sisanya auto.
- [ ] PDF hasil export identik dengan preview dan rapi saat dicetak A4.
- [ ] Terbilang dan grand total selalu akurat.
- [ ] Nama PT customer dan no HP tampil di blok penerima.
