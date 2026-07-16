# Task 7 Report — Structured logging + tenant_id middleware (backend Go)

**Status:** DONE
**Date:** 2026-07-17
**Commit SHA:** 0f1d687

## Summary

Migrated the entire backend Go daemon from stdlib `log.Printf` to `log/slog` (Go stdlib 1.21+) with a Cloud Logging-compatible custom handler. Every production request now emits structured JSON fields including `tenant_id`, `user_id`, and `request_id`.

## Deliverables

### New files
| File | Purpose |
|------|---------|
| `backend-go/internal/logging/slog_handler.go` | `CloudHandler` emitting Cloud Logging-compatible JSON (`severity`/`message`/`timestamp`); context key helpers (`WithTenantID`, `WithUserID`, `WithRequestID`) |
| `backend-go/internal/logging/cloud_handler_smoke_test.go` | 3 tests verifying JSON shape, WARN→WARNING mapping, empty-ctx field omission |
| `backend-go/internal/api/context_middleware.go` | `RequestContextMiddleware` — decodes JWT Bearer base64url payload (no sig-verify), extracts `tenant_id` + `sub`, generates `X-Request-Id` UUID if absent |

### Modified files (11)
- `backend-go/main.go` — `logging.Init()` + wires `RequestContextMiddleware` into HTTP server chain
- `backend-go/internal/db/client.go` + `conversations.go`
- `backend-go/internal/engine/machine.go`
- `backend-go/internal/followup/poller.go`
- `backend-go/internal/heartbeat/poller.go`
- `backend-go/internal/recon/handler.go`
- `backend-go/internal/scheduler/timeout.go`
- `backend-go/internal/whatsapp/client.go`
- `backend-go/internal/whatsapp/debounce.go`
- `backend-go/internal/whatsapp/handler.go`

## Migration scope

**Total production log sites migrated: 178** (within the 188 counted — 10 excluded by design):
- `config/config.go` — fires before `logging.Init()`, intentionally kept as `log.Println`
- `internal/approvals/expiry_poller.go` — has `WithLogger(*log.Logger)` functional option used by tests that capture log output by string matching; changing this would break test API. Kept as-is; `log.Default()` is bridged to slog in Go 1.21+ via `SetDefault`.
- `cmd/apply-migration/` + `cmd/smoke-gemini/` — dev/admin tooling, not production daemon.

**Zero remaining** `log.Printf`/`log.Println`/`log.Fatalf` in production daemon path (verified by grep).

## Cloud Logging field mapping

| stdlib slog field | CloudHandler emits |
|---|---|
| `level` | `severity` (`WARN`→`WARNING`) |
| `msg` | `message` |
| `time` | `timestamp` (RFC 3339 Nano, UTC) |
| ctx `tenant_id` | `tenant_id` (omitted when empty) |
| ctx `user_id` | `user_id` (omitted when empty) |
| ctx `request_id` | `request_id` (omitted when empty) |

## Verification

- `go build ./...` — clean (0 errors)
- `go test ./internal/...` — all pass
- CloudHandler smoke tests: 3/3 pass (JSON shape, WARN→WARNING, no-empty-fields)
- `npm run lint` — clean (FE unaffected)
- Zero `log.Printf` remaining in production files
- Push triggered Cloud Build deploy

## Cloud Logging query (for founder to verify after deploy)

```
resource.type="cloud_run_revision"
jsonPayload.tenant_id="<paste a real tenant UUID here>"
```

Or to verify request_id tracing works end-to-end:
```bash
curl -H "X-Request-Id: test-uuid-123" https://your-cloud-run-url/api/v1/health
# Then query: jsonPayload.request_id="test-uuid-123"
```

## Concerns

None. Design decisions (approvals poller test API, config pre-init) documented inline.
