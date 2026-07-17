# Task 16 — Security headers design (2026-07-18)

Zero-cost, scale-forward best-practice. Grade F → A on securityheaders.com.

## Baseline (pre-change)

All 3 subdomains served zero security headers:
```
curl -sI https://app.caleo.id/         → only x-cloud-trace-context
curl -sI https://admin.caleo.id/       → only x-cloud-trace-context
curl -sI https://caleo.id/             → only x-robots-tag noindex
```

## Serving stacks

| Domain | Server | How headers ship |
|---|---|---|
| app.caleo.id | Cloud Run `garindo-jaya-panel-msme-erp-frontend` (npm `serve` v14) | `serve.json` at `dist/serve.json` |
| admin.caleo.id | Same Cloud Run (hostname detection in App.tsx) | Same `serve.json` |
| staging.app.caleo.id / staging.admin.caleo.id | Cloud Run staging FE | Same `serve.json` via same image |
| caleo.id | Cloudflare Worker | (deferred — separate follow-up) |
| backend Cloud Run | Go net/http | (deferred — Go middleware follow-up) |

Task 16 focuses on the FE Cloud Run (highest attack surface — renders HTML/JS to browsers).

## Headers shipped

Per `serve.json`:

| Header | Value | Rationale |
|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | 2-year HSTS with preload — HTTPS-only, no downgrade attacks |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME sniffing |
| `X-Frame-Options` | `SAMEORIGIN` | Blocks cross-origin `<iframe>` embed (clickjacking) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Cross-origin sends origin only, no path/query |
| `Permissions-Policy` | disables camera/mic/geolocation/payment/usb/magnetometer/gyroscope/accelerometer | We don't use any; deny by default |
| `Content-Security-Policy-Report-Only` | See below | Report-only for 24h, then enforce |

## CSP breakdown

Report-only value:
```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' data: https://fonts.gstatic.com;
img-src 'self' data: blob: https://ekhhojaezdfjfwuxyjkl.supabase.co https://*.supabase.co https://storage.googleapis.com;
connect-src 'self' https://ekhhojaezdfjfwuxyjkl.supabase.co wss://ekhhojaezdfjfwuxyjkl.supabase.co https://*.supabase.co wss://*.supabase.co https://garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app https://garindo-jaya-panel-msme-erp-staging-xnrhcw7onq-as.a.run.app;
frame-ancestors 'self';
base-uri 'self';
form-action 'self';
object-src 'none'
```

### CSP source rationale

- `script-src 'unsafe-inline' 'unsafe-eval'` — required for Vite dev-style bundles + one inline `<script>` in `index.html`. Tighten to hashed sources in Phase 3 refactor.
- `style-src 'unsafe-inline'` — required for Tailwind + inline styles in error screens (TenantDetailShell etc.)
- `img-src` allows `data:`/`blob:` (avatar fallbacks + product photo previews), Supabase storage buckets, GCS buckets (backup viewer future)
- `connect-src` covers Supabase REST + Auth + Realtime WS + backend Cloud Run REST endpoints
- `frame-ancestors 'self'` = same policy as X-Frame-Options SAMEORIGIN but with more granular control
- `object-src 'none'` = no `<object>`/`<embed>` allowed (Flash-era attack surface)

## Rollout plan (industry standard)

1. **Deploy in Report-Only mode** (this commit). Prod traffic runs identically; violations logged in browser console + optionally to a report-uri.
2. **Wait 24h**, observe console errors from real tenant users (`Toko Jaya Makmur`, `Warung Sinar Rezeki`, `Garindo`).
3. **Fix any legitimate violations** (add missing source URLs to CSP).
4. **Flip to enforcing mode** (rename `Content-Security-Policy-Report-Only` → `Content-Security-Policy`).

If skipped: strict CSP shipped in one shot risks breaking prod (Supabase client, realtime, third-party lib fetching an unlisted CDN). Report-only mode = zero user impact, evidence-driven enforcement.

## Rollback

- Revert commit
- Cloud Run auto-redeploys previous image on next build OR: `gcloud run services update-traffic ... --to-revisions=<previous>=100`
- Zero-cost, zero-side-effect rollback

## Verification post-deploy

```bash
# All 3 subdomains
curl -sI https://app.caleo.id/         | grep -iE 'strict|policy|frame|content|referrer|permissions|x-'
curl -sI https://admin.caleo.id/       | grep -iE 'strict|policy|frame|content|referrer|permissions|x-'
curl -sI https://staging.app.caleo.id/ | grep -iE 'strict|policy|frame|content|referrer|permissions|x-'

# Full grade check
# → https://securityheaders.com/?q=app.caleo.id
# → https://securityheaders.com/?q=admin.caleo.id
```

Expected: grade A (missing points from HSTS preload registry submission — separate manual step).

## Deferred (out of scope tonight)

- Landing caleo.id headers (served by Cloudflare Worker, needs Worker code edit)
- Backend Go headers (Go net/http middleware, less critical — JSON API not attack-surface for browser XSS)
- HSTS preload registry submission (https://hstspreload.org/ — founder step after 30 days of confirmed HSTS)
- Enforce CSP (after 24h Report-Only observation)
- Tighten CSP script-src to remove 'unsafe-inline' + 'unsafe-eval' (requires Vite build changes + hash-based CSP)

## Cost

$0. Cloud Run response headers are free. serve.json parsing is negligible CPU.
