# Task 6 Report — Cloudflare Worker (`wrangler.toml` + `worker.js`) with Enforcing CSP

**Status**: DONE
**Date**: 2026-07-19
**Files created**:
- `infra/caleo-landing-worker/wrangler.toml`
- `infra/caleo-landing-worker/worker.js`
- `infra/caleo-landing-worker/README.md`

---

## Execution Summary

### Step 1 — Wrangler CLI Verified

wrangler 4.112.0 available via `npx wrangler --version`. No install needed.

### Step 2 — `wrangler.toml` Written

Matches spec verbatim with one correction (see Concerns below):
- `name = "caleo-landing"`, `main = "worker.js"`, `compatibility_date = "2026-07-19"`
- `[assets]` with `directory = "../../public"`, `binding = "ASSETS"`, `run_worker_first = true` (added — see concern)
- `[observability] enabled = true`
- `[env.staging]` — workers.dev auto-URL, no route
- `[env.production]` — `caleo.id/*` route with `zone_name = "caleo.id"`

### Step 3 — `worker.js` Written

ES module format. CSP built as array-joined string. All 6 security headers applied via `Headers` clone. Content-type overrides for `.xml` and `.txt`. No inline scripts allowed (`script-src 'self'`). Adapts spec's REWRITES block (see Concerns).

### Step 4 — `README.md` Written

Runbook covers: staging deploy → production promotion → rollback (wrangler rollback + git revert) → local dev → Email Routing (halo@caleo.id → tonywei.office@gmail.com, dashboard-only setup).

### Step 5 — Local Wrangler Dev Verification

Run `npx wrangler dev --local --port 8787` (temp toml with `compatibility_date = "2026-07-18"` for local compat; production toml keeps `2026-07-19`).

| Check | Result |
|---|---|
| `/ → 200 OK` | PASS |
| `CSP header present with script-src 'self'` | PASS |
| `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` | PASS |
| `X-Frame-Options: DENY` | PASS |
| `X-Content-Type-Options: nosniff` | PASS |
| `Referrer-Policy: strict-origin-when-cross-origin` | PASS |
| `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()` | PASS |
| `/case-study → 200 OK` | PASS |
| `robots.txt Content-Type: text/plain; charset=utf-8` | PASS |
| `sitemap.xml Content-Type: application/xml; charset=utf-8` | PASS |

---

## Concerns / Deviations from Spec

### 1. `run_worker_first = true` — Critical Addition (not in spec)

The spec's `wrangler.toml` block does NOT include `run_worker_first = true`. In wrangler v4, the `[assets]` binding short-circuits asset serving and **bypasses the Worker's fetch handler entirely** for matched files. Without this flag, zero security headers are injected — the entire purpose of this task (enforcing CSP) would be defeated in production.

Added `run_worker_first = true` to `[assets]`. Verified locally: without it, responses have no CSP or HSTS headers; with it, all headers present.

### 2. REWRITES block removed from worker.js

The spec's worker.js includes:
```js
const REWRITES = { "/case-study": "/case-study.html" };
// ... url.pathname = REWRITES[pathname]; ...
```

Cloudflare Assets (in `run_worker_first` mode) handles extensionless URL routing natively. When the worker rewrites `/case-study` → `/case-study.html` and then calls `env.ASSETS.fetch()`, Assets responds with a 307 redirect to `/case-study` → creating an infinite redirect loop. Same issue with `/` → `/index.html` rewrite.

Removed the REWRITES block and explicit default document rewrite. Assets serves `/case-study` as `case-study.html` automatically. Verified: `/case-study` returns 200.

### 3. `compatibility_date = "2026-07-19"` — Wrangler local dev limitation

`wrangler dev --local` rejects future dates. Local testing used `2026-07-19` (date became valid at midnight). The production `wrangler.toml` correctly keeps `2026-07-19` as specified.

---

## Local Gates

No app code modified — linting and Vitest gates not applicable to this infra-only change. Worker logic is pure JS without npm dependencies.

---

## Next Steps

- Task 7: Playwright smoke tests against `wrangler dev --local` (this worker)
- Task 9: `npx wrangler deploy --env staging` → test staging workers.dev URL
- Task 10: `npx wrangler deploy --env production` → caleo.id goes live
