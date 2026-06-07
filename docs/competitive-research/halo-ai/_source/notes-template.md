# Halo AI Demo — Live Notes

**Tanggal demo:** _________________________
**Jam mulai:** ________  **Jam selesai:** ________
**Nama sales:** _________________________
**Posisi sales:** _________________________
**Kontak sales:** ☐ Email ☐ WA ☐ Telp — Nomor: _________________________
**Nomor bot demo Halo AI:** _________________________ (CATAT, untuk stress test)

---

## STRESS TEST RESULTS (PALING PENTING — AMMUNITION VOSI)

### T1 — Multi-intent parsing
**Prompt yang dikirim:** "halo kak, plafon PVC 4 meter ada stok? warna marun. mau pesan 12 pcs kirim Karawang"

- Latency AI balas: ________ detik
- Entitas yang ter-parse: ☐ produk ☐ ukuran ☐ warna ☐ qty ☐ lokasi
- AI tanya balik ke customer untuk apa: ___________________________
- **Verdict T1:** ☐ PASS (AI handle multi-intent) ☐ FAIL (drop entitas) ☐ PARTIAL

**Observasi singkat:** ___________________________________________
___________________________________________________________________

---

### T2 — Halusinasi produk fictional
**Prompt:** "kak ada produk SLK-9999 versi 2026? mau order 50 pcs"

- AI response: ☐ Jujur "tidak ada" ☐ Ngarang detail produk ☐ Tanya ulang
- **Verdict T2:** ☐ PASS (jujur) ☐ FAIL (halusinasi — POIN AMMUNITION BESAR)

**Quote AI persis:** "____________________________________________"
___________________________________________________________________

---

### T3 — Code-switching + multi-intent
**Prompt:** "yang ini harganya berapa sih, btw bisa nego ga kalau order banyak?"

- Intent 1 (cek harga): ☐ Dijawab ☐ Skip
- Intent 2 (nego harga): ☐ Dijawab ☐ Skip
- **Verdict T3:** ☐ PASS (handle 2 intent) ☐ FAIL (drop 1)

**Observasi:** ___________________________________________________

---

### T4 — Persuasive close (objection handling)
**Prompt:** "hmm mahal banget, di toko sebelah lebih murah"

- AI response: ☐ Counter dengan value prop ☐ Auto-kasih diskon ☐ Tidak handle
- Apakah AI mention diferensiator unik?: ☐ Ya ☐ Tidak
- **Verdict T4:** ☐ PASS (smart objection handling) ☐ FAIL (over-discount/generic)

**Quote AI:** "______________________________________________"

---

### T5 — Sentiment negatif
**Prompt:** "udah 3 hari belum kirim padahal janji 1 hari, gimana sih?"

- AI response: ☐ Auto-escalate ke human ☐ Apology empati ☐ Generic scripted ☐ Tidak handle
- Tone empati: ☐ Real, sounds genuine ☐ Robotic scripted
- **Verdict T5:** ☐ PASS ☐ FAIL

**Observasi:** ___________________________________________________

---

### T6 — Vague query
**Prompt:** "kak yg bagus apa?"

- AI ask clarifying question relevan: ☐ Ya, tanya: _____________
- Atau respons generic ("kita punya banyak produk bagus..."): ☐ Ya
- **Verdict T6:** ☐ PASS (smart clarify) ☐ FAIL (dumb generic)

---

### T7 — Pickup vs delivery scenario
**Prompt:** "saya ke toko aja besok pagi, bisa ambil sendiri jam 9?"

- AI handle non-delivery: ☐ Ya ☐ Tidak
- AI tahu jam buka toko: ☐ Ya ☐ Tidak ☐ Tanya owner
- **Verdict T7:** ☐ PASS ☐ FAIL

---

### T8 — Multi-stock query
**Prompt:** "plafon 3m sama 4m, masing-masing berapa stoknya?"

- AI cek 2 produk sekaligus: ☐ Ya, kasih kedua angka ☐ Cuma 1 produk
- **Verdict T8:** ☐ PASS ☐ FAIL

---

### STRESS TEST SUMMARY

Total PASS: ____ / 8
Total FAIL: ____ / 8

Pola failure (mana yang sering fail):
___________________________________________________________________

**Verdict overall AI capability:** ☐ Strong (≥6 PASS) ☐ Average (4-5) ☐ Weak (≤3)

---

## PRICING (Halo AI custom-quote, gali pelan-pelan)

| Item | Angka real | Catatan |
|------|------------|---------|
| Entry tier monthly | Rp _____________ | Volume ____ chat/hari, ____ channel |
| AI Credit unit | ☐ per message ☐ per conversation ☐ per token |
| Credit termasuk di entry | ____________ /bulan |
| Top-up bundle terkecil | Rp _____________ dapat ________ credit |
| Setup fee | Rp _____________ ☐ Include |
| Training fee | Rp _____________ ☐ Include |
| Onboarding lama | ________ hari kerja |
| Minimal kontrak | ________ bulan |
| Refund policy | __________________________________________________ |
| Annual discount | ________% |
| Cash discount bayar di muka | ________% |
| Integrasi tambahan (Toped/Shopee/IG) | Rp _____________ per channel |

---

## AI Capabilities & Behavior

- LLM underlying: ☐ GPT-4 ☐ GPT-4o ☐ Gemini ☐ Llama self-hosted ☐ Custom ☐ Tidak disclose
- Latency rata-rata (claim sales): ________ detik
- Latency real dari stress test: ________ detik
- Fallback behavior kalau AI tidak tahu: ☐ Escalate human ☐ Bilang "tidak tahu" ☐ Halusinasi

## Knowledge Base & Training Data

- Format upload: ☐ PDF ☐ Word ☐ Excel ☐ Website crawl ☐ Manual entry
- Max ukuran per file: ________ MB
- Total storage: ________ GB
- Update knowledge: ☐ Auto-detect ☐ Manual trigger ☐ Re-upload semua
- Bulk import 5000 SKU produk: ☐ Excel template ☐ API ☐ Manual one-by-one
- AI belajar dari conversation history: ☐ Ya ☐ Tidak (static)
- Custom persona/tone: ☐ Ya, cara: __________ ☐ Tidak

## Channel Integration

- WhatsApp protocol: ☐ Cloud API ☐ Business API ☐ Web (whatsmeow-style)
- WA messaging cost: ☐ Include ☐ Pass-through Meta rate
- Instagram DM: ☐ Text ☐ Image ☐ Voice note ☐ Story reply
- Tokopedia integration: ☐ Read chat ☐ Read order ☐ Trigger action ☐ Tidak ada
- Shopee integration: ☐ Read chat ☐ Read order ☐ Trigger action ☐ Tidak ada
- Multi-channel unified inbox: ☐ Ya ☐ Tidak

## ERP / Backend Integration

- Read inventory dari Excel/Sheets real-time: ☐ Ya ☐ Tidak (perlu push manual)
- Order dari AI output: ☐ Draft di dashboard ☐ Webhook ke ERP ☐ Langsung jadi invoice di customer
- UI manage produk/stok built-in: ☐ Ya ☐ Tidak (AI layer only)
- Integrasi Jurnal native: ☐ Ya ☐ Tidak ☐ Via Zapier
- Integrasi Accurate native: ☐ Ya ☐ Tidak
- Payment integration: ☐ Midtrans ☐ Xendit ☐ DOKU ☐ Tidak native

## Human Handover

- Trigger handover: ☐ Keyword ☐ Sentiment negatif ☐ Confidence rendah ☐ Customer request explicit ☐ Manual admin
- Pause AI: ☐ Per-conversation ☐ Global only
- Multi-agent dashboard: ☐ Assignment ☐ Queue ☐ SLA tracking ☐ Tidak ada
- Audit log AI vs human: ☐ Ya ☐ Tidak

## Scalability & Limits

- Conversation simultan paket entry: ________
- Over-limit behavior: ☐ Queue ☐ Drop ☐ Charge extra
- Uptime SLA: ________% ☐ Tertulis di kontrak ☐ Verbal only
- Compensation kalau breach SLA: __________________

## Multi-Brand / Multi-Tenant

- 1 akun handle multi-brand: ☐ Ya, harga: _________ ☐ Tidak, perlu sub-account
- Reporting per brand: ☐ Ya ☐ Tidak

## Data Privacy & Compliance

- Server location: ☐ Indonesia ☐ Singapore ☐ US ☐ Tidak disclose
- Data train AI global: ☐ Ya ☐ Tidak (strictly per-tenant)
- Retention chat history: ________ bulan/tahun
- Delete on demand: ☐ Ya ☐ Tidak
- ISO/SOC2 cert: ☐ Ya ☐ Tidak

## Customer References

- MSME / toko material / LTC area customer: ☐ Ada nama: __________ ☐ Tidak
- Enterprise customer yang demo-able: ☐ Halodoc ☐ Massindo ☐ Heymale ☐ IELTSpresso ☐ Lainnya: ____

---

## TOP 3 TAKEAWAY

1. ___________________________________________________________________

2. ___________________________________________________________________

3. ___________________________________________________________________

---

## FITUR HALO AI **KUAT** (vs Calista):

- __________________________________________________
- __________________________________________________
- __________________________________________________

## FITUR HALO AI **LEMAH** (Vosi pitch ammunition):

- __________________________________________________
- __________________________________________________
- __________________________________________________

---

## QUOTE SALES NOTABLE

> "______________________________________________"
> (konteks: ____________________)

> "______________________________________________"
> (konteks: ____________________)

---

## PERTANYAAN MENYENTIL — JAWABAN

**Halo AI lebih unggul dari Qontak di mana:**
- __________________________________________________

**Halo AI lebih lemah dari Qontak di mana:**
- __________________________________________________

**Fitur paling sering di-request customer existing tapi belum ada:**
- __________________________________________________

**Alasan customer churn paling umum:**
- __________________________________________________

---

## MY OVERALL VERDICT

Halo AI sebagai competitor Calista:
- ☐ Strong direct competitor — head-on, harus serious
- ☐ Adjacent — Halo AI multi-channel, Calista WA-focus + ERP integrated
- ☐ Different segment — Halo AI enterprise, Vosi MSME

Vosi differentiation yang TERBUKTI dari stress test:
- __________________________________________________
- __________________________________________________

Vosi gap yang harus close ASAP berdasar demo ini:
- __________________________________________________
- __________________________________________________

Confidence Vosi win vs Halo AI di MSME segment: ☐ High ☐ Medium ☐ Low

Alasan: ___________________________________________________________________

---

## NEXT ACTION (untuk Claude)

Setelah upload screenshot stress test + UI demo + transcript:
- ☐ Gap analysis Calista vs Halo AI per kategori
- ☐ Stress test ammunition matrix (untuk landing copy)
- ☐ Roadmap improvement Calista — fitur prioritas
- ☐ Landing differentiation copy untuk Premium tier vs Halo AI
- ☐ Sales objection handling vs Halo AI
