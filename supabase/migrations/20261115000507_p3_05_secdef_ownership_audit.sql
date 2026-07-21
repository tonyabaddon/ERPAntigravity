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
-- TIER B (MEDIUM RISK) — APPLIED 2026-07-22 via mgmt-api (post founder drain)
-- ============================================================================
ALTER FUNCTION activate_tenant(p_tenant_id uuid) OWNER TO vosi_rpc_owner;
ALTER FUNCTION deprovision_tenant(p_tenant_id uuid, p_reason text) OWNER TO vosi_rpc_owner;
ALTER FUNCTION grant_impersonation(p_admin_email text, p_expires_in_hours integer, p_reason text) OWNER TO vosi_rpc_owner;
ALTER FUNCTION impersonate_tenant(p_slug text) OWNER TO vosi_rpc_owner;
ALTER FUNCTION provision_tenant(p_owner_user_id uuid, p_slug text, p_name text, p_owner_name text, p_owner_email text, p_plan_code text, p_expires_in_months integer) OWNER TO vosi_rpc_owner;
ALTER FUNCTION renew_subscription(p_tenant_id uuid, p_new_expires_at date, p_new_plan_code text, p_notes text) OWNER TO vosi_rpc_owner;
ALTER FUNCTION revoke_impersonation(p_grant_id uuid, p_reason text) OWNER TO vosi_rpc_owner;
ALTER FUNCTION stop_impersonation() OWNER TO vosi_rpc_owner;
ALTER FUNCTION suspend_tenant(p_tenant_id uuid, p_reason text) OWNER TO vosi_rpc_owner;

-- ============================================================================
-- TIER C (HIGH RISK) — APPLIED 2026-07-22 via mgmt-api post founder drain +
-- max_connections bump (60 → 90). Post-apply smoke verified: login OK,
-- kasir_transactions query returns rows (RLS enforced), app.caleo.id 200.
-- ============================================================================
ALTER FUNCTION cancel_warehouse_transfer(p_transfer_id bigint, p_reason text) OWNER TO vosi_rpc_owner;
ALTER FUNCTION commit_opname(p_approval_id bigint, p_idempotency_key uuid) OWNER TO vosi_rpc_owner;
ALTER FUNCTION delete_payment(p_payment_id uuid, p_reason text) OWNER TO vosi_rpc_owner;
ALTER FUNCTION initiate_warehouse_transfer(p_from_warehouse_id uuid, p_to_warehouse_id uuid, p_receiver_user_id uuid, p_notes text, p_client_request_id text, p_items jsonb) OWNER TO vosi_rpc_owner;
ALTER FUNCTION mark_kasir_dp_lunas(p_id uuid, p_method text, p_subtype text, p_ongkir_adjust numeric, p_cash_account_id uuid) OWNER TO vosi_rpc_owner;
ALTER FUNCTION receive_purchase_order(p_po_id uuid, p_received_at timestamp with time zone, p_payment_due_at date, p_invoice_url text, p_conditions jsonb, p_idempotency_key uuid) OWNER TO vosi_rpc_owner;
ALTER FUNCTION receive_warehouse_transfer(p_transfer_id bigint, p_items jsonb) OWNER TO vosi_rpc_owner;
ALTER FUNCTION record_kasir_sale(p_date date, p_channel text, p_items jsonb, p_subtotal numeric, p_payment_method text, p_payment_subtype text, p_payment_type text, p_dp_amount numeric, p_dp_input_type text, p_ongkir_amount numeric, p_notes text, p_total_amount numeric, p_customer_name text, p_customer_phone text, p_customer_company text, p_delivery_address text, p_marketplace_order_no text, p_wa_phone text, p_wa_chat_url text, p_customer_id text, p_discount_type text, p_discount_value numeric, p_discount_amount_rp numeric, p_cash_account_id uuid, p_allow_negative_stock boolean, p_idempotency_key uuid) OWNER TO vosi_rpc_owner;
ALTER FUNCTION record_payment(p_payload jsonb) OWNER TO vosi_rpc_owner;
ALTER FUNCTION record_pembayaran(payload jsonb, p_idempotency_key uuid) OWNER TO vosi_rpc_owner;
ALTER FUNCTION record_piutang_payment(p_order_id uuid, p_cash_account_id uuid, p_proof_url text, p_verified_by_user_id uuid, p_amount numeric) OWNER TO vosi_rpc_owner;
ALTER FUNCTION reject_payment(p_payment_id uuid, p_reason text) OWNER TO vosi_rpc_owner;

COMMIT;
