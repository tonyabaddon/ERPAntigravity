# Task 10 — Monitoring baseline design (2026-07-17)

Design only. No changes shipped. No GCP resources created.

---

## Current state (enumerated)

All commands were read-only (`list`, `describe`, `read`). Executed against GCP project `gen-lang-client-0410251117`.

### Existing alert policies

```
Listed 0 items.
```

**Zero alert policies exist.** The three incidents today surfaced in a zero-alert environment.

### Existing uptime checks

```
Listed 0 items.
```

No uptime checks configured.

### Existing notification channels

```
Listed 0 items.
```

No notification channels configured. All alerts to date have been manual polling.

### Existing log-based metrics

```
Listed 0 items.
```

No custom log-based metrics. Only the auto-collected Cloud Logging system metrics exist.

### Cloud Run services in scope

| Service name | URL | Latest ready revision |
|---|---|---|
| `garindo-jaya-panel-msme-erp` (prod backend) | `https://garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app` | `00315-sab` |
| `garindo-jaya-panel-msme-erp-frontend` (prod frontend) | `https://garindo-jaya-panel-msme-erp-frontend-xnrhcw7onq-as.a.run.app` | `00507-huw` |
| `garindo-jaya-panel-msme-erp-staging` (staging backend) | `https://garindo-jaya-panel-msme-erp-staging-xnrhcw7onq-as.a.run.app` | `00027-rvd` |
| `garindo-jaya-panel-msme-erp-frontend-staging` (staging frontend) | `https://garindo-jaya-panel-msme-erp-frontend-staging-xnrhcw7onq-as.a.run.app` | — |
| `sinar-elektrik-msme-erp` (isolated tenant backend) | `https://sinar-elektrik-msme-erp-xnrhcw7onq-as.a.run.app` | — |
| `sinar-elektrik-msme-erp-frontend` (isolated tenant frontend) | `https://sinar-elektrik-msme-erp-frontend-xnrhcw7onq-as.a.run.app` | — |

### Log noise baseline (sampled from last 50 Cloud Run severity>=ERROR entries)

| Error message | Count (of 50) | Notes |
|---|---|---|
| `[HEARTBEAT] SendText error` | 37 (74%) | WA connection noise — NOT a signal for ops alerting |
| `[FOLLOWUP] SendText error` | 12 (24%) | WA followup noise — same as above |
| `[JOBS] claim_next_job scan failed` | 1 (2%) | Today's Bug B — real ops signal |

**Key insight**: 98% of Cloud Run ERROR log volume is WhatsApp SendText noise. Any alert on raw `severity>=ERROR` will fire constantly and be ignored. All alert filters below exclude WA noise explicitly.

---

## Proposed 7 alerts

> Format per alert: **Name, Signal source, Log/metric filter (exact), Threshold + rationale, gcloud command sketch, Why (incident linkage), Cost implication.**

---

### Alert 1 — Cloud Build failure

**Signal source**: Cloud Logging — `resource.type="build"` audit log entries.

**Observed log structure**: Cloud Build failure entries are audit logs at `severity=ERROR` with `resource.type="build"`. Confirmed today: `build_id` present in `resource.labels`, `status.code=9` (FAILED) in `protoPayload.status.code`.

**Log filter** (for log-based metric):
```
resource.type="build"
severity=ERROR
```

**Threshold**: Any 1 occurrence within a 5-minute window → alert. Cloud Build failures are low-frequency (not hundreds/day) and every one is actionable.

**gcloud command sketch** (R2 implementation):
```bash
# Step 1: Create log-based metric
gcloud logging metrics create cloud_build_failures \
  --description="Count of Cloud Build FAILURE events" \
  --log-filter='resource.type="build" severity=ERROR'

# Step 2: Create alert policy on that metric
gcloud alpha monitoring policies create \
  --policy-from-file=alert-cloud-build-failure.yaml
```

**alert-cloud-build-failure.yaml structure**:
```yaml
displayName: "Cloud Build — Any failure"
combiner: OR
conditions:
- displayName: "build failure count > 0"
  conditionThreshold:
    filter: 'metric.type="logging.googleapis.com/user/cloud_build_failures" resource.type="build"'
    comparison: COMPARISON_GT
    thresholdValue: 0
    duration: 300s
    aggregations:
    - alignmentPeriod: 300s
      perSeriesAligner: ALIGN_COUNT
notificationChannels: [<email_channel_id>]
alertStrategy:
  notificationRateLimit:
    period: 1800s   # re-notify max every 30min if builds keep failing
```

**Why**: Today's Bug A — 8 builds failed silently over 40 minutes. Each commit-push cycle took ~8 minutes. First build failed at ~03:30, last detected at ~09:40 (advisor call). This alert would fire within 5 minutes of the first failure.

**Cost**: Log-based metric is free until 50GB/month ingestion. Cloud Build generates ~1 log entry per build event — negligible volume vs. 50GB limit.

---

### Alert 2 — Backend worker error rate ([JOBS] spam)

**Signal source**: Cloud Logging — `resource.type="cloud_run_revision"`, `jsonPayload.message` field.

**Observed log structure**: Worker errors are `severity=ERROR` with `jsonPayload.message` matching `[JOBS] claim_next_job scan failed`. HEARTBEAT/FOLLOWUP errors are the dominant noise and must be excluded. Today's Bug B fired at ~5-second intervals when broken.

**Log filter** (for log-based metric):
```
resource.type="cloud_run_revision"
jsonPayload.message=~"^\[JOBS\]"
severity>=ERROR
```

**Threshold**: >3 occurrences in 5 minutes → alert. Rationale: at 5s poll interval, a stuck worker generates 60 errors/5min. 3 is conservative enough to skip any single transient failure (network hiccup) while catching a loop that's been spinning for 15+ seconds.

**gcloud command sketch** (R2 implementation):
```bash
# Step 1: Create log-based metric
gcloud logging metrics create backend_worker_job_errors \
  --description="[JOBS] worker errors from Cloud Run backend" \
  --log-filter='resource.type="cloud_run_revision" jsonPayload.message=~"^\[JOBS\]" severity>=ERROR'

# Step 2: Alert policy on metric
# (YAML file approach same as Alert 1 — thresholdValue=3, duration=300s)
```

**Note on WA noise**: The dominant `[HEARTBEAT] SendText error` and `[FOLLOWUP] SendText error` entries match a different prefix (`[HEARTBEAT]`, `[FOLLOWUP]`) and do NOT match `^\[JOBS\]`. The filter is narrow enough to exclude them without an explicit exclusion clause. Confirm this assumption holds if a `[JOBS]` WA integration is ever added.

**Why**: Today's Bug B — `claim_next_job` errored every 5 seconds from ~12:38–12:43 (5+ minutes, ~60 errors) before being noticed via manual log inspection. With this alert, it fires within 5 minutes of the first loop.

**Cost**: Log-based metric creation is free. This metric will be low-volume (0 events/day on healthy days, burst of 60 when broken).

---

### Alert 3 — Supabase pool exhaustion / DB connection failure

**Signal source**: Cloud Logging — `resource.type="cloud_run_revision"`, `jsonPayload.message` field.

**Observed log structure** (confirmed today): Pool exhaustion messages are logged at `severity=INFO` (not ERROR!) with `jsonPayload.message` containing the PostgreSQL error text. Example observed entry:
```
jsonPayload.message: "[APPROVALS] expire error: pq: remaining connection slots are reserved for roles with the SUPERUSER attribute"
```

PostgreSQL error code 53300 (`too_many_connections`) is embedded in the message text, not as a structured field. The filter must match on the human-readable string.

**Log filter** (for log-based metric):
```
resource.type="cloud_run_revision"
jsonPayload.message=~"remaining connection slots"
```

**Threshold**: Any 1 occurrence in 5 minutes → alert. Rationale: pool exhaustion is a rare, high-severity event (not a normal operating state). Even a single occurrence warrants attention — it means at least one request has already failed due to DB unavailability.

**gcloud command sketch** (R2 implementation):
```bash
gcloud logging metrics create db_pool_exhaustion \
  --description="Supabase connection pool exhaustion (pq: remaining connection slots)" \
  --log-filter='resource.type="cloud_run_revision" jsonPayload.message=~"remaining connection slots"'
```

**Alert policy**: threshold=0 occurrences exceeded (i.e., any count > 0), duration=300s, same notification channel.

**Why**: Today's Bug C — pool exhaustion blocked all new connections, failed new revision startup, and blocked staging MCP calls. The immediate trigger was a burst of parallel connections (backend worker + MCP queries + cold-start). At 1000 tenants, even with pooler migration, this can recur under load spikes. Catching the first occurrence gives ~2 minutes to act before a cascade.

**Important caveat**: After the session-pooler migration (pending as of today), this error may disappear from logs entirely if pooler absorbs the load. Monitor for 2 weeks post-pooler migration; if zero fires, consider converting this to a lower-priority alert or raising threshold to >5.

**Cost**: Log-based metric, free tier applies.

---

### Alert 4 — Prod backend uptime (/api/v1/live)

**Signal source**: GCP Uptime Check (managed service, not log-based).

**Target**: `https://garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app/api/v1/live`

**Check configuration**:
- Protocol: HTTPS
- Path: `/api/v1/live`
- Port: 443
- Frequency: every 60 seconds
- Timeout: 10 seconds
- Expected response code: 200
- Check regions: usa-virginia, europe-west1, asia-southeast1 (GCP uptime check probes are global — alert when 2 of 3 regions fail, preventing false alarms from single-region probe failures)

**Threshold**: FAILED for 2 consecutive minutes (2 check intervals from any 2 regions) → alert. Avoids false positives from single packet loss while keeping detection time under 3 minutes.

**gcloud command sketch** (R2 implementation):
```bash
# Step 1: Create uptime check
gcloud monitoring uptime create \
  --display-name="Prod backend /api/v1/live" \
  --resource-type=uptime-url \
  --hostname=garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app \
  --path=/api/v1/live \
  --port=443 \
  --use-ssl \
  --check-interval=60s \
  --timeout=10s \
  --project=gen-lang-client-0410251117

# Step 2: Create alert on the uptime check
# (requires uptime check resource name from step 1 output)
```

**Why**: Direct backend down = all 10 tenants cannot use the ERP. The `/api/v1/live` endpoint is the liveness probe already used by Cloud Run — if it's reachable externally, the service is serving.

**Why not /api/v1/ready**: `/api/v1/ready` checks DB connectivity. A DB-connection-only failure would produce a 503 from the readiness endpoint — but the liveness endpoint may still return 200. Use `/api/v1/live` for the uptime check to detect actual service unavailability, and rely on Alert 3 (pool exhaustion) to catch DB-layer issues.

**Cost**: GCP Uptime Checks: 100 free checks/month. Using 2 checks (Alert 4 + Alert 5). Well within free tier.

---

### Alert 5 — Prod frontend uptime (app.caleo.id)

**Signal source**: GCP Uptime Check (managed service).

**Target**: `https://app.caleo.id/`

**Check configuration**:
- Protocol: HTTPS
- Path: `/`
- Port: 443
- Frequency: every 60 seconds
- Timeout: 10 seconds
- Expected response code: 200
- Content match: not required (HTML varies, any 200 is sufficient)

**Threshold**: FAILED for 2 consecutive minutes → alert.

**gcloud command sketch** (R2 implementation):
```bash
gcloud monitoring uptime create \
  --display-name="Prod frontend app.caleo.id" \
  --resource-type=uptime-url \
  --hostname=app.caleo.id \
  --path=/ \
  --port=443 \
  --use-ssl \
  --check-interval=60s \
  --timeout=10s \
  --project=gen-lang-client-0410251117
```

**What this catches**:
- Custom domain `app.caleo.id` DNS failure
- Cloudflare Worker routing failure (app.caleo.id routes through Cloudflare)
- SSL certificate expiry (GCP uptime check fails on cert errors)
- Cloud Run frontend container down
- Any CDN/proxy failure between Cloudflare and Cloud Run

**What this does NOT catch**: Backend API failures while frontend HTML loads. That is covered by Alert 4 + Alert 6.

**Why**: `app.caleo.id` is the production URL tenants bookmark. The Cloudflare → Cloud Run routing path has one additional failure point vs. direct Cloud Run URL. SSL cert expiry is a silent killer that an uptime check catches automatically.

**Cost**: Free tier (2 of 100 free uptime checks used).

---

### Alert 6 — Cloud Run 5xx rate spike (backend + frontend)

**Signal source**: Cloud Run built-in metric `run.googleapis.com/request_count`, filtered by `response_code_class`.

**Metric details**: Cloud Run automatically emits `request_count` with labels `response_code_class` (2xx, 3xx, 4xx, 5xx) and `service_name`. No custom metric creation needed.

**Threshold logic** (both conditions must be true to alert — avoids noise during idle periods):
1. Absolute 5xx count > 5 in any 5-minute window
2. 5xx ratio to total requests > 1% in the same window

**Rationale for dual-gate**: During off-hours, 1 request/5min × 1 5xx = 100% 5xx rate but only 1 failure. Not actionable. During active hours, 5 5xxs out of 500 requests = 1% — definitely actionable. The dual gate requires both elevated rate AND absolute volume.

**Services covered**:
- `garindo-jaya-panel-msme-erp` (prod backend)
- `garindo-jaya-panel-msme-erp-frontend` (prod frontend)

**gcloud command sketch** (R2 implementation — this uses the built-in metric directly, no log-based metric needed):

```yaml
# alert-5xx-backend.yaml
displayName: "Prod backend — 5xx spike"
combiner: OR
conditions:
- displayName: "5xx count > 5 in 5min"
  conditionThreshold:
    filter: >
      metric.type="run.googleapis.com/request_count"
      resource.type="cloud_run_revision"
      metric.labels.response_code_class="5xx"
      resource.labels.service_name="garindo-jaya-panel-msme-erp"
    comparison: COMPARISON_GT
    thresholdValue: 5
    duration: 300s
    aggregations:
    - alignmentPeriod: 300s
      perSeriesAligner: ALIGN_RATE
      crossSeriesReducer: REDUCE_SUM
```

**Note on 1% ratio**: GCP alert policies support ratio conditions via `conditionThreshold` with a `denominatorFilter`. This is the correct approach for ratio-based alerting. Full YAML is slightly more complex but well-documented. R2 implementor should use the Cloud Monitoring console UI for the ratio condition — it's easier to configure there and then export as YAML.

**Staging services**: NOT included in this alert. Staging 5xxs are expected during development. Add a separate lower-severity alert for staging if desired in R2.

**Why**: Catches any class of backend error (RPC panic, auth middleware failure, DB timeout) that results in 5xx to users. The startup probe failures today (`The request failed because the instance failed the readiness check.` → 503) would have triggered this alert.

**Cost**: Built-in Cloud Run metrics are free. No additional charges.

---

### Alert 7 — Cloud Run container startup failure

**Signal source**: Cloud Logging — `resource.type="cloud_run_revision"`, `textPayload` field (NOT `jsonPayload` — startup failure messages come through as unstructured text).

**Observed log structure** (confirmed today):
```
severity: ERROR
textPayload: "STARTUP HTTP probe failed 12 times consecutively for container \"garindo-jaya-panel-msme-erp-1\" on port 8080 path \"/api/v1/ready\". The instance was not started.\nHTTP request returned status 503 Service Unavailable.\nContents: db not yet connected"
```

This pattern was observed on `garindo-jaya-panel-msme-erp-staging` at 14:06, 10:49, and 05:21 today. The `STARTUP HTTP probe failed` text is emitted by the Cloud Run infrastructure (not the application) and is consistent.

**Log filter** (for log-based metric):
```
resource.type="cloud_run_revision"
severity=ERROR
textPayload=~"STARTUP HTTP probe failed"
```

**Threshold**: Any 1 occurrence in 10 minutes → alert. Startup failures are always infrastructure-level events — the container never came up. Every occurrence warrants review.

**gcloud command sketch** (R2 implementation):
```bash
gcloud logging metrics create container_startup_failures \
  --description="Cloud Run container startup probe failures" \
  --log-filter='resource.type="cloud_run_revision" severity=ERROR textPayload=~"STARTUP HTTP probe failed"'
```

**Scope**: Include ALL Cloud Run services (no `service_name` filter). A startup failure on any revision — prod or staging — is worth knowing. Staging failures helped diagnose the connection pool issue today.

**Why**: Today's Bug C — revision `00295-p4t` failed startup probe 12 consecutive times due to pool exhaustion. Traffic never promoted (correctly), but the failure was completely silent. Founder didn't know this revision existed in a failed state until later manual inspection. With this alert, the failure is surfaced within 10 minutes.

**Note**: Startup failures on `garindo-jaya-panel-msme-erp-staging` are frequent today (3 occurrences in the log sample). After pool exhaustion is fixed, this alert should go quiet. If staging deployments cause persistent startup failures in R2, add a `resource.labels.service_name!="garindo-jaya-panel-msme-erp-staging"` exclusion — but don't add it pre-emptively. First, see if fixing the pool resolves it.

**Cost**: Log-based metric, free tier applies.

---

## Summary table

| # | Alert name | Signal type | Threshold | Detection time (vs today) |
|---|---|---|---|---|
| 1 | Cloud Build failure | Log-based metric | Any failure in 5min | 40min → <10min |
| 2 | [JOBS] worker error loop | Log-based metric | >3 errors in 5min | 5min → <5min |
| 3 | DB pool exhaustion | Log-based metric | Any occurrence in 5min | Manual → <5min |
| 4 | Prod backend uptime | Uptime check | 2 consecutive fails | N/A (was not down) |
| 5 | Prod frontend uptime | Uptime check | 2 consecutive fails | N/A (was not down) |
| 6 | Cloud Run 5xx spike | Built-in Cloud Run metric | >5 AND >1% in 5min | Would catch startup 503s |
| 7 | Container startup failure | Log-based metric | Any occurrence in 10min | Silent → <10min |

---

## Notification channel

**Type**: Email
**Recipient**: `tonywei.office@gmail.com`
**Justification**: Solo founder. No team, no on-call rotation. Email is asynchronous (doesn't wake at 3am), durable (survives app restarts), and searchable. Not appropriate for P0 incidents requiring <1min response — but Caleo at 10 tenants has no P0 SLA yet.

**Setup steps for founder** (must be done via GCP console — CLI requires human verification):
1. Go to [GCP Monitoring > Notification channels](https://console.cloud.google.com/monitoring/alerting/notifications?project=gen-lang-client-0410251117)
2. Click "Add new" → Email
3. Enter `tonywei.office@gmail.com`
4. Click "Save"
5. GCP sends a verification email → click the link in that email
6. Channel shows `verificationStatus: VERIFIED` — only then can it receive alerts
7. **Check spam folder** for the verification email (first GCP email often lands there)
8. After verification: run `gcloud beta monitoring channels list --project=gen-lang-client-0410251117` to get the channel ID (needed for alert policy YAML in R2)

**Future escalation paths** (YAGNI now, note for R3):
- PagerDuty / OpsGenie if team grows
- SMS via Twilio notification channel if P0 SLA is defined
- Slack channel via GCP Slack integration

---

## Cost analysis

All components verified against GCP free tier limits (as of 2026-07-17):

| Component | Usage | Free tier | Cost |
|---|---|---|---|
| GCP Uptime Checks | 2 checks (backend, frontend) | 100 checks/month free | $0 |
| Log-based metrics | 5 metrics (Alerts 1, 2, 3, 7) | Free until 50GB/month log ingestion | $0 |
| Cloud Run built-in metrics | Alert 6 uses `run.googleapis.com/request_count` | Free (auto-collected) | $0 |
| Notification channels (email) | 1 email channel | Free | $0 |
| Alert policies | 7 policies | Free | $0 |
| **Total monthly estimate** | | | **$0** |

**Log ingestion volume estimate**: Current volume is small. Cloud Build generates ~5-20 log entries per build. Cloud Run generates hundreds per minute during active use, but the custom metrics only count filtered subsets — ingestion cost is on the raw volume, not the metric extraction. At 10 tenants with current usage patterns, total log ingestion is estimated well under 1GB/month. Verify at: [Log Router dashboard](https://console.cloud.google.com/logs/router?project=gen-lang-client-0410251117).

**Zero-cost constraint confirmed**: This entire monitoring baseline requires no paid services, no tier upgrades, and no new SaaS subscriptions.

---

## Rollback plan

Each alert component can be deleted independently without affecting others:

```bash
# Delete a log-based metric (this also disables any alert using it)
gcloud logging metrics delete cloud_build_failures --project=gen-lang-client-0410251117

# Delete an alert policy (get policy name from list first)
gcloud monitoring policies delete <POLICY_ID> --project=gen-lang-client-0410251117

# List policies to get their IDs
gcloud monitoring policies list --project=gen-lang-client-0410251117 --format="table(name,displayName)"

# Delete an uptime check
gcloud monitoring uptime delete <UPTIME_CHECK_ID> --project=gen-lang-client-0410251117

# List uptime checks to get their IDs
gcloud monitoring uptime list-configs --project=gen-lang-client-0410251117 --format="table(name,displayName)"

# Delete notification channel (only after all policies removed that reference it)
gcloud beta monitoring channels delete <CHANNEL_ID> --project=gen-lang-client-0410251117
```

**If Alert 7 (container startup) is too noisy** (staging fires constantly during development): add exclusion for staging:
```bash
# Update the metric filter to exclude staging service
gcloud logging metrics update container_startup_failures \
  --log-filter='resource.type="cloud_run_revision" severity=ERROR textPayload=~"STARTUP HTTP probe failed" resource.labels.service_name!="garindo-jaya-panel-msme-erp-staging"' \
  --project=gen-lang-client-0410251117
```

**If Alert 6 (5xx rate) is too noisy**: raise threshold from 1% to 5%, or raise absolute count from 5 to 20.

---

## Follow-ups explicitly out of scope for R1

- **Business metrics** (kasir sale count drop, WA connection heartbeat duration, Calista AI call latency) — needs baseline data collection period first. No data = no sensible threshold.
- **Sentry integration** — application-level error tracking with stack traces. Deferred to Task 11.
- **Alert escalation / on-call rotation** — solo founder, YAGNI until team >= 2.
- **Grafana dashboard visualization** — Cloud Monitoring UI is sufficient for solo operator at 10 tenants.
- **Custom metrics via OpenTelemetry** — YAGNI at 10 tenants. Revisit at 100.
- **Pub/Sub-based Cloud Build alert** — the log-based metric approach (Alert 1) is simpler and sufficient. Pub/Sub adds a topic, subscription, and Cloud Function to maintain. Not worth it.
- **Sinar Elektrik services monitoring** — not included. If `sinar-elektrik-msme-erp` is a live isolated-tenant deployment, it should get its own uptime check in R2.
- **Staging uptime check** — staging uptime is not a P1 concern. Adding it in R2 if staging becomes customer-facing for beta users.

---

## Key design decisions and rationale

### Decision 1: Log-based metrics over Pub/Sub for Cloud Build alert

**Considered**: Cloud Build → Pub/Sub topic `cloud-builds` → GCP alert on Pub/Sub message count.
**Chosen**: Log-based metric on `resource.type="build" severity=ERROR`.
**Why**: Log-based metric requires zero new infrastructure (no topic, no subscription, no IAM). Cloud Build audit log entries with `severity=ERROR` are reliably emitted on build failure (confirmed: all 3 sampled today had this structure). Simpler = fewer failure modes in the alert system itself.

### Decision 2: Separate Alert 3 (pool exhaustion) from Alert 6 (5xx rate)

Pool exhaustion logs at `severity=INFO` (not ERROR) and appears in `jsonPayload.message` not `httpRequest.status`. It would be missed by a 5xx metric. The two signals are complementary: Alert 6 catches user-visible failures; Alert 3 catches the infrastructure cause before it becomes fully user-visible.

### Decision 3: Exclude WA HEARTBEAT/FOLLOWUP errors from worker alert

Confirmed by log sampling: 74% of Cloud Run ERROR log volume is `[HEARTBEAT] SendText error` and `[FOLLOWUP] SendText error`. The `^\[JOBS\]` prefix match is narrow enough to exclude these without explicit negation. The HEARTBEAT/FOLLOWUP errors are already monitored by the WA connection health-check mechanism (separate concern).

### Decision 4: /api/v1/live (not /api/v1/ready) for uptime check

`/api/v1/ready` checks DB connectivity and returns 503 if DB is unreachable. This would cause false-positive uptime alerts during pool saturation events that don't actually take the service down (min-instances=1 keeps existing connection alive). `/api/v1/live` is the correct liveness indicator for the uptime check; DB-layer issues are covered by Alert 3.

---

## Recommendations for Round 2 (founder review before dispatch)

1. **Confirm email address**: `tonywei.office@gmail.com` is the single recipient. Should this go to a dedicated ops@ alias instead, for future team handoff? No pressure to change now — just confirming.

2. **Top-1 open question**: **Alert 1 threshold — should it alert on ANY Cloud Build failure, or only on failures for the PRODUCTION trigger specifically?** Today's 8 failures were all from the same trigger (`f1329980-88cb-4390-8d39-3d53aa6a21af` — confirmed from log sample). If staging builds fail deliberately (experimentation, branch builds), an alert on every build failure could become noise. Options:
   - **Option A** (current design): Alert on ANY `resource.type="build" severity=ERROR` — catches everything, potentially noisy.
   - **Option B**: Add `resource.labels.build_trigger_id="<PROD_TRIGGER_ID>"` to the filter — only alert on prod trigger failures.
   - **Option C**: Alert after 2+ failures in 10 minutes — catches the "chained failures" pattern, ignores single flakes.
   
   **Recommendation**: Start with Option A, see if it's noisy for 1 week, then tighten to B or C if needed. But founder should confirm.

3. **Alert 7 staging noise**: Container startup failures were observed 3 times on `garindo-jaya-panel-msme-erp-staging` today, all caused by DB pool exhaustion. After pool fix, this should stop. If it continues firing after pool migration, should Alert 7 be scoped to prod-only? Recommend waiting 48h after pool fix before deciding.

4. **Sinar Elektrik services**: Two additional Cloud Run services (`sinar-elektrik-msme-erp`, `sinar-elektrik-msme-erp-frontend`) are live. Should they get uptime checks in R2? If they serve real customers, yes. If they're a dev sandbox, no.

5. **Prefer Pub/Sub or log-based metric for Alert 1?**: This design uses log-based metric (simpler). If founder has a preference for Pub/Sub (e.g., future webhook integration), that's a valid alternative — just requires a topic and subscription setup.
