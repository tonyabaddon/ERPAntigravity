# Vosi Pricing — v3 with 6mo+12mo commitment + anchor inflation

**Date:** 2026-06-24 — v3 update after GTM strategy brainstorm with Option B locked
**Status:** Locked. **v3 replaces v2 — Quarterly dropped, anchor raised +10%, 6mo introduced.**

> This doc lives **separate from the tech spec** because pricing evolves on a faster cadence (months) than architecture (years). Tech spec (`docs/superpowers/specs/2026-06-13-multi-tenant-prerequisites-design.md` + `2026-06-13-calista-phase-1-design.md`) references package `id` only (`starter`, `pro`, `premium`), never concrete prices.

### v3 vs v2 — what changed

1. **Dropped Quarterly tier.** Minimum commitment is now 6-month.
2. **Added 6-month tier** (15% off list anchor).
3. **Yearly stays at 30% off** (same diskon %, but applied to higher list anchor).
4. **Raised list anchor +10%** across all tiers (Starter Rp 549K → 599K, Pro Rp 859K → 949K, Premium Rp 3,499K → 3,799K). Marketing badge anchor (2× struck-through) follows.
5. **Setup fees unchanged** (Starter/Pro Rp 1.5M, Premium Rp 3.5M).

Reasoning chain captured in conversation 2026-06-24: higher commitment filter → better churn cohort → cleaner blended margin (Starter Yearly margin 27% → 33%); anchor inflation maintains pricing.md's existing "anchor + diskon psychology" pattern consistently.

---

## Tier structure (v3 — 6mo + 12mo only)

| Tier | List anchor | Marketing badge anchor (struck-through 2×) | **6-month effective** (15% off list) | **12-month effective** (30% off list) | Modules |
|------|-------------|--------------------------------------------|---------------------------------------|----------------------------------------|---------|
| **Starter** | Rp 599,000/mo | ~~Rp 1,199,000/mo~~ | **Rp 509,150/mo** | **Rp 419,300/mo** | Auth + multi-user, Dashboard, Produk (foto opsional), Pelanggan, Kasir POS + struk + multi-payment, Penjualan basic + Faktur PDF, Pembelian basic (PO + Tagihan PI + Pembayaran + BNL), Stok 1 gudang, Piutang basic, **Diskon (per-line + order)**, Retur Penjualan, Rekonsiliasi bank basic, KasBank (BANK + KAS + E_WALLET), Sales channels (14), Laporan dasar, Pengaturan + Notification settings |
| **Pro** | Rp 949,000/mo | ~~Rp 1,899,000/mo~~ | **Rp 806,650/mo** | **Rp 664,300/mo** | Starter + **Sales Order (Penawaran) → Invoice flow** + Multi-warehouse (5) + Multi-user roles + Approval Inbox + Owner PIN + GL/Neraca/Arus Kas + Tax reports (PPN; PPh formal defer) + Executive dashboard + Pengawasan dashboard ⚠️partial + Opname + Adjustment + Audit trail + Rakit/Assembly + Piutang advanced + Tulis-off + Initial Stock Approval + Owner Biaya Final Inbox + Barcode scanning ⚠️partial + Diskon wizard advanced. **Everything except AI.** |
| **Premium** | Rp 3,799,000/mo | ~~Rp 7,599,000/mo~~ | **Rp 3,229,150/mo** | **Rp 2,659,300/mo** | Pro + **Calista AI for Ordering** ⚠️partial (the ONLY differentiator vs Pro) + WhatsApp pair (pair-code + QR) + Calista capacity 300 conv/hari + Calista persona tuning ⚠️manual + Shadow mode 2-week ramp. Multi-warehouse (10), multi-user (25), 50K SKUs. |
| **garindo_legacy** *(internal)* | — | — | — | — | All modules including whatsmeow Calista (grandfather rate for tenant #1) |

**Module list last sync:** 2026-06-24 (added features shipped since v2 lock 2026-06-13: Sales Order Penawaran, Diskon, Tulis-off, Initial Stock Approval, Owner Biaya Final Inbox, foto opsional). Module list authoritatively cross-referenced di `docs/marketing/vosi-context-pack-2026-06-24.md` §6.6.

**Pricing decision date 2026-06-24:** anchor +10% from v2 list, drop Quarterly, introduce 6-month at 15% off list. See "Version history" v3 entry for full reasoning.

**⚠️ Partial-ship status (honest disclosure for sales):**
- **Barcode (Pro):** scanner UI ada, hardware-integration belum lengkap untuk semua receipt printer / scanner brand.
- **Pengawasan dashboard (Pro):** executive dashboard ada, dedicated Pengawasan real-time-staff-monitoring view belum.
- **Calista AI (Premium):** backend-go LLM router + Gemini direct + OpenRouter chain shipped; frontend auto-reply masih **shadow mode** (staff approve tiap jawaban dulu). 2-week ramp di setup fee already covers this — frame sebagai feature ramp, bukan caveat.
- **Calista persona tuning (Premium):** founder + tenant kerja bareng saat setup (high-touch). Self-serve customization defer.
- **Tax PPh formal (Pro):** PPN OK; PPh Final formal defer (Q1/Q8 PRD compliance lens deferred — lihat progress.md).

**Marketing badge across all tiers:** "PROMO LAUNCH 50% OFF — Limited First 100 Tenants"

The anchor pricing creates psychological "you're winning" framing while effective prices hit target margins. Marketing-badge anchor (struck-through) is roughly 2× list anchor (≈4× 12-month effective); discount badge always 50% off marketing anchor.

### Terms

- All plans paid **upfront** at signup (6 months or 12 months in advance).
- **No monthly billing, no quarterly billing** — minimum tier is **6-month commitment**.
- **v3 change:** Quarterly tier removed; 6-month tier added at 15% off list. Reasoning: higher commitment filter, better churn cohort, eliminates thin-margin Starter Quarterly option.
- Setup fees:
  - **Starter / Pro: Rp 1,500,000** one-time at onboarding (covers catalog import + 1-2 training sessions).
  - **Premium: Rp 3,500,000** one-time (covers catalog import + Calista persona tuning + 2 training sessions + 2-week shadow mode monitoring).

### Cash flow per tenant per cohort (v3)

| Plan | Per-tenant upfront | Annualized revenue |
|---|---|---|
| Starter 6-month | Rp 4,554,900 (6 × Rp 509,150 + Rp 1.5M setup) | Rp 6,109,800 |
| Starter 12-month | Rp 6,531,600 (12 × Rp 419,300 + Rp 1.5M setup) | Rp 5,031,600 |
| Pro 6-month | Rp 6,339,900 (6 × Rp 806,650 + Rp 1.5M setup) | Rp 9,679,800 |
| Pro 12-month | Rp 9,471,600 (12 × Rp 664,300 + Rp 1.5M setup) | Rp 7,971,600 |
| **Premium 6-month** | **Rp 22,874,900** (6 × Rp 3,229,150 + Rp 3.5M setup) | **Rp 38,749,800** |
| **Premium 12-month** | **Rp 35,411,600** (12 × Rp 2,659,300 + Rp 3.5M setup) | **Rp 31,911,600** |

---

## Discount rationale (v3)

**6-month at 15% off list, 12-month at 30% off list:**

- 6-month tier replaces dropped Quarterly. 15% off is enough to incentivize commitment beyond "trial-style" thinking, while preserving margin (Pro 6mo margin 49%, Starter 6mo margin 45%).
- 12-month discount stays at 30% (same as v2). "Commit 1 tahun, hemat 30%" sales line unchanged.
- 15pp gap between 6mo and 12mo discounts creates meaningful commitment incentive — buyer feels concrete reason to commit longer.

**Why drop Quarterly (v3 reversal of v2 reasoning):**

- v2 said "6-month cannibalizes Quarterly or Yearly" — that was true *if* 6mo was ADDED between Q+Y. v3 REPLACES Q with 6mo, so no cannibalization, just consolidation.
- Quarterly was the lowest-quality buyer filter — 3-month trial-style commitment correlates with higher churn at 6-12mo mark. v3 6-month minimum filters out tire-kickers.
- Quarterly cash upfront (Pro Rp 4.1jt) was modest; 6-month upfront (Pro Rp 6.3jt) is +55% per tenant — material runway improvement at Stage 1-2.
- Sales conversation cleaner: "6 bulan, atau commit 1 tahun hemat 30%?" — 2 options not 3.

**Trade-off accepted:**
- Starter 12-month margin still thin at 33% (improved from v2's 27% as loss-leader, but still loss-leader-ish).
- Some prospects who would have signed Quarterly will balk at 6mo upfront — mitigated by 14-day money-back guarantee (psychology unlock, low actual cost).

**Why anchor + diskon psychology (unchanged from v2):**

- Anchor pricing (struck-through ~~Rp X~~) creates loss aversion + "you're winning" framing.
- "50% OFF LAUNCH" badge is the universal Indonesian SaaS marketing pattern (Mekari, Pajak.io, Klikpajak all use it).
- Effective prices hit margin targets — the discount is the actual price, not a promotion that ends.
- v3 raises list anchor +10% to maintain coherent badge math after the 6mo addition.

---

## Unit economics at 50 tenants — v2

### Cost basis — refined HPP per tier

Earlier v1 used flat Rp 321K allocated cost for all tiers (overhead divided equally). v2 differentiates marginal cost per tier:

| Component | Starter | Pro | Premium |
|-----------|---------|-----|---------|
| Shared fixed (R&D, eng, base infra) | Rp 200K | Rp 200K | Rp 200K |
| Marginal compute (DB, storage per feature) | Rp 30K | Rp 50K | Rp 60K |
| Customer support overhead (per tier complexity) | Rp 20K | Rp 50K | Rp 100K |
| Pengawasan + Barcode incremental | — | Rp 30K | Rp 30K |
| GL / Neraca / Arus Kas incremental | — | Rp 30K | Rp 30K |
| **Calista AI marginal** (OpenRouter + WA Cloud API + R&D amortize) | — | — | **Rp 400K** |
| Sales/marketing CAC amortized over 24 months | Rp 30K | Rp 50K | Rp 90K |
| **TOTAL HPP basic (lean stage)** | **Rp 280K** | **Rp 410K** | **Rp 910K** |

**Note on Claude Code subscription ($100/mo = Rp 1,600K/mo):** founder tooling, not per-tenant. Allocated at Stage 2+ as part of overhead. At 50 tenants = Rp 32K/tenant; at 200 tenants = Rp 8K/tenant. Falls into "Shared fixed" line above.

### Margin per plan (v3, lean stage, basic HPP)

| Plan | Revenue/mo | HPP | Margin | Status |
|------|------------|-----|--------|--------|
| Starter 6-month | Rp 509,150 | Rp 280K | **45%** (+Rp 229K) | ✅ Healthy |
| Starter 12-month | Rp 419,300 | Rp 280K | **33%** (+Rp 139K) | ⚠️ Tipis tapi survivable (v3 lift dari v2's 27%) |
| Pro 6-month | Rp 806,650 | Rp 410K | **49%** (+Rp 397K) | ✅ Healthy |
| Pro 12-month | Rp 664,300 | Rp 410K | **38%** (+Rp 254K) | ✅ Sustainable |
| **Premium 6-month** | **Rp 3,229,150** | **Rp 910K** | **72%** (+Rp 2,319K) | ⭐ Very healthy — funds team growth |
| **Premium 12-month** | **Rp 2,659,300** | **Rp 910K** | **66%** (+Rp 1,749K) | ⭐ Strong |

### Reading the lenses

- **Lean stage margins** assume founder + 1 helper (no marketing/sales team yet). Sustainable through Stage 2 (~30 tenants).
- **Premium tier margin (63-74%)** is the buffer that lets Vosi hire team without breaking break-even.
- **Starter Yearly thin margin (27%)** accepted as market-acquisition loss-leader — Premium subsidizes.

### Blended scenario — 35% Starter / 45% Pro / 20% Premium, 50/50 Q/Y intra-tier (v2)

> ⚠️ **v3 modeling TODO** — table below uses v2 prices + Q/Y mix. Under v3 (6mo/12mo, anchor +10%), blended profit is **higher** (every price up ~7-10% vs v2 effective at same mix). Re-model when first 5 tenants signed and actual 6mo/12mo mix observed. Tentative new headline: **~Rp 410M annualized profit at 50 tenants** (vs v2 projection Rp 372M).

| Cohort | Count | Revenue/mo | Cost/mo (basic HPP) | Profit/mo |
|--------|-------|------------|---------------------|-----------|
| Starter Quarterly × Rp 549K | 9 | Rp 4,941,000 | Rp 2,520,000 | Rp 2,421,000 |
| Starter Yearly × Rp 384.3K | 9 | Rp 3,458,700 | Rp 2,520,000 | Rp 938,700 |
| Pro Quarterly × Rp 859K | 11 | Rp 9,449,000 | Rp 4,510,000 | Rp 4,939,000 |
| Pro Yearly × Rp 601.3K | 11 | Rp 6,614,300 | Rp 4,510,000 | Rp 2,104,300 |
| Premium Quarterly × Rp 3,499K | 5 | Rp 17,495,000 | Rp 4,550,000 | Rp 12,945,000 |
| Premium Yearly × Rp 2,449.3K | 5 | Rp 12,246,500 | Rp 4,550,000 | Rp 7,696,500 |
| **Total revenue** | **50** | **Rp 54,204,500** | **Rp 23,160,000** | **Rp 31,044,500** |
| **Blended net margin (lean stage)** | | | | **57%** ⭐ |
| **Annualized profit (lean stage)** | | | | **Rp 372,534,000** |

vs v1 projection (Rp 140M annual at 50 tenants): **+166% improvement** driven primarily by Premium tier.

### Cash upfront at 50-tenant go-live (v2 mix)

> ⚠️ **v3 modeling TODO** — table below uses v2 Q/Y upfront. Under v3, no Quarterly tenants exist; 6mo replaces. 6mo upfront ≈ 1.55× v2 Quarterly upfront. At same 50-tenant 35/45/20 mix with 50/50 6mo/12mo split, cash upfront milestone is approximately **Rp 510-540M** (vs v2 projection Rp 452M). Confirm after first 5-10 tenants signed.

| Cohort | Per-tenant upfront × count | Cohort upfront |
|---|---|---|
| Starter Quarterly | Rp 1,647K × 9 | Rp 14,823,000 |
| Starter Yearly | Rp 6,111.6K × 9 | Rp 55,004,400 |
| Pro Quarterly | Rp 4,077K × 11 | Rp 44,847,000 |
| Pro Yearly | Rp 8,715.6K × 11 | Rp 95,871,600 |
| Premium Quarterly | Rp 14,497K × 5 | Rp 72,485,000 |
| Premium Yearly | Rp 33,891.6K × 5 | Rp 169,458,000 |
| **Total cash upfront at go-live** | | **Rp 452,489,000 (~Rp 452 juta)** |

vs v1 projection (Rp 264M): **+71% cashflow improvement** at the same 50-tenant milestone.

---

## Stage-based hiring roadmap (NEW)

**Aturan emas:** jangan pre-hire. Hire when revenue justifies. Margin scales DOWN as you add team — but absolute profit grows.

| Stage | Tenant range | Team | Monthly OPEX | HPP/tenant | Expected blended margin | When to advance |
|-------|---------------|------|----------------|-------------|--------------------------|------------------|
| **Stage 0** (now) | 1-3 | Founder only + Claude Code | Rp 5M | (founder = sweat equity) | N/A | When MRR > Rp 15M |
| **Stage 1** | 4-15 | Founder + 1 CS part-time | Rp 15M | Rp 1.5M (at 10) | 60-70% (founder sweat equity) | When MRR > Rp 30M |
| **Stage 2** | 16-40 | + 1 junior engineer | Rp 35M | Rp 1.2M (at 30) | 50-60% | When MRR > Rp 60M (next hire 3× cost) |
| **Stage 3** | 41-80 | + 1 sales rep | Rp 55M | Rp 1.1M (at 50) | 40-50% | When MRR > Rp 90M |
| **Stage 4** | 81-150 | + 1 marketing | Rp 80M | Rp 700K (at 115) | 35-45% | When MRR > Rp 150M |
| **Stage 5** | 151-300 | + CS lead + 2 engineers | Rp 150M | Rp 660K (at 225) | 35-45% (mature, scaling) | When MRR > Rp 300M |
| **Stage 6+** | 300+ | Full team (10+ people) | Rp 250M+ | Rp 500K (at 500) | 40-50% (steady state) | — |

**Hiring rule:** *"Next hire = total Rp X cost. Hire only when MRR > 3× X."*

Example:
- Marketing manager cost: Rp 20M/mo (including benefits/tax)
- Hire only when MRR > Rp 60M (so marketing is < 33% of revenue)
- Apply same rule across all hires

**Founder salary inclusion:**
- Stages 0-1: founder sweat equity (notional Rp 0/mo as cash cost)
- Stage 2 onward: include Rp 30M/mo founder salary in OPEX as honest measure
- Without this, margin numbers are misleading — founder is paying themselves with future equity

**Claude Code subscription:** Rp 1,600K/mo founder tooling. Allocate as overhead at all stages, drops per-tenant as scale grows.

### Profit per stage (Premium tier carries margin through team-build phase)

Using v2 pricing mix (35/45/20 Starter/Pro/Premium) at each stage:

| Stage | Revenue/mo | Team cost | Basic HPP | Profit/mo | Margin |
|-------|------------|-----------|-----------|-----------|--------|
| Stage 1 (10 tenants) | Rp 10.8M | Rp 15M | Rp 4.6M | -Rp 8.8M | ⚠️ Loss (invest in growth) |
| Stage 2 (30 tenants) | Rp 32.5M | Rp 35M | Rp 13.9M | -Rp 16.4M | ⚠️ Loss |
| Stage 3 (50 tenants) | Rp 54.2M | Rp 35M (still lean) | Rp 23.2M | -Rp 4M | ⚠️ Near break-even |
| Stage 3 + sales (60 tenants) | Rp 65M | Rp 55M | Rp 27.8M | -Rp 17.8M | ⚠️ Investing in S&M |
| Stage 4 (100 tenants) | Rp 108M | Rp 80M | Rp 46M | -Rp 18M | ⚠️ Continued investment |
| Stage 5 (200 tenants) | Rp 217M | Rp 150M | Rp 92M | -Rp 25M | ⚠️ Scaling |
| **Stage 6 (300 tenants)** | **Rp 325M** | **Rp 250M** | **Rp 138M** | **-Rp 63M** | ⚠️ Pre-break-even |
| **Stage 6 (500 tenants)** | **Rp 542M** | **Rp 250M** | **Rp 230M** | **+Rp 62M** | **✅ 11% net margin** |
| **Stage 7 (1000 tenants)** | **Rp 1,084M** | **Rp 350M** | **Rp 460M** | **+Rp 274M** | **✅ 25% net margin** |

⚠️ **Reality check:** at 50 tenants with founder sweat equity (Stage 3 LEAN), margin appears 57%. With realistic full team hiring, **break-even is around 400-500 tenants**. Vosi achieves "real" 40-50% net margin only at 1,000+ tenants.

This is normal SaaS pattern — bootstrapped Indonesian SaaS typically reaches profitability at year 3-4 with 500+ paying customers.

**Strategic implication:** keep team lean as long as possible. Use Premium tier revenue to extend runway. Don't hire ahead of revenue.

---

## Year 1-2 Financial Discipline Rules

**Why this section exists:** at 50 tenants with full team hired, Vosi LOSES ~Rp 947 juta/tahun. The pricing alone doesn't save you — disciplined hiring tied to revenue milestones does. These rules are non-negotiable until Vosi reaches 200+ tenants.

### Rule 1 — Hire only when MRR ≥ 3× new hire's monthly cost

| Hire | Approx monthly cost | Trigger MRR |
|------|---------------------|-------------|
| Customer Success (part-time → full-time) | Rp 5-10M | Rp 15-30M |
| Junior engineer | Rp 15M | Rp 45M |
| Senior engineer | Rp 25M | Rp 75M |
| Sales rep + commission | Rp 17M | Rp 51M |
| Marketing manager | Rp 20M | Rp 60M |
| CS lead | Rp 18M | Rp 54M |

**Don't pre-hire.** "I'll need a sales rep when we hit 50 tenants" thinking burns runway. Hire after the revenue exists.

### Rule 2 — Founder salary discipline by stage

| Stage | Tenants | Founder cash salary | Notes |
|-------|---------|---------------------|-------|
| Stage 0 | 1-3 | Rp 5M (living minimum) | Pure sweat equity; survival mode |
| Stage 1 | 4-15 | Rp 10M | Lower than market; founder equity premium |
| Stage 2 | 16-40 | Rp 15M | Approaching mid-market |
| Stage 3 | 41-80 | Rp 20M | Reasonable but still below market |
| Stage 4 | 81-150 | Rp 25M | Market rate emerging |
| Stage 5+ | 151+ | Rp 30-40M | Full sustainable founder pay |

Difference between sustainable founder pay (Rp 30M) and actual cash salary = **unrealized founder equity** building. Track this number — it's real wealth being deferred.

### Rule 3 — Setup fee is sacred runway

50 tenants × Rp 1.7M avg setup fee = **Rp 85M one-time cash infusion**. Treat as Year 1 runway, NOT recurring revenue:

- Use setup fees to fund Year 1 deficit (founder salary, infra, tools).
- Do NOT bake setup fees into recurring profitability calculations.
- Setup fees disappear in Year 2 (only new-tenant cohort generates them).

### Rule 4 — Premium tier subsidizes Starter/Pro at the blended level

Mix discipline:
- **Premium ≥ 15%** of customer base by tenant #50 (target 20%).
- If Premium < 10% — diagnostic: are sales pitching Calista value enough?
- Every 5% shift Starter→Premium = +Rp 7M/mo additional revenue at same tenant count.

### Rule 5 — LTV/CAC discipline

- **Don't onboard a tenant with LTV/CAC < 3:1.** Negotiate setup fee bump or walk away.
- LTV calculation: avg tenant lifetime (assume 24 months conservative) × monthly revenue × gross margin
- CAC calculation: total S&M spend in period ÷ tenants closed in period
- Track quarterly; alarm if ratio drops.

### Rule 6 — Cost notification + manual approval (mirrors Calista paid-tier rule)

Same memory pattern: **"every paid upgrade requires founder approval, alerts notify only."** Apply to hiring decisions:

- Monthly auto-report to founder: current MRR, OPEX, runway-months-remaining, tenant counts per tier.
- Alert when: runway < 6 months, OR LTV/CAC drops below 3, OR any single tenant > 15% of MRR (concentration risk).
- Founder reviews and decides hiring; no auto-trigger.

### Rule 7 — Quarterly P&L self-review

Every 3 months, run the same blended-scenario analysis but with actual tenant counts. Track:
- MRR growth vs plan
- Margin per tier (real, not modeled)
- OPEX creep (subscription tools especially — Claude, Sentry, Resend, etc. tend to grow silently)
- Stage transition readiness (am I overdue to advance to next stage? Or should I delay?)

---

## Strategic guardrails (v2 — refined)

1. **Cap Starter at 35% of customer base** (was 40% in v1). With v2 pricing where Starter Yearly margin is 27%, lower cap protects blended margin. Push Pro tier on prospects whose use case fits.

2. **Aggressive Starter → Pro upsell.** After 6-12 months active use, introduce tenant to Pengawasan + Barcode + GL features. Conversion = pure margin lift.

3. **Aggressive Pro → Premium upsell**. After tenant operates Pro stably for 3-6 months, demo Calista AI. Conversion = +Rp 2,640K/mo per Pro→Premium tenant (the AI value capture).

4. **Founding 5-10 paying tenants get grandfathered Starter/Pro rate**, even if tier pricing changes. Good faith for early adopters; their testimonials are the sales engine.

5. **Setup fee is non-negotiable.** Funds the high-touch onboarding labor. Premium's Rp 3.5M setup also covers Calista persona tuning + shadow mode monitoring.

6. **Tenant #1 (Garindo legacy) stays on internal `garindo_legacy` plan** — not subject to new pricing. Migration to commercial tier only when both sides agree.

7. **Calista AI capacity hard limit per tenant: 300 conv/day.** Beyond that, escalate to admin or upsell to "Premium Plus" tier (Phase 2 design — not in this doc).

---

## Competitive context (v3)

| Competitor | Their pricing | Vosi parity (v3 effective prices) |
|---|---|---|
| **Mekari Jurnal Pro** | Rp 399,000/mo quarterly, 10% off yearly | Vosi Starter Rp 509K 6mo / Rp 419K 12mo. **+5% to +28%** vs Jurnal Pro depending on commit, but Vosi bundles kasir + stock + recon + AR + 14 sales channels (Jurnal is accounting only). Total bundle ≈ Vosi Starter vs Jurnal Pro + 3-4 add-ons. |
| **Mekari Jurnal Enterprise** | ~Rp 1,499,000/mo+ | Vosi Pro Rp 807K 6mo / Rp 664K 12mo. **~46% to ~56% cheaper** than Jurnal Enterprise, with comparable feature breadth (GL + multi-warehouse + pengawasan). |
| **Mekari Kontak** (AI WA) | Rp 2,000,000+/mo base + per-message | Vosi Premium Rp 3,229K 6mo / Rp 2,659K 12mo includes Calista AI + full ERP + GL. Mekari requires Jurnal subscription on top → total Rp 3.5M+ for less integrated stack. Vosi competitive on total cost of bundle. |
| **Jurnal Premium / Custom** | ~Rp 3M/mo + ~Rp 11M/yr | Vosi Premium 6mo Rp 3,229K matches Jurnal monthly price point. Vosi 12mo Rp 2,659K still higher than Jurnal's aggressive Yearly promo — Vosi cannot match Jurnal's Yearly heavily-discounted promo without breaking margin. Position as: "Pay slightly more 12-month, get the only AI ordering assistant in the market." |
| **Desty** | IDR 5-7M deposit + pay-per-order | Vosi Premium Calista handles end-to-end including marketplace channels. Different pricing model (Vosi flat, Desty per-order) — Vosi better for predictable monthly cost. |

**Key differentiation messages (v3):**

- **Starter:** *"Bukan cuma accounting kayak Jurnal — Vosi handle kasir + stock + recon + 14 channels jualan dari hari pertama, satu harga. Mulai Rp 419K/bulan 12-month."*
- **Pro:** *"Semua fitur ERP termasuk GL dan multi-warehouse, dengan harga Rp 664K — 56% lebih murah dari Jurnal Enterprise."*
- **Premium:** *"Cuma Vosi yang punya Calista AI yang handle WhatsApp order end-to-end. Jurnal + Kontak masih perlu staff manual menyusun pesan. Calista handle 300 chat/hari tanpa lelah."*

---

## Tenant invoice format (Vosi → tenant)

**TBD — depends on Vosi legal entity decision** (see `compliance-indonesia.md` §9 question 1).

When tenant pays subscription, Vosi issues an invoice. Minimum requirements:

- Vosi entity name + address + NPWP (if PT) or NIK (if sole proprietorship)
- Tenant entity name + address + NPWP
- Invoice number (sequential, per fiscal year)
- Line items: package name, period covered, amount
- PPN line: **none currently** (Vosi not PKP until revenue exceeds Rp 4.8B/year)
- Payment instructions (bank transfer details)
- Tax notes ("PPh Final 0.5% Bagi Wajib Pajak Penghasilan Tertentu" if applicable)

**Format options:**
- (A) PDF generated server-side, emailed to tenant at each renewal
- (B) Manual via spreadsheet → PDF for first 5-10 tenants, automate later
- (C) Use a service (e.g., Pajak.io, Klikpajak) — overkill for non-PKP

**Recommendation Phase 1:** Option B (manual). Vosi generates PDF per invoice using a template stored in `docs/business/templates/`. Automate at tenant 10+ via Layer C-full operator console invoice generator.

## Open questions / iterate next time

- ~~Should Premium tier (post-GL) be priced Rp 1,200-1,500k or higher?~~ **RESOLVED v2:** Premium Rp 3,499K Q / Rp 2,449K Y. **v3 update:** Premium 6mo Rp 3,229K / 12mo Rp 2,659K (anchor Rp 7,599K marketing badge with 50% promo).
- ~~Calista add-on pricing~~ **RESOLVED v2:** Calista bundled INTO Premium tier (not separate add-on). Premium = Pro + Calista AI.
- ~~6-month tier should be added?~~ **RESOLVED v3:** Yes — 6mo replaces Quarterly entirely, 15% off list anchor.
- Annual vs lifetime grandfather: how long should founding-customer pricing lock in? **Tentative:** 24 months minimum; lifetime if testimonial agreement is signed.
- Optional: pricing experiment with founding customers (A/B testing list price vs effective price) — defer to tenant 20+.
- Vosi legal entity (sole prop vs PT) — drives invoice format and DPA validity. **Action item:** founder consult lawyer before tenant #2.
- **NEW v3:** v3 blended scenario modeling (50-tenant + cash-upfront-go-live) — current numbers in this doc are v2 reference. Re-model after first 5-10 v3 tenants signed, observed 6mo vs 12mo mix.
- **NEW v3:** Money-back guarantee — recommend 14-day full refund if tenant inactive (psychology unlock for 6mo commitment barrier). Confirm exact terms + add to Tenant ToS before first v3 sale.
- **v2 carry:** Premium Plus tier (Phase 3?) — higher Calista capacity (1000+ conv/day), dedicated model fine-tuning, UU PDP direct Gemini Asia. Price hint: Rp 5,999-7,999K/mo 12mo. Defer design until Premium tier validates with 5+ paying tenants.
- **v2 carry:** Monthly tier for super-cautious prospects (no commitment)? Rejected in v3 — 6-month minimum is the new floor. Revisit only if conversion rate signals existential trial barrier.
- **v2 carry:** Hiring trigger calibration. Rule 1 of Financial Discipline says "Hire when MRR ≥ 3× cost". After 6 months of operations, validate whether 3× is right number or should be 4× (more conservative) or 2.5× (more aggressive).

---

## Version history

- **v1 (2026-06-13 initial):** Starter Rp 399K Q / Rp 339K Y, Pro Rp 799K Q / Rp 559K Y. Premium TBD. Calista TBD. 40% Starter / 60% Pro blended scenario projecting Rp 140M annual profit at 50 tenants.

- **v2 (2026-06-13 this update):** Anchor pricing + 50% LAUNCH OFF psychology. Starter Rp 549K Q / Rp 384K Y (up). Pro Rp 859K Q / Rp 601K Y (up). **Premium new tier Rp 3,499K Q / Rp 2,449K Y** (Pro + Calista AI). 35/45/20 Starter/Pro/Premium mix projecting Rp 372M annual profit at 50 tenants (lean stage). Added stage-based hiring roadmap, Year 1-2 financial discipline rules, refined HPP per tier, competitive context expanded with Premium tier comparison vs Mekari Kontak.

  **Key insight from v2:** At 50 tenants with FULL team hired (founder + 5 employees), Vosi runs Rp 947M ANNUAL LOSS. Discipline = stage hiring tied to MRR milestones. Lean team at 50 tenants generates Rp 33M/mo profit. Break-even with full team = ~140 tenants. Sustainable 40-50% net margin = 500+ tenants (year 3-4 trajectory).

- **v3 (2026-06-24 this update):** Dropped Quarterly tier; replaced with 6-month commitment minimum. Added 6mo (15% off list) + kept 12mo (30% off list). Raised list anchor +10% across all tiers (Starter Rp 549K → 599K, Pro Rp 859K → 949K, Premium Rp 3,499K → 3,799K). Effective prices: Starter Rp 509K 6mo / Rp 419K 12mo · Pro Rp 807K 6mo / Rp 664K 12mo · Premium Rp 3,229K 6mo / Rp 2,659K 12mo. Marketing badge anchor (struck-through 2×) updated to match new list. Setup fees unchanged. 50-tenant blended scenario re-modeling pending after first 5-10 v3 tenants observed. Tentative new projection: Rp 410M annualized profit at 50 tenants (vs v2's Rp 372M).

  **Key reasoning chain (v3):** Pro-led GTM strategy locked separately (see project conversation 2026-06-24). 6mo minimum filters tire-kicker buyers, improves blended churn, lifts Starter 12mo margin from 27% (v2 thin loss-leader) to 33% (tipis tapi survivable). Anchor inflation +10% maintains "anchor + diskon psychology" coherence — sales messaging "30% OFF 12mo" psychologically bigger lever than v2's "30% OFF" on lower base. Skema cocok untuk distributor B2B target (Glodok persona — 12-year businesses, 6mo commitment is normal cadence). Money-back guarantee 14-day to be added to ToS as commitment-barrier unlock.

---

*Pricing iteration usually happens quarterly based on signal. v2 locked 2026-06-13, v3 locked 2026-06-24 (rapid iteration before tenant #1 v3 onboarded). Next review trigger: after first 5 v3 tenants signed (observe 6mo vs 12mo mix), OR Stage 3 hire (sales rep), whichever comes first.*
