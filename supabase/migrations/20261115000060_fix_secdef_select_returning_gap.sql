-- 20261115000060_fix_secdef_select_returning_gap.sql
--
-- P0 hotfix: unblock SECDEF write RPCs that use `INSERT/UPDATE ... RETURNING`.
--
-- Follows up on 20261115000044 (which added vosi_rpc_owner to t_insert_own /
-- t_update_own / t_delete_own on every T-table). That migration did NOT touch
-- t_select_own — but PostgreSQL RLS requires the row to pass the SELECT policy
-- for the returned row set whenever a statement has a RETURNING clause. When
-- the SELECT policy is scoped TO {authenticated} only, a SECDEF function
-- owned by vosi_rpc_owner cannot see its own just-inserted row and Postgres
-- aborts the statement with `new row violates row-level security policy`
-- (yes, the error is worded as if WITH CHECK failed — misleading, but that's
-- the raise site inside nodeModifyTable.c when RETURNING is denied).
--
-- Empirical repro on 2026-07-11:
--   * INSERT INTO customers (...) RETURNING id → 42501 as vosi_rpc_owner
--   * Same INSERT without RETURNING → succeeds
--   * Distinguisher: t_select_own on `customers` is TO {authenticated} only.
--
-- User-visible symptom: several "Simpan" buttons silently fail —
--   `create_sales_order` (Simpan Sales Order),
--   `next_sales_order_number` (RETURNING counter),
--   `start_opname_session` (RETURNING id — after fixing the id-column bug in
--   `_opname_require_witness`, see companion migration),
--   `record_kasir_sale` (Simpan Sales Invoice on standard path),
--   `create_tempo_invoice`, plus every other SECDEF RPC that uses RETURNING
--   on a T-table.
--
-- Fix: idempotently rewrite `t_select_own` on every T-table that already has
-- a `t_insert_own` policy so vosi_rpc_owner is a first-class role in the
-- clause. The USING predicate stays `tenant_id = _resolve_tenant_id()` —
-- SECDEF RPCs still can only see rows for the current tenant.
--
-- This does NOT relax `p_platform_admin_readall` (that policy has its own
-- USING gate for platform admins only). It ONLY makes SECDEF write RPCs
-- capable of reading their own inserted rows.
--
-- Rollback: reverse migration that restores each t_select_own to
-- `TO authenticated` only. That re-breaks every RPC that uses RETURNING.

BEGIN;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = c.relname
          AND p.policyname = 't_insert_own'
      )
    ORDER BY c.relname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS t_select_own ON public.%I', r.relname);
    EXECUTE format(
      'CREATE POLICY t_select_own ON public.%I '
      'FOR SELECT TO authenticated, vosi_rpc_owner '
      'USING (tenant_id = public._resolve_tenant_id())',
      r.relname
    );
  END LOOP;
END $$;

COMMIT;
