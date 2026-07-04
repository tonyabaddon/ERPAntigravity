#!/usr/bin/env bash
# scripts/verify-migrations.sh — apply all migrations on fresh DB, verify schema.
set -euo pipefail

echo "[verify-migrations] db reset..."
supabase db reset

echo "[verify-migrations] verifying 8 new Phase A tables..."
COUNT=$(supabase db psql -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('tenants','platform_admins','tenant_users','plans','tenant_subscriptions','platform_admin_audit','tenant_activity_daily','platform_admin_active_impersonation');" | tr -d ' \n')
if [ "$COUNT" != "8" ]; then
  echo "FAIL: expected 8 Phase A tables, got $COUNT"
  exit 1
fi

echo "[verify-migrations] verifying Garindo tenant seeded..."
COUNT=$(supabase db psql -t -c "SELECT COUNT(*) FROM tenants WHERE id='11111111-1111-1111-1111-111111111111'::uuid;" | tr -d ' \n')
if [ "$COUNT" != "1" ]; then
  echo "FAIL: Garindo tenant missing"
  exit 1
fi

echo "[verify-migrations] OK — all Phase A checks passed"
