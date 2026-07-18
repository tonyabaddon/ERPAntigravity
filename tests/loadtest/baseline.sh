#!/bin/bash
# Zero-cost load baseline for Caleo production endpoints.
# Usage: bash tests/loadtest/baseline.sh
# Emits: timing histogram, p50/p95, error rate.
# Runs against PROD (read-only /ready endpoints) — safe to run anytime.

set -uo pipefail

BE_URL="${BE_URL:-https://garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app}"
FE_URL="${FE_URL:-https://app.caleo.id}"

echo "=== Caleo load baseline — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "BE: $BE_URL"
echo "FE: $FE_URL"
echo

# Warm up (cold-start captured separately below)
echo "-- Warming --"
curl -sf -o /dev/null -w "BE cold: %{time_total}s http=%{http_code}\n" "$BE_URL/api/v1/ready"
curl -sf -o /dev/null -w "FE cold: %{time_total}s http=%{http_code}\n" "$FE_URL/"
sleep 2

# Warm baseline
for target in be fe; do
  case $target in
    be) URL="$BE_URL/api/v1/ready" ;;
    fe) URL="$FE_URL/" ;;
  esac
  echo
  echo "-- $target: 20 sequential warm reqs to $URL --"
  > /tmp/lat-$target.txt
  for i in $(seq 1 20); do
    curl -sf -o /dev/null -w "%{time_total}\n" "$URL" >> /tmp/lat-$target.txt
  done
  sort -n /tmp/lat-$target.txt > /tmp/lat-$target-sorted.txt
  MIN=$(head -1 /tmp/lat-$target-sorted.txt)
  P50=$(sed -n "10p" /tmp/lat-$target-sorted.txt)
  P95=$(sed -n "19p" /tmp/lat-$target-sorted.txt)
  MAX=$(tail -1 /tmp/lat-$target-sorted.txt)
  AVG=$(awk "{s+=\$1} END {printf \"%.3f\", s/NR}" /tmp/lat-$target.txt)
  echo "  min=${MIN}s p50=${P50}s p95=${P95}s max=${MAX}s avg=${AVG}s"
done

# Concurrency
echo
echo "-- 10 parallel BE reqs (concurrency check) --"
START=$(date +%s)
for i in $(seq 1 10); do
  curl -sf -o /dev/null "$BE_URL/api/v1/ready" &
done
wait
END=$(date +%s)
echo "  10 parallel reqs completed in $((END-START))s"

# Error rate
echo
echo "-- Error rate: 100 sequential BE reqs --"
FAIL=0
for i in $(seq 1 100); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BE_URL/api/v1/ready")
  if [ "$CODE" != "200" ]; then FAIL=$((FAIL+1)); fi
done
echo "  Success: $((100 - FAIL))/100 (${FAIL} failures)"

# Cleanup
rm -f /tmp/lat-*.txt /tmp/lat-*-sorted.txt

echo
echo "=== Done. Compare vs prior runs in docs/dev/load-baseline.md ==="
