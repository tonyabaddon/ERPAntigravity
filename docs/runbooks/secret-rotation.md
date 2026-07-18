# Secret Rotation Runbook

**TL;DR:** Per-secret deep-dive for the 8 production secrets. Use when a secret leaks, when scheduled rotation is due, or when a token owner (Supabase / Google / Cloudflare / etc) forces rotation. Every rotation follows the same 3-phase pattern: **rotate at source → deploy new value → verify → disable old version**. If verification fails, **revert immediately** to old version.

Companion doc: [rollback-procedures.md § Scenario 4](rollback-procedures.md#scenario-4-secret-rotation) shows the flow; this doc has the per-secret detail.

## Secret inventory

| # | Secret | Location | Blast radius if leaked | Rotation source |
|---|---|---|---|---|
| 1 | Supabase service_role JWT | GCP Secret Manager `supabase-service-key-prod` | Full DB read+write bypassing RLS. Attacker can drop tables, exfiltrate all tenant data, forge admin actions. | Supabase Dashboard → Settings → API |
| 2 | Supabase DB password | GCP Secret Manager `supabase-db-connection-prod` + `supabase-db-connection-listener-prod` | Direct DB superuser access. Same blast radius as #1 plus schema DDL. | Supabase Dashboard → Settings → Database |
| 3 | Supabase access PAT | Local `.env` only (never in GCP) | Read/write access to project settings, secrets metadata, edge functions, apply_migration. | Supabase Dashboard → Account → Access Tokens |
| 4 | GCP Service Account key | Cloud Run runtime SA (managed identity, no explicit key rotation) | Access to GCS buckets, Cloud Run deploys, Secret Manager reads. Contained by SA IAM scope. | `gcloud iam service-accounts keys create/delete` (only if explicit key used) |
| 5 | Sentry auth token | Local `.env` (CI source-map upload) | Upload/delete releases, read events, modify org settings. Cannot read source code. | Sentry → Settings → Auth Tokens |
| 6 | Resend API key | Supabase Auth SMTP config (not GCP) | Send email as `hello@caleo.id`. Rate-limited by Resend but abuse-worthy. | Resend Dashboard → API Keys |
| 7 | Cloudflare API token | Local `.env` (Workers deploys + DNS updates) | Modify DNS, redirect traffic, deploy malicious Workers. Full zone control on caleo.id + caleo.web.id. | Cloudflare Dashboard → Profile → API Tokens |
| 8 | Google AI Studio (Gemini) API key | GCP Secret Manager `gemini-api-key-prod` (or Cloud Run env — verify per service) | Burn our Gemini free-tier quota. Cannot exfiltrate data (Gemini doesn't have DB access). Modest blast radius. | https://aistudio.google.com/apikey |

Also note: **OpenRouter API key** (Calista LLM router alt backend) — stored in Cloud Run env `OPENROUTER_API_KEY`. Rotation via https://openrouter.ai/keys → Cloud Run service update. Same low blast radius as #8 (no data access, just cost burn).

## Rotation phases (universal pattern)

Every secret rotation follows this:

1. **Rotate at source** — generate new secret at the provider dashboard, copy new value, DO NOT close the tab (some providers show the value only once).
2. **Add new version to storage** — GCP Secret Manager for cloud-consumed secrets, local `.env` for tooling secrets.
3. **Deploy** — Cloud Run picks up the new version via `--update-secrets` OR via env update. Restart is automatic on service update.
4. **Verify** — hit the health check or log for a specific success line proving the new secret works.
5. **If verification fails** → immediately revert: re-enable prior secret version + re-deploy prior Cloud Run revision (traffic-revert = 10s, see [rollback-procedures.md § Scenario 1/2](rollback-procedures.md)). Then root-cause before re-attempting rotation.
6. **Disable old version** after 24h burn-in (kept as fallback initially):
   ```bash
   gcloud secrets versions disable <OLD_VERSION> --secret=<name> --project=gen-lang-client-0410251117
   ```

## Per-secret rotation detail

### 1. Supabase service_role JWT

**Where consumed**: `garindo-jaya-panel-msme-erp` (backend), `garindo-jaya-panel-msme-erp-frontend` (build-time via `VITE_SUPABASE_SERVICE_KEY` — verify current wiring in `cloudbuild.frontend.yaml`).

**Rotate**:
```bash
# 1. Supabase Dashboard → Settings → API → "Reset service_role JWT"
#    Copy new JWT. IMPORTANT: this invalidates ALL current sessions instantly.
#    Every logged-in user gets kicked out. Do off-hours if possible.

# 2. Add new version to Secret Manager
echo -n "<NEW_JWT>" | gcloud secrets versions add supabase-service-key-prod \
  --project=gen-lang-client-0410251117 --data-file=-

# 3. Get new version number
NEW_V=$(gcloud secrets versions list supabase-service-key-prod \
  --project=gen-lang-client-0410251117 --limit=1 --format="value(name)")

# 4. Deploy backend
gcloud run services update garindo-jaya-panel-msme-erp \
  --region=asia-southeast1 --project=gen-lang-client-0410251117 \
  --update-secrets=SUPABASE_SERVICE_KEY=supabase-service-key-prod:$NEW_V

# 5. Verify
curl -sf https://garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app/api/v1/ready
# Expected: 200. Anything else = revert immediately.
```

**Verify (deeper)**: log line `"backend startup: supabase client initialized"` should appear on the new revision. If absent → revert.

**If verification fails**: `gcloud run services update-traffic garindo-jaya-panel-msme-erp --region=asia-southeast1 --to-revisions=<PREVIOUS_REVISION>=100` (revert first, root-cause after).

### 2. Supabase DB password

**Where consumed**: `garindo-jaya-panel-msme-erp` (backend, both `SUPABASE_DB_CONNECTION` txn pooler + `SUPABASE_DB_LISTENER_CONNECTION` direct), `caleo-daily-backup` (Cloud Run Job).

**Rotate**:
```bash
# 1. Supabase Dashboard → Settings → Database → "Reset database password"
#    Copy new password. Save immediately to a scratch buffer.

# 2. Build new connection strings (both pooler and direct)
POOLER="host=aws-1-ap-northeast-1.pooler.supabase.com port=6543 user=postgres.ekhhojaezdfjfwuxyjkl password='<NEW_PW>' dbname=postgres sslmode=require"
DIRECT="host=db.ekhhojaezdfjfwuxyjkl.supabase.co port=5432 user=postgres password='<NEW_PW>' dbname=postgres sslmode=require"

# 3. Add new versions
echo -n "$POOLER" | gcloud secrets versions add supabase-db-connection-prod \
  --project=gen-lang-client-0410251117 --data-file=-
echo -n "$DIRECT" | gcloud secrets versions add supabase-db-connection-listener-prod \
  --project=gen-lang-client-0410251117 --data-file=-

# 4. Get new version numbers
POOLER_V=$(gcloud secrets versions list supabase-db-connection-prod --project=gen-lang-client-0410251117 --limit=1 --format="value(name)")
LIST_V=$(gcloud secrets versions list supabase-db-connection-listener-prod --project=gen-lang-client-0410251117 --limit=1 --format="value(name)")

# 5. Deploy backend (both secrets in one command)
gcloud run services update garindo-jaya-panel-msme-erp \
  --region=asia-southeast1 --project=gen-lang-client-0410251117 \
  --update-secrets=SUPABASE_DB_CONNECTION=supabase-db-connection-prod:$POOLER_V,SUPABASE_DB_LISTENER_CONNECTION=supabase-db-connection-listener-prod:$LIST_V

# 6. Deploy backup Cloud Run Job
gcloud run jobs update caleo-daily-backup \
  --region=asia-southeast1 --project=gen-lang-client-0410251117 \
  --update-secrets=SUPABASE_DB_CONNECTION=supabase-db-connection-prod:$POOLER_V

# 7. Verify backend
curl -sf https://garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app/api/v1/ready

# 8. Verify backup job (execute a smoke run)
gcloud run jobs execute caleo-daily-backup --region=asia-southeast1 \
  --project=gen-lang-client-0410251117 --wait
```

**Verify (deeper)**: on the new backend revision, look for `[JOBS] worker started` (proves ListenDB direct connection works) AND absence of `pq: password authentication failed`.

**If verification fails**: revert both secrets AND revert backend revision. See [rollback-procedures.md § Scenario 2](rollback-procedures.md#scenario-2-cloud-run-backend-rollback).

### 3. Supabase access PAT

**Where consumed**: local `.env` only (MCP tool calls, `supabase` CLI, direct API automations). NOT in Cloud Run.

**Rotate**:
1. Supabase Dashboard → Account → Access Tokens → revoke old + generate new
2. Update `.env` file locally: `SUPABASE_ACCESS_TOKEN=<new>`
3. Verify: `supabase projects list` or an MCP call succeeds.

**Blast radius mitigation**: PAT is founder-machine-only. Rotate immediately if the founder laptop is lost/compromised.

### 4. GCP Service Account key

**We do NOT use explicit SA keys.** Cloud Run and Cloud Build use managed identity — GCP rotates credentials automatically. No manual rotation.

**Exception**: if a JSON key file was ever downloaded (check `~/.config/gcloud/legacy_credentials/`), rotate:
```bash
gcloud iam service-accounts keys list --iam-account=<SA_EMAIL>
gcloud iam service-accounts keys delete <KEY_ID> --iam-account=<SA_EMAIL>
```

If you cannot rule out a leaked JSON key, **rotate the SA itself** (recreate + rebind IAM roles) — this is disruptive; consult founder before.

### 5. Sentry auth token

**Where consumed**: local `.env` (`SENTRY_AUTH_TOKEN`), Cloud Build FE trigger (source-map upload step).

**Rotate**:
1. Sentry → Settings → Auth Tokens → revoke old + generate new (scopes: `project:releases`, `org:read`)
2. Update `.env`: `SENTRY_AUTH_TOKEN=sntryu_<new>`
3. Update Cloud Build trigger substitution:
   ```bash
   gcloud beta builds triggers update <TRIGGER_ID> \
     --project=gen-lang-client-0410251117 \
     --substitutions=_SENTRY_AUTH_TOKEN=sntryu_<new>
   ```
4. Trigger a test FE build. Verify source maps upload (Cloud Build log line `sourcemap upload complete`).

**If verification fails**: source maps missing means Sentry stack traces stay minified. Non-critical — revert token at Sentry side + investigate.

### 6. Resend API key

**Where consumed**: Supabase Auth SMTP settings (NOT Cloud Run — it lives inside Supabase Auth config).

**Rotate**:
1. Resend Dashboard → API Keys → revoke old + generate new
2. Supabase Dashboard → Authentication → Email Templates → SMTP Settings → paste new API key as SMTP password
3. Trigger a test password reset email from Supabase Dashboard → Users → invite/reset a test user
4. Verify email arrives at founder Gmail within 30s.

**If verification fails**: user password resets stop working (auth-flow-impacting). Immediately re-paste old Resend key while investigating.

### 7. Cloudflare API token

**Where consumed**: local `.env` (`CLOUDFLARE_API_TOKEN`), Cloudflare Workers `wrangler deploy` (if used).

**Rotate**:
1. Cloudflare Dashboard → My Profile → API Tokens → revoke old
2. Create new token with scopes: `Zone:DNS:Edit` on caleo.id + caleo.web.id, `Workers:Edit` if Workers used
3. Update `.env`: `CLOUDFLARE_API_TOKEN=<new>`
4. Verify: `curl -sf -H "Authorization: Bearer $(grep CLOUDFLARE_API_TOKEN .env | cut -d= -f2)" https://api.cloudflare.com/client/v4/zones` returns 200 + zone list.

**Blast radius mitigation**: token is founder-machine-only. If laptop compromised, rotate + revoke immediately.

### 8. Google AI Studio (Gemini) API key

**Where consumed**: `garindo-jaya-panel-msme-erp` backend, env `GEMINI_API_KEY` (verify actual env name via `gcloud run services describe garindo-jaya-panel-msme-erp --format=export | grep -i gemini`).

**Rotate**:
1. https://aistudio.google.com/apikey → delete old + create new
2. Add to Secret Manager (if used) OR update Cloud Run env directly:
   ```bash
   # Option A: Secret Manager (preferred, if secret exists)
   echo -n "<NEW_KEY>" | gcloud secrets versions add gemini-api-key-prod \
     --project=gen-lang-client-0410251117 --data-file=-
   NEW_V=$(gcloud secrets versions list gemini-api-key-prod --project=gen-lang-client-0410251117 --limit=1 --format="value(name)")
   gcloud run services update garindo-jaya-panel-msme-erp \
     --region=asia-southeast1 --project=gen-lang-client-0410251117 \
     --update-secrets=GEMINI_API_KEY=gemini-api-key-prod:$NEW_V

   # Option B: Direct env (if no secret entry)
   gcloud run services update garindo-jaya-panel-msme-erp \
     --region=asia-southeast1 --project=gen-lang-client-0410251117 \
     --update-env-vars=GEMINI_API_KEY=<NEW_KEY>
   ```
3. Verify: trigger a Calista Gemini-backend call (send a test WA message routed through Gemini). Look for backend log `[calista] gemini backend response ok`. Absence = revert.

**If verification fails**: Calista degrades to OpenRouter fallback (still functional). Non-emergency — revert env at leisure, root-cause.

## Scheduled rotation cadence

No mandatory cadence yet at 3-tenant scale. Recommendation as we grow:

| Secret | Cadence |
|---|---|
| Supabase service_role JWT | Annual OR on leak |
| Supabase DB password | Annual OR on leak |
| Supabase PAT | Quarterly OR on founder-laptop change |
| Sentry auth token | Annual OR on leak |
| Resend API key | Annual OR on leak |
| Cloudflare API token | Quarterly OR on founder-laptop change |
| Gemini API key | On free-tier quota exhaustion OR on leak |
| OpenRouter API key | On leak |

Add to calendar reminders when we cross 5 paying tenants (compliance readiness).

## Post-rotation checklist

- [ ] New secret verified in prod (specific health check listed above)
- [ ] Old secret version disabled in Secret Manager (24h after successful rotation)
- [ ] `.env` updated locally if applicable
- [ ] Cloud Build trigger substitutions updated if applicable
- [ ] Rotation event logged in `docs/incidents/YYYY-MM-DD-rotation-<secret-name>.md` — include: reason (leak/scheduled), timestamp, verification proof, any anomalies

## Related runbooks

- [Rollback procedures](rollback-procedures.md) — has the FLOW (Scenario 4) that references this doc for detail
- [Restore from backup](restore-from-backup.md) — for data recovery scenarios (independent of secret rotation)

## When to update this doc

- New secret added → new row in inventory + new per-secret section
- Existing secret's consumer changes (e.g., moved from Cloud Run env to Secret Manager) → update "Where consumed"
- Rotation source URL changes (provider dashboard restructure) → update the "Rotate" step
