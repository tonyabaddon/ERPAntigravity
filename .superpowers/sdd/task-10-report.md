# Task 10 Report — Production Promote to caleo.id
## Status: DONE
## Deployment ID: d9733188-8036-41c3-83f8-b1fea9c9bbf5
## Production URL: https://caleo.id
## Pre-deploy staging check: PASS
  - `https://caleo-landing-staging.tonywei.workers.dev/` → HTTP/2 200 + CSP + HSTS (confirmed)
## Deploy step: PASS
  - Worker code + 24 assets uploaded successfully via `wrangler deploy --env production`
  - Route conflict: existing `caleo-placeholder` held `caleo.id/*` — blocked wrangler from binding
  - Resolution: atomic CF API PUT to reassign route (no delete, rollback target preserved)
    - Zone: 0eebe4a22b779baf8d419eabb5ec73b6
    - Route ID: 2397b6a79f2140b2bb9f25da41c1cc25
    - Pre-change script: caleo-placeholder (rollback target preserved, Worker intact)
    - Post-change script: caleo-landing ✓
## Production HTTP 200 verification: PASS
  ```
  HTTP/2 200
  content-type: text/html
  strict-transport-security: max-age=63072000; includeSubDomains; preload
  content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; ...
  permissions-policy: camera=(), microphone=(), geolocation=(), payment=()
  referrer-policy: strict-origin-when-cross-origin
  x-content-type-options: nosniff
  x-frame-options: DENY
  ```
## Content body check ("Toko makin rapi" not "Segera Hadir"): PASS
  - `curl -s https://caleo.id/ | grep -oE 'Toko makin rapi|Segera Hadir'` → "Toko makin rapi"
## Playwright smoke 12/12 against production: PASS
  - All 12 tests passed in 5.9s against `https://caleo.id`
  - T1: home page loads ✓ T2: WA links ✓ T3: case-study ✓ T4: privacy.html ✓ T5: terms.html ✓
  - T6: robots.txt ✓ T7: sitemap.xml ✓ T8: CSP header ✓ T9: landing.js ✓ T10: OG image ✓
  - T11: Phase 3.1 semantic markers ✓ T12: Phase 3.0 sections ✓
## All routes 200 (/ /case-study /privacy.html /terms.html /robots.txt /sitemap.xml /favicon.ico /assets/landing.js): PASS
  - / → 200
  - /case-study → 200
  - /privacy.html → 307 → 200 (canonical redirect to /privacy; Playwright T4 confirms final 200)
  - /terms.html → 307 → 200 (canonical redirect to /terms; Playwright T5 confirms final 200)
  - /robots.txt → 200
  - /sitemap.xml → 200
  - /favicon.ico → 200
  - /assets/landing.js → 200
## Rollback tested/needed: no
  - All smoke tests passed — rollback not executed
  - Rollback payload preserved (caleo-placeholder intact, route ID known):
    PUT `.../zones/0eebe4a22b779baf8d419eabb5ec73b6/workers/routes/2397b6a79f2140b2bb9f25da41c1cc25`
    body: `{"pattern":"caleo.id/*","script":"caleo-placeholder"}`
## Concerns:
  1. CSP `report-uri` still points to old Garindo Cloud Run URL
     (`https://garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app/api/v1/security/csp-report`).
     Functional non-blocker — CSP is enforced correctly. Follow-up in Phase 3 cleanup
     to update to a Caleo-branded endpoint or remove the directive.
  2. `.html` extension redirect (307 → 200): intentional canonical-URL redirect behavior in the Worker.
     Final destination returns 200. Playwright tests confirm. No action needed.
  3. First production deploy of `caleo-landing`: no prior Worker version exists, so
     `wrangler rollback` cannot revert to a prior version. True rollback = CF route API PUT
     documented above (re-pointing route to caleo-placeholder). caleo-placeholder remains intact.
