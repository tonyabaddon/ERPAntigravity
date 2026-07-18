# Task 7 Report — Playwright smoke tests: `tests/e2e/tests/landing-smoke.spec.ts`

**Status:** DONE
**Date:** 2026-07-19
**Commit SHA:** (see below)

## Summary

Wrote 12 Playwright smoke tests for the Caleo landing site (caleo.id). Suite runs against local wrangler dev, staging, or production via `CALEO_LANDING_BASE` env var. All 12/12 pass against local wrangler dev at `http://localhost:8787`.

## Deliverables

| File | Purpose |
|------|---------|
| `tests/e2e/tests/landing-smoke.spec.ts` | 12 Playwright smoke tests for caleo.id landing |

## Test coverage

| # | Test name | What it asserts |
|---|-----------|-----------------|
| T1 | home page loads with expected structure | HTTP 200, `h1` contains "Toko makin rapi", `.nav-cta` visible |
| T2 | all WA links contain the correct number | `>=10` `.js-wa-link` elements, each href contains `wa.me/6285264787775` |
| T3 | case-study page loads with back link to / | HTTP 200, h1 visible, `a.back-link` has `href="/"` |
| T4 | privacy.html loads with expected structure | HTTP 200, h1 contains "Kebijakan Privasi", TL;DR section visible |
| T5 | terms.html loads with expected structure | HTTP 200, h1 matches `/Syarat.*Ketentuan/`, TL;DR section visible |
| T6 | robots.txt served with Sitemap directive | HTTP 200, contains `User-agent: *`, Sitemap directive matches `/Sitemap:\s+https?:\/\/\S+\/sitemap\.xml/` |
| T7 | sitemap.xml served as valid XML | HTTP 200, content-type is XML, body contains `<urlset` and `/case-study` |
| T8 | CSP header present + script-src is self only | Response header `content-security-policy` contains `script-src 'self'` and `default-src 'self'` |
| T9 | landing.js loads (external, not inline) | HTTP 200 on `/assets/landing.js`, body contains `roi-staff` and `pricing` |
| T10 | OG image is served | HTTP 200 on `/assets/og-image.png`, content-type is `image/png` |
| T11 | Phase 3.1 semantic markers preserved on home | `>=10` `.js-wa-link`, `#js-slot-counter` attached, `>=10` `.js-testi-card`, `=4` `.js-stat-card`, `=10` `.js-promo-item` |
| T12 | all Phase 3.0 sections render on home | 16 section IDs visible (#hero through #cta), 8 `.aud-card`, 10 `.mod-icon-card`, 4 `.onb-step` |

## Run command

```bash
# Against local wrangler dev (port 8787):
CALEO_LANDING_BASE=http://localhost:8787 npx playwright test tests/e2e/tests/landing-smoke.spec.ts

# Against staging (Task 9):
CALEO_LANDING_BASE=https://<staging-workers-dev-url> npx playwright test tests/e2e/tests/landing-smoke.spec.ts

# Against production:
npx playwright test tests/e2e/tests/landing-smoke.spec.ts  # defaults to https://caleo.id
```

Run from `tests/e2e/` directory (or use `--config` pointing to a config without testMatch restrictions).

## Design decisions

### T6 robots.txt — URL-agnostic assertion
`robots.txt` hardcodes `https://caleo.id/sitemap.xml` (static file). The brief's `${BASE}/sitemap.xml` interpolation would fail on `localhost:8787` and staging. Instead, the test asserts the `Sitemap:` directive exists and points to any valid `sitemap.xml` URL using a regex. This makes the test valid across all environments without modifying the static file.

### T7 sitemap.xml — partial URL match
Same reason: `<loc>` entries hardcode `https://caleo.id/...`. We assert the path fragment `/case-study` is present, which is true across all serving environments.

### T11 #js-slot-counter — toBeAttached not toBeVisible
The slot counter div `#js-slot-counter` exists in the DOM but may have zero height when the slot JS hasn't populated it yet (legitimate DOM presence test vs. CSS visibility). Using `toBeAttached()` is the accurate contract.

### No playwright.config used for this suite
Both existing configs (`playwright.staging.config.ts`, `playwright.prod.config.ts`) have `testMatch` or `baseURL` that conflict with this suite's full-URL pattern. Running with `npx playwright test tests/e2e/tests/landing-smoke.spec.ts` from `tests/e2e/` uses Playwright zero-config defaults (Chromium, no baseURL override).

## Verification

- Local wrangler dev started with `--compatibility-date 2024-12-01` (wrangler.toml's `2026-07-19` date is unsupported by local wrangler 4.112.0)
- **12/12 pass** in 3.5s against `http://localhost:8787`

## Concerns

None for the test file itself. One observation for the operator: `wrangler.toml` has `compatibility_date = "2026-07-19"` which is beyond what local wrangler 4.112.0 supports. This is fine for production deploys to Cloudflare (which runs a newer runtime) but requires `--compatibility-date 2024-12-01` override for local dev testing. Consider pinning `wrangler.toml` to a supported date or documenting the `--compatibility-date` flag in the worker's README.
