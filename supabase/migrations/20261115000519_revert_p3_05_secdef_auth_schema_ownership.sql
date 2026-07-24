-- Migration 20261115000519: revert P3-05 SECDEF ownership for 10 auth-schema RPCs
-- (regression fix — 2026-07-24)
--
-- Symptom: Owner clicks "Setujui" on approval request → PIN pad opens → enters
-- 6 digits → POST /rpc/verify_owner_pin returns HTTP 403 with
-- `{"code":"42501","message":"permission denied for schema auth"}`.
-- OwnerPinPad shows cryptic "[object Object]" error text (separate bug —
-- see FE fix below in follow-up), PIN dots reset, user cannot approve.
--
-- Founder-reported: "saya tidak bisa masukin PIN approval untuk jumlah stock"
-- (2026-07-24, testing initial_stock approval on Testing Jaya Panel).
--
-- Root cause: same class as migration 000514. P3-05 TIER B + C batch migrated
-- SECDEF functions from OWNER postgres (superuser bypass) to OWNER
-- vosi_rpc_owner (least-privilege intent). But vosi_rpc_owner lacks USAGE on
-- schema auth in Supabase-managed Postgres, and schema auth is owned by
-- supabase_auth_admin (protected role) — grants are blocked.
--
-- Migration 000514 reverted 22 functions with this issue. Ten MORE functions
-- were missed by 000514 but ALSO reference schema auth. This migration reverts
-- the remaining 10 to OWNER postgres (superuser bypass).
--
-- Enumeration query used to find them:
--   SELECT proname FROM pg_proc
--    WHERE pg_get_userbyid(proowner) = 'vosi_rpc_owner'
--      AND (prosrc LIKE '%auth.%'
--        OR prosrc LIKE '%auth.uid()%'
--        OR prosrc LIKE '%FROM auth.users%')
--    ORDER BY proname;
--
-- P3-05 goal (least-privilege) unchanged — the option remains rewrite bodies
-- to use current_setting('request.jwt.claim.sub') pattern, or Supabase support
-- request for grant. Meantime: revert to unblock prod.
--
-- Idempotent: ALTER FUNCTION safe to re-run.

ALTER FUNCTION public._piutang_write_off_resolve_owner() OWNER TO postgres;
ALTER FUNCTION public.approve_and_amend_rakit_lock(p_approval_id bigint, p_amended_lines jsonb) OWNER TO postgres;
ALTER FUNCTION public.clear_conversation_lock(p_conv_id uuid) OWNER TO postgres;
ALTER FUNCTION public.grant_impersonation(p_admin_email text, p_expires_in_hours integer, p_reason text) OWNER TO postgres;
ALTER FUNCTION public.manually_override_conversation_state(p_conv_id uuid, p_new_state conversation_state, p_lock_minutes integer) OWNER TO postgres;
ALTER FUNCTION public.provision_tenant(p_owner_user_id uuid, p_slug text, p_name text, p_owner_name text, p_owner_email text, p_plan_code text, p_expires_in_months integer, p_environment text) OWNER TO postgres;
ALTER FUNCTION public.record_balance_adjustment(p_cash_account_id uuid, p_direction text, p_amount numeric, p_counterpart_coa_id uuid, p_reason text, p_pin text, p_entry_date date) OWNER TO postgres;
ALTER FUNCTION public.reject_customer_credit_activate(p_request_id bigint, p_reason text) OWNER TO postgres;
ALTER FUNCTION public.revoke_impersonation(p_grant_id uuid, p_reason text) OWNER TO postgres;
ALTER FUNCTION public.verify_owner_pin(p_approval_id bigint, p_pin text) OWNER TO postgres;

-- Verify: all 10 functions now owned by postgres
DO $$
DECLARE
  v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
    FROM pg_proc
   WHERE proname IN (
      '_piutang_write_off_resolve_owner','approve_and_amend_rakit_lock',
      'clear_conversation_lock','grant_impersonation',
      'manually_override_conversation_state','provision_tenant',
      'record_balance_adjustment','reject_customer_credit_activate',
      'revoke_impersonation','verify_owner_pin'
     )
     AND pg_get_userbyid(proowner) <> 'postgres';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'revert_p3_05_secdef_auth_schema_ownership: % functions not owned by postgres', v_bad;
  END IF;
  RAISE NOTICE 'verified: all 10 SECDEF functions owned by postgres';
END $$;
