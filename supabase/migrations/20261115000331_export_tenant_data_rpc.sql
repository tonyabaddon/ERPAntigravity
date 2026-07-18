-- Migration 331: Per-tenant data export RPC (P2-#6 MVP).
--
-- Purpose: UU PDP hak subjek data compliance + tenant portability. Enables
-- "download my data" flow + future tenant migration to separate Supabase project.
--
-- Design:
--   - SECURITY DEFINER RPC (owned by vosi_rpc_owner per project convention).
--   - Auth gate: only platform_admin (via _is_platform_admin_active_from_jwt())
--     OR tenant's own OWNER (via tenant_users) can export.
--   - Returns JSONB with structure {export_metadata, data: {table_name: [rows...]}}.
--   - Iterates ALL public tables with a tenant_id column (excluding views +
--     internal counters + platform-only tables + tenants table which uses `id`).
--   - Special-cases `tenants` table (own row filtered by `id`, not `tenant_id`).
--
-- Storage files (product photos, evidence images) NOT included in this MVP —
-- data-only export is UU PDP baseline. Storage bundle deferred to Phase 3.
--
-- Verified 2026-07-18 via smoke test: 137 KB for Toko Jaya Makmur (86 tables,
-- 10 customers, 20 stocks, 7 orders, 1 tenants row).
--
-- Idempotent per CLAUDE.md.

BEGIN;

CREATE OR REPLACE FUNCTION public.export_tenant_data(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- current_setting instead of auth.uid() — SECDEF owned by vosi_rpc_owner
  -- cannot access auth schema. Pattern per memory smoke_test_security_definer_rpcs.
  v_caller_uid uuid := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  v_is_admin boolean;
  v_is_owner boolean;
  v_result jsonb := '{}'::jsonb;
  v_tbl text;
  v_rows jsonb;
  v_excluded text[] := ARRAY[
    'invoice_counters', 'kasir_counters', 'sales_order_counters',
    'warehouse_transfer_doc_seq',
    't_jobs', 't_job_runs', 't_rpc_idempotency',
    'platform_admin_audit', 'admin_users', 'tenant_impersonation_grants',
    'trial_balance', 'general_ledger', 'cash_account_balances',
    'v_tenant_effective_features', 'v_tenant_payment_coverage',
    'v_tenant_usage_summary', 'v_pengawasan_transfer_aging',
    'stock_photo_embeddings',
    'tenants'  -- Handled separately (filter by id, not tenant_id)
  ];
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;

  -- Canonical JWT-based admin check (avoids RLS circular dep on platform_admins)
  v_is_admin := public._is_platform_admin_active_from_jwt();

  IF NOT v_is_admin THEN
    SELECT EXISTS (
      SELECT 1 FROM public.tenant_users
      WHERE tenant_id = p_tenant_id AND user_id = v_caller_uid AND role = 'OWNER'
    ) INTO v_is_owner;

    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'access denied: caller is neither platform_admin nor tenant OWNER'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_tbl IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
      AND t.table_type = 'BASE TABLE'
      AND NOT (c.table_name = ANY(v_excluded))
    ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM public.%I t WHERE t.tenant_id = $1',
      v_tbl
    ) INTO v_rows USING p_tenant_id;
    v_result := v_result || jsonb_build_object(v_tbl, v_rows);
  END LOOP;

  -- Special-case tenants row (own row filtered by `id`, not `tenant_id`)
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rows
    FROM public.tenants t WHERE t.id = p_tenant_id;
  v_result := v_result || jsonb_build_object('tenants', v_rows);

  v_result := jsonb_build_object(
    'export_metadata', jsonb_build_object(
      'tenant_id', p_tenant_id,
      'exported_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SSZ'),
      'exported_by', v_caller_uid,
      'export_version', '1.0'
    ),
    'data', v_result
  );

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.export_tenant_data(uuid) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.export_tenant_data(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.export_tenant_data(uuid) TO authenticated;

COMMENT ON FUNCTION public.export_tenant_data(uuid) IS
  'P2-#6: exports all tenant-scoped data as JSONB for UU PDP hak subjek compliance + tenant portability. Auth: platform_admin OR tenant OWNER. Storage files not included (Phase 3).';

COMMIT;
