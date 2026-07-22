# Task 11 — Sentry error tracking design (2026-07-17)

Design only. No changes shipped. No Sentry account created yet.

---

## Current state

### Sentry integration in codebase

None. Zero references to `Sentry`, `@sentry`, `sentry-go`, or `dsn` anywhere in `src/`, `backend-go/`, `package.json`, or `go.mod`.

### Error boundary

None. No `ErrorBoundary` or `componentDidCatch` in any component. The entire React tree is unguarded — an uncaught render error at any component level will crash the whole UI silently (white screen) with no reporting.

### Silent errors observed

**Frontend — console.error only (not forwarded anywhere):**

- `src/App.tsx` lines 227–253 — session restore errors (failed to fetch admin_users role, failed to fetch tenant slug) go to `console.error`. These affect every tenant on page load if auth is flaky.
- `src/App.tsx` lines 346–415 — stock load failures, stock refresh failures, Supabase update failures — all `console.error`.
- `src/contexts/TenantContext.tsx` line 35 — bootstrap errors surfaced to UI as a raw error code string, but not tracked.
- `src/contexts/SalesChannelsContext.tsx` line 55 — `console.error` only.
- `src/components/KasirInvoiceModal.tsx` line 34 — `.catch(console.error)` (bare, no user feedback).
- `src/components/NotificationSettingsScreen.tsx` — 3 separate `console.error` catch paths.
- `src/components/SelectTenantScreen.tsx` line 24 — `.catch(() => setTenants([]))` — silently shows empty list, no tracking.
- `src/components/LaporanScreen.tsx` lines 100–106 — 4 separate report section load failures, all `console.error`.
- `src/components/AuthScreen.tsx` line 274 — failed owner row creation, `console.error`.
- `src/components/UserManagementScreen.tsx` — 6 separate `console.error` paths (permission upsert, invite, delete).
- `src/components/PengaturanScreen.tsx` — 7+ separate `console.error` paths.
- `src/components/ManajemenGudangScreen.tsx` line 48 — `console.error`.

**Total: ~191 untracked `console.error` / `.catch(console.error)` / silent-catch calls in `src/components/`.**

**Frontend — no global error handler** (`window.onerror`, `window.addEventListener('unhandledrejection')`) exists. Promise rejections that escape `.catch()` handlers are silently dropped.

**Backend — slog only:**

- All errors use `slog.Error` / `slog.Warn` — structured logs go to Cloud Logging but no per-error stack traces, breadcrumbs, or user/tenant context attached to individual events.
- `backend-go/internal/whatsapp/handler.go` line 118 — panic recovery in WA handler goroutine: logs the panic as `slog.Error` but does not forward to any error tracker.
- `backend-go/internal/whatsapp/debounce.go` line 226 — same pattern.
- `backend-go/internal/jobs/worker.go` line 122 — job handler failures logged as `slog.Error("handler returned error")`, marked `FAILED` in DB, no external visibility.
- No HTTP-level panic recovery middleware. A panic in any non-WA handler goroutine will crash the Cloud Run process (self-healing via restart, but error is never captured as an event with context).

### React version

`react: ^19.0.1` — `@sentry/react` v9+ supports React 19. Use `@sentry/react@^9`.

---

## Proposed Sentry setup

### A. Account structure

| Setting | Value |
|---|---|
| Organization | `caleo` |
| Project 1 | `caleo-frontend` (platform: React) |
| Project 2 | `caleo-backend` (platform: Go) |
| Plan | Developer (free) — 5k errors/month shared quota |
| Retention | 90 days (free tier default) |
| User seats | 1 (founder only) |
| Environments | `production`, `staging` |

Both projects share the same 5k/month quota at the org level. At current scale (<10 tenants, expected ~100–500 errors/month), headroom is ~10×.

---

### B. Frontend integration (`@sentry/react`)

**Package:** `@sentry/react@^9` (React 19 compatible; `@sentry/browser` is a subset — use `@sentry/react` to get `ErrorBoundary` and component stack context).

**Entry point:** `src/main.tsx` — this is confirmed as the Vite entry point (`createRoot` lives here). Sentry init MUST run before `createRoot` so the SDK wraps React's error handling from the start.

**DSN:** Public-safe. Inject as `VITE_SENTRY_DSN` build arg in `Dockerfile` and `cloudbuild.frontend.yaml` (same pattern as `VITE_SUPABASE_URL`). DSN is intentionally public — Sentry rate-limits abuse server-side.

**Release SHA:** `VITE_COMMIT_SHA` — inject `$COMMIT_SHA` from Cloud Build as a new `--build-arg`. Already available in `cloudbuild.frontend.yaml` as `$COMMIT_SHA` (used in image tagging and tag URLs). No new variable needed at Cloud Build level — only Dockerfile + vite usage is new.

**Proposed `src/main.tsx` init (design, not code to ship now):**

```ts
import * as Sentry from '@sentry/react';

// Init BEFORE createRoot — captures errors from React hydration onwards.
// DSN is public-safe per Sentry architecture. Quota-gated via beforeSend.
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,

  environment: import.meta.env.VITE_SENTRY_ENV ?? (
    // Fallback: derive from hostname at runtime.
    // app.caleo.id → 'production', anything else → 'staging'
    window.location.hostname === 'app.caleo.id' ? 'production' : 'staging'
  ),

  release: import.meta.env.VITE_COMMIT_SHA,

  // 10% of frontend transactions sampled — stays under 10k/month free limit.
  tracesSampleRate: 0.1,

  // Suppress high-volume browser noise that adds no signal.
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
    'Non-Error promise rejection captured',
    'NetworkError when attempting to fetch resource', // offline users
    'Load failed',                                     // iOS Safari network drop
    'ChunkLoadError',                                  // stale tab, auto-resolves on refresh
  ],

  beforeSend(event) {
    // PII scrubbing — see Section D for full rules.
    return scrubbedEvent(event); // utility function defined in src/lib/sentryUtils.ts
  },
});
```

**Tenant scoping (after auth resolves in App.tsx):**

After the Supabase auth session is confirmed and `tenant_id` is known (currently extracted from JWT claims in `App.tsx`), set Sentry scope:

```ts
// Called once after session restore succeeds, inside the useEffect that sets tenantSlug.
Sentry.setTag('tenant_id', tenantId);
Sentry.setUser({ id: userId });
```

This tags every subsequent event with the tenant so Sentry can filter by `tenant_id` in the Issues view.

**Error Boundary:**

Wrap `<App />` in `Sentry.ErrorBoundary` in `src/main.tsx`. This catches uncaught render errors that currently white-screen silently:

```tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<CriticalErrorFallback />}>
      <App />
    </Sentry.ErrorBoundary>
    <Toaster position="top-right" richColors closeButton />
  </StrictMode>,
);
```

`CriticalErrorFallback` is a simple inline component: "Something went wrong. Please refresh the page." The `Sentry.ErrorBoundary` automatically sends the error + component stack to Sentry.

---

### C. Backend integration (`sentry-go`)

**Package:** `github.com/getsentry/sentry-go@latest` + `github.com/getsentry/sentry-go/http` for HTTP middleware.

**Entry point:** `backend-go/main.go` — init at the very top of `main()`, before `logging.Init()` even, so panics during startup are captured.

**DSN:** `SENTRY_DSN` env var — NOT a build arg, injected at runtime via Cloud Run environment variables (same mechanism as `GEMINI_API_KEY`, `SUPABASE_DB_CONN`, etc.). Founder adds it in Cloud Run → Edit & Deploy → Container → Variables & Secrets. Do NOT use Secret Manager for this (DSN is public-safe; no need to burn a Secret Manager secret).

**Proposed `main.go` init (design, not code to ship now):**

```go
sentryDSN := os.Getenv("SENTRY_DSN")
if sentryDSN != "" {
    if err := sentry.Init(sentry.ClientOptions{
        Dsn:              sentryDSN,
        Environment:      getEnvDefault("ENVIRONMENT", "production"),
        Release:          os.Getenv("COMMIT_SHA"), // injected by Cloud Build
        SampleRate:       1.0,   // capture ALL backend errors (volume is bounded)
        TracesSampleRate: 0.1,   // 10% of transactions
        BeforeSend: func(event *sentry.Event, hint *sentry.EventHint) *sentry.Event {
            return scrubSentryEvent(event) // PII scrubber defined in internal/sentryutil/scrub.go
        },
    }); err != nil {
        slog.Error("[SENTRY] init failed", slog.Any("error", err))
        // Non-fatal: proceed without Sentry rather than blocking startup.
    }
    defer sentry.Flush(2 * time.Second)
    slog.Info("[SENTRY] initialized", slog.String("env", os.Getenv("ENVIRONMENT")))
} else {
    slog.Warn("[SENTRY] SENTRY_DSN not set — error tracking disabled")
}
```

**Sentry is optional at startup** — if `SENTRY_DSN` is empty, the backend starts normally with slog-only. This means Sentry can be added/removed without a code change. Zero-DSN is the safe default.

**HTTP panic recovery middleware:**

Currently there is no HTTP-level panic recovery middleware. Add `sentryhttp` as the outermost middleware in the chain:

```go
// Wrap the entire handler chain. sentryhttp.New auto-captures panics
// and attaches request method/URL/headers to the Sentry event.
sentryHandler := sentryhttp.New(sentryhttp.Options{
    Repanic: true, // re-panic after capture so Cloud Run logs the crash too
})

// Updated middleware order (outermost → innermost):
//   1. sentryhttp.Handle    — panic capture + request context
//   2. RequestContextMiddleware — extracts tenant_id/user_id from JWT
//   3. rateLimiter.Wrap
//   4. VersionRouter
//   5. mux
if err := http.Serve(ln, sentryHandler.Handle(
    api.RequestContextMiddleware(rateLimiter.Wrap(api.VersionRouter(mux))),
)); err != nil {
    sentry.CaptureException(err)
    slog.Error("[MAIN] HTTP error", slog.Any("error", err))
}
```

**Tenant scoping for HTTP requests:**

Inside `RequestContextMiddleware` (after extracting `tenantID`), attach to the Sentry Hub:

```go
sentry.ConfigureScope(func(scope *sentry.Scope) {
    scope.SetTag("tenant_id", tenantID)
    scope.SetUser(sentry.User{ID: userID})
})
```

Or, for cleaner per-request isolation, use `sentry.WithScope`:

```go
hub := sentry.GetHubFromContext(ctx)
if hub == nil {
    hub = sentry.CurrentHub().Clone()
    ctx = sentry.SetHubOnContext(ctx, hub)
}
hub.Scope().SetTag("tenant_id", tenantID)
hub.Scope().SetUser(sentry.User{ID: userID})
```

The `sentryhttp` middleware already clones the hub per request, so `scope.SetTag` inside the middleware is per-request safe.

**Worker job failure capture:**

In `backend-go/internal/jobs/worker.go`, at the `jobErr != nil` branch, add:

```go
sentry.WithScope(func(scope *sentry.Scope) {
    scope.SetTag("tenant_id", tenantID)
    scope.SetTag("job_type", jobType)
    scope.SetTag("job_id", jobID)
    sentry.CaptureException(jobErr)
})
```

**WA handler panic capture:**

In `backend-go/internal/whatsapp/handler.go` line 118, inside the existing `recover()` block, add:

```go
if r := recover(); r != nil {
    slog.Error("[HANDLER] escalation goroutine panic", slog.Any("error", r))
    sentry.CurrentHub().Recover(r)  // forward panic to Sentry with current scope
}
```

Same pattern for `debounce.go` line 226.

---

### D. PII scrubbing rules

Both `beforeSend` (FE) and `BeforeSend` (BE) must remove the following from captured events, breadcrumbs, request bodies, and extra data:

| PII type | Pattern | Where it appears |
|---|---|---|
| Supabase JWT tokens | String starting with `eyJ` (base64 header) | Authorization header breadcrumbs (FE network tab), request headers (BE sentryhttp) |
| Supabase service_role key | `SUPABASE_SERVICE` prefix or 80+ char strings in env | Should never appear in errors but defense-in-depth |
| WhatsApp phone numbers | `628XXXXXXXX` / `08XXXXXXXX` pattern (10–15 digits) | Error messages from WA handler, breadcrumb user fields |
| Customer names | `nama_pelanggan`, `customer_name` JSON keys | Supabase RPC error payloads included in caught exceptions |
| Customer phones | `customer_phone`, `nomor_hp` JSON keys | Same as above |
| Passwords | `password`, `pin`, `new_pin`, `old_pin` JSON keys | Auth flow errors |
| Credit card patterns | 13–19 consecutive digits | Defense-in-depth (not a current feature) |

**Frontend scrubber (`src/lib/sentryUtils.ts`):**

```ts
// Strip JWT tokens from breadcrumb URLs and request headers.
// Strip phone number patterns from any string values.
// Walk event.breadcrumbs.values[*].data and event.extra recursively.
// Return null to drop an event entirely if it contains a known JWT prefix.
```

**Backend scrubber (`internal/sentryutil/scrub.go`):**

```go
// Walk event.Request.Headers — remove Authorization, Cookie.
// Walk event.Extra and event.Tags — redact values matching PII patterns.
// Trim event.Request.Data (POST body) entirely — contains customer payloads.
```

Sentry's built-in `DataScrubber` handles common patterns (passwords, credit cards) if enabled in project settings. Enable it in Sentry project settings → Security & Privacy → Data Scrubbing → Enable Default PII Scrubbing. Our `beforeSend` is defense-in-depth on top.

---

### E. Source maps (frontend)

**Current state:** Vite's default `build.sourcemap` is `false` in production. Source maps are NOT currently generated in the production build.

**Why this matters:** Without source maps, Sentry shows minified stack traces like `n.t.map(t=>t.id)` at line 1 col 84234. Useless for debugging.

**Design:**

1. In `vite.config.ts`, add `build: { sourcemap: 'hidden' }` — generates `.map` files alongside the bundle but does NOT add `//# sourceMappingURL` comments to the JS files (so browsers never download them, but Sentry CLI can find and upload them).

2. In `cloudbuild.frontend.yaml`, add a new Cloud Build step after the Docker build step, BEFORE the push step:

   ```yaml
   - name: 'node:20'
     entrypoint: 'sh'
     args:
       - '-c'
       - |
         set -e
         npm ci --prefer-offline
         # Build for sourcemap extraction (already built in Docker, but we need
         # local dist/ to upload maps — Docker build discards intermediate layers).
         VITE_SENTRY_DSN=$_VITE_SENTRY_DSN \
         VITE_COMMIT_SHA=$COMMIT_SHA \
         npm run build
         # Upload source maps to Sentry, associated with this release.
         npx @sentry/cli@latest sourcemaps inject ./dist
         npx @sentry/cli@latest sourcemaps upload \
           --org caleo \
           --project caleo-frontend \
           --release $COMMIT_SHA \
           ./dist
         # Delete .map files so they are not included in the Docker image
         # (Nginx would serve them publicly — security risk).
         find ./dist -name '*.map' -delete
   ```

   This requires `SENTRY_AUTH_TOKEN` as a Cloud Build substitution variable (secret) — founder creates an internal integration token in Sentry (Settings → Developer Settings → Internal Integrations → create token with `project:releases` + `org:read` scopes). Store as a Cloud Build substitution `_SENTRY_AUTH_TOKEN`.

3. Source map upload is free on the Developer plan (no quota cost).

4. After maps are uploaded, `.map` files are deleted from `dist/` before Docker COPY — they never land in the Nginx static bundle.

**Note:** The source map upload step runs in a separate `node:20` Cloud Build step, NOT inside Docker. This is required because Docker's multi-stage build discards the intermediate `builder` layer; the local Cloud Build workspace has `dist/` available between steps.

---

### F. Release + environment tagging

**Release name convention:** `$COMMIT_SHA` (full 40-char SHA) — consistent across FE and BE, enabling cross-service correlation in Sentry's "Releases" view.

**FE:** `VITE_COMMIT_SHA` build arg → `import.meta.env.VITE_COMMIT_SHA` → passed to `Sentry.init({ release })`.

**BE:** `COMMIT_SHA` env var injected by Cloud Build → `os.Getenv("COMMIT_SHA")` → passed to `sentry.Init({ Release })`. In `cloudbuild.yaml`, add `--set-env-vars=COMMIT_SHA=$COMMIT_SHA` to the Cloud Run deploy step.

**Environment tag:**

- FE: `VITE_SENTRY_ENV` build arg — set to `production` in the prod deploy step, `staging` in the staging deploy step. Fallback to hostname detection if not set.
- BE: `ENVIRONMENT` env var — already injectable via Cloud Run; set to `production` in prod service, `staging` in staging service.

**Sentry releases CLI (`@sentry/cli`):**

In the Cloud Build sourcemap step (above), `sourcemaps inject` + `sourcemaps upload` automatically creates the Sentry release for `$COMMIT_SHA`. No separate `releases new` command is needed when using `sourcemaps upload`.

---

### G. Quota management

**Free tier:** 5,000 errors/month across all projects in the org. Sentry stops accepting events at 5k (does not charge, just drops).

**Estimated usage at current scale (10 tenants):**
- FE errors: ~50–200/month (based on console.error volume × typical Sentry capture rate)
- BE errors: ~20–100/month (slog.Error events that would forward to Sentry)
- Total: ~70–300/month — ~6% of quota. Headroom: ~16× before hitting the limit.

**Quota alert:** In Sentry project settings → Alerts → create a "Spike Protection" + usage alert at 80% (4,000 errors). Sentry emails the founder. No external GCP alert needed for this.

**Fallback when near cap:** In `beforeSend`, implement a client-side rate limiter:

```ts
// Sliding-window counter in localStorage. If > 3,800 events this calendar month
// (conservative estimate for local tracking), return null to suppress.
// This protects against a single flapping client exhausting org quota.
```

Note: Sentry's own Spike Protection (enabled in project settings) drops bursts from a single IP — enable this as a first line of defense.

**Scaling path:** At ~500 tenants (expected ~2 years), estimated error volume: 3,500–15,000/month. The free tier may not be sufficient. At that point, evaluate Team plan ($26/month/seat) or implement more aggressive `beforeSend` sampling. This is a named future decision, not blocking today.

---

## Founder actions before R2 dispatch

1. Go to https://sentry.io/signup/ — sign up for a free Developer account using `tonywei.office@gmail.com`.
2. Create organization: `caleo`.
3. Create project `caleo-frontend`: Platform = React, Framework = React → copy DSN URL (format: `https://<key>@o<org>.ingest.sentry.io/<project>`).
4. Create project `caleo-backend`: Platform = Go → copy DSN URL.
5. In both projects: Settings → Security & Privacy → enable "Default PII Scrubbing" + enable "Spike Protection".
6. Create an Internal Integration token for CI sourcemap upload: Settings → Developer Settings → New Internal Integration → name it `caleo-ci` → grant scopes `project:releases` + `org:read` → save and copy the token.
7. Save all 3 values in your secure password manager:
   - `caleo-frontend` DSN
   - `caleo-backend` DSN
   - `caleo-ci` auth token
8. In Cloud Run → prod backend service: add env var `SENTRY_DSN` = (caleo-backend DSN) and `ENVIRONMENT` = `production`.
9. In Cloud Build substitutions for the frontend trigger: add `_VITE_SENTRY_DSN` = (caleo-frontend DSN) and `_SENTRY_AUTH_TOKEN` = (caleo-ci token).
10. Provide me the 3 values at R2 start — I will implement the code changes.

---

## Cost analysis

| Item | Cost |
|---|---|
| Sentry Developer plan | $0/month |
| Error quota | 5,000 errors/month (shared across both projects) |
| Performance quota | 10,000 transactions/month (10% sample rate = ~enough for ~100k FE requests/month) |
| Source map upload | Free (unlimited) |
| Retention | 90 days |
| Estimated usage (10 tenants) | ~70–300 errors/month (~6% of quota) |
| Quota headroom | ~16× at current scale |
| Break-even scale for upgrade | ~500 tenants / ~3,500+ errors/month |

No new paid services introduced. Zero cost until quota is exceeded.

---

## Rollback plan

R2 implementation will be a self-contained PR. Rollback = revert the PR commits.

**Frontend rollback:**
- Remove `@sentry/react` from `package.json`.
- Remove Sentry init from `src/main.tsx`.
- Remove `Sentry.ErrorBoundary` wrapper — restore plain `<App />`.
- Remove `Sentry.setTag` calls from `App.tsx`.
- Remove `VITE_SENTRY_DSN` and `VITE_COMMIT_SHA` from `Dockerfile` and `cloudbuild.frontend.yaml`.
- Remove sourcemap upload step from `cloudbuild.frontend.yaml`.
- Remove `build: { sourcemap: 'hidden' }` from `vite.config.ts`.
- **Effect:** errors go back to `console.error` only. No user-facing change.

**Backend rollback:**
- Remove `sentry-go` dependency from `go.mod`.
- Remove `sentry.Init()` and `sentryhttp.Handle()` from `main.go`.
- Remove `sentry.CaptureException()` calls from `worker.go` and `handler.go`.
- Remove `SENTRY_DSN` env var from Cloud Run service.
- **Effect:** errors go back to `slog.Error` only. No user-facing change.

---

## Follow-ups explicitly out of scope for R1

- **Session Replay** — 50 free/month. MSME context: tenants are founders using a complex ERP. Replays are high-value for onboarding bugs but 50/month is exhausted quickly. Defer until quota allows or Team plan is considered. Not implementing in R2.
- **Performance / APM deep instrumentation** — auto-instrumentation via `@sentry/react` captures page load and navigation. Database query spans require manual instrumentation on every Supabase call. Too invasive for R2.
- **Distributed tracing FE↔BE** — requires `tracePropagationTargets` in FE + `sentryhttp.Options{EnableTracing: true}` in BE. Low value at current scale (not microservices). Defer.
- **Sentry Alerts (internal to Sentry)** — Task 10 GCP alerting covers the main uptime/error-rate signals. Sentry issue alerts are additive. Defer to R3 if needed.
- **Cron monitoring** — Sentry can monitor scheduled jobs. Defer; the job worker is low-volume today.
- **User feedback widget** — Sentry's user feedback form. MSME founders prefer WhatsApp. Not implementing.
