# Vosi Landing Page — Design Spec

**Date:** 2026-06-04  
**Status:** Approved  
**Scope:** Standalone marketing website for Vosi — terpisah dari aplikasi ERP

---

## 1. Product Overview

**Vosi** adalah platform AI WhatsApp + ERP untuk MSME Indonesia.  
Tagline: *"Wujudkan Visi Bisnismu"*

Landing page ini adalah satu-satunya touchpoint marketing Vosi di Year 1. Tujuannya: mengubah pemilik bisnis MSME yang belum kenal Vosi menjadi lead yang mau konsultasi — bukan langsung beli.

**Target pengguna landing page:** Pemilik bisnis MSME Indonesia (toko, salon, bengkel, kuliner, klinik, jasa) yang aktif pakai WhatsApp untuk terima order.

---

## 2. Architecture & Deployment

- **Standalone website** — bukan bagian dari aplikasi ERP di `ERPAntigravity`
- Tech stack rekomendasi: React + Vite + Tailwind CSS (sama dengan ERP app) atau Next.js untuk SEO
- Deploy: domain terpisah, misalnya `vosi.id` atau `getvosi.com`
- Tidak ada backend di landing page ini — form konsultasi mengirim ke WhatsApp atau integrasi form sederhana (Typeform / Google Forms)

---

## 3. Design System

Mengikuti design system yang sudah ada di aplikasi ERP:

| Token | Value |
|---|---|
| Font | Inter (Google Fonts) |
| Primary navy | `#1e3d60` |
| Primary green | `#2d8a4e` |
| Dark text | `#0b1c30` |
| Muted text | `#64748b` |
| Background | `#fff` (dominant), `#f8fafc` (alt sections) |
| Card radius | `24px` |
| Button radius | `9999px` (pill) |
| Card shadow | `0 2px 4px rgba(0,0,0,0.02), 0 20px 48px rgba(11,28,48,0.09)` |

**Background philosophy:** White/light dominant. Navy hanya untuk dark cards (timeline, final CTA, form). Tidak full dark navy agar terasa elegan, clean, dan modern — bukan enterprise yang berat.

---

## 4. Page Structure (Single Page)

Urutan section dari atas ke bawah:

```
Nav (sticky)
├── Hero
├── Trust Strip
├── Social Proof
├── Bukan Chatbot Biasa (Comparison)
├── Use Cases
├── Manfaat + Setup Timeline
├── Konsultasi (form CTA)
├── FAQ
├── Final CTA
└── Footer
```

### 4.1 Nav

- Sticky, blur backdrop (`rgba(255,255,255,0.92)` + `backdrop-filter: blur(20px)`)
- Logo: wordmark "Vosi" + logomark (navy+green gradient, ikon petir SVG)
- Anchor links: Keunggulan · Use Cases · Cara Kerja · Konsultasi
- CTA button: "Jadwalkan Konsultasi Gratis" → scroll ke `#konsultasi`

### 4.2 Hero

- Background: radial gradient hijau+navy sangat subtle di atas putih
- Badge pill: "AI WhatsApp untuk Bisnis Indonesia" (green border + pulse dot)
- H1: **"Setiap Chat Jadi Peluang. Bukan Beban."** — `font-size: 54px, font-weight: 900`
- Sub: 1 kalimat proposi value, max 480px width
- CTA row: primary button "Jadwalkan Konsultasi Gratis" + ghost button "Lihat Cara Kerjanya"
- Micro copy: ✓ Konsultasi 30 menit · ✓ Gratis · ✓ Tanpa komitmen
- Visual: 2-column card grid
  - **Kiri (wider):** WhatsApp chat card dengan animasi slide-up fade (loop, 4 messages, lihat §6)
  - **Kanan:** Dashboard stats card (bar chart + 4 stat rows: order masuk, dibalas otomatis, omzet, stok)

### 4.3 Social Proof

- Posisi: setelah trust strip, sebelum comparison section
- Container `#f8fafc` dengan badge "Beta Program · Terbatas"
- 3 stats: 3+ bisnis aktif · 98% chat terbalas otomatis · <5 detik rata-rata respon
- 3 testimonial card: avatar inisial berwarna, nama, jenis bisnis + kota, quote
  - Budi S. — Toko Material Bangunan · Jakarta
  - Rina A. — Salon Kecantikan · Surabaya
  - Hendra W. — Online Seller · Bandung
- **Placeholder** — ganti nama, bisnis, dan quote dengan beta client asli sebelum launch

### 4.4 Trust Strip

- Pill horizontal: 4 item dengan green checkmark circle
- "Aktif dalam 3 hari kerja" · "Tidak perlu karyawan extra" · "Balas customer 24 jam" · "Stok update otomatis"

### 4.4 Bukan Chatbot Biasa (Comparison)

- Section ID: `#chatbot` (nav link "Keunggulan")
- 2-column grid: **Chatbot Biasa** (merah, statis) vs **Vosi AI** (hijau, animasi)
- Chatbot Biasa card: statis, menunjukkan alur menu kaku yang gagal tangani pertanyaan diskon
- Vosi AI card: **slide-up fade animation** dipicu IntersectionObserver saat section masuk viewport (lihat §6), 6 messages, loop
- Callout bar di bawah: navy, "Vosi membaca konteks, bukan sekadar menu" + CTA button

### 4.5 Use Cases

- Section ID: `#use-cases`
- 3-column grid, 6 cards
- Toko & Distributor (tag: "Paling Populer") · Salon & Kecantikan · Bengkel & Servis · Kuliner & Catering · Klinik & Apotek (tag: "Baru") · Jasa & Kontraktor
- Setiap card: emoji icon, nama industri, deskripsi 1 kalimat, 3 feature bullets dengan green dot
- Hover: lift + green border

### 4.6 Manfaat + Setup Timeline

- Section ID: `#manfaat`, timeline inner ID: `#cara-kerja`
- 4 benefit cards (4-column): Balas Otomatis 24 Jam · Stok Update Otomatis · Invoice ke WA · Laporan Bisnis
  - Setiap card punya colored top border (green/navy/amber/purple) dan stat badge
- Timeline: dark navy card, 4-step horizontal: Konsultasi (Hari 1) → Setup & Config (Hari 2) → Testing Bersama (Hari 3) → Go Live ✓
- **Durasi jujur: 3 hari kerja** (bukan 1 hari)

### 4.7 Konsultasi

- Section ID: `#konsultasi`
- **Tidak ada harga yang ditampilkan** — harga dibahas di konsultasi (high-touch model)
- 2-column layout:
  - **Kiri (white card):** "Apa yang kamu dapat di konsultasi" — 4 item: Analisa kebutuhan · Demo Vosi di WA · Rencana implementasi · Jawaban pertanyaan
  - **Kanan (navy gradient card):** Form — nama, nama bisnis, nomor WA, dropdown jenis bisnis (7 opsi) + submit button + kontak WA langsung
- Trust row: ✓ Tidak ada paksaan · ✓ Harga disesuaikan · ✓ Respons 1×24 jam

### 4.8 Final CTA

- Dark navy block (margin kiri-kanan 72px, border-radius 28px)
- "Bisnis Kamu Layak Punya *Asisten AI*." — italic green highlight
- Sub: "Ribuan customer menunggu dibalas. Vosi bisa mulai bekerja untuk kamu dalam 3 hari."
- Button: "Jadwalkan Konsultasi Sekarang →"

### 4.8b FAQ

- Posisi: antara Konsultasi dan Final CTA, background `#f8fafc`
- Accordion: satu item terbuka pada satu waktu, toggle dengan JS
- 6 pertanyaan:
  1. Apakah perlu ganti nomor WA? → Tidak, Vosi pakai nomor yang sudah ada
  2. Kalau internet mati? → Vosi jalan di server kami, bukan di HP kamu. Jika gangguan, kami notifikasi
  3. Data customer aman? → Hanya bisa diakses pemilik bisnis, tidak dijual, disimpan terenkripsi *(tidak klaim "server Indonesia" — lokasi belum fix)*
  4. Bisa pakai WA biasa? → Bisa, WA Business direkomendasikan tapi tidak wajib
  5. Kalau bot salah jawab? → Bot minta maaf dan tawarkan diteruskan manual. **Dashboard takeover tersedia** (fitur confirmed ada di ERP)
  6. Berapa lama setup? → 3 hari kerja

### 4.9 Footer

- Logo + copyright + 3 links: Kebijakan Privasi · Syarat & Ketentuan · Kontak

---

## 5. Pricing Strategy

**Tidak ditampilkan di landing page.** Alasan:
- Model high-touch: semua deal terjadi via konsultasi, bukan self-serve
- Masih dalam fase validasi harga per segmen bisnis
- Menghindari price shock sebelum value dipahami

**Internal baseline (tidak publik):**
- ~IDR 200K/bulan per nomor WhatsApp
- Margin tinggi karena pakai Meta Cloud API langsung (bukan BSP) → service messages GRATIS sejak Juli 2025
- Hanya marketing template blast yang berbayar (~IDR 597/pesan)

---

## 6. Chat Animation Spec

Digunakan di dua tempat: Hero WA card dan Comparison Vosi AI card.

**Teknik:** Slide-up fade (Option B yang dipilih)
- Initial state: `opacity: 0; transform: translateY(14px)`
- Reveal: `opacity: 1; transform: translateY(0)` dengan transition `420ms cubic-bezier(.22,.68,0,1.15)`
- Reset: disable transition → remove `.visible` → force reflow (`getBoundingClientRect()`) → re-enable transition
- Ini memastikan reset instan tanpa konflik animasi balik

**Hero chat (4 messages):**
- Trigger: `DOMContentLoaded`, loop terus
- Delays: 400ms · 1300ms · 2300ms · 3300ms
- Pause setelah pesan terakhir: 2800ms

**Comparison Vosi AI (6 messages):**
- Trigger: `IntersectionObserver` (threshold 0.2) pada section `#chatbot` — mulai saat scroll masuk viewport
- Delays: 200ms · 900ms · 1700ms · 2400ms · 3400ms · 4100ms
- Pause setelah pesan terakhir: 2600ms

---

## 7. Go-to-Market Strategy

**Fase 1 (sekarang): High-touch**
- Semua leads dari landing page dikerjakan manual — telepon/WA langsung
- Onboarding personal oleh tim Vosi
- Target: 5–10 MSME pertama untuk validasi product-market fit

**Fase 2 (Year 2): Self-serve**
- Tambah pricing page dan flow signup mandiri
- Expand ke omnichannel: Instagram, marketplace
- Expand fitur: CRM, Smart Appointment, Call Center, Customer Care

**Channels awal:**
- WhatsApp broadcast ke network pribadi
- Instagram organic
- Referral dari client pertama

---

## 8. Lead Flow (CTA)

Semua CTA — nav button, tombol hero, form submit, final CTA — mengarah ke **WhatsApp redirect**.

**Flow:**
1. Customer isi form (nama, nama bisnis, nomor WA, jenis bisnis) → klik submit
2. JavaScript validasi semua field terisi
3. Build pesan WA pre-filled:
   ```
   Halo Vosi! Saya ingin jadwalkan konsultasi gratis 🙏

   Nama: [nama]
   Bisnis: [nama bisnis]
   WA saya: [nomor WA]
   Jenis bisnis: [jenis bisnis]
   ```
4. Buka `https://wa.me/62812XXXXXXXX?text=...` di tab baru

**Alasan pilih WA redirect:** Zero backend, friction rendah untuk market Indonesia, context customer langsung tersedia saat pemilik bisnis balas.

**Nav/hero/final CTA buttons:** Scroll ke `#konsultasi` (bukan langsung buka WA) agar customer isi form dulu sehingga ada context bisnis di pesan WA.

## 9. Mobile Responsiveness

Breakpoint `max-width: 768px`:
- Nav: sembunyikan `.nav-links`, tampilkan logo + CTA saja
- Hero: single column, `h1` font-size 36px, CTA stack vertikal, sembunyikan dashboard card (tampilkan chat card saja)
- Social proof: single column testimonial
- Comparison: single column (bad chatbot di atas, Vosi di bawah)
- Use cases: 2 kolom → 1 kolom di 480px
- Benefits: 2 kolom → 1 kolom di 480px
- Timeline: horizontal → stack vertikal
- Konsultasi: single column
- Final CTA: padding dikurangi, font-size diperkecil
- Footer: stack vertikal, center-aligned

Breakpoint tambahan `max-width: 480px`: use cases dan benefits collapse ke 1 kolom.

## 10. Open Items

- [ ] Nomor WhatsApp Vosi yang aktif (ganti `62812XXXXXXXX` di konstanta `VOSI_WA_NUMBER`)
- [ ] Domain final untuk landing page
- [ ] Keputusan tech stack: Next.js (SEO lebih baik) vs React+Vite (lebih cepat implement)

---

## 9. Prototype

HTML mockup lengkap tersimpan di:
`.superpowers/brainstorm/19476-1780503711/content/landing-final.html`

Jalankan brainstorm server untuk preview:
```bash
# Server sudah berjalan di http://localhost:59619
# atau restart dengan:
scripts/start-server.sh --project-dir /path/to/ERPAntigravity
```
