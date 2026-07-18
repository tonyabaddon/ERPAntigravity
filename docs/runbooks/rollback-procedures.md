# Rollback Procedures Runbook

**TL;DR:** Every prod change is reversible. This doc lists the exact commands to undo each type of change. Read the scenario matching your incident, run the commands. Prod-testing-tenant (`Toko Jaya Makmur`) is the only safe rehearsal target — never rehearse on `Garindo Jaya Panel` (real customer).

## Scenario matrix

| Symptom | Scenario | Time |
|---|---|---|
| Frontend bug user-visible | 1. Cloud Run FE rollback | 2 min |
| Backend crash/regression | 2. Cloud Run BE rollback | 3 min |
| Migration broke something | 3. Migration rollback | 5-15 min |
| Data corrupted | → See [restore-from-backup.md](restore-from-backup.md) | 10-30 min |
| Credentials leaked | 4. Secret rotation | 15-20 min |
| Tenant offboarding | 5. Tenant deprovision | 10 min |
| Wrong DNS / routing | 6. Cloudflare/DNS revert | 5 min |

---

## Scenario 1: Cloud Run Frontend Rollback

**Use case**: Frontend deploy shipped a bug. Users seeing errors, wrong UI, blank page.

**Time**: ~2 min

### Steps

1. **List recent revisions** (find the last known-good):
   ```bash
   gcloud run revisions list \
     --service=garindo-jaya-panel-msme-erp-frontend \
     --region=asia-southeast1 \
     --project=gen-lang-client-0410251117 \
     --limit=10 \
     --format="table(metadata.name,status.conditions[0].status,metadata.creationTimestamp.date('%m-%d %H:%M'))"
   ```

2. **Verify the target revision is healthy** (STATUS=True):
   Note the revision name of the working version (e.g., `garindo-jaya-panel-msme-erp-frontend-00195-vaq`).

3. **Route 100% traffic to it**:
   ```bash
   gcloud run services update-traffic garindo-jaya-panel-msme-erp-frontend \
     --region=asia-southeast1 \
     --project=gen-lang-client-0410251117 \
     --to-revisions=garindo-jaya-panel-msme-erp-frontend-XXXXX-yyy=100
   ```

4. **Verify FE reachable + bug gone**:
   ```bash
   curl -sfI https://app.caleo.id/ | head -3
   ```
   Open in browser, confirm bug not reproducible.

5. **Log the incident** — what shipped, why it broke, what version we rolled back to.

6. **Do NOT delete the bad revision** — keep it available for post-mortem debugging via its per-commit tag URL.

---

## Scenario 2: Cloud Run Backend Rollback

**Use case**: Backend deploy crashing on startup, or API returning errors.

**Time**: ~3 min

Same commands as Scenario 1 but for the backend service:

```bash
# List revisions
gcloud run revisions list \
  --service=garindo-jaya-panel-msme-erp \
  --region=asia-southeast1 \
  --project=gen-lang-client-0410251117 \
  --limit=10 \
  --format="table(metadata.name,status.conditions[0].status,metadata.creationTimestamp.date('%m-%d %H:%M'))"

# Route to good revision
gcloud run services update-traffic garindo-jaya-panel-msme-erp \
  --region=asia-southeast1 \
  --project=gen-lang-client-0410251117 \
  --to-revisions=garindo-jaya-panel-msme-erp-XXXXX-yyy=100

# Verify
curl -sf https://garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app/api/v1/ready
```

**Additional check for backend**: if the bad revision changed DB schema
(migration was part of the deploy), traffic rollback is NOT enough. See
Scenario 3 next.

---

## Scenario 3: Migration Rollback

**Use case**: A migration broke a table structure, an RPC, or an RLS
policy. Symptoms: 500s from RPCs that used to work, permission denied
errors, missing columns.

**Time**: ~5-15 min

### Rule of thumb

- Migrations that ADDED things (columns, tables, indexes, functions) → **revert by DROP**
- Migrations that MODIFIED things (CREATE OR REPLACE) → **revert by CREATE OR REPLACE back to previous body**
- Migrations that BACKFILLED data → **need restore from backup** (see restore runbook)

### Steps

1. **Identify the bad migration**:
   ```bash
   ls supabase/migrations/ | tail -5
   ```
   The most recent ones are usually the culprit. Check the file's header
   comment for what it does.

2. **Find the PREVIOUS version of anything the migration modified**:
   ```bash
   # Find all migrations that touched (e.g.) the record_kasir_sale function
   grep -l "CREATE.*FUNCTION.*record_kasir_sale" supabase/migrations/ | sort
   ```
   The migration before the bad one contains the version you want to
   restore.

3. **Write a revert migration**:
   Claim the next migration slot per memory `migration_slot_allocation`
   (currently 326+ free). Name: `2026NNNN000<slot>_revert_<slug>.sql`.

   Template for reverting an added column:
   ```sql
   -- Revert of migration <original_slot>: <what it did>
   -- Reason: <describe the problem>
   ALTER TABLE public.audit_log DROP COLUMN IF EXISTS tenant_id;
   DROP INDEX IF EXISTS idx_audit_log_tenant_created;
   ```

   Template for reverting a CREATE OR REPLACE:
   ```sql
   -- Revert of migration <original_slot>: rewrote <function>
   -- Reason: <describe the problem>
   -- Restore body from migration <previous_slot>
   CREATE OR REPLACE FUNCTION public.claim_next_job(...) ...
   ```

   Copy the function body from the PREVIOUS migration file. Do not try to
   write it from memory.

4. **Apply the revert via MCP**:
   ```
   Call: mcp__plugin_supabase_supabase__apply_migration
     project_id: ekhhojaezdfjfwuxyjkl
     name: revert_<slug>
     query: <SQL from step 3>
   ```

5. **Verify the revert worked**:
   ```sql
   -- e.g., verify column dropped
   SELECT count(*) FROM information_schema.columns
   WHERE table_name='audit_log' AND column_name='tenant_id';
   -- Expect: 0
   ```

6. **Deploy backend to pick up any schema-dependent changes**:
   Force revision restart per Scenario 2.

7. **Run advisor** to catch new issues:
   ```
   mcp__plugin_supabase_supabase__get_advisors (security + performance)
   ```

8. **Log incident** in `docs/incidents/YYYY-MM-DD-<slug>.md`.

### Common failure mode

**"cannot drop function X because Y depends on it"**

Cascade drop is dangerous — you may kill unrelated dependencies. Instead,
list what depends on X first, then decide:
```sql
SELECT DISTINCT dependent.relname, dependent_type.typname
FROM pg_depend
JOIN pg_class dependent ON pg_depend.objid = dependent.oid
JOIN pg_type dependent_type ON dependent.reltype = dependent_type.oid
WHERE pg_depend.refobjid = (SELECT oid FROM pg_proc WHERE proname='X');
```

If safe: `DROP FUNCTION X CASCADE`. If not: restore the function via
CREATE OR REPLACE.

---

## Scenario 4: Secret Rotation

**Use case**: A secret leaked (accidentally committed, shared over
insecure channel, or as a scheduled rotation).

**Time**: ~15-20 min

**See [secret-rotation.md](secret-rotation.md) for per-secret detail** — this scenario is the FLOW; the companion doc has blast-radius, verification steps, and revert-on-fail path for each of the 8 production secrets.

### Secrets in scope (8)

| # | Secret | Where used | Rotation source |
|---|---|---|---|
| 1 | Supabase service_role JWT | GCP `supabase-service-key-prod` | Supabase Dashboard → Settings → API |
| 2 | Supabase DB password | GCP `supabase-db-connection-prod` + `supabase-db-connection-listener-prod` | Supabase Dashboard → Settings → Database |
| 3 | Supabase access PAT | Local `.env` only | Supabase Dashboard → Account → Access Tokens |
| 4 | GCP SA key | Managed identity (no manual rotation) | See secret-rotation.md § 4 for exception |
| 5 | Sentry auth token | Local `.env` + Cloud Build trigger sub | Sentry → Settings → Auth Tokens |
| 6 | Resend API key | Supabase Auth SMTP config | Resend Dashboard → API Keys |
| 7 | Cloudflare API token | Local `.env` + Workers | Cloudflare Dashboard → Profile → API Tokens |
| 8 | Google AI Studio (Gemini) API key | Cloud Run env or GCP secret `gemini-api-key-prod` | https://aistudio.google.com/apikey |

Also: OpenRouter API key (Calista alt backend). Same rotation pattern.

### Rotation flow (example: DB password)

1. **Log into Supabase Dashboard** → project `ekhhojaezdfjfwuxyjkl` → Settings → Database
2. **Reset database password**. Copy the new password. Do NOT close the tab (Supabase shows it once).
3. **Add new version to Secret Manager**:
   ```bash
   NEW_CONN="host=aws-1-ap-northeast-1.pooler.supabase.com port=5432 user=postgres.ekhhojaezdfjfwuxyjkl password='<NEW_PASSWORD>' dbname=postgres sslmode=require"
   echo -n "$NEW_CONN" | gcloud secrets versions add supabase-db-connection-prod \
     --project=gen-lang-client-0410251117 --data-file=-
   ```
4. **Force backend Cloud Run to pick up new version**:
   ```bash
   NEW_VERSION=$(gcloud secrets versions list supabase-db-connection-prod \
     --project=gen-lang-client-0410251117 --limit=1 --format="value(name)")
   gcloud run services update garindo-jaya-panel-msme-erp \
     --region=asia-southeast1 \
     --project=gen-lang-client-0410251117 \
     --update-secrets=SUPABASE_DB_CONNECTION=supabase-db-connection-prod:$NEW_VERSION
   ```
5. **Verify backend healthy**:
   ```bash
   curl -sf https://garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app/api/v1/ready
   ```
6. **Update the daily backup Cloud Run Job too**:
   ```bash
   gcloud run jobs update caleo-daily-backup \
     --region=asia-southeast1 \
     --project=gen-lang-client-0410251117 \
     --update-secrets=SUPABASE_DB_CONNECTION=supabase-db-connection-prod:$NEW_VERSION
   ```
7. **Test backup still works**:
   ```bash
   gcloud run jobs execute caleo-daily-backup \
     --region=asia-southeast1 --project=gen-lang-client-0410251117 --wait
   ```
8. **Update local `.env`** if needed (only affects your development env).
9. **Log** the rotation in `docs/incidents/` with the date + reason.
10. **Old secret version** — Cloud Run holds it as a fallback for a while.
    Disable old versions after 24h to be safe:
    ```bash
    gcloud secrets versions disable <OLD_VERSION> \
      --secret=supabase-db-connection-prod \
      --project=gen-lang-client-0410251117
    ```

### Rotation flow (SUPABASE_SERVICE_KEY)

Same pattern, but the source is Supabase Dashboard → Settings → API → "Reset service_role JWT". This one is trickier because it invalidates ALL sessions instantly — every logged-in user gets kicked out. Do off-hours if possible.

---

## Scenario 5: Tenant Deprovision

**Use case**: Tenant asked to leave / stopped paying / trial expired.

**Time**: ~10 min

### Steps

1. **Export their data first** (data portability):
   ```sql
   -- Via Supabase Management API SQL endpoint
   -- Export each t_* table filtered by tenant_id to CSV
   -- Zip and email to tenant per GDPR-equivalent process
   ```
   (Task 12b — proper export tool is P2-D deferred.)

2. **Take a targeted backup** just of this tenant's data:
   ```bash
   TENANT_ID='<uuid>'
   PGPASSWORD='<pw>' pg_dump -Fc \
     --data-only \
     -t 't_*' \
     --where="tenant_id='$TENANT_ID'" \
     -f "/tmp/tenant-${TENANT_ID}-final.dump" \
     "host=aws-1-ap-northeast-1.pooler.supabase.com port=5432 user=postgres.ekhhojaezdfjfwuxyjkl dbname=postgres sslmode=require"
   ```
   Note: pg_dump doesn't support `--where` directly — use a manual per-table
   COPY-with-WHERE loop or rely on the daily backup + manual filtering.

3. **Call the deprovision RPC** (already exists):
   ```sql
   -- Runs as platform_admin, cascade-deletes all t_* rows for the tenant
   -- Records event in platform_admin_audit
   SELECT public.deprovision_tenant('<uuid>');
   ```

4. **Verify cleanup**:
   ```sql
   SELECT count(*) FROM tenants WHERE id='<uuid>';  -- expect 0
   -- Spot-check a few tables
   SELECT count(*) FROM t_customers WHERE tenant_id='<uuid>';  -- expect 0
   SELECT count(*) FROM t_kasir_transactions WHERE tenant_id='<uuid>';  -- expect 0
   ```

5. **Log** in `docs/incidents/YYYY-MM-DD-tenant-<slug>-offboarding.md` with:
   - Reason for offboarding
   - Data export confirmation
   - Deprovision timestamp
   - Point of contact (in case they come back)

6. **Kill any auth sessions** for their users:
   Via Supabase Dashboard → Authentication → search email → Revoke tokens.

---

## Scenario 6: Cloudflare / DNS Revert

**Use case**: DNS change routed traffic wrong, SSL broken, Worker deploy misconfigured.

**Time**: ~5 min

### For Cloudflare DNS records

Cloudflare Dashboard → Zone `caleo.id` → DNS → find the record → click edit
→ revert to previous value. DNS TTL is typically 5 min, so propagation
takes 5-10 min.

### For Cloudflare Workers

```bash
CF_TOKEN=$(grep CLOUDFLARE_API_TOKEN .env | cut -d= -f2)
# List worker deployments
curl -sf "https://api.cloudflare.com/client/v4/accounts/$(grep CLOUDFLARE_ACCOUNT_ID .env | cut -d= -f2)/workers/scripts/<script_name>/deployments" \
  -H "Authorization: Bearer $CF_TOKEN"
# Roll back to a specific deployment via dashboard (easier than API)
```

Dashboard path: Workers & Pages → click worker → Deployments → click older
version → Rollback.

### For Cloud Run domain mappings

If `app.caleo.id` stopped serving: check the domain mapping status:
```bash
gcloud beta run domain-mappings describe app.caleo.id \
  --region=asia-southeast1 --project=gen-lang-client-0410251117
```

If SSL cert failed to provision, delete + recreate the mapping (24h SSL re-issue).

---

## Recent worked examples (learning from real events)

### 2026-07-16 — Bug D (session pooler cap)

**Symptom**: Backend intermittent 503s + `db: too many clients already` after rolling deploy.
**Root cause**: Single `*sql.DB` pool against Supabase session pooler hit 15-client cap during 3-instance rolling deploy (15 slots / 3 old + 3 new = pool exhaustion).
**Recovery path**: Rolled back via Scenario 2 (traffic to previous revision), then implemented split-pool architecture (`0f769e5 feat(be): split-pool DB connection`). Recovery took ~5 min via traffic revert.
**Lesson**: When pool errors surface, do NOT try to scale up — traffic revert first, root-cause after. Memoried at `supabase_split_pool`.

### 2026-07-17 — Bug E (lib/pq prepared statement + txn pooler incompatibility)

**Symptom**: Async job worker crashing with `pq: unnamed prepared statement does not exist` after Bug D fix.
**Root cause**: `lib/pq` prepares statements for parameterized queries, incompatible with Supavisor transaction pooler multiplexing.
**Recovery path**: Committed `2559361 fix(worker): route P2-E job worker via ListenDB (direct connection)` — parameterized queries via direct connection, non-parameterized via txn pooler. Extended to HEARTBEAT/FOLLOWUP paths in `933867b`. No traffic revert needed — forward fix within 30 min.
**Lesson**: Migration to pgx driver with `simple_protocol` mode would allow ALL queries via txn pooler. Deferred to Phase 3. Memoried at `supabase_split_pool`.

### Meta-lesson

Both incidents were fixable in <30 min because (a) rollback via traffic-revert is 10s, (b) split-pool architecture localized the fix, (c) we had zero real customer traffic during the window. **Rollback discipline works. Rehearse it before scale forces us to learn under pressure.**

## Related runbooks
- [Restore from backup](restore-from-backup.md) — data recovery scenarios (pg_restore drill verified 2026-07-18, see `infra/backup/drills/2026-07-18-report.md`)
- [Secret rotation](secret-rotation.md) — per-secret rotation detail (companion to Scenario 4 above)
- [Cloud Run promote](../cloud-run-promote-runbook.md) — post-merge traffic (legacy, mostly automated now)

## When to update this doc
- After using a scenario in prod → capture what actually happened, timings, deviations
- When a new class of change ships (e.g., adding S3 signed uploads → add a "revoke leaked signed URL" scenario)
- Quarterly: dry-run one scenario against prod-testing-tenant, confirm docs match reality
