# 2026-07-22 — OTP login break + admin.caleo.id wrong-dashboard

## Summary
Founder reported "can't receive OTP login" (~2026-07-21 UTC evening WIB). Diagnosis surfaced TWO distinct bugs sharing overlapping symptoms:

1. **Supabase :5432 direct-pool exhaustion** — recurrence of 2026-07-20 crashloop incident. Cloud Run backend cold-starts + staging deploy churn continually leaked 2-3 direct-pool conns per dead instance because `main.go`'s `os.Exit(1)` sites skipped `defer dbClient.Close()`. Once pool hit 57/57 usable slots, `gotrue` (Supabase Auth) couldn't reserve a slot to write `auth.one_time_tokens`, and every `POST /auth/v1/otp` returned HTTP 500 "Database error finding user". OTP mails never reached Resend because the send-side pipeline failed at the DB step.

2. **Stale platform_admin impersonation lock** — separate bug uncovered after (1) was partially resolved. Founder's `platform_admin_active_impersonation` row from 2026-07-11 17:48 UTC survived 11 days. Every login re-injected `impersonating: true, impersonating_slug: "garindo"` into the JWT via `custom_access_token_hook`, and `AdminRouteGuard.tsx:87` redirected `admin.caleo.id` visitors to `/t/garindo/dashboard` with a "Stop impersonation dulu" toast. Founder saw the tenant panel instead of the Caleo admin dashboard, misdiagnosed as "why isn't admin the dashboard?"

Blast radius: single tenant (founder-only login and admin nav during the outage window). No customer data loss. WA bot continued serving on the pinned pre-Sprint-1 revision throughout.

## Timeline (UTC)

| Time | Event |
|---|---|
| 2026-07-11 17:48 | Founder impersonated `garindo` tenant via `impersonate_tenant` RPC. Session never explicitly stopped. Row persisted. |
| 2026-07-20 15:47 | 2026-07-20 crashloop cascade leaks 44 direct-pool conns (see prior incident). |
| 2026-07-21 ~14:00 | Founder resumes work. WA-framework deploys keep failing startup probe due to pool pressure. |
| 2026-07-21 ~15:00 | Founder reports "can't receive OTP". Session begins root-cause investigation. |
| 2026-07-21 15:xx | Confirmed pool 59/60, `supabase_auth_admin` = 0 slots, Resend delivery log shows zero OTP send attempts (gotrue failing at DB step before SMTP). |
| 2026-07-21 15:xx | Applied `ALTER ROLE postgres SET idle_session_timeout='15min'`. Terminated 36 dead-since-yesterday `postgres`-user idle conns. Auth restored briefly; new zombies backfilled within minutes. |
| 2026-07-21 15:xx | Fixed `mailer_otp_length: 8 → 6` via management API to match Bahasa template's "6 digit" hint. |
| 2026-07-21 17:00 | Cloud Run deploy `00475-wag` (Option-2 v2, whatsmeow → txn pooler) went live. 37 new direct-pool conns from cold-start. |
| 2026-07-21 17:29 | Scaled staging maxScale 2→1 and sinar-elektrik maxScale 12→1 to reduce deploy-driven churn (matched advisor guidance). |
| 2026-07-21 17:xx | `POST /v1/projects/{ref}/restart` via management API. Postgres restarted, pool dropped to 14 conns. OTP HTTP 200 restored briefly. Cloud Run cold-start refilled to 65 within ~5 min. |
| 2026-07-21 17:xx | Second restart. Pool cleared again. |
| 2026-07-21 17:35 | Founder attempted login. New JWT still carried stale `impersonating=true` claim from unrelated 2026-07-11 row. Founder observed "why is admin.caleo.id not the admin dashboard?" — actually seeing the impersonated tenant panel. |
| 2026-07-21 17:5x | Identified stale row in `public.platform_admin_active_impersonation`. `DELETE FROM ... WHERE admin_user_id=... started_at=2026-07-11`. Row removed. |
| 2026-07-21 17:56 | Fresh magic-link generated via admin API. Injected session into MCP-chrome localStorage. Reload → Caleo Admin shell rendered with all nav items. Confirmed impersonation loop broken. |
| 2026-07-21 18:xx | Founder reported "sidebar clicks bounce me out". Root cause: their browser held pre-DELETE JWT (still had `impersonating=true`), and `AdminRouteGuard.tsx:52` `refreshSession()` was failing 429/500 from pool re-pressure, so cached stale JWT was reused → `readImpersonationSlug` returned "garindo" → guard redirected to /t/garindo. Instructed hard-logout via localStorage.clear. |
| 2026-07-22 00:0x | Parallel Claude session shipped commit `f953555` — `main.go` `fatal(dbClient, ...)` helper + bounded SIGTERM `waClient.Disconnect` — same root-cause fix I was concurrently authoring. Commits converged on identical code. |
| 2026-07-22 00:xx | Applied migration 000508: `expire_stale_impersonations()` SECDEF (owned by `vosi_rpc_owner`) + `pg_cron` schedule `expire_impersonations` at `15 * * * *`. Test invoke reaped 0 rows (correct — no active impersonations). |
| 2026-07-22 00:xx | AuthScreen `signInSent = true` set regardless of send outcome — unlocks OTP input after transient failures so users can paste a delayed email code. |
| 2026-07-22 00:xx | Committed `eb2924c` and pushed. Cloud Build FE trigger fired. |

## Root cause

**Bug 1 (pool exhaustion)** — `backend-go/main.go`'s 8× `os.Exit(1)` sites bypassed `defer dbClient.Close()`. Every failed cold-start orphaned 2 direct-pool conns (pq.Listener + spare). SIGTERM handler at line 964+ relied on defer running after `waClient.Disconnect()` — which can block on WhatsApp server ACK — so Cloud Run's 10s SIGKILL grace fired before the defer executed. Cascading with Cloud Run's health-check-triggered restarts, pool climbed 5-10 zombies per minute of instability. Kill-then-refill race meant `pg_terminate_backend` alone couldn't hold.

**Bug 2 (impersonation loop)** — `public.platform_admin_active_impersonation` had no TTL, no auto-cleanup, and no logout hook. `custom_access_token_hook` unconditionally read the table on every JWT issuance and stamped `impersonating=true` + `impersonating_slug=<slug>` into claims. `AdminRouteGuard.tsx:61-67` reads those claims and redirects, meaning any stale row bricks that admin's ability to visit admin.caleo.id.

Neither bug was caught earlier because:
- Bug 1's symptom (OTP send fails) surfaced first and anchored the entire session on OTP/pool.
- Bug 2's symptom (wrong dashboard) was misread as "part of the OTP problem" — the correct read was "check post-login routing" the moment founder said "why isn't admin the dashboard?". Advisor call in the session pointed this out too late.

## Remediation

**Immediate (executed during incident):**
- 3× `pg_terminate_backend` sweeps (36 + 24 + 23 = 83 zombie conns released)
- 2× `POST /v1/projects/{ref}/restart` (management API)
- `ALTER ROLE postgres SET idle_session_timeout='15min'` (safety net; persists across restart)
- `PATCH /config/auth mailer_otp_length: 8→6`
- `gcloud run services update garindo-jaya-panel-msme-erp-staging --max-instances=1` (was 2)
- `gcloud run services update sinar-elektrik-msme-erp --max-instances=1` (was 12)
- `DELETE FROM public.platform_admin_active_impersonation WHERE admin_user_id='227c28f4-...'`
- **`PUT /v1/projects/{ref}/config/database/postgres {"max_connections":90}`** — 60→90 non-superuser cap, biggest single win. Free tier allowed via management API. No cost impact. Effective cap 87 vs prior 57.

**Permanent (committed):**
- `f953555` (parallel session): `fatal(dbClient, msg, err)` helper + bounded SIGTERM `waClient.Disconnect` with 5s timeout + explicit `dbClient.Close()` before exit
- `eb2924c` (this incident): AuthScreen unlock-OTP-on-error + migration 20261115000508 `expire_stale_impersonations()` SECDEF + pg_cron `expire_impersonations` @`15 * * * *`
- `0e40dfc` (this incident): AdminRouteGuard retries `isPlatformAdmin()` 3× with 500ms backoff before denying access — prevents transient 5xx from booting a legit admin to login

## Prevention rules added

1. **`os.Exit(1)` is forbidden in `main.go`** — always route through `fatal(dbClient, ...)`. Enforced by future stop-hook grep.
2. **Impersonation rows must not outlive the work session** — hourly cron reaps rows >8h old. If a legitimate long-support-session use case ever emerges, move TTL into a settings row per-admin.
3. **Session-start ritual reads this file** — future sessions will see the "if founder says 'why is X not Y', check post-login routing FIRST, not just the surface symptom".

## Miss-log entry (also appended to docs/superpowers/miss-log.md)

Anchored diagnosis on OTP/pool for ~2 hours while the actual admin.caleo.id wrong-dashboard symptom was a completely separate impersonation-state bug. Lesson: when founder describes TWO symptoms in the same session, treat them as independent until proven related. Wrong-dashboard on `admin.caleo.id` × impersonation claim in JWT is a lens-alignment miss — the Post-login-routing lens should have fired the moment founder said "why isn't admin the dashboard?".
