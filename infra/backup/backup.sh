#!/bin/bash
# Caleo ERP — daily Supabase pg_dump to GCS
# Runs as a Cloud Run Job, triggered by Cloud Scheduler at 03:00 UTC (10:00 WIB).
#
# Required env vars (injected by Cloud Run Job):
#   SUPABASE_DB_CONNECTION — libpq connection string (from Secret Manager)
#   BUCKET                 — GCS bucket name (from Job env vars)

set -euo pipefail

DATE=$(date -u +%Y-%m-%d)
DUMP_FILE="/tmp/db-${DATE}.dump"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting backup for date=${DATE} ..."

# Validate required env vars
: "${SUPABASE_DB_CONNECTION:?SUPABASE_DB_CONNECTION is required}"
: "${BUCKET:?BUCKET is required}"

# Run pg_dump
# -Fc = custom format (compressed, allows selective table restore)
# Connection string is in libpq keyword=value format (host=... port=... etc.)
pg_dump -Fc -f "$DUMP_FILE" "$SUPABASE_DB_CONNECTION"

SIZE=$(ls -lh "$DUMP_FILE" | awk '{print $5}')
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Dump complete: size=${SIZE}"

# Upload to GCS
gsutil cp "$DUMP_FILE" "gs://${BUCKET}/db-${DATE}.dump"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Uploaded to gs://${BUCKET}/db-${DATE}.dump"

# Clean up temp file
rm -f "$DUMP_FILE"

# Structured success marker — log-based metric 'backup_success_count' watches for this line
echo "BACKUP_SUCCESS date=${DATE} size=${SIZE}"
