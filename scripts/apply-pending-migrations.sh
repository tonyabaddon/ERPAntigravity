#!/usr/bin/env bash
# Applies the e2e-audit fix migrations to live Supabase.
# Uses lib/pq via the existing apply-migration tool so it works on IPv6-only
# free-tier projects.
#
# Usage:
#   cd backend-go && set -a && source .env && set +a && cd ..
#   ./scripts/apply-pending-migrations.sh
set -euo pipefail

if [[ -z "${SUPABASE_DB_CONNECTION:-}" ]]; then
  echo "SUPABASE_DB_CONNECTION not set — source backend-go/.env first" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN=/tmp/apply-migration

if [[ ! -x "$BIN" ]]; then
  echo "[build] $BIN"
  (cd "$ROOT/backend-go" && go build -o "$BIN" ./cmd/apply-migration)
fi

# List in apply order. Add new migrations to the bottom of this list.
MIGRATIONS=(
  "20260612000001_fix_transfer_warehouse_security_definer.sql"
  "20260612000002_set_company_name.sql"
  # "20260612000003_e2e_data_scrub.sql"  # blocked by stock_lots FK on PO-TEST rows; cleanup separately
  "20260613000001_warehouses_phase1_schema.sql"
  "20260613000002a_warehouses_phase2_stock_rpcs.sql"
  "20260613000002b_warehouses_phase2_sale_po_rpcs.sql"
  "20260613000002c_warehouses_phase2_approval_rpcs.sql"
  "20260613000002d_warehouses_admin_rpcs.sql"
  "20260613000004_backfill_can_manage_warehouses.sql"
  # ─── Phase 3 cutover — COMMENTED OUT until 24h soak ──────────────────────
  # Re-enable by uncommenting the line below, then re-run this script. The
  # cutover migration is idempotent on schema (DROP IF EXISTS) but is one-
  # way: dropped columns + overloads cannot be restored automatically. Only
  # uncomment when:
  #   1. All migrations above have been applied successfully.
  #   2. The new frontend (WarehousePicker / warehouse_id) has run in prod
  #      for >= 24 hours with no Cloud Run / Supabase errors.
  #   3. You have explicitly decided to commit to the new schema.
  # Note: the cutover's filename timestamp (20260613000003) is lower than
  # the backfill (20260613000004) on purpose — the script preserves array
  # order, not filename sort. Cutover must run AFTER the backfill.
  # "20260613000003_warehouses_phase3_cutover.sql"
)

for m in "${MIGRATIONS[@]}"; do
  f="$ROOT/supabase/migrations/$m"
  if [[ ! -f "$f" ]]; then
    echo "[skip] missing $f" >&2
    continue
  fi
  echo "[apply] $m"
  "$BIN" "$f"
done

echo "[done] all migrations applied"
