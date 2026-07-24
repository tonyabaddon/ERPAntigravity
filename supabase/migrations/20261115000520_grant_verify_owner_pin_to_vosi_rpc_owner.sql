-- Migration 20261115000520: GRANT EXECUTE on verify_owner_pin to vosi_rpc_owner
-- (regression follow-up from migration 000519 — 2026-07-24)
--
-- Symptom: after 000519 reverted verify_owner_pin OWNER back to postgres to
-- fix "permission denied for schema auth", customer_credit_activate approval
-- returned NEW error: `permission denied for function verify_owner_pin`.
--
-- Root cause: 4 approval RPCs owned by vosi_rpc_owner call verify_owner_pin
-- internally (approve_customer_credit_activate, approve_customer_credit_deactivate,
-- approve_customer_credit_limit_change, decide_via_wa_button). Once
-- verify_owner_pin moved back to OWNER postgres, vosi_rpc_owner lost implicit
-- ownership + never had explicit EXECUTE grant → SECDEF RPCs owned by
-- vosi_rpc_owner can no longer invoke it.
--
-- Fix: GRANT EXECUTE ON FUNCTION verify_owner_pin TO vosi_rpc_owner. Keeps
-- verify_owner_pin's OWNER as postgres (needed for auth schema access), but
-- allows role-owned SECDEF wrappers to call it as expected.
--
-- Idempotent: GRANT safe to re-run.

GRANT EXECUTE ON FUNCTION public.verify_owner_pin(bigint, text) TO vosi_rpc_owner;

-- Verify: vosi_rpc_owner now has EXECUTE
DO $$
DECLARE v_has_grant boolean;
BEGIN
  SELECT has_function_privilege('vosi_rpc_owner', 'public.verify_owner_pin(bigint, text)', 'EXECUTE')
    INTO v_has_grant;
  IF NOT v_has_grant THEN
    RAISE EXCEPTION 'grant_verify_owner_pin: vosi_rpc_owner still lacks EXECUTE on verify_owner_pin';
  END IF;
  RAISE NOTICE 'vosi_rpc_owner now has EXECUTE on verify_owner_pin';
END $$;
