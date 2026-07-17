#!/usr/bin/env bash
# staging-smoke.sh — manual staging smoke test (mirrors Cloud Build Step 4).
# Usage: ./scripts/staging-smoke.sh [FE_URL] [BE_URL]
#
# Default URLs use the direct Cloud Run service URLs (bypass custom domain
# DNS which may not be propagated yet). Override with $STAGING_FE_URL /
# $STAGING_BE_URL env vars or positional args.
set -e

STAGING_FE_URL="${1:-${STAGING_FE_URL:-https://garindo-jaya-panel-msme-erp-frontend-staging-422860632808.asia-southeast1.run.app}}"
STAGING_BE_URL="${2:-${STAGING_BE_URL:-https://garindo-jaya-panel-msme-erp-staging-422860632808.asia-southeast1.run.app}}"

echo "=== Staging smoke tests ==="
echo "FE: $STAGING_FE_URL"
echo "BE: $STAGING_BE_URL"
echo ""

PASS=0
FAIL=0

check() {
  local label="$1"
  local url="$2"
  local expected="${3:-200}"
  HTTP=$(curl -sfo /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  if [ "$HTTP" = "$expected" ]; then
    echo "  PASS  $label → $HTTP"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label → $HTTP (expected $expected)"
    FAIL=$((FAIL + 1))
  fi
}

echo "--- FE checks ---"
check "FE root" "$STAGING_FE_URL/"
check "FE /login" "$STAGING_FE_URL/login"

echo ""
echo "--- BE checks ---"
check "BE /live" "$STAGING_BE_URL/api/v1/live"
check "BE /ready" "$STAGING_BE_URL/api/v1/ready"
check "BE /health" "$STAGING_BE_URL/api/v1/health"

echo ""
echo "--- Bundle reference check ---"
BUNDLE=$(curl -s "$STAGING_FE_URL/" | grep -oE 'src="/assets/index-[^"]+\.js"' | head -1 || true)
if [ -n "$BUNDLE" ]; then
  echo "  PASS  Bundle reference found: $BUNDLE"
  PASS=$((PASS + 1))
else
  echo "  FAIL  Bundle reference not found in index.html"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] || exit 1
