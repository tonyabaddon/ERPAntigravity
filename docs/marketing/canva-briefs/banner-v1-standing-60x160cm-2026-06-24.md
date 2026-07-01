# Canva Brief — Standing Banner V1 (Primary)

**Asset:** X-banner / Roll-up Banner — VOSI Pro tier hero
**Audience:** Walk-by traffic LTC Glodok lt.3 + similar sentra perdagangan events
**Slogan basis:** Pack §6 #5 — "Stok jelas. Tagihan ketagih. Quote ke-deal."
**Companion:** `docs/marketing/vosi-context-pack-2026-06-24.md` §9 Variant V1
**Date:** 2026-06-24

---

## 1. Dimensi + Print spec

| Spec | Value |
|------|-------|
| Ukuran | **60 cm × 160 cm portrait** (3:8 ratio) |
| Canva setup | Custom Size → 60 cm × 160 cm |
| Resolution | **300 DPI** (premium X-banner) atau 150 DPI minimum (roll-up murah) |
| Bleed | **3 mm all sides** — Canva → File → Show Print Bleed |
| Color mode | Design RGB di Canva. Saat download PDF Print → Canva auto-convert ke CMYK (centang "PDF Print" + "CMYK" jika Canva Premium tersedia) |
| File output | **PDF Print** (kasih ke printer offline) |
| Print partner | Percetakan Pasar Pagi / Mangga Dua — minta "X-banner 60×160 cm dengan stand frame" |

---

## 2. Color palette — Direction A "Toko Modern"

Sumber: pack §8.

| Token | Hex | Penggunaan |
|-------|-----|-----------|
| **Primary navy** | `#0B2545` | Background bottom CTA zone, text di atas cream/white, logo |
| **Accent kuning** | `#F9B233` | Promo badge background, accent garis, highlight pricing |
| **BG cream** | `#FAF7F0` | Background mayoritas banner (top 80%) |
| **White** | `#FFFFFF` | Text di atas navy (CTA + promo badge optional) |
| **Slate-700** | `#334155` | Body text di atas cream (lebih lembut dari pure black) |

**Brand kit Canva:** Buat folder Brand Kit baru "VOSI" → input 4 warna di atas. Akan auto-suggest setiap design selanjutnya.

---

## 3. Typography

**Font family:** **Inter** (gratis di Canva, pilih "Inter" — dropdown).

Fallback kalau Inter tidak ada: **Plus Jakarta Sans** atau **Manrope**.

| Element | Font weight | Size (pt) | Line height |
|---------|--------------|-----------|--------------|
| Slogan hero (3 baris) | **Black 900** | **150 pt** | 1.05 |
| Sub-line (1 baris) | Regular 400 | 32 pt | 1.3 |
| Section label ("ERP Distributor B2B") | Medium 500 | 24 pt | 1.2 |
| Promo badge | Bold 700 | 22 pt | 1.1 |
| Proof bullets (4 baris) | Semibold 600 | 36 pt | 1.4 |
| Pricing teaser "Pro Rp 664K/bulan 12-month" | Bold 700 | 40 pt | 1.2 |
| Anchor struck-through "~~Rp 1,899K~~" | Regular 400 | 24 pt | 1.2 |
| CTA "DEMO GRATIS 15 MENIT" | Black 900 | 56 pt | 1.1 |
| WA number "0812-XXXX-XXXX" | Bold 700 | 44 pt | 1.2 |

---

## 4. Layout zones — proportional dari atas ke bawah

Banner 60×160 cm = 1600 cm² area. Bagi vertikal dalam 4 zone:

```
┌────────────────────────────────────┐ 0% top
│  ZONE A — IDENTITY (0-25% = 40 cm) │
│  cream BG, navy text                │
│                                     │
│  [LOGO VOSI]   ERP Distributor B2B  │
│                                     │
│  [PROMO BADGE kuning di kanan atas] │
├────────────────────────────────────┤ 25%
│  ZONE B — HERO (25-55% = 48 cm)    │
│  cream BG, navy text                │
│                                     │
│  STOK JELAS.                       │
│  TAGIHAN KETAGIH.                  │
│  QUOTE KE-DEAL.                    │
│                                     │
│  Sub-line di bawah hero            │
├────────────────────────────────────┤ 55%
│  ZONE C — PROOF (55-78% = 37 cm)   │
│  cream BG, navy text + kuning      │
│                                     │
│  ✓ Quote WA → Nota otomatis        │
│  ✓ Stok real-time per gudang       │
│  ✓ Tagihan TEMPO auto-track        │
│  ✓ Owner approve dari HP           │
├────────────────────────────────────┤ 78%
│  ZONE D — CTA (78-100% = 35 cm)   │
│  NAVY BG, WHITE + KUNING text      │
│                                     │
│  Pricing teaser + struck-through   │
│                                     │
│  DEMO GRATIS 15 MENIT              │
│  WA 0812-XXXX-XXXX  [QR CODE]      │
└────────────────────────────────────┘ 100%
```

---

## 5. Element-by-element spec

### Zone A — Identity (top 25%, BG cream `#FAF7F0`)

| Element | Posisi | Konten | Font / Size | Color |
|---------|--------|--------|--------------|-------|
| VOSI logo wordmark | Left, top-center vertically (y = 8% dari top) | **VOSI** | Inter Black 900, 96 pt | `#0B2545` navy |
| Category label | Right of logo, same baseline | ERP Distributor B2B | Inter Medium 500, 24 pt | `#334155` slate |
| **Promo badge pill** | Top-right corner (margin 30mm dari edge) | `PROMO LAUNCH 50% OFF · 100 Tenant Pertama` (2 baris kalau pendek) | Inter Bold 700, 22 pt | Background `#F9B233`, text `#0B2545` navy, border-radius 999px (pill), padding 16px × 8px |

**Logo execution tip:** Kalau belum ada file logo, **type "VOSI" pakai Inter Black 900 96pt navy** sebagai placeholder wordmark. Tambahkan accent: huruf "O" diganti circle outline 8pt navy. Cukup untuk M1; design proper logo bisa di month 2.

### Zone B — Hero (25-55%, BG cream)

| Element | Posisi | Konten | Font / Size | Color |
|---------|--------|--------|--------------|-------|
| Slogan baris 1 | Center horizontal, top of zone | **STOK JELAS.** | Inter Black 900, 150 pt | `#0B2545` |
| Slogan baris 2 | Center, below baris 1 (line-height 1.05) | **TAGIHAN KETAGIH.** | Inter Black 900, 150 pt | `#0B2545` |
| Slogan baris 3 | Center, below baris 2 | **QUOTE KE-DEAL.** | Inter Black 900, 150 pt | `#F9B233` accent kuning (titik di akhir tetap navy) |
| Sub-line | Center, below hero, margin-top 30mm | Sistem untuk toko panel, alat listrik & CCTV — dipakai 5 staff Anda setiap hari. | Inter Regular 400, 32 pt | `#334155` |

**Kunci visual:** baris ke-3 "QUOTE KE-DEAL." pakai aksen kuning untuk pull-out — bikin slogan punya rhythm.

### Zone C — Proof (55-78%, BG cream)

| Element | Posisi | Konten | Font / Size | Color |
|---------|--------|--------|--------------|-------|
| Checkmark icon (×4) | Left-align per row | ✓ (Material Symbol "check_circle" filled atau "✓" character) | Size 44 pt | `#F9B233` accent kuning |
| Bullet 1 | Right of checkmark, baseline-align | Quote WA → Nota otomatis | Inter Semibold 600, 36 pt | `#0B2545` |
| Bullet 2 | Below bullet 1, same alignment | Stok real-time per gudang | sama | sama |
| Bullet 3 | Below bullet 2 | Tagihan TEMPO auto-track | sama | sama |
| Bullet 4 | Below bullet 3 | Owner approve dari HP | sama | sama |

Vertical spacing antar bullet: line-height 1.4 + extra padding 12mm.

### Zone D — CTA (78-100%, BG navy `#0B2545`)

| Element | Posisi | Konten | Font / Size | Color |
|---------|--------|--------|--------------|-------|
| Pricing line | Top of CTA zone, center | **Pro Rp 664K/bulan 12-month** · ~~Rp 1,899K~~ | "Pro Rp 664K..." Inter Bold 700, 40 pt; struck-through Inter Regular 400, 24 pt | Text `#F9B233` accent kuning; struck-through `#94A3B8` slate-400 muted |
| CTA line | Below pricing | **DEMO GRATIS 15 MENIT** | Inter Black 900, 56 pt | `#FFFFFF` |
| WA number | Below CTA | WA **0812-XXXX-XXXX** | Inter Bold 700, 44 pt | `#FFFFFF` |
| QR code | Right side of WA number, sejajar | QR code image | Size **80 × 80 mm** | Background `#FFFFFF`, foreground `#0B2545` |

**QR code generation:** Canva built-in tool — Apps → "QR Code" → input URL `https://wa.me/62812XXXXXXXX?text=DEMO%20VOSI` (ganti nomor real Anda). Pilih color: foreground navy, background white. Download dari widget atau langsung embed.

---

## 6. Asset requirements (gather before Canva session)

| Asset | Status | Source |
|-------|--------|--------|
| Logo VOSI (vector SVG/PNG) | Pending | Pakai wordmark Inter Black sebagai placeholder kalau belum ada |
| WA number aktual | Pending | Owner provide (bukan placeholder 0812-XXXX) |
| QR code | Generate di Canva | Apps → QR Code → input WA URL |
| Photo (optional) | Optional | Foto toko Glodok Anda sendiri, atau Unsplash search "Indonesian shop owner" — letakkan jadi watermark transparency 10% di Zone C kalau mau extra feel |

---

## 7. Canva execution checklist

1. **Buka Canva → Create design → Custom Size** → 60 × 160 cm
2. **Aktifkan bleed:** File → Show print bleed & marks
3. **Set Brand Kit:** Brand → New Brand Kit → input 4 colors (§2), 1 font (Inter)
4. **Layout zones:** Add rectangle background:
   - 1 rectangle cream `#FAF7F0` covering 0-78% (top portion)
   - 1 rectangle navy `#0B2545` covering 78-100% (bottom CTA portion)
5. **Add Zone A elements** (logo + label + promo pill) per spec §5
6. **Add Zone B hero** (3 baris slogan + sub) — pakai Inter Black 900 150pt
7. **Add Zone C bullets** dengan check icon kuning
8. **Add Zone D CTA** (pricing + DEMO + WA + QR)
9. **Review proportions** — print preview di Canva (Ctrl+P preview)
10. **Download:** File → Download → **PDF Print** + checkmark "CMYK" (kalau tersedia) + checkmark "Crop marks and bleed"
11. **Kirim ke printer:** kasih PDF file, sebutkan "X-banner 60×160 cm dengan stand frame X-bracket"

---

## 8. Canva template search keywords (kalau mau start dari template, bukan blank)

Search di Canva:
- `"roll up banner Indonesia portrait"` — Indonesian-language X-banner templates
- `"X-banner 60x160 promosi"` — sesuai dimensi
- `"banner pameran event"` — exhibition-style layouts
- `"banner ERP IT services"` — relevant business category

**Avoid:** templates yang terlalu "promo diskon warna-warni" (warung mart style) — kita mau professional B2B feel. Direction A "Toko Modern" balance.

---

## 9. QA checklist sebelum print

- [ ] Hero slogan readable dari **jarak 3 meter** (test: zoom Canva 25%, masih kebaca?)
- [ ] WA number TIDAK pakai placeholder `0812-XXXX-XXXX` — masukkan nomor real
- [ ] QR code scannable (test scan di HP Anda sebelum print)
- [ ] Promo badge tidak terlalu kecil — minimum 14×4 cm physical (≈ 26pt+ text)
- [ ] Bleed 3mm aktif (cek crop marks visible di download preview)
- [ ] Color "#F9B233" kuning tidak terlalu mencolok di print final — minta proof print dulu kalau bisa
- [ ] Logo + WA + QR semua di bottom-third (zone Anda mau orang lihat pas eye-level scan)
- [ ] File output: PDF Print, max 50 MB

---

## 10. Print partner recommendation

LTC Glodok area printers:
- **Percetakan Pasar Pagi** — Sentra cetak besar, harga competitive untuk X-banner
- **Pojok Cetak Mangga Dua** — Cepat, 1-day turnaround
- Estimasi cost: **Rp 80-150 ribu per X-banner 60×160 cm + bracket stand** (rate Jakarta 2026)

Kalau Anda butuh 2 banner (V1 + V2 di event sama), minta diskon volume — biasanya printer kasih 10-15% off untuk min 2 banner.

---

*Brief ini reusable untuk variant V2 (slogan #3) dan V3 (Calista AI) — copy file ini ke `banner-v2-...md` dan `banner-v3-...md`, ganti slogan + pricing teaser per pack §9.*
