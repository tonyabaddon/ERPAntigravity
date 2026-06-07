# Competitive Research — Vosi

Riset kompetitor untuk benchmark Vosi ERP vs incumbent di pasar Indonesia. Hasil riset akan jadi input untuk: pricing tier, feature roadmap, landing page differentiation copy, dan sales objection handling.

---

## Kompetitor yang sedang di-research

| # | Kompetitor | Folder | Yang di-benchmark | Status |
|---|---|---|---|---|
| 1 | **Mekari Jurnal** | [`mekari-jurnal/`](./mekari-jurnal/) | ERP core (Stock, Pembelian, Laporan, POS) | □ Belum demo |
| 2 | **Halo AI** | [`halo-ai/`](./halo-ai/) | AI WhatsApp chatbot (untuk Vosi Premium tier) | □ Belum demo |

---

## Workflow standard (sama untuk semua kompetitor)

Per kompetitor, ada **3 file Word ter-nomor 1/2/3** yang dibaca berurutan:

```
mekari-jurnal/
├── 1-step-by-step.docx       ← BACA DULU (panduan A–Z)
├── 2-probing-questions.docx  ← Script tanya saat demo
└── 3-notes-template.docx     ← Buka di Word saat demo, ketik live
```

### 3 phase per demo

| Phase | Hari | Aktivitas | Output |
|---|---|---|---|
| **Pre-demo** | Hari 1 (~15 menit) | Setup tools, daftar demo, jadwal | Demo terjadwal |
| **Demo** | Hari 2 (~60 menit) | Eksekusi + record + (untuk Halo AI) stress test live | Recording + transcript |
| **Post-demo** | Hari 3 (~45 menit) | Extract screenshot, transcribe, upload, lapor ke Claude | Gap analysis |

---

## Struktur folder

```
competitive-research/
├── README.md                          ← (file ini — entry point)
├── mekari-jurnal/
│   ├── README.md                      ← overview per kompetitor
│   ├── 1-step-by-step.docx            ← panduan
│   ├── 2-probing-questions.docx       ← script tanya
│   ├── 3-notes-template.docx          ← formulir kosong
│   ├── _source/                       ← HTML mentah untuk regenerasi DOCX (abaikan)
│   └── results/                       ← USER FILL DI SINI setelah demo
│       ├── screenshots/               ← screenshot UI demo
│       ├── frames/                    ← (opsional) frame video
│       ├── notes.docx                 ← copy dari 3-notes-template, isi saat demo
│       ├── transcript.md              ← hasil MacWhisper transcribe
│       └── brochure.pdf               ← (opsional) follow-up sales
└── halo-ai/
    ├── README.md
    ├── 1-step-by-step.docx
    ├── 2-probing-questions.docx
    ├── 3-notes-template.docx
    ├── _source/
    └── results/
        └── screenshots/
            ├── stress-test/           ← khusus Halo AI: T1–T8 (8 file)
            └── demo-ui/               ← screenshot UI demo regular
```

---

## Tools yang dibutuhkan (sekali setup, dipakai semua demo)

| Tool | Untuk apa | Sumber |
|---|---|---|
| **Zoom Desktop** | Demo call + record local + auto-transcript | [zoom.us/download](https://zoom.us/download) |
| **MacWhisper** | Transcribe audio Indonesia offline (akurat) | [goodsnooze.gumroad.com/l/macwhisper](https://goodsnooze.gumroad.com/l/macwhisper) |
| **QuickTime Player** | Pause recording + screenshot frame | built-in macOS |
| **Cmd+Shift+4** | Screenshot area selection | built-in macOS |
| **ffmpeg** (opsional) | Extract semua frame video | `brew install ffmpeg` |

Detail install ada di `1-step-by-step.docx` masing-masing kompetitor.

---

## Setelah demo selesai

Chat ke Claude dengan pesan persis ini:

**Untuk Mekari:**
> "Sudah upload demo Mekari di `docs/competitive-research/mekari-jurnal/results/`"

**Untuk Halo AI:**
> "Sudah upload demo Halo AI di `docs/competitive-research/halo-ai/results/`"

Claude akan baca semua file (PNG + PDF + transcript + notes), cross-reference dengan modul Vosi yang sudah ada, dan generate:

- ✅ Gap analysis matrix per modul + per tier
- ✅ Backlog prioritas: MUST FIX vs SKIP sebelum jualan
- ✅ Landing page differentiation copy
- ✅ Sales objection handling script
- ✅ Roadmap improvement berdasar gap penting
- ✅ (Halo AI only) Stress test ammunition matrix untuk landing copy

---

## FAQ singkat

**Q: Kalau saya cuma punya waktu untuk 1 demo, mana yang dulu?**
A: **Mekari Jurnal**. Mereka direct competitor untuk ERP core Vosi. Hasil benchmark langsung digunakan untuk pricing tier dan landing page.

**Q: Kalau lupa step di tengah eksekusi?**
A: Buka `1-step-by-step.docx` di folder kompetitor — ada Quick Reference Card di akhir dokumen.

**Q: File `_source/` itu apa?**
A: HTML mentah yang dipakai untuk generate DOCX. Bisa di-edit dan regenerate. Abaikan kalau cuma mau pakai DOCX.

**Q: File `~$...docx` itu apa?**
A: Lock file dari Word saat file terbuka. Otomatis hilang saat Word ditutup. Aman diabaikan.

---

Dokumen dibuat oleh Claude Code untuk Tony Wei — proyek Vosi ERP Antigravity. Last updated: 7 Juni 2026.
