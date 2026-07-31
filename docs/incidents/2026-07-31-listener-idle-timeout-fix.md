# 2026-07-31 — Rotate `supabase-db-connection-listener-prod` v4 (idle_session_timeout=0)

**Why:** Postgres `idle_session_timeout = 900000` (15 min) at user level (Supabase config) was killing `pq.Listener` sessions every 15 min. Backend log noise `[DB] Listener event error: pq: terminating connection due to idle-session timeout (SQLSTATE 57P05)` recurring every ~10 min for weeks. Auto-reconnect via `pq.NewListener(minReconnect=10s, maxReconnect=60s)` worked but each cycle risked event loss during the reconnect window.

**Confirmed via:** `SELECT name, setting FROM pg_settings WHERE name='idle_session_timeout'` → `900000` (source=user, context=user — overridable per-session).

**Prior related fix:** `2026-07-22-be-listener-tcp-keepalive-design.md` — that spec addressed a DIFFERENT symptom (slot exhaustion, SQLSTATE 53300). TCP keepalive keeps the TCP connection alive but doesn't reset Postgres's `idle_session_timeout` counter (which counts time since last query, not TCP activity).

**Fix:** appended `options='-c idle_session_timeout=0'` to the `SUPABASE_DB_LISTENER_CONNECTION` secret. Session-scoped GUC override. Only affects `pq.Listener` connections; other pooled queries via `:6543` txn pooler unaffected.

**Rollout:**
1. `gcloud secrets versions add supabase-db-connection-listener-prod --data-file=-` → v4 created 2026-07-31.
2. This no-op docs commit triggers BE Cloud Build → new revision at 0% traffic.
3. Verify listener errors stop for 30+ min on the tag URL.
4. `bash scripts/promote-to-prod.sh <SHA>` → 100% traffic.

**Rollback:** re-add secret v3 via `gcloud secrets versions add ... --data-file=<backup>` + redeploy previous SHA.

**Success criteria:**
- Zero `[DB] Listener event error` events in 30-min window post-deploy
- Prod URLs continue serving 200
- No new errors of any kind in BE logs

**Files touched:**
- GCP Secret Manager: `supabase-db-connection-listener-prod` v3 → v4 (options appended)
- This incident doc
