# 2026-07-21 — Supabase auth 500 (pool exhaustion cascaded to auth service)

## Summary
`/auth/v1/token?grant_type=password` on the tenant Supabase project (`ekhhojaezdfjfwuxyjkl`) returns HTTP 500 `"Database error querying schema"` for 15+ minutes. **All customer login is DOWN on app.caleo.id + admin.caleo.id.** WA bot still works (uses service_role bypass, doesn't hit auth endpoint).

## Timeline (UTC)
- 2026-07-20 T ~14:08 — original pool exhaustion (backend WA crashloop incident)
- 2026-07-20 T ~14:44 — prod BE rolled back to `cf73c29b` (warm instance); pool remained saturated
- 2026-07-20 through 2026-07-21 — pool never fully drained; mgmt-api intermittently succeeded then failed 53300 again
- 2026-07-21 T ~10:00 — pool free briefly (matrix + audit_log RLS query succeeded); autonomous session used the window
- 2026-07-21 T ~22:30 — Playwright smoke subagent attempted `signInWithPassword` — auth endpoint returns 500 for 15+ min consecutive
- 2026-07-21 T ~23:05 — controller confirmed: pool still 53300 exhausted; auth 500 persists

## Symptom vs cause
- **Pool exhaustion** (postgres `:5432` direct pool, max 60 with 3 superuser reserved) is the root cause
- **Auth 500** is a downstream cascade — Supabase's GoTrue auth service queries `auth.` schema on every request; when it can't acquire a slot it returns 500 with error_id (`019f8579-2948-7c5e-b48d-d1638e5617ab` on last probe)

## Blast radius
- ❌ Customer login on app.caleo.id (all 3 tenants: Garindo, Toko Jaya, Warung)
- ❌ Admin login on admin.caleo.id
- ❌ Any FE code path requiring a fresh Supabase session
- ✅ WA bot (uses service_role, bypasses auth endpoint)
- ✅ Prod BE `/api/v1/live` + `/api/v1/ready` (uses warm instance's cached connection)
- ✅ Static FE serve (`app.caleo.id` returns 200 for HTML)
- ✅ Cloud Build FE deploys (compile-time, no runtime DB)

## Required founder action (P0)

**Option A — Supabase Dashboard drain (fastest, no cost):**
1. Open Supabase Dashboard → SQL Editor for project `ekhhojaezdfjfwuxyjkl`
2. Run:
```sql
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle'
  AND (application_name = '' OR application_name IS NULL)
  AND usename = 'postgres'
  AND pid <> pg_backend_pid()
  AND state_change < NOW() - INTERVAL '2 minutes';
```
3. Verify `SELECT COUNT(*) FROM pg_stat_activity;` drops below 40
4. Verify auth: `curl -sS -X POST "$VITE_SUPABASE_URL/auth/v1/token?grant_type=password" -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d '{"email":"test@example.com","password":"none"}'` → expect 400 (bad creds) not 500 (DB error)

**Option B — Upgrade to Supabase Pro tier (paid, requires memory `cost_upgrade_approval`):**
- max_connections 60 → 400+
- Removes exhaustion permanently
- $25/month base + usage

**Option C — Restart Cloud Run backend service (may worsen):**
- Delete stuck revisions (00472-coy etc)
- Risk: cold-start of cf73c29b uses 10+ slots → made worse
- NOT recommended without Option A first

## Post-fix TODOs (once auth restored)

1. Verify each tenant login succeeds
2. Deploy prod BE with Option 2 image (`5b0f8a1`'s docker sha `d55cf03feb5c...`) — permanently moves WA client to `:6543` txn pooler, dropping per-instance direct-pool footprint from ~4 to ~1
3. Restore `cloudbuild.yaml` Step 5+6 (prod BE deploy) from git history (state before commit `00ab986`)
4. Run Playwright smoke `t20-wave123-smoke.spec.ts` to verify Wave 1-3 FE changes work end-to-end
5. Delete failed prod revisions (`00472-coy`, `00474-buh`) if Cloud Run allows

## Prevention

- **Set alerting on pg_stat_activity count > 50** — via Supabase's built-in monitors or an external check hitting mgmt-api hourly. Currently no auto-alert; discovery was accidental (via mgmt-api 53300).
- **Rate-limit backend BE cold-start attempts** — Cloud Run's retry backoff is aggressive; the failed 00472-coy revision has been probing periodically since 14:08 UTC 2026-07-20.
- **Deploy Option 2 image to prod ASAP after founder unblocks pool** — future cold-starts will only need 1-2 direct-pool slots instead of 4-10.
- **Consider Supabase Pro tier** — 60 → 400 slots would give large safety margin at $25/month; matches expected tenant scale for the next 12 months.

## Autonomous session snapshot at incident discovery

All Wave 1-3 + Session A/B/C/D work SHIPPED to prod FE (revision after `c52c1c26`). 1009/1011 vitest tests pass. Backend Cloud Build succeeding since bypass added. 19 commits since Phase 1 completion (`f73c29b`).

Session end state committed in `docs/qa-week/2026-07-21-autonomous-session-wrap.md`. This incident file is the CRITICAL priority for founder on return — supersedes the "next-session plan" doc until auth is restored.
