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

  # ─── Sales channels Phase A (schema + helper) ──────────────────────────
  # 14 canonical channels: 4 offline + 7 marketplace + 3 direct online.
  # Adds 10 new ENUM values to kasir_channel + sales_channel; renames
  # tokped_order_no → marketplace_order_no (with kasir_transactions_legacy
  # view alias for 1-week soak); creates sales_channel_settings + RLS;
  # creates validate_sales_channel(text) helper for RPC reuse.
  # All idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING).
  "20260613000010_sales_channels_phase_a_schema.sql"
  "20260613000011_sales_channels_phase_a_rename.sql"
  "20260613000012_sales_channels_phase_a_settings_table.sql"
  "20260613000013_sales_channels_phase_a_helper.sql"

  # ─── Sales channels Phase B (seed + RPC refactor + realtime) ───────────
  # Seeds 14 rows in sales_channel_settings (default is_visible=true);
  # refactors 3 record_kasir_sale variants to use validate_sales_channel +
  # 14-channel invoice prefix CASE + p_marketplace_order_no param rename;
  # adds sales_channel_settings to supabase_realtime publication.
  # MUST be applied together with Phase A above — frontend deploy after.
  "20260613000020_sales_channels_phase_b_seed.sql"
  "20260613000021_sales_channels_phase_b_rpcs.sql"
  "20260613000022_sales_channels_phase_b_realtime.sql"

  # ─── Piutang & Tempo Phase 1A — customers tempo fields ─────────────────
  # Adds allows_tempo, term_days, credit_limit, tempo_activated_at/by columns
  # to customers table. Owner-PIN-gated writes via SECURITY DEFINER RPCs
  # (coming in subsequent piutang migrations). Idempotent (IF NOT EXISTS).
  # Bumped from originally planned 000001 — slots 000001-000007 taken by
  # parallel opname migrations on same date.
  "20260614000008_customers_tempo_fields.sql"

  # ─── Piutang T2 — approval_request_type enum (+3 values for customer credit) ───
  # Extend enum to support customer_credit_activate, customer_credit_limit_change,
  # customer_credit_deactivate. Standalone ALTER TYPE statements (no transaction).
  "20260614000009_approval_types_tempo.sql"

  # ─── Piutang T3 — piutang_settings per-tenant config table ───
  # PK=tenant_id with sentinel UUID. Seeds one row. RLS enabled with
  # pre-Layer-A anon SELECT + authenticated UPDATE policies.
  "20260614000010_piutang_settings.sql"

  # ─── Piutang T4 — _resolve_tenant_id() helper SQL function ───
  # STABLE function reading app.current_tenant_id GUC; returns sentinel
  # UUID pre-Layer-A. Granted to anon, authenticated, service_role.
  "20260614000011_resolve_tenant_helper.sql"

  # ─── Piutang T5 — customer_credit_activate RPCs (request + approve) ───
  # request: validates customer + term_days (vs piutang_settings.term_days_allowed)
  # + credit_limit > 0 + not-already-activated, inserts approval_requests.
  # approve: type-guarded, uses verify_owner_pin which auto-transitions; on
  # success applies UPDATE to customers under row lock.
  "20260614000012_customer_credit_activate_rpcs.sql"
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
