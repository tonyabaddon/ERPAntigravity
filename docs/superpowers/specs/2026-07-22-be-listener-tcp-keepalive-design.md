# BE Listener TCP Keepalive — Design Spec

## Problem

GoTrue signInWithPassword returns 500 with error:
`FATAL: remaining connection slots are reserved for roles with the SUPERUSER attribute (SQLSTATE 53300)`

Root cause (verified 2026-07-22 via `pg_stat_activity`):
- Supabase `max_connections = 90`, `superuser_reserved_connections = 3` → 87 non-superuser slots
- Backend Go service holds 34-83 LISTEN connections on the `:5432` direct pool
- Distribution: 35 distinct client IPs, each with 1-2 conns → **zombie pattern from pq.Listener reconnects + old BE revisions**, NOT `pq.NewListener` opening per-channel
- Supabase's TCP keepalive window is long enough for old conns to linger for hours
- Every BE deploy adds fresh conns; old ones don't age out fast → conn count grows monotonically until GoTrue starves

Impact:
- Existing session JWTs cached in browser still work (login-optional)
- New sign-ins fail (500 error)
- Admin UI provision-tenant flow likely fails at "create owner user" step (uses Supabase Auth Admin API)
- Blocks real tenant onboarding (Task 9)

## Goal

- Restore GoTrue signInWithPassword to 200
- Keep BE's LISTEN conn count under 15 at any time
- Zero infrastructure cost (no Supabase plan upgrade)
- Safe rollout via manual deploy gate (staging BE → verify → prod)

## Non-goals

- Not eliminating LISTEN/NOTIFY entirely (still the right pattern for order/payment events)
- Not migrating to Supabase Realtime (much larger refactor; overkill for this fix)
- Not touching FE or auth code paths

## Design — Approach A (primary)

**One-line change:** append TCP keepalive params to `SUPABASE_DB_LISTENER_CONNECTION`
via GCP Secret Manager. No code change to backend-go.

### Change

Current listener connection string:
```
postgresql://postgres:...@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres
```

New:
```
postgresql://postgres:...@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres?keepalives=1&keepalives_idle=30&keepalives_interval=10&keepalives_count=3
```

### What each param does

| Param | Value | Effect |
|---|---|---|
| `keepalives` | 1 | Enable OS TCP keepalive on this connection |
| `keepalives_idle` | 30 | Send first probe after 30s of no traffic |
| `keepalives_interval` | 10 | Retry every 10s if no ACK |
| `keepalives_count` | 3 | Drop connection after 3 failed probes |

**Total time to detect dead conn**: ~60s (30s idle + 3×10s retries).

### Why this fixes the leak

- Old zombie conns from crashed/killed BE instances have no TCP peer answering
- OS TCP layer probes → no ACK → conn dropped locally + FIN sent
- Supabase reaps its side of the conn
- Slot returned to pool
- pq.Listener's own 90s heartbeat continues on healthy conns → no false drops

### Rollout

1. Update secret `supabase-db-connection-listener-prod` via `gcloud secrets versions add`
2. Push no-op commit to `main` → Cloud Build triggers → BE deploys at 0% + tag URL
3. Verify tag URL: `curl <tag-url>/api/v1/live` → 200
4. Check `pg_stat_activity` LISTEN count — should already start dropping (new BE has keepalive; old zombies still there)
5. Promote via `./scripts/promote-to-prod.sh <SHA>` → 100% traffic on new BE
6. Old BE revision drains → its LISTEN conns close cleanly → count drops further
7. After 1 hour, count should be <15 (only healthy conns from 1 running instance)

### Rollback

- Re-add previous version of `supabase-db-connection-listener-prod` secret
- Push no-op commit → BE redeploys with old connection string
- No data loss (settings-only change)

## Design — Approach B (fallback, only if A insufficient)

If Phase A doesn't reduce conn count below 15 after 1 hour:

**Consolidate 9 channels → 1 `backend_events` channel:**
- Payload: `{"type": "order_shipped", "order_id": "...", ...}`
- Go dispatch: single `listener.Listen("backend_events")` → switch on `payload.type`
- SQL triggers: replace each `NOTIFY <channel>, <payload>` with `NOTIFY backend_events, jsonb_build_object('type', '<channel>', ...)::text`

**Files touched:**
- `backend-go/internal/db/client.go` — `StartListening()` reduces to 1 channel + dispatch switch
- 9 SQL triggers (search: `grep -rn "NOTIFY" supabase/migrations/`) — one mig 513 consolidates all

**Zero-downtime deploy:** deploy BE listening to BOTH old channels + `backend_events`, then swap triggers, then remove old channel handlers.

## Verification

**Pre-deploy:**
- BE builds green on staging + prod tag URLs
- `pg_stat_activity` LISTEN baseline captured

**Post-deploy (Phase A):**
- LISTEN count < 15 within 1 hour ← primary success metric
- GoTrue `signInWithPassword` returns 200 with valid JWT
- Existing sessions still work (spot-check by loading `app.caleo.id`)
- BE `/api/v1/live` still 200
- No new errors in `docs/incidents/`

**End-to-end onboard verify:**
- Provision `verify-onboard-<time>` tenant via `provision_tenant` RPC
- Sign in on `app.caleo.id` — sees tenant
- Sign in on `staging.app.caleo.id` — picker empty (ENV_MISMATCH)
- Deprovision (mig 512 handles orphans) → 0 rows remaining

## Success criteria

- [ ] Prod BE serves 200 on `/api/v1/live`
- [ ] `pg_stat_activity` LISTEN count < 15 for 1 hour straight
- [ ] GoTrue `signInWithPassword` returns 200
- [ ] End-to-end test tenant provisioned + signed in + deprovisioned cleanly
- [ ] Ledger updated (progress.md)
- [ ] Zero infra cost added (no Supabase plan upgrade)

## Risks

| Risk | Mitigation |
|---|---|
| Supavisor overrides keepalive params | Approach B fallback ready; can implement if A alone < 50% improvement |
| BE deploy fails startup probe | probe threshold already bumped to 5 min (ce72e67); manual promote gate catches |
| Consolidation breaks notification dispatch | Not shipping unless A fails; add unit test for switch dispatch |

## Adversarial critique

- **What if the 500 error isn't purely from conn exhaustion?** Auth log confirmed the exact error: `FATAL: remaining connection slots are reserved`. Not another cause.
- **What if killing zombies breaks BE?** They're already broken (no peer). Nothing to preserve.
- **What if 30s keepalive is too aggressive?** pq.Listener heartbeat is 90s. TCP layer probes at 30s intervals only affect conns with no other traffic — healthy listeners get pq's own pings.

## I verified

- `gcloud run services describe garindo-jaya-panel-msme-erp` → probe threshold=60 (5 min) live
- `psql pg_stat_activity` → 35 distinct client_addr, 1-2 conns each (zombie pattern confirmed)
- `sinar-elektrik-msme-erp` has no `minScale` → scaled to zero (not a contributor)
- pq.NewListener docs → one conn per Listener instance (confirms per-channel-open assumption was wrong)
- Auth log via mgmt API → error message is exactly "remaining connection slots are reserved"

## Confidence

- **[VERIFIED]** — Zombie pattern, not per-channel opening
- **[REASONED]** — TCP keepalive params well-documented in libpq; expect Supabase to respect them
- **[ASSUMED]** — Supavisor pass-through of keepalive settings; will confirm empirically post-deploy
