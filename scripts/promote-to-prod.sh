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
