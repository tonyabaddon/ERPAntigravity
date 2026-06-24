# Cloud Run Promote Runbook — Frontend

**TL;DR:** After merging a frontend PR to `main`, Cloud Build deploys the new revision at **0% traffic** by design. You MUST manually promote it. If you forget, prod stays on the previous revision — the merge does nothing user-visible.

## Why `--no-traffic`?

`cloudbuild.frontend.yaml:44` pins `--no-traffic` deliberately. Root cause: 2026-06-16 Produk & Stok regression — an auto-traffic-shift deployed a revision built from a `main` HEAD that included an unmerged WIP branch. The current pattern (deploy revision + create per-commit tag URL → smoke → promote) prevents that class of regression. **Do not remove the flag without re-litigating the trade-off** (see comment block at `cloudbuild.frontend.yaml:32-43`).

## After every merge to `main` that touches frontend code

1. **Wait for Cloud Build to finish** (~5-7 min from merge). Status:
   ```bash
   gcloud builds list --limit=3 --format="table(id,createTime.date('%H:%M'),status,duration)"
   ```
   Look for STATUS=SUCCESS for the build triggered at the merge commit's timestamp.

2. **Identify the new revision name.** It's the latest one not yet receiving traffic:
   ```bash
   gcloud run services describe garindo-jaya-panel-msme-erp-frontend \
     --region=asia-southeast1 \
     --format="value(status.latestReadyRevisionName)"
   ```
   Example output: `garindo-jaya-panel-msme-erp-frontend-00195-vaq`

3. **(Optional but recommended) Smoke the tag URL** before promoting:
   ```
   https://c<SHORT_SHA>---garindo-jaya-panel-msme-erp-frontend-xnrhcw7onq-as.a.run.app
   ```
   Where `<SHORT_SHA>` is the first 7 chars of the merge commit (e.g., `cfcc7403` for commit `fcc7403`). The build pipeline auto-tags every revision this way.

4. **Promote to 100% traffic:**
   ```bash
   gcloud run services update-traffic garindo-jaya-panel-msme-erp-frontend \
     --region=asia-southeast1 \
     --to-revisions=garindo-jaya-panel-msme-erp-frontend-XXXXX-yyy=100
   ```
   Replace `XXXXX-yyy` with the revision name from step 2.

5. **Verify:**
   ```bash
   gcloud run services describe garindo-jaya-panel-msme-erp-frontend \
     --region=asia-southeast1 \
     --format="value(spec.traffic[?percent==100][0].revisionName)"
   ```
   Should match the revision you just promoted.

6. Hard-refresh prod URL in browser (`Cmd+Shift+R`) to bypass HTTP cache.

## Quick rollback

If the promoted revision misbehaves, route back to the previous one:
```bash
gcloud run services update-traffic garindo-jaya-panel-msme-erp-frontend \
  --region=asia-southeast1 \
  --to-revisions=garindo-jaya-panel-msme-erp-frontend-<PREV_REV>=100
```

The previous revision is preserved in Cloud Run (the per-commit tag URL still works). Rollback is instant — no rebuild needed.

## Why not automate this?

Three reasons we keep the manual step:
1. The 2026-06-16 incident showed auto-promote silently routes buggy main HEAD builds.
2. The smoke-on-tag-URL step is the natural place to verify before exposure.
3. CI smoke tests against an ephemeral Cloud Run URL is a heavier investment than the current process needs.

If steps 1-5 start consuming meaningful time across many merges, consider building a CI step that promotes only after an automated smoke pass against the tag URL. Until then, this runbook is the workflow.

## Related files

- `cloudbuild.frontend.yaml` — the deploy config with the `--no-traffic` guard
- `cloudbuild.yaml` — backend Go service (separate trigger, separate promote — same pattern applies)
