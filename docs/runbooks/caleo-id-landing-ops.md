# Caleo Landing Ops Runbook

## Deploy landing to production

```bash
cd infra/caleo-landing-worker
npx wrangler deploy
```

Wait for "Success!" then verify:

```bash
curl -sI https://caleo.id/ | head -20
```

Expected: HTTP/2 200 + Content-Security-Policy + Strict-Transport-Security headers.

## Rollback

**Fast path — Wrangler:**

```bash
cd infra/caleo-landing-worker
npx wrangler rollback --name caleo-landing
```

**Full path — Git + redeploy:**

```bash
git log --oneline -5   # find the offending commit
git revert <commit>
cd infra/caleo-landing-worker && npx wrangler deploy
```

## Post-deploy smoke test

```bash
CALEO_LANDING_BASE=https://caleo.id npx playwright test tests/e2e/tests/landing-smoke.spec.ts
```

Expected: all 10 tests pass.

Manual checks:
- Chrome desktop → open https://caleo.id → click all CTAs → verify WA opens with pre-filled message
- Chrome mobile emulation (375×667) → sticky mobile CTA bar + floating WA visible → layout responsive
- DevTools Console → zero CSP violations

## Cloudflare Email Routing setup — halo@caleo.id

One-time dashboard config:

1. CF dashboard → caleo.id zone → Email → Email Routing
2. Enable Email Routing (adds MX records automatically)
3. Add route: Custom address `halo@caleo.id` → Forward to `tonywei.office@gmail.com`
4. Verify destination email (CF sends confirmation to tonywei.office@gmail.com)
5. Test: send email to `halo@caleo.id`, confirm receipt at destination

Cost: free tier covers unlimited routes on caleo.id.

## Content edits (Phase 3.0 static)

Content changes require code + redeploy:

1. Edit `docs/design-mockups/caleo-landing-v1.html` (source of truth)
2. Sync change into `public/index.html`: rerun path-rewrite sed from Task 1 Step 2, then JS-extract from Task 2 Step 3
3. Commit + `npx wrangler deploy`

Turnaround: ~2 minutes. Phase 3.1 will make WA number, slot counter, testimonials, promo ticker, stats editable via Caleo Admin sidebar (no redeploy — see spec §12 and §16).

## Lighthouse check

```bash
npx lighthouse https://caleo.id/ --preset=desktop --output=json --quiet | jq '.categories.performance.score'
npx lighthouse https://caleo.id/ --emulated-form-factor=mobile --output=json --quiet | jq '.categories.performance.score'
```

Expected: desktop ≥ 0.95, mobile ≥ 0.85.

## OG preview check

Manual — after deploy, paste `https://caleo.id/` into:

- Facebook Sharing Debugger: https://developers.facebook.com/tools/debug/
- Twitter Card Validator (X): https://cards-dev.twitter.com/validator
- WhatsApp: paste link in any chat → verify preview card renders with og-image + title + description

If og-image fails to render: verify Content-Type header on `/assets/og-image.png` = `image/png` (not `application/octet-stream`).

## Incident log

Landing-side incidents (broken links, missing assets, CSP violations, deploy failures) are logged at `docs/incidents/YYYY-MM-DD-<slug>.md` per CLAUDE.md incident logging protocol.
