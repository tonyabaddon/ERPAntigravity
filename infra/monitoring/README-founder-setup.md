# Founder-only manual setup

Some monitoring items require manual setup via GCP Console because the CLI/API path is either broken (INVALID_ARGUMENT with no detail) or requires interactive verification (email link clicks).

## 1. Verify email notification channel

**Impact if skipped**: All 8 Task 10 alerts fire in GCP but no email delivery. Full monitoring value locked out.

Steps:
1. Check Gmail (also spam folder) for `noreply@google.com` message titled "Google Cloud Monitoring notification channel verification"
2. Click the verification link
3. Confirm via CLI:
   ```bash
   gcloud alpha monitoring channels list \
     --project=gen-lang-client-0410251117 \
     --format="table(displayName,verificationStatus)"
   ```
   Should show `VERIFIED` next to `Founder email — Tony`.

## 2. Cloud Billing budget alert ($10 USD/month)

**Impact if skipped**: No warning if any paid GCP API (Gemini, GCS overage, Cloud Run overrun) starts costing money. Bill surprise possible.

The API rejected our CLI attempts (INVALID_ARGUMENT with no detail). Set up via Console:

Steps:
1. Visit: https://console.cloud.google.com/billing/012672-351343-D4585A/budgets
2. Click **CREATE BUDGET**
3. Name: `Caleo prod monthly budget`
4. Scope: filter to project `gen-lang-client-0410251117`
5. Amount: `$10 USD` (specified amount, calendar month)
6. Threshold rules: `50%`, `90%`, `100%` (all on current spend)
7. Notifications:
   - ✅ Email alerts to billing admins (default)
   - Optionally add extra recipient: `tonywei.office@gmail.com`
8. Save

Verify by hitting the API:
```bash
TOKEN=$(gcloud auth print-access-token)
curl -s "https://billingbudgets.googleapis.com/v1/billingAccounts/012672-351343-D4585A/budgets" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Goog-User-Project: gen-lang-client-0410251117" | grep displayName
```

## 3. (Optional) Rotate DB password

**Impact if skipped**: Historical plaintext password from earlier today's Cloud Build trigger config remains valid. Only readable by anyone with GCP `cloudbuild.builds.get` on this project (currently just tinythinkers).

Steps:
1. Supabase Dashboard → project `ekhhojaezdfjfwuxyjkl` → Settings → Database
2. Reset database password. Copy new password (shown once).
3. Update Secret Manager:
   ```bash
   NEW_CONN_TXNPOOL="host=aws-1-ap-northeast-1.pooler.supabase.com port=6543 user=postgres.ekhhojaezdfjfwuxyjkl password='<NEW_PW>' dbname=postgres sslmode=require"
   echo -n "$NEW_CONN_TXNPOOL" | gcloud secrets versions add supabase-db-connection-prod \
     --project=gen-lang-client-0410251117 --data-file=-

   NEW_CONN_DIRECT="host=db.ekhhojaezdfjfwuxyjkl.supabase.co port=5432 user=postgres password='<NEW_PW>' dbname=postgres sslmode=require"
   echo -n "$NEW_CONN_DIRECT" | gcloud secrets versions add supabase-db-connection-listener-prod \
     --project=gen-lang-client-0410251117 --data-file=-
   ```
4. Force Cloud Run backend to pick up new versions:
   ```bash
   NEW_TXN_V=$(gcloud secrets versions list supabase-db-connection-prod --project=gen-lang-client-0410251117 --limit=1 --format="value(name)")
   NEW_DIR_V=$(gcloud secrets versions list supabase-db-connection-listener-prod --project=gen-lang-client-0410251117 --limit=1 --format="value(name)")
   gcloud run services update garindo-jaya-panel-msme-erp \
     --region=asia-southeast1 --project=gen-lang-client-0410251117 \
     --update-secrets=SUPABASE_DB_CONNECTION=supabase-db-connection-prod:$NEW_TXN_V,SUPABASE_DB_LISTENER_CONNECTION=supabase-db-connection-listener-prod:$NEW_DIR_V
   ```
5. Verify: `curl -sf https://garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app/api/v1/ready`
