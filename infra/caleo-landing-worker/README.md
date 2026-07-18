# Caleo Landing Worker

Cloudflare Worker serving `caleo.id/*` with static assets from `../../public/`.

## Deploy (staging → production two-step)

**ALWAYS deploy to staging first**, run full test matrix (Task 9), only
then promote to production.

Step 1 — deploy to staging:

```bash
cd infra/caleo-landing-worker
npx wrangler deploy --env staging
```

Output includes the auto-generated staging URL, e.g.
`https://caleo-landing-staging.<your-sub>.workers.dev`. Note this URL —
it's your test surface.

Step 2 — after Task 9 test matrix passes green, promote to production:

```bash
cd infra/caleo-landing-worker
npx wrangler deploy --env production
```

Verify:

```bash
npx wrangler deployments list --env production --name caleo-landing | head -20
curl -sI https://caleo.id/ | head -20
```

## Rollback

Production rollback — revert to previous deployment:

```bash
npx wrangler rollback --env production --name caleo-landing
```

Or via git + redeploy:

```bash
git revert <deploy-commit>
cd infra/caleo-landing-worker && npx wrangler deploy
```

## Local dev

```bash
npx wrangler dev --local
# opens http://localhost:8787 serving public/ (uses base config, no env)
```

## Cloudflare Email Routing (halo@caleo.id)

Configure in CF dashboard → Email → Email Routing → Routes:

- Custom address: `halo@caleo.id` → Forward to: `tonywei.office@gmail.com`
- Verification: send test email to `halo@caleo.id`, check destination inbox

No code — dashboard-only setup. Free tier covers unlimited routes on caleo.id.
