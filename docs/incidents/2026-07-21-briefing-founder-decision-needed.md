# 2026-07-21 — Founder briefing: WA framework blocked on Supabase pool exhaustion

## TL;DR

**Prod backend Go is serving pre-Sprint 1 code** (commit `27164e35`, revision `00422-but`). All my WA notification framework backend code (Sprint 1-7 + F1-F8 follow-ups) is deployed as Cloud Run revisions but **NOT receiving traffic** — pinned to old revision by 2026-07-20 incident rollback.

**Root cause blocker (still active):** Supabase direct-pool (:5432) connection exhaustion. Every new Cloud Run cold-start needs ~10 slots; pool is fully saturated by zombie connections. New deploys fail startup probe → traffic stays on old revision.

**Test confirmation (2026-07-21 09:09 UTC):** even `/tmp/apply-migration` from my local machine now fails with `pq: remaining connection slots are reserved for roles with the SUPERUSER attribute`.

## What IS live in prod

| Layer | Serving Commit | Status |
|---|---|---|
| Landing (caleo.id) | Latest | ✅ Pricing 2,99 jt live, zero console errors |
| Frontend (app.caleo.id) | 04f11c07 + F72 (in build) | ✅ All new screens rendered when logged in |
| Database (Supabase) | All 17+ migrations applied | ✅ Schema ready |
| **Backend (Cloud Run)** | **27164e35 (PRE-Sprint 1)** | ❌ **NONE of the WA framework runs** |

## What runs on the OLD backend (27164e35)

- Existing Calista AI WA loop (single tenant path)
- Pre-Sprint 1 approval flows (WITHOUT the wired approval card send from Task 1.8)
- Pre-Sprint 1 heartbeat digest (still using direct SendText, not BroadcastToStaff wrapper)
- No Piutang scheduler
- No overdue summary pollers (Piutang + Hutang)
- No Approval SLA breach alert
- No post-order feedback request
- No quiet hours / consolidation / silent-day
- No session health poller with Caleo ops alerts
- No Caleo Admin Bot

## What can NOT be done autonomously

The pool exhaustion needs to be resolved BEFORE any new backend can deploy. My tools can't fix this because:
1. I can't connect to Supabase to kill idle connections (pool full — same reason deploys fail)
2. Supabase Management API for terminating backends is not exposed via CLI I have
3. Waiting for idle timeout (default 8 hours) is unpredictable

## Founder decision needed (Options ranked)

### Option 1 (RECOMMENDED) — Supabase Pro upgrade
- Free tier: max_connections=60 (57 usable after superuser reserve)
- Pro tier ($25/mo): max_connections=400+
- Eliminates pool exhaustion permanently, enables safe backend autoscaling
- Requires memory `cost_upgrade_approval` per founder rule
- 1-click upgrade at supabase.com/dashboard → project → Settings → Subscription

### Option 2 — Kill zombie connections from Supabase console
- Log into supabase.com/dashboard → project → Database → Roles → Connections
- Terminate idle connections
- Then redeploy (should succeed if pool clears)
- Free but temporary; will happen again on any future cascade

### Option 3 — Manual traffic promote to F8 revision
Once pool cleared, execute:
```bash
gcloud run services update-traffic garindo-jaya-panel-msme-erp \
  --region=asia-southeast1 \
  --to-revisions=garindo-jaya-panel-msme-erp-00455-qov=100
```
This promotes commit `4e93279` (F8 SessionManager, all backend follow-ups) to 100% traffic. Verify with:
```bash
curl -s https://garindo-jaya-panel-msme-erp-422860632808.asia-southeast1.run.app/api/v1/live
```

## What I successfully shipped this session (not in traffic yet)

- Sprint 1-7 all 44/45 tasks (backend code + FE code + 17 migrations)
- F1-F5 backlog burndown (conv.tenant_id, handler NotifyCustomer wiring, SECDEF RPC, cron config, session_health pruning)
- F6: RESEND_API_KEY + CALEO_OPS_EMAIL to GCP Secret Manager (secretAccessor role granted to Cloud Run SA)
- F7: per-tenant SLA threshold in breach query (make_interval + COALESCE)
- F8: multi-tenant SessionManager (replaces stub in SessionHealthPoller)
- F72: notification-prefs route registration fix

FE + migrations = ready to work AS SOON AS backend gets deployed on top of my follow-up commits.

## What's healthy right now

- **Prod backend** (old code) still serving /api/v1/live 200 — no customer-facing downtime
- **Landing** — 100% healthy, pricing 2,99 jt visible
- **FE app** — 100% healthy, screens render (but call old backend — new features non-functional)
- **DB migrations** — fully applied, waiting for new backend to use them

## After founder acts

Once pool is cleared + traffic promoted:
1. `curl /api/v1/live` and `/api/v1/ready` verify 200
2. Check `gcloud run services describe` → serving revision is 00455-qov or newer
3. Verify DB has new poller heartbeat activity: `SELECT COUNT(*) FROM wa_session_health WHERE polled_at > NOW() - INTERVAL '10 minutes'` should show rows (poller writes every 5 min)
4. Verify Piutang scheduler will fire on next 09:00 WIB tick (or trigger manual via `send_piutang_reminder_manual` RPC)
