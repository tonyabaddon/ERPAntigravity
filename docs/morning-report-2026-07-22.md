# Morning report — 2026-07-22

Written overnight while founder was asleep. **Read this before touching anything.**

## What works right now

- **admin.caleo.id login flow** — end-to-end verified. OTP sends, verify succeeds, dashboard shell renders.
- **No more auto-impersonation** — the stale row from 2026-07-11 was deleted; hourly `pg_cron` (`expire_impersonations` at `15 * * * *`) auto-reaps any row >8h old.
- **AuthScreen UX** — the OTP input no longer stays disabled after a failed `Kirim OTP`. If the mail arrives via retry, you can paste the code.
- **`idle_session_timeout=15min`** — set on `postgres` role, survives DB restart. Any future orphaned direct-pool conn auto-reaps.
- **`mailer_otp_length: 6`** — matches the "6 digit" text in the Bahasa email template.

## What is deployed vs pending

| Change | Committed | FE deployed | BE deployed | Notes |
|---|---|---|---|---|
| `main.go` `fatal(dbClient, ...)` + SIGTERM timeout | `f953555` (parallel session) + convergent from mine | n/a | ⚠️ **NOT YET** — build failed prod startup probe due to pool pressure | Waiting for pool <25 conns to retry |
| AuthScreen `signInSent = true` on error | `eb2924c` | ✅ (build `dadee6dd` SUCCESS) | n/a | LIVE |
| Migration `20261115000508_expire_stale_impersonations_cron.sql` | `eb2924c` | n/a | ✅ (applied directly via pooler + management API) | LIVE + `pg_cron` scheduled |
| `AdminRouteGuard.tsx` retry-on-transient-5xx (3× with 500ms backoff) | ⚠️ **UNCOMMITTED** in your working tree | ⚠️ pending | n/a | Reduces false-logout during pool pinches. Commit + push when pool stable. |
| Incident + miss-log + progress.md | `96701db` | n/a | n/a | Doc only |

## Backend deploy attempts overnight

Backend Cloud Build `adcd0d55-1e70-4175-b6c0-8ebfec2ba8c9` failed at Step 5 (prod deploy). Staging deploy at Step 3 succeeded. Failure cause: prod cold-start couldn't reserve DB slots from the exhausted direct pool within the 60s startup-probe budget (`--startup-probe=httpGet.path=/api/v1/ready,failureThreshold=12`).

Failed revisions accumulated: `00483-xow`, `00484-maz`, `00485-xuk`. All Ready=False. Currently serving revision: `00477-wim` (tag `cc12b44a` — SEMI-STABLE, pre-Sprint-1-completion code, still uses direct pool for whatsmeow store per the pre-refactor `main.go`).

**To retry**: once `pg_stat_activity` reports <25 conns steady-state, do:
```bash
# Confirm pool is clean
PGPASSWORD='<see backend-go/.env>' psql "host=aws-1-ap-northeast-1.pooler.supabase.com port=6543 user=postgres.ekhhojaezdfjfwuxyjkl dbname=postgres sslmode=require" -tAc "SELECT count(*) FROM pg_stat_activity;"

# Trigger fresh build from HEAD (which contains the fatal + SIGTERM fix at f953555)
git commit --allow-empty -m "trigger: retry backend deploy after pool stabilization"
git push origin main

# Monitor
gcloud builds list --limit=2
```

## AdminRouteGuard retry fix — un-shipped detail

Working tree has an unshipped patch to `src/components/admin/AdminRouteGuard.tsx` that retries `tenantContextService.isPlatformAdmin()` up to 3× with 500ms backoff before failing to `deny-not-admin`. This prevents the pool-pinch → 500 → false-denial → bounce-to-login cascade you experienced overnight. To ship:

```bash
git add src/components/admin/AdminRouteGuard.tsx
git commit -m "fix(admin): retry isPlatformAdmin 3× on transient 5xx during pool pinch"
git push origin main
```

That will trigger another FE build (~10min) and another BE build attempt (may fail if pool still hot; harmless — old backend keeps serving).

## Known remaining bug I did NOT fix

`src/App.tsx:310-320` — the `onAuthStateChange` handler sets `currentUser=null` on ANY `!session` event, including `SIGNED_OUT` events emitted by supabase-js when a `refreshSession()` call fails. During pool pinches this means: user clicks sidebar → `AdminRouteGuard` fires `refreshSession()` → server 500 → supabase-js emits `SIGNED_OUT` → `currentUser=null` → login screen shown. Cannot cleanly distinguish "user logged out" from "refresh failed" at that listener level; a proper fix requires more design (retry with backoff, or debounce, or check event type + storage state). Deferred. Will not fire once backend deploy stops the pool churn.

## Sanity checks to run when you wake up

1. `curl -sI https://admin.caleo.id | head -3` → HTTP 200
2. `curl -s -X POST 'https://ekhhojaezdfjfwuxyjkl.supabase.co/auth/v1/otp' -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d '{"email":"tonywei.office@gmail.com","create_user":false}' -w '\n%{http_code}\n'` → HTTP 200 (not 500)
3. `PGPASSWORD='<pw>' psql "host=aws-1-ap-northeast-1.pooler.supabase.com port=6543 user=postgres.ekhhojaezdfjfwuxyjkl dbname=postgres sslmode=require" -tAc "SELECT count(*) FROM pg_stat_activity;"` → should be < 25
4. Log in normally at `admin.caleo.id`. If bounce to `/t/garindo/dashboard` → the impersonation cron didn't fire yet (unlikely — I applied it manually) OR you re-impersonated recently. Check `SELECT * FROM public.platform_admin_active_impersonation;` — should be empty for you.

## Files touched this session

Committed:
- `f953555` — `backend-go/main.go` fatal + SIGTERM (parallel session; convergent with mine)
- `eb2924c` — `src/components/AuthScreen.tsx`, `supabase/migrations/20261115000508_expire_stale_impersonations_cron.sql`
- `96701db` — `docs/incidents/2026-07-22-otp-and-impersonation-recovery.md`, `docs/superpowers/miss-log.md`, `progress.md`

Untracked / uncommitted (waiting for pool):
- `src/components/admin/AdminRouteGuard.tsx` — retry-on-transient patch
- `docs/morning-report-2026-07-22.md` (this file)
