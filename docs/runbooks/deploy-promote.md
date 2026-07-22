# Deploy to Production — Runbook

## Normal deploy flow

1. Push code to `main` (or merge PR)
2. Wait ~10 min. Cloud Build fires two triggers:
   - `sinar-elektrik-frontend` (frontend)
   - `rmgpgab-sinar-elektrik-msme-erp-asia-southeast1-tonyabaddon-anv` (backend)
3. Both auto-deploy to STAGING + auto-run smoke tests.
4. GCP emails you build result (SUCCESS or FAILURE).
5. Test at `https://staging.app.caleo.id/` — verify feature works.
6. Also verify prod tag URLs directly (deployed at 0% traffic):
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

Migrations bypass Cloud Build — they apply directly to prod DB via
`supabase/management/database/migrations` endpoint or `scripts/apply-migration.sh`.
Before applying to prod:

- Write SQL smoke test as `DO $ ... RAISE EXCEPTION 'ROLLBACK'; END $` pattern
- Set fake JWT via `set_config('request.jwt.claim.sub', ...)` for auth-gated RPCs
- Only apply after smoke passes

## Troubleshooting

- **Cloud Build FAILURE at staging deploy?** Check GCP build log. Often
  Supabase `:5432` pool exhaustion — see `docs/incidents/2026-07-20-*.md` and
  `docs/incidents/2026-07-21-*.md`.
- **Promote script aborts with "tag URLs not both 200"?** Tag revision failed
  to boot. Check Cloud Run revision logs for the tag.
- **Prod BE unhealthy after promote?** Immediately rollback:
  `./scripts/promote-to-prod.sh <previous-SHA>`. Investigate at your pace.

## Why manual (post 2026-07-22)

Real tenant onboarded. Every prod deploy MUST require manual approval so
bugs in `main` cannot silently reach paying users. Staging catches them
first. Cloudbuild `Step 6` auto-promote permanently removed from both
`cloudbuild.yaml` and `cloudbuild.frontend.yaml`. Restoring it requires
founder approval FIRST — see memory
`feedback_manual_prod_gate_after_real_tenant.md`.
