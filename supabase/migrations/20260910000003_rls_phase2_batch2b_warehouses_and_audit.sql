-- 20260910000003 — Phase 2 batch 2b: RLS for warehouses, warehouse_audit_log,
--                                    piutang_write_off_requests
--
-- Follows the same shape as 20260910000002 (warm-up). All three tables have
-- SELECT-only client access via authenticated; every mutation is a SECURITY
-- DEFINER RPC that bypasses RLS. Grants for INSERT/UPDATE/DELETE are STILL
-- OPEN to anon+authenticated on these tables (verified via
-- information_schema.role_table_grants) — unlike the warm-up tables where
-- the grants had already been trimmed. So RLS is the primary defense here,
-- and until a separate REVOKE migration lands, this policy pair is the only
-- thing blocking anon from writing.
--
--   * warehouses (3 rows)
--       - Read: authenticated ONLY. Consumer: warehouse picker in Kasir /
--         Pembelian / Opname / Produk & Stok, plus admin CRUD in Pengaturan.
--       - Client sites: src/lib/supabaseClient.ts:1046 (fetchAll),
--         1058 (fetchActive filtered on is_active=true).
--       - Mutations: create_warehouse, update_warehouse, set_default_warehouse,
--         deactivate_warehouse, force_deactivate_warehouse (PIN-gated),
--         reactivate_warehouse. All SD, role-gated inside function body.
--
--   * warehouse_audit_log (96 rows, append-only)
--       - Read: authenticated ONLY. Consumer: Pengaturan → Manajemen Gudang
--         audit tab.
--       - Client site: src/lib/supabaseClient.ts:1117 (fetchAuditLog, limit=50).
--       - Writes: injected inside the warehouse SD RPCs above; no client
--         insert path.
--       - No tenant_id column — this table is linked to warehouses via
--         warehouse_id FK. When Sub-Project A ships, the SELECT policy must
--         tighten to only expose rows for warehouses in the caller's tenant
--         (via EXISTS subquery). Left as USING (true) for now — Garindo is
--         single-tenant.
--
--   * piutang_write_off_requests (4 rows)
--       - Read: authenticated ONLY. Consumer: Persetujuan (Approval Inbox)
--         rendering per-row satellite details for write-off approval requests.
--       - Client site: src/components/approval/TempoWriteOffApprovalRequestRow.tsx:39
--         (select reason, order_id where approval_id = <id>).
--       - Writes: inserted by the SD RPC that creates the write-off approval
--         request (satellite for approval_requests).
--       - No tenant_id column — linked via approval_id and order_id. Same
--         multi-tenant TODO as warehouse_audit_log.
--
-- Access-level gating (Owner / Admin only) is enforced at the UI layer, not
-- at the DB. This RLS matches current runtime behavior: any authenticated
-- user can SELECT these tables via PostgREST if they know the endpoint.
-- If we want DB-level role gating, that's a separate follow-up (needs a
-- helper function like `is_owner_or_admin()` reading admin_users role).
--
-- What changes for anon:
--   BEFORE: SELECT/INSERT/UPDATE/DELETE on warehouses + piutang_write_off_requests,
--           SELECT/INSERT on warehouse_audit_log — anyone with the anon key
--           could tamper with the warehouse master, forge audit rows, or
--           read/mutate the piutang write-off approval satellite.
--   AFTER:  SELECT → [] (no policy grants access). INSERT/UPDATE/DELETE →
--           42501 RLS violation (no policy allows).
--
-- Verification post-apply:
--   1. pg_class.relrowsecurity=true for all 3.
--   2. Anon curl GET /rest/v1/warehouses → [], GET .../warehouse_audit_log
--      → [], GET .../piutang_write_off_requests → [].
--   3. Live UI: warehouse picker in Kasir loads options; Pengaturan →
--      Manajemen Gudang audit tab loads rows; Persetujuan write-off row
--      renders reason + customer.
--
-- Rollback (emergency only, re-opens anon read + writes on tables where
-- grants are still open):
--   DROP POLICY warehouses_read_authenticated ON public.warehouses;
--   DROP POLICY warehouse_audit_log_read_authenticated ON public.warehouse_audit_log;
--   DROP POLICY piutang_write_off_requests_read_authenticated ON public.piutang_write_off_requests;
--   ALTER TABLE public.warehouses DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.warehouse_audit_log DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.piutang_write_off_requests DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.warehouses                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_audit_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.piutang_write_off_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warehouses_read_authenticated ON public.warehouses;
CREATE POLICY warehouses_read_authenticated
  ON public.warehouses
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS warehouse_audit_log_read_authenticated ON public.warehouse_audit_log;
CREATE POLICY warehouse_audit_log_read_authenticated
  ON public.warehouse_audit_log
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS piutang_write_off_requests_read_authenticated ON public.piutang_write_off_requests;
CREATE POLICY piutang_write_off_requests_read_authenticated
  ON public.piutang_write_off_requests
  FOR SELECT
  TO authenticated
  USING (true);
