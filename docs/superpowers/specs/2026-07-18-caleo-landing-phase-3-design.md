# Caleo Landing Phase 3 — Design Spec

**Date**: 2026-07-18
**Author**: Autonomous session with founder brief
**Status**: Finalized after audit review — ready for `writing-plans`

---

## 1. Context

Phase 1 + 2 complete: infrastructure hardened, ERP shipped, 10-tenant onboarding
ready. Landing page currently at `caleo.id/` serves a "Segera Hadir" placeholder
via a Cloudflare Worker on the `caleo.id` zone (CF-managed, not in-repo). Security
headers already applied at the CF edge (HSTS + nosniff + Referrer-Policy + CSP
report-only per Task 16 addendum).

To attract paying tenants, Caleo needs the conversion-optimized public landing
page. Design mockups at `docs/design-mockups/caleo-landing-v1.html` (2,128 lines)
+ `caleo-case-study.html` (479 lines) are complete after 20+ founder iterations
covering copy, layout, pricing psychology, humanization, and world-class
conversion patterns. **Both mockups were audited on 2026-07-18** and iterated
inline — see Section 15 for the audit-driven changes.

**Phase 3 = ship the landing to production as a pure-static Cloudflare Worker.**

## 2. Goal

Replace `caleo.id/*` placeholder with the audited landing page + case study,
deployed via a repo-managed Cloudflare Worker at **zero added cost**. Ship as
**pure static** — no dynamic config layer, no backend endpoint, no client-side
fetch. Content edits post-launch happen via git commit + `wrangler deploy`
(~2 minutes end-to-end).

## 3. Non-goals (explicit per founder)

- **No dynamic content config layer** — deferred to Phase 3.1. No
  `landing_config` Supabase table, no `GET /api/v1/landing/config` backend
  endpoint, no client-side JS patcher hydrating WA number / slot counter /
  testimonials from a config API. Rationale: with ~10 tenants and low expected
  content-churn, redeploy-to-edit is fine.
- **No admin UI for content editing** — deferred. See Phase 3.1.
- **No A/B testing framework** — Phase 3.1+.
- **No CMS or headless CMS integration** (Sanity, Contentful, etc.) — overkill.
- **No i18n / multi-language** — Bahasa Indonesia only.
- **No user analytics dashboard** — Cloudflare Analytics + Sentry suffice.
- **No dynamic pricing pull from Supabase** — pricing displayed on landing is
  hardcoded in HTML; updates via redeploy.
- **No CTA click event tracking in MVP** — basic Cloudflare Analytics is enough
  for first month; deferred to Phase 3.1 (see follow-ups).

## 4. Success criteria

- `caleo.id/` serves the new landing (HTTP 200, all assets load, no CSP violations).
- `caleo.id/case-study` serves the case study.
- `caleo.id/privacy.html` + `caleo.id/terms.html` serve the legal pages.
- Zero infra cost added — reuses existing Cloudflare Worker slot on `caleo.id`.
- Lighthouse Performance ≥ 85 mobile, ≥ 95 desktop.
- Google Fonts + Maps embed load correctly under new landing CSP (see 5.5).
- OpenGraph preview renders correctly when link is shared on WhatsApp / Facebook
  / Twitter (og-image + description present).
- `robots.txt` + `sitemap.xml` served at root for SEO baseline.
- Rollback path: `wrangler rollback` (or `git revert` + redeploy) → previous
  placeholder Worker returns.

## 5. Architecture

### 5.1 Deployment — pure static via Cloudflare Worker

```
┌──────────────────────────────────────────────────────────┐
│                    Cloudflare Edge                       │
│                                                          │
│   caleo.id/            →  Worker → public/index.html     │
│   caleo.id/case-study  →  Worker → public/case-study.html│
│   caleo.id/privacy.html→  Worker → public/privacy.html   │
│   caleo.id/terms.html  →  Worker → public/terms.html     │
│   caleo.id/assets/*    →  Worker → public/assets/*       │
│   caleo.id/robots.txt  →  Worker → public/robots.txt     │
│   caleo.id/sitemap.xml →  Worker → public/sitemap.xml    │
│                                                          │
│   All responses ship CSP + security headers from Worker  │
└──────────────────────────────────────────────────────────┘
```

Worker uses Cloudflare Workers Assets binding (or `@cloudflare/kv-asset-handler`
if legacy) to serve files bundled with the Worker on deploy. No Supabase call,
no backend fetch, no client-side hydration — page as rendered on deploy IS the
page served.

### 5.2 File structure (git repo)

```
public/                                     ← new dir, bundled into Worker
├── index.html                              ← from docs/design-mockups/caleo-landing-v1.html
├── case-study.html                         ← from docs/design-mockups/caleo-case-study.html
├── privacy.html                            ← from docs/legal/kebijakan-privasi.md hand-converted
├── terms.html                              ← from docs/legal/syarat-ketentuan.md hand-converted
├── robots.txt                              ← 3-line file with Sitemap directive
├── sitemap.xml                             ← 4 URLs: /, /case-study, /privacy.html, /terms.html
├── favicon.ico                             ← + PNG icon fallback
└── assets/
    ├── CALEO-icon-HD.png                   ← from docs/logo-png-final/
    ├── CALEO-logo-horizontal-HD-v2.png     ← nav + footer logos
    ├── CALEO-logo-horizontal-white-HD.png  ← reserve for dark-bg contexts (footer alt)
    ├── caleo-qr.png                        ← WA QR code in final CTA section
    ├── og-image.png                        ← 1200×630 OpenGraph card (landing)
    ├── og-case-study.png                   ← 1200×630 OpenGraph card (case study)
    └── landing.js                          ← extracted from inline <script> in mockup (H7 audit fix)

infra/
└── caleo-landing-worker/
    ├── wrangler.toml                       ← routes: caleo.id/*, assets binding
    └── worker.js                           ← Cloudflare Worker entry — serves public/*, applies CSP
```

**Explicitly NOT shipping** — items retained in `docs/design-mockups/` but not
copied into `public/`:
- `caleo-pembelian-real.png` (603KB) — legacy preview asset, superseded by the
  CSS-drawn PO mockup embedded in `index.html`.

### 5.3 Content model — none (deferred to Phase 3.1)

All landing content lives in the HTML files themselves. WA number
(`6285264787775`), pricing tiers (Rp 419K / 664K / 2.659K), slot copy, case-study
KPIs (474 SKU / 290+ supplier / 1.500+ pergerakan stok / 250+ chat WA), and
testimonial quotes are hardcoded. Edits require an HTML change → git commit →
`wrangler deploy` (~2 minutes).

If post-launch content churn proves painful (weekly slot counter updates, new
testimonials from newly-onboarded tenants, campaign-specific promo ticker), the
config-driven layer moves from "deferred" to "Phase 3.1 in-scope" — see
Section 12.

### 5.4 Backend endpoint — none

No `/api/v1/landing/*` endpoint in this phase. `backend-go/internal/api/`
untouched. No Supabase migration for landing content.

### 5.5 Landing behavior + Security headers (Worker CSP)

The audited mockup ships **as-is** to `public/`. The inline `<script>` block
(ROI calculator + pricing toggle + IntersectionObserver reveal, ~140 lines) is
**extracted** to `public/assets/landing.js` — per H7 audit fix — so that CSP
can enforce `script-src 'self'` without `'unsafe-inline'`.

Worker ships this CSP for landing routes (enforcing, not report-only):

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' data: https://fonts.gstatic.com;
img-src 'self' data: https://www.google.com https://maps.google.com;
frame-src https://www.google.com;
connect-src 'self';
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none';
report-uri https://garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app/api/v1/security/csp-report;
```

Plus (unchanged from existing caleo.id headers):
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`

`'unsafe-inline'` is kept ONLY for `style-src` because the mockup embeds inline
`style="..."` attributes extensively. A future cleanup can extract those and
tighten CSP further; not scope for Phase 3.

### 5.6 Case study page

Static HTML, same Worker deployment, served at `/case-study` (no `.html`
extension — Worker rewrites internally or ships as bare page). No dynamic config.

### 5.7 Legal pages

Kebijakan Privasi + Syarat & Ketentuan already exist at
`docs/legal/kebijakan-privasi.md` and `docs/legal/syarat-ketentuan.md`. Approach
per closed open question #1: **hand-convert MD → HTML once** (via `pandoc` or
manual), place at `public/privacy.html` and `public/terms.html`. Style with a
minimal shared stylesheet so the pages match the landing typography.

## 6. Deployment plan

### Prerequisites
- Cloudflare Workers already deployed on `caleo.id` zone (existing placeholder
  Worker will be replaced).
- Cloudflare API token has Workers deploy permission.
- `wrangler` CLI installed (or use `npx wrangler`).

### Steps
1. Create `public/` dir. Copy `docs/design-mockups/caleo-landing-v1.html` →
   `public/index.html`. Copy `caleo-case-study.html` → `public/case-study.html`.
2. Copy assets to `public/assets/`. Rewrite relative paths in the copied HTMLs
   so all image / asset refs point to `/assets/...`.
3. Extract inline `<script>` from `public/index.html` → `public/assets/landing.js`.
   Replace inline block with `<script defer src="/assets/landing.js"></script>`.
4. Hand-convert `docs/legal/kebijakan-privasi.md` → `public/privacy.html`.
   Hand-convert `docs/legal/syarat-ketentuan.md` → `public/terms.html`. Apply
   shared minimal stylesheet.
5. Create `public/robots.txt` (3 lines: `User-agent: *`, `Allow: /`,
   `Sitemap: https://caleo.id/sitemap.xml`).
6. Create `public/sitemap.xml` (4 URL entries).
7. Generate `public/assets/og-image.png` (1200×630) + `public/assets/og-case-study.png`
   from `Marketing/Banner CALEO 3B-HQ v4 web.png` or design new. Fallback: use
   the horizontal logo on a solid navy background if design bandwidth is tight.
8. Create `infra/caleo-landing-worker/wrangler.toml` — routes `caleo.id/*`,
   assets binding pointed at `../../public`, environment set to production.
9. Create `infra/caleo-landing-worker/worker.js` — serves `public/*` via
   Assets binding, applies CSP + security headers per Section 5.5, rewrites
   `/case-study` → `/case-study.html` if extension-less.
10. `wrangler deploy` from `infra/caleo-landing-worker/`. Confirm deploy
    succeeded via `wrangler deployments list`.
11. Smoke test from clean browser: `caleo.id/`, `caleo.id/case-study`,
    `caleo.id/privacy.html`, `caleo.id/terms.html`, `caleo.id/robots.txt`,
    `caleo.id/sitemap.xml`.
12. Verify SEO: `curl -A "Googlebot/2.1" https://caleo.id/` returns full HTML
    with meta tags + JSON-LD.
13. Verify OG: paste `https://caleo.id/` into WhatsApp / FB debugger, confirm
    og-image + title + description render.
14. Verify Lighthouse ≥ 85 mobile / ≥ 95 desktop from a fresh Chrome incognito.
15. Update `progress.md` with Phase 3 ship-line.

### Rollback
- `wrangler rollback` reverts to the previous Worker version (placeholder), OR
- `git revert <deploy-commit>` + `wrangler deploy` — same result.
- No DB migration to roll back (there is none).
- Zero customer impact — landing is public marketing surface, not tenant-serving.

## 7. Observability

- Cloudflare Analytics: baseline traffic + Web Vitals (free tier — already on for
  `caleo.id`).
- Sentry: JS errors from `landing.js` — reuse existing FE Sentry DSN via a small
  `Sentry.init(...)` block in `landing.js` (optional; can defer to Phase 3.1 if
  DSN wiring adds complexity for the static site).
- Backend endpoint: n/a (no backend endpoint in scope).
- Security: CSP violation reports still flow to
  `garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app/api/v1/security/csp-report`
  (existing endpoint per Task 16 addendum).

## 8. Security

- Public landing = no auth. No PII collected.
- CSP per Section 5.5 — enforcing, expanded to accommodate Google Fonts + Maps
  iframe + Maps thumbnail image origin.
- HSTS + X-Content-Type-Options + X-Frame-Options + Referrer-Policy +
  Permissions-Policy shipped by Worker.
- WA click links to real number → external redirect, out of scope.
- No user-controlled input on the landing (all forms/CTAs are `mailto:` /
  `wa.me` external redirects) → no XSS / injection surface.

## 9. Cost

- Cloudflare Workers: free tier (100K requests/day; `caleo.id` traffic well
  within limits).
- Assets bundled with Worker deploy — no separate storage cost.
- **Total added cost: Rp 0/mo.**

## 10. Reversibility

**Fully reversible** — architectural tactical decision, no lock-in.

- Landing HTML change → git revert
- Worker rollback → `wrangler rollback` OR redeploy previous artifact
- No SDK, no framework lock-in, no vendor commit. Pure HTML + CSS + minimal JS.

Reversibility rating per CLAUDE.md: **tactical/reversible**. No `advisor()`
consultation required — diff estimated <500 lines (mostly copy-paste from
mockup + Worker scaffolding).

## 11. Testing

**Manual (pre-launch)**:
- Chrome desktop: click all CTAs, verify WA opens with correct pre-filled message
- Chrome mobile emulation (375×667): floating WA + sticky bottom bar visible,
  layout responsive, marquee ticker readable
- Firefox: layout renders identically
- Safari: emojis + Inter font rendering OK
- Slow-3G Lighthouse audit — target ≥ 85 mobile Performance
- DevTools Console: zero CSP violations on `caleo.id/`
- Reduced-motion emulation: marquee animations halt, scroll-reveal disabled

**Automated (light)**:
- Playwright smoke test in existing `tests/e2e/`:
  - Navigate to `caleo.id/`, assert `<h1>` present, assert nav links present,
    assert all WA links contain `6285264787775`
  - Navigate to `caleo.id/case-study`, assert `<h1>` present, assert back-link
    href = `/`
  - Fetch `caleo.id/robots.txt` → 200 with `Sitemap:` directive
  - Fetch `caleo.id/sitemap.xml` → 200 with valid XML
- No backend endpoint tests — n/a for Phase 3.

**No load testing needed** — edge cache + free CF tier handles landing load
trivially.

## 12. Follow-ups (Phase 3.1 = COMMITTED, post-launch iteration)

Founder decision (2026-07-18, confirmed 2026-07-19): Phase 3.1 IS a
committed follow-up, not a "maybe someday". The delivery cadence follows a
strict **0 → 0.5 → 1** additive pattern:

- **0 → 0.5 (Phase 1, this spec)**: Ship pure static landing. Content
  hardcoded in HTML. Founder edits via git commit + `wrangler deploy`
  (~2 min turnaround).
- **0.5 → 1 (Phase 3.1)**: Add config layer atop static HTML — same HTML
  gets hydrated on load from a backend config. Founder edits via
  **Caleo Admin portal at `admin.caleo.id`** with a **new left-sidebar
  menu item "Website Config"** (or similar label — final naming at
  Phase 3.1 kick-off, but the placement decision — Caleo Admin sidebar —
  is locked).

**No rebuild between 0.5 and 1.** Everything shipped at 0.5 is retained.
Phase 3.1 adds atop, does not replace. See Section 16 for architectural
lock-in that guarantees this.

**Phase 3.1 concrete scope:**

- **Dynamic content config layer** — `landing_config` Supabase table + backend
  endpoint (`GET /api/v1/landing/config`, 60s edge cache) + client-side JS
  patcher in `public/assets/landing.js` that hydrates DOM from config on load.
- **Caleo Admin sidebar addition** — one new menu item ("Website Config",
  "Kelola Landing", or similar) rendering a form-per-section config editor.
  Reuses existing Caleo Admin auth, layout shell, styling. NOT a new portal.
- **Content scope** (Tier 1, initial roll): WA number, slot counter, promo
  ticker items, testimonials, stat card values + labels, growth impact
  numbers. Content mapped 1-to-1 to the semantic markers documented in
  Section 17.
- **Content scope** (Tier 2, later — after Tier 1 validates): module
  descriptions, audience cards, FAQ items, growth cards, onboarding steps,
  fleksibel cards. Added incrementally as the sidebar UI grows.
- **CTA click event tracking + funnel dashboard** — `POST /api/v1/landing/cta-click`
  logging source (hero/pricing/roi/footer) → Cloud Run metrics + Sentry
  breadcrumb. Enables "which CTA converts" measurement.
- **A/B testing framework** — 2 headlines, Cloudflare Worker splits traffic by
  cookie, measure conversion.
- **Landing content admin UI** — only if SQL editing (via config layer) proves
  tedious after N iterations.
- **Multi-tenant landings** — resellers, partner-branded landings.
- **Video demo embed** — needs recorded video first.
- **Multi-language** (English) — expat SME market.
- **Rich case studies gallery** — multiple tenant stories, path structure
  `/case-studies/<slug>`.
- **SEO deep-dive** — expand schema.org (FAQPage schema for the FAQ section,
  Review schema for testimonials once real).
- **Real testimonial pipeline** — post-launch, collect written testimonials
  from newly onboarded tenants with signed consent; feed to config layer or
  hardcode via redeploy.

## 13. Open questions — CLOSED (2026-07-18)

1. **Legal page conversion approach**: hand-convert MD → HTML once (fast,
   one-time) or set up markdown pipeline (better DX but overkill)?
   **Decision: hand-convert once** — one-shot cost, no pipeline drag.
2. **CTA click tracking in MVP or defer?**
   **Decision: defer** to Phase 3.1 — CF Analytics baseline is enough for month 1.
3. **`case-study.html` at root or under `/case-studies/distributor-listrik/`?**
   **Decision: `/case-study` at root** — single case study for now; add sub-path
   when we have 2+.
4. **Migration slot number**: n/a — no migration in Phase 3 (config table
   deferred to Phase 3.1).

## 14. Reversibility rating

**Reversible / tactical** — no `advisor()` consultation required per CLAUDE.md
trigger list. Diff estimate <500 lines total (mockup copy + path rewrites +
Worker scaffold + robots/sitemap/OG assets + legal pages).

## 16. Architectural lock-in for Phase 2 upgrade path — **0 → 0.5 → 1 additive contract**

Founder's delivery model is explicitly incremental: **build 0 → 0.5 (Phase 1
= this spec), then 0.5 → 1 (Phase 3.1)**. No effort at 0.5 is discarded when
moving to 1. This section is the authoritative contract that guarantees it.

**Pattern (locked-in, non-negotiable):**
- Static HTML files rendered as-is at page load (progressive-enhancement base)
- Cloudflare Worker serving static assets + security headers
- Backend Go endpoint at `GET /api/v1/landing/config` returning JSON (added at 1)
- Client-side JS patcher in `landing.js` fetches config + mutates DOM elements
  identified by `js-*` semantic markers (added at 1)
- Content editing UI = **new left-sidebar menu inside Caleo Admin portal at
  `admin.caleo.id`** (added at 1) — NOT a new standalone portal

**What Phase 3.1 (0.5 → 1) adds atop Phase 1 (net-new only, nothing replaced):**
- ~30 lines: Supabase migration for `landing_config` singleton table (+ RLS
  policy allowing only platform-admin write; public read)
- ~50 lines: Go handler for `GET /api/v1/landing/config` with 60s edge cache
- ~30 lines: JS patcher function inside existing `landing.js`
- +1 CSP line: `connect-src` addition in Worker for backend endpoint origin
- ~200-300 lines: new sidebar menu + form-per-section editors inside existing
  Caleo Admin React shell (reuses existing auth, layout, styling — no new
  design system)

**Zero throwaway in the 0.5 → 1 transition:**

| Artifact from Phase 1 (0.5) | Kept in Phase 3.1 (1)? | Reason |
|---|---|---|
| HTML files (2,100+ lines) | 100% kept | Same markup, JS hydrates values on load |
| CSS (inline + `<style>`) | 100% kept | Visual layer untouched |
| CF Worker + wrangler config | 100% kept, +1 line CSP | Only add `connect-src` for backend origin |
| landing.js (ROI + toggle + reveal) | 100% kept, +patcher | Existing IIFEs untouched, patcher added |
| Legal HTML pages | 100% kept | Static forever |
| robots.txt + sitemap.xml | 100% kept | Static forever |
| OG images + all assets | 100% kept | Static forever |
| Semantic markers (`js-*`) | 100% kept + used | Section 17 markers become the patcher's selectors |
| Cloudflare Email Routing | 100% kept | Independent infra |

**Anti-patterns forbidden in Phase 3.1** (per CLAUDE.md scale-forward architecture,
these WOULD waste Phase 1 effort — do NOT propose these):
- Migrating to a CMS (Sanity, Contentful, Strapi) — throws away hand-crafted HTML
- Rewriting to a SPA framework (React, Next.js, SvelteKit) — throws away all
  markup + CF Worker
- Changing hosting from Cloudflare Worker to Vercel/Netlify — throws away Worker
- Introducing a build step (Webpack/Vite) for landing content — adds toolchain
  weight for zero benefit at this scale
- Building a NEW standalone portal for landing config — reuse Caleo Admin
  sidebar (decision locked; skip the auth/layout re-implementation cost)

If a future contributor proposes any of the above, this section is authoritative
push-back: NOT the pattern we committed to.

**Reversibility rating for the pattern itself**: **Semi-reversible** (upgraded
from "tactical" because Phase 3.1 committing to this pattern reduces later
flexibility slightly). Reversibility of Phase 3.1's config layer alone remains
**tactical** — a Phase 3.2 could remove the config layer + revert to hardcoded
HTML + remove the Caleo Admin sidebar menu without significant work.

## 17. Upgrade-readiness markers applied in Phase 1

Semantic markers added to landing HTML to make Phase 3.1 JS patcher trivial:

| Marker | Applied to | Phase 3.1 usage |
|--------|-----------|----------------|
| `.js-wa-link` | All 13 WhatsApp CTA anchors | Patcher iterates + rewrites `href` from `config.wa_number` |
| `#js-slot-counter` | `.promos-slot` div in pricing hero | Patcher sets `innerHTML` from `config.slot_text` |
| `.js-promo-item` | All 10 marquee items in top promo bar | Patcher rebuilds items from `config.promo_ticker[]` |
| `.js-testi-card` | All 10 testimonial cards (5 unique + 5 marquee duplicates) | Patcher hydrates from `config.testimonials[]` |
| `.js-stat-card` | All 5 stat cards in `#stats` section | Patcher hydrates from `config.stats[]` |

Marker cost in Phase 1: ~15 minutes (attribute additions only, zero visual
impact). Savings in Phase 3.1: ~35 minutes (no need to hunt elements via
fragile regex/text selectors).

Additional markers (module cards, audience cards, FAQ items, growth cards,
onboarding steps) NOT applied in Phase 1 — Phase 3.1 team can add lazily when
those fields enter config schema. Marker density decision is Phase 3.1's
responsibility once portal UI is scoped.

## 15. Audit-driven mockup changes (applied 2026-07-18)

The two mockups were audited on 2026-07-18 for trust risk, SEO, a11y, CSP,
JS defensiveness, and copy consistency. Founder-approved findings applied
inline to `docs/design-mockups/caleo-landing-v1.html` and
`docs/design-mockups/caleo-case-study.html`:

**Blockers (trust risk)**
- **B1 — Fake "200+" social proof removed.** Hero pill "🎯 Bergabung dengan 200+
  pemilik toko UMKM" → "🏪 Dipakai distributor UMKM di jantung Glodok". Stats
  h2 "Ratusan pemilik toko UMKM sudah bergabung" → "Sudah dipakai distributor
  UMKM di jantung Glodok". Stat cards: swapped fake "200+ Pemilik toko" +
  "7 Industri" + "10 Modul" to real KPIs from case-study tenant: 474 SKU,
  290+ Supplier, 1.500+ Pergerakan stok/bulan, 99.9% Uptime.
- **B2 — Testimonials kept.** Sourced from real GJP tenant with names
  anonymized to "Pak/Ibu" initial format per founder confirmation.
- **B3 — Case-study KPIs kept as-is.** Sourced from real tenant with anonymized
  attribution ("Distributor alat listrik · Jakarta Barat").
- **B4 — Legal footer links fixed.** `/privacy` → `/privacy.html`; `/terms` →
  `/terms.html` (both files, all instances).
- **B5 — Case-study nav links fixed.** `caleo-landing-v1.html` → `/` (2 places).

**High-impact**
- **H6 — OpenGraph + Twitter card + JSON-LD added.** Landing gets `og:image`
  (references `/assets/og-image.png` — needs image asset per §5.2 step 7),
  Twitter summary_large_image, and SoftwareApplication + LocalBusiness
  structured data (address, phone, hours, offers). Case-study gets `og:image`
  (references `/assets/og-case-study.png`) + Article JSON-LD.
- **H7 — Inline `<script>` extraction deferred to ship step.** Mockup keeps
  inline script for standalone preview. §6 step 3 extracts to
  `public/assets/landing.js` so enforcing CSP `script-src 'self'` works.
- **H8 — CSP updated.** §5.5 whitelists Google Fonts (googleapis.com +
  gstatic.com) + Maps iframe origin (www.google.com).
- **H9 — ROI calc null-guard added.** IIFE now bails if any `#roi-*` element
  is missing, matching the defensive pattern of the pricing toggle IIFE.
- **H10 — `robots.txt` + `sitemap.xml` added to ship scope.** §5.2 + §6 step
  5-6.

**Medium**
- **M11 — Setup timeline unified to "~1 minggu kerja".** Case-study "Setup 2
  hari" → "Setup ~1 minggu kerja"; final CTA "1–2 hari kerja" → "~1 minggu
  kerja". FAQ + case-study hero + solution section all already said "1 minggu"
  — no change needed there.
- **M12 — FAQ #10 data export format.** "JSON" → "CSV/Excel" (matches P2-#6
  actual export format).
- **M13 — `prefers-reduced-motion` extended.** Landing's `@media
  (prefers-reduced-motion: reduce)` block now also halts the marquee animations
  (was previously only halting scroll-reveal `.reveal` class).
- **M14 — "HEMAT SAMPAI 50%"** in promo bar marquee (both instances). Clarifies
  that 50% is max discount (12-mo tier); 6-mo tier shows dynamic ~39% via JS.

**Nits**
- **N15 — Google Fonts preconnect added.** `<link rel="preconnect">` to
  `fonts.googleapis.com` + `fonts.gstatic.com` on both pages.
- **N16 — `caleo-pembelian-real.png` (603KB) explicitly NOT copied to
  `public/assets/`** — §5.2 notes exclusion.
- **N17 — `<h1><br>` replaced with `<span style="display:block">`** on both
  pages, preserving the visual line break while improving screen-reader flow.
- **N18 — "Distributor Alat Berat" audience card replaced** with "Distributor
  Sembako & FMCG" — broader UMKM segment, more Indonesian market fit.
- **N19 — Schema.org JSON-LD added** (SoftwareApplication + LocalBusiness on
  landing; Article on case-study).

**Skipped after review**
- N20 (favicon .ico legacy fallback) — modern browser support for PNG favicons
  makes this a non-issue.
