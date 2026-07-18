# Caleo ERP — Daily Database Backup

Cloud Scheduler → Cloud Run Job → GCS. Runs 03:00 UTC (10:00 WIB) daily.

## Architecture

```
Cloud Scheduler (03:00 UTC daily)
  → POST https://run.googleapis.com/v2/projects/.../jobs/caleo-daily-backup:run (OAuth)
    → Cloud Run Job: caleo-daily-backup
      → pg_dump -Fc (PostgreSQL 17 custom format, compressed)
      → gsutil cp → gs://caleo-backups-gen-lang-client-0410251117/db-YYYY-MM-DD.dump
      → logs "BACKUP_SUCCESS" line
        → log-based metric: backup_success_count
          → alert: fires if count < 1 in 24.5h window
```

## Connection

Uses **session pooler** (not direct connection) — tested 2026-07-17, pooler is
compatible with pg_dump on this Supabase version. Secret: `supabase-db-connection-prod`.

## Retention

30-day lifecycle delete on the GCS bucket. Files older than 30 days are deleted automatically.

## Backup file size

As of 2026-07-17: 3.23 MiB compressed (database = 46 MB uncompressed, 3 tenants, 123 tables).

## Manual trigger

```bash
gcloud run jobs execute caleo-daily-backup \
  --region=asia-southeast1 \
  --project=gen-lang-client-0410251117 \
  --wait
```

## Verify backup landed

```bash
gsutil ls -l gs://caleo-backups-gen-lang-client-0410251117/
```

## Build & update image

After changing `Dockerfile` or `backup.sh`:

```bash
# Build and push new image via Cloud Build:
gcloud builds submit \
  --project=gen-lang-client-0410251117 \
  --region=asia-southeast1 \
  --config=infra/backup/cloudbuild.yaml \
  .

# Update the Cloud Run Job to the new image SHA (Cloud Build step 3 handles this automatically
# for subsequent builds; on first create, use `gcloud run jobs create` instead of `update`).
```

## GCP resources created

| Resource | Name |
|---|---|
| GCS bucket | `caleo-backups-gen-lang-client-0410251117` (asia-southeast1) |
| Cloud Run Job | `caleo-daily-backup` (asia-southeast1) |
| Cloud Scheduler | `caleo-daily-backup-trigger` (asia-southeast1, 03:00 UTC) |
| Log-based metric | `backup_success_count` |
| Alert policy | `Backup missing — no successful backup in 24.5h` |
| Notification channel | `Founder email — Tony` (existing, reused) |

## Free-tier utilization

- GCS: 5 GB free tier → 3.23 MB/day × 30 days = ~97 MB total, ~2% of free tier
- Cloud Scheduler: 3 jobs free → using 1
- Cloud Run Jobs: pay-per-execution (0.001 vCPU-sec at 1 vCPU × ~80s ≈ $0.001/run, ~$0.03/month — within always-free allowance at current size)

## Restore procedure (verified 2026-07-18)

End-to-end drill on 2026-07-18 proved backup files restore cleanly with 11/11 rowcount parity vs production. Full report: `drills/2026-07-18-report.md`. Two verified paths:

### Path A — Real DR: restore into a fresh Supabase project (recommended when disaster is real)

Use this when production Supabase itself is compromised OR when you need full auth/vault schema restoration.

```bash
# 1. Provision a new Supabase project via dashboard or MCP create_project
#    Note the connection string from Settings → Database → Connection string.

# 2. Fetch latest dump
LATEST=$(gsutil ls gs://caleo-backups-gen-lang-client-0410251117/db-*.dump | sort | tail -1)
gsutil cp "$LATEST" /tmp/latest.dump

# 3. Restore (full — auth + storage + public schemas all restore because Supabase provides pgsodium/vault/pg_graphql natively)
pg_restore --clean --if-exists --no-owner --no-privileges \
  -d "$SUPABASE_NEW_PROJECT_CONNECTION" \
  /tmp/latest.dump

# 4. Verify rowcounts vs snapshot from source project (if source still accessible), or vs the drill report as baseline.
```

**Expected**: zero errors on a fresh Supabase target because all required extensions/roles/schemas exist.

### Path B — Local drill: restore into Homebrew Postgres for verification (no cost, no cloud exposure)

Use this for periodic re-drills (quarterly cadence) OR to inspect a specific backup's contents.

```bash
export DRILL_DIR=/tmp/pg-restore-drill
export DRILL_PORT=54329

# 1. Init throwaway cluster (idempotent)
rm -rf $DRILL_DIR && mkdir -p $DRILL_DIR
initdb -D $DRILL_DIR/data -U postgres --encoding=UTF8 --auth=trust
pg_ctl -D $DRILL_DIR/data -l $DRILL_DIR/pg.log -o "-p $DRILL_PORT" start
createdb -h 127.0.0.1 -p $DRILL_PORT -U postgres restore_target

# 2. Pull latest dump
LATEST=$(gsutil ls gs://caleo-backups-gen-lang-client-0410251117/db-*.dump | sort | tail -1)
gsutil cp "$LATEST" $DRILL_DIR/latest.dump

# 3. Restore public schema only (auth needs pgsodium/vault — Supabase-only extensions)
pg_restore --schema=public --no-owner --no-privileges \
  -h 127.0.0.1 -p $DRILL_PORT -U postgres -d restore_target \
  $DRILL_DIR/latest.dump 2>&1 | tee $DRILL_DIR/restore.log

# 4. Verify (see drills/2026-07-18-report.md for the canonical query set)

# 5. Teardown
pg_ctl -D $DRILL_DIR/data stop
rm -rf $DRILL_DIR
```

**Expected**: ~490 errors on 2026-07-18 baseline dump, ALL environmental (missing `authenticated` role, missing `auth` schema, missing `pgvector`, missing `vosi_rpc_owner`, missing `supabase_realtime` publication). None are data-restore failures — data COPY succeeds for every table whose types are available. `stock_photo_embeddings` (pgvector-dependent) is skipped locally; all other public tables restore fully.

## Re-drill cadence

Run Path B **quarterly** (next: 2026-10-18) OR immediately after any schema migration that adds new extensions, new schemas, or major table restructures. Log each drill under `drills/YYYY-MM-DD-report.md`.

## When restore fails or verification mismatches

1. STOP. Do not delete the failing dump — it is evidence.
2. Log incident at `docs/incidents/YYYY-MM-DD-restore-failure.md`.
3. Root-cause: is the dump file corrupt (retry gsutil cp with `-c` checksum verify), or did a schema change break restore compatibility (pg_dump/pg_restore version mismatch)?
4. Do NOT run `caleo-daily-backup` job with a broken restore path in production — investigate first.
