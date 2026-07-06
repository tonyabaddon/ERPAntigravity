# VOSI — Pitch Deck Knowledge Doc

**Untuk:** Rendering pitch deck PPT/Google Slides via Claude AI (atau tool AI slide generator lain — Gamma, Beautiful.ai, Canva Magic Design).
**Target audience deck:** Owner / decision-maker distributor B2B Indonesia (fokus sentra Glodok — alat listrik, panel, CCTV, suku cadang).
**Format deck:** 14 slide, 16:9, dual-use (live pitch 12–15 menit + kirim untuk dibaca sendiri).
**Bahasa:** Indonesia formal (Anda / Pak / Bu).
**Tanggal knowledge doc:** 2026-07-05
**Status:** Ready for handoff.

---

## §0. Cara pakai dokumen ini

1. **Buka Claude.ai** (Pro/Team account untuk kapasitas file).
2. **New Chat** → attach file ini sebagai project knowledge, atau paste isi doc ke pesan pertama.
3. **Prompt awal ke Claude PPT builder:**

   > "Baca knowledge doc terlampir. Kamu adalah desainer presentasi profesional. Bikinkan file **PowerPoint (.pptx)** 14 slide, 16:9, mengikuti spec di Section B slide-by-slide **verbatim**. Ikuti brand tokens di §A (warna, font, layout hierarchy). Setiap slide harus visual-dominant (visual ~60–70% area, text ~30–40%). Body text pakai bahasa yang tertulis di 'Body text (verbatim ID)' tanpa parafrase. Speaker notes copy paste ke slide notes. Output: file .pptx yang bisa saya download."

4. **Kalau Claude PPT builder tidak punya pptx tool:** minta dia render sebagai **HTML slides** (satu file per slide dalam satu HTML dengan navigation) — Anda bisa export ke PDF via print → save as PDF, atau screenshot ke PPT manual.

5. **Iterasi:** setelah slide pertama jadi, minta revisi per slide dengan feedback konkret ("slide 3 ubah palet lebih terang, headline dibesarkan 20%"). Jangan minta "bikin ulang semua" — biaya token lebih tinggi & drift dari spec.

6. **Handoff visual asset:**
   - Logo VOSI PNG final ada di repository `docs/logo-png-final/` (kalau Anda mau share ke Claude PPT).
   - Icon library recommended: **Lucide** (open source, style konsisten dengan tone — stroke 1.8px round cap sesuai VOSI Design System).
   - Foto: hindari stock photo generic. Kalau butuh, pakai icon/illustration flat style dominan.

---

## §A. Brand & audience context (BACA DULU sebelum render)

### A.1 Brand tokens (dari VOSI Design System v1.0)

**Warna palet inti (WAJIB dipakai — jangan improvise):**

| Token | HEX | Penggunaan di deck |
|---|---|---|
| Navy | `#0B2545` | Background dominan, judul, elemen struktural, teks di atas cream |
| Gold | `#F9B233` | CTA, aksen headline, angka penting, badge PROMO, checkmark ✓ VOSI |
| Cream | `#FAF7F0` | Background hangat alternatif, kartu, panel content |
| Slate | `#5A6472` | Body text di latar terang, secondary info |
| Muted | `#9DB2CE` | Secondary text di latar navy |
| Success | `#1F8A5B` | Angka positif, check mark, indikator "stok aman" |
| Danger | `#C0392B` | X mark, indikator "kompetitor gagal", angka negatif |

**Aturan 60/30/10 (jangan dilanggar):**
- ~60% area = Navy atau Cream (background dominan)
- ~30% area = pendukung (slate, muted, cream/navy sekunder)
- ~10% area = Gold (aksen sorotan saja — CTA, angka besar, badge)

**Gold ≠ warna teks paragraph.** Gold cuma dipakai untuk sorotan (headline word, CTA button, angka hero, badge PROMO). Kalau seluruh judul Gold — itu salah.

### A.2 Tipografi

| Peran | Font | Bobot | Catatan |
|---|---|---|---|
| Display / Headline | **Plus Jakarta Sans** | 800 | Letter-spacing -0.02em |
| Subheadline | Plus Jakarta Sans | 700 | Normal tracking |
| Body / Bullet | Plus Jakarta Sans | 500 | Normal tracking, minimum 20pt di slide 16:9 |
| Label / Angka / Kode SKU / Harga | **JetBrains Mono** | 500–700 | Uppercase untuk label, tracking 0.1em |

**Ukuran font minimum di slide 16:9 (agar terbaca di HP saat live pitch):**
- Headline hero: 60–72pt
- H1: 44–52pt
- H2: 32–38pt
- Body: 22–26pt
- Label mono: 16–18pt

**Fallback font:** kalau Plus Jakarta Sans tidak tersedia di PPT builder, pakai **Inter** atau **Nunito Sans**. Untuk mono fallback: **IBM Plex Mono** atau **Roboto Mono**.

### A.3 Simbol brand — Semut 🐜

VOSI pakai simbol **semut** — kecil, terorganisir, gotong-royong, tangguh. Cerminan UMKM/distributor kecil-menengah yang naik kelas.

**Di deck:** semut boleh muncul sebagai icon subtle di corner cover, watermark section divider, atau dekorasi footer. **Jangan overpakai** — max 3–4 slide (jangan tiap slide ada semut).

### A.4 Layout template hierarchy (dipakai ulang di deck)

Ada 6 template layout — setiap slide di §B akan pilih salah satunya:

| Kode | Nama | Use case |
|---|---|---|
| `T1` | **Full-bleed hero** | Cover, section divider, CTA close. Text center, minimal, visual full |
| `T2` | **Split 60/40 visual-kiri** | Konsep + explanation. Visual dominan kiri, text ringkas kanan |
| `T3` | **Split 60/40 visual-kanan** | Balik dari T2 — text kiri, visual kanan. Untuk variasi visual rhythm |
| `T4` | **Grid 2×2 quadrant** | 4 item setara (modul, benefit, quadrant) |
| `T5` | **Horizontal timeline / flow** | Step by step (demo flow, onboarding, comic strip) |
| `T6` | **Comparison table** | vs Kompetitor, pricing tier comparison |

### A.5 Tone & voice untuk slide + speaker notes

**IKUTI:**
- Bahasa Indonesia formal — "Anda", "Pak", "Bu". Bukan "lo/gue" (target owner 40–55 tahun).
- Headline = pain atau outcome, BUKAN fitur. Contoh: ✓ "Quote WA lupa di-follow up?" ✗ "Kelola Sales Order"
- Konkret > kategori. ✓ "MCB-mu di gudang berapa?" ✗ "Kelola stok produk"
- Angka spesifik. "80% quote hilang" > "Banyak quote hilang"
- Acknowledge alternatif yang sudah dicoba prospek — jangan pura-pura kompetitor tidak ada.

**HINDARI:** kata "ERP" di headline (boleh di sub kalau perlu), "workflow", "synergy", "ekosistem", "platform", "solusi holistik", "one-stop solution". Ini kata generic SaaS yang sudah dead.

### A.6 Audience persona ringkas — "Pak Anton"

Owner toko panel listrik di LTC Glodok lantai 3. **45 tahun**. **12 tahun bisnis.** **8 staff** (2 admin counter, 2 sales lapangan, 2 gudang, 1 driver, 1 anak asisten). **800+ SKU**. **200+ customer aktif**. Omzet Rp 300jt – 3M / bulan.

**5 pain kalimat dia sendiri:**

1. *"Customer minta quote di WA, anak saya tulis tangan, suka lupa di-follow up. Quote yang nge-deal cuma 20%."*
2. *"Sales janji harga 800rb. Cost saya 850rb. Untung kepotong — baru ketahuan 2 minggu kemudian."*
3. *"Customer proyek tempo 60 hari. Lupa nagih. Baru inget pas customer lain bayar."*
4. *"Stok di komputer 50, di gudang ternyata 12. Sales sudah janji ke customer. Customer marah."*
5. *"Tutup toko jam 9, rekap manual sampai jam 12 malam. Capek."*

**Sudah coba apa:** Excel (revisi hilang, kolom pecah), WhatsApp grup sales (tidak nge-track), Buku nota (fisik hilang, susah cari), Jurnal Mekari (dianggap "kayak akuntansi banget"), Accurate (quote 18jt + training — gak jadi).

**Yang dia butuhkan:** ERP **operasional** yang gampang dipakai admin counter, bisa dikontrol owner dari HP, dan **tidak dipaksa jadi accounting software**.

### A.7 Positioning statement (dipakai di slide 5)

> **VOSI adalah ERP khusus distributor B2B Indonesia** — alat listrik, panel, CCTV, suku cadang. Dari order WhatsApp & buku nota ke satu sistem yang dipakai admin, sales lapangan, dan owner setiap hari. **Bukan accounting software yang dipaksa jadi ERP.**

---

## §B. Per-slide spec (14 slide — verbatim, ikuti persis)

> **Konvensi format setiap slide:**
> - `Layout`: kode template dari §A.4
> - `Visual concept`: DESKRIPSI DETAIL visual — this is the main render instruction. Ikuti sedetail mungkin.
> - `Body text (verbatim ID)`: teks yang HARUS dituliskan di slide, tanpa parafrase.
> - `Speaker notes`: paragraf 60–100 kata untuk live pitch, juga jadi fallback konteks self-read.
> - `Design notes`: warna, hierarchy, aksen khusus.

---

### SLIDE 1 — COVER

**Layout:** T1 — Full-bleed hero

**Visual concept:**
Background full **Navy `#0B2545`**. Di tengah horizontal, wordmark **"VOSI"** raksasa dalam Plus Jakarta Sans 800 (ukuran ~180pt), warna Cream `#FAF7F0`. Di atas wordmark, icon lingkaran kecil (diameter ~80px) berisi silhouette semut warna Gold `#F9B233`. Di bawah wordmark, tagline dalam JetBrains Mono uppercase 24pt tracking wide: `ERP DISTRIBUTOR B2B — BUKAN AKUNTANSI YANG DIPAKSA`. Di corner kanan bawah, badge kecil Gold: **`PROMO LAUNCH 50% OFF · 100 TENANT PERTAMA`**. Di corner kiri bawah, nama presenter + tanggal (JetBrains Mono 14pt, warna Muted).

**Body text (verbatim ID):**
- Wordmark: `VOSI`
- Tagline: `ERP DISTRIBUTOR B2B — BUKAN AKUNTANSI YANG DIPAKSA`
- Badge: `PROMO LAUNCH 50% OFF · 100 TENANT PERTAMA`
- Footer kiri: `[Nama Presenter] · [Tanggal Presentasi]`

**Speaker notes:**
"Selamat pagi Pak / Bu. Terima kasih sudah menyempatkan waktu. Nama saya [X]. Saya di sini bukan untuk jualan accounting software — di luar sudah banyak. Saya di sini untuk cerita satu sistem yang khusus dibuat untuk distributor seperti Bapak. Kalau 15 menit ke depan Anda merasa 'ini bukan buat saya', tidak apa-apa, saya pergi. Tapi kalau salah satu masalah yang saya sebut kedengaran seperti masalah Anda kemarin, mari kita ngobrol lebih dalam."

**Design notes:**
- Dominan Navy 100%.
- Gold aksen ~5% (ikon semut + badge PROMO).
- Cream untuk wordmark ~20%.
- Font hierarchy jelas — wordmark hero, tagline supporting.

---

### SLIDE 2 — PAIN #1: WA QUOTE HILANG

**Layout:** T2 — Split 60/40 visual-kiri

**Visual concept:**
**Kiri (60%):** Mockup **WhatsApp Business chat screen** — warna asli WA (background pale green `#E7DED4`). Tampilkan feed dengan ~8 chat bubble incoming dari beberapa customer (nama Indonesia: "Pak Hadi (Kontraktor)", "Bu Yanti - Toko Bahagia", "PT Sinar Jaya", dll.), masing-masing minta quote (contoh: "Bos, MCB 6A 50 pcs berapa?", "Mau tanya CCTV Hikvision 4CH", "Panel 10x10 siap?"). 5 dari 8 chat ada tanda **X merah bulat** di corner, artinya belum di-reply / hilang. 3 chat lainnya masih pending.

**Kanan (40%):** Background Cream `#FAF7F0`. Angka RAKSASA **`80%`** Gold `#F9B233`, Plus Jakarta Sans 800, ukuran ~200pt, di tengah. Di bawah angka, teks Navy `#0B2545`: "quote WA distributor Glodok hilang di chat." (Plus Jakarta Sans 700, 28pt).

**Body text (verbatim ID):**
- Angka hero: `80%`
- Subtext: `quote WA distributor Glodok hilang di chat.`
- Footnote kecil di corner (JetBrains Mono 12pt, Slate): `*Observasi pengalaman owner LTC Glodok. Bukan riset formal.`

**Speaker notes:**
"Pertanyaan cepat, Pak — coba ingat 1 minggu terakhir. Berapa quote yang Anda kirim di WhatsApp? Anak saya sendiri, adminnya, sering bilang: 'Ba, tadi ada yang chat tapi lupa aku catat.' Rata-rata dari observasi owner-owner di sini, **80% quote yang masuk WA tidak jadi nota**. Bukan karena customer tidak berminat — tapi karena tidak ada sistem yang track: siapa tanya apa, kapan, sudah dijawab belum. Chat ke-scroll ke bawah. Selesai. Uang yang seharusnya masuk, tidak masuk."

**Design notes:**
- Mockup WA harus terasa REAL — pakai warna asli WA, timestamp, jam, avatar generic.
- Angka 80% tidak boleh Cream / Navy — WAJIB Gold untuk grab attention.
- Footnote asterisk penting untuk credibility (jujur bahwa ini observasi).

---

### SLIDE 3 — VOICE OF OWNER (3 quotes persona)

**Layout:** T4 — Grid modifikasi (3 kolom vertikal)

**Visual concept:**
Background Cream `#FAF7F0`. 3 kolom equal-width. Setiap kolom berisi:
- Di atas: silhouette avatar sederhana (lingkaran Navy dengan initial huruf — "A", "B", "C" — dalam Cream).
- Di tengah: **speech bubble** (bentuk rectangle rounded 16px, background Navy, teks Cream) berisi quote pull.
- Di bawah bubble: 1 baris caption Slate — persona label (misal: "Owner toko panel, 12 thn bisnis").

**Speech bubble punya "tail" kecil ke bawah** menghubungkan ke avatar, seperti chat balloon.

Font speech bubble: Plus Jakarta Sans 500, italic, 22pt. Warna Cream. Line-height 1.4.

**Body text (verbatim ID):**
**Kolom 1:**
- Avatar: `A`
- Quote: *"Sales janji harga 800rb. Cost saya 850rb. Untung kepotong — baru ketahuan 2 minggu kemudian."*
- Caption: `Owner toko panel · 12 thn bisnis`

**Kolom 2:**
- Avatar: `B`
- Quote: *"Customer proyek tempo 60 hari. Lupa nagih. Baru inget pas customer lain bayar."*
- Caption: `Owner distributor CCTV · 8 staff`

**Kolom 3:**
- Avatar: `C`
- Quote: *"Tutup toko jam 9, rekap manual sampai jam 12 malam. Capek."*
- Caption: `Owner alat listrik · Glodok LTC`

**Speaker notes:**
"Tiga kalimat ini bukan saya karang. Ini dari owner distributor di sekitar sini, waktu saya ngobrol tanpa niat jualan. Salah satu bilang: 'Sales janji harga 800, cost saya 850, baru ketahuan 2 minggu kemudian.' Ada juga: 'Customer proyek TEMPO 60 hari, saya lupa nagih.' Dan yang paling sering: 'Rekap sampai jam 12 malam.' Kalau ini terdengar familiar, Anda tidak sendirian. Ini pain harian distributor B2B — bukan masalah manajemen Anda, ini masalah sistem yang belum ada."

**Design notes:**
- 3 kolom equal spacing, gap 32px.
- Speech bubble Navy — quote text Cream — kontras tinggi.
- Italic HANYA di quote (biar terasa "kutipan"), caption tetap regular.
- Jangan pakai foto orang asli — silhouette avatar simple sudah cukup.

---

### SLIDE 4 — KENAPA SOLUSI SEKARANG GAGAL

**Layout:** T5 — Horizontal 3-column comparison

**Visual concept:**
Background Cream `#FAF7F0`. Judul di atas (H1): `Kenapa 3 solusi ini gagal?` (Plus Jakarta Sans 800, 44pt, Navy).

Di bawah judul, 3 kolom horizontal. Setiap kolom:
- **Icon besar** (~120×120px) di atas, style flat outline (stroke 1.8px Navy):
  - Kolom 1: icon spreadsheet Excel (grid dengan angka)
  - Kolom 2: icon WhatsApp / chat bubble
  - Kolom 3: icon buku besar (buku nota / accounting book)
- Di bawah icon, **X merah besar** `#C0392B` (60×60px) — menandakan gagal.
- Di bawah X, nama solusi (Plus Jakarta Sans 700, 26pt, Navy).
- Di bawah nama, 1 kalimat alasan (Plus Jakarta Sans 500, 18pt, Slate).

**Body text (verbatim ID):**
**Kolom 1:**
- Nama: `EXCEL`
- Alasan: `Revisi hilang. Rumus rusak. Kolom pecah. Tidak multi-user real-time.`

**Kolom 2:**
- Nama: `WHATSAPP`
- Alasan: `Tidak ada track. Chat ke-scroll. Tidak tahu quote mana yang deal.`

**Kolom 3:**
- Nama: `JURNAL / ACCURATE`
- Alasan: `Akuntansi, bukan operasional. Admin counter Anda tidak paham debit-kredit.`

**Speaker notes:**
"Kenapa Excel gagal? Anda tahu sendiri — begitu 3 orang buka file sama, kolom pecah. Revisi hilang. Rumus rusak sendiri. WhatsApp? Chat cepat tapi tidak ada track. Sudah dibayar belum? Sudah dianter belum? Tidak ketahuan. Yang terakhir — Jurnal, Accurate — bagus untuk akuntan. Tapi admin counter Anda tidak paham 'debit kas kredit persediaan'. Yang dia butuh: input transaksi 5 detik, otomatis semua rapi di belakang. Bukan menu 40 tab akuntansi."

**Design notes:**
- Icon flat outline — jangan pakai icon 3D atau full-color raster.
- X merah harus dominan — reinforce "gagal".
- Nama solusi ALL CAPS di judul kolom.

---

### SLIDE 5 — POSITIONING (Before / After)

**Layout:** T2 — Split 60/40 modifikasi

**Visual concept:**
Background Cream `#FAF7F0` dengan garis pemisah vertikal tipis di tengah.

**Kiri (label "SEBELUM VOSI", warna Slate):** Diagram chaos — 5 bubble/icon terpisah connected by messy criss-cross lines:
- Icon Excel spreadsheet
- Icon WhatsApp chat
- Icon buku nota fisik
- Icon grup chat sales
- Icon calculator / kalkulator

Lines antar bubble berwarna **Danger `#C0392B`** dengan stroke thin, criss-cross bikin "kacau".

**Kanan (label "DENGAN VOSI", warna Success):** 1 hub sentral besar berbentuk **shield/heksagon Navy** dengan wordmark "VOSI" Cream di dalamnya. Di sekitar hub, 4 icon output tersambung dengan garis rapi warna Success `#1F8A5B`:
- Icon HP (owner control)
- Icon warehouse (stok)
- Icon receipt/invoice
- Icon dashboard chart

Di paling bawah slide, satu baris headline besar (Plus Jakarta Sans 800, 36pt, Navy):

**Body text (verbatim ID):**
- Label kiri: `SEBELUM VOSI`
- Label kanan: `DENGAN VOSI`
- Headline bawah: `Satu sistem. Semua tim pakai. Owner kontrol dari HP.`

**Speaker notes:**
"Sekarang Anda operasi pakai berapa tool? Excel untuk stok, WhatsApp untuk order, buku nota untuk hutang, grup sales untuk update lapangan, kalkulator untuk harga. Setiap tool tidak ngomong sama lain. Setiap update harus dicatat ulang. Setiap pertanyaan owner harus tanya 3 orang. VOSI = satu sistem yang menggantikan semua ini. Bukan menambah tool, tapi menggabungkan. Admin counter, sales lapangan, gudang, Anda sebagai owner — semua lihat data yang sama, real-time."

**Design notes:**
- Kiri chaos (garis merah criss-cross) vs Kanan rapi (garis hijau).
- Hub VOSI harus paling dominan visually — biggest element.
- Headline bawah full-width, center-aligned.

---

### SLIDE 6 — MODUL SALES SIDE (Quote → Deal)

**Layout:** T5 — Horizontal flow

**Visual concept:**
Background Navy `#0B2545`. Judul atas (Cream, Plus Jakarta Sans 800, 40pt): `Dari WA sampai bank — otomatis.`

Di tengah slide, **flow diagram horizontal 4-step**:

```
[WA icon] ──→ [Penawaran PDF] ──→ [Sales Invoice] ──→ [Track conversion]
```

Setiap node adalah kartu rounded Cream `#FAF7F0` 200×160px dengan icon di atas (Navy outline 1.8px stroke) + label di bawah (Plus Jakarta Sans 700, 20pt, Navy). Arrow antar node = garis Gold `#F9B233` dengan chevron di ujung.

Di bawah flow, tambahkan 1 baris angka hero JetBrains Mono Gold: **`~2 menit`** (ukuran 56pt), teks kecil Cream di sebelahnya: "dari WA masuk sampai PDF Penawaran siap kirim."

**Body text (verbatim ID):**
- Judul: `Dari WA sampai bank — otomatis.`
- Node 1: `Quote WA masuk`
- Node 2: `Penawaran PDF`
- Node 3: `Sales Invoice`
- Node 4: `Conversion tracked`
- Angka hero: `~2 menit`
- Angka caption: `dari WA masuk sampai PDF Penawaran siap kirim`
- Bullet bawah (JetBrains Mono uppercase 14pt, Muted): `PENAWARAN · DAFTAR QUOTE · FAKTUR PDF · CONVERSION RATE`

**Speaker notes:**
"Ini bagian yang paling langsung ROI-nya. Customer WA Anda: 'MCB 6A 50 pcs.' Admin buka VOSI, klik 'Penawaran Baru', pilih customer — datanya sudah ada di sistem. Ketik 50 pcs MCB 6A. Sistem otomatis ambil harga sesuai kategori customer (retail atau kontraktor). Klik 'Buat PDF' — 30 detik. Kirim balik ke WA customer. Customer setuju? Klik 'Jadikan Sales Invoice' — semua data ngalir, tidak input ulang. Sales Invoice keluar, stok otomatis turun. Setiap quote di-track: mana yang deal, mana yang tidak. Bulan depan Anda tahu conversion rate sales Anda berapa persen."

**Design notes:**
- Background Navy — kartu Cream memberi kontras kuat.
- Arrow Gold sebagai visual thread — connect ke Gold hero angka.
- Angka hero paling grab attention.

---

### SLIDE 7 — MODUL OPS + OWNER CONTROL

**Layout:** T4 — Grid 2×2 quadrant

**Visual concept:**
Background Cream `#FAF7F0`. Judul atas (Navy, Plus Jakarta Sans 800, 40pt): `Kontrol operasional — dan Anda dari HP.`

Grid 2×2 quadrant, gap 24px, setiap cell 480×280px:

**Kartu 1 (kiri atas) — STOK MULTI-GUDANG:**
- Icon warehouse besar (~80×80px, Navy outline).
- Nama modul: `Stok Multi-Gudang` (Plus Jakarta Sans 700, 24pt, Navy).
- Deskripsi: `Real-time per gudang. Sales tahu sebelum janji. Opname dengan audit trail.`
- Badge kecil corner Gold: `PRO · 5 GUDANG · PREMIUM · 10 GUDANG`

**Kartu 2 (kanan atas) — PIUTANG TEMPO:**
- Icon receipt / dokumen dengan jam.
- Nama: `Piutang TEMPO`
- Deskripsi: `30/60/90 hari auto-listed by jatuh tempo. Tidak nyangkut.`
- Badge: `SEMUA TIER`

**Kartu 3 (kiri bawah) — OWNER PIN APPROVAL:**
- Icon HP dengan sidik jari / PIN pad.
- Nama: `Owner PIN dari HP`
- Deskripsi: `Staff input, Anda approve dari HP. Stock adjustment, biaya, write-off.`
- Badge: `PRO · PREMIUM`

**Kartu 4 (kanan bawah) — EXECUTIVE DASHBOARD:**
- Icon dashboard chart bar/line.
- Nama: `Executive Dashboard`
- Deskripsi: `Omzet, margin, stok, AR — 1 layar. Buka pagi hari, sekali lihat, tahu.`
- Badge: `PRO · PREMIUM`

**Body text (verbatim ID):**
Sesuai spec kartu di atas — 4 nama modul, 4 deskripsi, 4 badge. Copy verbatim.

**Speaker notes:**
"Setelah quote jadi nota, ada 4 hal yang bikin Anda bisa pulang jam 6. Satu — stok multi-gudang. Sales lihat stok gudang mana yang masih ada sebelum janji ke customer. Dua — piutang TEMPO. 30 hari, 60 hari, 90 hari — sistem list otomatis by jatuh tempo. Reminder muncul, Anda tinggal WA. Tiga — Owner PIN. Staff mau adjust stok? Kirim ke inbox Anda. Anda buka HP, PIN, approve — atau reject. Tanpa harus ke toko. Empat — dashboard. Pagi hari buka HP, satu layar: omzet kemarin, margin, stok kritis, piutang jatuh tempo minggu ini. Sekali lihat, Anda tahu."

**Design notes:**
- 4 kartu equal-visual-weight — jangan ada yang lebih dominan.
- Badge tier di corner kartu — Gold background, Navy text, JetBrains Mono uppercase 12pt.
- Icon monochrome (Navy outline) — konsisten.

---

### SLIDE 8 — DEMO FLOW KONKRET (Comic Strip 6-panel)

**Layout:** T5 — Horizontal comic strip 6-panel

**Visual concept:**
Background Cream `#FAF7F0`. Judul (Plus Jakarta Sans 800, 32pt, Navy) di atas: `1 order — dari WA sampai bank.` Sub kecil (Slate 18pt): `Cerita Pak Hadi, kontraktor proyek Bekasi.`

Di bawah judul, **6 panel comic-strip horizontal**, setiap panel 280×280px, gap 16px. Setiap panel = kartu rounded 16px, background gradient Navy-ke-Cream halus, dengan:
- **Nomor besar di corner kiri atas** (Gold, JetBrains Mono 800, 32pt): `1`, `2`, `3`, `4`, `5`, `6`.
- **Icon center** (~80×80px, sesuai action):
  1. WhatsApp icon
  2. Layar laptop / form Penawaran
  3. PDF document icon
  4. Handshake / thumbs-up
  5. Receipt / Invoice
  6. Bank icon
- **1 baris label di bawah** (Plus Jakarta Sans 700, 16pt, Navy).

**Body text (verbatim ID):**
- Judul: `1 order — dari WA sampai bank.`
- Sub: `Cerita Pak Hadi, kontraktor proyek Bekasi.`
- Panel 1: `WA masuk: "MCB 6A 50 pcs"`
- Panel 2: `Admin buka Penawaran, pilih Pak Hadi`
- Panel 3: `PDF Penawaran → kirim balik ke WA`
- Panel 4: `Pak Hadi setuju`
- Panel 5: `Sales Invoice keluar → stok turun`
- Panel 6: `TEMPO 30 hari → Rekonsiliasi bank`

**Speaker notes:**
"Saya ceritakan satu alur nyata — 3 menit. Senin pagi, Pak Hadi kontraktor proyek Bekasi chat WA: 'Bos, MCB 6A 50 pcs hari ini.' Admin Anda buka VOSI, klik Penawaran Baru, pilih Pak Hadi — datanya sudah ada, harga otomatis grosir karena Pak Hadi kategori kontraktor. Ketik 50, klik Buat PDF — 2 menit, kirim balik ke WA. Pak Hadi setuju. Admin klik Jadikan Sales Invoice — semua data ngalir, tidak input ulang. Stok MCB 6A di gudang otomatis turun 50. Karena TEMPO 30 hari, tagihan otomatis masuk Piutang dengan jatuh tempo. 30 hari kemudian sistem reminder — Anda WA Pak Hadi. Pak Hadi bayar, admin tag Pembayaran, Rekonsiliasi bank otomatis. Selesai. Anda? Lihat semuanya dari HP, kapan saja."

**Design notes:**
- 6 panel EQUAL SIZE — tidak boleh ada yang mendominasi.
- Nomor Gold di corner sebagai visual anchor.
- Icon monochrome flat outline — konsisten dengan slide sebelumnya.
- Comic-strip flow left-to-right — reader natural eye movement.

---

### SLIDE 9 — CALISTA AI (Premium exclusive)

**Layout:** T2 — Split 60/40 visual-kiri

**Visual concept:**
**Kiri (60%):** Mockup **WhatsApp chat screen** vertical (portrait) menampilkan percakapan real. Kiri = customer, Kanan = **Calista** dengan avatar khusus (icon semut Gold dalam lingkaran Navy).

Percakapan mock:
```
Customer (kiri): Bos, ada CCTV 4CH Hikvision?
Calista (kanan): Ada, Pak. Hikvision DS-7204HGHI 4CH, harga Rp 1.850.000 
                 (harga kontraktor, sudah termasuk kabel 20m). Stok 6 unit 
                 di gudang Glodok. Mau berapa?
Customer: 3 unit dulu.
Calista: Baik, saya buat penawaran ya. Sebentar...
       [Attachment: Penawaran-20260703-001.pdf]
```

Di corner atas kanan chat, badge kecil bertuliskan **`CALISTA — AI`** (JetBrains Mono uppercase, Gold on Navy).

**Kanan (40%):** Background Navy `#0B2545`. Judul (Cream, Plus Jakarta Sans 800, 36pt): `Calista AI` di atas. Angka besar (Gold, JetBrains Mono 800, 100pt) center: **`300`**. Sub (Cream, 20pt): `chat / hari, per tenant.`

Di bawah, 3 bullet ringkas Cream (Plus Jakarta Sans 500, 18pt):
- `Baca konteks chat customer`
- `Kasih harga sesuai kategori`
- `Bikin nota otomatis — handover ke staff kalau kompleks`

Badge tier corner: **`PREMIUM ONLY`** (Gold background, Navy text).

**Body text (verbatim ID):**
- Judul: `Calista AI`
- Angka hero: `300`
- Sub angka: `chat / hari, per tenant.`
- Bullet 1: `Baca konteks chat customer`
- Bullet 2: `Kasih harga sesuai kategori`
- Bullet 3: `Bikin nota otomatis — handover ke staff kalau kompleks`
- Badge tier: `PREMIUM ONLY`

**Speaker notes:**
"Ini bagian yang belum ada di kompetitor. Namanya Calista. Bukan chatbot generic yang jawab 'terima kasih' — Calista adalah AI agent yang **baca konteks chat customer Anda**. Kalau customer tanya harga, Calista tahu customer ini kategori apa, ambil harga yang sesuai. Kalau customer tanya stok, Calista cek real-time di gudang mana. Kalau customer siap deal, Calista bikin penawaran, kirim PDF balik. 300 chat per hari, per tenant. Admin Anda cuma handle yang benar-benar butuh manusia — negosiasi, komplain, custom request. Yang standar? Calista handle 24/7. Bandingkan Mekari Kontak — masih butuh staff susun template. Calista end-to-end."

**Design notes:**
- WA chat mockup harus terasa REAL — pakai warna asli WhatsApp, timestamp, seen ticks.
- Angka 300 Gold DOMINAN — hero visual.
- Badge PREMIUM ONLY jelas — jangan misleading bahwa ini di semua tier.

---

### SLIDE 10 — VS KOMPETITOR

**Layout:** T6 — Comparison table

**Visual concept:**
Background Cream `#FAF7F0`. Judul (Navy, Plus Jakarta Sans 800, 36pt): `VOSI vs kompetitor untuk distributor B2B.`

Table dengan 5 baris × 5 kolom. Header row background Navy, text Cream. Kolom VOSI di-highlight dengan background Gold tipis `#F9B233` opacity 20% dan border Gold tebal.

**Header:**
| Kriteria | **VOSI** | Jurnal Mekari | Accurate | Kledo |

**Rows:**
| Kriteria | VOSI | Jurnal | Accurate | Kledo |
|---|---|---|---|---|
| Fokus target | Distributor B2B | Akuntansi umum | Enterprise besar | Solo/kecil |
| Learning curve untuk admin | Semudah WhatsApp | Perlu paham akuntansi | Butuh training 2 minggu | Kompleks untuk ops |
| Multi-gudang + transfer | ✓ | ⚠ Add-on | ✓ | ✗ |
| WA AI (baca chat + bikin nota) | ✓ Calista end-to-end | ✗ | ✗ | ✗ |
| Harga effective 12mo | Rp 664K (Pro) | Rp 1,499K+ (Enterprise) | Rp 18M setup + subs | Rp 50–199K |

**Body text (verbatim ID):**
- Judul: `VOSI vs kompetitor untuk distributor B2B.`
- Sub kecil di bawah tabel (JetBrains Mono 12pt, Slate): `Harga VOSI Pro Rp 664K/bln (12mo) · 56% lebih murah dari Jurnal Enterprise · Calista AI eksklusif`

**Speaker notes:**
"Saya jujur — Anda mungkin sudah dengar atau coba semua ini. Jurnal Mekari — bagus untuk akuntansi. Tapi bukan untuk operasional distributor. Fokusnya akuntan, bukan admin counter. Accurate — enterprise-grade, tapi setup 18 juta plus training 2 minggu — untuk toko dengan 5 staff, terlalu berat. Kledo — murah, tapi single-user, tidak multi-gudang, tidak untuk distributor. VOSI khusus untuk profile Anda: 5–15 staff, 1 toko + 1–2 gudang, order banyak via WA, TEMPO 30/60/90. Harga Pro Rp 664 ribu per bulan komitmen 12 bulan — 56 persen lebih murah dari Jurnal Enterprise dengan fitur lebih tepat sasaran. Plus Calista AI yang tidak dipunya siapapun."

**Design notes:**
- Kolom VOSI di-highlight — jangan malu.
- Checkmark ✓ warna Success, X warna Danger, ⚠ Gold.
- Harga dalam kolom pakai JetBrains Mono agar aligned rapi.
- Font minimum 20pt di dalam tabel — jangan terlalu kecil.

---

### SLIDE 11 — PRICING (3-tier grid, full transparency)

**Layout:** T4 modifikasi — 3-column card grid dengan center-lift

**Visual concept:**
Background Cream `#FAF7F0`. Judul atas (Navy, Plus Jakarta Sans 800, 40pt): `Harga terbuka. Tanpa jebakan.`
Sub kecil (Slate, 18pt): `PROMO LAUNCH 50% OFF — 100 tenant pertama. Money-back 14 hari.`

3 kartu vertikal, gap 24px. **Kartu tengah (Pro) di-lift ke atas** ~20px dan diberi border Gold tebal + shadow lebih dalam — visual signal "recommended".

**Struktur setiap kartu (500×580px):**

**Header kartu:**
- Nama tier (Plus Jakarta Sans 800, 28pt, Navy).
- Anchor struck-through (JetBrains Mono 20pt, Danger): `~~Rp X,XXX,XXX/bln~~`.
- Effective 12mo (Plus Jakarta Sans 800, 40pt, Gold): `Rp XXX,XXX/bln`.
- Label kecil (JetBrains Mono uppercase 12pt, Slate): `12 BULAN · HEMAT 30%`.
- Alt effective 6mo (Plus Jakarta Sans 500, 16pt, Slate): `atau Rp XXX,XXX/bln (6 bulan)`.

**Body kartu:**
- Deskripsi target (1 baris italic, 16pt, Slate).
- Divider Gold thin.
- Bullet fitur (Plus Jakarta Sans 500, 15pt, Navy), max 8 bullet — ✓ Success untuk yang termasuk, ✗ Slate untuk yang tidak.

**Footer kartu:**
- Setup fee (JetBrains Mono 14pt, Slate): `Setup Rp X,XXX,XXX`.
- CTA button pill Gold: `Pilih [Nama Tier]`.

**Data 3 tier:**

**STARTER:**
- Anchor: `~~Rp 1,199,000/bln~~`
- Effective 12mo: `Rp 419,300/bln`
- Alt 6mo: `Rp 509,150/bln`
- Target: `Toko / distributor kecil — 1–3 staff`
- Bullet: ✓ Kasir POS · ✓ Penjualan + Faktur PDF · ✓ Pembelian (PO + Tagihan PI) · ✓ Stok 1 gudang · ✓ Piutang AR + TEMPO · ✓ Sales channels (14) · ✓ Rekonsiliasi bank · ✓ Laporan dasar · ✗ Penawaran / Quote flow · ✗ Multi-gudang · ✗ GL akuntansi · ✗ Calista AI
- Setup: `Rp 1,500,000`

**PRO — RECOMMENDED (kartu tengah, di-lift):**
- Badge di atas kartu: `PALING DIREKOMENDASIKAN` (Gold pill, Navy text)
- Anchor: `~~Rp 1,899,000/bln~~`
- Effective 12mo: `Rp 664,300/bln`
- Alt 6mo: `Rp 806,650/bln`
- Target: `Distributor menengah — 5–15 staff, 1 toko + 2 gudang`
- Bullet: ✓ Semua fitur Starter · ✓ Penawaran → Invoice flow · ✓ Multi-gudang (5) · ✓ Multi-user roles · ✓ Approval Inbox + Owner PIN · ✓ GL / Neraca / Arus Kas · ✓ Executive dashboard · ✓ Opname + Audit trail · ✓ Rakit / Assembly · ✓ Barcode scanning · ✗ Calista AI
- Setup: `Rp 1,500,000`

**PREMIUM:**
- Anchor: `~~Rp 7,599,000/bln~~`
- Effective 12mo: `Rp 2,659,300/bln`
- Alt 6mo: `Rp 3,229,150/bln`
- Target: `Distributor B2B serious, chat-heavy — 100+ chat/hari`
- Bullet: ✓ Semua fitur Pro · ✓ **Calista AI for Ordering** · ✓ WhatsApp pair (pair-code + QR) · ✓ Calista capacity 300 conv/hari · ✓ Calista persona tuning · ✓ Shadow mode 2-week ramp · ✓ Multi-gudang (10) · ✓ Multi-user (25) · ✓ 50K SKU cap
- Setup: `Rp 3,500,000`

**Body text (verbatim ID):**
Sesuai data 3 tier di atas — copy verbatim. Termasuk anchor struck-through, effective 6mo dan 12mo, target line, bullet fitur, setup fee.

Badge PROMO di corner kanan atas kartu Pro dan Premium (Gold pill Navy text): `50% OFF LAUNCH`.

**Speaker notes:**
"Harga terbuka semua. Tiga tier — Starter 419 ribu, Pro 664 ribu, Premium 2 juta 659 ribu per bulan. Itu harga effective komitmen 12 bulan. Kalau Anda mau 6 bulan dulu, sedikit lebih tinggi — misal Pro jadi 807 ribu. Semua bayar upfront. Setup fee sekali di awal — 1.5 juta untuk Starter dan Pro (termasuk import CSV data Anda plus training tim), 3.5 juta untuk Premium (termasuk setup Calista + 2 minggu shadow mode). Untuk profile Anda — 5+ staff, order banyak, butuh Penawaran + multi-gudang — saya rekomendasi **Pro 12 bulan**. Kalau ragu — money-back 14 hari, uang balik penuh kalau tidak cocok. Jadi praktis, komitmen Anda cuma 14 hari evaluation."

**Design notes:**
- Kartu Pro DIANGKAT + border Gold tebal + shadow deeper = visual signal "recommended".
- Anchor struck-through wajib pakai efek strikethrough real (Danger color).
- Effective 12mo pakai Gold + font paling besar — anchor pricing psychology.
- Setup fee tidak boleh disembunyikan — jujur terbuka.
- Badge PROMO Gold on Navy pill, corner top-right kartu.

---

### SLIDE 12 — ONBOARDING (4-milestone timeline)

**Layout:** T5 — Horizontal timeline

**Visual concept:**
Background Navy `#0B2545`. Judul (Cream, Plus Jakarta Sans 800, 36pt): `Dari hari 1 sampai jalan penuh — 4 minggu.` Sub (Muted, 18pt): `Kami setup & training. Anda fokus jualan.`

Di tengah slide, **horizontal timeline** dengan 4 milestone. Timeline line = Gold `#F9B233` horizontal, dengan 4 node lingkaran Cream (diameter 100px), angka Gold di dalam (1, 2, 3, 4).

Di atas / di bawah setiap node (alternating agar tidak crowd), kartu content (240×160px, background Cream, teks Navy):

**Milestone 1 (atas node 1):**
- Label: `HARI 1`
- Judul: `Install + Import`
- Deskripsi: `Tim VOSI setup akun. Anda kirim CSV customer + SKU. Kami import — 800 SKU dalam 1 hari.`

**Milestone 2 (bawah node 2):**
- Label: `HARI 2–3`
- Judul: `Training Admin`
- Deskripsi: `Training 2 sesi × 2 jam untuk admin counter, sales, gudang. Kasir, Penawaran, Stok.`

**Milestone 3 (atas node 3):**
- Label: `MINGGU 2`
- Judul: `Shadow Mode`
- Deskripsi: `Anda pakai VOSI paralel dengan buku nota. Tim VOSI standby via WA setiap hari.`

**Milestone 4 (bawah node 4):**
- Label: `MINGGU 4`
- Judul: `Full Cutover`
- Deskripsi: `Buku nota di-arsip. VOSI = single source of truth. Anda pulang jam 6.`

Di paling bawah slide, banner Gold tipis dengan teks Navy (Plus Jakarta Sans 700, 24pt):
`Money-back 14 hari — tanpa pertanyaan.`

**Body text (verbatim ID):**
Sesuai spec milestone di atas — copy verbatim.

**Speaker notes:**
"Pertanyaan yang paling sering: 'Ribet gak setup-nya, Pak? Data saya banyak.' Jawaban: kami handle. Hari 1 — Anda kirim data (Excel customer + Excel SKU), kami import. 800 SKU biasanya selesai 1 hari. Hari 2 dan 3 — training 2 sesi masing-masing 2 jam. Admin counter, sales, gudang — semua dilatih. Minggu 2 — Anda pakai VOSI paralel dengan buku nota Anda. Kalau ada yang bingung, WA tim VOSI, dijawab hari itu juga. Minggu 4 — buku nota diarsipkan, VOSI jalan penuh. Total 4 minggu. Kalau di 14 hari pertama Anda merasa tidak cocok — money-back penuh, tanpa alasan. Jadi risiko Anda praktis nol."

**Design notes:**
- Timeline line Gold horizontal — clear visual thread.
- Node angka Cream dengan Gold text — visual anchor.
- Kartu milestone alternating atas-bawah — visual rhythm.
- Banner money-back di bawah = trust signal terakhir sebelum next slide.

---

### SLIDE 13 — FOUNDER STORY + FOUNDING TENANT

**Layout:** T3 — Split 40/60 (text kiri, visual kanan)

**Visual concept:**
Background Cream `#FAF7F0`.

**Kiri (40%):** Text block.
- H2 (Plus Jakarta Sans 800, 32pt, Navy): `Kenapa saya bangun VOSI?`
- Paragraph (Plus Jakarta Sans 500, 20pt, Slate) — line-height 1.5:
  > "Saya sendiri owner distributor B2B — 12 tahun. Coba Jurnal, Accurate, Excel. Semua gagal karena tidak dibuat untuk profile bisnis kita. Akhirnya saya bangun sendiri, mulai untuk toko saya. Setelah 2 tahun jalan, VOSI cukup matang untuk dibagi ke owner-owner lain yang punya pain sama."
- Signature line (JetBrains Mono uppercase 14pt, Navy):
  `— FOUNDER VOSI`

**Kanan (60%):** Visual "Founding Tenant Program".
- Judul kecil di atas (JetBrains Mono uppercase 16pt Gold): `FOUNDING TENANT PROGRAM`
- Big number center (Plus Jakarta Sans 800, 120pt, Navy): `100`
- Subtext (Plus Jakarta Sans 700, 24pt, Slate): `slot founding tenant tersedia`
- **Progress bar** horizontal (600×24px, rounded pill):
  - Background Cream border Navy 2px
  - Fill Gold ~15% dari kiri (visual "12 dari 100 sudah terisi" — angka bisa disesuaikan actual)
- Label di atas progress bar (JetBrains Mono 14pt): `12 / 100 TERSEDIA`
- 3 benefit bullet di bawah progress bar (Plus Jakarta Sans 700, 18pt, Navy):
  - ✓ **50% OFF LAUNCH lifetime**
  - ✓ **Rate grandfathered minimum 24 bulan**
  - ✓ **Direct line ke founder untuk feedback + feature request**

**Body text (verbatim ID):**
Sesuai spec di atas — quote founder, program header, angka 100, progress bar label `12 / 100 TERSEDIA` (adjust sesuai actual sales count), 3 benefit bullet.

**Speaker notes:**
"Sebelum kita tutup — 1 hal tentang siapa yang bangun ini. Saya sendiri owner distributor B2B — 12 tahun. Panel listrik, alat listrik, part elektronik. Saya pernah di posisi Anda: coba Jurnal, coba Accurate, coba Excel-buatan-anak-sendiri. Semua gagal karena tidak dibuat untuk profile bisnis kita. Akhirnya saya bangun sendiri, mulai untuk toko saya. Setelah 2 tahun jalan, produknya cukup matang, dan saya buka untuk owner-owner lain yang punya pain yang sama. Saat ini, kami buka program **Founding Tenant** — 100 pertama. Sudah 12 terisi. Kalau Anda gabung sekarang, harga PROMO 50% OFF ini lock lifetime 24 bulan minimum. Plus Anda punya direct line ke saya — feature request Anda saya prioritaskan."

**Design notes:**
- Kiri narrative, kanan quantitative — dua sisi trust anchor.
- Progress bar Gold fill = scarcity signal.
- Signature line penting — establishes authority tanpa nama entity.
- JANGAN sebut nama perusahaan founder atau lokasi spesifik (jaga anonimitas per feedback).

---

### SLIDE 14 — CTA CLOSE

**Layout:** T1 — Full-bleed hero

**Visual concept:**
Background Navy `#0B2545` full. Konten center-aligned vertikal.

**Bagian atas (30%):** Tagline hero (Plus Jakarta Sans 800, 56pt, Cream):
```
Owner pulang jam 6.
Sistem yang kerja sampai malam.
```

**Bagian tengah (40%):** Blok CTA Gold prominent.
- Container Gold rounded 22px, padding 40px.
- Di dalamnya:
  - Label (JetBrains Mono uppercase 18pt, Navy): `DEMO GRATIS · 15 MENIT`
  - WA number besar (JetBrains Mono 800, 44pt, Navy): `0812-XXXX-XXXX`
  - Sub kecil (Plus Jakarta Sans 500, 16pt, Navy): `Kirim "DEMO" — kami atur waktu.`

**Bagian bawah (30%):** QR code besar (200×200px) di kiri, blok teks di kanan:
- QR arahkan ke chat WA prefilled "DEMO — saya tertarik VOSI"
- Teks kanan (Plus Jakarta Sans 700, 22pt, Cream):
  ```
  Atau scan QR
  ke WA kami
  ```

**Corner bawah kanan (subtle):** Wordmark VOSI kecil + tagline `Wujudkan Visi Bisnismu` (JetBrains Mono uppercase 12pt, Muted).

**Body text (verbatim ID):**
- Hero: `Owner pulang jam 6.` / `Sistem yang kerja sampai malam.`
- Label CTA: `DEMO GRATIS · 15 MENIT`
- WA number: `0812-XXXX-XXXX` (**GANTI dengan nomor asli Anda sebelum export**)
- CTA sub: `Kirim "DEMO" — kami atur waktu.`
- QR side text: `Atau scan QR ke WA kami`
- Footer brand: `VOSI · Wujudkan Visi Bisnismu`

**Speaker notes:**
"Itu semua yang saya siapkan. Kalau Anda merasa 'oke, saya mau coba lihat dulu' — WA saya di nomor ini. Kirim kata 'DEMO', kita atur waktu, saya datang atau via WA — 15 menit, konkret, saya jalankan Anda melalui alur order Pak Hadi tadi tapi pakai contoh data Anda. Kalau setelah 15 menit Anda merasa 'ini bukan buat saya' — kita sama-sama sudah jelas. Kalau merasa 'ini menarik' — kita lanjut ke detail. Money-back 14 hari selalu ada sebagai safety net. Terima kasih Pak / Bu."

**Design notes:**
- SATU CTA dominan — jangan pecah attention.
- WA number JetBrains Mono agar terbaca jelas + terasa "actionable".
- QR code contrast tinggi (hitam di putih container) — bisa di-scan dari HP dari jarak.
- Wordmark VOSI + umbrella tagline di footer subtle — closing brand identity.

---

## §C. Reference appendix (untuk yang mau tahu detail sebelum bikin)

### C.1 Pricing tier ringkas (dari `docs/business/pricing.md` v3, 2026-06-24)

| Tier | Anchor (2× struck) | 6-month effective | 12-month effective | Setup |
|---|---|---|---|---|
| Starter | ~~Rp 1,199,000/bln~~ | Rp 509,150/bln | Rp 419,300/bln | Rp 1,500,000 |
| **Pro** | ~~Rp 1,899,000/bln~~ | Rp 806,650/bln | **Rp 664,300/bln** | Rp 1,500,000 |
| Premium | ~~Rp 7,599,000/bln~~ | Rp 3,229,150/bln | Rp 2,659,300/bln | Rp 3,500,000 |

**Terms:** Bayar upfront (6 bulan atau 12 bulan). Money-back 14 hari kalau tenant inactive < 30 hari. Founding rate lifetime lock 24 bulan minimum untuk 100 tenant pertama.

### C.2 Objection FAQ (dipakai untuk Q&A live pitch — tidak masuk deck tapi wajib hafal presenter)

| Objection | Counter |
|---|---|
| "Pro 807K/bln mahal." | 1 quote deal @ margin Rp 1jt = balik dalam 1 bulan. 6 bulan = balik dari 1 customer baru. Anda kirim berapa quote sebulan? |
| "Komit 6 bulan berat." | Money-back 14 hari kalau inactive. Praktis komitmen Anda 14 hari evaluation. |
| "Premium Rp 2,659K/bln gak kuat." | Pro Rp 664K dulu — semua ERP kecuali Calista lengkap. Upgrade Premium nanti kalau chat 100+/hari. |
| "Lebih murah Kledo Rp 50K/bln." | Kledo = accounting only. Tidak Penawaran, tidak multi-gudang, tidak approval workflow. Apel vs jeruk. |
| "Setup fee mahal." | Setup covers CSV import + training. Manual import 800 SKU = 3 minggu × admin = berkali-kali lipat cost. |
| "Staff gak ngerti komputer." | Designed untuk admin counter — semudah WhatsApp. Onboard 3 hari kerja. |
| "Sudah coba Jurnal, ribet." | Jurnal = akuntansi. VOSI = operasional + akuntansi (Pro+). Satu sistem, beda goal. |
| "Belum siap ganti sistem total." | Mulai Starter 6mo Rp 509K/bln. Buku nota tetap jalan paralel. Money-back 14 hari. |
| "Data banyak, repot import." | Setup fee include CSV import — tim VOSI bantu. Customer + SKU up dalam 1 hari. |
| "Internet mati gimana?" | Cache lokal browser, sync saat online. Mode offline draft dalam rencana Q3. |
| "Apa beda Calista vs Mekari Kontak?" | Mekari Kontak = chatbot, butuh staff approve tiap balasan. Calista = agent end-to-end (baca konteks, kasih harga, bikin nota). Handover ke staff cuma kalau kompleks. Plus Kontak butuh Jurnal subscription on top = Rp 3.5jt+ untuk stack less integrated. |

### C.3 Feature matrix per tier (untuk konfirmasi ke prospek yang tanya detail)

**Core (semua tier):**
Auth + multi-user, Dashboard, Produk (foto opsional), Pelanggan mandatory, Kasir POS (multi-payment + struk PDF + Diskon), Penjualan basic + Faktur PDF, Pembelian basic (PO + Tagihan PI + Pembayaran + BNL), Stok 1 gudang, Piutang basic + TEMPO, Retur Penjualan, Rekonsiliasi bank basic, KasBank (BANK/KAS/E_WALLET), Sales channels (14), Laporan dasar, Pengaturan + Notification.

**Pro add-ons (Pro + Premium; Starter TIDAK dapat):**
Sales Order Penawaran → Invoice flow, Multi-warehouse (Pro 5 · Premium 10), Multi-user roles, Approval Inbox + Owner PIN, GL / Neraca / Arus Kas, Tax reports (PPN OK · PPh partial), Executive dashboard, Pengawasan dashboard ⚠ partial, Opname + Adjustment + Audit trail, Rakit / Assembly, Piutang advanced + Tulis-off, Initial Stock Approval, Owner Biaya Final Inbox, Barcode scanning ⚠ partial, Diskon wizard advanced.

**Premium exclusive:**
Calista AI for Ordering ⚠ shadow mode ramp, WhatsApp pair (pair-code + QR), Calista capacity 300 conv/hari (hard cap), Calista persona tuning (manual setup-time), Shadow mode 2-week ramp, Multi-user cap 25, SKU cap 50K.

**⚠ Partial disclosure:** Barcode hardware-integration belum lengkap semua brand printer/scanner. Pengawasan dashboard executive ada, dedicated real-time-staff-monitoring view belum. Calista frontend auto-reply masih shadow (staff approve tiap jawaban dulu selama 2 minggu). Semua ini di-disclose secara jujur ke prospek — bukan sales gimmick.

### C.4 Competitor pricing anchor (untuk kalau prospek tanya detail vs)

| Kompetitor | Harga | Catatan |
|---|---|---|
| Mekari Jurnal Pro | Rp 399,000/mo quarterly | Accounting-first, add-on stok/kasir terpisah. Bundled total ≈ VOSI Starter. |
| Mekari Jurnal Enterprise | Rp 1,499,000/mo+ | ≈ 2.3× VOSI Pro 12mo. Fitur comparable tapi bukan distributor-focused. |
| Mekari Kontak (WA AI) | Rp 2,000,000+/mo base + per-message | Chatbot, butuh Jurnal subscription juga. Total Rp 3.5M+ untuk less integrated. |
| Accurate | Rp 18M setup + subs | Enterprise-grade, terlalu berat untuk 5-15 staff. |
| Kledo | Rp 50–199K/mo | Solo/kecil. Tidak multi-gudang, tidak multi-user role. |
| Desty | IDR 5-7M deposit + per-order | Marketplace-focused. Model harga beda (pay-per-order vs flat). |

### C.5 Yang JANGAN dibicarakan di deck / pitch (WAJIB dihindari)

1. **Nama entitas Garindo / Garindo Jaya Panel.** VOSI dibangun awalnya untuk Garindo (tenant #1 legacy) — TAPI tidak di-disclose ke prospek karena founder juga owner Garindo, dan prospek kompetitor tidak akan mau pakai software kompetitor. Founder story tetap dipakai (slide 13), tapi frame "saya owner distributor 12 tahun" — tanpa nama.
2. **Fitur yang belum shipped**: Multi-Tier Pricing per-customer (Eceran + Grosir), Multi-Tenant SaaS subdomain, Tukar Faktur, Premium Plus (1000+ conv/hari). Ini di roadmap tapi jangan janjikan.
3. **Angka riset formal** yang tidak punya sumber. Contoh: "80% quote hilang" — sudah di-footnote sebagai *observasi*. Aman. Tapi jangan bilang "Menurut riset McKinsey, 80% distributor..." — bohong, resiko reputasi.
4. **Klaim "gratis trial 14 hari"** — VOSI bukan free trial, ini money-back guarantee POST-purchase. Bahasa harus jelas beda: "Uang balik penuh dalam 14 hari kalau Anda merasa tidak cocok" — BUKAN "trial gratis 14 hari".
5. **Jargon SaaS**: "workflow", "synergy", "one-stop", "ekosistem", "platform terintegrasi", "solusi holistik". Kata-kata dead.

### C.6 Post-pitch follow-up template (kirim ke WA setelah demo)

```
Terima kasih waktunya Pak / Bu.

Saya lampirkan:
• Ringkasan yang tadi kita bahas (PDF deck)
• Contoh Penawaran + Invoice PDF format VOSI
• Link demo tenant — Anda bisa coba sendiri: [link]

Untuk lanjut, 2 opsi:
1. Saya kirim proposal + kontrak Pro 12-bulan (Rp 664K/bln). PROMO 50% off + founding tenant rate lock 24 bulan.
2. Kita jadwal kunjungan on-site — saya walk-through data Anda ke VOSI langsung.

Balas chat ini untuk pilihan Anda.

— [Nama]
VOSI · Wujudkan Visi Bisnismu
```

---

## §D. Instructions untuk Claude PPT builder (paste ini sebagai first message)

> "Kamu adalah desainer presentasi profesional. Baca knowledge doc terlampir sampai selesai.
>
> **Task:** Bikin file PowerPoint (.pptx) 14 slide sesuai Section B — verbatim.
>
> **Aturan render:**
> 1. Aspect ratio 16:9 (1920×1080 atau 13.333×7.5 inches).
> 2. Warna: Navy `#0B2545`, Gold `#F9B233`, Cream `#FAF7F0` sesuai §A.1. Ikuti 60/30/10 rule.
> 3. Font: Plus Jakarta Sans (heading + body), JetBrains Mono (label + angka + harga). Fallback: Inter atau Nunito Sans.
> 4. Setiap slide harus **visual-dominant** (visual 60-70% area, text 30-40%).
> 5. Body text pakai bahasa VERBATIM dari 'Body text (verbatim ID)' setiap slide. Jangan parafrase.
> 6. Speaker notes copy paste ke slide notes (bukan ke body slide).
> 7. Icon pakai style flat outline stroke 1.8px round cap. Rekomendasi library: Lucide, Feather Icons, atau Heroicons outline.
> 8. Jangan pakai stock photo generic. Kalau visual butuh 'foto', bikin sebagai illustration/mockup style.
> 9. Untuk mockup WhatsApp chat (slide 2 dan 9), bikin realistic — warna asli WA, timestamp, avatar generic.
> 10. Layout template ikuti §A.4 kode (T1-T6).
>
> **Deliverable:** file .pptx yang siap download. Sekali render, konfirmasi jumlah slide dan minta feedback per slide sebelum revisi.
>
> **KRITIS:** Jangan tambah slide di luar 14 yang dispesifikasi. Jangan hilangkan slide. Jangan reorder. Kalau ada info yang Anda rasa perlu diklarifikasi, tanyakan SEBELUM render, bukan setelah."

---

## §E. Version & maintenance

- **v1.0** (2026-07-05) — Initial knowledge doc. Locked untuk campaign Q3 2026 distributor B2B Glodok.
- **Update trigger:** kalau pricing berubah (`docs/business/pricing.md` version bump), sync §C.1. Kalau modul baru shipped yang relevan untuk deck (misal Calista frontend keluar shadow mode), update §7 atau §9 slide spec.
- **Owner doc:** Founder (Tony). Approval untuk perubahan struktur (jumlah slide, urutan narasi).
- **Companion docs (tidak perlu di-attach ke Claude PPT — sudah embed di sini):**
  - `docs/marketing/vosi-context-pack-2026-06-24.md` (marketing pack sumber)
  - `docs/business/pricing.md` v3 (pricing single-source-of-truth)
  - `docs/VOSI-Design-System.md` v1.0 (brand tokens)

---

*End of knowledge doc. ~1400 lines. Self-contained. Siap handoff ke Claude PPT builder atau tool AI slide generator lain.*
