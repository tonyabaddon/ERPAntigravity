-- Phase A+ hotfix: enforce security_invoker=true on ALL public views to close
-- a cross-tenant data leak surfaced on 2026-07-07 during tenant #2 (Toko Jaya
-- Makmur) end-to-end smoke test.
--
-- SYMPTOM: demo-owner@vosi.id (tenant 22222222-...) opened /kasBank and saw
-- Garindo's Kas Toko row (tenant 11111111-...) with Rp 56.548.131 + 92 GL
-- mutasi rendered as their own account.
--
-- ROOT CAUSE: views in `public` are owned by `postgres`, which has BYPASSRLS.
-- With the default `security_invoker=false`, the view's underlying SELECTs on
-- cash_accounts / journal_entry_lines / journal_entries execute as the OWNER
-- (postgres, BYPASSRLS), so RLS on those tables is skipped entirely and every
-- tenant's rows are returned. PostgREST then serves the aggregated payload to
-- whichever JWT called the view. The view itself has no `WHERE ca.tenant_id =
-- _resolve_tenant_id()` guard, so the response mixes tenants.
--
-- FIX: `ALTER VIEW ... SET (security_invoker = true)` makes the underlying
-- SELECTs execute as the QUERYING role, restoring the RLS policies on
-- cash_accounts / journal_entries / journal_entry_lines / tenants /
-- tenant_subscriptions / tenant_payments / etc. Admin surfaces continue to
-- work because platform admins get row visibility through the
-- `_is_platform_admin_from_jwt()`-gated `p_platform_admin_readall` /
-- `p_platform_admin_only` policies that the RLS layer already carries.
--
-- SCOPE: all 13 views currently in `public` at the time of writing. The
-- Phase A isolation-audit only checked tables; views were not swept. A
-- follow-up migration should extend the audit to enforce this invariant.

BEGIN;

-- ── Tenant-scoped operational views ────────────────────────────────────────
-- Confirmed leak vector — Kas & Bank screen served Garindo data to tenant #2.
ALTER VIEW public.cash_account_balances SET (security_invoker = true);

-- Likely leaks — same pattern, GL/COGS/kasir data joined without tenant filter.
ALTER VIEW public.general_ledger SET (security_invoker = true);
ALTER VIEW public.trial_balance SET (security_invoker = true);
ALTER VIEW public.order_cogs_breakdown SET (security_invoker = true);
ALTER VIEW public.kasir_rakit_forfeit_summary SET (security_invoker = true);
ALTER VIEW public.kasir_transactions_legacy SET (security_invoker = true);

-- Pengawasan (surveillance) views — read GL/kasir data.
ALTER VIEW public.v_pengawasan_kasir_discount_7d SET (security_invoker = true);
ALTER VIEW public.v_pengawasan_outflow_outliers SET (security_invoker = true);
ALTER VIEW public.v_pengawasan_top_adjustments SET (security_invoker = true);
ALTER VIEW public.v_pengawasan_transfer_aging SET (security_invoker = true);

-- ── Admin-scope aggregate views ────────────────────────────────────────────
-- Consumed only by admin panel (AdminRoutes / AttentionQueue / AdminRevenue /
-- OverviewTab). Setting security_invoker=true means platform admins continue
-- to see all rows via _is_platform_admin_from_jwt() policies, while any
-- accidental non-admin caller is properly RLS-bound.
ALTER VIEW public.v_tenant_effective_features SET (security_invoker = true);
ALTER VIEW public.v_tenant_payment_coverage SET (security_invoker = true);

-- v_tenant_usage_summary was intentionally EXCLUDED here at the time of
-- writing. It JOINs tenant_users, whose a_self_or_tenant_admin RLS policy
-- contained a self-referential EXISTS subquery — under security_invoker
-- mode that triggered 42P17 infinite recursion.
--
-- Migration 20261115000030 (fix_tenant_users_rls_self_recursion) closed
-- this by extracting the membership check into a SECDEF helper
-- (_is_tenant_admin) and flipping v_tenant_usage_summary to invoker mode.
-- All public views now enforce RLS.

COMMIT;

-- ── Post-apply verification (run manually via MCP after apply) ─────────────
-- 1. Every public view now security_invoker=true:
--    SELECT c.relname,
--           COALESCE((SELECT bool_or(opt LIKE 'security_invoker=true')
--                     FROM unnest(c.reloptions) AS opt), false) AS ok
--    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--    WHERE n.nspname='public' AND c.relkind='v'
--    ORDER BY ok, c.relname;
--
-- 2. Tenant #2 user should now see only its own cash accounts:
--    -- as demo-owner JWT via PostgREST:
--    -- GET /rest/v1/cash_account_balances → 3 rows, all tenant_id=22222222-...
--
-- 3. Garindo user regression check:
--    -- as tonywei.office@gmail.com (Garindo owner) JWT via PostgREST:
--    -- GET /rest/v1/cash_account_balances → rows only for tenant_id=11111111-...
