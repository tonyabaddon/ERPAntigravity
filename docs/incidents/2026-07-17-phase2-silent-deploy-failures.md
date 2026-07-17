# 2026-07-17 — Phase 2 silent deploy failures

## Summary
Eight consecutive Cloud Build deploys FAILED between P2-A frontend (`7d45d3c`) and P2-E (`f395622`). Root cause: staging Playwright config picked up `phase1-authenticated.spec.ts` which imported the (uncommitted) `tests/e2e/fixtures/auth.ts`. Every staging gate crashed at `Cannot find module '../fixtures/auth'`. Prod promotion blocked for ~40 minutes. No user-visible regression (previous revision stayed live), but P2-A cost dashboard, P2-B rate limiter, and P2-E job worker were **not in production** despite being marked "shipped" in progress log.

## Timeline (UTC+7)
- **~03:30** — Committed P2-A backend (`7d45d3c`). Backend build succeeded, frontend build FAILED at Step 4 (staging Playwright). Not noticed.
- **~04:15** — Committed P2-A test mock (`ef4ab7e`). Both frontend + backend FAILED.
- **~05:00** — Committed test config exclude (`7983b9d`) + Phase 1 e2e suite (`b98346d`). All FAILED.
- **~08:52** — Committed P2-B (`ecb907f`). FAILED.
- **~08:53** — Committed test cleanup (`8485ac9`). FAILED.
- **~08:54** — Committed P2-B progress (`aacaebb`). FAILED.
- **~09:30** — Committed P2-E (`f395622`). WORKING (but would also fail at Step 4).
- **~09:40** — Advisor call flagged "verify deploys succeeded." Discovered 8× FAILURE across two build triggers.
- **~09:50** — Root cause identified: `tests/e2e/fixtures/auth.ts` untracked, imported by `phase1-authenticated.spec.ts`, which was matched by staging config's default testMatch.
- **~09:55** — Committed fix (`f403fc6`): restrict staging config to `staging-smoke.spec.ts` only. Also committed the orphan fixtures + prod config files. Pushed to trigger fresh build.

## Timing observation (unresolved)
Worker logged `column reference "tenant_id" is ambiguous` on every poll from ~12:38 through 12:43:00. Smoke job `d9efed65` (inserted 12:16) succeeded at 12:43:05 — 5s after the last error, before migration 323 was applied (~12:45). Precise cause of that one successful poll is unclear; possibilities include Postgres planner reselection under low load, a transient schema-cache race, or an unlogged manual claim. Migration 323's `#variable_conflict use_column` eliminates the ambiguity path deterministically regardless. Worth understanding if it recurs.

## Root cause
Playwright config `testDir: './tests'` with no `testMatch` restriction. Any `.spec.ts` file in `tests/e2e/tests/` gets picked up. When `phase1-authenticated.spec.ts` was added for local prod verification, the staging gate immediately started trying to run it — but its fixture file was still untracked.

Compounding: the Playwright error was buried past ~30 lines of chromium download output, and Cloud Build's "step 4 failed" was reported as an opaque `USER_BUILD_STEP` failure. I didn't check the actual step log after each push — I trusted "build triggered" as "deploy shipped."

## Remediation
Immediate:
- Committed `f403fc6`: `testMatch: /staging-smoke\.spec\.ts$/` in staging config.
- Committed the orphan `tests/e2e/fixtures/` and `playwright.prod.config.ts` so they stop being untracked.
- Chained fresh deploy of P2-A, P2-B, P2-E via the pending commits already on `main` (fix commit re-triggers the pipeline).

## Prevention
1. **After every push, verify build status BEFORE moving on.** `gcloud builds list --limit=2 --format=...` — 3 seconds, catches this class immediately.
2. **New Playwright suites go in a scoped subdirectory** (`tests/prod/`, `tests/staging/`) OR require an explicit `testMatch` in the config that owns them.
3. **Cloud Build alerting** — a real fix here is a build-failure notification (Cloud Build → Pub/Sub → notification channel). Currently silent failures require polling.
4. **Chain-mode rule**: when chaining N tasks, verify prior deploy succeeded before dispatching next. The advisor call caught it after 3 chained failures — that check should have run per-task.
5. **CLAUDE.md update candidate**: add "verify build status" as an explicit gate after every push in the ship-and-verify Stage 2.

## Bug C — Supabase connection pool exhaustion + plaintext DB password
- Session-wide MCP calls + backend worker polling + Cloud Run cold-start attempts saturated the ~15-slot direct connection limit.
- Every new connection attempt (including staging deploys, MCP, session-pooler auth) fails with `53300: remaining connection slots are reserved for roles with the SUPERUSER attribute`.
- Prod backend (min-instances=1, connection already established) unaffected.
- Also discovered: `SUPABASE_DB_CONNECTION` was stored as **plaintext env var** in Cloud Run with the password inline. Should be Secret Manager like `SUPABASE_SERVICE_KEY` was (Sub D).
- Root cause of pool exhaustion: backend uses direct connection endpoint (`db.<ref>.supabase.co:5432`) instead of Supabase pooler. Direct mode = ~15 slots; pooler mode = ~60+.
- Complicating factor: backend uses LISTEN/NOTIFY on 6 channels (admin_messages, order_approved, payment_verified, etc.). Transaction pooler (`:6543`) breaks LISTEN/NOTIFY. Session pooler (`:5432` via `aws-1-<region>.pooler.supabase.com`) preserves it but needs project-side enablement.
- **Fix in progress**:
  - Created GCP Secret Manager secret `supabase-db-connection-prod` with existing connection value
  - Cloud Run env swap issued (`--remove-env-vars=SUPABASE_DB_CONNECTION --update-secrets=SUPABASE_DB_CONNECTION=supabase-db-connection-prod:latest`) — new revision `00295-p4t` created at 0% traffic
  - New revision FAILED startup probe (same pool exhaustion) — traffic still on old plaintext revision `00306-dok`
  - `cloudbuild.yaml` updated so future builds use secret ref, not plaintext substitution
- **Pending on pool recovery**:
  - Retry new-revision deploy → verify starts → promote traffic → plaintext exposure fully resolved
  - Test session pooler endpoint (currently auth fails because pool auth path can't reach DB)
  - If session pooler works with LISTEN/NOTIFY → swap secret value to pooler URL → structural fix for connection scaling

## Prevention artifacts
- Memory: `deploy_verify_after_push` (to write) — always `gcloud builds list --limit=2` after push, don't trust "triggered" as "shipped."
- Feedback memory: `chain_mode_verify_between_tasks` (to write) — chaining tasks without verifying prior deploy compounds risk. Verify per-task.
