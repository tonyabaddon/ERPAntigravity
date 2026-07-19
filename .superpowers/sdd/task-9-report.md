# Task 9 Report — Staging Deploy + Test Matrix

## Status: DONE

## Staging URL: https://caleo-landing-staging.tonywei.workers.dev

---

## Bugs Found + Fixed (before proceeding)

### Bug 1: `compatibility_date = "2026-07-19"` rejected by Cloudflare API
- **Root cause:** Cloudflare's API rejected a future-dated compatibility date
- **Fix:** Changed to `2025-07-01` in `infra/caleo-landing-worker/wrangler.toml`

### Bug 2: workers.dev subdomain not registered
- **Root cause:** New account, no `*.workers.dev` subdomain provisioned yet
- **Fix:** Registered `tonywei` subdomain via Cloudflare API (`PUT /accounts/.../workers/subdomain`)

### Bug 3: Accessibility score 85/100 (target ≥ 90)
- **Root cause:** 4 failing categories: `color-contrast` (many small-text elements), `frame-title` (Google Maps iframe), `select-name` (ROI dropdowns lacking `for=`), `landmark-one-main` (no `<main>` element)
- **Fix:** Added `<main>` wrapper; iframe `title`; `for=` on labels; darkened all failing color tokens: `--gold-2` → `#92400E`, `--muted` → `#64748B`, `--wa` → `#1a7a3d`, `--success` (small text) → `#166534`, `--danger` (small text) → `#991B1B`; also fixed `rgba(255,255,255,0.7)` invisible text bug in pricing section
- **Result:** Accessibility 85 → 100/100 after 3 deploy cycles

### Bug 4: FAB `.fab-wa` visible on mobile (CSS cascade order bug)
- **Root cause:** Base `.fab-wa { display: inline-flex }` rule at line 1113 appeared AFTER the `@media (max-width: 720px) { .fab-wa { display: none } }` rule at line 1100, so the later base rule won the cascade
- **Fix:** Removed `display:none` from the early media block; moved it to the `@media (max-width: 720px)` block that follows the base definition

### Bug 5: CSP violation from `onload="this.media='all'"` inline event handler
- **Root cause:** Attempted non-render-blocking Google Fonts load via media="print" trick; inline event handlers violate `script-src 'self'` CSP
- **Fix:** Reverted to standard `<link rel="stylesheet">` — performance score remained 0.98–1.0 without the trick anyway

### Bug 6: Logo `<img>` and QR `<img>` missing explicit `width`/`height`
- **Fix:** Added `width="152" height="40"` to both logo instances; `width="190" height="190"` to QR image

---

## Test Matrix Results (28 steps)

| Step | Description | Result |
|------|-------------|--------|
| 1 | Wrangler auth (`npx wrangler whoami`) | **PASS** — authenticated as tonywei.office@gmail.com |
| 2 | Deploy to staging (`wrangler deploy --env staging`) | **PASS** — URL live, Version ID: 39ef9b80 |
| 3 | Sanity check — HTTP 200 + "Toko makin rapi" | **PASS** |
| 4 | All 7 routes return 200 | **PASS** |
| 5 | Security headers on all HTML routes | **PASS** — CSP, HSTS, X-Frame-Options, X-Content-Type, Referrer-Policy, Permissions-Policy all present on 4 HTML routes |
| 6 | Content-type overrides (robots.txt, sitemap.xml) | **PASS** |
| 7 | Playwright 12/12 against staging | **PASS** — 12/12 in 4.3s |
| 8 | Googlebot fetch — og:*, twitter:*, ld+json | **PASS** — all 10 expected meta tags + JSON-LD present |
| 9 | Google Rich Results Test (manual) | **AUTONOMOUS_DEFERRED** — requires Google web UI |
| 10 | Sitemap XML valid + 4 `<loc>` entries | **PASS** |
| 11 | Facebook Sharing Debugger | **AUTONOMOUS_DEFERRED** — requires Facebook developer portal UI; og-image.png serves `image/png` ✓ (pre-check passed) |
| 12 | WhatsApp link preview | **AUTONOMOUS_DEFERRED** — requires sending WA message |
| 13 | Twitter/X Card Validator | **AUTONOMOUS_DEFERRED** — requires Twitter portal UI |
| 14 | Lighthouse desktop | **PASS** — Performance: 1.00, Accessibility: 1.00, Best-Practices: 0.92, SEO: 1.00 |
| 15 | Lighthouse mobile | **PASS** — Performance: 0.98, Accessibility: 1.00, Best-Practices: 0.92, SEO: 1.00 |
| 16 | Chrome desktop walkthrough — all 22 section/element checks | **PASS** — 16 sections, 8 audience cards, 10 module cards, 4 onboarding steps, 3 pricing tiers, 15 FAQ items, 10 testi cards confirmed |
| 17 | DevTools console clean | **PASS** — zero errors/warnings |
| 18 | Interactive JS — ROI calc + pricing toggle | **PASS** — ROI updates on dropdown change; 6mo prices (509K/807K/3.23jt), 12mo (419K/664K/2.66jt), callout "Komit 6 bulan · GRATIS setup · 💡 Pilih 12-bulan hemat 50%..." correct |
| 19 | Firefox desktop smoke | **AUTONOMOUS_DEFERRED** — requires Firefox |
| 20 | Safari desktop smoke | **AUTONOMOUS_DEFERRED** — requires Safari |
| 21 | Mobile emulation iPhone SE 375×667 | **PASS** — nav hidden, modules 1-col, pricing 1-col, mobile CTA visible, FAB hidden (bug fixed), onboarding arrows hidden, marquee animating |
| 22 | iPhone XR 414×896 + iPad 768×1024 | **PASS** — XR: FAB hidden, mobile CTA visible; iPad: FAB visible, mobile CTA hidden, modules 2-col |
| 23 | Keyboard navigation | **PASS** — 41 focusable elements, term-btn tabIndex=0 + type=button, FAB aria-label="Chat WhatsApp", `<main>` landmark, select labels linked |
| 24 | Reduced-motion CSS rules present | **PASS** — `.marquee-track { animation: none !important }`, `.reveal { opacity:1; transform:none }` verified in stylesheet |
| 25 | Lighthouse a11y deep-dive | **PASS** — 100/100, all 23 weighted audits pass |
| 26 | Rollback drill | **PASS** — broken deployed → confirmed empty page → `wrangler rollback` in < 5s → confirmed restored → working redeployed |
| 27 | Sign-off checklist | **PASS** — 22 PASS + 6 AUTONOMOUS_DEFERRED, zero FAIL |
| 28 | No commit needed | **PASS** — staging deploy is ops action, not committed |

---

## Lighthouse Scores

| Category | Desktop | Mobile | Target Desktop | Target Mobile |
|----------|---------|--------|---------------|--------------|
| Performance | 1.00 | 0.98 | ≥ 0.95 ✓ | ≥ 0.85 ✓ |
| Accessibility | 1.00 | 1.00 | ≥ 0.90 ✓ | ≥ 0.90 ✓ |
| Best Practices | 0.92 | 0.92 | ≥ 0.90 ✓ | ≥ 0.90 ✓ |
| SEO | 1.00 | 1.00 | ≥ 0.95 ✓ | ≥ 0.95 ✓ |

---

## Deferred Manual Items (founder morning-of verification)

1. **Step 9** — Google Rich Results Test: https://search.google.com/test/rich-results → paste staging URL → expect SoftwareApplication + LocalBusiness schema, zero errors. Repeat for `/case-study` → Article schema.
2. **Step 11** — Facebook Sharing Debugger: https://developers.facebook.com/tools/debug/ → paste staging URL → verify OG image (1200×630) + title "Caleo — Toko Rapi, Untung Jelas".
3. **Step 12** — WhatsApp link preview: send staging URL to yourself on WA → verify card with logo/title/description.
4. **Step 13** — Twitter/X Card Validator: https://cards-dev.twitter.com/validator → paste staging URL → verify "Summary with large image" card.
5. **Step 19** — Firefox desktop smoke: hero renders, modules 5×2 grid, pricing toggle works, no console errors.
6. **Step 20** — Safari desktop smoke: Inter font loads, CSS gradients render, backdrop-filter blur on nav, no console errors.

---

## Concerns

None blocking Task 10. All programmatically-verifiable items are green.

Note on Best-Practices 0.92: Cloudflare Workers' edge environment causes minor best-practices findings (deprecated API usage in network layer). Not actionable from page code.

Note on wrangler.toml `compatibility_date`: Changed from `2026-07-19` to `2025-07-01` because Cloudflare API rejects dates it considers future. `2025-07-01` enables all stable features needed.

---

## Rollback Command (reference for Task 10 production rollback)

```bash
source .env && npx wrangler rollback --env production --name caleo-landing
```

This exact pattern was verified working in staging (Step 26).
