# 2026-07-31 — WA client init crash (pooler prep-stmt incompat)

**Summary:** Backend Go crashed once at 15:42:41 UTC with `[MAIN] WA client init failed`. Cloud Run auto-restarted; production self-recovered. Not user-visible (BE was up +/- 30s). No repeat occurrences in following hours.

## Timeline (UTC)

- **15:01:32** — Cloud Build for `843a126` (Phase 2 SKU qty tier ship) → new Cloud Run revision.
- **15:42:41** — BE crash: `[MAIN] WA client init failed`.
- **~15:43** — Cloud Run auto-restarted; whatsmeow retry succeeded.
- **15:53 → present** — no further WA init errors in logs.

## Root cause

WA init calls `whatsmeow.NewClient()` → `sqlstore.Container.Upgrade()` → schema-version check via prepared statement:

```
error=whatsapp: sqlstore upgrade: failed to check if version table is
up to date: pq: unnamed prepared statement does not exist
```

Backend uses Supabase txn pooler at `:6543` for the WA sqlstore connection (per `backend-go/main.go:531-541`). Txn pooler resets prepared statements between transactions. The comment at line 538-539 assumed whatsmeow's sqlstore uses "standard SQL — no server-side prepared statements", but the version-check path DOES issue an unnamed prepared statement (whatsmeow internals, possibly per-query behavior of the Go `pq` driver even on plain `Exec` calls).

## Why it self-recovered

Cloud Run restart on crash. Second boot hit the pooler in a fresh state; the transient prep-stmt collision resolved. `whatsmeow` has `EnableAutoReconnect=true` (per `internal/whatsapp/client.go:258`) so once the sqlstore init succeeded, session recovered.

## Impact

- **User-visible:** none observed. BE down ~30s. WA sends during that window would have failed (no queue in this path); we don't have evidence any sends were queued at that instant.
- **Prod state now:** healthy (`/api/v1/live` = 200, no repeat errors).

## Remediation (already in place)

- Cloud Run auto-restart on crash — worked.
- `EnableAutoReconnect=true` on whatsmeow client — worked.

## Follow-up (not urgent)

Real fix requires eliminating pooler↔prep-stmt collision. Three approaches:

1. **Route WA sqlstore init through direct `:5432`, keep runtime queries on `:6543`** — hybrid. Complex; introduces a second connection just for one code path. Reverses the 2026-07-20 migration decision (that one moved AWAY from `:5432` due to slot exhaustion at cold-start storms).
2. **Set Go `pq` driver to simple protocol / disable prepared statements** — flag `?binary_parameters=yes` or `?statement_cache_mode=describe`. Compatible with PgBouncer txn mode. Trade-off: worse query performance (no plan caching).
3. **Wrap `whatsmeow.NewClient` in retry-with-backoff** — accept transient prep-stmt collisions; retry N times before crashing. Doesn't fix root, but handles the class-of-flake without changing pool topology.

Recommendation: **Option 3** as low-risk mitigation, deferred until 2nd occurrence within a week (currently only 1 in 7 days — investment doesn't pay yet). Track via BE error log grep for `WA client init failed`.

Not opening a spec/plan for now. If frequency climbs, escalate.

## Prevention (added to backlog)

- Monitor `WA client init failed` in Sentry / gcloud logging. If > 1x/day for 3 days → escalate.
- If we later add a proactive readiness probe (Cloud Run `startupProbe`), keep it OUT of the WA init path so partial-init doesn't nuke the whole pod.

## References

- Prior incident: `docs/incidents/2026-07-20-backend-wa-init-crashloop.md` — different symptom class (slot exhaustion), same subsystem.
- Related memory: `project_supabase_split_pool`, `project_wa_test_data_noise`.
