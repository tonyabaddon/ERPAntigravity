# Mekari Jurnal — Riset Kompetitor

## Posisi kompetitor

**Mekari Jurnal** adalah ERP accounting-centric terbesar di Indonesia. Closest direct competitor untuk modul ERP Vosi (Stock, Order, Pembelian, Laporan, POS).

### Yang Mekari KUAT (perhatian)

- Accounting deep (40+ reports, bank reconciliation API, e-Faktur, multi-currency)
- Brand established + customer references banyak
- Marketplace integration native (Tokopedia, Shopee)
- Mobile app full-feature

### Yang Mekari LEMAH = ammunition Vosi

- **AI WhatsApp native — TIDAK ada.** Customer harus beli Mekari Qontak terpisah (Rp 400k+/user/mo)
- **POS native — TIDAK ada.** Customer harus beli Mekari POS terpisah (Rp 269k/mo)
- **Single app/login — TIDAK.** Customer harus pakai 3 produk terpisah untuk full stack (Jurnal + POS + Qontak)
- Pricing TINGGI untuk MSME segment (Rp 359k Essentials)
- Production module hanya di tier ERP custom (mahal)

### Pricing public Mekari (per Juni 2026)

| Paket | Harga | User max |
|---|---|---|
| Jurnal Essentials | Rp 359k/mo (annual) | 3 |
| Jurnal Plus | Rp 629k/mo (annual) | 5 |
| Jurnal ERP | Custom (~Rp 1,17jt) | 10 |
| Mekari POS Essentials | Rp 269k/mo | — |
| Mekari Qontak | Rp 400k+/user/mo | — |

**Full stack combo:** Rp 628k–1,838k/mo (3 app terpisah).

### Target gali dari sales demo

Yang TIDAK ada di website tapi penting untuk pricing & feature decision:
- Harga real after-discount (tier annual + bundle)
- Setup fee, training fee, kontrak minimum
- Max produk, max user, limit transaksi per tier
- POS-Jurnal sync depth (real-time vs batch)
- WhatsApp invoice mechanism + cost per send
- Customer reference di kategori toko material LTC

---

## Cara pakai folder ini

### Tahap 1 — Baca panduan

📖 **[`1-step-by-step.docx`](./1-step-by-step.docx)** — panduan A-Z lengkap:
- Phase 1: Pre-demo setup (install tools, daftar demo, persiapan H-1)
- Phase 2: Eksekusi demo (pacing, recording, trick selama live)
- Phase 3: Post-demo (extract screenshot, transcribe, upload)
- Troubleshooting common issues
- Quick reference card

### Tahap 2 — Siapkan script

🗒️ **[`2-probing-questions.docx`](./2-probing-questions.docx)** — 37 pertanyaan terstruktur:
- 12 kategori (pricing, user, stock, POS, WhatsApp, accounting, dll)
- Marker prioritas: **★★★ WAJIB** vs ★ BONUS
- Centang ☐ tiap pertanyaan saat ditanyakan

### Tahap 3 — Formulir live demo

✍️ **[`3-notes-template.docx`](./3-notes-template.docx)** — formulir kosong:
- Buka di Word saat demo
- File → Save As → `results/notes.docx` (supaya template tetap utuh)
- Ketik langsung di field kosong (garis bawah), centang ☐ jadi ☑
- Section: pricing real, fitur per kategori, top takeaway, quote sales notable

---

## Hasil demo: save di `results/`

```
results/
├── screenshots/           ← 30–50 PNG (Cmd+Shift+4)
│   ├── 01-pricing-list.png
│   ├── 02-stock-create.png
│   ├── ...
├── frames/                ← (opsional) ffmpeg extract video
├── notes.docx             ← copy dari 3-notes-template, sudah diisi
├── transcript.md          ← MacWhisper output
├── brochure.pdf           ← (opsional) follow-up email attachment
└── pricing-quote.png      ← (opsional) custom quote screenshot
```

---

## Lapor ke Claude setelah selesai

Chat:
> "Sudah upload demo Mekari di `docs/competitive-research/mekari-jurnal/results/`"

Claude akan generate:
- Gap analysis Vosi vs Mekari per modul + per tier
- Backlog prioritas (must fix sebelum jualan)
- Landing page differentiation copy
- Sales objection handling vs Mekari
- Revisit pricing tier Vosi berdasar harga real Mekari yang baru dapat
