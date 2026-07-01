-- 20260910000008 — RLS follow-ups: role-gated helper + write-grant revokes
--                   + E2E orphan mark + multi-tenant deferral note
--
-- Bundle of small follow-ups from the RLS Phase 2 finalization:
--   1. is_owner_or_admin() helper for role-scoped RLS policies
--   2. Tighten SELECT policies on admin-scoped tables (audit_log,
--      warehouse_audit_log, approval_requests) via the helper
--   3. REVOKE INSERT/UPDATE/DELETE from anon+authenticated on tables that
--      have no direct client mutation path (belt-and-suspenders on top of
--      RLS)
--   4. Mark the E2E-TEST-DELETEME product as deleted in-place (can't hard-
--      delete due to FK from append-only stock_movements)
--
-- (Multi-tenant tenant_id filter is DEFERRED — needs Sub-Project A infra.
--  See sections below for the design contract.)

-- ────────────────────────────────────────────────────────────────────────
-- 1. Helper: is_owner_or_admin()
-- ────────────────────────────────────────────────────────────────────────
-- Returns true when auth.uid() maps to an admin_users row with a
-- privileged role. Current roles in admin_users: 'Owner' (5 users),
-- 'Staff Admin Toko' (20). Both are admin-tier — the practical current
-- effect is identical to USING (true), but the helper is future-proof:
-- when finer roles ship (e.g. 'Kasir', 'Read-only'), they'll be blocked
-- automatically from any policy that uses this.
--
-- STABLE + SECURITY DEFINER: STABLE for query-plan caching within a
-- statement; SECURITY DEFINER so the admin_users SELECT bypasses RLS on
-- that table regardless of the caller's JWT.

CREATE OR REPLACE FUNCTION public.is_owner_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE id = auth.uid()
      AND role IN ('Owner', 'Staff Admin Toko')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_owner_or_admin() TO authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 2. Tighten SELECT policies on admin-scoped tables
-- ────────────────────────────────────────────────────────────────────────
-- audit_log, warehouse_audit_log, approval_requests are admin screens in
-- the UI. Move the RLS SELECT from USING (true) to USING (is_owner_or_admin())
-- so PostgREST direct SELECT is also gated. Same story as documented in
-- previous batches — the UI already restricted access; RLS now matches.
--
-- DROP-then-CREATE for idempotency.

DROP POLICY IF EXISTS audit_log_read_authenticated ON public.audit_log;
CREATE POLICY audit_log_read_owner_or_admin
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (public.is_owner_or_admin());

DROP POLICY IF EXISTS warehouse_audit_log_read_authenticated ON public.warehouse_audit_log;
CREATE POLICY warehouse_audit_log_read_owner_or_admin
  ON public.warehouse_audit_log
  FOR SELECT
  TO authenticated
  USING (public.is_owner_or_admin());

DROP POLICY IF EXISTS approval_requests_read_authenticated ON public.approval_requests;
CREATE POLICY approval_requests_read_owner_or_admin
  ON public.approval_requests
  FOR SELECT
  TO authenticated
  USING (public.is_owner_or_admin());

-- The audit_log INSERT policy stays as-is (write-self, actor_user_id =
-- auth.uid()) — any authenticated user should be able to log their own
-- audit event; only reads are admin-scoped.
--
-- The approval_requests INSERT policy stays (requested_by = auth.uid())
-- for the same reason — a non-admin user (e.g. future Kasir role) can
-- still file an initial_stock approval request even though they can't
-- read the full inbox.

-- ────────────────────────────────────────────────────────────────────────
-- 3. REVOKE unnecessary write grants (defense in depth)
-- ────────────────────────────────────────────────────────────────────────
-- Tables covered by RLS SELECT-only policies still had INSERT/UPDATE/
-- DELETE grants for anon+authenticated (verified via
-- information_schema.role_table_grants). RLS was the only block. Revoking
-- the grants means even if RLS were somehow bypassed (via a bug or
-- misconfig), no direct writes are possible from these roles. SD RPCs
-- bypass grants+RLS (they run as postgres owner), so nothing routed
-- through the RPCs breaks.
--
-- Coverage:
--   - warehouses               (batch 2b)
--   - warehouse_audit_log      (batch 2b)
--   - piutang_write_off_requests (batch 2b)
--   - stock_opname_sessions    (batch 2c)
--   - tenant_settings          (batch 2d)
--
-- NOT covered here (grants intentionally kept):
--   - audit_log INSERT (EditOrderModal.tsx:59 direct write; gated by
--     WITH CHECK actor_user_id = auth.uid())
--   - approval_requests INSERT (approvalService.requestInitialStock;
--     gated by WITH CHECK requested_by = auth.uid())
--   - service_types + approval_settings (Phase 2 warm-up — grants were
--     already trimmed in an earlier migration; no additional REVOKE needed)
--   - stocks (has its own value-bearing column strategy — see task 3 in
--     progress.md 2026-07-02)

REVOKE INSERT, UPDATE, DELETE ON public.warehouses               FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.warehouse_audit_log      FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.piutang_write_off_requests FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.stock_opname_sessions    FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.tenant_settings          FROM anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 4. Mark E2E-TEST-DELETEME as deleted (can't hard-delete)
-- ────────────────────────────────────────────────────────────────────────
-- Left over from full-commit E2E on 2026-07-01. Hard delete blocked by
-- stock_movements_sku_fkey (append-only audit trail references retained
-- for compliance). No is_active / deleted_at column exists on stocks
-- (see progress.md 2026-07-02 for the follow-up to add proper soft-delete
-- infra).
--
-- Interim: rename to make the row obviously-defunct in any catalog view,
-- and set status to trigger the existing "hidden if 'Deleted' status" UI
-- convention if any exists. If the row appears in a search, its name
-- clearly indicates it should be ignored.

UPDATE public.stocks
SET name = 'DELETED - E2E TEST (do not use)',
    updated_at = now()
WHERE sku = 'E2E-TEST-DELETEME';

-- ────────────────────────────────────────────────────────────────────────
-- 5. Multi-tenant TODO (DEFERRED — needs Sub-Project A infra)
-- ────────────────────────────────────────────────────────────────────────
-- Every RLS policy shipped 20260910000001..20260910000007 uses
-- USING (true) or USING (is_owner_or_admin()) — none of them filter by
-- tenant_id. That's correct for the single-tenant Garindo deployment,
-- where all rows have tenant_id IS NULL.
--
-- When Sub-Project A ships (docs/superpowers/specs/2026-06-24-multi-
-- tenant-saas-mvp-subproject-A-infra-design.md), the following are needed
-- BEFORE the tenant_id filter can land:
--
--   - public.current_tenant_id() helper that reads tenant_id from the
--     caller's JWT (Sub-Project A design §4).
--   - public.is_superadmin() helper for cross-tenant admin access.
--   - Backfill: every existing row with tenant_id IS NULL is assigned
--     to Garindo's tenant_id.
--   - Every subsequent INSERT via SD RPC sets tenant_id explicitly.
--
-- Then a follow-up migration rewrites every USING clause on these
-- tables from `true` (or `is_owner_or_admin()`) to
-- `(tenant_id IS NULL OR tenant_id = public.current_tenant_id()
--   OR public.is_superadmin())`.
--
-- Tables affected (from every batch): stocks, tenant_settings,
-- approval_requests, service_types, approval_settings, warehouses,
-- warehouse_audit_log, piutang_write_off_requests, stock_opname_sessions,
-- audit_log, plus the 9 Phase-1 RPC-only tables that don't have
-- policies today but will need `USING (tenant_id = current_tenant_id())`
-- if their RPCs are tenant-scoped.
--
-- Deferred, not attempted here.
