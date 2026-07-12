-- 20261115000214_warehouse_transfers_rls.sql
-- Standard t_* RLS policies for both new tables. t_select_own explicitly
-- includes vosi_rpc_owner so SECDEF RPCs' INSERT ... RETURNING clauses
-- succeed (memory: secdef_returning_gap).

BEGIN;

-- ─── warehouse_transfers ─────────────────────────────────────────────────
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='warehouse_transfers' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.warehouse_transfers', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "t_select_own" ON public.warehouse_transfers
  FOR SELECT TO authenticated, vosi_rpc_owner
  USING (tenant_id = _resolve_tenant_id() OR current_user = 'vosi_rpc_owner');

CREATE POLICY "t_insert_own" ON public.warehouse_transfers
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);

CREATE POLICY "t_update_own" ON public.warehouse_transfers
  FOR UPDATE TO authenticated
  USING  (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);

CREATE POLICY "t_delete_own" ON public.warehouse_transfers
  FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);

ALTER TABLE public.warehouse_transfers ENABLE  ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_transfers FORCE   ROW LEVEL SECURITY;
REVOKE ALL ON public.warehouse_transfers FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_transfers TO authenticated;

-- ─── warehouse_transfer_items ────────────────────────────────────────────
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='warehouse_transfer_items' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.warehouse_transfer_items', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "t_select_own" ON public.warehouse_transfer_items
  FOR SELECT TO authenticated, vosi_rpc_owner
  USING (tenant_id = _resolve_tenant_id() OR current_user = 'vosi_rpc_owner');

CREATE POLICY "t_insert_own" ON public.warehouse_transfer_items
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);

CREATE POLICY "t_update_own" ON public.warehouse_transfer_items
  FOR UPDATE TO authenticated
  USING  (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);

CREATE POLICY "t_delete_own" ON public.warehouse_transfer_items
  FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);

ALTER TABLE public.warehouse_transfer_items ENABLE  ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_transfer_items FORCE   ROW LEVEL SECURITY;
REVOKE ALL ON public.warehouse_transfer_items FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_transfer_items TO authenticated;

-- ─── warehouse_transfer_doc_seq (RPC-only, no client access) ─────────────
ALTER TABLE public.warehouse_transfer_doc_seq ENABLE  ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_transfer_doc_seq FORCE   ROW LEVEL SECURITY;
REVOKE ALL ON public.warehouse_transfer_doc_seq FROM anon, authenticated, PUBLIC;
-- vosi_rpc_owner already has ownership as SECDEF caller.

COMMIT;
