-- 20260910000007 — Phase 2 FINAL batch: tenant_settings + approval_requests
--
-- Closes the last 2 tables on the 18-table RLS advisory surfaced during the
-- 2026-07-01 E2E audit. Advisory goes 18 → 0 after this migration.
--
--   * tenant_settings (1 row — single-tenant Garindo config)
--       - Read: authenticated ONLY (SELECT policy USING (true))
--       - Consumer: pengaturanServices.ts:43 tenantSettingsService.fetch()
--         (`.select('*').is('tenant_id', null).maybeSingle()`)
--       - Mutations: SECURITY DEFINER RPCs `set_tenant_modul` +
--         `set_tenant_pajak`. All mutations go through role-gated RPCs;
--         no direct client write path.
--       - Grants: SELECT only for anon+authenticated. No INSERT/UPDATE/
--         DELETE grants — SD RPCs bypass grants + RLS.
--
--   * approval_requests (1206 rows)
--       - Read: authenticated ONLY (SELECT policy USING (true))
--       - Consumers:
--           - listPendingApprovals (supabaseClient.ts:1699) — approval inbox
--           - getApprovalRequest (supabaseClient.ts:1710) — detail view
--           - TempoCreditSection.tsx:44 — poll for pending tempo credit
--             requests for a specific customer
--       - Client INSERT (documented as intentional direct-insert pattern):
--         approvalService.requestInitialStock at supabaseClient.ts:1656
--         (comment at 1636-1642: "no dedicated RPC — RLS lets authenticated
--         users insert their own pending requests"). Inserts a row with
--         request_type='initial_stock', payload={sku, qty, warehouse_id, ...},
--         requested_by=<user id from caller>.
--       - INSERT policy: WITH CHECK (requested_by = auth.uid()). Anti-
--         impersonation — a user can only file a request attributing
--         themselves as the requester. Prevents a rogue client from
--         forging a request "on behalf of" another user (which the
--         approval workflow would then blame on that user in decision
--         history).
--       - Grants: SELECT + INSERT for anon+authenticated. No UPDATE/DELETE
--         grants — status transitions (pending→approved/rejected) happen
--         inside SD RPCs like `verify_owner_pin`, `commit_opname`, etc.
--
-- What changes for anon:
--   BEFORE: could SELECT the full approval inbox (payloads may contain
--           customer info, price change requests, initial stock requests
--           with SKU + cost basis, opname variances). Could also forge
--           approval_requests inserts.
--   AFTER:  SELECT → []; INSERT → 42501.
--
-- What changes for authenticated:
--   tenant_settings: SELECT works via new policy (was allowed by "no RLS").
--   approval_requests: SELECT works via new policy; INSERT works only when
--     requested_by = auth.uid(). This is a real invariant tighten — before,
--     the INSERT was fully unrestricted. If any caller was passing a
--     `requested_by` other than the logged-in user's id, that would now
--     break. Grep of `approval_requests').insert(` in `src/` shows one
--     site (approvalService.requestInitialStock) that receives requestedBy
--     as an argument. All callers currently pass `currentUser.id`. Any
--     future caller must do the same, or route through an SD RPC that
--     bypasses RLS.
--
-- Access-level gating: SELECT is USING (true) — any authenticated user can
-- PostgREST-SELECT the full approval inbox via a direct call. The UI
-- restricts the inbox to Owner/Admin, but the DB doesn't. Same follow-up
-- as previous batches: role-gated read via `is_owner_or_admin()` helper.
--
-- Multi-tenant TODO: tenant_settings and approval_requests both have a
-- `tenant_id` column that's NULL for Garindo (single-tenant). When
-- Sub-Project A ships, tighten USING/WITH CHECK to
-- `(tenant_id IS NULL OR tenant_id = public.current_tenant_id())`.
--
-- Verification post-apply:
--   1. pg_class.relrowsecurity=true for both.
--   2. Anon curl GET tenant_settings + approval_requests → [] on both.
--   3. Anon POST approval_requests → 42501.
--   4. Live UI: Pengaturan tab loads (reads tenant_settings); Persetujuan
--      inbox loads pending approvals; per-customer TempoCredit poll works.
--   5. DB DO-block smoke: authenticated INSERT with
--      requested_by = self → allowed; requested_by = foreign_uid → 42501.
--   6. Advisory advisory endpoint (get_advisors) no longer flags any
--      RLS-off tables.
--
-- Rollback (emergency only, re-opens anon holes):
--   DROP POLICY tenant_settings_read_authenticated ON public.tenant_settings;
--   DROP POLICY approval_requests_read_authenticated ON public.approval_requests;
--   DROP POLICY approval_requests_insert_self ON public.approval_requests;
--   ALTER TABLE public.tenant_settings DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.approval_requests DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.tenant_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_settings_read_authenticated ON public.tenant_settings;
CREATE POLICY tenant_settings_read_authenticated
  ON public.tenant_settings
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS approval_requests_read_authenticated ON public.approval_requests;
CREATE POLICY approval_requests_read_authenticated
  ON public.approval_requests
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS approval_requests_insert_self ON public.approval_requests;
CREATE POLICY approval_requests_insert_self
  ON public.approval_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (requested_by = auth.uid());
