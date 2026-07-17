# Staging Deploy SOP

**Last updated**: 2026-07-17
**Status**: Active (Phase 1 finalization, Sub E)

---

## Founder workflow (normal path)

```
git push origin main
       ↓
Cloud Build triggered (trigger: sinar-elektrik-frontend + rmgpgab-sinar-elektrik-msme-erp-*)
       ↓
Step 0: CI gate (lint + audit:numinput + audit:secdef-null-tenant + vitest)
       ↓ (fails here = no deploy, no broken artifact)
Step 1: docker build (single image — backend URL resolved at runtime)
Step 2: docker push to Artifact Registry
       ↓
Step 3: Deploy to STAGING (garindo-jaya-panel-msme-erp-frontend-staging / -backend-staging)
       ↓
Step 4: Automated smoke tests
   BE curl: FE root 200, BE /live 200, BE /ready 200, bundle present
   Playwright: T1 FE loads no JS errors, T2 login renders, T4 BE /ready 200
       ↓ (fails here = prod NOT deployed, staging has broken revision)
Step 5: Deploy same image SHA to PROD (--no-traffic --tag=c<SHORT_SHA>)
Step 6: Prod tag-URL smoke → promote to 100% traffic
```

**Zero manual steps required** on the green path.

---

## URLs

| Environment | URL | Cloud Run Service |
|---|---|---|
| Prod FE | https://app.caleo.id | garindo-jaya-panel-msme-erp-frontend |
| Prod Admin | https://admin.caleo.id | garindo-jaya-panel-msme-erp-frontend |
| Prod BE | (internal Cloud Run URL) | garindo-jaya-panel-msme-erp |
| Staging FE | https://staging.app.caleo.id | garindo-jaya-panel-msme-erp-frontend-staging |
| Staging Admin | https://staging.admin.caleo.id | garindo-jaya-panel-msme-erp-frontend-staging |
| Staging BE | (internal Cloud Run URL) | garindo-jaya-panel-msme-erp-staging |

Direct Cloud Run URLs (bypass custom domain, useful before DNS propagates):
- Staging FE: https://garindo-jaya-panel-msme-erp-frontend-staging-422860632808.asia-southeast1.run.app
- Staging BE: https://garindo-jaya-panel-msme-erp-staging-422860632808.asia-southeast1.run.app

---

## Rollback procedure

### Option 1: Traffic rollback (30 seconds, data-safe)

Rolls traffic to a previous revision without touching code or images.

```bash
# List revisions (most recent first)
CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.13 gcloud run revisions list \
  --service=garindo-jaya-panel-msme-erp-frontend \
  --region=asia-southeast1 \
  --project=gen-lang-client-0410251117 \
  --format="table(metadata.name,status.observedGeneration,status.conditions[0].status)"

# Roll traffic to a specific previous revision
CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.13 gcloud run services update-traffic \
  garindo-jaya-panel-msme-erp-frontend \
  --to-revisions=<PREVIOUS_REVISION_NAME>=100 \
  --region=asia-southeast1 \
  --project=gen-lang-client-0410251117
```

Same pattern for backend (`garindo-jaya-panel-msme-erp`).

### Option 2: Git revert (5-10 minutes including build)

```bash
git revert HEAD --no-edit
git push origin main
# Cloud Build runs full pipeline, previous code gets deployed
```

Use Option 1 for immediate user impact. Use Option 2 when the revert is the right long-term fix.

---

## Failure debugging

### "CI gate failed" (Step 0)

Check Cloud Build logs for the failing lint/audit/test step. Fix locally:
```bash
npm run lint
npm run audit:numinput
npm run audit:secdef-null-tenant
npm test
```

### "Smoke tests failed" (Step 4)

1. Check staging URLs directly:
   - `curl https://garindo-jaya-panel-msme-erp-frontend-staging-422860632808.asia-southeast1.run.app/`
   - `curl https://garindo-jaya-panel-msme-erp-staging-422860632808.asia-southeast1.run.app/api/v1/ready`
2. Run manual smoke: `./scripts/staging-smoke.sh`
3. Run Playwright locally: `cd tests/e2e && npx playwright test --config=playwright.staging.config.ts`
4. Check Cloud Run logs:
   ```bash
   CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.13 gcloud beta run revisions logs \
     --service=garindo-jaya-panel-msme-erp-frontend-staging \
     --region=asia-southeast1 \
     --project=gen-lang-client-0410251117 \
     --limit=50
   ```
5. Fix the issue, push again. Staging holds the broken revision — prod is unaffected.

### "Prod smoke failed" (Step 6)

Prod revision was deployed at 0% traffic (tag URL). Traffic stayed on previous revision.

1. Investigate: `https://c<SHORT_SHA>---garindo-jaya-panel-msme-erp-frontend-<hash>.run.app`
2. Fix and re-push, OR manual rollback (Option 1 above).
3. Broken revision stays at 0% — safe to investigate at your pace.

---

## Emergency: skip staging (prod-direct override)

ONLY for production incidents where you need to push a hotfix faster than the full pipeline.

**Safety warning**: This bypasses smoke tests. Use only when prod is broken and staging gate is the bottleneck.

```bash
# Deploy directly to prod (skips staging smoke)
CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.13 gcloud run deploy garindo-jaya-panel-msme-erp-frontend \
  --image=asia-southeast1-docker.pkg.dev/gen-lang-client-0410251117/cloud-run-source-deploy/garindo-jaya-panel-msme-erp-frontend:<COMMIT_SHA> \
  --region=asia-southeast1 \
  --project=gen-lang-client-0410251117 \
  --platform=managed \
  --allow-unauthenticated \
  --no-traffic \
  --tag=hotfix

# Verify tag URL
curl -sf https://hotfix---garindo-jaya-panel-msme-erp-frontend-<hash>.run.app/

# If good, promote
CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.13 gcloud run services update-traffic \
  garindo-jaya-panel-msme-erp-frontend \
  --to-tags=hotfix=100 \
  --region=asia-southeast1 \
  --project=gen-lang-client-0410251117
```

After the incident: log in `docs/incidents/`, document why staging bypass was needed.

---

## Test tenant discipline

| Tenant | ID | Use |
|---|---|---|
| Toko Jaya Makmur | 22222222-2222-2222-2222-222222222222 | Staging tests + prod staging-area |
| Warung Sinar Rezeki | 49cbbc94-977c-4bc4-bf9b-0195342f1608 | Staging tests |
| Garindo Jaya Panel | 11111111-1111-1111-1111-111111111111 | **PROD ONLY** — never use for staging |

Playwright tests use staging BE which hits the same Supabase DB. Tests should only create/modify data under Toko Jaya Makmur or Warung Sinar Rezeki — never under Garindo Jaya Panel.

---

## Runtime URL resolution

Backend URL is resolved at **runtime** from `window.location.hostname` (see `src/lib/backendUrl.ts`). No env var baked into the bundle at build time.

| Hostname | Backend |
|---|---|
| staging.app.caleo.id | garindo-jaya-panel-msme-erp-staging-422860632808.asia-southeast1.run.app |
| staging.admin.caleo.id | garindo-jaya-panel-msme-erp-staging-422860632808.asia-southeast1.run.app |
| app.caleo.id | garindo-jaya-panel-msme-erp-422860632808.asia-southeast1.run.app |
| admin.caleo.id | garindo-jaya-panel-msme-erp-422860632808.asia-southeast1.run.app |
| localhost | `VITE_BACKEND_URL` env var (dev fallback) |

If you add a new custom domain, update `HOSTNAME_TO_BACKEND` in `src/lib/backendUrl.ts`.

---

## Known deferred items

- **T4 + T5 Playwright tests** (platform_admin session injection): skip until Sub D (Secret Manager move). The service key needs to be in Secret Manager before we inject Supabase sessions in CI.
- **T3 test in Cloud Build**: The admin-subdomain redirect test is only meaningful against the real `staging.admin.caleo.id` hostname. Once SSL provisions (15-45 min post-mapping creation), Cloud Build will test it using the real domain. When testing locally with direct Cloud Run URL, T3 auto-skips.
- **Separate Supabase project for staging**: deferred to Phase 3+ (50+ tenants threshold per plan). Currently same Supabase project with test tenants.
