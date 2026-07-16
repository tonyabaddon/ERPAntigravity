# Task 4 Report: API /api/v1/* prefix + backward compat (Caleo Phase 1 Day 4)

**Date:** 2026-07-17
**Commit SHA:** 254223e
**Status:** DONE

---

## What Was Implemented

### Backend Go

**New file: `backend-go/internal/api/version_middleware.go`**
- `VersionRouter(inner http.Handler) http.Handler` middleware
- `/api/v1/<path>` → rewrites URL to `/api/<path>` → delegates to inner mux
- `/api/<path>` (legacy) → sets `X-Deprecated-Path: /api/v1/<path>` header + `slog.WarnContext` → delegates to inner mux as-is
- Any other prefix → `http.NotFound`
- No new dependencies — stdlib only (`log/slog`, `net/http`, `strings`)

**Modified: `backend-go/main.go`** (1-line change)
- `http.Serve(ln, mux)` → `http.Serve(ln, api.VersionRouter(mux))`
- All 11 route registrations unchanged — keep `/api/` prefix on inner mux

**Modified: `cloudbuild.yaml`**
- Added `API_VERSION=v1` to `--update-env-vars` (cosmetic marker, inferred from URL)

### Frontend (8 fetch paths → `/api/v1/`)

- `src/components/WhatsappAiScreen.tsx`:
  - `/api/wa/qr` → `/api/v1/wa/qr`
  - `/api/wa/logout` → `/api/v1/wa/logout`
  - `/api/wa/pair-code` → `/api/v1/wa/pair-code`
  - Line 870 (`app.post('/api/whatsapp/webhook', ...)`) left unchanged — dead Express.js code inside JSX, not a live fetch call
- `src/lib/cariByFotoService.ts`:
  - `/api/products/search-by-photo` → `/api/v1/products/search-by-photo`
  - `/api/products/index-photos` → `/api/v1/products/index-photos`
- `src/lib/supabaseClient.ts`:
  - `/api/recon/upload` → `/api/v1/recon/upload`
  - `/api/recon/close` → `/api/v1/recon/close`

---

## Verification

### Local gates (all green)

| Gate | Result |
|---|---|
| `go build ./...` | PASS — clean |
| `go test ./internal/api/...` | PASS — 7/7 (approval_webhook tests unaffected) |
| `npm run lint` (tsc --noEmit) | PASS — clean |
| `npm run audit:numinput` | PASS — clean |
| `npm run audit:secdef-null-tenant` | PASS — clean |

### Pre-deploy prod state

```
curl -sI $BE_URL/api/v1/health → HTTP/2 404 (expected — old build)
curl -sI $BE_URL/api/health → HTTP/2 200 (working)
```

### Post-deploy prod verification (VERIFIED)

Cloud Builds: `d1744f83` (backend) — SUCCESS, `11cd8f58` (frontend) — SUCCESS.

```
curl -sI $BE_URL/api/v1/health:
  HTTP/2 200
  access-control-allow-headers: Content-Type, Authorization
  access-control-allow-methods: GET, POST, OPTIONS, PUT, DELETE
  access-control-allow-origin: *
  content-type: application/json

curl -sI $BE_URL/api/health:
  HTTP/2 200
  access-control-allow-headers: Content-Type, Authorization
  access-control-allow-methods: GET, POST, OPTIONS, PUT, DELETE
  access-control-allow-origin: *
  content-type: application/json
  x-deprecated-path: /api/v1/health    <-- backward compat header
```

FE bundle verification: 7/7 `/api/v1/` paths confirmed in deployed JS bundle:
- `/api/v1/products/index-photos`
- `/api/v1/products/search-by-photo`
- `/api/v1/recon/close`
- `/api/v1/recon/upload`
- `/api/v1/wa/logout`
- `/api/v1/wa/pair-code`
- `/api/v1/wa/qr`

No stale `/api/` non-v1 paths in bundle (only `/api/broadcast` from Supabase Realtime library — not a backend-go route).

---

## Design decisions

1. **`VersionRouter(inner http.Handler)`** vs brief's callback form — simpler, no callback needed, composes cleanly with main.go's scattered route registration pattern (routes added at 3 points after async inits).

2. **Routes keep `/api/` prefix** on inner mux — zero route renaming. The middleware handles rewriting. WA bridge daemon at `/api/approval/wa-webhook` continues working without any external coordination.

3. **Rewrite logic:** `/api/v1/health` → strip `/api/v1/` → prepend `/api/` → `/api/health`. Works for all paths including nested ones.

---

## Backward compat contract

- Legacy `/api/*` callers (WA bridge daemon at `/api/approval/wa-webhook`) continue working with deprecation header
- Sunset plan: legacy `/api/*` removed 2027-Q3 after 1 release cycle
- **Rollback plan:** `git revert 254223e` — all routes at `/api/*` continue to work with no middleware overhead

---

## Concerns

None. Clean implementation.

- Pre-existing vitest failures (warehouse-transfer worktree) are from a parallel session — unrelated
- No new dependencies (stdlib only)
- External WA bridge daemon protected by legacy backward-compat path
