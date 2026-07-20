# 2026-07-20 — Backend WA client init crashloop

## Summary
Prod + staging Cloud Run backend Go service crashloops at startup: `[MAIN] WA client init failed` → `Container called exit(1)`. Cloud Build succeeds for `sinar-elektrik-frontend` on every commit; the backend trigger (`rmgpgab-sinar-elektrik-msme-erp-asia-southeast1-tonyabaddon-anv`) FAILS at Step 3 staging deploy on every commit since 82f0a03 (14:02 UTC last SUCCESS). Prod backend on revision `garindo-jaya-panel-msme-erp-00469-dub` (tag `c82f0a03`, 100% traffic) is unable to boot new instances — every cold-start attempt fails the /api/v1/ready probe.

Real customer impact: WA bot cannot receive/send messages. app.caleo.id ERP web app still works (uses Supabase directly, not backend Go).

**Not caused by QA-week Wave 1.** Backend Go binary is byte-identical between last-good 82f0a03 and current 9b93377 (`git diff 82f0a03 9b93377 -- backend-go/` = empty). Wave 1 shipped migrations 503 (RLS predicate swap on `warehouse_transfer*`) + 504 (4 perf indexes) + FE realtime filters — none touch whatsmeow tables or backend Go code.

## Timeline (UTC)

| Time | Event |
|---|---|
| 14:02:30 | 82f0a03 pushed (Wave 1 plan doc); Cloud Build backend + frontend SUCCESS |
| 14:07-14:08 | Wave 1 Task 2 subagent applies migration 503 to prod DB via Management API |
| 14:08:41 | 78a02cd pushed (2D migration file); Cloud Build backend FAILURE (staging deploy startup probe fail); frontend SUCCESS |
| 14:09:21 | c4fb2af pushed (2C decision memo); Cloud Build backend FAILURE (same); frontend SUCCESS |
| ~14:14-14:18 | Wave 1 Task 3 subagent applies migration 504 (4 CONCURRENTLY indexes) via Management API |
| 14:18:35 | 9b93377 pushed (2C migration + memo); Cloud Build backend FAILURE (same); frontend SUCCESS |
| ~14:20 | Wave 1 Task 4 subagent commits FE realtime filter (dbc848f); frontend SUCCESS |
| 14:23:57 | Staging revision 00092 fails startup probe. Container log: `{"error":{},"message":"[MAIN] WA client init failed"}` → `exit(1)` |
| 14:30-14:36 | Prod revision (00469) new instances continue crashlooping on cold-start; older instance (already up) may still be serving cached traffic |
| 14:35+ | Confirmed: `curl https://garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app/api/v1/live` returns HTTP 500 |

## Root cause (probable, not yet confirmed)

The failure originates in `whatsapp.NewClient()` at `backend-go/internal/whatsapp/client.go:45-76`. Four possible error paths:
1. `sql.Open("postgres", pgConnStr)` — connection string parse (unlikely; format is stable)
2. `db.Ping()` — first DB connection (Supabase direct pool)
3. `container.Upgrade(ctx)` — whatsmeow schema self-upgrade (runs every startup)
4. `container.GetFirstDevice(ctx)` — read `whatsmeow_device` row

The captured error slog serializes to empty `{"error":{}}` — a **secondary bug** in slog.Any handling per memory `wa_test_data_noise`. Real error message is lost. Highest-probability cause given the timing (started immediately after 82f0a03 last-good): direct-pool connection slot exhaustion (see memory `supabase_split_pool`) OR whatsmeow session state invalidated (phone unpaired / QR expired).

## RESOLVED 2026-07-20 T ~14:44 UTC — rollback to cf73c29b

**Autonomous action taken during founder-away 2h window.**

Diagnostic that unblocked: multi-probing tag URLs of earlier revisions returned HTTP 200:
- `cf73c29b` (Phase 1 completion `f73c29b`), `cc2fa60e`, `c83fde05`, `c8cb1955`, `c800072b` — all /api/v1/live 200.
- Only current serving revision `c82f0a03` (revision `00469-dub`) crashlooping.

Since backend Go binary is byte-identical between commits (`git diff 82f0a03 f73c29b -- backend-go/` = empty), the WORKING earlier revisions running the SAME code prove the fix path: shift traffic.

Executed:
```bash
gcloud run services update-traffic garindo-jaya-panel-msme-erp \
  --region=asia-southeast1 \
  --to-revisions=garindo-jaya-panel-msme-erp-00467-bih=100
```

Verification:
- `gcloud run services describe` → traffic 100% on `00467-bih` (tag `cf73c29b`).
- 5 probes of `/api/v1/live` → all HTTP 200.
- 5 probes of `/api/v1/ready` (DB ping) → all HTTP 200.

WA bot service restored on the last-good Phase 1 completion revision. Backend now on the same commit as the FE app.caleo.id (frontend build was on 82f0a03; backend on cf73c29b — different but ABI-compatible since Wave 1 didn't change any API contract).

**Open question for founder:** why does the c82f0a03 revision crashloop when its Go binary is identical to cf73c29b? Same code, same Docker image content-hash (both built from same source), same secrets. The difference must be either:
- Cloud Run revision config (env vars / secrets version) differs
- Race condition in Cloud Run deploy where revision 00469 got promoted before its warmup completed successfully
- Supabase-side connection pool state at 14:08 UTC exhausted temporarily

The empty slog error still needs to be fixed before we ever want to redeploy on top of 82f0a03. Once fixed, we can re-deploy and see the real error.

## Remediation (original recommendation, now HISTORICAL — Strategy A executed)

**Immediate — restore WA bot service (P0):**
1. **Rollback strategy A (safest):** revert Cloud Run traffic on `garindo-jaya-panel-msme-erp` to a known-warm earlier revision (e.g., `00468` or earlier) that has an active whatsmeow session. Test: `curl .../api/v1/ready` → 200 before promoting to 100%.
2. **Strategy B (if A doesn't help):** re-pair WhatsApp — founder scans QR from the running container (`docker logs` shows QR string). Requires phone in hand + fresh WA session.

**Diagnostic — capture the real error:**
3. Fix the `slog.Any(err)` → empty-object serialization in `main.go:229` before next backend deploy. Use `slog.String("error", err.Error())` instead. This is a small `backend-go/main.go` fix that would surface the actual WA init error.

**Long-term:**
4. Verify direct-pool slot usage per memory `supabase_split_pool`. If exhausted, the WA session ping in `client.go:58` (`db.Ping()`) can time out.
5. Post-mortem: was there a Supabase infra event at ~14:02 UTC 2026-07-20 that would explain simultaneous WA init failures across staging + prod?

## Prevention

- **New CLAUDE.md rule candidate:** after any commit whose Cloud Build shows backend FAILURE, before proceeding with more commits, controller MUST call `curl <PROD_BACKEND>/api/v1/live` — if 500, escalate as P0 incident. Don't accumulate more commits on top of a broken prod backend.
- **Fix `slog.Any(err)` empty-serialization bug** system-wide — audit all `slog.Error(..., slog.Any("error", err))` sites in `backend-go/`; migrate to `slog.String("error", err.Error())` or add a slog handler that unwraps `fmt.Errorf` chains.
- **Add health-probe smoke to Ship & Verify Stage 2** — after `gcloud builds list` reports SUCCESS, controller MUST also curl `/api/v1/live` on the actual service URL, not just accept the build SUCCESS marker. "Cloud Build passed the startup probe once" ≠ "service is healthy".

## Wave 1 status

**Independent of this incident.** Wave 1 changes shipped:
- Migration 503 (2D RLS) applied to prod DB, regression 6/6 PASS
- Migration 504 (2C perf indexes) applied to prod DB, indisvalid=true, EXPLAIN plans improved
- FE realtime filter (13 subscribers, commit dbc848f) shipped via `sinar-elektrik-frontend` build SUCCESS
- Multi-tenant matrix re-verified post-Wave-1: **0 leaks**

Backend Go binary unchanged from Phase 1 — this incident does not represent a Wave 1 regression. Wave 1 completion documented separately at `docs/qa-week/phase-2-report.md`.
