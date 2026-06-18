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

  # ─── Piutang T6 — customer_credit_limit_change RPCs ───
  # request: validates customer is activated + new limit > 0 + reason ≥5 chars.
  # approve: type-guarded + verify_owner_pin; on success UPDATEs customers.credit_limit.
  "20260614000013_customer_credit_limit_change_rpcs.sql"

  # ─── Piutang T7 — customer_credit_deactivate RPCs ───
  # request: validates activated + reason≥5. approve: type-guarded +
  # verify_owner_pin; UPDATE allows_tempo=false (retains term_days/credit_limit as audit).
  "20260614000014_customer_credit_deactivate_rpcs.sql"

  # ─── Product Photo Phase 1 — M1: stocks UoM + photo_urls + min_stock + initial_stock_approved ───
  "20260614000020_stocks_product_columns.sql"

  # ─── Product Photo Phase 1 — M2: product_categories/brands/units registries + seeds ───
  "20260614000021_product_registries.sql"

  # ─── Product Photo Phase 1 — M3: pgvector + stock_photo_embeddings + HNSW cosine index ───
  "20260614000022_stock_photo_embeddings.sql"

  # ─── Product Photo Phase 1 — M4: costing_method setting + product-photos Storage bucket ───
  "20260614000023_costing_and_storage.sql"

  # ─── Product Photo Phase 1 — M5: initial_stock enum + search_products_by_embedding RPC ───
  "20260614000024_initial_stock_and_search_rpc.sql"

  # ─── Product Photo Phase 1 — M5b: ai_call_log table for activity monitoring ───
  "20260614000025_ai_call_log.sql"

  # ─── BNL Phase 1 (Belanja Numpang Lewat) — 5 migrations ───
  # T1: purchase_invoices + purchase_invoice_items schema + indexes + RLS +
  # set_updated_at trigger. type='PASSTHROUGH' (Phase 1) vs 'STOCK' (Phase 2 reserved).
  "20260615000001_pi_schema.sql"
  # T1.5: ALTER TYPE kasir_expense_category ADD VALUE 'Pembelian Pass-Through'.
  # Must apply BEFORE RPCs that reference this enum value.
  "20260615000002_pi_kasir_enum.sql"
  # T2: generate_pi_number + record_pi RPCs with BR6 soft duplicate warning.
  "20260615000003_pi_rpcs_create.sql"
  # T3: mark_pi_paid + void_pi + update_pi lifecycle RPCs.
  "20260615000004_pi_rpcs_lifecycle.sql"
  # T4: order_cogs_breakdown view — allocates PI cost to Order items via
  # jsonb_array_elements(orders.items) since there's no order_items table.
  "20260615000005_order_cogs_breakdown_view.sql"

  # ─── Product Photo M4-fix — costing_method column + product-photos bucket ───
  # Original M4 (20260614000023) assumed key/value company_settings; real schema
  # is single-row. This patch adds costing_method TEXT column + bucket creation.
  "20260615000020_costing_method_column.sql"

  # ─── Product Photo M4-fix-2 — Storage RLS policies for product-photos ───
  # The 4 storage.objects policies documented in the M4 NOTE comment; applied
  # via DB tool now that we know Postgres role has sufficient privilege.
  "20260615000021_product_photos_storage_policies.sql"

  # ─── Product Photo Phase 2 — GRANTs on stocks + registries to authenticated ───
  # ProductForm submit hit 42501 "permission denied" — registry tables and
  # stocks lacked INSERT/UPDATE grants to authenticated role. Bulk upload path
  # ran under a less-restricted role. This grant matches the existing RLS
  # policies' intent.
  "20260615000022_authenticated_grants.sql"

  # ─── Sales Funnel — Phase 1 (Sales landing + Daftar Pesanan 2-I) ───
  # 7 migrations. ALL idempotent (ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE,
  # ON CONFLICT DO NOTHING). Distant slot 20260625000xxx claimed per parallel-
  # terminal isolation rule (latest existing was 20260620000023).
  #
  # 001: 8 new columns on kasir_transactions (funnel_stage, funnel_sub_stage,
  #      order_type enum, version int for optimistic lock, delivery_method,
  #      wip_started_at, estimated_completion_days/_date) + 3 indexes.
  # 002: 5 new columns for payment proof tracking (pelunasan_proof_url,
  #      marketplace_proof_url, proof_source, proof_uploaded_at/_by) + creates
  #      payment-proofs storage bucket + RLS policies for authenticated.
  # 003: Atomic transition_order_stage RPC (initial version). Will be replaced
  #      by 007 — keep 003 in apply order so 007's REPLACE works idempotently.
  # 004: STABLE get_sales_dashboard_stats() RPC returns urgent_count,
  #      tunggu_count, revenue_pending, completed_this_month, revenue_this_month.
  # 005: Backfill funnel_stage/funnel_sub_stage from legacy status enum
  #      (WIP→3a, PENDING_LOCK_APPROVAL→3g, AWAITING_LUNAS→3d,
  #       LUNAS/PAID/COMPLETED→5a, CANCELLED→6a, INVOICE_TEMPO→3a).
  #      WHERE clause prevents re-touching rows already on new state.
  # 006: Sets payment-proofs bucket public so client getPublicUrl works
  #      (filenames are random-named, URL unguessable in practice).
  # 007: REPLACES 003's transition RPC with version that uses auth.uid()
  #      server-side (drops spoofable p_actor_user_id parameter). Client
  #      `mutations.transitionOrder` was updated to match new signature.
  "20260625000001_funnel_stage_columns.sql"
  "20260625000002_payment_proof_columns.sql"
  "20260625000003_transition_order_stage_rpc.sql"
  "20260625000004_sales_stats_rpc.sql"
  "20260625000005_backfill_funnel_stage.sql"
  "20260625000006_payment_proofs_bucket_public.sql"
  "20260625000007_transition_rpc_use_auth_uid.sql"
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
