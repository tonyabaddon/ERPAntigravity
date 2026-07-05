# VOSI — Design System

**Versi:** 1.0
**Produk:** VOSI — sistem toko terpadu (ERP · POS · Accounting)
**Tagline:** Toko Rapi, Untung Jelas.

Panduan visual & komponen UI/UX untuk seluruh produk dan materi VOSI. Dokumen ini adalah sumber kebenaran (single source of truth) untuk warna, tipografi, komponen, dan nada merek.

---

## 1. Brand

| Aspek | Keterangan |
|---|---|
| **Simbol** | Semut 🐜 — kecil tapi kuat, terorganisir, gotong-royong, tangguh. Cerminan semangat UMKM. |
| **Nama** | VOSI (wordmark, huruf besar, bold). |
| **Tagline** | "Toko Rapi, Untung Jelas." — dipakai konsisten di logo, banner, sosial. |
| **Misi** | Membantu UMKM naik kelas lewat teknologi 360° yang gampang dipakai. |
| **Segmen** | Toko, distributor, dan pabrik. |

### Nada bicara (tone of voice)
- **Akrab & membumi** — bahasa Indonesia sehari-hari ("juragan", "toko kamu").
- **Meyakinkan, tidak menggurui** — fokus ke manfaat nyata.
- **Teknis seperlunya** — istilah seperti POS, stok, laporan, piutang boleh; hindari jargon berlebihan.
- **Ringkas** — kalimat pendek, satu ide per kalimat.

---

## 2. Logo

### Anatomi
Lockup utama = **ikon semut dalam lingkaran** + **wordmark "VOSI"** + tagline opsional.

### Varian
| Varian | Kapan dipakai |
|---|---|
| **Lockup light** | Ikon navy pada lingkaran gold / latar terang. |
| **Lockup dark** | Ikon gold pada lingkaran navy / latar gelap. |
| **App icon** | Lingkaran navy + semut gold. Untuk foto profil, favicon, ikon aplikasi. |
| **Mono** | Satu warna (hitam/putih) untuk cetak terbatas atau watermark. |

### Aturan
- **Clearspace:** sisakan ruang kosong minimal setinggi huruf "V" di semua sisi logo.
- **Ukuran minimum:** ikon tidak lebih kecil dari 24px (digital) agar semut tetap terbaca.
- **Jangan:** memiringkan, meregangkan, mengganti warna di luar palet, menambah bayangan/gradien berlebihan, atau menaruh logo di atas foto ramai tanpa kontras.

---

## 3. Warna

### Inti
| Token | Nama | HEX | Penggunaan |
|---|---|---|---|
| `--navy` | Navy (Primary) | `#0B2545` | Latar utama, teks judul, elemen struktural. |
| `--gold` | Gold (Accent) | `#F9B233` | Sorotan, tombol utama (CTA), ikon, aksen. |

### Netral
| Token | Nama | HEX | Penggunaan |
|---|---|---|---|
| `--cream` | Cream | `#FAF7F0` | Latar terang hangat (kartu, section). |
| `--slate` | Slate | `#5A6472` | Teks isi di latar terang. |
| `--muted` | Muted | `#9DB2CE` | Teks sekunder di latar navy. |
| `--surface` | Surface | `#ECEEF1` | Latar aplikasi / abu netral. |
| `--ink` | Ink | `#14161B` | Teks paling gelap (mono). |

### Fungsional (status)
| Token | Nama | HEX | Penggunaan |
|---|---|---|---|
| `--success` | Success | `#1F8A5B` | Berhasil, untung, stok aman. |
| `--danger` | Danger | `#C0392B` | Gagal, hapus, stok habis. |
| `--info` | Info | `#2A6FDB` | Informasi, edukasi. |
| `--special` | Special | `#7C5CBF` | Story / highlight khusus. |

### Aturan pemakaian
- **60 / 30 / 10** — dominan Navy atau Cream (60%), warna pendukung (30%), Gold hanya sebagai aksen (10%).
- Gold **tidak** untuk blok teks panjang — hanya sorotan & CTA.
- Rasio kontras teks minimal **4.5:1** (WCAG AA). Navy di atas Cream ✓, Gold di atas Navy ✓, hindari Gold di atas putih untuk teks kecil.

---

## 4. Tipografi

| Peran | Font | Bobot | Catatan |
|---|---|---|---|
| **Display / Heading / Body** | Plus Jakarta Sans | 400–800 | Judul 800 dengan `letter-spacing: -0.02em`. Body 500. |
| **Label / Angka / Kode** | JetBrains Mono | 400–700 | Label uppercase dengan `letter-spacing: 0.1em`. Angka & mata uang. |

### Skala tipe (acuan)
| Level | Ukuran (web) | Bobot |
|---|---|---|
| Display | 48–72px | 800 |
| H1 | 34–40px | 800 |
| H2 | 26–30px | 700 |
| Body L | 18–20px | 500 |
| Body | 16px | 500 |
| Label (mono) | 13–15px | 700, uppercase, tracking 0.1em |

**Aturan:** maksimal 2 keluarga font. Jangan campur lebih dari 2 bobot dalam satu blok kecil.

---

## 5. Fondasi (foundations)

| Token | Nilai |
|---|---|
| **Grid dasar** | 4px (semua spasi kelipatan 4). |
| **Spacing skala** | 4, 8, 12, 16, 20, 24, 32, 44, 64px. |
| **Radius** | Kecil 12px · Kartu 18–22px · Pill 100px. |
| **Border** | 1px `#E0E3E8` (terang) · 1px `rgba(255,255,255,0.12)` (di navy). |
| **Shadow kartu** | `0 16px 34px rgba(11,37,69,0.10)`. |
| **Shadow hero** | `0 26px 60px rgba(20,20,30,0.16)`. |
| **Ikon** | Garis (stroke) 1.8px, `stroke-linecap: round`, warna Gold di navy / Navy di terang. |

---

## 6. Komponen UI

### Tombol
| Jenis | Gaya |
|---|---|
| **Primary** | bg Gold `#F9B233`, teks Navy, `font-weight:800`, radius 100px, padding 14×26px. |
| **Secondary** | bg Navy, teks putih, radius 100px. |
| **Ghost** | transparan, border 1.5px `#C9CCD2`, teks Navy. |
| **Success / Danger** | bg `#1F8A5B` / `#FBE9E6` (teks `#C0392B`), radius 12px — untuk aksi form. |

### Badge & Pill
- **Label fitur:** bg Gold, teks Navy, mono uppercase, radius 100px.
- **Status aktif:** teks/latar Success dengan titik hijau.
- **Status bahaya:** teks Danger, latar `#FBE9E6`.

### Input
- Default: border 1.5px `#D3D8E0`, radius 12px, padding 14×16px.
- Fokus: border Gold `#F9B233`.

### Kartu
- **Terang:** bg putih/cream, border `#E0E3E8`, radius 20px, padding 28–32px.
- **Gelap (hero/sorotan):** bg Navy, teks putih, aksen Gold.
- **Kartu statistik:** ikon (chip gold lembut) + label + angka mono besar + delta warna status.

---

## 7. Ikonografi & ilustrasi
- Gaya **line icon** konsisten (stroke 1.8px, sudut membulat).
- Ilustrasi memakai palet inti; boleh spot Gold sebagai fokus.
- Metafora yang dipakai: ember bocor (untung bocor), dashboard bersih (sistem), struk/kalkulator (manual), gudang/kotak (stok).
- Hindari: stok foto generik, gradien norak, drop-shadow tebal.

---

## 8. Aplikasi (do & don't)

**Lakukan**
- Pakai Navy atau Cream sebagai latar dominan; Gold untuk 1 aksi/fokus per layar.
- Angka & mata uang selalu JetBrains Mono.
- Jaga clearspace logo & kontras teks.

**Hindari**
- Gold untuk blok teks panjang.
- Lebih dari satu warna aksen berbeda dalam satu layar.
- Memakai warna di luar token ini.

---

## 9. Ringkasan token (siap dipakai di kode)

```css
:root {
  /* Inti */
  --vosi-navy:    #0B2545;
  --vosi-gold:    #F9B233;

  /* Netral */
  --vosi-cream:   #FAF7F0;
  --vosi-slate:   #5A6472;
  --vosi-muted:   #9DB2CE;
  --vosi-surface: #ECEEF1;
  --vosi-ink:     #14161B;

  /* Fungsional */
  --vosi-success: #1F8A5B;
  --vosi-danger:  #C0392B;
  --vosi-info:    #2A6FDB;
  --vosi-special: #7C5CBF;

  /* Tipografi */
  --vosi-font-sans: 'Plus Jakarta Sans', system-ui, sans-serif;
  --vosi-font-mono: 'JetBrains Mono', monospace;

  /* Radius */
  --vosi-radius-sm:   12px;
  --vosi-radius-card: 20px;
  --vosi-radius-pill: 100px;

  /* Spacing (4px base) */
  --vosi-space-1: 4px;
  --vosi-space-2: 8px;
  --vosi-space-3: 12px;
  --vosi-space-4: 16px;
  --vosi-space-5: 20px;
  --vosi-space-6: 24px;
  --vosi-space-8: 32px;

  /* Shadow */
  --vosi-shadow-card: 0 16px 34px rgba(11,37,69,0.10);
  --vosi-shadow-hero: 0 26px 60px rgba(20,20,30,0.16);
}
```

```json
{
  "color": {
    "core":       { "navy": "#0B2545", "gold": "#F9B233" },
    "neutral":    { "cream": "#FAF7F0", "slate": "#5A6472", "muted": "#9DB2CE", "surface": "#ECEEF1", "ink": "#14161B" },
    "functional": { "success": "#1F8A5B", "danger": "#C0392B", "info": "#2A6FDB", "special": "#7C5CBF" }
  },
  "font": { "sans": "Plus Jakarta Sans", "mono": "JetBrains Mono" },
  "radius": { "sm": 12, "card": 20, "pill": 100 }
}
```

---

*VOSI Design System v1.0 — Toko Rapi, Untung Jelas.*
