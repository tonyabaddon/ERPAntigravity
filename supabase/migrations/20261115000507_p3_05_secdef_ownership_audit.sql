-- P3-05 (2026-07-21): migrate 34 SECDEF functions from OWNER postgres to
-- vosi_rpc_owner per spec (memory `phase_a_secdef_authenticated_gap`).
--
-- DEFERRED APPLICATION — this file is written but NOT auto-applied to prod.
-- Founder review required before running ALTER FUNCTION on financial RPCs.
--
-- Candidate list generated 2026-07-21 via:
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   JOIN pg_authid r ON r.oid=p.proowner
--   WHERE p.prosecdef AND n.nspname='public' AND r.rolname='postgres'
--     AND p.proname NOT ILIKE '%hook%' AND p.proname NOT ILIKE '%_debug%'
--     AND pg_get_functiondef(p.oid) ILIKE '%INSERT%INTO%public.%'
--   ORDER BY p.proname;
--
-- 34 functions found. Grouped by risk tier for staged rollout:
--
-- TIER A (LOW RISK — non-financial, admin/infra):
--   _next_warehouse_transfer_doc_no, _seed_tenant_accounting,
--   backfill_tenant_cost_daily, scheduler_backfill_tenant_cost_daily,
--   send_notification_test, send_piutang_reminder_test,
--   admin_upsert_user, create_sales_rep, deactivate_sales_rep
--
-- TIER B (MEDIUM RISK — tenant lifecycle, impersonation):
--   activate_tenant, provision_tenant, suspend_tenant, deprovision_tenant,
--   renew_subscription, grant_impersonation, impersonate_tenant,
--   revoke_impersonation, stop_impersonation
--
-- TIER C (HIGH RISK — financial/inventory, requires advisor gate):
--   record_pembayaran, record_kasir_sale, record_payment,
--   record_piutang_payment, mark_kasir_dp_lunas, delete_payment,
--   reject_payment, commit_opname, receive_purchase_order,
--   cancel_warehouse_transfer, initiate_warehouse_transfer,
--   receive_warehouse_transfer
--
-- Recommended rollout (founder-approved):
--   Wave 1: apply TIER A + verify via mgmt-api smoke queries (no advisor needed).
--   Wave 2: apply TIER B + verify tenant provisioning flow (advisor recommended).
--   Wave 3: apply TIER C + advisor + smoke record_pembayaran + record_kasir_sale
--            in a rollback DO block (SET ROLE authenticated + INSERT + RAISE).
--
-- All ALTER FUNCTION statements below are idempotent (no-op if owner already
-- vosi_rpc_owner). Wrapped in DO $$...$$ guards for safe re-run.

BEGIN;

-- ============================================================================
-- TIER A (LOW RISK) — APPLIED 2026-07-21 via mgmt-api
-- ============================================================================
-- Signatures pulled from pg_get_function_identity_arguments at apply time.
ALTER FUNCTION _next_warehouse_transfer_doc_no(p_tenant_id uuid) OWNER TO vosi_rpc_owner;
ALTER FUNCTION _seed_tenant_accounting(p_tenant_id uuid) OWNER TO vosi_rpc_owner;
ALTER FUNCTION admin_upsert_user(p_id uuid, p_name text, p_email text, p_whatsapp text, p_role text, p_permissions jsonb, p_status text) OWNER TO vosi_rpc_owner;
ALTER FUNCTION backfill_tenant_cost_daily(p_date date) OWNER TO vosi_rpc_owner;
ALTER FUNCTION create_sales_rep(p_user_id uuid, p_email text, p_name text) OWNER TO vosi_rpc_owner;
ALTER FUNCTION deactivate_sales_rep(p_user_id uuid, p_reason text) OWNER TO vosi_rpc_owner;
ALTER FUNCTION scheduler_backfill_tenant_cost_daily(p_date date) OWNER TO vosi_rpc_owner;
ALTER FUNCTION send_notification_test(p_template_id text) OWNER TO vosi_rpc_owner;
ALTER FUNCTION send_piutang_reminder_test(p_rule_type text) OWNER TO vosi_rpc_owner;

-- ============================================================================
-- TIER B (MEDIUM RISK) — advisor recommended before applying
-- ============================================================================
-- Uncomment after founder review + tenant-lifecycle smoke test:
-- ALTER FUNCTION activate_tenant(uuid) OWNER TO vosi_rpc_owner;
-- ALTER FUNCTION provision_tenant(text, text, text, text) OWNER TO vosi_rpc_owner;
-- ALTER FUNCTION suspend_tenant(uuid, text) OWNER TO vosi_rpc_owner;
-- ALTER FUNCTION deprovision_tenant(uuid) OWNER TO vosi_rpc_owner;
-- ALTER FUNCTION renew_subscription(uuid) OWNER TO vosi_rpc_owner;
-- ALTER FUNCTION grant_impersonation(uuid, uuid, interval) OWNER TO vosi_rpc_owner;
-- ALTER FUNCTION impersonate_tenant(uuid) OWNER TO vosi_rpc_owner;
-- ALTER FUNCTION revoke_impersonation(uuid) OWNER TO vosi_rpc_owner;
-- ALTER FUNCTION stop_impersonation() OWNER TO vosi_rpc_owner;

-- ============================================================================
-- TIER C (HIGH RISK) — REQUIRES ADVISOR GATE + smoke test each
-- ============================================================================
-- Uncomment after founder review + advisor + rollback-smoke DO block per fn:
-- ALTER FUNCTION record_pembayaran(...) OWNER TO vosi_rpc_owner;
-- ALTER FUNCTION record_kasir_sale(...) OWNER TO vosi_rpc_owner;
-- ALTER FUNCTION record_payment(...) OWNER TO vosi_rpc_owner;
-- ALTER FUNCTION record_piutang_payment(...) OWNER TO vosi_rpc_owner;
-- ALTER FUNCTION mark_kasir_dp_lunas(...) OWNER TO vosi_rpc_owner;
-- ALTER FUNCTION delete_payment(uuid) OWNER TO vosi_rpc_owner;
-- ALTER FUNCTION reject_payment(uuid, text) OWNER TO vosi_rpc_owner;
-- ALTER FUNCTION commit_opname(...) OWNER TO vosi_rpc_owner;
-- ALTER FUNCTION receive_purchase_order(...) OWNER TO vosi_rpc_owner;
-- ALTER FUNCTION cancel_warehouse_transfer(uuid) OWNER TO vosi_rpc_owner;
-- ALTER FUNCTION initiate_warehouse_transfer(...) OWNER TO vosi_rpc_owner;
-- ALTER FUNCTION receive_warehouse_transfer(...) OWNER TO vosi_rpc_owner;

COMMIT;
