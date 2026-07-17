# Caleo ERP — Daily Database Backup

Cloud Scheduler → Cloud Run Job → GCS. Runs 03:00 UTC (10:00 WIB) daily.

## Architecture

```
Cloud Scheduler (03:00 UTC daily)
  → POST Cloud Run Jobs API
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

## Restore

Restore procedures are documented in Task 12b/c/d runbooks (joint rehearsal with founder).

Quick reference — restore all to a new DB:
```bash
pg_restore -d "postgresql://..." /path/to/db-YYYY-MM-DD.dump
```
