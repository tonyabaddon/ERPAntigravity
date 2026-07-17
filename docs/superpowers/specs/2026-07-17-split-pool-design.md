# Split-pool backend DB connection (2026-07-17)

## Context

Backend Go currently uses a single `*sql.DB` for both HTTP handler queries AND `pq.Listener` (LISTEN/NOTIFY on 6 channels). The listener holds a persistent connection slot per instance.

Today's Bug D surfaced: Supabase free-tier session pooler cap 15 clients. Backend at MaxOpenConns=10 + 1 listener = 11 per instance. Rolling deploy 2 instances = 22 clients → over pool cap → new revision startup fails with `EMAXCONNSESSION`.

Doesn't scale: at 5+ instances OR concurrent staging+prod deploys, we hit the cap.

## Decision

Split backend DB connection into two pools:
- **`queryDB`**: transaction pooler (`aws-1-ap-northeast-1.pooler.supabase.com:6543`, 200+ effective slot cap via Supavisor multiplexing) — used by all HTTP handlers, RPC calls, worker
- **`listenerDB`**: direct connection (`db.<ref>.supabase.co:5432`, ~45-55 user-available slots) — used by `pq.Listener` only

## Why

- Query pool via txn pooler scales to hundreds of clients via multiplexing
- Listener conn is persistent and rare (1 per instance) — direct's 45-55 slot cap is plenty for 10+ backend instances
- Preserves LISTEN/NOTIFY (txn pooler drops LISTEN, direct preserves it)
- Zero-cost — both endpoints already available on free tier
- Small refactor: `Client` struct + `NewClient` signature change + main.go wiring

## Alternatives rejected

- **Revert to direct-only** — directional improvement (60 vs 15) but still doesn't scale beyond ~5 instances due to listener holding slot
- **Realtime migration** — best long-term but 6-8h refactor, touches WA/order/payment flows, higher risk tonight
- **Reduce MaxOpenConns further** — bandaid, latency risk

## Design

### `backend-go/internal/db/client.go`

```go
type Client struct {
    DB       *sql.DB       // HTTP handlers + RPC via txn pooler
    ListenDB *sql.DB       // pq.Listener only via direct
    listener *pq.Listener
}

// NewClient takes two connection strings. Fails fast if either unreachable.
// - queryConn: transaction pooler URL (port 6543 typically)
// - listenConn: direct connection URL (port 5432 typically)
func NewClient(queryConn, listenConn string) (*Client, error) {
    query, err := sql.Open("postgres", queryConn)
    if err != nil { return nil, err }
    query.SetMaxOpenConns(10)  // restore to 10 — txn pooler multiplexes so this is safe
    query.SetMaxIdleConns(5)
    query.SetConnMaxLifetime(5 * time.Minute)
    if err := query.Ping(); err != nil { return nil, err }

    listen, err := sql.Open("postgres", listenConn)
    if err != nil { query.Close(); return nil, err }
    listen.SetMaxOpenConns(2)  // just listener + occasional
    listen.SetMaxIdleConns(1)
    listen.SetConnMaxLifetime(0)  // never rotate; listener needs persistence
    if err := listen.Ping(); err != nil { query.Close(); listen.Close(); return nil, err }

    slog.Info("[DB] Connected — queries via txn pooler, listener via direct")

    listener := pq.NewListener(listenConn, 10*time.Second, time.Minute, func(ev pq.ListenerEventType, err error) {
        if err != nil { slog.Error("[DB] Listener event error", slog.Any("error", err)) }
    })

    return &Client{DB: query, ListenDB: listen, listener: listener}, nil
}
```

`NewClientWithoutListener` (used by tests) similarly takes queryConn only.

### `backend-go/main.go`

```go
queryConn := getEnv("SUPABASE_DB_CONNECTION", "postgres://...")
listenConn := getEnv("SUPABASE_DB_LISTENER_CONNECTION", queryConn) // fallback for local dev
dbClient, err := db.NewClient(queryConn, listenConn)
```

### Secret Manager

**Update** `supabase-db-connection-prod` (version bump): value = transaction pooler URL
```
host=aws-1-ap-northeast-1.pooler.supabase.com port=6543 user=postgres.ekhhojaezdfjfwuxyjkl password='...' dbname=postgres sslmode=require
```

**New** `supabase-db-connection-listener-prod`: direct connection URL (same as pre-today's switch)
```
host=db.ekhhojaezdfjfwuxyjkl.supabase.co port=5432 user=postgres password='...' dbname=postgres sslmode=require
```

### Cloud Run

Backend service update: add second secret ref
```
--update-secrets=SUPABASE_SERVICE_KEY=supabase-service-key-prod:latest,\
SUPABASE_DB_CONNECTION=supabase-db-connection-prod:latest,\
SUPABASE_DB_LISTENER_CONNECTION=supabase-db-connection-listener-prod:latest
```

Update `cloudbuild.yaml` both staging + prod deploy steps.

### Backup Cloud Run Job

**No change**. `caleo-daily-backup` job uses `supabase-db-connection-prod:latest`. When we change that secret from direct → txn pooler, `pg_dump` must still work through txn pooler. Verified today: pg_dump via pooler succeeded (per Task 12a report). If it later fails, update backup job to use `supabase-db-connection-listener-prod` (direct URL) instead.

## Verifications required during implementation

1. **`lib/pq` + txn pooler prepared statements**: default behavior is simple protocol, should work. Test with one SELECT + one INSERT via txn pooler locally before deploy.
2. **`SET LOCAL` inside transactions**: backend uses `set_config()` in some SECDEF paths. `SET LOCAL` inside `BEGIN...COMMIT` is txn-pooler-safe. Verify with one RPC call.
3. **Reconnect behavior on listener**: if listener conn drops, `pq.Listener` auto-reconnects. Verify by monitoring "[DB] Listener event error" logs post-deploy.
4. **Backup job**: after secret swap, run `gcloud run jobs execute caleo-daily-backup --wait` to confirm pg_dump still works.

## Rollback

1. Revert Git commit (backend Go changes)
2. Roll Cloud Run traffic back to `00317-tat` (last-known-good pre-refactor)
3. Optionally delete new secret `supabase-db-connection-listener-prod` (harmless to leave)

## What this fixes vs doesn't

**Fixes:**
- Rolling deploys succeed even with 2 revisions briefly running (query pool doesn't fill)
- Scale to 10+ backend instances (each listener = 1/45 direct slot)
- Concurrent staging+prod deploy no longer contested
- pg_dump backup continues to work (no change to backup path)

**Doesn't fix:**
- If direct connection saturates (very rare bursts), listener may drop and reconnect. Acceptable.
- Transaction pooler drops LISTEN — not used for that path. Fine.

## Follow-up (not this task)

- If backend scales past 40 instances, migrate LISTEN → Supabase Realtime WebSocket (Phase 3+)
- If txn pooler compat issue surfaces with lib/pq, evaluate `pgx` driver as alternative

## Related
- [[project-supabase-session-pooler]] — earlier decision, superseded
- [[deploy-silent-fail-2026-07-17]] — Bug D context
- Task 12a — backup job on same DB
