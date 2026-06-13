# Vosi Pricing — v2 with Premium tier + Calista AI

**Date:** 2026-06-13 — v2 update after Calista Phase 1 brainstorm
**Status:** Locked after multi-round refinement with stage-based hiring trade-offs analyzed.

> This doc lives **separate from the tech spec** because pricing evolves on a faster cadence (months) than architecture (years). Tech spec (`docs/superpowers/specs/2026-06-13-multi-tenant-prerequisites-design.md` + `2026-06-13-calista-phase-1-design.md`) references package `id` only (`starter`, `pro`, `premium`), never concrete prices.

---

## Tier structure (v2 — with anchor + diskon psychology)

| Tier | Anchor (struck-through) | **Quarterly effective** | **Yearly effective** | Yearly discount | Modules |
|------|--------------------------|--------------------------|----------------------|------------------|---------|
| **Starter** | ~~Rp 1,099,000/mo~~ | **Rp 549,000/mo** | **Rp 384,300/mo** | 30% | Kasir, Stock, Purchasing, Recon, Laporan dasar, AR, Returns, 14-channel sales, 1 warehouse |
| **Pro** | ~~Rp 1,799,000/mo~~ | **Rp 859,000/mo** | **Rp 601,300/mo** | 30% | Starter + Pengawasan + Barcode + **GL/Neraca/Arus Kas** + Tax reports + multi-warehouse (5) + multi-user roles + executive dashboard. **Everything except AI.** |
| **Premium** | ~~Rp 6,999,000/mo~~ | **Rp 3,499,000/mo** | **Rp 2,449,300/mo** | 30% | Pro + **Calista AI for Ordering** (the ONLY differentiator vs Pro). Multi-warehouse (10), multi-user (25), 50K SKUs. |
| **garindo_legacy** *(internal)* | — | — | — | — | All modules including whatsmeow Calista (grandfather rate for tenant #1) |

**Marketing badge across all tiers:** "PROMO LAUNCH 50% OFF — Limited First 100 Tenants"

The anchor pricing creates psychological "you're winning" framing while effective prices hit target margins. Anchor is roughly 2× effective price; discount badge always 50% off.

### Terms

- All plans paid **upfront** at signup (3 months or 12 months in advance).
- **No monthly billing without commitment** — minimum tier is quarterly (3-mo).
- 6-month tier was considered and dropped (simplification — quarterly and yearly are enough).
- Setup fees:
  - **Starter / Pro: Rp 1,500,000** one-time at onboarding (covers catalog import + 1-2 training sessions).
  - **Premium: Rp 3,500,000** one-time (covers catalog import + Calista persona tuning + 2 training sessions + 2-week shadow mode monitoring).

### Cash flow per tenant per cohort

| Plan | Per-tenant upfront | Annualized revenue |
|---|---|---|
| Starter Quarterly | Rp 1,647,000 (3 × Rp 549K + Rp 1.5M setup) | Rp 6,588,000 |
| Starter Yearly | Rp 6,111,600 (12 × Rp 384.3K + Rp 1.5M setup) | Rp 4,611,600 |
| Pro Quarterly | Rp 4,077,000 (3 × Rp 859K + Rp 1.5M setup) | Rp 10,308,000 |
| Pro Yearly | Rp 8,715,600 (12 × Rp 601.3K + Rp 1.5M setup) | Rp 7,215,600 |
| **Premium Quarterly** | **Rp 14,497,000** (3 × Rp 3,499K + Rp 3.5M setup) | **Rp 41,988,000** |
| **Premium Yearly** | **Rp 33,891,600** (12 × Rp 2,449.3K + Rp 3.5M setup) | **Rp 29,391,600** |

---

## Discount rationale

**Yearly discount 30% uniform across all tiers (v2 — was asymmetric in v1):**

- All tiers now hit 30% Yearly discount for sales simplicity ("commit 1 tahun, hemat 30%").
- Trade-off accepted: Starter Yearly margin thin at ~27% as loss-leader for market acquisition. Pro Yearly healthy at 31.8%. Premium Yearly strong at 67%.
- Premium tier's high margin (67% Yearly) **subsidizes Starter tier's thin margin** at blended level — by design.

**Why no 6-month tier:**

- 6-month at any reasonable price cannibalizes either quarterly or yearly without adding meaningful customer choice.
- Simplifies sales conversation (one of two: "ambil 3 bulan, atau commit 1 tahun?").
- Less SKU complexity in operator console + billing.

**Why anchor + diskon psychology:**

- Anchor pricing (struck-through ~~Rp X~~) creates loss aversion + "you're winning" framing.
- "50% OFF LAUNCH" badge is the universal Indonesian SaaS marketing pattern (Mekari, Pajak.io, Klikpajak all use it).
- Effective prices hit margin targets — the discount is the actual price, not a promotion that ends.

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

### Margin per plan (lean stage, basic HPP)

| Plan | Revenue/mo | HPP | Margin | Status |
|------|------------|-----|--------|--------|
| Starter Quarterly | Rp 549,000 | Rp 280K | **49%** (+Rp 269K) | ✅ Healthy |
| Starter Yearly | Rp 384,300 | Rp 280K | **27%** (+Rp 104K) | ⚠️ Thin (loss-leader for acquisition) |
| Pro Quarterly | Rp 859,000 | Rp 410K | **52%** (+Rp 449K) | ✅ Healthy |
| Pro Yearly | Rp 601,300 | Rp 410K | **32%** (+Rp 191K) | ✅ Sustainable |
| **Premium Quarterly** | **Rp 3,499,000** | **Rp 910K** | **74%** (+Rp 2,589K) | ⭐ Very healthy — funds team growth |
| **Premium Yearly** | **Rp 2,449,300** | **Rp 910K** | **63%** (+Rp 1,539K) | ⭐ Strong |

### Reading the lenses

- **Lean stage margins** assume founder + 1 helper (no marketing/sales team yet). Sustainable through Stage 2 (~30 tenants).
- **Premium tier margin (63-74%)** is the buffer that lets Vosi hire team without breaking break-even.
- **Starter Yearly thin margin (27%)** accepted as market-acquisition loss-leader — Premium subsidizes.

### Blended scenario — 35% Starter / 45% Pro / 20% Premium, 50/50 Q/Y intra-tier (v2)

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

## Competitive context (v2)

| Competitor | Their pricing | Vosi parity (v2 effective prices) |
|---|---|---|
| **Mekari Jurnal Pro** | Rp 399,000/mo quarterly, 10% off yearly | Vosi Starter Rp 549K Q / Rp 384K Y. **+38% Q price**, but Vosi bundles kasir + stock + recon + AR + 14 sales channels (Jurnal is accounting only). Total bundle ≈ Vosi Starter vs Jurnal Pro + 3-4 add-ons. |
| **Mekari Jurnal Enterprise** | ~Rp 1,499,000/mo+ | Vosi Pro Rp 859K Q. **~43% cheaper** than Jurnal Enterprise, with comparable feature breadth (GL + multi-warehouse + pengawasan). |
| **Mekari Kontak** (AI WA) | Rp 2,000,000+/mo base + per-message | Vosi Premium Rp 3,499K Q includes Calista AI + full ERP + GL. Mekari requires Jurnal subscription on top → total Rp 3.5M+ for less integrated stack. Vosi competitive on total cost of bundle. |
| **Jurnal Premium / Custom** | ~Rp 3M/mo + ~Rp 11M/yr | Vosi Premium Q Rp 3,499K matches Jurnal monthly price point. Vosi Yearly Rp 2,449K is higher than Jurnal's aggressive Rp 917K/mo Yearly — Vosi cannot match Jurnal's Yearly heavily-discounted promo without breaking margin. Position as: "Pay slightly more Yearly, get the only AI ordering assistant in the market." |
| **Desty** | IDR 5-7M deposit + pay-per-order | Vosi Premium Calista handles end-to-end including marketplace channels. Different pricing model (Vosi flat, Desty per-order) — Vosi better for predictable monthly cost. |

**Key differentiation messages (v2):**

- **Starter:** *"Bukan cuma accounting kayak Jurnal — Vosi handle kasir + stock + recon + 14 channels jualan dari hari pertama, satu harga."*
- **Pro:** *"Semua fitur ERP termasuk GL dan multi-warehouse, dengan harga Rp 859K — 43% lebih murah dari Jurnal Enterprise."*
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

- ~~Should Premium tier (post-GL) be priced Rp 1,200-1,500k or higher?~~ **RESOLVED v2:** Premium Rp 3,499K Q / Rp 2,449K Y (anchor Rp 6,999K with 50% promo).
- ~~Calista add-on pricing~~ **RESOLVED v2:** Calista bundled INTO Premium tier (not separate add-on). Premium = Pro + Calista AI.
- Annual vs lifetime grandfather: how long should founding-customer pricing lock in? **Tentative:** 24 months minimum; lifetime if testimonial agreement is signed.
- Optional: pricing experiment with founding customers (A/B testing list price vs effective price) — defer to tenant 20+.
- Vosi legal entity (sole prop vs PT) — drives invoice format and DPA validity. **Action item:** founder consult lawyer before tenant #2.
- **NEW v2:** Premium Plus tier (Phase 3?) — higher Calista capacity (1000+ conv/day), dedicated model fine-tuning, UU PDP direct Gemini Asia. Price hint: Rp 5,999-7,999K/mo Quarterly. Defer design until Premium tier validates with 5+ paying tenants.
- **NEW v2:** Monthly tier for super-cautious prospects (no commitment)? Currently rejected (3-month minimum). Revisit if conversion rate suggests trial barrier.
- **NEW v2:** Hiring trigger calibration. Rule 1 of Financial Discipline says "Hire when MRR ≥ 3× cost". After 6 months of operations, validate whether 3× is right number or should be 4× (more conservative) or 2.5× (more aggressive).

---

## Version history

- **v1 (2026-06-13 initial):** Starter Rp 399K Q / Rp 339K Y, Pro Rp 799K Q / Rp 559K Y. Premium TBD. Calista TBD. 40% Starter / 60% Pro blended scenario projecting Rp 140M annual profit at 50 tenants.

- **v2 (2026-06-13 this update):** Anchor pricing + 50% LAUNCH OFF psychology. Starter Rp 549K Q / Rp 384K Y (up). Pro Rp 859K Q / Rp 601K Y (up). **Premium new tier Rp 3,499K Q / Rp 2,449K Y** (Pro + Calista AI). 35/45/20 Starter/Pro/Premium mix projecting Rp 372M annual profit at 50 tenants (lean stage). Added stage-based hiring roadmap, Year 1-2 financial discipline rules, refined HPP per tier, competitive context expanded with Premium tier comparison vs Mekari Kontak.

  **Key insight from v2:** At 50 tenants with FULL team hired (founder + 5 employees), Vosi runs Rp 947M ANNUAL LOSS. Discipline = stage hiring tied to MRR milestones. Lean team at 50 tenants generates Rp 33M/mo profit. Break-even with full team = ~140 tenants. Sustainable 40-50% net margin = 500+ tenants (year 3-4 trajectory).

---

*Pricing iteration usually happens quarterly based on signal. v2 locked 2026-06-13. Next review trigger: after first 5 Premium tenants OR Stage 3 hire (sales rep), whichever comes first.*
