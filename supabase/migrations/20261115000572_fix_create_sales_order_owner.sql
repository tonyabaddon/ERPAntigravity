-- ============================================================================
-- Fix create_sales_order RPC owner: vosi_rpc_owner → postgres.
--
-- Root cause: migration 571 re-created the function via CREATE OR REPLACE
-- FUNCTION. In this environment the pre-existing owner was vosi_rpc_owner
-- (either from prior manual ALTER or defaulted post-Phase-A). The RPC body
-- calls `auth.uid()` — miss-log Entry #4 codified class rule:
--   Any SECDEF that reads or writes `auth.*` MUST be OWNER postgres.
-- Otherwise the SECDEF wrapper hits 42501 "permission denied for schema auth"
-- at call time.
--
-- Reproduced on Toko Jaya Makmur prod smoke 2026-08-05:
--   POST /rest/v1/rpc/create_sales_order → 403
--   {"code":"42501","message":"permission denied for schema auth"}
--
-- Fix: transfer OWNER to postgres. Idempotent (ALTER FUNCTION OWNER is
-- always safe to re-run).
-- ============================================================================

ALTER FUNCTION public.create_sales_order(jsonb) OWNER TO postgres;
