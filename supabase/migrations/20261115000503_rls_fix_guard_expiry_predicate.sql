-- 2D (2026-07-20): swap broken _guard_expiry_write() IS NULL predicate
-- (always false, void IS NULL evaluates to false) to working _check_expiry_ok()
-- boolean on 6 residual policies (warehouse_transfers + warehouse_transfer_items).
--
-- Per memory `guard_expiry_write_broken_predicate` — these are the last 6
-- policies with the broken predicate (other tables already migrated).
-- After this migration, 0 policies remain with the broken predicate.
--
-- Direct client writes to WT tables were silently blocked; code uses SECDEF
-- RPCs (initiate/receive/cancel_warehouse_transfer) which bypass RLS, so no
-- user-visible impact existed. This migration RESTORES the fallback direct-write
-- path for admin tooling / debugging.
--
-- Idempotent: DROP IF EXISTS + CREATE.
-- Atomic: all 6 swapped in one transaction.

BEGIN;

-- warehouse_transfers
DROP POLICY IF EXISTS t_insert_own ON warehouse_transfers;
CREATE POLICY t_insert_own ON warehouse_transfers FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _check_expiry_ok());

DROP POLICY IF EXISTS t_update_own ON warehouse_transfers;
CREATE POLICY t_update_own ON warehouse_transfers FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _check_expiry_ok())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _check_expiry_ok());

DROP POLICY IF EXISTS t_delete_own ON warehouse_transfers;
CREATE POLICY t_delete_own ON warehouse_transfers FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _check_expiry_ok());

-- warehouse_transfer_items
DROP POLICY IF EXISTS t_insert_own ON warehouse_transfer_items;
CREATE POLICY t_insert_own ON warehouse_transfer_items FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _check_expiry_ok());

DROP POLICY IF EXISTS t_update_own ON warehouse_transfer_items;
CREATE POLICY t_update_own ON warehouse_transfer_items FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _check_expiry_ok())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _check_expiry_ok());

DROP POLICY IF EXISTS t_delete_own ON warehouse_transfer_items;
CREATE POLICY t_delete_own ON warehouse_transfer_items FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _check_expiry_ok());

COMMIT;
