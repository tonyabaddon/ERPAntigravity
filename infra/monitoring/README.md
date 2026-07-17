# Caleo ERP — Monitoring Baseline

Created: 2026-07-17 (Task 10 R2)
GCP project: `gen-lang-client-0410251117`

## Overview

7 alert policies, 2 uptime checks, 4 log-based metrics, 1 email notification channel.
All components are within GCP free tier ($0/month).

Derived from incidents in `docs/incidents/2026-07-17-phase2-silent-deploy-failures.md`.

---

## Resource inventory

### Notification channel

| Display name | Type | Channel ID |
|---|---|---|
| Founder email — Tony | email | `14760023346272465972` |

Full resource name: `projects/gen-lang-client-0410251117/notificationChannels/14760023346272465972`

**IMPORTANT**: GCP sends a verification email to `tonywei.office@gmail.com`.
Check Gmail (and spam folder) for the verification link. Alerts fire immediately but
delivery is blocked until the email is verified.

### Log-based metrics

| Name | Filter | Alert |
|---|---|---|
| `cloud_build_failure_count` | `resource.type="build" severity=ERROR` | Alert 1 |
| `worker_jobs_error_count` | `resource.type="cloud_run_revision" jsonPayload.message=~"^\[JOBS\]" severity>=ERROR` | Alert 2 |
| `db_pool_saturation_count` | `resource.type="cloud_run_revision" jsonPayload.message=~"remaining connection slots"` | Alert 3 |
| `container_startup_failure_count` | `resource.type="cloud_run_revision" severity=ERROR textPayload=~"STARTUP HTTP probe failed"` | Alert 7 |

### Uptime checks

| Display name | Host | Path | Period | Check ID |
|---|---|---|---|---|
| Backend /api/v1/live | `garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app` | `/api/v1/live` | 60s | `backend-api-v1-live-406wNLiEo3Y` |
| Frontend app.caleo.id root | `app.caleo.id` | `/` | 60s | `frontend-app-caleo-id-root-_iGNn-hDUWQ` |

### Alert policies

| # | Display name | Policy ID | Signal | Threshold |
|---|---|---|---|---|
| 1 | Cloud Build — Any failure | `3513268992898920888` | Log metric | >0 in 5min |
| 2 | Worker [JOBS] error loop | `3513268992898922236` | Log metric | >5 in 5min |
| 3 | DB pool exhaustion | `10447675440075449288` | Log metric | >0 in 5min |
| 4 | Backend /api/v1/live down | `6916839861586647468` | Uptime check | 2 consecutive fails |
| 5 | Frontend app.caleo.id down | `10447675440075448541` | Uptime check | 2 consecutive fails |
| 6 | Cloud Run 5xx rate spike | `3513268992898923318` | Built-in Cloud Run metric | >5 in 5min |
| 7 | Container startup failure | `10447675440075448834` | Log metric | >0 in 10min |

---

## Verify (list all)

```bash
# All 7 alert policies
gcloud alpha monitoring policies list \
  --project=gen-lang-client-0410251117 \
  --format="table(displayName,enabled,combiner)"

# All 2 uptime checks
gcloud monitoring uptime list-configs \
  --project=gen-lang-client-0410251117 \
  --format="table(displayName,monitoredResource.type,period)"

# All 4 log metrics
gcloud logging metrics list \
  --project=gen-lang-client-0410251117 \
  --format="table(name,description)"

# Notification channel
gcloud alpha monitoring channels list \
  --project=gen-lang-client-0410251117 \
  --format="table(displayName,type,enabled)"
```

---

## Rollback (per-resource)

```bash
# Delete an alert policy
gcloud alpha monitoring policies delete <POLICY_ID> \
  --project=gen-lang-client-0410251117

# Delete an uptime check
gcloud monitoring uptime delete <UPTIME_CHECK_ID> \
  --project=gen-lang-client-0410251117

# Delete a log-based metric
gcloud logging metrics delete <METRIC_NAME> \
  --project=gen-lang-client-0410251117

# Delete notification channel
# (remove all alert policies referencing it first)
gcloud alpha monitoring channels delete <CHANNEL_ID> \
  --project=gen-lang-client-0410251117
```

### Full rollback (all resources)

```bash
PROJECT=gen-lang-client-0410251117

# Delete 7 alert policies
for ID in 3513268992898920888 3513268992898922236 10447675440075449288 \
           6916839861586647468 10447675440075448541 3513268992898923318 \
           10447675440075448834; do
  gcloud alpha monitoring policies delete $ID --project=$PROJECT --quiet
done

# Delete 2 uptime checks
gcloud monitoring uptime delete backend-api-v1-live-406wNLiEo3Y --project=$PROJECT --quiet
gcloud monitoring uptime delete "frontend-app-caleo-id-root-_iGNn-hDUWQ" --project=$PROJECT --quiet

# Delete 4 log metrics
for M in cloud_build_failure_count worker_jobs_error_count db_pool_saturation_count container_startup_failure_count; do
  gcloud logging metrics delete $M --project=$PROJECT --quiet
done

# Delete notification channel
gcloud alpha monitoring channels delete 14760023346272465972 --project=$PROJECT --quiet
```

---

## Re-apply (from YAML files in this directory)

```bash
PROJECT=gen-lang-client-0410251117

# Log metrics
gcloud logging metrics create cloud_build_failure_count \
  --description="Count of Cloud Build FAILURE events (any build trigger)" \
  --log-filter='resource.type="build" severity=ERROR' \
  --project=$PROJECT

gcloud logging metrics create worker_jobs_error_count \
  --description="[JOBS] worker errors from Cloud Run backend (excludes WA HEARTBEAT/FOLLOWUP noise)" \
  --log-filter='resource.type="cloud_run_revision" jsonPayload.message=~"^\[JOBS\]" severity>=ERROR' \
  --project=$PROJECT

gcloud logging metrics create db_pool_saturation_count \
  --description="Supabase connection pool exhaustion (pq: remaining connection slots)" \
  --log-filter='resource.type="cloud_run_revision" jsonPayload.message=~"remaining connection slots"' \
  --project=$PROJECT

gcloud logging metrics create container_startup_failure_count \
  --description="Cloud Run container startup probe failures (STARTUP HTTP probe failed)" \
  --log-filter='resource.type="cloud_run_revision" severity=ERROR textPayload=~"STARTUP HTTP probe failed"' \
  --project=$PROJECT

# Uptime checks
gcloud monitoring uptime create "Backend /api/v1/live" \
  --resource-type=uptime-url \
  --resource-labels="host=garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app,project_id=$PROJECT" \
  --path=/api/v1/live --port=443 --protocol=https --validate-ssl=true \
  --period=1 --timeout=10 --project=$PROJECT

gcloud monitoring uptime create "Frontend app.caleo.id root" \
  --resource-type=uptime-url \
  --resource-labels="host=app.caleo.id,project_id=$PROJECT" \
  --path=/ --port=443 --protocol=https --validate-ssl=true \
  --period=1 --timeout=10 --project=$PROJECT

# Alert policies (update channel ID and uptime check IDs in YAMLs first)
for YAML in alert-policies/alert-{1,2,3,4,5,6,7}-*.yaml; do
  gcloud alpha monitoring policies create --policy-from-file="$YAML" --project=$PROJECT
done
```

---

## Filter verification notes (from 2026-07-17 sampling)

Critical corrections from live log sampling (R2 task spec had wrong field names):

| Alert | Task spec filter | Actual filter (verified) | Change reason |
|---|---|---|---|
| 2 (worker JOBS) | `jsonPayload.msg=~"^\[JOBS\]"` | `jsonPayload.message=~"^\[JOBS\]"` | Go backend logs to `message`, not `msg` |
| 3 (DB pool) | `jsonPayload.error=~"53300"` + `severity>=ERROR` | `jsonPayload.message=~"remaining connection slots"` (no severity filter) | Pool errors log at `jsonPayload.message` at severity=INFO |
| 7 (startup) | `textPayload=~"startup probe"` (lowercase) | `textPayload=~"STARTUP HTTP probe failed"` + `severity=ERROR` | Actual text is UPPERCASE; failures are at ERROR, successes at INFO |

---

## Cost

| Component | Count | Free tier | Monthly cost |
|---|---|---|---|
| Alert policies | 7 | Free | $0 |
| Uptime checks | 2 of 100 | 100/month free | $0 |
| Log-based metrics | 4 | Free (log ingestion <1GB/month) | $0 |
| Cloud Run built-in metrics (Alert 6) | 1 | Free (auto-collected) | $0 |
| Email notification channel | 1 | Free | $0 |
| **Total** | | | **$0** |
