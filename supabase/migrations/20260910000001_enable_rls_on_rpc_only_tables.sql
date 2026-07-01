-- 20260910000001 — Phase 1: enable RLS on 9 RPC-only tables
--
-- Closes half of the 18-table RLS-off advisory surfaced by
-- `mcp__supabase__list_tables` during the E2E audit on 2026-07-01. These 9
-- tables have ZERO direct client-side `.from()` call sites in the frontend
-- (grep of `src/`, excluding tests) and are only written / read via
-- SECURITY DEFINER RPCs. SD RPCs bypass RLS, so ENABLE ROW LEVEL SECURITY
-- with NO policies is safe:
--   * Client (anon + authenticated) direct access → blocked (correct new behavior).
--   * SD RPC access                                → unchanged (bypasses RLS).
--   * Backend-go via SUPABASE_SERVICE_KEY          → unchanged (bypasses RLS).
--   * Test harness via SUPABASE_DB_CONNECTION      → unchanged (direct postgres role bypasses RLS).
--
-- Before this migration, `anon` and `authenticated` each had SELECT / INSERT /
-- UPDATE / DELETE / TRUNCATE grants on every one of these tables (verified via
-- information_schema.role_table_grants). The anon key is baked into the frontend
-- bundle, so this means ANYONE could read/write the entire audit trail
-- (`stock_movements`, `stock_price_history`, `gl_dual_write_anomalies`), the
-- append-only stock adjustments, the invoice sequence counter, etc. This is
-- the "critical" advisory the Supabase advisor flagged.
--
-- Phase 2 (separate migration) will handle the remaining 9 tables that DO
-- have client-side access sites and therefore need real per-table policies:
--   approval_requests, audit_log, service_types, stock_opname_sessions,
--   warehouses, warehouse_audit_log, piutang_write_off_requests,
--   approval_settings, tenant_settings.
--
-- Grants: NOT revoked here. Belt-and-suspenders REVOKE INSERT/UPDATE/DELETE
-- from anon/authenticated is a valid follow-up (RLS is the primary defense;
-- revoking grants adds a second layer). Kept out of this migration to keep
-- the diff surgical: ENABLE RLS is enough to close the hole.
--
-- Verification query (run after apply):
--   select relname, relrowsecurity
--   from pg_class
--   where relnamespace = 'public'::regnamespace
--     and relname in (
--       'stock_movements','stock_adjustments','stock_opname_counts',
--       'price_change_requests','stock_price_history','warehouse_transfers',
--       'stock_levels','invoice_counters','gl_dual_write_anomalies'
--     )
--   order by relname;
--   → expect relrowsecurity = true for all 9 rows.
--
-- Rollback (emergency only; re-opens the security hole):
--   ALTER TABLE public.<name> DISABLE ROW LEVEL SECURITY;
--
-- ENABLE ROW LEVEL SECURITY is idempotent — safe to re-run.

ALTER TABLE public.stock_movements         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_opname_counts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_change_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_price_history     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_transfers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_levels            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_counters        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gl_dual_write_anomalies ENABLE ROW LEVEL SECURITY;
