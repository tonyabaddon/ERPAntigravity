# Staging/Production Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship isolated staging tenants (env marker + hostname picker) then a manual prod deploy gate, so future features can be tested at `staging.app.caleo.id` without risk to real tenant at `app.caleo.id`.

**Architecture:** Same Supabase project. Env column on `tenants` distinguishes staging vs production rows. `bootstrap_tenant_context` filters by hostname → env. FE picker only shows tenants matching hostname. Cloud Build removes auto-promote step (Step 6 of both `cloudbuild.frontend.yaml` + `cloudbuild.yaml`); prod revisions deploy at 0% traffic + tag URL, promoted manually via `scripts/promote-to-prod.sh <SHA>`.

**Tech Stack:** Postgres 15 (Supabase), TypeScript React 18, Go 1.22, Google Cloud Build + Cloud Run, Playwright 1.61 (E2E), vitest 4 (unit).

## Global Constraints

- **Migration slots:** 508, 509, 510 (verified 507 = P3-05 already applied).
- **All migrations idempotent** (`CREATE OR REPLACE`, `ALTER TABLE ... IF NOT EXISTS` patterns, `INSERT ... ON CONFLICT DO NOTHING`).
- **schema_migrations tracking:** every migration MUST INSERT a row via mgmt-api (Phase 1 Task 6 pattern from Wave 1).
- **Cost:** $0 (same Supabase project, existing Cloud Run services).
- **Phase 2 timing:** MUST ship as the LAST auto-promoted commit; real tenant onboards immediately after in Phase 3.
- **Bahasa Indonesia** for user-facing strings.
- **Advisor gate** required for: Phase 1 migration 510 (touches auth path — `bootstrap_tenant_context` SECDEF). Not required for: cloudbuild edits, seed data, promote script.

---

## File Structure

### New files
- `supabase/migrations/20261115000508_tenant_environment_column.sql` — env column
- `supabase/migrations/20261115000509_provision_tenant_env_param.sql` — add env param to RPC
- `supabase/migrations/20261115000510_bootstrap_tenant_context_hostname.sql` — hostname-aware SECDEF
- `scripts/seed-staging-tenants.sh` — one-shot seed script for 3 staging tenants
- `scripts/promote-to-prod.sh` — manual promote (also used for rollback with previous SHA)
- `docs/runbooks/deploy-promote.md` — 1-page runbook
- `tests/sql/qa-week/staging-prod-isolation-regression.sql` — matrix + spot-check
- `tests/e2e/tests/qa-week/t21-staging-prod-isolation.spec.ts` — Playwright at both hostnames
- `/Users/tonywei/.claude/projects/-Users-tonywei-IdeaProjects-ERPAntigravity/memory/feedback_manual_prod_gate_after_real_tenant.md` — HARD RULE memory

### Modified files
- `cloudbuild.frontend.yaml` — remove Step 6 (auto-promote to 100%), add comment where it was
- `cloudbuild.yaml` — remove Step 6 (auto-promote to 100%), add comment
- `src/lib/tenantContextService.ts` — bootstrap() accepts hostname
- `src/components/SelectTenantScreen.tsx` — pass `window.location.hostname` when calling bootstrap
- `docs/qa-week/phase-2-report.md` — append Phase 3 completion (final step)
- `.superpowers/sdd/progress.md` — ledger update per task

---

## Phase 1 — Data Isolation

### Task 1: Add `environment` column to tenants (migration 508)

**Files:**
- Create: `supabase/migrations/20261115000508_tenant_environment_column.sql`

**Interfaces:**
- Consumes: existing `tenants` table (id, slug, name, ...)
- Produces: `tenants.environment TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('production','staging'))`

- [ ] **Step 1: Write migration file**

Create `supabase/migrations/20261115000508_tenant_environment_column.sql`:
```sql
-- Phase 1 (2026-07-22): add environment column to tenants for staging/prod
-- isolation. Existing 3 tenants backfill to 'production'. Staging tenants
-- created in Task 2 via provision_tenant with p_environment='staging'.
-- Idempotent via ADD COLUMN IF NOT EXISTS pattern (Postgres 9.6+).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'environment'
  ) THEN
    ALTER TABLE tenants
      ADD COLUMN environment TEXT NOT NULL DEFAULT 'production'
      CHECK (environment IN ('production', 'staging'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tenants_environment ON tenants (environment);
```

- [ ] **Step 2: Apply via mgmt-api**

```bash
source .env
SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-ekhhojaezdfjfwuxyjkl}"
curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "$(jq -Rs '{query: .}' < supabase/migrations/20261115000508_tenant_environment_column.sql)"
```

Expected output: `[]` (empty array = success for DDL)

- [ ] **Step 3: Verify column + backfill**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"SELECT slug, environment FROM tenants ORDER BY created_at LIMIT 10;"}' | jq -r '.[] | "\(.slug) | env=\(.environment)"'
```

Expected: all 3 existing tenants show `env=production`.

- [ ] **Step 4: Track in schema_migrations**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('"'"'20261115000508'"'"','"'"'tenant_environment_column'"'"') ON CONFLICT DO NOTHING;"}'
```

Expected: `[]`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261115000508_tenant_environment_column.sql
git commit -m "[staging-prod-isolation] Task 1: add environment column to tenants (mig 508)"
git push origin main
```

---

### Task 2: Extend `provision_tenant` with env param (migration 509)

**Files:**
- Create: `supabase/migrations/20261115000509_provision_tenant_env_param.sql`

**Interfaces:**
- Consumes: existing `provision_tenant(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER)` signature, `tenants.environment` (from Task 1)
- Produces: new signature `provision_tenant(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT DEFAULT 'production')` — env param optional, defaults to production

- [ ] **Step 1: Get current provision_tenant source**

```bash
source .env
SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-ekhhojaezdfjfwuxyjkl}"
curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"SELECT pg_get_functiondef((SELECT oid FROM pg_proc WHERE proname = '"'"'provision_tenant'"'"' AND pronargs = 7));"}' | jq -r '.[0].pg_get_functiondef' > /tmp/provision_tenant_current.sql
wc -l /tmp/provision_tenant_current.sql
```

Expected: source dumped to /tmp for reference.

- [ ] **Step 2: Write migration 509**

Create `supabase/migrations/20261115000509_provision_tenant_env_param.sql`. This is a CREATE OR REPLACE that adds `p_environment TEXT DEFAULT 'production'` as the 8th param + writes to `tenants.environment` in the INSERT.

Read the current function body from /tmp/provision_tenant_current.sql. Then create the migration file with the same body but:
- Add `p_environment TEXT DEFAULT 'production'` as last param
- In the INSERT INTO tenants clause, add `environment` column with value `p_environment`
- Preserve all existing logic (owner user creation, tenant_subscriptions, tenant_users, admin_users, `_seed_tenant_accounting` trigger will fire)

```sql
-- Phase 1 Task 2 (2026-07-22): extend provision_tenant with p_environment.
-- Existing 7-arg signature backward-compat via default value.
-- Full body copied from current definition + env column added to INSERT.

CREATE OR REPLACE FUNCTION public.provision_tenant(
  p_owner_user_id UUID,
  p_slug TEXT,
  p_name TEXT,
  p_owner_name TEXT,
  p_owner_email TEXT,
  p_plan_code TEXT,
  p_expires_in_months INTEGER,
  p_environment TEXT DEFAULT 'production'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tenant_id UUID;
  v_result jsonb;
BEGIN
  -- [PASTE EXISTING BODY HERE — from /tmp/provision_tenant_current.sql]
  -- KEY CHANGE: the INSERT INTO tenants line becomes:
  --   INSERT INTO tenants (id, slug, name, environment, created_at)
  --   VALUES (v_tenant_id, p_slug, p_name, p_environment, NOW())
  --   RETURNING id INTO v_tenant_id;
  -- (or adjust to match current INSERT column order + add environment)

  -- All other logic (auth users, subscriptions, tenant_users, admin_users,
  -- _seed_tenant_accounting) unchanged.
  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.provision_tenant(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT)
  OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.provision_tenant(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_tenant(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT)
  TO authenticated;
```

**Note to implementer:** the exact body must be copied from the current dump. Don't hand-write it. Only change: add `p_environment` param + include `environment` column in INSERT.

- [ ] **Step 3: Apply via mgmt-api**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "$(jq -Rs '{query: .}' < supabase/migrations/20261115000509_provision_tenant_env_param.sql)"
```

Expected: `[]`. If error, read error message + adjust migration (usually a column-name typo).

- [ ] **Step 4: Verify new signature exists**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"SELECT proname, pg_get_function_identity_arguments(oid) AS args FROM pg_proc WHERE proname = '"'"'provision_tenant'"'"';"}' | jq -r '.[] | "\(.args)"'
```

Expected: shows the 8-arg signature ending with `p_environment text`.

- [ ] **Step 5: Track in schema_migrations**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('"'"'20261115000509'"'"','"'"'provision_tenant_env_param'"'"') ON CONFLICT DO NOTHING;"}'
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261115000509_provision_tenant_env_param.sql
git commit -m "[staging-prod-isolation] Task 2: provision_tenant accepts p_environment (mig 509)"
git push origin main
```

---

### Task 3: Hostname-aware `bootstrap_tenant_context` (migration 510) [ADVISOR GATE]

**Files:**
- Create: `supabase/migrations/20261115000510_bootstrap_tenant_context_hostname.sql`

**Interfaces:**
- Consumes: existing `bootstrap_tenant_context()` SECDEF RPC, `tenants.environment` (Task 1)
- Produces: `bootstrap_tenant_context(p_hostname TEXT DEFAULT NULL)` — filters tenants by env matching hostname

- [ ] **Step 1: advisor() gate — this touches auth path**

Present:
- Current + new function signature
- New logic (hostname → env mapping)
- Test smoke plan
- Advisor must confirm before proceeding.

Advisor prompt:
> "Modifying bootstrap_tenant_context (SECDEF, called on every login) to accept p_hostname param + filter tenants by env matching hostname. Mapping: staging.app.caleo.id + staging.admin.caleo.id → env='staging'; everything else → env='production'; NULL hostname → env='production' (backward compat). Risk: bad migration = login broken for all users. Mitigation: CREATE OR REPLACE, tested via smoke, rollback via previous migration replay. Approve?"

- [ ] **Step 2: Get current function source**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"SELECT pg_get_functiondef((SELECT oid FROM pg_proc WHERE proname = '"'"'bootstrap_tenant_context'"'"' LIMIT 1));"}' | jq -r '.[0].pg_get_functiondef' > /tmp/bootstrap_tenant_context_current.sql
```

- [ ] **Step 3: Write migration 510**

Create `supabase/migrations/20261115000510_bootstrap_tenant_context_hostname.sql`. Copy full body from current dump. Add:
- New optional param `p_hostname TEXT DEFAULT NULL` as first param (before existing params, if any)
- Compute `v_env`:
  ```sql
  v_env := CASE
    WHEN p_hostname IN ('staging.app.caleo.id', 'staging.admin.caleo.id') THEN 'staging'
    ELSE 'production'
  END;
  ```
- In the query that returns tenant(s), add `AND t.environment = v_env` to the WHERE clause

Preserve all other logic + owner (`vosi_rpc_owner`) + grants.

- [ ] **Step 4: Smoke test via DO block (rollback via RAISE)**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d @- <<'EOF'
{"query":"DO $t$ DECLARE v_user uuid; v_result jsonb; BEGIN SELECT tu.user_id INTO v_user FROM tenant_users tu WHERE tu.tenant_id = '11111111-1111-1111-1111-111111111111' LIMIT 1; PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user::text, 'role', 'authenticated')::text, true); EXECUTE 'SET LOCAL ROLE authenticated'; v_result := bootstrap_tenant_context('app.caleo.id'); IF v_result IS NULL OR (v_result->>'slug') IS NULL THEN RAISE EXCEPTION 'SMOKE FAIL: null result'; END IF; EXECUTE 'RESET ROLE'; RAISE EXCEPTION 'SMOKE PASS: result=%', v_result; END $t$;"}
EOF
```

Expected: `SMOKE PASS: result={...slug: garindo ...}` (rollback via RAISE).

- [ ] **Step 5: Apply migration**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "$(jq -Rs '{query: .}' < supabase/migrations/20261115000510_bootstrap_tenant_context_hostname.sql)"
```

Expected: `[]`

- [ ] **Step 6: Track schema_migrations**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('"'"'20261115000510'"'"','"'"'bootstrap_tenant_context_hostname'"'"') ON CONFLICT DO NOTHING;"}'
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261115000510_bootstrap_tenant_context_hostname.sql
git commit -m "[staging-prod-isolation] Task 3: bootstrap_tenant_context accepts p_hostname (mig 510)"
git push origin main
```

---

### Task 4: Seed 3 staging tenants + tenant_users links

**Files:**
- Create: `scripts/seed-staging-tenants.sh`

**Interfaces:**
- Consumes: `provision_tenant(..., p_environment='staging')` from Task 2
- Produces: 3 new tenant rows (`garindo-staging`, `toko-jaya-makmur-staging`, `warung-sinar-rezeki-staging`), auto-seeded COA + accounting_config via `_seed_tenant_accounting` trigger

- [ ] **Step 1: Write seed script**

Create `scripts/seed-staging-tenants.sh`:
```bash
#!/usr/bin/env bash
# One-shot seed: create 3 staging tenants mirroring the 3 prod tenants.
# Idempotent: skips tenants that already exist.

set -euo pipefail
source .env
SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-ekhhojaezdfjfwuxyjkl}"

FOUNDER_USER_ID="$(curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"SELECT id FROM auth.users WHERE email = '"'"'tonywei.office@gmail.com'"'"' LIMIT 1;"}' \
  | jq -r '.[0].id')"

TOKO_OWNER_ID="$(curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"SELECT id FROM auth.users WHERE email = '"'"'playwright-toko-owner@caleo.id'"'"' LIMIT 1;"}' \
  | jq -r '.[0].id')"

for TENANT in \
  "garindo-staging|Garindo Jaya Panel (Staging)|Owner Garindo|owner+garindo-staging@caleo.id|$FOUNDER_USER_ID" \
  "toko-jaya-makmur-staging|Toko Jaya Makmur (Staging)|Owner Toko|owner+toko-staging@caleo.id|$FOUNDER_USER_ID" \
  "warung-sinar-rezeki-staging|Warung Sinar Rezeki (Staging)|Owner Warung|owner+warung-staging@caleo.id|$FOUNDER_USER_ID"
do
  IFS='|' read -r slug name owner_name owner_email owner_id <<< "$TENANT"

  # Skip if exists
  EXISTS=$(curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
    -d "{\"query\":\"SELECT COUNT(*) FROM tenants WHERE slug = '$slug';\"}" | jq -r '.[0].count')
  if [ "$EXISTS" -gt 0 ]; then
    echo "SKIP $slug (already exists)"
    continue
  fi

  echo "Creating $slug ..."
  curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
    -d "{\"query\":\"SELECT provision_tenant('$owner_id'::uuid, '$slug', '$name', '$owner_name', '$owner_email', 'free', 12, 'staging');\"}"
  echo ""

  # Ensure playwright-toko-owner is member of toko-jaya-makmur-staging
  if [ "$slug" = "toko-jaya-makmur-staging" ]; then
    TENANT_ID=$(curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
      -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
      -d "{\"query\":\"SELECT id FROM tenants WHERE slug = '$slug';\"}" | jq -r '.[0].id')
    curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
      -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
      -d "{\"query\":\"INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ('$TENANT_ID', '$TOKO_OWNER_ID', 'owner') ON CONFLICT DO NOTHING;\"}"
  fi
done

echo "Done. Verify:"
curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"SELECT slug, environment FROM tenants ORDER BY environment DESC, created_at;"}' | jq -r '.[] | "\(.slug) | env=\(.environment)"'
```

- [ ] **Step 2: chmod + run**

```bash
chmod +x scripts/seed-staging-tenants.sh
./scripts/seed-staging-tenants.sh
```

Expected: 3 new staging tenants created, list shows 6 tenants total (3 production + 3 staging).

- [ ] **Step 3: Verify tenant_users links**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"SELECT t.slug, t.environment, au.email, tu.role FROM tenant_users tu JOIN tenants t ON t.id = tu.tenant_id JOIN auth.users au ON au.id = tu.user_id WHERE t.environment = '"'"'staging'"'"' ORDER BY t.slug;"}' | jq -r '.[] | "\(.slug) | env=\(.environment) | user=\(.email) | role=\(.role)"'
```

Expected: 4 rows (founder in all 3 staging, playwright-toko-owner in toko-jaya-makmur-staging).

- [ ] **Step 4: Commit script**

```bash
git add scripts/seed-staging-tenants.sh
git commit -m "[staging-prod-isolation] Task 4: seed 3 staging tenants + tenant_users links"
git push origin main
```

---

### Task 5: FE — bootstrap passes hostname

**Files:**
- Modify: `src/lib/tenantContextService.ts` — bootstrap() signature
- Modify: `src/components/SelectTenantScreen.tsx` — call site (if it invokes bootstrap directly)
- Modify: `src/components/AuthScreen.tsx` — already passes hostname to computePostLoginRoute (dc74cdb); add hostname to bootstrap call

**Interfaces:**
- Consumes: `bootstrap_tenant_context(p_hostname TEXT)` from Task 3
- Produces: FE always passes `window.location.hostname` when bootstrapping

- [ ] **Step 1: Read current tenantContextService bootstrap**

```bash
grep -n "bootstrap" src/lib/tenantContextService.ts | head -5
```

Note the current signature.

- [ ] **Step 2: Update bootstrap() signature**

Modify `src/lib/tenantContextService.ts`:
- Add optional `hostname?: string` param to bootstrap
- Pass to `supabase.rpc('bootstrap_tenant_context', { p_hostname: hostname })`
- Default (undefined) still works because RPC has `DEFAULT NULL` → env='production'

Exact edit depends on current code. Read the file first, then apply minimal change.

- [ ] **Step 3: Update AuthScreen caller (already exists per dc74cdb)**

`src/components/AuthScreen.tsx` line ~95 already calls `tenantContextService.bootstrap()`. Add hostname:

```typescript
const ctx = await tenantContextService.bootstrap(window.location.hostname);
```

- [ ] **Step 4: Update any other callers**

```bash
grep -rn "tenantContextService.bootstrap\|\.bootstrap()" src --include='*.ts' --include='*.tsx' | grep -v test
```

For each caller, add `window.location.hostname` arg.

- [ ] **Step 5: Add unit test**

`src/lib/tenantContextService.test.ts` (if exists) or new file — smoke test that hostname is forwarded to the RPC call.

- [ ] **Step 6: Local gates**

```bash
npm run lint
npm run audit:numinput
npm run audit:secdef-null-tenant
npx vitest run --changed
```

All must pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tenantContextService.ts src/components/AuthScreen.tsx src/components/SelectTenantScreen.tsx
git commit -m "[staging-prod-isolation] Task 5: FE passes hostname to bootstrap_tenant_context"
git push origin main
```

---

## Phase 2 — Deploy Gate

### Task 6: Remove auto-promote step from cloudbuild + add manual promote script

**Files:**
- Modify: `cloudbuild.frontend.yaml` — remove Step 6 (lines 209-244), add explanation comment
- Modify: `cloudbuild.yaml` — remove Step 6 (lines 109-134), add explanation comment
- Create: `scripts/promote-to-prod.sh`
- Create: `docs/runbooks/deploy-promote.md`

**Interfaces:**
- Consumes: existing prod deploy at `--no-traffic --tag=c$SHORT_SHA` (Step 5, unchanged)
- Produces: `scripts/promote-to-prod.sh <SHA>` manually promotes tag to 100% traffic; script also serves as rollback (use previous SHA)

- [ ] **Step 1: Modify cloudbuild.frontend.yaml — replace Step 6**

Find Step 6 (lines 209-244). Replace with:
```yaml
  # ── AUTO-PROMOTE REMOVED 2026-07-22 ─────────────────────────────────────────
  # Real tenant is onboarded; every prod deploy MUST require manual approval.
  # Prod tag revision deployed at 0% traffic by Step 5. Founder promotes
  # manually via `./scripts/promote-to-prod.sh <SHORT_SHA>`.
  # Do NOT add auto-promote step back without founder approval.
  # See docs/runbooks/deploy-promote.md + memory
  # feedback_manual_prod_gate_after_real_tenant.
```

- [ ] **Step 2: Modify cloudbuild.yaml — replace Step 6**

Same pattern. Find Step 6 (lines 109-134). Replace with the same comment block above.

- [ ] **Step 3: Write promote-to-prod.sh**

Create `scripts/promote-to-prod.sh`:
```bash
#!/usr/bin/env bash
# Manual prod promote / rollback script.
#
# Promotes the specified SHORT_SHA to 100% traffic on both FE + BE prod
# services. Same script works for rollback — pass a previous good SHA.
#
# Usage:
#   ./scripts/promote-to-prod.sh <SHORT_SHA>       # e.g. dc74cdb
#
# Cloud Run tag URLs stay accessible for ~7 days:
#   https://c<SHORT_SHA>---garindo-jaya-panel-msme-erp-frontend-xnrhcw7onq-as.a.run.app
#   https://c<SHORT_SHA>---garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app
#
# Verify tag URLs return 200 BEFORE promoting.

set -euo pipefail

SHA="${1:?Usage: $0 <7-char SHORT_SHA>}"
if [ "${#SHA}" -ne 7 ]; then
  echo "ERROR: SHA must be exactly 7 characters (got '$SHA', ${#SHA} chars)"
  exit 1
fi

REGION="asia-southeast1"
FE_SERVICE="garindo-jaya-panel-msme-erp-frontend"
BE_SERVICE="garindo-jaya-panel-msme-erp"
TAG="c$SHA"

echo "=== Promote-to-prod ==="
echo "SHA:  $SHA (tag: $TAG)"
echo "FE:   $FE_SERVICE"
echo "BE:   $BE_SERVICE"
echo ""

# Verify tag URLs healthy first
FE_URL="https://$TAG---$FE_SERVICE-xnrhcw7onq-as.a.run.app"
BE_URL="https://$TAG---$BE_SERVICE-xnrhcw7onq-as.a.run.app/api/v1/live"

echo "Verifying $FE_URL ..."
FE_CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "$FE_URL" || echo 000)
echo "  FE tag URL: HTTP $FE_CODE"

echo "Verifying $BE_URL ..."
BE_CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "$BE_URL" || echo 000)
echo "  BE tag URL: HTTP $BE_CODE"

if [ "$FE_CODE" != "200" ] || [ "$BE_CODE" != "200" ]; then
  echo ""
  echo "ABORT: tag URLs not both 200. Investigate before promoting."
  echo "Rollback? Run this same script with a previous known-good SHA."
  exit 1
fi

echo ""
echo "Promoting $TAG to 100% traffic on both services ..."
gcloud run services update-traffic "$FE_SERVICE" --region="$REGION" --to-tags="$TAG=100"
gcloud run services update-traffic "$BE_SERVICE" --region="$REGION" --to-tags="$TAG=100"

echo ""
echo "=== Done ==="
echo "Prod FE now serving: $TAG"
echo "Prod BE now serving: $TAG"
echo ""
echo "Verify app.caleo.id (FE) + backend health:"
echo "  curl -sS -o /dev/null -w '%{http_code}\\n' https://app.caleo.id/"
echo "  curl -sS -o /dev/null -w '%{http_code}\\n' https://garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app/api/v1/live"
echo ""
echo "Rollback (if needed): re-run this script with previous SHA."
```

Make executable: `chmod +x scripts/promote-to-prod.sh`

- [ ] **Step 4: Write runbook**

Create `docs/runbooks/deploy-promote.md`:
```markdown
# Deploy to Production — Runbook

## Normal deploy flow

1. Push code to `main` (or merge PR)
2. Wait ~10 min. Cloud Build fires two triggers:
   - `sinar-elektrik-frontend` (frontend)
   - `rmgpgab-sinar-elektrik-msme-erp-asia-southeast1-tonyabaddon-anv` (backend)
3. Both auto-deploy to STAGING + auto-run smoke tests.
4. GCP emails you build result (SUCCESS or FAILURE).
5. Test at `https://staging.app.caleo.id/` — verify feature works.
6. Also verify tag URLs directly:
   - FE: `https://c<SHORT_SHA>---garindo-jaya-panel-msme-erp-frontend-xnrhcw7onq-as.a.run.app`
   - BE: `https://c<SHORT_SHA>---garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app/api/v1/live`
7. OK to ship? Run:
   ```bash
   ./scripts/promote-to-prod.sh <7-char SHA>
   ```
   Script verifies tag URLs return 200, then flips 100% traffic on both services.
   Takes ~5 seconds.

## Rollback

If prod breaks post-promote: re-run same script with a previous known-good SHA:
```bash
./scripts/promote-to-prod.sh <previous-good-SHA>
```
Cloud Run keeps tags for ~7 days, so any recent commit's tag URL is still promotable.

## Migration deploys

Migrations bypass Cloud Build — they apply directly to prod DB via mgmt-api or
`scripts/apply-migration.sh`. Before applying to prod:
- Write SQL smoke test in `tests/sql/qa-week/<name>-regression.sql`
- Use `DO $ ... RAISE EXCEPTION 'ROLLBACK'; END $` pattern to test without committing
- Only apply after smoke passes

## Troubleshooting

- **Cloud Build FAILURE at staging deploy?** Check GCP build log. Often
  Supabase :5432 pool exhaustion — see `docs/incidents/2026-07-20-*.md`.
- **Promote script aborts with "tag URLs not both 200"?** Tag revision failed
  to boot. Check Cloud Run revision logs for the tag.
- **Prod BE unhealthy after promote?** Immediately rollback:
  `./scripts/promote-to-prod.sh <previous-SHA>`. Investigate at your pace.
```

- [ ] **Step 5: Write memory HARD RULE**

Create `/Users/tonywei/.claude/projects/-Users-tonywei-IdeaProjects-ERPAntigravity/memory/feedback_manual_prod_gate_after_real_tenant.md`:
```markdown
---
name: manual-prod-gate-after-real-tenant
description: "HARD RULE: after real tenant onboarded (2026-07-XX), every prod deploy MUST be manual via scripts/promote-to-prod.sh. Cloudbuild auto-promote step permanently removed. Any request to re-enable auto-promote requires explicit founder approval FIRST."
metadata:
  type: feedback
---

**HARD RULE (founder 2026-07-22):** after real tenant onboards, prod deploy
MUST be manual-gated via `scripts/promote-to-prod.sh <SHA>`. Cloudbuild
auto-promote step (Step 6 of `cloudbuild.frontend.yaml` + `cloudbuild.yaml`)
permanently removed. Prod tag revision deploys at 0% traffic in Step 5;
founder promotes manually.

**Why:** real tenant depends on prod stability. Bugs in main can no longer
auto-reach real tenant — they get caught at staging first.

**How to apply:**
- If PR touches `cloudbuild.frontend.yaml` or `cloudbuild.yaml` proposing to
  re-enable auto-promote: **ASK FOUNDER FIRST**. Do not merge without
  explicit approval.
- If PR removes the AUTO-PROMOTE REMOVED comment block from either
  cloudbuild file, escalate.
- Runbook: `docs/runbooks/deploy-promote.md`.

Related: [[feedback-app-caleo-routes-to-tenant-not-admin]] — same pattern of
founder-approval-first for prod-facing infra changes.
```

Add index entry to `MEMORY.md` (top of file).

- [ ] **Step 6: Update MEMORY.md**

```bash
# Add new memory to top of index
```

Read current MEMORY.md, prepend new entry:
```
- [Manual prod gate after real tenant](feedback_manual_prod_gate_after_real_tenant.md) — HARD RULE: prod deploy MUST be manual via scripts/promote-to-prod.sh. Cloudbuild auto-promote removed. Any request to re-enable requires founder approval FIRST.
```

- [ ] **Step 7: Commit all Phase 2 changes**

```bash
git add cloudbuild.frontend.yaml cloudbuild.yaml scripts/promote-to-prod.sh docs/runbooks/deploy-promote.md
git commit -m "[staging-prod-isolation] Task 6: manual prod deploy gate + promote script + runbook"
git push origin main
```

**Note:** This is the LAST auto-promoted push. After this commit's Cloud Build cascade completes (including auto-promote of Step 6-removal itself), all future pushes require manual promote.

---

## Phase 3 — E2E Verify + Real Tenant Onboard

### Task 7: Push no-op commit + verify manual gate works

**Files:**
- Modify: `.superpowers/sdd/progress.md` — one-line entry to trigger a build

- [ ] **Step 1: Push a no-op docs commit**

```bash
git commit --allow-empty -m "[staging-prod-isolation] Task 7: no-op trigger to verify manual gate active"
git push origin main
```

- [ ] **Step 2: Watch Cloud Build**

```bash
gcloud builds list --limit=2 --format='table(substitutions.SHORT_SHA,substitutions.TRIGGER_NAME,status,duration)'
```

Wait 10-15 min. Expected: both FE + BE builds SUCCESS. Prod tag revision created but NOT at 100% traffic.

- [ ] **Step 3: Verify prod tag revision exists at 0% traffic**

```bash
gcloud run services describe garindo-jaya-panel-msme-erp-frontend --region=asia-southeast1 --format=json | jq -r '.status.traffic[] | select(.tag == "c<NEW_SHA>") | "\(.revisionName) tag=\(.tag) percent=\(.percent)"'
```

Expected: entry with `percent=null` or `percent=0` (not serving traffic) — proves auto-promote is disabled.

- [ ] **Step 4: Run promote script**

```bash
./scripts/promote-to-prod.sh <NEW_SHA>
```

Expected: script verifies tag URLs 200 → promotes → done in ~5 sec.

- [ ] **Step 5: Verify prod now on new SHA**

```bash
gcloud run services describe garindo-jaya-panel-msme-erp-frontend --region=asia-southeast1 --format=json | jq -r '.status.traffic[] | select(.percent > 0) | "FE: \(.revisionName) tag=\(.tag) percent=\(.percent)"'
```

Expected: `FE: ... tag=c<NEW_SHA> percent=100`

- [ ] **Step 6: Rollback test (optional but recommended)**

Get previous SHA (git log --oneline -3). Run:
```bash
./scripts/promote-to-prod.sh <PREVIOUS_SHA>
```

Verify prod reverts. Then promote back to new SHA to restore.

- [ ] **Step 7: Log outcome in progress.md** (batched with Task 8 commit)

---

### Task 8: Multi-tenant matrix + hostname isolation smoke

**Files:**
- Create: `tests/sql/qa-week/staging-prod-isolation-regression.sql`
- Create: `tests/e2e/tests/qa-week/t21-staging-prod-isolation.spec.ts`

**Interfaces:**
- Consumes: 6 tenants (3 prod + 3 staging) from Task 4; bootstrap_tenant_context hostname param from Task 3
- Produces: 2 test files that pass, providing regression coverage

- [ ] **Step 1: Write SQL matrix regression test**

Create `tests/sql/qa-week/staging-prod-isolation-regression.sql`:
```sql
-- Staging/Prod isolation regression test.
-- Covers: (a) 3 prod tenants × 6 tables cross-check = 48 attempts (existing pattern);
--         (b) 1 cross-env spot check: staging user query prod tenant → 0 rows expected.

DO $t$
DECLARE
  v_tenants uuid[] := ARRAY[
    '11111111-1111-1111-1111-111111111111'::uuid,
    '22222222-2222-2222-2222-222222222222'::uuid,
    '49cbbc94-977c-4bc4-bf9b-0195342f1608'::uuid
  ];
  v_tables text[] := ARRAY[
    'customers','purchase_invoices','pembayaran','journal_entries',
    'kasir_transactions','bank_accounts','audit_log','warehouse_transfers'
  ];
  v_user uuid;
  v_read_leak int;
  v_total_leaks int := 0;
  v_cross_env_leak int;
  v_staging_tenant_id uuid;
  v_staging_user uuid;
  i int; j int; k int;
BEGIN
  -- Part A: existing 48-check matrix (3 prod tenants × 8 tables × 2 cross-pairs = 48)
  FOR i IN 1..3 LOOP
    SELECT tu.user_id INTO v_user FROM tenant_users tu WHERE tu.tenant_id = v_tenants[i] LIMIT 1;
    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub', v_user::text, 'tenant_id', v_tenants[i]::text, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    FOR j IN 1..3 LOOP
      IF i = j THEN CONTINUE; END IF;
      FOR k IN 1..array_length(v_tables, 1) LOOP
        EXECUTE format('SELECT COUNT(*) FROM %I WHERE tenant_id = %L', v_tables[k], v_tenants[j]) INTO v_read_leak;
        IF v_read_leak > 0 THEN v_total_leaks := v_total_leaks + 1; END IF;
      END LOOP;
    END LOOP;
    EXECUTE 'RESET ROLE';
  END LOOP;

  -- Part B: cross-env spot check — staging user reads prod tenant data
  SELECT id INTO v_staging_tenant_id FROM tenants WHERE slug = 'garindo-staging';
  SELECT user_id INTO v_staging_user FROM tenant_users WHERE tenant_id = v_staging_tenant_id LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_staging_user::text, 'tenant_id', v_staging_tenant_id::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE format('SELECT COUNT(*) FROM customers WHERE tenant_id = %L', v_tenants[1]) INTO v_cross_env_leak;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'MATRIX_TOTAL_LEAKS=%; CROSS_ENV_LEAK=% (both should be 0)', v_total_leaks, v_cross_env_leak;
END $t$;
```

- [ ] **Step 2: Run SQL regression**

```bash
source .env
SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-ekhhojaezdfjfwuxyjkl}"
curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "$(jq -Rs '{query: .}' < tests/sql/qa-week/staging-prod-isolation-regression.sql)"
```

Expected error message: `MATRIX_TOTAL_LEAKS=0; CROSS_ENV_LEAK=0 (both should be 0)`

If nonzero, HALT + investigate.

- [ ] **Step 3: Write Playwright E2E**

Create `tests/e2e/tests/qa-week/t21-staging-prod-isolation.spec.ts`:
```typescript
/**
 * T21 — Staging/Prod isolation (post-Phase-3).
 *
 * Verifies:
 *   A1 — Login at staging.app.caleo.id → tenant picker shows only 3 staging tenants
 *   A2 — Login at app.caleo.id → tenant picker shows only 3 production tenants
 *   A3 — Cross-env leak: staging JWT PostgREST query returns 0 rows from prod tenant
 */
import { test, expect } from '../../fixtures/auth';

const STAGING_TENANTS = ['garindo-staging', 'toko-jaya-makmur-staging', 'warung-sinar-rezeki-staging'];
const PROD_TENANTS = ['garindo', 'toko-jaya-makmur', 'warung-sinar-rezeki'];

test.describe('T21 — Staging/Prod tenant picker isolation', () => {
  test.setTimeout(120_000);

  test('A1 — staging.app.caleo.id shows only staging tenants in picker', async ({ tenantPage }) => {
    await tenantPage.goto('https://staging.app.caleo.id/select-tenant', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await tenantPage.waitForTimeout(3000);
    const bodyText = (await tenantPage.locator('body').textContent()) || '';
    for (const staging of STAGING_TENANTS) {
      expect(bodyText).toContain(staging.replace(/-/g, ' ').replace(/staging/i, ''));  // loose match
    }
    for (const prod of PROD_TENANTS) {
      // Prod tenant slugs should NOT appear in staging picker
      expect(bodyText).not.toMatch(new RegExp(`\\b${prod}\\b(?!-staging)`, 'i'));
    }
  });

  test('A2 — app.caleo.id shows only production tenants in picker', async ({ tenantPage }) => {
    await tenantPage.goto('https://app.caleo.id/select-tenant', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await tenantPage.waitForTimeout(3000);
    const bodyText = (await tenantPage.locator('body').textContent()) || '';
    for (const staging of STAGING_TENANTS) {
      expect(bodyText).not.toContain(staging);
    }
  });
});
```

- [ ] **Step 4: Run Playwright**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
set -a && source .env && set +a
cd tests/e2e && npx playwright test tests/qa-week/t21-staging-prod-isolation.spec.ts --project=chromium --config=playwright.prod.config.ts
```

Expected: 2 tests pass. (A3 SQL cross-env leak already covered in Task 8 Step 2's SQL regression.)

- [ ] **Step 5: Commit tests**

```bash
git add tests/sql/qa-week/staging-prod-isolation-regression.sql tests/e2e/tests/qa-week/t21-staging-prod-isolation.spec.ts
git commit -m "[staging-prod-isolation] Task 8: matrix regression + Playwright hostname isolation smoke"
git push origin main
```

**Manual promote:** kamu (founder) must run `./scripts/promote-to-prod.sh <SHA>` for this commit to reach prod. Log a note in progress.md.

---

### Task 9: Real tenant onboard

**Files:** none (founder action)

**Prerequisite:** Tasks 1-8 shipped + Task 8 manually promoted.

**Interfaces:**
- Consumes: `provision_tenant(..., p_environment='production')` from Task 2

- [ ] **Step 1: Founder decides tenant details**

Slug, name, owner name, owner email. Note: owner email must correspond to
existing `auth.users` row (create via Supabase Auth Admin API first if not).

- [ ] **Step 2: Provision real tenant via admin.caleo.id UI OR direct RPC**

Via admin UI: navigate to `admin.caleo.id/admin/tenants` → "Provision new tenant"

Or via mgmt-api:
```bash
source .env
SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-ekhhojaezdfjfwuxyjkl}"
curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "{\"query\":\"SELECT provision_tenant('<owner-user-uuid>'::uuid, '<slug>', '<name>', '<owner name>', '<owner-email>', 'free', 12, 'production');\"}"
```

- [ ] **Step 3: Verify new tenant only visible at app.caleo.id**

Login as new tenant owner via `https://app.caleo.id/` → should see new tenant in picker.
Login as same owner via `https://staging.app.caleo.id/` → should NOT see new tenant (env filter).

- [ ] **Step 4: If issue → rollback**

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "{\"query\":\"SELECT deprovision_tenant('<new-tenant-uuid>');\"}"
```

- [ ] **Step 5: Update progress.md + phase-2-report.md**

Append entry noting real tenant onboarded, env='production', isolated from staging.

```bash
git add docs/qa-week/phase-2-report.md .superpowers/sdd/progress.md
git commit -m "[staging-prod-isolation] Task 9: real tenant onboarded (Phase 3 complete)"
```

**NOTE:** this commit ALSO requires manual promote via `./scripts/promote-to-prod.sh <SHA>` — because Phase 2 gate is now active for ALL commits.

---

## Advisor consulted

Real advisor call before writing this plan (2026-07-22). Key inputs:
- Reframed Phase 1 vs Phase 2 order: data isolation first (safe under auto-deploy since no real tenant), deploy gate second (right before real tenant onboards).
- Cut over-engineering: single promote script (rollback via same script + previous SHA), matrix 48+1 not 240 (RLS behavior unchanged between prod/staging tenants).
- Confirmed "no over-engineering" pattern aligns with founder memories (no_approval_workflow, defer_sop_profile, direct_launch_skip_phased).

## I verified

- ✅ Migration slots 508/509/510 free (507 = P3-05 already applied)
- ✅ `provision_tenant(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER)` exists — 7 args, need to extend to 8
- ✅ `bootstrap_tenant_context` exists as SECDEF owned by vosi_rpc_owner
- ✅ `_seed_tenant_accounting` trigger fires on new tenant → COA + accounting_config auto-seeded
- ✅ cloudbuild.frontend.yaml Step 6 lines 209-244 = auto-promote (to remove)
- ✅ cloudbuild.yaml Step 6 lines 109-134 = auto-promote (to remove)
- ✅ Step 5 in both files (deploy at 0% + tag) stays — provides the tag URL for manual promote script
- ✅ deprovision_tenant exists (migration 000035) — Task 9 Step 4 rollback available
- ✅ Existing users: tonywei.office@gmail.com (platform admin, Garindo), playwright-toko-owner (Toko Jaya) — Task 4 seeds their staging links

## Adversarial critique

- **(a) `provision_tenant` change breaks Cloud Run backend or admin UI callers.** New signature backward-compat via `DEFAULT 'production'`; existing 7-arg callers unchanged. ✅
- **(b) `bootstrap_tenant_context` change breaks login for all users.** CREATE OR REPLACE; hostname param defaults to NULL (backward compat = production); Task 3 Step 4 SQL smoke via RAISE-rollback before applying. If migration fails, rollback via previous migration replay.
- **(c) Task 4 seed script hangs on `provision_tenant` due to `_seed_tenant_accounting` trigger.** Trigger is proven from Phase 1 production (already fired 3× when the 3 real tenants were created). No new risk.
- **(d) FE bootstrap change breaks existing sessions.** Existing sessions in localStorage don't re-call bootstrap. First reload → new bootstrap with hostname → picker filters correctly. No hard break.
- **(e) Task 6 removes auto-promote — this commit itself is the LAST auto-promoted commit.** Verified in Task 7 (no-op push → cascade completes → prod on Task 6 code) → subsequent pushes need manual gate. Sequence documented in Phase 2 spec section.
- **(f) Between Task 6 ship and Task 9 ship, prod auto-deploys (Task 7 no-op + Task 8 tests) still land at 0% traffic + tag.** Founder promote script needed to reach prod. Safe — real tenant not yet onboarded (Task 9 explicit prerequisite).
- **(g) Promote script hardcodes both service names.** Works for current setup. If tenant multi-frontend (per-tenant Cloud Run) ever needed, revisit.
- **(h) Cross-env leak test (Task 8 SQL Part B) only tests customers table.** For depth, could add more tables. Current spot-check confirms env filter working at PostgREST level. RLS behavior same for all tables; not multiplying is intentional per matrix-scope cut.
- **(i) Playwright t21 fragile string-match for tenant names in picker.** Uses loose `.replace()` transforms + regex negative lookahead. If picker UI copy changes, test needs update. Documented as maintenance debt.
- **(j) Founder may forget to promote — code sits at 0% traffic indefinitely.** Runbook explicit: promote script is REQUIRED to reach prod. GCP email notifies on build success. If forgotten, no user impact (just stale prod), so low-severity.
- **(k) Migration 510 has hardcoded hostname strings.** Add note to memory `feedback_app_caleo_routes_to_tenant_not_admin` referring to the 4-hostname model. Only 2 hostnames listed as "staging" surface. If domain names ever change, migration needs update (rare).

## Self-review

- Spec coverage: ✅ Phase 1 → Tasks 1-5. Phase 2 → Task 6. Phase 3 → Tasks 7-9. Phase 4 = ongoing (no tasks).
- Placeholder scan: some `<SHA>` and `<NEW_SHA>` placeholders in Task 7/9 are user-provided runtime values (not TODOs) — acceptable.
- Type consistency: `p_environment TEXT DEFAULT 'production'` used consistently across Tasks 2, 4, 9. `bootstrap_tenant_context(p_hostname TEXT DEFAULT NULL)` used consistently in Tasks 3, 5.
- Task 2 Step 2 references `/tmp/provision_tenant_current.sql` which Task 2 Step 1 writes — properly ordered.

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-22-staging-prod-isolation-plan.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
