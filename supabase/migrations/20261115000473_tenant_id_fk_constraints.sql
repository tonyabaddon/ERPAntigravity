-- QA Week fix P1-06: Add FK constraints on tenant_id for 20 tables + orphan cleanup
-- Applied 2026-07-19 via psql from docs/qa-week/pending-fixes/. Saving as numbered
-- migration for repeatability.
--
-- Idempotent: uses NOT EXISTS check per constraint. Safe to re-run.

-- ============================================================================
-- PHASE 1: Orphan cleanup (3 rows in tenant_settings referencing deleted tenants)
-- ============================================================================

BEGIN;

-- Backup orphans (safe if table exists from prior run — CREATE IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS _qa_week_orphan_tenant_settings AS
SELECT * FROM tenant_settings WHERE tenant_id NOT IN (SELECT id FROM tenants) LIMIT 0;

-- Save any orphans found (idempotent via WHERE ... NOT EXISTS in backup)
INSERT INTO _qa_week_orphan_tenant_settings
SELECT * FROM tenant_settings ts
WHERE ts.tenant_id NOT IN (SELECT id FROM tenants)
  AND NOT EXISTS (
    SELECT 1 FROM _qa_week_orphan_tenant_settings b WHERE b.id = ts.id
  );

-- Delete orphans
DELETE FROM tenant_settings WHERE tenant_id NOT IN (SELECT id FROM tenants);

COMMIT;

-- ============================================================================
-- PHASE 2: Add FK constraints
-- ============================================================================

DO $fk$
DECLARE
  v_tables text[] := ARRAY[
    'accounting_config', 'accounting_periods', 'approval_settings', 'cash_accounts',
    'chart_of_accounts', 'opening_ap_lines', 'opening_ar_lines', 'piutang_settings',
    'product_brands', 'product_categories', 'product_units', 'saldo_awal_snapshots',
    'sales_channel_settings', 'service_types', 't_job_runs', 't_jobs',
    't_rpc_idempotency', 't_tenant_cost_daily', 'tenant_settings', 'warehouse_transfer_doc_seq'
  ];
  v_tbl text;
  v_constraint_name text;
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    v_constraint_name := v_tbl || '_tenant_id_fkey';
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = v_constraint_name AND conrelid = ('public.' || v_tbl)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE',
        v_tbl, v_constraint_name
      );
    END IF;
  END LOOP;
END $fk$;
