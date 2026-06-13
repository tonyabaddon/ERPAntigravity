# Layer D-min: Staging + Deploy Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a staging environment and DIY backup automation so that Layer A migrations (40-50 ALTER TABLE changes for `tenant_id` rollout) can be safely tested before touching Garindo's production data.

**Architecture:**
- **Staging Supabase project** (separate free-tier project from prod) holds a schema copy of prod. All migrations are applied to staging first, then promoted to prod manually.
- **Staging Cloud Run services** (backend + frontend) mirror prod deploy targets so smoke tests exercise the real deploy path.
- **DIY backup**: Cloud Run Job (postgres + gcloud Dockerfile) runs daily via Cloud Scheduler, dumps prod Supabase via `pg_dump`, gzips, uploads to a GCS bucket with 7-day lifecycle delete. Restore script reverses the path. Verified end-to-end by one drill against staging.

**Tech Stack:**
- Supabase (Postgres) — 2 free-tier projects (prod existing + new staging)
- Cloud Run + Cloud Run Jobs + Cloud Scheduler (GCP `asia-southeast1`)
- GCS bucket with lifecycle rules
- `pg_dump` / `psql` via `postgres:15-alpine`
- `gcloud` via `google/cloud-sdk:alpine`
- Existing Go `apply-migration` tool (`backend-go/cmd/apply-migration/`)
- Bash scripts in `scripts/`

**Spec reference:** `docs/superpowers/specs/2026-06-13-multi-tenant-prerequisites-design.md` §4.1.

**Estimated solo effort:** 3-5 days.

**Constraints:**
- Garindo (prod) stays live. No destructive prod changes during D-min.
- Supabase stays on free tier. Pro tier upgrade requires founder approval per spec §8.5 — not part of this plan.
- Solo founder execution.
- Follow existing patterns: `scripts/apply-pending-migrations.sh`, `cloudbuild.yaml`, `cloudbuild.frontend.yaml`.

---

## File structure

**New files:**
- `scripts/backup-prod.sh` — pg_dump prod Supabase → gzip → upload to GCS (also runnable locally)
- `scripts/restore-from-backup.sh` — download a backup from GCS, restore to target DB
- `backup-job/Dockerfile` — postgres-client + google-cloud-sdk for Cloud Run Job
- `backup-job/backup.sh` — entrypoint script that the Cloud Run Job invokes (calls pg_dump + gcloud)
- `cloudbuild.backup-job.yaml` — Cloud Build config to build + push the backup-job image
- `docs/runbooks/deploy.md` — off-peak deploy discipline, pre-deploy checklist, frontend + backend deploy procedure
- `docs/runbooks/disaster-recovery.md` — DR procedures: Supabase outage, migration corruption, service-role key rotation, Kominfo breach notification (UU PDP Pasal 46 ayat 3), restore from backup procedure
- `docs/runbooks/staging-environment.md` — staging setup steps + day-to-day usage

**Modified files:**
- `scripts/apply-pending-migrations.sh` — add `--target=staging|prod` flag with safety guard for prod; defaults to staging
- `backend-go/.env.example` — add staging connection placeholder + GCS bucket name
- `progress.md` — record completion

**External provisioning (operator actions tracked in runbook):**
- New Supabase project: `vosi-staging` (free tier)
- New Cloud Run service: `garindo-jaya-panel-msme-erp-staging` (backend Go)
- New Cloud Run service: `vosi-app-staging` (frontend)
- New GCS bucket: `vosi-backups` (with 7-day lifecycle delete on `prod/daily/` prefix)
- New Cloud Run Job: `vosi-backup-prod`
- New Cloud Scheduler job: `vosi-backup-prod-daily` (cron `0 22 * * *` interpreted in `Asia/Jakarta` timezone)
- New service account: `backup-job@<project>.iam.gserviceaccount.com` with `storage.objectAdmin` on bucket

---

## Prerequisites & placeholders

Before starting, verify the operator workstation has:

- `gcloud` CLI installed and authenticated to the GCP account that owns the project (`gcloud auth login`).
- `gcloud config set project <your-gcp-project-id>` already configured.
- `pg_dump` and `psql` available locally (postgres-client package).
- The existing Supabase prod project ref + service-role key + DB connection string available in `backend-go/.env`.
- `go` (1.21+) to build the existing `apply-migration` tool.

**Placeholders used throughout this plan** (substitute consistently):

| Placeholder | What to substitute |
|---|---|
| `<your-gcp-project-id>` | Your existing GCP project ID (whichever hosts the current Garindo Cloud Run services) |
| `<staging-project-ref>` | The new staging Supabase project ref (e.g. `xyzabc1234`) from Supabase dashboard URL |
| `<staging-service-role-key>` | service_role key from staging Supabase Settings → API |
| `<staging-anon-key>` | anon key from staging Supabase Settings → API |
| `$STAGING_BACKEND_URL` | Cloud Run URL of `garindo-jaya-panel-msme-erp-staging` after first deploy |
| `$STAGING_SUPABASE_DB_CONNECTION` | Direct DB connection string for staging Supabase |
| `<prod-db-connection>` | Existing prod DB connection from `backend-go/.env` |
| `<previous-revision>` | A specific Cloud Run revision name found via `gcloud run revisions list` |

No placeholder should remain in committed files — they all belong only in operator-side env vars or runtime command substitutions.

---

## Phase A — Staging Supabase project

### Task 1: Create staging Supabase project + record connection

**Files:**
- Create: `docs/runbooks/staging-environment.md` (initial skeleton)

- [ ] **Step 1: Create the Supabase project via dashboard**

  Manual operator action (cannot automate via free-tier API):

  1. Sign in to https://supabase.com/dashboard
  2. New Project → Organization: (your existing org) → Name: `vosi-staging` → Region: `Southeast Asia (Singapore)` (`ap-southeast-1`, same as prod) → Pricing: `Free` → Generate strong password → Create.
  3. Wait ~2 minutes for provisioning.
  4. Project Settings → Database → copy the **Connection string (Direct connection)** AND the **Connection string (Connection pooler — transaction mode)**.
  5. Project Settings → API → copy the `service_role` key and the `anon` key.

  Acceptance: project is ACTIVE, you have credentials in a temporary secure note (not committed to git).

- [ ] **Step 2: Create the staging runbook skeleton**

  Create `docs/runbooks/staging-environment.md`:

```markdown
# Staging Environment Runbook

**Project:** `vosi-staging` (Supabase free tier, region ap-southeast-1)
**Purpose:** Mirror prod schema for migration dry-runs and pre-launch smoke tests. Never holds real tenant data.

## Connection strings

Stored in `backend-go/.env.staging` (gitignored). To regenerate:

1. Supabase dashboard → vosi-staging → Settings → Database → Connection string (Direct).
2. Supabase dashboard → vosi-staging → Settings → API → service_role key.

## Day-to-day usage

### Apply a migration to staging

```bash
cd backend-go && set -a && source .env.staging && set +a && cd ..
./scripts/apply-pending-migrations.sh --target=staging
```

### Mirror prod schema to staging (after a prod schema change you missed)

```bash
# Dump schema from prod
pg_dump "$PROD_SUPABASE_DB_CONNECTION" --schema-only --no-owner --no-privileges > /tmp/prod-schema.sql

# Wipe + apply to staging
psql "$STAGING_SUPABASE_DB_CONNECTION" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$STAGING_SUPABASE_DB_CONNECTION" < /tmp/prod-schema.sql
```

### Reset staging to a clean state

Drop + recreate `public` schema as above, then re-apply migrations.

## Free-tier reminders

- Project auto-pauses after 7 days of inactivity. The nightly migration dry-run keeps it active.
- 500MB DB size limit. Don't import prod data into staging — schema only.
- No automatic backups on free tier. Acceptable for staging (data is reproducible from prod schema dump).
```

- [ ] **Step 3: Commit the runbook skeleton**

```bash
git add docs/runbooks/staging-environment.md
git commit -m "docs(runbook): staging environment skeleton + connection regeneration steps"
```

---

### Task 2: Capture prod schema and apply to staging

**Files:**
- Create: `backend-go/.env.staging` (gitignored — verify .gitignore covers it)

- [ ] **Step 1: Verify .gitignore covers staging env file**

  Run: `grep -n '.env' /Users/tonywei/IdeaProjects/ERPAntigravity/.gitignore`
  Expected: a line matching `.env` or `*.env`. If missing, add `backend-go/.env.staging` explicitly.

- [ ] **Step 2: Create staging env file with staging connection**

  Create `backend-go/.env.staging` (replace placeholders with values from Task 1 Step 1):

```bash
# vosi-staging Supabase project — DO NOT COMMIT
SUPABASE_DB_CONNECTION=postgresql://postgres.<staging-project-ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
SUPABASE_URL=https://<staging-project-ref>.supabase.co
SUPABASE_SERVICE_KEY=<staging-service-role-key>
SUPABASE_ANON_KEY=<staging-anon-key>
PORT=8081
```

  Acceptance: file exists, password substituted, file is NOT staged in git (verify with `git status`).

- [ ] **Step 3: Dump prod schema to a local file**

  Source prod env:

```bash
cd backend-go && set -a && source .env && set +a && cd ..
```

  Then dump schema only:

```bash
pg_dump "$SUPABASE_DB_CONNECTION" \
  --schema-only \
  --no-owner \
  --no-privileges \
  --no-comments \
  > /tmp/prod-schema-$(date +%Y%m%d).sql
```

  Acceptance: file exists, > 100KB, head shows `CREATE TABLE`, `CREATE FUNCTION` etc. (no rows).

- [ ] **Step 4: Apply prod schema to staging**

  Source staging env:

```bash
cd backend-go && set -a && source .env.staging && set +a && cd ..
```

  Wipe + apply:

```bash
psql "$SUPABASE_DB_CONNECTION" -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;"
psql "$SUPABASE_DB_CONNECTION" < /tmp/prod-schema-$(date +%Y%m%d).sql
```

  Acceptance: `psql` exits 0. If warnings about extensions or roles, that's expected (Supabase manages those separately).

- [ ] **Step 5: Verify staging schema matches prod**

  Re-dump staging schema and diff:

```bash
pg_dump "$SUPABASE_DB_CONNECTION" --schema-only --no-owner --no-privileges --no-comments > /tmp/staging-schema.sql

# Switch back to prod env
cd backend-go && set -a && source .env && set +a && cd ..
pg_dump "$SUPABASE_DB_CONNECTION" --schema-only --no-owner --no-privileges --no-comments > /tmp/prod-schema-verify.sql

diff /tmp/staging-schema.sql /tmp/prod-schema-verify.sql | head -40
```

  Expected: zero or only cosmetic differences (e.g. comments, dump timestamps). Any structural diff means re-apply needed.

  Acceptance: schema diff is empty or only cosmetic.

- [ ] **Step 6: Commit nothing yet** — credentials are in `.env.staging` which is gitignored. No commit step here.

---

## Phase B — Staging Cloud Run services

### Task 3: Create staging build configs (backend)

**Files:**
- Create: `cloudbuild.staging.yaml` (backend Go staging)

- [ ] **Step 1: Create backend staging Cloud Build config**

  Create `cloudbuild.staging.yaml`:

```yaml
# Staging deploy for backend (Go).
# Triggered manually:
#   gcloud builds submit --config=cloudbuild.staging.yaml \
#     --substitutions=_SUPABASE_DB_CONN=$STAGING_DB_CONN,_GEMINI_API_KEY=$GEMINI_API_KEY
#
# Do NOT enable Calista / daemon for staging. This service is API-only.
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - build
      - '-t'
      - '$_AR_HOSTNAME/$_AR_PROJECT_ID/$_AR_REPOSITORY/$_SERVICE_NAME:$COMMIT_SHA'
      - '-f'
      - 'backend-go/Dockerfile'
      - 'backend-go'

  - name: 'gcr.io/cloud-builders/docker'
    args:
      - push
      - '$_AR_HOSTNAME/$_AR_PROJECT_ID/$_AR_REPOSITORY/$_SERVICE_NAME:$COMMIT_SHA'

  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - run
      - deploy
      - '$_SERVICE_NAME'
      - '--image=$_AR_HOSTNAME/$_AR_PROJECT_ID/$_AR_REPOSITORY/$_SERVICE_NAME:$COMMIT_SHA'
      - '--region=$_DEPLOY_REGION'
      - '--platform=$_PLATFORM'
      - '--allow-unauthenticated'
      - '--update-env-vars=SUPABASE_URL=$_STAGING_SUPABASE_URL,SUPABASE_SERVICE_KEY=$_STAGING_SERVICE_KEY,SUPABASE_DB_CONNECTION=$_SUPABASE_DB_CONN,GEMINI_API_KEY=$_GEMINI_API_KEY,ENVIRONMENT=staging,DEBOUNCE_ENABLED=false'

images:
  - '$_AR_HOSTNAME/$_AR_PROJECT_ID/$_AR_REPOSITORY/$_SERVICE_NAME:$COMMIT_SHA'

options:
  logging: CLOUD_LOGGING_ONLY

substitutions:
  _SERVICE_NAME: 'garindo-jaya-panel-msme-erp-staging'
  _AR_HOSTNAME: 'asia-southeast1-docker.pkg.dev'
  _AR_REPOSITORY: 'cloud-run-source-deploy'
  _DEPLOY_REGION: 'asia-southeast1'
  _PLATFORM: 'managed'
  _STAGING_SUPABASE_URL: ''
  _STAGING_SERVICE_KEY: ''
```

  Acceptance: file written. Substitution values for the staging-specific Supabase URL + key will be passed per-build (not committed).

- [ ] **Step 2: Commit the staging build config**

```bash
git add cloudbuild.staging.yaml
git commit -m "feat(deploy): backend staging Cloud Build config"
```

---

### Task 4: Create staging build configs (frontend)

**Files:**
- Create: `cloudbuild.frontend.staging.yaml`

- [ ] **Step 1: Create frontend staging Cloud Build config**

  Create `cloudbuild.frontend.staging.yaml`:

```yaml
# Staging deploy for frontend (Vite/React).
# Triggered manually:
#   gcloud builds submit --config=cloudbuild.frontend.staging.yaml \
#     --substitutions=_VITE_BACKEND_URL=https://garindo-jaya-panel-msme-erp-staging-<hash>.a.run.app,\
# _VITE_SUPABASE_URL=https://<staging-project-ref>.supabase.co,\
# _VITE_SUPABASE_ANON_KEY=<staging-anon-key>
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - build
      - '-t'
      - '$_AR_HOSTNAME/$_AR_PROJECT_ID/$_AR_REPOSITORY/$_SERVICE_NAME:$COMMIT_SHA'
      - '--build-arg'
      - 'VITE_BACKEND_URL=$_VITE_BACKEND_URL'
      - '--build-arg'
      - 'VITE_SUPABASE_URL=$_VITE_SUPABASE_URL'
      - '--build-arg'
      - 'VITE_SUPABASE_ANON_KEY=$_VITE_SUPABASE_ANON_KEY'
      - '-f'
      - 'Dockerfile'
      - '.'

  - name: 'gcr.io/cloud-builders/docker'
    args:
      - push
      - '$_AR_HOSTNAME/$_AR_PROJECT_ID/$_AR_REPOSITORY/$_SERVICE_NAME:$COMMIT_SHA'

  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - run
      - deploy
      - '$_SERVICE_NAME'
      - '--image=$_AR_HOSTNAME/$_AR_PROJECT_ID/$_AR_REPOSITORY/$_SERVICE_NAME:$COMMIT_SHA'
      - '--region=$_DEPLOY_REGION'
      - '--platform=$_PLATFORM'
      - '--allow-unauthenticated'

images:
  - '$_AR_HOSTNAME/$_AR_PROJECT_ID/$_AR_REPOSITORY/$_SERVICE_NAME:$COMMIT_SHA'

options:
  logging: CLOUD_LOGGING_ONLY

substitutions:
  _SERVICE_NAME: 'vosi-app-staging'
  _AR_HOSTNAME: 'asia-southeast1-docker.pkg.dev'
  _AR_REPOSITORY: 'cloud-run-source-deploy'
  _DEPLOY_REGION: 'asia-southeast1'
  _PLATFORM: 'managed'
  _VITE_BACKEND_URL: ''
  _VITE_SUPABASE_URL: ''
  _VITE_SUPABASE_ANON_KEY: ''
```

  Acceptance: file written.

- [ ] **Step 2: Commit the frontend staging build config**

```bash
git add cloudbuild.frontend.staging.yaml
git commit -m "feat(deploy): frontend staging Cloud Build config"
```

---

### Task 5: Deploy backend to staging (first smoke)

- [ ] **Step 1: Submit backend staging build**

  Substitute values from Task 1 / 2 and submit:

```bash
gcloud builds submit \
  --config=cloudbuild.staging.yaml \
  --substitutions=\
_SUPABASE_DB_CONN="$STAGING_SUPABASE_DB_CONNECTION",\
_GEMINI_API_KEY="$GEMINI_API_KEY",\
_STAGING_SUPABASE_URL="https://<staging-project-ref>.supabase.co",\
_STAGING_SERVICE_KEY="<staging-service-role-key>" \
  --project=<your-gcp-project-id>
```

  Acceptance: build SUCCESS, Cloud Run revision deployed.

- [ ] **Step 2: Note the staging backend URL**

  Run:

```bash
gcloud run services describe garindo-jaya-panel-msme-erp-staging \
  --region=asia-southeast1 \
  --format='value(status.url)'
```

  Save this URL. You'll need it for Task 6 + frontend env vars.

  Acceptance: URL printed in form `https://garindo-jaya-panel-msme-erp-staging-<hash>.a.run.app`.

- [ ] **Step 3: Smoke test staging backend health**

  Run:

```bash
STAGING_URL=$(gcloud run services describe garindo-jaya-panel-msme-erp-staging --region=asia-southeast1 --format='value(status.url)')
curl -fsS "$STAGING_URL/healthz" || curl -fsS "$STAGING_URL/"
```

  Expected: HTTP 200. If `/healthz` doesn't exist yet, the root endpoint should at least respond.

  Acceptance: HTTP 200 from staging backend.

---

### Task 6: Deploy frontend to staging (first smoke)

- [ ] **Step 1: Submit frontend staging build**

  Use the staging backend URL from Task 5 and Supabase staging keys from Task 1:

```bash
gcloud builds submit \
  --config=cloudbuild.frontend.staging.yaml \
  --substitutions=\
_VITE_BACKEND_URL="$STAGING_BACKEND_URL",\
_VITE_SUPABASE_URL="https://<staging-project-ref>.supabase.co",\
_VITE_SUPABASE_ANON_KEY="<staging-anon-key>" \
  --project=<your-gcp-project-id>
```

  Acceptance: build SUCCESS, Cloud Run revision deployed.

- [ ] **Step 2: Open staging frontend in browser**

  Get the URL:

```bash
gcloud run services describe vosi-app-staging \
  --region=asia-southeast1 \
  --format='value(status.url)'
```

  Open the URL in a browser.

  Acceptance: app loads, login screen renders. (DB is empty, so you cannot actually log in — that's expected.)

- [ ] **Step 3: No commit** — staging build configs already committed in Tasks 3/4. Service deployment is operator action, not in source.

---

## Phase C — Migration script with staging-first target

### Task 7: Add `--target` flag to migration script

**Files:**
- Modify: `scripts/apply-pending-migrations.sh`

- [ ] **Step 1: Read current script (already done in context). Note shape: builds `apply-migration` Go tool, loops over `MIGRATIONS` array using `SUPABASE_DB_CONNECTION`.**

- [ ] **Step 2: Rewrite script to accept `--target` with safety guard**

  Replace `scripts/apply-pending-migrations.sh` with:

```bash
#!/usr/bin/env bash
# Applies pending migrations to either staging or prod Supabase.
#
# Usage:
#   ./scripts/apply-pending-migrations.sh --target=staging   (default)
#   ./scripts/apply-pending-migrations.sh --target=prod
#
# Prod target requires explicit double-confirmation to prevent accidents.
#
# Env required:
#   --target=staging: source backend-go/.env.staging first
#   --target=prod   : source backend-go/.env first
set -euo pipefail

TARGET="staging"
for arg in "$@"; do
  case "$arg" in
    --target=*) TARGET="${arg#--target=}" ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [[ "$TARGET" != "staging" && "$TARGET" != "prod" ]]; then
  echo "Invalid --target: $TARGET (must be staging or prod)" >&2
  exit 2
fi

if [[ -z "${SUPABASE_DB_CONNECTION:-}" ]]; then
  echo "SUPABASE_DB_CONNECTION not set." >&2
  if [[ "$TARGET" == "staging" ]]; then
    echo "Hint: cd backend-go && set -a && source .env.staging && set +a && cd .." >&2
  else
    echo "Hint: cd backend-go && set -a && source .env && set +a && cd .." >&2
  fi
  exit 1
fi

# Safety: prod target requires interactive confirmation.
if [[ "$TARGET" == "prod" ]]; then
  echo "==============================================="
  echo "  ⚠️  TARGET = PROD (Garindo live database)"
  echo "==============================================="
  echo "Connection: ${SUPABASE_DB_CONNECTION:0:50}..."
  echo ""
  echo "Have you already:"
  echo "  1. Applied + verified these migrations on staging?"
  echo "  2. Taken a pre-migration pg_dump snapshot? (see backup-prod.sh)"
  echo "  3. Picked an off-peak window (WIB 22:00-04:00)?"
  echo ""
  read -p "Type the word 'PROD' to proceed: " confirm
  if [[ "$confirm" != "PROD" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN=/tmp/apply-migration

if [[ ! -x "$BIN" ]]; then
  echo "[build] $BIN"
  (cd "$ROOT/backend-go" && go build -o "$BIN" ./cmd/apply-migration)
fi

# List in apply order. Add new migrations to the bottom of this list.
MIGRATIONS=(
  "20260612000001_fix_transfer_warehouse_security_definer.sql"
  "20260612000002_set_company_name.sql"
  # "20260612000003_e2e_data_scrub.sql"  # blocked by stock_lots FK on PO-TEST rows; cleanup separately
  "20260613000001_warehouses_phase1_schema.sql"
  "20260613000002a_warehouses_phase2_stock_rpcs.sql"
  "20260613000002b_warehouses_phase2_sale_po_rpcs.sql"
  "20260613000002c_warehouses_phase2_approval_rpcs.sql"
  "20260613000002d_warehouses_admin_rpcs.sql"
  "20260613000004_backfill_can_manage_warehouses.sql"
  # ─── Phase 3 cutover — COMMENTED OUT until 24h soak ──────────────────────
  # See git log for context. Uncomment only after staging + 24h prod soak.
  # "20260613000003_warehouses_phase3_cutover.sql"
)

echo "[target] $TARGET"
for m in "${MIGRATIONS[@]}"; do
  f="$ROOT/supabase/migrations/$m"
  if [[ ! -f "$f" ]]; then
    echo "[skip] missing $f" >&2
    continue
  fi
  echo "[apply] $m"
  "$BIN" "$f"
done

echo "[done] all migrations applied to $TARGET"
```

  Acceptance: file rewritten, `chmod +x` already preserved.

- [ ] **Step 3: Dry-run the script against staging**

```bash
cd backend-go && set -a && source .env.staging && set +a && cd ..
./scripts/apply-pending-migrations.sh --target=staging
```

  Expected: each migration prints `[apply] ...` and the script ends with `[done] all migrations applied to staging`. Since staging schema was synced from prod in Task 2, all these migrations should already be applied — the script should report success or "already exists" depending on whether the SQL is idempotent. (Most use `CREATE OR REPLACE` / `IF NOT EXISTS` — re-running is safe.)

  Acceptance: script exits 0.

- [ ] **Step 4: Verify the prod confirmation prompt works (without actually running)**

  Source prod env in a subshell and trigger the prompt with empty input:

```bash
( cd backend-go && set -a && source .env && set +a && cd .. && echo "" | ./scripts/apply-pending-migrations.sh --target=prod ) || true
```

  Expected: script prints the warning block and exits with "Aborted."

  Acceptance: confirmation gate triggers correctly.

- [ ] **Step 5: Commit the migration script update**

```bash
git add scripts/apply-pending-migrations.sh
git commit -m "feat(deploy): apply-pending-migrations supports --target=staging|prod with prod safety gate"
```

---

## Phase D — DIY backup automation

### Task 8: Create GCS bucket with lifecycle rule

- [ ] **Step 1: Create the bucket**

  Run (replace `<your-gcp-project-id>` with the actual project ID):

```bash
gcloud storage buckets create gs://vosi-backups \
  --project=<your-gcp-project-id> \
  --location=asia-southeast1 \
  --uniform-bucket-level-access \
  --no-public-access-prevention=false
```

  Acceptance: command exits 0. Verify with `gcloud storage buckets describe gs://vosi-backups`.

- [ ] **Step 2: Apply 7-day lifecycle delete on `prod/daily/` prefix**

  Create `/tmp/lifecycle.json`:

```json
{
  "lifecycle": {
    "rule": [
      {
        "action": { "type": "Delete" },
        "condition": {
          "age": 7,
          "matchesPrefix": ["prod/daily/"]
        }
      },
      {
        "action": { "type": "Delete" },
        "condition": {
          "age": 30,
          "matchesPrefix": ["prod/manual/"]
        }
      }
    ]
  }
}
```

  Apply it:

```bash
gcloud storage buckets update gs://vosi-backups --lifecycle-file=/tmp/lifecycle.json
```

  Acceptance: command exits 0. Verify with `gcloud storage buckets describe gs://vosi-backups --format='value(lifecycle)'`.

- [ ] **Step 3: No commit** — bucket is an operator artifact, documented in Task 17 runbook.

---

### Task 9: Create the backup job Dockerfile

**Files:**
- Create: `backup-job/Dockerfile`
- Create: `backup-job/backup.sh`

- [ ] **Step 1: Create the Dockerfile**

  Create `backup-job/Dockerfile`:

```dockerfile
# Image used by Cloud Run Job vosi-backup-prod.
# Has postgres-client (for pg_dump) + gcloud CLI (for upload).
FROM google/cloud-sdk:alpine

RUN apk add --no-cache postgresql-client

COPY backup.sh /backup.sh
RUN chmod +x /backup.sh

ENTRYPOINT ["/backup.sh"]
```

  Acceptance: file written.

- [ ] **Step 2: Create the entrypoint script**

  Create `backup-job/backup.sh`:

```bash
#!/bin/sh
# Backup entrypoint run inside vosi-backup-prod Cloud Run Job.
#
# Required env (set on the Cloud Run Job, not here):
#   SUPABASE_DB_CONNECTION  — full postgres connection string for the source DB
#   GCS_BUCKET              — bucket name, e.g. vosi-backups
#   BACKUP_PREFIX           — defaults to "prod/daily"; manual snapshots use "prod/manual"
#
# Output: gs://$GCS_BUCKET/$BACKUP_PREFIX/$(date +%Y-%m-%d-%H%M%S).sql.gz
set -eu

: "${SUPABASE_DB_CONNECTION:?required}"
: "${GCS_BUCKET:?required}"
BACKUP_PREFIX="${BACKUP_PREFIX:-prod/daily}"

TS="$(date -u +%Y-%m-%d-%H%M%S)"
OUTFILE="/tmp/backup-${TS}.sql.gz"
DEST="gs://${GCS_BUCKET}/${BACKUP_PREFIX}/${TS}.sql.gz"

echo "[backup] $(date -u) — start, dest=$DEST"

pg_dump "$SUPABASE_DB_CONNECTION" \
  --no-owner \
  --no-privileges \
  --no-comments \
  --format=plain \
  | gzip --best > "$OUTFILE"

SIZE_BYTES=$(wc -c < "$OUTFILE")
echo "[backup] dump complete, size=${SIZE_BYTES} bytes"

if [ "$SIZE_BYTES" -lt 10000 ]; then
  echo "[backup] FATAL: backup suspiciously small (<10KB). Aborting upload."
  exit 1
fi

gcloud storage cp "$OUTFILE" "$DEST" --quiet
echo "[backup] upload complete: $DEST"

rm -f "$OUTFILE"
echo "[backup] $(date -u) — done"
```

  Acceptance: file written.

- [ ] **Step 3: Commit the backup job source**

```bash
git add backup-job/Dockerfile backup-job/backup.sh
git commit -m "feat(backup): backup-job Dockerfile + entrypoint for Cloud Run Job"
```

---

### Task 10: Build and push the backup job image

**Files:**
- Create: `cloudbuild.backup-job.yaml`

- [ ] **Step 1: Create the Cloud Build config**

  Create `cloudbuild.backup-job.yaml`:

```yaml
# Builds + pushes the backup-job image. Triggered manually:
#   gcloud builds submit --config=cloudbuild.backup-job.yaml backup-job/
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - build
      - '-t'
      - '$_AR_HOSTNAME/$_AR_PROJECT_ID/$_AR_REPOSITORY/$_SERVICE_NAME:latest'
      - '.'

  - name: 'gcr.io/cloud-builders/docker'
    args:
      - push
      - '$_AR_HOSTNAME/$_AR_PROJECT_ID/$_AR_REPOSITORY/$_SERVICE_NAME:latest'

images:
  - '$_AR_HOSTNAME/$_AR_PROJECT_ID/$_AR_REPOSITORY/$_SERVICE_NAME:latest'

options:
  logging: CLOUD_LOGGING_ONLY

substitutions:
  _SERVICE_NAME: 'vosi-backup-job'
  _AR_HOSTNAME: 'asia-southeast1-docker.pkg.dev'
  _AR_REPOSITORY: 'cloud-run-source-deploy'
```

  Acceptance: file written.

- [ ] **Step 2: Build + push the image**

```bash
gcloud builds submit \
  --config=cloudbuild.backup-job.yaml \
  --project=<your-gcp-project-id> \
  backup-job/
```

  Expected: build SUCCESS, image pushed to `asia-southeast1-docker.pkg.dev/<project>/cloud-run-source-deploy/vosi-backup-job:latest`.

  Acceptance: `gcloud artifacts docker images list asia-southeast1-docker.pkg.dev/<project>/cloud-run-source-deploy --filter='name~vosi-backup-job'` shows the image.

- [ ] **Step 3: Commit the build config**

```bash
git add cloudbuild.backup-job.yaml
git commit -m "feat(backup): Cloud Build config for backup-job image"
```

---

### Task 11: Create the service account and Cloud Run Job

- [ ] **Step 1: Create a dedicated service account**

```bash
gcloud iam service-accounts create backup-job \
  --display-name="Backup Job — pg_dump + GCS upload" \
  --project=<your-gcp-project-id>
```

  Acceptance: command exits 0.

- [ ] **Step 2: Grant the SA access to the backup bucket**

```bash
SA="backup-job@<your-gcp-project-id>.iam.gserviceaccount.com"

gcloud storage buckets add-iam-policy-binding gs://vosi-backups \
  --member="serviceAccount:$SA" \
  --role="roles/storage.objectAdmin"
```

  Acceptance: command exits 0.

- [ ] **Step 3: Create the Cloud Run Job pointing at the image**

  Replace `<prod-db-connection>` with the prod Supabase connection string from `backend-go/.env`:

```bash
gcloud run jobs create vosi-backup-prod \
  --image=asia-southeast1-docker.pkg.dev/<your-gcp-project-id>/cloud-run-source-deploy/vosi-backup-job:latest \
  --region=asia-southeast1 \
  --service-account=backup-job@<your-gcp-project-id>.iam.gserviceaccount.com \
  --set-env-vars=GCS_BUCKET=vosi-backups,BACKUP_PREFIX=prod/daily \
  --set-env-vars=SUPABASE_DB_CONNECTION="<prod-db-connection>" \
  --task-timeout=15m \
  --max-retries=1
```

  Acceptance: job created. Verify with `gcloud run jobs describe vosi-backup-prod --region=asia-southeast1`.

- [ ] **Step 4: Manually trigger the Job to verify it works**

```bash
gcloud run jobs execute vosi-backup-prod --region=asia-southeast1 --wait
```

  Expected: execution status = `Succeeded`. Logs show `[backup] dump complete`, `[backup] upload complete`.

  Acceptance:

  ```bash
  gcloud storage ls gs://vosi-backups/prod/daily/
  ```

  Lists at least one `.sql.gz` file < ~24h old.

- [ ] **Step 5: No commit** — Job and SA are operator artifacts. Documented in runbook (Task 17).

---

### Task 12: Schedule the backup with Cloud Scheduler

- [ ] **Step 1: Create the Scheduler job**

  Schedule for WIB 22:00 daily. Using `--time-zone="Asia/Jakarta"` so the cron string is interpreted in Jakarta local time directly.

```bash
gcloud scheduler jobs create http vosi-backup-prod-daily \
  --location=asia-southeast1 \
  --schedule="0 22 * * *" \
  --time-zone="Asia/Jakarta" \
  --uri="https://asia-southeast1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/<your-gcp-project-id>/jobs/vosi-backup-prod:run" \
  --http-method=POST \
  --oauth-service-account-email="backup-job@<your-gcp-project-id>.iam.gserviceaccount.com"
```

  Acceptance: scheduler job created. Verify with `gcloud scheduler jobs describe vosi-backup-prod-daily --location=asia-southeast1`.

- [ ] **Step 2: Grant the SA permission to invoke the Job**

```bash
gcloud run jobs add-iam-policy-binding vosi-backup-prod \
  --region=asia-southeast1 \
  --member="serviceAccount:backup-job@<your-gcp-project-id>.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

  Acceptance: command exits 0.

- [ ] **Step 3: Force-run the scheduler to confirm wiring**

```bash
gcloud scheduler jobs run vosi-backup-prod-daily --location=asia-southeast1
```

  Wait ~30s, then:

```bash
gcloud run jobs executions list --job=vosi-backup-prod --region=asia-southeast1 --limit=3
```

  Expected: most recent execution status = `Succeeded`.

  Acceptance:

  ```bash
  gcloud storage ls gs://vosi-backups/prod/daily/ | tail -3
  ```

  Now shows two `.sql.gz` files (the one from Task 11 step 4 + this one).

- [ ] **Step 4: No commit** — scheduler is operator artifact.

---

### Task 13: Create local wrapper scripts for backup + manual snapshot

**Files:**
- Create: `scripts/backup-prod.sh`
- Create: `scripts/restore-from-backup.sh`

- [ ] **Step 1: Create local backup wrapper**

  Create `scripts/backup-prod.sh`:

```bash
#!/usr/bin/env bash
# Manual pre-migration snapshot of prod Supabase.
# Use this BEFORE applying any non-trivial migration to prod, in addition to
# the daily automated backup that runs via Cloud Run Job vosi-backup-prod.
#
# Output: gs://vosi-backups/prod/manual/<timestamp>-<label>.sql.gz
#
# Usage:
#   cd backend-go && set -a && source .env && set +a && cd ..
#   ./scripts/backup-prod.sh pre-layer-a-cutover
set -euo pipefail

LABEL="${1:-manual}"
if [[ -z "${SUPABASE_DB_CONNECTION:-}" ]]; then
  echo "SUPABASE_DB_CONNECTION not set — source backend-go/.env first" >&2
  exit 1
fi

TS="$(date -u +%Y-%m-%d-%H%M%S)"
OUTFILE="/tmp/prod-backup-${TS}-${LABEL}.sql.gz"
DEST="gs://vosi-backups/prod/manual/${TS}-${LABEL}.sql.gz"

echo "[backup-prod] $(date -u) — dumping to $OUTFILE"

pg_dump "$SUPABASE_DB_CONNECTION" \
  --no-owner \
  --no-privileges \
  --no-comments \
  --format=plain \
  | gzip --best > "$OUTFILE"

SIZE=$(wc -c < "$OUTFILE")
echo "[backup-prod] size=${SIZE} bytes"

if [[ "$SIZE" -lt 10000 ]]; then
  echo "[backup-prod] FATAL: dump suspiciously small. Not uploading." >&2
  exit 1
fi

echo "[backup-prod] uploading to $DEST"
gcloud storage cp "$OUTFILE" "$DEST"

# Also save a second copy locally for belt-and-braces.
LOCAL_DIR="$HOME/vosi-backups-local"
mkdir -p "$LOCAL_DIR"
cp "$OUTFILE" "$LOCAL_DIR/"
echo "[backup-prod] local copy: $LOCAL_DIR/$(basename "$OUTFILE")"

rm -f "$OUTFILE"
echo "[backup-prod] done"
```

  Acceptance: file written. Set executable: `chmod +x scripts/backup-prod.sh`.

- [ ] **Step 2: Create restore wrapper**

  Create `scripts/restore-from-backup.sh`:

```bash
#!/usr/bin/env bash
# Restore a Supabase database from a gzipped pg_dump in GCS.
#
# Usage:
#   ./scripts/restore-from-backup.sh \
#     --source=gs://vosi-backups/prod/manual/2026-06-13-150000-pre-layer-a.sql.gz \
#     --target=staging
#
# Refuses to restore to prod without --i-mean-it.
set -euo pipefail

SOURCE=""
TARGET="staging"
CONFIRM=""

for arg in "$@"; do
  case "$arg" in
    --source=*) SOURCE="${arg#--source=}" ;;
    --target=*) TARGET="${arg#--target=}" ;;
    --i-mean-it) CONFIRM="yes" ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [[ -z "$SOURCE" ]]; then
  echo "--source=gs://... required" >&2
  exit 2
fi
if [[ "$TARGET" != "staging" && "$TARGET" != "prod" ]]; then
  echo "Invalid --target: $TARGET" >&2
  exit 2
fi
if [[ "$TARGET" == "prod" && "$CONFIRM" != "yes" ]]; then
  echo "Refusing prod restore without --i-mean-it flag" >&2
  echo "Note: restoring to prod will OVERWRITE Garindo data."
  exit 1
fi
if [[ -z "${SUPABASE_DB_CONNECTION:-}" ]]; then
  echo "SUPABASE_DB_CONNECTION not set — source backend-go/.env.$TARGET first" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
LOCAL_GZ="$WORK_DIR/restore.sql.gz"
LOCAL_SQL="$WORK_DIR/restore.sql"

echo "[restore] downloading $SOURCE"
gcloud storage cp "$SOURCE" "$LOCAL_GZ"

echo "[restore] gunzipping"
gunzip "$LOCAL_GZ"

if [[ "$TARGET" == "prod" ]]; then
  echo "==============================================="
  echo "  ⚠️  ABOUT TO OVERWRITE PROD"
  echo "==============================================="
  echo "Connection: ${SUPABASE_DB_CONNECTION:0:50}..."
  read -p "Type 'RESTORE PROD' to proceed: " final
  if [[ "$final" != "RESTORE PROD" ]]; then
    echo "Aborted."
    rm -rf "$WORK_DIR"
    exit 1
  fi
fi

echo "[restore] dropping + recreating public schema"
psql "$SUPABASE_DB_CONNECTION" -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;"

echo "[restore] applying dump"
psql "$SUPABASE_DB_CONNECTION" < "$LOCAL_SQL"

rm -rf "$WORK_DIR"
echo "[restore] done — target=$TARGET"
```

  Acceptance: file written. Set executable: `chmod +x scripts/restore-from-backup.sh`.

- [ ] **Step 3: Commit both scripts**

```bash
chmod +x scripts/backup-prod.sh scripts/restore-from-backup.sh
git add scripts/backup-prod.sh scripts/restore-from-backup.sh
git commit -m "feat(backup): backup-prod and restore-from-backup wrapper scripts"
```

---

## Phase E — Restore drill

### Task 14: Take a manual snapshot via backup-prod.sh

- [ ] **Step 1: Source prod env and take a labelled snapshot**

```bash
cd backend-go && set -a && source .env && set +a && cd ..
./scripts/backup-prod.sh restore-drill
```

  Expected: script prints dump size + upload confirmation. Local copy ends up under `~/vosi-backups-local/`.

  Acceptance: `gcloud storage ls gs://vosi-backups/prod/manual/ | grep restore-drill` finds the new file.

---

### Task 15: Restore that snapshot to staging

- [ ] **Step 1: List recent manual snapshots**

```bash
gcloud storage ls -L gs://vosi-backups/prod/manual/ | tail -20
```

  Note the most recent `restore-drill` file path.

- [ ] **Step 2: Source staging env and restore**

```bash
cd backend-go && set -a && source .env.staging && set +a && cd ..
./scripts/restore-from-backup.sh \
  --source=gs://vosi-backups/prod/manual/<TS-restore-drill>.sql.gz \
  --target=staging
```

  Expected: script downloads, gunzips, drops `public`, restores. No interactive prompt for staging.

  Acceptance: script exits 0.

- [ ] **Step 3: Verify a few representative tables exist with data**

  Still in staging env:

```bash
psql "$SUPABASE_DB_CONNECTION" -c "SELECT COUNT(*) FROM stocks;"
psql "$SUPABASE_DB_CONNECTION" -c "SELECT COUNT(*) FROM orders;"
psql "$SUPABASE_DB_CONNECTION" -c "SELECT COUNT(*) FROM kasir_transactions;"
psql "$SUPABASE_DB_CONNECTION" -c "SELECT COUNT(*) FROM warehouses;"
```

  Expected: row counts match what's in prod for those tables. Staging now mirrors prod data (just for this drill — will be reset to schema-only next).

  Acceptance: counts > 0 and match prod ballpark.

- [ ] **Step 4: Reset staging back to schema-only**

  Staging is for migration dry-runs and should NOT hold real data day-to-day. Re-apply the schema-only dump from Task 2:

```bash
# Re-source PROD env to grab schema
cd backend-go && set -a && source .env && set +a && cd ..
pg_dump "$SUPABASE_DB_CONNECTION" --schema-only --no-owner --no-privileges --no-comments > /tmp/prod-schema-reset.sql

# Switch to staging env
cd backend-go && set -a && source .env.staging && set +a && cd ..
psql "$SUPABASE_DB_CONNECTION" -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;"
psql "$SUPABASE_DB_CONNECTION" < /tmp/prod-schema-reset.sql
```

  Acceptance: staging is back to schema-only (verify row counts now 0).

- [ ] **Step 5: No commit** — drill is verification, not source artifact. Outcome recorded in DR runbook (Task 17) and progress.md (Task 19).

---

## Phase F — Runbooks

### Task 16: Write deploy runbook

**Files:**
- Create: `docs/runbooks/deploy.md`

- [ ] **Step 1: Write the deploy runbook**

  Create `docs/runbooks/deploy.md`:

```markdown
# Deploy Runbook

**Audience:** Solo founder. Procedure for safely deploying code + migrations to prod.

## Off-peak window

Deploy to prod ONLY between **WIB 22:00 and 04:00** (Garindo closed window). Outside this window, deploy only to staging.

Rationale: Garindo runs an active kasir during business hours. A bad deploy (broken bundle, blocked RPC, slow query) means the toko cannot transact. Off-peak window contains blast radius to the founder's own troubleshooting time.

## Pre-deploy checklist

Before submitting a prod build, confirm:

1. **Code is committed and pushed.** No uncommitted changes in the working tree.
2. **Same code deployed to staging successfully** — submitted via `cloudbuild.staging.yaml` and `cloudbuild.frontend.staging.yaml` first.
3. **Smoke test passed on staging.** At minimum: app loads, login form renders, a representative API endpoint returns 200.
4. **If the change includes a migration**: applied + verified on staging, manual `backup-prod.sh` snapshot taken pre-prod.
5. **You are well-rested.** Don't deploy tired.

## Deploy procedure — frontend only

If the change is frontend-only (`src/` only, no `supabase/migrations/`, no `backend-go/`):

1. Submit staging build:

   ```bash
   gcloud builds submit \
     --config=cloudbuild.frontend.staging.yaml \
     --substitutions=_VITE_BACKEND_URL=...,_VITE_SUPABASE_URL=...,_VITE_SUPABASE_ANON_KEY=...
   ```

2. Test in browser at `https://vosi-app-staging-<hash>.a.run.app`.
3. Submit prod build (existing `cloudbuild.frontend.yaml`):

   ```bash
   gcloud builds submit --config=cloudbuild.frontend.yaml
   ```

4. Refresh `https://garindo-jaya-panel-msme-erp-422860632808.asia-southeast1.run.app` (or whatever the prod frontend URL is) and confirm change visible.

## Deploy procedure — backend only

If the change is backend-only (`backend-go/`, no migrations):

1. Submit staging build:

   ```bash
   gcloud builds submit --config=cloudbuild.staging.yaml --substitutions=...
   ```

2. Hit the staging `/healthz` and any changed endpoints.
3. Submit prod build (existing `cloudbuild.yaml`):

   ```bash
   gcloud builds submit --config=cloudbuild.yaml --substitutions=...
   ```

## Deploy procedure — with migration

This is the high-risk path.

1. **Take a pre-migration snapshot of prod**:

   ```bash
   cd backend-go && set -a && source .env && set +a && cd ..
   ./scripts/backup-prod.sh pre-<short-feature-name>
   ```

2. **Apply migrations to staging first**:

   ```bash
   cd backend-go && set -a && source .env.staging && set +a && cd ..
   ./scripts/apply-pending-migrations.sh --target=staging
   ```

3. **Run any spec-required smoke checks against staging** — e.g. run a representative query, deploy backend to staging, hit affected endpoints.

4. **Apply migrations to prod** (off-peak window only):

   ```bash
   cd backend-go && set -a && source .env && set +a && cd ..
   ./scripts/apply-pending-migrations.sh --target=prod
   # Script will prompt: type "PROD" to confirm.
   ```

5. **Deploy backend + frontend** as needed via the procedures above.

6. **Monitor for 30 minutes**: tail Cloud Run logs, watch for elevated error rates, check that Garindo's kasir page still works.

## Post-deploy quick checks

- `https://<prod-frontend>/` loads, login form visible.
- Backend `/healthz` returns 200.
- `psql "$SUPABASE_DB_CONNECTION" -c "SELECT NOW();"` returns within 100ms.
- No new errors in Cloud Run logs for the last 5 minutes:

  ```bash
  gcloud run services logs read garindo-jaya-panel-msme-erp --region=asia-southeast1 --limit=50
  ```

## If something is wrong

See `disaster-recovery.md`. For most cases:

1. **Rollback the Cloud Run revision** to the previous one:

   ```bash
   gcloud run revisions list --service=<service-name> --region=asia-southeast1
   gcloud run services update-traffic <service-name> --to-revisions=<previous-revision>=100 --region=asia-southeast1
   ```

2. If the migration is at fault: invoke restore-from-backup with `--target=prod --i-mean-it` using the pre-migration snapshot.

3. Communicate to wife (and to any paying tenants once you have them) within 15 minutes.
```

  Acceptance: file written.

- [ ] **Step 2: Commit the deploy runbook**

```bash
git add docs/runbooks/deploy.md
git commit -m "docs(runbook): off-peak deploy procedure for frontend / backend / migration paths"
```

---

### Task 17: Write disaster recovery runbook

**Files:**
- Create: `docs/runbooks/disaster-recovery.md`

- [ ] **Step 1: Write the DR runbook**

  Create `docs/runbooks/disaster-recovery.md`:

```markdown
# Disaster Recovery Runbook

**Audience:** Solo founder, at the moment something is on fire.

**Principles:**
- **Communicate first, fix second.** Tell wife (and once they exist, tenants) within 15 min. People forgive bugs they understand; silence breaks trust.
- **Don't panic-improvise.** Follow the matched scenario below.
- **Document the incident after.** Add a "incident" section to `progress.md` with timeline + root cause + mitigation. Lessons live there.

---

## Quick reference — who to contact

- **Wife** (Garindo owner): WhatsApp, immediate.
- **Supabase support**: https://supabase.com/dashboard → Project → Support. Response time on free tier is unspecified; on Pro tier ~24h.
- **GCP support**: https://console.cloud.google.com → Support. Free tier is best-effort.
- **Kominfo (Komdigi) — UU PDP breach notification**: TBD — verify current reporting URL when Vosi is registered as a controller. Required if confirmed personal-data breach (UU PDP Pasal 46 ayat 3, deadline 3×24 hours).

---

## Scenario 1 — Supabase project is down or unreachable

**Symptom:** Frontend shows network errors; backend `/healthz` returns 5xx; you cannot `psql` to the database.

**Steps:**

1. Check Supabase status page: https://status.supabase.com.
2. If incident on their side: post a banner in the app (manual — edit a `system_status` env var or commit a hardcoded banner). Tell wife. Wait. Supabase typically restores within 1-2 hours.
3. If incident is project-specific (not global): open a support ticket from the dashboard. While waiting, consider whether to restore from the most recent GCS backup to a **new** Supabase project as a stopgap. (This is a big decision — restoration takes 30-60 min, and you have to repoint Cloud Run env vars. Only do it if Supabase support is >2h away from resolution.)

---

## Scenario 2 — A migration corrupted prod data

**Symptom:** A migration has been applied to prod. Now: errors in app, missing data, broken FKs, or wrong results from queries.

**Steps:**

1. **Stop the bleeding.** If the app is throwing errors, deploy a Cloud Run revision rollback to the previous working revision:

   ```bash
   gcloud run revisions list --service=garindo-jaya-panel-msme-erp --region=asia-southeast1 | head -5
   gcloud run services update-traffic garindo-jaya-panel-msme-erp \
     --to-revisions=<previous-revision>=100 \
     --region=asia-southeast1
   ```

2. **Find the most recent pre-migration snapshot** (you should have taken one via `backup-prod.sh pre-<feature>` per the deploy runbook):

   ```bash
   gcloud storage ls -L gs://vosi-backups/prod/manual/ | tail -20
   ```

   If you forgot to take a manual snapshot, fall back to the most recent daily automated backup:

   ```bash
   gcloud storage ls -L gs://vosi-backups/prod/daily/ | tail -3
   ```

3. **Estimate data loss window.** Manual snapshot → loss = (snapshot_time → now). Daily backup → loss = up to 24h. Either way, write down the start time of the window and the affected tenant (Garindo, currently).

4. **Restore prod from the snapshot:**

   ```bash
   cd backend-go && set -a && source .env && set +a && cd ..
   ./scripts/restore-from-backup.sh \
     --source=gs://vosi-backups/prod/manual/<latest>.sql.gz \
     --target=prod \
     --i-mean-it
   # Script prompts: type "RESTORE PROD" to confirm.
   ```

5. **Tell wife the data-loss window.** She will need to manually re-enter any transactions that happened during it. Most kasir transactions have printed dotmatrix invoices — that's the source of truth for re-entry.

6. **Post-mortem:** what was the migration, why did it fail in prod when it passed in staging? Was staging actually mirroring prod schema? Was a non-idempotent statement run twice? Document in `progress.md` and update `apply-pending-migrations.sh` checklist if needed.

---

## Scenario 3 — Service-role key compromised or rotated

**Symptom:** You suspect the service-role key has leaked (committed to git accidentally, accessed by an ex-collaborator, etc.) OR Supabase is rotating it on schedule.

**Steps:**

1. **Generate a new service-role key** via Supabase dashboard:

   Project → Settings → API → "Reset service_role key". (This invalidates the old key immediately.)

2. **Update prod Cloud Run env vars** with the new key:

   ```bash
   gcloud run services update garindo-jaya-panel-msme-erp \
     --region=asia-southeast1 \
     --update-env-vars=SUPABASE_SERVICE_KEY=<new-key>
   ```

3. **Update local `backend-go/.env`** (don't commit).

4. **Update GCS Cloud Run Job env vars** (the backup job uses the DB connection string, NOT the service-role key, so the backup job itself isn't affected unless you rotated the DB password too).

5. **If the leak was via git**: also check whether anything was deployed using the compromised key by an attacker. Check Supabase dashboard logs for unusual queries. Consider rotating DB password too:

   Supabase dashboard → Settings → Database → "Reset database password".

   Then update every place that holds the old DB password (Cloud Run env vars, backup Cloud Run Job env vars, `.env` files).

6. **If personal data was potentially accessed**: this is a UU PDP breach — see Scenario 5 below for notification procedure.

---

## Scenario 4 — Migration script itself misbehaves

**Symptom:** `apply-pending-migrations.sh` fails midway, leaving the DB in an unknown state.

**Steps:**

1. **Don't re-run the script.** Find out where it stopped: the last `[apply]` line in stdout indicates the last migration attempted. The migration BEFORE that is the last that completed.

2. **Inspect the state of the DB** to see whether the failed migration partially applied. Check existence of objects the migration was supposed to create:

   ```bash
   psql "$SUPABASE_DB_CONNECTION" -c "\d <table_name_from_failed_migration>"
   ```

3. **If partial state exists:** manually roll back the partial changes (DROP what got created, restore what got modified) using the migration SQL as a guide. Or restore from pre-migration snapshot (Scenario 2 procedure).

4. **Fix the migration SQL** to be idempotent (use `IF NOT EXISTS`, `OR REPLACE`, `ON CONFLICT DO NOTHING`).

5. **Re-test on staging** — the whole reason staging exists.

---

## Scenario 5 — Confirmed personal-data breach (UU PDP Pasal 46 ayat 3)

**Definition (per UU PDP):** A breach is any unauthorised access, disclosure, alteration, or destruction of personal data. This includes (but is not limited to): leaked service-role key with confirmed access logs, RLS misconfiguration that allowed cross-tenant reads, accidental email of one tenant's data to another, etc.

**Deadline:** 3 × 24 hours from confirmed breach.

**Steps:**

| Time | Action |
|---|---|
| **T+0 (confirmed breach)** | Contain: revoke compromised credentials, take affected systems offline if needed. Start an incident log (timestamps + actions). |
| **T+0 to T+24h** | Investigate scope: which tenants, what data categories, how many records, attacker actions if any. Identify affected data subjects (tenants' customers if PII). |
| **T+24 to T+48h** | Notify affected tenants by email + WA (template TBD when ToS/DPA finalized). Tenants are controllers of their customers' PII — they then notify their data subjects. |
| **T+48 to T+72h** | File formal notification to Kominfo (Komdigi). Current reporting channel: see TODO below. Vosi will be the "processor" notifying the controller (tenant); tenant has separate obligation to Kominfo for their data subjects. |
| **T+72h+** | Public statement (only if breach is broadly relevant — e.g. multiple tenants). Technical post-mortem in `progress.md`. Mitigation plan to prevent recurrence. |

**TODO — verify before tenant #2 onboards:**

- Confirm Kominfo PDP reporting channel URL/email with lawyer. Currently best-known: https://aduankonten.id and https://patrolisiber.id — confirm which is the right channel for UU PDP Pasal 46 breach notification.
- Pre-draft breach notification email template (tenant-facing).
- Pre-draft Kominfo notification form content.

---

## Restore drill — must be performed at least quarterly

The disaster recovery procedure is only valid if the restore actually works. Schedule a quarterly drill:

1. Take a fresh `backup-prod.sh` manual snapshot.
2. Restore it to staging via `restore-from-backup.sh --target=staging`.
3. Verify row counts in a few representative tables.
4. Reset staging to schema-only after the drill.
5. Record drill date + outcome in `progress.md`.

If the drill fails, **stop other work and fix it.** The backup is the last line of defense.
```

  Acceptance: file written.

- [ ] **Step 2: Commit the DR runbook**

```bash
git add docs/runbooks/disaster-recovery.md
git commit -m "docs(runbook): disaster recovery — Supabase outage, migration corruption, key rotation, UU PDP Pasal 46 breach notification"
```

---

### Task 18: Finish the staging environment runbook

- [ ] **Step 1: Append day-to-day usage notes to staging runbook**

  The runbook skeleton from Task 1 already covers the most important parts. Append a "Recipes" section:

  Open `docs/runbooks/staging-environment.md` and add at the end:

```markdown

## Recipes

### Reset staging to schema-mirror-of-prod state

You should do this after any restore drill, or any time staging has been polluted with test data:

```bash
# Source PROD env
cd backend-go && set -a && source .env && set +a && cd ..
pg_dump "$SUPABASE_DB_CONNECTION" \
  --schema-only --no-owner --no-privileges --no-comments \
  > /tmp/prod-schema.sql

# Switch to STAGING env
cd backend-go && set -a && source .env.staging && set +a && cd ..
psql "$SUPABASE_DB_CONNECTION" -c \
  "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;"
psql "$SUPABASE_DB_CONNECTION" < /tmp/prod-schema.sql
```

### Dry-run a new migration

```bash
# Source STAGING env
cd backend-go && set -a && source .env.staging && set +a && cd ..

# Add your new migration filename to the MIGRATIONS array in
# scripts/apply-pending-migrations.sh first, then:
./scripts/apply-pending-migrations.sh --target=staging
```

### Smoke test staging frontend in browser

```bash
gcloud run services describe vosi-app-staging \
  --region=asia-southeast1 --format='value(status.url)'
```

Visit the URL printed. (You will need to create a test user in staging Supabase auth manually for login.)

### Check staging is healthy / not auto-paused

```bash
cd backend-go && set -a && source .env.staging && set +a && cd ..
psql "$SUPABASE_DB_CONNECTION" -c "SELECT NOW();"
```

If you get a connection error after a long idle period, the project may have auto-paused. Go to the Supabase dashboard and click "Restore project" — takes ~2 minutes.
```

  Acceptance: file updated.

- [ ] **Step 2: Commit the runbook update**

```bash
git add docs/runbooks/staging-environment.md
git commit -m "docs(runbook): staging environment recipes for reset, dry-run, smoke test"
```

---

## Phase G — Exit gate verification

### Task 19: End-to-end exit-gate verification

This task confirms all six Layer D-min exit-gate conditions from spec §4.1 are met.

- [ ] **Step 1: Verify "test migration on staging produces expected schema"**

  Take a fresh schema diff between staging and prod:

```bash
# Prod schema
cd backend-go && set -a && source .env && set +a && cd ..
pg_dump "$SUPABASE_DB_CONNECTION" --schema-only --no-owner --no-privileges --no-comments > /tmp/exit-prod.sql

# Staging schema
cd backend-go && set -a && source .env.staging && set +a && cd ..
pg_dump "$SUPABASE_DB_CONNECTION" --schema-only --no-owner --no-privileges --no-comments > /tmp/exit-staging.sql

diff /tmp/exit-prod.sql /tmp/exit-staging.sql | head -40
```

  Acceptance: diff is empty (or only cosmetic header lines).

- [ ] **Step 2: Verify "one end-to-end staging deploy performed"**

  Confirm both staging Cloud Run services are responding:

```bash
BACKEND_URL=$(gcloud run services describe garindo-jaya-panel-msme-erp-staging --region=asia-southeast1 --format='value(status.url)')
FRONTEND_URL=$(gcloud run services describe vosi-app-staging --region=asia-southeast1 --format='value(status.url)')

curl -fsS "$BACKEND_URL/healthz" || curl -fsS "$BACKEND_URL/"
curl -fsS "$FRONTEND_URL/" -o /dev/null && echo "frontend OK"
```

  Acceptance: both return HTTP 200.

- [ ] **Step 3: Verify "disaster recovery runbook written"**

  Run:

```bash
test -f docs/runbooks/disaster-recovery.md && wc -l docs/runbooks/disaster-recovery.md
test -f docs/runbooks/deploy.md && wc -l docs/runbooks/deploy.md
test -f docs/runbooks/staging-environment.md && wc -l docs/runbooks/staging-environment.md
```

  Acceptance: all three files exist with substantive content (>100 lines each).

- [ ] **Step 4: Verify "one rollback drill performed against staging"**

  Confirm that Task 15 completed (restore-from-backup successfully restored to staging). Visible via:

```bash
gcloud storage ls gs://vosi-backups/prod/manual/ | grep restore-drill
```

  And the local copy at `~/vosi-backups-local/*restore-drill*`.

  Acceptance: at least one `restore-drill` snapshot exists, and Task 15 was completed (recorded in progress.md in Step 6).

- [ ] **Step 5: Verify "DIY backup verified: daily pg_dump → GCS works"**

```bash
gcloud storage ls gs://vosi-backups/prod/daily/ | tail -3
gcloud scheduler jobs describe vosi-backup-prod-daily --location=asia-southeast1 --format='value(state,schedule)'
```

  Expected: at least 1 backup file in `prod/daily/`, scheduler state = `ENABLED`, schedule = `0 15 * * *`.

  Acceptance: both pass.

- [ ] **Step 6: Record Layer D-min completion in progress.md**

  Prepend a new section at the top of `progress.md`:

```markdown
## 2026-MM-DD — Layer D-min: staging environment + DIY backup — DONE

- **What:** First layer of multi-tenant prereq implementation (spec §4.1) complete. Staging Supabase project + Cloud Run services live, migrations gain `--target=staging|prod` flag with prod safety gate, daily DIY backup automated via Cloud Run Job + Scheduler, restore drill verified, three runbooks written.
- **Artifacts:**
  - Staging: Supabase project `vosi-staging`, Cloud Run services `garindo-jaya-panel-msme-erp-staging` + `vosi-app-staging`.
  - Backup: GCS bucket `vosi-backups` with 7-day lifecycle on `prod/daily/`; Cloud Run Job `vosi-backup-prod` triggered daily at WIB 22:00 by Cloud Scheduler `vosi-backup-prod-daily`.
  - Code: `scripts/apply-pending-migrations.sh` (--target flag), `scripts/backup-prod.sh`, `scripts/restore-from-backup.sh`, `backup-job/{Dockerfile,backup.sh}`, `cloudbuild.staging.yaml`, `cloudbuild.frontend.staging.yaml`, `cloudbuild.backup-job.yaml`.
  - Runbooks: `docs/runbooks/deploy.md`, `docs/runbooks/disaster-recovery.md`, `docs/runbooks/staging-environment.md`.
- **Exit gate verified:** all 6 conditions from spec §4.1 confirmed (schema parity, staging smoke deploy, runbooks written, rollback drill, daily backup running, restore drill succeeded).
- **Did NOT do (per spec):** Supabase Pro tier upgrade (stays on free tier until first paying tenant per spec §8.5 approval rule). Feature flags / canary / per-tenant maintenance windows (Layer D-full).
- **Next:** Layer A (tenant foundation) — invoke writing-plans for the long-pole layer once user approves D-min completion.
```

  Replace `2026-MM-DD` with the actual completion date.

- [ ] **Step 7: Commit the progress note**

```bash
git add progress.md
git commit -m "docs(progress): Layer D-min complete — staging + DIY backup + runbooks"
```

---

## Plan complete

After completing Task 19, Layer D-min is shipped:
- Staging environment ready for Layer A migration dry-runs.
- Daily DIY backup running with 7-day retention.
- Restore drill verified.
- Three runbooks documented.
- Migration script defaults to staging with prod safety gate.

Total commits expected: ~12 (one per task that produces code/docs; operator-only tasks don't commit).

**Next:** Invoke `writing-plans` skill for **Layer A** (tenant foundation) — the long-pole layer with composite FK + RLS + ~40 migrations.
