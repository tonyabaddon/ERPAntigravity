# Halo AI — Riset Kompetitor

## Posisi kompetitor

**Halo AI** adalah AI WhatsApp chatbot Indonesia. Closest direct competitor untuk Vosi Calista (Premium tier feature).

### Beda kunci demo ini vs Mekari

| Aspek | Mekari demo | Halo AI demo |
|---|---|---|
| Format | Sales screen-share, Q&A verbal | Hybrid: screen-share + **kamu live test bot via WA** |
| Output kunci | Feature gap matrix ERP | AI behavior + **stress test ammunition** |
| Stress test? | Tidak (sistem stateful) | **WAJIB** — 8 prompt T1–T8 |

**Stress test = ammunition tertinggi.** Marketing material Halo AI claim AI mereka "smart, persuasive, handle hundreds of cases". Stress test ngeunci klaim itu secara empiris.

### Yang Halo AI KUAT (perhatian, ini gap di Vosi)

- Multi-channel (WhatsApp + Instagram + Shopee + Tokopedia)
- Knowledge base upload (PDF, website crawl, FAQ)
- Customer enterprise (Halodoc, Massindo, Heymale)
- Multi-brand support dengan 1 AI account
- Scale claim 6.5M conversation

### Yang Halo AI LEMAH = ammunition Vosi

- **AI-only, butuh ERP terpisah.** Tidak ada native Stock/POS/Pembelian/Accounting
- **Custom-quote pricing** — tidak transparan, MSME unfriendly
- **Target enterprise** — pricing kemungkinan tidak fit MSME Indonesia
- Integrasi ERP populer Indonesia (Jurnal, Accurate, MajooKasir) — kemungkinan tidak native
- Onboarding 5–14 hari — slow untuk MSME yang mau quick start

### Pricing — TIDAK PUBLIK

Halo AI custom-quote semua. Wajib gali via sales call. Estimate kemungkinan: Rp 1,5–3jt/mo entry untuk paket basic.

### Target gali dari demo + stress test

Yang TIDAK ada di marketing material tapi krusial untuk benchmark Vosi Calista:
- AI Credit unit (per message? per conversation? per token?)
- LLM underlying (GPT-4? Gemini? Llama self-hosted?)
- Latency real (claim vs actual via stress test)
- Knowledge base mechanism (upload, refresh, max size)
- Hallucination behavior (apakah AI jujur kalau tidak tahu?)
- Multi-intent parsing capability
- Data privacy (server location, training data usage)

---

## Cara pakai folder ini

### Tahap 1 — Baca panduan

📖 **[`1-step-by-step.docx`](./1-step-by-step.docx)** — panduan A-Z + setup khusus stress test:
- Phase 1: Pre-demo setup (install tools, daftar demo, **persiapan WA standby untuk stress test**)
- Phase 2: Eksekusi demo + 8 stress test prompt (T1–T8)
- Phase 3: Post-demo (organize screenshot, transcribe, upload)
- Troubleshooting Halo AI specific (sales tidak kasih bot demo, dll)

### Tahap 2 — Siapkan script + stress test prompts

🗒️ **[`2-probing-questions.docx`](./2-probing-questions.docx)** — 45 pertanyaan + Appendix:
- 10 kategori pertanyaan (pricing, AI capability, knowledge base, channel, ERP integration, dll)
- **Appendix Stress Test: 8 prompt (T1–T8) untuk dikirim ke bot demo Halo AI via WA saat live demo**

### Tahap 3 — Formulir live demo

✍️ **[`3-notes-template.docx`](./3-notes-template.docx)** — formulir dengan section khusus:
- **STRESS TEST section di paling atas** (minimize typing saat live — tinggal centang PASS/FAIL, paste quote AI)
- Pricing detail (custom-quote breakdown)
- AI capability + LLM info
- Knowledge base mechanism
- Channel integration depth
- ERP integration capability (titik lemah Halo AI)
- Top takeaway, verdict, ammunition

---

## 8 Stress Test Prompts (preview)

| # | Test scenario | Prompt | Apa yang dinilai |
|---|---|---|---|
| T1 | Multi-intent parsing | "halo kak, plafon PVC 4 meter ada stok? warna marun. mau pesan 12 pcs kirim Karawang" | Apakah AI ekstrak semua entitas dalam 1 chat? |
| T2 | Halusinasi produk fictional | "kak ada produk SLK-9999 versi 2026? mau order 50 pcs" | Apakah AI jujur "tidak ada" atau ngarang? |
| T3 | Code-switching + nego | "yang ini harganya berapa sih, btw bisa nego ga kalau order banyak?" | Apakah AI handle 2 intent atau drop salah satu? |
| T4 | Persuasive close | "hmm mahal banget, di toko sebelah lebih murah" | Counter value prop atau auto-discount? |
| T5 | Sentiment negatif | "udah 3 hari belum kirim padahal janji 1 hari, gimana sih?" | Escalate ke human atau respons sendiri? Empati real? |
| T6 | Vague query | "kak yg bagus apa?" | Smart clarify atau generic response? |
| T7 | Pickup vs delivery | "saya ke toko aja besok pagi, bisa ambil sendiri jam 9?" | Handle non-delivery? Tahu jam buka toko? |
| T8 | Multi-stock query | "plafon 3m sama 4m, masing-masing berapa stoknya?" | Multi-query stock atau jawab 1 produk doang? |

Detail lengkap + cara eksekusi di `2-probing-questions.docx` Appendix.

---

## Hasil demo: save di `results/`

```
results/
├── screenshots/
│   ├── stress-test/       ← 8 file: T1-multi-intent.png ... T8-multi-stock.png
│   └── demo-ui/           ← 15–30 PNG sales screen-share
├── notes.docx             ← copy dari 3-notes-template, sudah diisi
├── transcript.md          ← MacWhisper output
├── proposal.pdf           ← (opsional) custom quote sales
└── pricing-quote.png      ← (opsional) pricing detail
```

---

## Lapor ke Claude setelah selesai

Chat:
> "Sudah upload demo Halo AI di `docs/competitive-research/halo-ai/results/`"

Claude akan generate:
- Gap analysis Calista vs Halo AI per kategori (NLU, persuasion, knowledge base, scaling, integrasi)
- **Stress test ammunition matrix** untuk landing copy ("Vosi Calista jujur, Halo AI halusinasi")
- Verdict per fitur: Vosi build / skip / sudah superior
- Landing page differentiation copy untuk Premium tier vs Halo AI
- Sales objection handling vs Halo AI
- Roadmap improvement Calista untuk close gap penting (mis. knowledge base upload kalau itu gap)
