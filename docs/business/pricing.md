# Vosi Pricing — initial structure & analysis

**Date:** 2026-06-13 — initial draft
**Status:** Sleep-on-it before commit. Pricing zigzagged during brainstorming — re-read fresh tomorrow before treating as final.

> This doc lives **separate from the tech spec** because pricing evolves on a faster cadence (months) than architecture (years). Tech spec (`docs/superpowers/specs/2026-06-13-multi-tenant-prerequisites-design.md`) references package `id` only (`starter`, `pro`, `premium`), never concrete prices.

---

## Tier structure

| Tier | Quarterly | Yearly | Yearly discount vs quarterly | Modules |
|---|---|---|---|---|
| **Starter** | Rp 399,000 /mo | Rp 339,000 /mo | 15% | kasir, stock, purchasing, recon, reports, ar, returns |
| **Pro** | Rp 799,000 /mo | Rp 559,300 /mo | 30% | Starter + pengawasan + barcode |
| **Premium** *(Phase 2 — when GL ships)* | TBD | TBD | — | Pro + GL/Neraca/Arus Kas |
| **Add-on: Calista** *(post Meta API)* | TBD | TBD | — | WhatsApp AI via Meta Cloud API |
| **garindo_legacy** *(internal)* | — | — | — | All modules including whatsmeow Calista |

### Terms

- All plans paid **upfront** at signup (3 months or 12 months in advance).
- **No monthly billing without commitment** — minimum tier is quarterly (3-mo).
- 6-month tier was considered and dropped (simplification — quarterly and yearly are enough).
- Setup fee: **Rp 1,500,000 one-time** at onboarding (covers catalog import + training).

### Cash flow per tenant per cohort

| Plan | Per-tenant upfront | Annualized revenue |
|---|---|---|
| Starter Quarterly | Rp 1,197,000 | Rp 4,788,000 |
| Starter Yearly | Rp 4,068,000 | Rp 4,068,000 |
| Pro Quarterly | Rp 2,397,000 | Rp 9,588,000 |
| Pro Yearly | Rp 6,711,600 | Rp 6,711,600 |

---

## Discount rationale

**Why asymmetric discount per tier (Starter 15% vs Pro 30%):**

- Starter tenant is price-sensitive; 15% is enough psychological "yearly is best deal" signal.
- Pro tenant has higher absolute upfront (Rp 6.7M vs Rp 4M); needs bigger % discount to justify lock-in.
- Discount asymmetry doubles as upsell hook: *"Upgrade to Pro and your yearly discount goes from 15% to 30%."*
- Marketing per tier (not "yearly discount X% across all tiers") — manageable for 2 tiers.

**Why no 6-month tier:**

- 6-month at any reasonable price cannibalizes either quarterly or yearly without adding meaningful customer choice.
- Simplifies sales conversation (one of two: "ambil 3 bulan, atau commit 1 tahun?").
- Less SKU complexity in operator console + billing.

---

## Unit economics at 50 tenants

### Cost basis (from tech spec §8.5)

- **Marginal cost per tenant**: ~Rp 100,000/mo (additional Supabase storage delta, Cloud Run requests, Sentry events, Resend emails, Claude API per-tenant share).
- **Fully-allocated cost per tenant**: ~Rp 321,000/mo (COGS Rp 12,246,000 / 50 + opex Rp 76,600/tenant).

### Margin per plan

| Plan | Revenue/mo | Marginal margin | Allocated margin | Status |
|---|---|---|---|---|
| Starter Quarterly | Rp 399,000 | 75% (+Rp 299k) | 20% (+Rp 78k) | ✅ Healthy |
| Starter Yearly | Rp 339,000 | 70% (+Rp 239k) | 5% (+Rp 18k) | ⚠️ Thin allocated |
| Pro Quarterly | Rp 799,000 | 87% (+Rp 699k) | 60% (+Rp 478k) | ✅ Very healthy |
| Pro Yearly | Rp 559,300 | 82% (+Rp 459k) | 43% (+Rp 238k) | ✅ Healthy |

### Reading the two lenses

- **Marginal margin** = "Is this customer worth taking?" — all plans ✅ (above 70%)
- **Allocated margin** = "If everyone was on this plan, would the business be profitable?"
  - Starter Yearly only 5% — if dominant, business runs near break-even.
  - Pro Yearly 43% — if dominant, business healthy.

### Blended scenario — 40% Starter / 60% Pro, 50/50 Q/Y intra-tier

| Cohort | Revenue/mo |
|---|---|
| 10 Starter Quarterly × Rp 399k | Rp 3,990,000 |
| 10 Starter Yearly × Rp 339k | Rp 3,390,000 |
| 15 Pro Quarterly × Rp 799k | Rp 11,985,000 |
| 15 Pro Yearly × Rp 559.3k | Rp 8,389,500 |
| **Total revenue** | **Rp 27,754,500** |
| Cost (COGS + opex) | (Rp 16,076,000) |
| **Net profit/mo** | **Rp 11,678,500 (42%)** |
| **Annualized profit** | **Rp 140,142,000** |

### Cash upfront at 50-tenant go-live (same mix)

| Cohort | Per-tenant upfront × count | Cohort upfront |
|---|---|---|
| Starter Quarterly | Rp 1,197k × 10 | Rp 11,970,000 |
| Starter Yearly | Rp 4,068k × 10 | Rp 40,680,000 |
| Pro Quarterly | Rp 2,397k × 15 | Rp 35,955,000 |
| Pro Yearly | Rp 6,711.6k × 15 | Rp 100,674,000 |
| Setup fees (50 × Rp 1.5M) | | Rp 75,000,000 |
| **Total cash upfront** | | **Rp 264,279,000 (~Rp 264 juta)** |

---

## Strategic guardrails

1. **Cap Starter at 40% of customer base.** Starter Yearly is allocated-margin thin (5%); if Starter dominates >50%, business runs at near break-even. Operator dashboard should track tier mix; if Starter > 40%, push Pro tier on new prospect conversations.

2. **Aggressive Starter → Pro upsell.** After 6-12 months active use, introduce tenant to Pengawasan + Barcode (Pro features). Conversion = pure margin lift (cost same, revenue 2x).

3. **Founding 5-10 paying tenants get grandfathered Starter rate**, even if tier pricing changes. Good faith for early adopters; their testimonials are the sales engine.

4. **Setup fee is non-negotiable.** Funds the high-touch onboarding labor (catalog import + training). Without it, Starter Yearly is a Year-1 loss-maker.

---

## Competitive context

| Competitor | Their pricing | Vosi parity |
|---|---|---|
| **Mekari Jurnal Pro** | Rp 399,000/mo quarterly, 10% off yearly | Starter Quarterly identical (Rp 399k); Starter Yearly 15% off (more aggressive). Different value-prop: Vosi ops-first, Jurnal books-first. |
| **Mekari Kontak** | Rp 2,000,000+/mo + per-message | (Calista comparison — Phase 2 when add-on prices) |
| **Desty** | IDR 5-7M deposit + pay-per-order | (Marketplace sync comparison — Phase 2) |

**Key differentiation message:** *"Same as Jurnal's quarterly price for Starter, but you get kasir + stock + recon + AR — not just accounting. Commit yearly and you save more than Jurnal lets you (15% vs 10%)."*

---

## Open questions / iterate next time

- Should Premium tier (post-GL) be priced Rp 1,200-1,500k or higher? Lawyer-grade accountant-grade GL justifies premium.
- Calista add-on pricing — depends on Meta API ongoing cost per-tenant per-message.
- Annual vs lifetime grandfather: how long should founding-customer pricing lock in?
- Optional: pricing experiment with founding customers (A/B Rp 399k vs Rp 449k Starter Quarterly to see if elasticity).

---

*This is initial pricing draft. Sleep on it, review fresh, then lock. Pricing iteration usually happens quarterly based on signal — don't treat as immutable.*
