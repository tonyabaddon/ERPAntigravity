# VOSI — Marketing Context Pack

**Brand:** VOSI — *"Wujudkan Visi Bisnismu"* (umbrella tagline, lihat §6)
**Target (campaign current):** Distributor B2B Indonesia — alat listrik, panel, CCTV, suku cadang (sentra Glodok / Mangga Dua / ITC)
**Target (umbrella brand):** MSME Indonesia broader (toko, distributor, jasa) — lihat tension note §0
**Use:** Reusable context untuk claude.ai Project. Drop file ini sebagai project knowledge, paste **Project Instructions** dari §12, lalu chat-per-asset.
**Date:** 2026-06-24
**Status:** Foundations V2 locked. Pricing v2 integrated from `docs/business/pricing.md`. Visual + asset copy ready for production handoff (Canva / Gamma).

---

## 0. Strategic tension to resolve (read first)

Ada dua direction yang harus didamaikan sebelum produksi marketing skala besar:

| Source | Target | Tagline | Stance |
|--------|--------|---------|--------|
| `docs/vosi-landing/2026-06-04-vosi-landing-page-design.md` | Broad MSME (toko, salon, bengkel, kuliner, klinik, jasa) | "Wujudkan Visi Bisnismu" | Umbrella brand, no pricing on landing, high-touch |
| `progress.md` 2026-06-24 (latest) | Narrow distributor B2B Glodok | (campaign-specific, e.g. "Stok jelas. Tagihan ketagih. Quote ke-deal.") | Vertical campaign |

**Resolution proposal:**
- **Umbrella brand tagline tetap:** "Wujudkan Visi Bisnismu" — untuk landing page, logo, footer-of-everything.
- **Campaign tagline berbeda per segmen vertical** — distributor B2B pakai "Stok jelas. Tagihan ketagih. Quote ke-deal." Salon, bengkel, dll. ada slogan masing-masing nanti.
- Landing page tetap broad (existing 2026-06-04 spec stands), **tambah sub-page `/distributor`** untuk vertical Glodok yang pakai foundations §1-§7 file ini.

Marketing pack ini dipakai untuk **campaign distributor B2B** (banner Glodok, WA blast ke owner toko panel, pitch deck ke prospect). Bukan untuk landing-page-umum-VOSI.

---

## 1. Positioning

> **VOSI** adalah ERP **khusus distributor B2B** di Indonesia — alat listrik, panel, CCTV, suku cadang. Dari order WhatsApp & buku nota ke satu sistem yang dipakai admin, sales lapangan, dan owner setiap hari. **Bukan accounting software yang dipaksa jadi ERP.**

**Anchor:**
- "Khusus distributor" → bukan generic (Mekari Jurnal terlalu umum, Accurate terlalu enterprise).
- "Bukan accounting yang dipaksa jadi ERP" → kill objection utama upfront: *"Sudah coba Jurnal, ribet"*.

---

## 2. Ideal Customer Profile (ICP)

| Atribut | Detail |
|---------|--------|
| Lokasi | Sentra perdagangan: LTC Glodok, Kenari Mas, ITC, Mangga Dua, Pasar Pagi |
| Produk | Bundle-heavy: alat listrik (MCB, kontaktor, kabel), panel listrik, CCTV (DVR + kamera + adaptor), AC parts, suku cadang elektronik |
| Skala | 1 toko + 1–2 gudang; 5–15 staff; omzet Rp 300jt–3M / bulan |
| Customer | Kontraktor proyek, biro panel, instalateur, toko kecil, retail end-user |
| Order pattern | WA chat → minta quote → bayar transfer / TEMPO 30/60/90 → barang dianter |
| Stack sekarang | Buku nota + Excel + grup WA + (sudah coba Jurnal/Accurate, mundur) |

---

## 3. Persona — "Pak Anton"

Owner toko panel listrik LTC Glodok lantai 3. 45 tahun. 12 tahun bisnis. 8 staff (2 admin counter, 2 sales lapangan, 2 gudang, 1 driver, 1 asisten-anak-dirinya). 800+ SKU. 200+ customer aktif.

**Pains dalam bahasanya:**

> *"Customer minta quote di WA, anak saya tulis tangan, suka lupa di-follow up. Quote yang nge-deal cuma 20%."*

> *"Sales janji harga 800rb. Cost saya 850rb. Untung kepotong — baru ketahuan 2 minggu kemudian."*

> *"Customer proyek tempo 60 hari. Lupa nagih. Baru inget pas customer lain bayar."*

> *"Stok di komputer 50, di gudang ternyata 12. Sales sudah janji ke customer. Customer marah."*

> *"Tutup toko jam 9, rekap manual sampai jam 12 malam. Capek."*

> *"Sudah coba Jurnal — kayak akuntansi banget. Accurate quote 18jt + training. Gak jadi."*
secara 
---

## 4. Value Props (ranked by conversion power)

Setiap claim di-back oleh modul yang **sudah shipped**. Tidak ada janji untuk fitur yang belum ada.

| # | Pain → Promise | Backed by (shipped module) | Tier |
|---|----------------|----------------------------|------|
| 1 | **Quote WA hilang** → Quote → Invoice flow di-track, PDF Penawaran siap kirim balik via WA, conversion rate ke-deal ketahuan | Sales Order (Penawaran) + Daftar Penawaran + `SalesInvoicePDF` quotation variant | Starter+ |
| 2 | **Sales janji barang yang kosong** → Stok real-time per gudang. Sales tahu sebelum janji | Manajemen Gudang + Stock Manager + multi-warehouse + opname dengan audit trail | Starter (1 gudang) / Pro (5 gudang) / Premium (10 gudang) |
| 3 | **Lupa nagih piutang** → TEMPO 30/60/90 auto-listed by jatuh tempo, gak nyangkut | Piutang dashboard + Tagihan + Pembayaran + Rekonsiliasi | Starter+ |
| 4 | **Gak bisa kontrol staff dari jauh** → Staff input, owner approve dari HP via PIN | Approval Inbox + Owner PIN + multi-user role + **Pengawasan** dashboard | Pro+ (Pengawasan + multi-user roles) |
| 5 | **WA = jurang antara order & data** → **Calista AI** baca chat customer, parse pesanan, masuk sistem otomatis. 300 conv/hari per tenant | **Calista AI for Ordering** (Premium-exclusive) + WhatsApp pair-code / QR | **Premium only** |
| 6 | **Owner butuh laporan keuangan, bukan cuma operasional** → GL, Neraca, Arus Kas, Tax reports langsung dari sistem yang sama | GL/Neraca/Arus Kas + Tax reports + executive dashboard | **Pro+ (dari Pro ke atas)** |
| 7 | **Stock take manual berhari-hari** → Barcode scan untuk opname, kasir, dan terima barang | Barcode scanning + opname session | Pro+ |

**Calista AI naming:** Selalu sebut "Calista AI" atau "Calista", bukan "WhatsApp AI generic". Calista adalah persona AI agent yang baca WA customer end-to-end (greeting → tanya stok → kasih harga → bikin nota → handover ke staff kalau kompleks). 300 conv/hari hard cap per tenant. Differentiator: kompetitor (Mekari Kontak, Desty) butuh staff manual menyusun pesan; Calista handle full chain.

**Tidak dipromosikan dulu** (in spec, belum shipped):
- Multi-tier pricing internal Eceran + Grosir per-customer — sedang dikerjakan (jangan bingungkan dengan tier subscription VOSI di §6.5)
- Multi-tenant SaaS (subdomain per tenant) — sedang dikerjakan

---

## 5. Brand Voice

- **Headline = pain, bukan fitur.** "Quote WA lupa di-follow up?" ✓ — "Kelola sales order" ✗
- **Konkret > kategori.** "MCB-mu di gudang berapa?" ✓ — "Kelola stok produk" ✗
- **Spesifik > umum.** Angka, brand competitor, nama produk. Acknowledge alternatif yang sudah dicoba ("Sudah coba Jurnal? Beda — ini operasional, bukan akuntansi").
- **Sopan, gak kaku.** "Anda" / "Pak" / "Bu". Sesekali humor SMB ringan ("Rekap sampai jam 12 malam? Cukup.").
- **Dari pengalaman, bukan brosur.** "Kami paham rasanya stok selisih H-1 Lebaran..." > "Solusi inventory enterprise..."
- **Hindari:** "ERP", "workflow", "synergy", "ekosistem", "platform" — kecuali konteks sangat jelas (mis. positioning statement).

---

## 6. Slogan Bank

| # | Slogan | Use case | Conversion angle |
|---|--------|----------|------------------|
| 1 | **"Quote WA, jadi nota. Tanpa lupa, tanpa ribet."** | WA poster, social caption | Pain #1 dalam bahasa customer |
| 2 | **"ERP distributor — bukan akuntansi yang dipaksa."** | Deck cover, landing hero | Kill Jurnal/Accurate objection upfront |
| 3 | **"Owner pulang jam 6. Sistem yang kerja sampai malam."** | Banner alt, pitch close | Aspiration + pain relief |
| 4 | **"Toko Anda di Glodok. Kontrolnya di HP Anda."** | Hyper-target Glodok banner | Owner-control narrative |
| 5 | **"Stok jelas. Tagihan ketagih. Quote ke-deal."** | **Banner primary** | 3 pain compressed, ritmis, banner-friendly |

**Default picks:**
- Banner standing → **#5**
- WA poster → **#1**
- Deck cover → **#2**

**Umbrella tagline (untuk landing page / brand element):** "Wujudkan Visi Bisnismu" — selalu gunakan bersamaan dengan logo, jangan dipakai sebagai banner-hero.

---

## 6.5. Tier & Pricing (single source: `docs/business/pricing.md` v3 — 2026-06-24)

**Marketing badge wajib di setiap asset yang nyebut harga:**
> "PROMO LAUNCH 50% OFF — Limited First 100 Tenants"

Anchor pricing = struck-through ~~2× list anchor~~ (≈4× 12mo effective). Effective = harga real. Diskon adalah harga, bukan promo yang berakhir.

### Tabel tier — **v3 (Quarterly dropped, 6mo + 12mo only)**

| Tier | Marketing anchor (struck-through 2×) | **6 bulan (15% off)** | **12 bulan (hemat 30%)** | Untuk siapa |
|------|---------------------------------------|------------------------|--------------------------|-------------|
| **Starter** | ~~Rp 1,199,000/bln~~ | **Rp 509,150/bln** | **Rp 419,300/bln** | Toko / distributor kecil — Kasir, Stok 1 gudang, Pembelian, Recon, AR, Returns, 14 sales channel, Laporan dasar |
| **Pro** | ~~Rp 1,899,000/bln~~ | **Rp 806,650/bln** | **Rp 664,300/bln** | Distributor menengah — semua Starter + Penawaran + GL/Neraca/Arus Kas + multi-warehouse (5) + multi-user role + executive dashboard + Pengawasan ⚠️partial + Barcode ⚠️partial. **Everything except AI.** |
| **Premium** | ~~Rp 7,599,000/bln~~ | **Rp 3,229,150/bln** | **Rp 2,659,300/bln** | Distributor B2B serious + chat-heavy — semua Pro + **Calista AI for Ordering** + multi-warehouse (10) + multi-user (25) + 50K SKU |

**Setup fee one-time (unchanged from v2):**
- Starter / Pro: **Rp 1,500,000** (catalog import + 1-2 training)
- Premium: **Rp 3,500,000** (catalog import + Calista persona tuning + 2 training + 2-week shadow mode)

**Terms (v3):**
- Dibayar **upfront** — minimum 6 bulan, atau commit 12 bulan hemat 30%.
- **Tidak ada Quarterly lagi** (di v2 ada, v3 dropped — filter buyer lebih kuat).
- **Money-back guarantee 14 hari** kalau tenant inactive < 30 hari (psikologi unlock untuk komitmen 6mo).
- Founding 5-10 paying tenants: grandfather rate (minimum 24 bulan lock).

### Upfront cash per tenant (v3)

| Plan | Upfront 6 bulan | Upfront 12 bulan |
|------|------------------|---------------------|
| Starter | Rp 4,55jt (6 × Rp 509K + Rp 1.5M setup) | Rp 6,53jt |
| Pro | **Rp 6,34jt** (6 × Rp 807K + Rp 1.5M setup) | **Rp 9,47jt** |
| Premium | Rp 22,87jt (6 × Rp 3,229K + Rp 3.5M setup) | Rp 35,41jt |

### Differentiation lines per tier (v3 — pakai effective 12-month price untuk anchor "Rp X / bulan")

- **Starter:** *"Bukan cuma accounting kayak Jurnal — VOSI handle kasir + stok + recon + 14 channel jualan dari hari pertama. Mulai Rp 419K/bulan 12-month."*
- **Pro:** *"Semua fitur ERP termasuk GL dan multi-warehouse, dengan harga Rp 664K/bulan 12-month — 56% lebih murah dari Jurnal Enterprise."*
- **Premium:** *"Cuma VOSI yang punya Calista AI yang handle WhatsApp order end-to-end. Jurnal + Mekari Kontak masih perlu staff manual nyusun pesan. Calista handle 300 chat/hari tanpa lelah. Rp 2,659K/bulan 12-month."*

### Tier yang dijual ke distributor B2B Glodok (campaign current)

Default pitch ke distributor B2B = **Pro tier 12-month (Rp 664K/bulan)**. Reasoning:
- Distributor B2B butuh Penawaran + GL + multi-warehouse + Pengawasan (Starter tidak punya).
- 12-month commit normal untuk distributor 12-year-old business — bukan masalah.
- Premium upsell setelah Pro stabil 3-6 bulan (lihat pricing.md guardrail #3).
- Starter terlalu thin untuk distributor 5+ staff — biasanya ke toko retail kecil 1-2 staff.

**Fallback pitch:** Pro 6-month (Rp 807K/bulan) kalau prospect ragu commit 12-month. 15% diskon vs no-diskon Quarterly v2 = sufficient incentive untuk move ke 6mo.

### Pricing maintenance rule

**Single source of truth:** `docs/business/pricing.md`. Kalau ada update pricing, edit di sana dulu, lalu sync §6.5 + §6.6 ini. Pricing iterates quarterly; pack ini ikut.

---

## 6.6. Feature Matrix per Tier (sync dengan modul shipped 2026-06-24)

Authoritative reference untuk sales conversation, deck slide 6-7, dan landing page comparison table. Update setiap modul baru shipped (cek `progress.md`).

### Core — semua tier (commodity baseline, Starter/Pro/Premium semua dapat)

| Modul | Detail | Status |
|-------|--------|--------|
| Auth + multi-user signin | Login, role per user | ✓ shipped |
| Dashboard | Overview omzet, stok, AR | ✓ shipped |
| Produk | SKU, kategori, foto opsional | ✓ shipped |
| Pelanggan | DB customer mandatory, no ad-hoc | ✓ shipped |
| Kasir POS | Multi-payment, struk PDF, Diskon | ✓ shipped |
| Penjualan basic | Sales Invoice, Faktur PDF | ✓ shipped |
| Pembelian basic | PO ke supplier, Tagihan PI, Pembayaran, BNL | ✓ shipped |
| Stok | Stock level real-time, **1 gudang di Starter** | ✓ shipped |
| Piutang basic | AR list, jatuh tempo, Pembayaran masuk | ✓ shipped |
| Sales channels (14) | Multi-channel routing | ✓ shipped |
| Diskon (per-line + order) | Kasir + TEMPO + Tagihan PI | ✓ shipped 2026-06-23 |
| Retur Penjualan | Returns | ✓ shipped |
| Rekonsiliasi bank basic | Cocokkan transaksi | ✓ shipped |
| KasBank | BANK + KAS + E_WALLET multi-account | ✓ shipped |
| Laporan dasar | Penjualan, stok, AR | ✓ shipped |
| Pengaturan | Modul toggle, pajak, jasa, sales channels | ✓ shipped |
| Notification settings | Per-user notif | ✓ shipped |

### Pro add-ons (Pro + Premium dapat; **Starter ❌**)

| Modul | Detail | Status |
|-------|--------|--------|
| **Sales Order (Penawaran)** | Quote → Invoice flow, PDF Penawaran, Daftar Penawaran + conversion rate tracking | ✓ shipped 2026-06-23 |
| **Multi-warehouse** | Manajemen Gudang + Transfer + per-gudang stock — cap **5 di Pro**, 10 di Premium | ✓ shipped |
| **Multi-user roles** | Owner / Admin / Sales / Gudang dengan permission matrix | ✓ shipped |
| **Approval Inbox + Owner PIN** | Two-step approval (stock adjust, write-off, rakit lock, biaya) | ✓ shipped |
| **GL / Neraca / Arus Kas** | Akuntansi full, COA, journal entries | ✓ shipped |
| **Tax reports** | PPN, PPh basic | ⚠️ partial (PPN OK, PPh formal defer) |
| **Executive dashboard** | Owner KPI + analytics | ✓ shipped |
| **Pengawasan dashboard** | Owner real-time staff monitoring | ⚠️ partial — executive dashboard ada, dedicated Pengawasan view belum |
| **Opname + Adjustment + Audit trail** | Stock take dengan approval workflow | ✓ shipped |
| **Rakit / Assembly workflow** | Bundle / manufacturing | ✓ shipped |
| **Piutang advanced + Tulis-off** | Write-off request → Owner approve | ✓ shipped |
| **Initial stock approval** | First-time stock requires Owner sign-off | ✓ shipped |
| **Owner Biaya Final Inbox** | Expense approval workflow | ✓ shipped |
| **Barcode scanning** | Kasir + opname + receiving | ⚠️ partial — scanner UI ada, hardware-integration belum semua |
| **Diskon wizard advanced** | Multi-step config + sales-channel scope | ✓ shipped |

### Premium exclusive — Calista AI + capacity uplift

| Modul | Detail | Status |
|-------|--------|--------|
| **Calista AI for Ordering** | AI agent baca WA customer end-to-end (greeting → cek stok → kasih harga → bikin nota → handover ke staff kalau kompleks) | ⚠️ partial — backend-go LLM router + Gemini direct + OpenRouter chain SHIPPED; frontend auto-reply masih shadow mode |
| WhatsApp pair (pair-code + QR) | Hubungkan WA Business ke VOSI | ✓ shipped |
| Calista capacity 300 conv/hari | Hard cap per tenant (rate-limited di chain) | ✓ shipped |
| Calista persona tuning | Setup-time customization untuk industri tenant | ⚠️ manual — founder + tenant kerja bareng saat setup, belum self-serve |
| Shadow mode monitoring (2-week ramp) | Calista jawab tapi staff approve dulu | ⚠️ partial — shadow infra ada, monitoring UI belum lengkap |
| Multi-warehouse **10 cap** | Extended dari Pro 5 | configurable |
| Multi-user **25 cap** | Extended dari Pro | configurable |
| **50K SKU cap** | Extended | configurable |

### Tidak masuk tier mana pun saat ini (in spec / future)

| Modul | Target tier (planned) | Status |
|-------|------------------------|--------|
| Multi-Tier Pricing (Eceran + Grosir) per-customer | Pro+ ketika shipped | spec written 2026-06-24, implementasi pending |
| Multi-Tenant SaaS (subdomain per tenant) | Infrastructure, semua tier | spec written 2026-06-24, implementasi pending |
| Premium Plus (1000+ conv/hari Calista) | Future Phase | mention only di pricing.md open questions |
| Tukar Faktur (B2B distributor) | Pro+ ketika shipped | optional, defer per memory |

### Honest disclosure untuk sales conversation

**Sebelum onboard customer ke tier yang punya fitur partial:**

1. **Pro buyer yang prioritize Barcode + Pengawasan dashboard:** Beri tahu status partial. Tawarkan "Barcode UI ready, hardware-integration kerja bareng di onboarding" — jangan overpromise.
2. **Premium buyer:** Setup fee Rp 3.5jt SUDAH include 2-week shadow mode (sudah documented di pricing.md). Pakai itu sebagai feature, bukan caveat. "Calista on-boarding 2 minggu — staff Anda review tiap jawaban dulu, lalu kami ramp auto. Risk minimal."
3. **Customer Garindo (legacy):** Stay di `garindo_legacy` plan. Tidak terkena tier baru.

---

## 7. Objection Handlers

| Objection | Counter |
|-----------|---------|
| **"Pro Rp 807K/bln 6-month mahal."** | 1 quote ke-deal @ margin Rp 1jt sudah balik 1 bulan. 6 bulan = balik dari 1 customer baru saja. Anda biasa kirim berapa quote sebulan? |
| **"Komit 6 bulan upfront berat."** | Money-back guarantee 14 hari kalau Anda tidak active. Jadi praktis Anda commit hanya 14 hari evaluation. Setelah 14 hari = Anda sudah lihat hasilnya. |
| **"Premium Rp 3.2jt/bln gak kuat."** | Pro Rp 807K dulu — semua ERP kecuali Calista AI sudah lengkap. Premium upgrade nanti pas tim Anda sudah bisa handle 100+ chat/hari dan butuh AI. |
| **"Lebih murah Kledo Rp 50K/bln."** | Kledo = accounting only, gak punya Penawaran, gak ada multi-gudang, gak ada approval workflow distributor. Apel vs jeruk. |
| **"Setup fee Rp 1.5jt-3.5jt mahal."** | Setup fee includes CSV import catalog + training tim Anda. Tanpa itu, Anda input 800 SKU manual = 3 minggu × admin = berkali-kali lipat. |
| "Staff gak ngerti komputer" | Designed untuk admin counter — semudah WhatsApp. Onboard 3 hari kerja (lihat onboarding playbook). |
| "Sudah coba Jurnal, ribet" | Jurnal = akuntansi. VOSI = operasional **+** akuntansi (Pro tier ke atas). Beda goal, satu sistem. |
| "Belum siap ganti sistem total" | Mulai Starter 6-month Rp 509K/bln dulu. Buku nota tetap jalan paralel. Money-back 14 hari kalau gak cocok. |
| "Data banyak, repot import" | Setup fee covers CSV import — tim VOSI bantu. Customer + SKU naik dalam 1 hari. |
| "Bagaimana kalau internet mati" | Mode offline draft (rencana). Saat ini: cache lokal browser, sync saat online. |
| **"Apa beda Calista vs Mekari Kontak?"** | Mekari Kontak = chatbot, butuh staff approve setiap balasan. Calista = AI agent end-to-end (greeting → cek stok → kasih harga → bikin nota), handover ke staff cuma kalau kompleks. Plus Kontak butuh Jurnal subscription on top = total Rp 3.5jt+ untuk stack yang less integrated. |

---

## 8. Visual Directions (pilih 1 sebelum produksi)

### Direction A — "Toko Modern" (rekomendasi default)

| Element | Spec |
|---------|------|
| Primary | Navy `#0B2545` (kepercayaan, profesional) |
| Accent | Kuning emas `#F9B233` (Indonesia, attention, banner-friendly) |
| BG | Cream off-white `#FAF7F0` + Pure white `#FFFFFF` |
| Type | Heading: **Inter Bold** / Body: **Inter Regular**. Alternatif: Plus Jakarta Sans. |
| Imagery | Foto real toko Glodok + product close-up (MCB, panel, kabel). Ada human element (tangan, sales lapangan). |
| Mood | Profesional + hangat, modern + rooted in Indonesia. |
| Pros | Beda dari competitor blue-sea. Energetic. High-contrast banner. |
| Cons | Kuning butuh balance agar tidak terasa "promo diskon". |

**Logo concept (untuk handoff ke designer):**
Wordmark "VOSI" sans-serif tebal, huruf "O" diganti shape mirip rangkaian listrik (●—●) sebagai aksen subtle. Color: navy on white / yellow on navy.

### Direction B — "Calm Authority"

| Element | Spec |
|---------|------|
| Primary | Slate-900 `#0F172A` (almost-black, modern) |
| Accent | Sage / muted teal `#7CA982` (calm, trust) |
| BG | Pure white + Gray-50 `#F8FAFC` |
| Type | Heading: **Geist Bold** / Body: **Geist Regular**. Alt: Plus Jakarta Sans. |
| Imagery | UI screenshots di laptop/HP mockup. Minimal human element. |
| Mood | Linear / Notion / Stripe — enterprise SaaS premium. |
| Pros | Looks expensive. Fits "kontrol penuh" narrative. Deck-ready. |
| Cons | Bisa terasa "Silicon Valley dingin" untuk SMB owner 45-tahun Indonesia. Banner less attention-grab. |

### Direction C — "Workshop / Industrial"

| Element | Spec |
|---------|------|
| Primary | Charcoal `#1F2937` (industrial gray) |
| Accent | Safety orange `#F97316` + electric yellow `#FBBF24` |
| BG | Concrete texture / blueprint-paper feel |
| Type | Heading: **Manrope ExtraBold** / Body: **DM Sans**. |
| Imagery | Panel listrik, MCB, kabel, technical-drawing aesthetic, monospace numeric. |
| Mood | "Made by people who actually understand your shop." |
| Pros | Hyper-resonant dengan electrical distributor. Immediate "ini punya gue" recognition. |
| Cons | Lock ke electrical niche — kalau pivot ke F&B/sembako nanti, brand harus diulang. |

**Recommendation:** Direction A untuk balance brand range + Indonesian feel + banner energy. Direction C kalau commit ke electrical distributor selamanya.

---

## 9. Standing Banner (X-banner / roll-up 60×160 cm portrait)

### Layout zones (top → bottom)

```
┌──────────────────────────────┐
│ [LOGO VOSI]   ERP Distributor B2B   │  ← 25% — identity
├──────────────────────────────┤
│                              │
│   STOK JELAS.                │
│   TAGIHAN KETAGIH.           │  ← 30% — hero / slogan
│   QUOTE KE-DEAL.             │
│                              │
│   Sistem untuk toko panel,   │
│   alat listrik & CCTV.       │
├──────────────────────────────┤
│ ✓ Quote WA → Nota otomatis   │
│ ✓ Stok real-time per gudang  │  ← 25% — proof
│ ✓ Tagihan TEMPO auto-track   │
│ ✓ Owner approve dari HP      │
├──────────────────────────────┤
│ DEMO GRATIS 15 MENIT         │
│ WA 0812-XXXX-XXXX            │  ← 20% — CTA
│           [QR CODE]          │
└──────────────────────────────┘
```

### Variant V1 — primary (slogan #5)
- **Promo badge** (top corner, yellow on navy): **"PROMO LAUNCH 50% OFF — 100 Tenant Pertama"**
- **Hero:** STOK JELAS. TAGIHAN KETAGIH. QUOTE KE-DEAL.
- **Sub:** Sistem untuk toko panel, alat listrik & CCTV — dipakai 5 staff Anda setiap hari.
- **Bullets:** Quote WA → Nota / Stok per gudang / TEMPO auto-track / Owner kontrol via HP
- **Pricing teaser** (di atas CTA): **Pro Rp 664K/bulan 12-month** · ~~Rp 1,899K~~
- **CTA:** DEMO GRATIS 15 MENIT — WA 0812-XXXX + QR

### Variant V2 — alt (slogan #3, aspiration)
- **Promo badge:** sama
- **Hero:** OWNER PULANG JAM 6. SISTEM YANG KERJA SAMPAI MALAM.
- **Sub:** ERP distributor B2B + Calista AI — bukan accounting yang dipaksa.
- **Bullets:** sama
- **Pricing teaser:** sama
- **CTA:** sama

### Variant V3 — Premium / Calista AI focus (untuk segmen chat-heavy distributor)
- **Promo badge:** sama
- **Hero:** 300 CHAT/HARI. CALISTA AI YANG JAWAB.
- **Sub:** Bukan chatbot generic — AI agent yang baca konteks, kasih harga sesuai customer, bikin nota otomatis.
- **Bullets:** WA pair dalam 5 menit / Stok real-time / TEMPO auto-track / Calista 300 conv/hari
- **Pricing teaser:** **Premium Rp 2,659K/bulan 12-month** · ~~Rp 7,599K~~
- **CTA:** sama

### Print spec untuk Canva / printer
- Size: **60 × 160 cm portrait** (3:8 ratio)
- Bleed: 3 mm all sides
- Resolution: 150 DPI minimum untuk roll-up (300 DPI kalau X-banner premium print)
- Color: CMYK (bukan RGB) — kasih designer untuk konversi
- File: PDF print-ready, embed fonts

---

## 10. WA Blast Campaign

### Poster (image 1080×1080 atau 1080×1350)

**Layout:**

```
┌─────────────────────────────┐
│ Quote di WA                 │
│ lupa di-follow up?          │  ← Big bold question (white on navy)
│                             │
│   80%                       │  ← Hero stat (yellow accent)
│   quote distributor         │
│   hilang di chat.           │
│                             │
│ ─────────────────           │
│                             │
│ VOSI                        │
│ Quote WA otomatis           │
│ jadi nota.                  │
│                             │
│ Demo gratis 15 menit.       │
│ WA 0812-XXXX-XXXX           │
│           [QR]              │
└─────────────────────────────┘
```

**Catatan:** Angka "80%" adalah persona-quote-grade (anekdotal di Glodok), bukan stat resmi. Aman secara semantik karena di-frame sebagai observasi pengalaman, bukan klaim riset.

### WA caption (text blast — paste di Canva, juga pakai untuk WA broadcast)

```
Pak / Bu,

Mau tanya cepat: berapa quote WhatsApp yang Anda kirim minggu lalu?
Berapa yang akhirnya jadi nota?

Kalau jawabannya "yang masuk WA, yang hilang juga banyak"...
Anda gak sendirian. Owner distributor di LTC Glodok rata-rata
cuma 20% quote yang nge-deal.

Kami bangun VOSI — ERP khusus distributor B2B alat listrik / panel
/ CCTV. Quote WA otomatis di-track. Conversion ketahuan. Tagihan
TEMPO 30/60/90 hari gak nyangkut. Stok per gudang real-time.

Plus: Calista AI baca chat customer Anda, kasih harga, bikin nota
otomatis. Handover ke staff cuma kalau kompleks.

Bukan accounting yang dipaksa jadi ERP. Dibangun bareng owner
distributor, dari counter sampai gudang.

🎁 PROMO LAUNCH 50% OFF — 100 tenant pertama.
   Pro Rp 807K/bln 6-month (12-month Rp 664K/bln). Premium + Calista AI
   Rp 3.229K/bln 6-month (12-month Rp 2.659K/bln). Money-back 14 hari.

Demo 15 menit, gratis. Lewat WA juga — sesuai habit Anda.

Balas chat ini dengan "DEMO" — kami atur waktu.

— Tim VOSI
"Wujudkan Visi Bisnismu"
```

### Variant — shorter version untuk broadcast batch besar

```
Pak/Bu, owner distributor B2B:

Quote di WA suka lupa di-follow up?
Tagihan TEMPO suka nyangkut?
Stok di komputer beda dengan gudang?

VOSI — ERP khusus distributor (panel, listrik, CCTV) + Calista AI
yang balas WA customer otomatis.

🎁 PROMO 50% OFF — Pro Rp 664K/bln 12-month (atau 6-month Rp 807K/bln).

Demo gratis 15 menit, lewat WA juga.
Balas "DEMO" untuk atur waktu.
```

### Variant — Premium / Calista focused

```
Pak / Bu,

Customer Anda chat WA 100+ kali sehari?
Admin Anda jadi customer service tanpa henti?

Calista AI — AI agent VOSI yang baca konteks chat, kasih harga
sesuai customer Anda (kontraktor vs end-user), bikin nota
otomatis. 300 conv/hari per tenant.

Bukan chatbot generic. Bukan Mekari Kontak yang masih nyusun
template. Calista handle full chain — handover ke staff cuma
kalau kompleks.

🎁 PROMO LAUNCH — Premium Rp 2,659K/bln 12-month (anchor Rp 7,599K).
Atau 6-month Rp 3,229K/bln. Include setup + Calista persona tuning
+ 2-week shadow mode. Money-back 14 hari.

Demo 15 menit di WA — Anda lihat sendiri Calista jawab chat
customer test.

Balas "CALISTA" untuk atur waktu.

— Tim VOSI
```

---

## 11. Pitch Deck Outline — 12 slide

Format setiap slide: **headline + max 3 bullet + speaker notes**. Render di Gamma.app atau Canva. Total durasi presentasi: 12–15 menit.

| # | Slide | Inti |
|---|-------|------|
| 1 | **Cover** | "VOSI — ERP Distributor B2B" + tagline #2 "ERP distributor, bukan akuntansi yang dipaksa." + nama presenter + tanggal |
| 2 | **Empati** | "5 masalah harian owner distributor B2B" — 5 bullet pain di bahasa customer (bukan korporat) |
| 3 | **Quote owner** | 3 pull-quote langsung dari persona Pak Anton (§3) — full slide, satu quote per bagian |
| 4 | **Kenapa solusi sekarang gagal** | Excel = hilang revision · WA = no tracking · Jurnal = akuntansi (bukan ops) · Accurate = quote 18jt + training |
| 5 | **Positioning** | "VOSI = ERP **operasional** distributor B2B" — diagram: Excel + WA + Buku Nota → VOSI |
| 6 | **Modul utama (1/2)** | Penawaran → Sales Invoice + Pembelian end-to-end (PO → Tagihan PI → Pembayaran → BNL) |
| 7 | **Modul utama (2/2)** | Stok multi-gudang + Piutang AR + Approval inbox + WhatsApp AI |
| 8 | **Demo flow** | 1 alur konkret end-to-end: Customer WA "MCB 6A 50 pcs" → Quote di VOSI → kirim PDF balik via WA → customer setuju → Sales Invoice → stok keluar dari gudang → Tagihan masuk TEMPO 30 → Pembayaran masuk → Rekonsiliasi |
| 9 | **VS Kompetitor** | Tabel comparison: VOSI / Jurnal / Accurate / Moka — 5 baris (target user, learning curve, harga, modul utama, WA integration) |
| 10 | **Cara mulai (onboarding)** | Day 1: install + CSV import customer/SKU · Day 2-3: train admin · Day 4-7: shadow operasional · Week 2: full |
| 11 | **Harga** | (placeholder kalau belum final) — atau actual tier: Solo / Growth / Distributor. Include risk reversal: "Gratis 14 hari, tanpa kartu kredit." |
| 12 | **Closing + CTA** | Slogan #3 "Owner pulang jam 6. Sistem yang kerja sampai malam." + CTA "Demo 15 menit — WA 0812-XXXX" + QR |

### Speaker notes untuk slide 8 (demo flow) — paling penting

> "Saya ceritakan satu alur nyata. Pelanggan namanya Pak Hadi, kontraktor proyek apartemen di Bekasi. Hari Senin pagi dia chat WA: 'Bos, butuh MCB 6A 50 pcs hari ini.' Di VOSI, admin Anda klik tombol Penawaran Baru, pilih customer Pak Hadi (data sudah ada), isi 50× MCB 6A — sistem otomatis kasih harga grosir karena Pak Hadi sudah ditandai kategori kontraktor. Klik **Buat PDF Penawaran**, kirim balik ke WA Pak Hadi dalam 2 menit. Pak Hadi setuju, admin tinggal klik **Jadikan Sales Invoice** — semua data ngalir, gak ngetik ulang. Sales Invoice keluar, stok MCB 6A di gudang otomatis turun 50, masuk antrian dianter. Karena Pak Hadi TEMPO 30 hari, tagihan otomatis masuk Piutang dashboard dengan jatuh tempo. Tanggal 30 hari kemudian, sistem reminder admin. Pak Hadi bayar, admin tag di Pembayaran, masuk Rekonsiliasi bank otomatis. Done. Anda? Anda lihat semua dari HP, kapan aja."

---

## 12. Cara Pakai Pack Ini di claude.ai (Standalone)

### Setup sekali (15 menit)

1. **Buka claude.ai** (butuh paket Pro/Team untuk fitur Projects).
2. **New Project** → nama "VOSI Marketing".
3. **Project knowledge → Add file** → upload `vosi-context-pack-2026-06-24.md` (file ini).
4. **Project Instructions** → paste teks di kotak berikut.

```
Anda adalah copywriter & creative director untuk VOSI — ERP khusus
distributor B2B Indonesia (target utama: sentra Glodok, alat listrik,
panel, CCTV).

ATURAN OUTPUT:
1. Selalu jawab dalam Bahasa Indonesia, kecuali diminta sebaliknya.
2. Ikuti voice di §5 file pack. Hindari kata: ERP, workflow, synergy,
   ekosistem, platform — kecuali konteks positioning.
3. Setiap output harus map ke pain & value prop di §3-§4. Jangan
   janjikan fitur yang ada di "Tidak dipromosikan dulu" (§4).
4. Headline = pain, bukan fitur. Konkret > kategori. Spesifik > umum.
5. Kalau saya minta variasi, beri 3 versi dengan reasoning konversi
   yang berbeda — jelaskan kenapa masing-masing mungkin lebih
   konversi tinggi untuk segmen / format yang berbeda.
6. Bahasa Indonesia sehari-hari, panggilan "Anda/Pak/Bu". Tidak
   "lo/gue" (B2B owner 35-55).
7. Acknowledge alternatif yang sudah dicoba customer (Jurnal,
   Accurate, Moka). Tunjukkan beda.
8. Setiap angka di output harus didefend — kalau bukan dari data,
   frame sebagai observasi/anekdot ("pengalaman owner Glodok
   menunjukkan...").
```

### Chat-per-asset (mulai pakai)

| Tujuan | Prompt awal di Chat baru |
|--------|---------------------------|
| **Banner variasi baru** | "Hasilkan 5 variasi copy banner standing 60×160cm untuk event [nama event]. Format: hero slogan + sub-line + 4 bullet proof + CTA. Pakai Visual Direction A. Reasoning konversi tiap variasi." |
| **WA blast caption** | "Hasilkan 3 versi WA broadcast caption: (1) panjang/edukasi 200 kata, (2) sedang/pain-focused 100 kata, (3) pendek/CTA 50 kata. Untuk segmen Glodok electrical distributor." |
| **WA poster image spec** | "Hasilkan spec image poster 1080×1080 untuk WA Story — copy + layout + color + font. Output: deskripsi yang bisa langsung saya kasih ke designer Canva." |
| **Pitch deck** | "Render slide 1 sampai 12 dari §11 pack jadi full speaker script Bahasa Indonesia. Per slide: title + 3 bullet + 1 paragraph speaker note 60-80 kata." |
| **Landing page** | "Hasilkan landing page copy untuk vosi.id: hero, 3 value prop section, demo flow, vs-competitor section, pricing, FAQ, footer CTA. Output sebagai Artifact HTML+Tailwind yang bisa saya preview." |
| **Cold DM ke prospect** | "Hasilkan 5 template DM Instagram / WA pertama ke owner toko di LTC Glodok yang belum kenal VOSI. Setiap template angle berbeda (pain-led, social-proof-led, curiosity-led, demo-led, story-led)." |
| **Brand voice audit** | Paste copy yang sudah Anda tulis sendiri. Minta: "Audit copy ini sesuai voice §5 pack. Kasih revisi line-by-line + alasan." |

### Handoff ke production

- **Banner / WA poster** → copy dari Claude → drop ke **Canva** (template "Roll-up Banner Portrait" atau "Instagram Post 1:1"). Pakai color & font dari Visual Direction yang dipilih (§8).
- **Pitch deck** → copy dari Claude → **Gamma.app** generate slide auto dari outline, atau **Canva Presentations** kalau perlu kontrol manual.
- **Landing page** → Artifact HTML/Tailwind dari Claude jadi referensi untuk developer (atau langsung deploy ke Vercel kalau cocok).

### Yang **tidak** dilakukan claude.ai
- Render logo final yang bagus → pakai designer Fiverr/local atau Looka.com.
- Foto produk real → fotografer atau hire dari Glodok ambil foto toko + product.
- Print poster final → kasih ke printer offset (Pasar Pagi, percetakan Mangga Dua).

---

## 13. Maintenance

File ini adalah **single source of truth marketing**. Update saat:
- Modul baru shipped → tambah di §4 (cek `progress.md`).
- Modul yang ada di "Tidak dipromosikan" pindah ke shipped → angkat ke value prop ranked.
- Slogan baru terbukti konversi tinggi dari A/B test → angkat ke default picks §6.
- Persona shifted (kalau target geser ke F&B / sembako) → revisi §2 + §3 dari scratch.

**Diff target setelah 90 hari:** Review pack ini setiap kuartal. Pain yang persona sebut harus dipakai customer real dalam interview / sales call. Kalau tidak, refresh.
