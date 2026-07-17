# Restore from Backup Runbook

**TL;DR:** Daily backups in GCS bucket `caleo-backups-gen-lang-client-0410251117`. Restore by (1) downloading the right dump, (2) restoring to a **scratch DB** first (never directly to prod), (3) extracting affected rows/tables, (4) applying to prod via UPSERT SQL. Target RTO: 30 min.

## When to use this

- A migration deleted or corrupted data
- An RPC bug wrote wrong values to a tenant's rows
- A user request: "we accidentally deleted our customer list, can you get it back?"
- Partial data loss (single tenant, single table)
- Full database loss (nuclear scenario)

## Prerequisites

- GCP CLI (`gcloud`, `gsutil`) authenticated as tinythinkers or founder
- Local Postgres 17 client tools (`psql`, `pg_restore`) — install via `brew install postgresql@17` on macOS
- Access to Supabase Management API PAT (in `.env`)
- ~5GB free local disk

## Available backups

```bash
gsutil ls -l gs://caleo-backups-gen-lang-client-0410251117/
```

Retention: 30 days daily. Naming: `db-YYYY-MM-DD.dump` (UTC date).

Backup schedule: 03:00 UTC daily (10:00 WIB). If you need to restore data
from an event 8 hours ago, use yesterday's backup + accept 8h of missing
transactions in the restored view.

---

## Scenario A: Single table restore (most common)

**Use case**: An RPC dropped rows from `t_customers` or a migration corrupted `orders_v2`.

**Time**: ~10 min

### Steps

1. **Identify affected table + timestamp**. What table, when did the loss happen, what row range?

2. **Download the backup file just BEFORE the loss**:
   ```bash
   gsutil cp gs://caleo-backups-gen-lang-client-0410251117/db-YYYY-MM-DD.dump /tmp/
   ```

3. **Create a temporary scratch database locally**:
   ```bash
   docker run -d --name pg-restore-scratch \
     -e POSTGRES_PASSWORD=scratch \
     -p 5433:5432 \
     postgres:17
   sleep 5
   ```

4. **Restore just the schema first** (to see what's in there):
   ```bash
   PGPASSWORD=scratch pg_restore -h localhost -p 5433 -U postgres \
     --schema-only --dbname=postgres /tmp/db-YYYY-MM-DD.dump
   ```

5. **Restore just the target table's data**:
   ```bash
   PGPASSWORD=scratch pg_restore -h localhost -p 5433 -U postgres \
     --data-only -t t_customers --dbname=postgres /tmp/db-YYYY-MM-DD.dump
   ```

   Replace `t_customers` with your table name. Add `-t` for multiple tables:
   `-t t_customers -t t_customer_addresses`.

6. **Dump the restored table as SQL**:
   ```bash
   PGPASSWORD=scratch pg_dump -h localhost -p 5433 -U postgres \
     --data-only -t t_customers \
     --column-inserts \
     --dbname=postgres > /tmp/restore-t_customers.sql
   ```

   `--column-inserts` produces `INSERT INTO ... (col1, col2) VALUES (...);` per row —
   safe to rerun if we need to skip duplicates.

7. **Convert INSERTs to UPSERTs** to avoid PK collisions with rows that
   already exist in prod:
   ```bash
   # For every INSERT INTO t_customers ..., append ON CONFLICT DO NOTHING
   # (or DO UPDATE if you want restored version to win)
   sed -i.bak 's/);$/) ON CONFLICT DO NOTHING;/' /tmp/restore-t_customers.sql
   ```

8. **Review** — open `/tmp/restore-t_customers.sql` in an editor. Sanity check:
   - Row count matches expectation
   - No unexpected tenant IDs (multi-tenant leak check)
   - No timestamps in the future

9. **Apply to prod via Supabase Management API** (safer than direct psql):
   ```bash
   # Read the SQL into a JSON-safe string, then execute
   SQL=$(cat /tmp/restore-t_customers.sql)
   curl -s "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" \
     -H "Authorization: Bearer $(grep SUPABASE_ACCESS_TOKEN .env | cut -d= -f2)" \
     -H "Content-Type: application/json" \
     --data-binary "$(jq -Rs '{query: .}' <<< "$SQL")"
   ```

   For large restores (>1MB), split into batches or use `psql` directly:
   ```bash
   PGPASSWORD='<db_password>' psql "host=aws-1-ap-northeast-1.pooler.supabase.com port=5432 user=postgres.ekhhojaezdfjfwuxyjkl dbname=postgres sslmode=require" -f /tmp/restore-t_customers.sql
   ```

10. **Verify restored row count**:
    ```sql
    SELECT count(*) FROM t_customers WHERE tenant_id='<the tenant>';
    ```

11. **Cleanup scratch DB**:
    ```bash
    docker rm -f pg-restore-scratch
    rm /tmp/db-*.dump /tmp/restore-*.sql
    ```

12. **Log the incident** in `docs/incidents/YYYY-MM-DD-<slug>.md` per CLAUDE.md convention.

---

## Scenario B: Single tenant restore

**Use case**: One tenant's data was wiped or corrupted. Other tenants untouched.

**Time**: ~15-20 min

Same as Scenario A, but filter the SQL restore by `tenant_id`:

After step 6, add a filter step:
```bash
grep -E "'<tenant-uuid-here>'" /tmp/restore-t_customers.sql > /tmp/restore-filtered.sql
```

Or restore the table into scratch, then dump only that tenant's rows:
```bash
PGPASSWORD=scratch psql -h localhost -p 5433 -U postgres -d postgres -c \
  "\\copy (SELECT * FROM t_customers WHERE tenant_id='<uuid>') TO '/tmp/tenant-customers.csv' CSV HEADER"
```

Then apply the CSV to prod via `\\copy FROM` or a bulk INSERT statement.

---

## Scenario C: Full DB restore (NUCLEAR — last resort)

**Use case**: Prod DB is completely trashed, or we're setting up a disaster recovery instance.

**Time**: ~30-45 min

⚠️ **This destroys current prod data.** Do NOT use unless you've confirmed
current prod is unrecoverable AND you have founder approval.

### Steps

1. **Confirm intent**. Get founder confirmation via WhatsApp / email. Log
   the decision timestamp.

2. **Snapshot current state first** (so you can compare / roll back the
   rollback):
   ```bash
   PGPASSWORD='<pw>' pg_dump -Fc \
     -f /tmp/prod-current-state-$(date -u +%Y%m%d-%H%M).dump \
     "host=aws-1-ap-northeast-1.pooler.supabase.com port=5432 user=postgres.ekhhojaezdfjfwuxyjkl dbname=postgres sslmode=require"
   ```

3. **Download the backup**:
   ```bash
   gsutil cp gs://caleo-backups-gen-lang-client-0410251117/db-YYYY-MM-DD.dump /tmp/
   ```

4. **Set backend Cloud Run to zero traffic** (prevent writes during restore):
   ```bash
   gcloud run services update-traffic garindo-jaya-panel-msme-erp \
     --region=asia-southeast1 --to-revisions=<current-revision>=0
   ```

   Prod will return 503 briefly. Acceptable during a disaster.

5. **Restore into prod** (direct connection, NOT pooler — full restore
   needs superuser):
   ```bash
   PGPASSWORD='<pw>' pg_restore \
     --clean --if-exists --no-owner --no-privileges \
     -d "postgres://postgres:<pw>@db.ekhhojaezdfjfwuxyjkl.supabase.co:5432/postgres?sslmode=require" \
     /tmp/db-YYYY-MM-DD.dump
   ```

   Expect ~5-15 min for our current 46MB DB.

6. **Verify essential invariants**:
   ```sql
   SELECT count(*) FROM tenants;               -- expect 3+
   SELECT count(*) FROM t_kasir_transactions;  -- non-zero
   SELECT tenant_id, count(*) FROM t_customers GROUP BY tenant_id;
   ```

7. **Restore traffic to backend**:
   ```bash
   gcloud run services update-traffic garindo-jaya-panel-msme-erp \
     --region=asia-southeast1 --to-latest
   ```

8. **Force backend restart** (schema may have changed):
   ```bash
   gcloud run services update garindo-jaya-panel-msme-erp \
     --region=asia-southeast1 --update-labels=restarted-at=$(date -u +%Y%m%d-%H%M)
   ```

9. **Verify FE + BE health**:
   ```bash
   curl -sfI https://app.caleo.id/ | head -3
   curl -sf https://garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app/api/v1/ready
   ```

10. **Log incident** with timeline, data-loss window, restore duration.

11. **Notify affected tenants** via WA about the outage + data window.

---

## Common failure modes

**"pg_restore: error: schema owner already exists"**
- Add `--no-owner --no-privileges` to pg_restore command
- Root cause: Supabase-managed roles conflict with dump metadata

**"connection to database not available (EAUTHQUERY)"**
- Supabase pool exhausted. Wait 5 min, retry.
- Or use direct endpoint instead of pooler: `db.ekhhojaezdfjfwuxyjkl.supabase.co:5432`

**"gsutil cp: AccessDeniedException: 403"**
- Your gcloud auth doesn't have `storage.objectViewer` on the bucket
- Fix: `gcloud auth login` as founder OR ask founder to grant your account

**"Row already exists (23505)" during INSERT**
- Change ON CONFLICT DO NOTHING → ON CONFLICT DO UPDATE
- Or filter out existing PKs before INSERT: `SELECT id FROM t_customers WHERE tenant_id='<x>'` compare vs restore data

**"function public.gen_random_uuid() does not exist"**
- Extension `pgcrypto` or `pg_uuid-ossp` not installed on scratch DB
- Fix on scratch: `CREATE EXTENSION IF NOT EXISTS pgcrypto;` before restore

---

## Related runbooks
- [Rollback procedures](rollback-procedures.md) — Cloud Run revert, migration revert, secret rotation
- [Cloud Run promote](../cloud-run-promote-runbook.md) — post-merge traffic promotion (legacy — mostly automated now)

## When to update this doc
- After first real restore in prod → capture what actually happened, what took longer, any deviations
- When backup format changes (e.g., switching from `-Fc` to `-Fp`)
- When adding a new critical table that needs scenario-specific instructions
