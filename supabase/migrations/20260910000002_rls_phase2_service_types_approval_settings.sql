-- 20260910000002 — Phase 2 warm-up: RLS for service_types + approval_settings
--
-- Follows 20260910000001 (Phase 1: 9 RPC-only tables). These 2 tables have
-- ONE client-side .select() call each and their mutations already go through
-- SECURITY DEFINER RPCs — so the policy design is minimal:
--
--   * service_types (2 rows in prod, small service catalog)
--       - Read: authenticated ONLY (SELECT policy USING (true))
--       - Mutations: SD RPCs upsert_service_type + deactivate_service_type
--       - Grants: SELECT was granted to anon+authenticated already; INSERT/
--         UPDATE/DELETE not granted (mutations must go through RPCs).
--       - Client call sites: pengaturan/JenisJasaCrudPanel.tsx + penjualan
--         CartRows + CatatPenjualanWizard (all behind auth).
--
--   * approval_settings (19 rows in prod, one per request_type)
--       - Read: authenticated ONLY (SELECT policy USING (true))
--       - Mutations: SD RPC set_approval_setting (role-gated to Owner /
--         Staff Admin Toko inside the function body).
--       - Grants: same shape — SELECT to anon+authenticated, INSERT/UPDATE/
--         DELETE not granted. See comment at pengaturanServices.ts:12-14.
--       - Client call site: pengaturan/ApprovalSettingsPanel via
--         approvalSettingsService.fetch() (Owner/Admin screen).
--
-- What changes for anon before/after:
--   BEFORE: anon key could SELECT both tables (service catalog +
--           approval workflow config visible without login).
--   AFTER:  anon key SELECT returns [] (no policy grants access).
--
-- What changes for authenticated:
--   BEFORE: unrestricted SELECT.
--   AFTER:  SELECT allowed via new policy. Mutation grants untouched
--           (still no direct INSERT/UPDATE/DELETE; RPCs bypass RLS).
--
-- Multi-tenant TODO:
--   Both tables carry a `tenant_id` column that's NULL for the single-tenant
--   Garindo deployment. When Sub-Project A (multi-tenant SaaS MVP) ships,
--   these policies must tighten from `USING (true)` to
--   `USING (tenant_id IS NULL OR tenant_id = public.current_tenant_id())`
--   as part of that phase's RLS sweep. Design spec:
--   docs/superpowers/specs/2026-06-24-multi-tenant-saas-mvp-subproject-A-infra-design.md
--
-- Verification post-apply:
--   1. Named users: authenticated must see all rows (Pengaturan + Penjualan
--      wizard work).
--   2. Anon: GET /rest/v1/service_types → [], GET /rest/v1/approval_settings
--      → [].
--   3. Mutation via authenticated: direct .update() still returns 42501
--      (grants unchanged; policy also blocks). Only RPC path works.
--
-- Rollback (emergency only, re-opens anon read):
--   DROP POLICY service_types_read_authenticated ON public.service_types;
--   DROP POLICY approval_settings_read_authenticated ON public.approval_settings;
--   ALTER TABLE public.service_types DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.approval_settings DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.service_types      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_settings  ENABLE ROW LEVEL SECURITY;

-- SELECT policies: authenticated only, all rows.
-- Idempotent via DROP-then-CREATE (CREATE POLICY IF NOT EXISTS requires PG15+;
-- this pattern is universally compatible and safe to re-run).
DROP POLICY IF EXISTS service_types_read_authenticated ON public.service_types;
CREATE POLICY service_types_read_authenticated
  ON public.service_types
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS approval_settings_read_authenticated ON public.approval_settings;
CREATE POLICY approval_settings_read_authenticated
  ON public.approval_settings
  FOR SELECT
  TO authenticated
  USING (true);
