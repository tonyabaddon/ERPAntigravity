# Sprint 7 — Founder follow-ups (blocked on external provisioning)

## 1. Task 7.5 (Landing CTA swap) — BLOCKED

**Blocker:** `CALEO_ADMIN_WA_PHONE` env var is not set. A dedicated Caleo-platform WhatsApp phone number must be provisioned (~Rp 5,000 one-time prepaid SIM per plan Section 5.10) before this task can execute.

**When founder has bot number:**
```bash
# Add to backend-go/.env:
CALEO_ADMIN_WA_PHONE=628XXXXXXXXX

# Add to Cloud Run env for caleobot deployment
gcloud run services update caleo-bot --set-env-vars CALEO_ADMIN_WA_PHONE=628XXXXXXXXX ...

# Run this swap:
set -a; source .env; set +a
sed -i '' "s|wa.me/6285264787775|wa.me/${CALEO_ADMIN_WA_PHONE}|g" public/index.html docs/design-mockups/caleo-landing-v1.html
grep -c "wa.me/${CALEO_ADMIN_WA_PHONE}" public/index.html docs/design-mockups/caleo-landing-v1.html  # expect 15 per file (not 13 per plan — actual count higher)

# Redeploy CF Worker
cd infra/caleo-landing-worker && npx wrangler deploy --env production

# Verify live
curl -s https://caleo.id/ | grep -c "wa.me/${CALEO_ADMIN_WA_PHONE}"
```

**Actual ref count:** 15 per file (not 13 per spec Section 5.10 — plan estimate was off; verified via grep 2026-07-19).

## 2. Task 5.4 SessionHealthPoller — session check STUB

**Blocker:** whatsapp package is single-session per Cloud Run instance. `session.CheckClient(tenantID)` needs multi-tenant session manager to work.

**Follow-up:** implement multi-tenant session manager (P2/P3 initiative — see landing gap analysis) OR keep single-instance-per-tenant deployment and remove the abstraction.

## 3. Task 7.4 CaleoBotDashboard — RLS access

**Blocker:** `caleo_admin_bot_analytics` grants only to `service_role`. Frontend uses anon-key which will return empty rows.

**Follow-up:** create SECDEF RPC `get_bot_analytics_summary(days INT)` that:
- Returns aggregated: total prospects (7d, 30d), top 5 FAQs, escalation rate, funnel counts
- SECURITY DEFINER with GRANT EXECUTE to `authenticated` (admin.caleo.id restricts by admin role internally)
- Dashboard calls this RPC instead of direct table SELECT

## 4. Task 4.5 NotificationCronScreen — persistence

**Blocker:** Cards 2-4 (Hutang summary, SLA breach, Feedback delay) have no config table. Sliders show but don't persist.

**Follow-up:** create migration for `tenant_notification_cron_config` table with columns for each configurable knob, wire upsert flow like Piutang card.

## 5. Task 5.4 Cost/deployment

- `RESEND_API_KEY` + `CALEO_OPS_EMAIL` — add to GCP Secret Manager + wire into `cloudbuild.yaml` env vars before session-health alerts fire in production
- `wa_session_health` table growth — add pruning cron (weekly DELETE WHERE polled_at < NOW() - INTERVAL '30 days')

