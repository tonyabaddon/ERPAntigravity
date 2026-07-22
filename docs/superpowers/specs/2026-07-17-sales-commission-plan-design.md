# Caleo Sales Commission Plan — v1 Design

**Date:** 2026-07-17
**Status:** Draft — pending founder review
**Author:** Brainstorming session (Claude + founder)
**Companion docs:** `docs/business/pricing.md` (pricing v3), `docs/marketing/vosi-context-pack-2026-06-24.md`

> **Goal:** Freelance sales agent program yang **fair** (agent dapat cash cepat, transparan, tier-weighted supaya kerja keras terbayar) dan **menarik** (rate kompetitif vs pasar Indonesia B2B SaaS) dan **scalable** (bisa tumbuh dari 1 agent ke 20 agent tanpa rewrite aturan). Target: onboard 50 tenant di tahun 1 lewat channel agent.

---

## 1. Context & scope

### 1.1 Why freelance-agent (bukan FTE sales)

- Caleo sekarang di **Stage 0-1** (per `pricing.md` stage roadmap: 1-15 tenant, founder + 1 CS part-time).
- FTE sales rep = **Rp 17M/bln = Rp 204M/tahun** (per `pricing.md` Rule 1 tabel).
- Trigger MRR untuk hire FTE sales: **Rp 51M** (belum tercapai).
- Freelance agent = **variable cost only** — bayar per closing, tidak bakar runway pre-revenue.
- Skala fleksibel: 1 agent atau 10 agent, cost/tenant tetap flat.

### 1.2 Kerja agent (scope locked)

| Fase | Owner | Catatan |
|---|---|---|
| Prospecting (lead generation) | **Agent** | Network sendiri, WA outbound, kanvasing distributor, referral |
| Qualification | **Agent** | Cek fit tier (Starter/Pro/Premium) sebelum demo |
| Demo produk | **Agent** | Pakai script + demo tenant Caleo (sandbox) |
| Closing (kontrak + first payment) | **Agent** | Founder assist kalau tenant Premium (high-value) |
| Onboarding (catalog import + training) | **Founder** | 1-2 sesi training, Rp 1.5M-3.5M setup fee cover labor |
| First-month support | **Founder** | Ensures tenant activation |
| Renewal support | **Agent** (kalau masih aktif) | Touchpoint 60 hari sebelum renewal untuk lock retention |

**Rasional boundary agent → founder di titik closing:**

1. Onboarding = high-touch, konsisten kualitas hanya kalau founder handle (Stage 0-1).
2. Agent kekuatan di prospecting + closing; lemah di technical setup produk.
3. Clean accountability: agent = revenue-in, founder = delivery.

---

## 2. Commission structure

### 2.1 Rate — tier-weighted (bukan flat)

**Rasional:** margin Caleo per tier beda jauh. Flat rate = agent kejar Starter (paling gampang jual). Tier-weighted = agent kejar Premium (paling profitable).

| Tier | Rate % dari total upfront cash | Founder margin @ 12mo | Founder net after commission |
|---|---|---|---|
| **Starter** (6mo / 12mo) | **10%** | 33% | 23% |
| **Pro** (6mo / 12mo) | **15%** | 38% | 23% |
| **Premium** (6mo / 12mo) | **20%** | 66% | 46% ⭐ |

**Basis kalkulasi:** total upfront cash (subscription × months + setup fee). Setup fee **included** — sederhana, agent tidak perlu hitung split subscription vs setup.

### 2.2 Payout per closing — angka konkret

| Tier + Term | Upfront cash tenant bayar | Commission agent (rate applied) | Founder net cash |
|---|---|---|---|
| Starter 6mo | Rp 4,554,900 | **Rp 455,490** | Rp 4,099,410 |
| Starter 12mo | Rp 6,531,600 | **Rp 653,160** | Rp 5,878,440 |
| Pro 6mo | Rp 6,339,900 | **Rp 950,985** | Rp 5,388,915 |
| Pro 12mo | Rp 9,471,600 | **Rp 1,420,740** | Rp 8,050,860 |
| **Premium 6mo** | Rp 22,874,900 | **Rp 4,574,980** ⭐ | Rp 18,299,920 |
| **Premium 12mo** | Rp 35,411,600 | **Rp 7,082,320** ⭐ | Rp 28,329,280 |

**Motivational anchor:** 1 Premium 12mo closing = 10× Starter 12mo closing. Agent yang smart akan invest waktu di distributor B2B serious.

### 2.3 Renewal commission

**Rate: 5% dari upfront renewal cash. Cap: 1 renewal cycle.**

Syarat berbayar:
1. Agent masih **aktif** (kontrak jalan, tidak putus).
2. Agent punya **touchpoint dokumentasi** ke tenant dalam 60 hari sebelum renewal date (WA log, email, meeting notes disubmit ke founder).

Rasional cap 1 cycle:
- Setelah 1x renewal, tenant sudah "matured" → ownership pindah ke Caleo.
- Cegah agent parasit yang cuma nagih commission tanpa kontribusi lanjut.
- Financial obligation Caleo bounded, predictable.

**Contoh angka:** Pro 12mo renewal Rp 9,471,600 × 5% = **Rp 473,580** ke agent (kalau syarat terpenuhi).

### 2.4 Bonuses — DEFER ke v2

Base commission adalah foundation. Bonuses layer tambahan yang akan dikalibrasi setelah **3 bulan data actual**.

Kandidat bonuses untuk v2 review (jangan launch v1):

1. **Volume accelerator**: closing ≥ 4 tenant/bulan → semua closing bulan itu dapat +2pp bump.
2. **Premium mix bonus** (quarterly): ≥ 30% Premium dalam quarter → Rp 2jt cash bonus.
3. **Retention bonus** (quarterly): tenant agent dengan churn <10% dalam 12mo → Rp 5jt cash bonus.
4. **Top-agent leaderboard** (monthly): #1 agent by revenue → recognition + Rp 1jt cash.

**Kenapa defer:** salah threshold = agent kecewa (kalau terlalu tinggi) atau founder over-pay (kalau terlalu rendah). Data 3 bulan cukup untuk kalibrasi realistis.

---

## 3. Payment gate & payout cadence

### 3.1 Delayed payment (bukan clawback)

**Best practice:** clawback bikin ribut dan dispute. Delayed payment cleaner + aligned dengan money-back guarantee window.

Timeline:
```
Day 0    Deal ditandatangani; tenant bayar upfront
Day 3-7  Founder start onboarding; tenant go-live
Day 15   (14 hari setelah go-live) Money-back window CLOSED → commission EARNED
Tanggal 5 bulan berikutnya   Commission dibayar (batch monthly)
```

**Kalau tenant refund dalam 14 hari money-back window:**
- Commission tidak earned → no payout keluar
- No cash-back diminta dari agent
- Bersih tanpa dispute

### 3.2 Payout cadence

- **Frequency**: monthly, tanggal 5 bulan berikutnya
- **Method**: bank transfer, agent invoice Caleo (agent freelance = invoice sendiri)
- **Batch**: semua commission earned di bulan N dibayar tanggal 5 bulan N+1
- **Statement**: PDF payout statement per agent, includes:
  - List closing bulan itu (tenant name, tier, term, upfront cash, commission %)
  - Total gross commission
  - PPh withholding (jika applicable — lihat §7)
  - Net transfer amount
  - Bank details

### 3.3 Kasus edge

| Skenario | Handling |
|---|---|
| Tenant refund day 5 post-go-live | Commission tidak earned. Agent notified. |
| Tenant refund day 20 (past window) | Commission earned; kalau sudah dibayar, no clawback. |
| Tenant partial refund (mis. downgrade) | Commission earned untuk original amount; downgrade tidak trigger clawback. |
| Founder cancel karena bad-fit tenant | Commission tidak earned (kalau <14 hari); agent notified + reason documented. |
| Payment tenant late (mis. bayar day 10) | Deal Day 0 = date payment received, bukan date signed. |

---

## 4. Lead ownership & attribution

### 4.1 Aturan dasar

**Agent register lead BEFORE first contact.** No registration = no ownership = no commission jika deal close.

Flow:
1. Agent submit lead ke Google Sheet (Stage 0-1) atau Caleo admin (Stage 2+)
2. Lead terdaftar → **agent own untuk 90 hari** dari tanggal register
3. Kalau 90 hari lewat tanpa closing → lead **re-open**; agent lain bisa claim, atau founder handle
4. Extension: agent bisa apply extension +30 hari kalau ada progress documented (mis. demo scheduled)

### 4.2 Inbound leads (dari landing, ads, referral, WA masuk)

**Milik founder, TIDAK commissionable.** Rasional:
- Founder yang bayar CAC lewat marketing spend.
- Commission untuk *outbound* work, bukan free money dari inbound funnel.
- Founder handle inbound qualification → kalau ada yang butuh agent handhold demo, founder assign dengan **flat close fee** (mis. Rp 500K per closing, bukan %).

### 4.3 Dispute resolution

Jarang terjadi kalau registration disiplin. Kalau ada:
1. **Cek timestamp** di Google Sheet — first registered wins.
2. **Cek dokumentasi kontak** — WA log, email thread siapa yang first meaningful contact.
3. **Founder final arbiter** — keputusan final, tidak boleh renego di kemudian hari.

### 4.4 Multi-agent collab (v2 consideration)

Kalau 2 agent bawa 1 tenant (mis. agent A intro, agent B close):
- **v1**: split 60/40 (closer 60, intro 40) — opsi manual, disepakati sebelum closing
- **v2**: build formal referral bonus system

---

## 5. Contract essentials — Sales Agent Agreement (SAA)

Isi minimum (draft dengan lawyer sebelum agent pertama sign):

### 5.1 Scope of work
- Full-cycle prospecting → closing
- Explicitly **NOT** includes: onboarding, tenant technical support, product customization
- Explicitly **NOT** an employee; independent contractor

### 5.2 Compensation
- Commission schedule attached (§2.2 tabel)
- Payment terms (§3)
- Currency: IDR
- Tax: gross-of-tax; agent responsible for own PPh (see §7)

### 5.3 Lead & customer ownership
- Lead registration required (§4.1)
- Tenant = milik Caleo, bukan agent
- Agent tidak boleh contact tenant post-termination (kecuali agent yang sedang aktif untuk renewal servicing)

### 5.4 Non-solicitation
- 12 bulan post-termination
- Agent tidak boleh solicit tenant Caleo untuk produk kompetitor (Mekari Jurnal, Kontak, Desty, dsb)
- Enforcement: liquidated damages 3× last-year commission per breached tenant

### 5.5 Confidentiality
- Pricing internal, roadmap, tenant list, competitive intel = confidential
- Berlaku selama kontrak + 24 bulan post-termination

### 5.6 IP
- Marketing materials, demo scripts, battle cards = milik Caleo
- Agent boleh gunakan selama kontrak; wajib return/delete post-termination

### 5.7 Termination
- **Either party**: 30-day written notice
- **For cause** (misrepresent produk, ambil tenant ke kompetitor, breach confidentiality): immediate, no notice
- Post-termination: agent settle in-flight deals (commission untuk closing yang tanda tangan sebelum termination date + pipeline dispute per §4.3)
- No severance, no last-month guarantee

### 5.8 Warranties
- Agent warrant: representation produk sesuai dengan pricing sheet + battle card resmi (tidak bikin janji palsu)
- Founder warrant: bayar commission tepat waktu selama syarat terpenuhi
- Both: undertake code of conduct (no misleading, no bribery, no under-the-table pricing)

### 5.9 Governing law & dispute
- Indonesian law
- Dispute resolution: BANI arbitration (single arbitrator, Jakarta) — lebih murah dari pengadilan

---

## 6. Tracking system — MVP → Scalable

### 6.1 Stage 0-1 (sekarang, <15 tenant): Google Sheet + WA group

**Google Sheet structure:**

Sheet 1 — **Lead Registry**
| Kolom | Isi |
|---|---|
| lead_id | Auto (row number) |
| agent_name | Dropdown daftar agent aktif |
| lead_name | Nama company prospek |
| pic_name | Nama PIC + jabatan |
| phone | WA / phone |
| registered_at | Auto-timestamp saat register |
| tier_target | Starter / Pro / Premium |
| stage | Registered → Contacted → Demo → Proposal → Closed-Won → Closed-Lost |
| close_date | Isi manual saat closing |
| term | 6mo / 12mo |
| upfront_cash | Auto-calc dari tier + term |
| commission_gross | Auto-calc |
| commission_payable_date | Auto: close_date + 15 hari + next 5th |
| notes | Free text |

Sheet 2 — **Monthly Payout Log**
| agent_name | period | total_gross | pph_withhold | net_transfer | paid_at | invoice_ref |

Sheet 3 — **Agent Roster**
| agent_name | contact | NPWP | bank_account | contract_start | contract_end | status |

**WA group**: `[Caleo] Agent Sales` — untuk register cepat (agent ping founder, founder input Sheet), share update, Q&A.

**Founder responsibility**: verify closing (cek subscription active di DB), input ke Sheet, monthly payout batch.

### 6.2 Stage 2+ (>15 tenant): dogfood ke Caleo admin

Build sales pipeline module ke `admin.caleo.id`:
- Agent portal login → lihat lead pipeline sendiri, register lead baru, lihat commission history
- Founder view: all-agent dashboard, approve closing, generate payout statement PDF
- Auto integrasi dengan Caleo subscription DB (closing detected auto → commission calculated)

**Jangan invest di custom tool sebelum ada volume**. Stage 0-1 Google Sheet cukup.

---

## 7. Tax handling (Indonesia freelance)

### 7.1 Status agent

- Independent contractor / freelance = **Bukan Pegawai** untuk pajak Indonesia
- Wajib punya NPWP untuk dapat commission > Rp 4.5jt/bulan (per aturan PPh)

### 7.2 Withholding oleh Caleo

**Wajib konsultasi accountant sebelum agent pertama**, tapi baseline umum:

| Situasi agent | Withholding oleh Caleo |
|---|---|
| Punya NPWP + PKP | Tidak ada withholding (agent invoice + bayar PPN sendiri) |
| Punya NPWP + Non-PKP + berkelanjutan (>2 bulan) | PPh 21 progressive (5%-30%), lebih ribet |
| Punya NPWP + Non-PKP + one-off | PPh 21 final 2.5% (Bukan Pegawai occasional) |
| Tidak punya NPWP | PPh 21 20% higher rate (penalty) |

**Recommended:** wajib agent punya NPWP; Caleo withhold 2.5% PPh 21 final untuk semua commission; issue bukti potong per bulan; agent file SPT tahunan sendiri.

**Action item pre-launch:** founder konsultasi accountant untuk konfirmasi treatment yang tepat (bisa berubah dengan aturan PPh terbaru).

### 7.3 Contoh net calculation

Pro 12mo closing → gross commission Rp 1,420,740
- Withhold PPh 21 final 2.5%: Rp 35,519
- **Net transfer ke agent: Rp 1,385,221**
- Caleo remit PPh 21 ke DJP via SPT Masa
- Bukti potong bulanan ke agent → agent kredit di SPT tahunan

---

## 8. Agent onboarding pack (Day-1 kit)

Sekali bikin, reusable untuk setiap agent baru.

### 8.1 Materi

1. **Pricing sheet 1-page PDF** — tier, harga effective, setup fee, terms
2. **Demo script** — 30-min flow, screenshot 4-5 fitur inti (Kasir, Stok, Kasbank, Executive Dashboard, [Premium] Calista chat)
3. **Battle card** — Caleo vs Mekari Jurnal / Kontak / Desty (pakai `pricing.md` §competitive context)
4. **ROI calculator Excel** — input tenant monthly omzet, output "kerugian fraud + lupa nagih vs Caleo cost" pattern per `docs/marketing/canva-briefs/wa-poster-v1-square-1080x1080-2026-06-24.md`
5. **WA templates** — cold outreach, follow-up 3-touch, objection handling
6. **Objection cheatsheet** — top 10 keberatan + jawaban (mis. "Sudah pakai Excel", "Terlalu mahal", "Ribet setup", "Sudah pakai Mekari")
7. **Case study anonymized** — "Owner distributor 12 tahun di Jakarta" (jangan sebut Garindo — per feedback memory `no_garindo_disclosure`)
8. **Training session** — 2 jam Zoom / offline, walkthrough produk + Q&A

### 8.2 Training curriculum

Session 1 (2 jam):
- 0:00 — Overview Caleo (target market, tier, positioning)
- 0:20 — Demo produk hands-on (Kasir, Stok, Kasbank, Executive)
- 1:00 — Pitch script + objection handling role-play
- 1:30 — Pricing sheet + battle card + ROI calculator walkthrough
- 1:50 — Q&A + agenda 7 hari pertama

Session 2 (opsional, 1 jam, minggu ke-2):
- Review pipeline agent
- Deep-dive Premium tier (Calista AI value pitch — biggest revenue driver)
- Advanced objection scenarios

### 8.3 Ongoing support

- **WA group** `[Caleo] Agent Sales` — Q&A real-time, share wins, share objection new patterns
- **Monthly all-hands** 30 min — leaderboard, product update, pipeline review
- **1:1 pipeline review** kalau agent request (founder time-boxed 30 min per bulan)

---

## 9. Cost sanity check

### 9.1 Skenario 50 tenant target (mix 35/45/20 Starter/Pro/Premium, 50/50 6mo/12mo split)

Dari `pricing.md` v3 tentative: cash upfront masuk ~Rp 510-540M.

| Tier | Count | Avg upfront/tenant | Rate | Commission cost total |
|---|---|---|---|---|
| Starter | 17 | ~Rp 5,543K | 10% | Rp 9,423K |
| Pro | 23 | ~Rp 7,906K | 15% | Rp 27,275K |
| Premium | 10 | ~Rp 29,143K | 20% | Rp 58,286K |
| **Total** | **50** | | | **~Rp 94.9M** |

- Commission cost / gross upfront cash: **~18%** ✅ (best practice B2B SaaS: 15-25%)
- Commission cost / annualized revenue: **~14%** ✅ (best practice: 10-20%)

### 9.2 Vs FTE alternative

FTE sales rep cost: **Rp 17M/mo × 12 = Rp 204M/tahun** (per `pricing.md` Rule 1)

Break-even 1 FTE = FTE harus close ≥ 108 tenant/tahun untuk match commission cost dari 50 freelance-agent closings. Realistis 1 FTE closes 30-50 tenant/tahun (2-4/bulan).

**Verdict:** freelance-agent lebih hemat 2× di Stage 0-1, dengan syarat kualitas agent tersedia.

### 9.3 Ceiling analysis

Kalau agent program sukses dan bawa 100 tenant di tahun 2 (mix stabil):
- Cash upfront: ~Rp 1.02-1.08M
- Commission cost: ~Rp 190M
- Founder net cash: ~Rp 830-890M

Di tenant 100+, worth consider hire **sales manager** (Rp 30M/mo) untuk manage agent fleet, plus retain freelance model untuk field execution. Hybrid pattern di Stage 4+.

---

## 10. Rollout plan

### Bulan 1 — Setup
- [ ] Founder konsultasi lawyer → draft Sales Agent Agreement (finalize §5)
- [ ] Founder konsultasi accountant → confirm PPh treatment (finalize §7)
- [ ] Bikin agent onboarding pack (§8.1) — 1 batch materi
- [ ] Setup Google Sheet tracking (§6.1)
- [ ] Rekrut 1-2 agent pertama (referral network, LinkedIn, Glodok distributor community)

### Bulan 2 — Launch batch 1
- [ ] Onboarding + training session 2 jam per agent
- [ ] Agent mulai prospecting
- [ ] Founder observe: pipeline quality, objection patterns, conversion rate
- [ ] Weekly pipeline review 30 min

### Bulan 3 — Iterate
- [ ] First closings expected (jika agent quality bagus)
- [ ] First payout batch monthly cycle
- [ ] Refine pricing sheet, demo script based on real objection patterns

### Bulan 4-6 — Data collection
- [ ] Track KPIs (§11)
- [ ] Kalau agent bagus (>3 closing/bulan), review v2 dengan bonus system
- [ ] Kalau agent buruk (<1 closing/bulan), review recruitment source atau rate calibration

### Bulan 6+ — Scale
- [ ] Recruit batch 2 (5-10 agent) kalau batch 1 proven
- [ ] Formalize sales ops (dedicated founder time 25% ke agent management, atau hire junior sales ops)
- [ ] Stage 2 trigger: build sales pipeline module ke Caleo admin (§6.2)

---

## 11. KPIs & v2 review triggers

### 11.1 Track monthly

| KPI | Target | Alert kalau |
|---|---|---|
| Closings per agent per bulan | ≥ 2 | < 1 for 2 bulan berturut → review agent atau pattern |
| Conversion rate lead → close | ≥ 15% | < 10% → objection pattern issue atau lead quality |
| Premium mix (dari total closings) | ≥ 20% | < 10% → agent tidak pitch Premium value cukup |
| Average sales cycle (register → close) | ≤ 30 hari | > 45 hari → pipeline stagnan, follow-up buruk |
| Commission cost / upfront cash | ≤ 20% | > 25% → mix tilt ke Premium (good) atau bonus over-generous (rebalance) |
| Tenant churn dalam 14-hari money-back window | < 5% | > 10% → agent misrepresent produk (education issue) |
| Renewal rate (setelah cycle pertama) | ≥ 70% | < 60% → onboarding quality issue atau bad-fit tenants |

### 11.2 v2 review triggers

Review commission plan v1 → v2 kalau:

1. **3 bulan data terkumpul** dengan ≥ 2 agent aktif dan ≥ 15 closings — waktu untuk kalibrasi bonuses.
2. **Premium mix < 15%** — insentif tier-weighted tidak cukup; consider raise Premium rate atau bonus.
3. **Churn dalam window > 10%** — agent misrepresent; consider raise money-back window ke 30 hari atau clawback layer.
4. **Agent complaints ≥ 3** patterns berulang (mis. "payout terlambat", "aturan tidak jelas") — revisit terms.
5. **Founder time > 25%** habis ke agent management — consider hire sales ops.

### 11.3 v2 kandidat changes

- Add bonuses layer (volume, Premium mix, retention) dengan threshold data-driven
- Add multi-agent collab / referral split formal
- Migrate tracking dari Sheet ke Caleo admin
- Introduce tiered agent status (Junior/Senior/Elite) dengan rate differential
- Territory / vertical assignment (mis. agent khusus F&B, agent khusus Grosir Glodok)

---

## 12. Open questions (untuk founder decide)

1. **NPWP mandatory untuk agent?** — Recommended YA (per §7); confirm dengan accountant apakah bisa dispensasi untuk agent occasional.
2. **BANI arbitration atau pengadilan biasa?** — §5.9 recommend BANI (lebih cepat + murah). Founder OK?
3. **Non-solicitation liquidated damages** — 3× last-year commission per breached tenant OK? Atau lebih ringan (mis. 1×)?
4. **Inbound lead flat close fee** — Rp 500K per closing kalau agent bantu close inbound lead (per §4.2). OK atau tidak?
5. **Multi-agent collab v1 split 60/40** (per §4.4) — OK atau defer semua ke v2?
6. **Renewal touchpoint requirement** — 60 hari sebelum renewal (§2.3). OK atau longer/shorter?
7. **Money-back window default** = 14 hari (per `pricing.md` v3 rekomendasi). Confirm sudah locked?
8. **Founder time allocation untuk agent management** — target < 25%. Kalau melebihi, hire sales ops (Rp 8-12M/mo) — trigger MRR?

---

## 13. Related documents

- `docs/business/pricing.md` v3 — pricing tier + margin analysis (SOURCE OF TRUTH untuk angka)
- `docs/marketing/vosi-context-pack-2026-06-24.md` — GTM positioning + competitive
- `docs/marketing/canva-briefs/wa-poster-v1-square-1080x1080-2026-06-24.md` — messaging templates (referable untuk demo script + WA outreach)
- `docs/marketing/fraud-controls-pitch-2026-07-11.md` — fraud angle pitch (Premium tier value driver)

---

## 14. Version history

- **v1 (2026-07-17):** Initial draft. Full-cycle freelance agent, tier-weighted 10/15/20%, delayed payment (no clawback), 5% renewal cap 1-cycle, Google Sheet tracking MVP, bonuses deferred to v2.

---

*Next review trigger: 3 bulan post-launch OR any KPI alert per §11.1. Update v1 → v2 spec kalau material change.*
