-- Migration 20261115000514: revert P3-05 SECDEF ownership migration for 22 functions
-- (regression fix — 2026-07-24)
--
-- Symptom: "Tambah Admin Baru" flow di UserManagementScreen gagal dengan
-- HTTP 403 body {"code":"42501","message":"permission denied for schema auth"}.
--
-- Root cause: commits 38e874b + f12ec27 (P3-05 TIER B + C) migrated 21+ SECDEF
-- functions dari OWNER postgres (superuser bypass) ke OWNER vosi_rpc_owner
-- (least-privilege intent). Tapi vosi_rpc_owner tidak punya USAGE on schema
-- auth di Supabase-managed Postgres, dan schema auth tidak bisa di-grant dari
-- postgres user (owned by supabase_auth_admin — protected role).
--
-- Verified: GRANT USAGE ON SCHEMA auth TO vosi_rpc_owner → "no privileges
-- were granted" WARNING. Also tried via Supabase Management API SQL endpoint
-- (elevated) — same failure. Auth schema grants are locked down.
--
-- Semua 22 function di bawah pemanggilan langsung `auth.uid()` yang butuh USAGE
-- on schema auth. Karena grant di-block, satu-satunya cara mengembalikan
-- fungsionalitas adalah revert OWNER back ke postgres (superuser bypass ignores
-- schema grants).
--
-- P3-05 goal (least-privilege) belum tercapai — perlu re-planning dengan option
-- (a) rewrite function bodies pakai current_setting('request.jwt.claim.sub')
-- pattern seperti _audit_row_change, atau (b) Supabase support request untuk
-- grant. Sementara ini revert supaya prod jalan.
--
-- Idempotent: ALTER FUNCTION safe to re-run.

ALTER FUNCTION public.activate_tenant(p_tenant_id uuid) OWNER TO postgres;
ALTER FUNCTION public.admin_upsert_user(p_id uuid, p_name text, p_email text, p_whatsapp text, p_role text, p_permissions jsonb, p_status text) OWNER TO postgres;
ALTER FUNCTION public.backfill_tenant_cost_daily(p_date date) OWNER TO postgres;
ALTER FUNCTION public.cancel_warehouse_transfer(p_transfer_id bigint, p_reason text) OWNER TO postgres;
ALTER FUNCTION public.create_sales_rep(p_user_id uuid, p_email text, p_name text) OWNER TO postgres;
ALTER FUNCTION public.create_tempo_invoice(p_payload jsonb) OWNER TO postgres;
ALTER FUNCTION public.deactivate_sales_rep(p_user_id uuid, p_reason text) OWNER TO postgres;
ALTER FUNCTION public.delete_payment(p_payment_id uuid, p_reason text) OWNER TO postgres;
ALTER FUNCTION public.enqueue_job(p_job_type text, p_payload jsonb, p_priority integer, p_idempotency_key text) OWNER TO postgres;
ALTER FUNCTION public.impersonate_tenant(p_slug text) OWNER TO postgres;
ALTER FUNCTION public.initiate_warehouse_transfer(p_from_warehouse_id uuid, p_to_warehouse_id uuid, p_receiver_user_id uuid, p_notes text, p_client_request_id text, p_items jsonb) OWNER TO postgres;
ALTER FUNCTION public.receive_warehouse_transfer(p_transfer_id bigint, p_items jsonb) OWNER TO postgres;
ALTER FUNCTION public.record_kasir_sale(p_date date, p_channel text, p_items jsonb, p_subtotal numeric, p_payment_method text, p_payment_subtype text, p_payment_type text, p_dp_amount numeric, p_dp_input_type text, p_ongkir_amount numeric, p_notes text, p_total_amount numeric, p_customer_name text, p_customer_phone text, p_customer_company text, p_delivery_address text, p_marketplace_order_no text, p_wa_phone text, p_wa_chat_url text, p_customer_id text, p_discount_type text, p_discount_value numeric, p_discount_amount_rp numeric, p_cash_account_id uuid, p_allow_negative_stock boolean, p_idempotency_key uuid) OWNER TO postgres;
ALTER FUNCTION public.record_payment(p_payload jsonb) OWNER TO postgres;
ALTER FUNCTION public.record_pembayaran(payload jsonb, p_idempotency_key uuid) OWNER TO postgres;
ALTER FUNCTION public.reject_payment(p_payment_id uuid, p_reason text) OWNER TO postgres;
ALTER FUNCTION public.renew_subscription(p_tenant_id uuid, p_new_expires_at date, p_new_plan_code text, p_notes text) OWNER TO postgres;
ALTER FUNCTION public.send_notification_test(p_template_id text) OWNER TO postgres;
ALTER FUNCTION public.send_piutang_reminder_test(p_rule_type text) OWNER TO postgres;
ALTER FUNCTION public.stop_impersonation() OWNER TO postgres;
ALTER FUNCTION public.suspend_tenant(p_tenant_id uuid, p_reason text) OWNER TO postgres;
ALTER FUNCTION public.transfer_warehouse(p_sku text, p_from text, p_to text, p_qty integer) OWNER TO postgres;
