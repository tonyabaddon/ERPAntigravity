-- PENDING FIX P1-06 — Add FK constraints on tenant_id columns + orphan cleanup
-- Origin: docs/qa-week/2026-07-19-session2-findings.md P1-06 (updated by Session 4 to 20 tables + 3 orphans)
-- Author: QA Session 4 (draft, not applied)
-- Reviewer: founder
-- Apply via: mcp__plugin_supabase_supabase__apply_migration or scripts/apply-migration.sh
--
-- WHY:
--   20 tables have tenant_id column but NO FK constraint to tenants(id). Per
--   Session 4 verification (2026-07-19):
--     - Financial-critical tables (cash_accounts, chart_of_accounts, accounting_*,
--       opening_ap/ar_lines) have 0 orphan rows currently.
--     - tenant_settings has 3 ORPHAN rows referencing non-existent tenants
--       (ca45dc8c..., ee6d5fd9..., 1fc9f3f5...) — likely test tenants deleted
--       from tenants table but not cascade-cleaned.
--     - t_jobs, t_job_runs, t_rpc_idempotency, t_tenant_cost_daily — job queue
--       infrastructure, SECDEF-only write path, low bug risk. Still worth FK.
--   Adding FK enables ON DELETE CASCADE when a tenant is deprovisioned →
--   cascade-cleanup is defensive.
--
-- ORPHAN CLEANUP (mandatory before FK add):
--   DELETE FROM tenant_settings WHERE tenant_id NOT IN (SELECT id FROM tenants);
--
-- SCOPE:
--   20 tables → 20 ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ... REFERENCES tenants(id) ON DELETE CASCADE.
--   Split into 2 phases: (1) orphan cleanup + verify, (2) FK add. This lets founder
--   review Phase 1 output before committing to Phase 2.
--
-- FULL TABLE LIST (20):
--   accounting_config, accounting_periods, approval_settings, cash_accounts,
--   chart_of_accounts, opening_ap_lines, opening_ar_lines, piutang_settings,
--   product_brands, product_categories, product_units, saldo_awal_snapshots,
--   sales_channel_settings, service_types, t_job_runs, t_jobs, t_rpc_idempotency,
--   t_tenant_cost_daily, tenant_settings, warehouse_transfer_doc_seq
--
-- IDEMPOTENCY:
--   ADD CONSTRAINT IF NOT EXISTS not supported for FK — must check first.
--   Uses DO block with EXISTS check for each ADD.
--
-- BLAST RADIUS:
--   Adding FK does NOT change RLS or existing data. Only enforces on future writes
--   + adds cascade on tenant delete. Tenant deprovision RPC (deprovision_tenant)
--   should be reviewed to ensure it handles cascade correctly — see verification.

-- ============================================================================
-- PHASE 1: Orphan cleanup (verify counts before + delete + verify after)
-- ============================================================================

BEGIN;

-- Verify orphan count BEFORE
SELECT 'tenant_settings' AS t, COUNT(*) AS orphans
FROM tenant_settings WHERE tenant_id NOT IN (SELECT id FROM tenants);
-- Expected: 3 (per Session 4)

-- Backup orphans to a temp export table for forensic (in case founder wants to inspect)
CREATE TABLE IF NOT EXISTS _qa_week_orphan_tenant_settings AS
SELECT * FROM tenant_settings WHERE tenant_id NOT IN (SELECT id FROM tenants);

-- Delete orphans
DELETE FROM tenant_settings WHERE tenant_id NOT IN (SELECT id FROM tenants);

-- Verify orphan count AFTER
SELECT COUNT(*) FROM tenant_settings WHERE tenant_id NOT IN (SELECT id FROM tenants);
-- Expected: 0

COMMIT;

-- ============================================================================
-- PHASE 2: Add FK constraints (each idempotently)
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

    -- Skip if FK already exists
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = v_constraint_name AND conrelid = ('public.' || v_tbl)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE',
        v_tbl, v_constraint_name
      );
      RAISE NOTICE 'Added FK on %', v_tbl;
    ELSE
      RAISE NOTICE 'FK already exists on % — skipped', v_tbl;
    END IF;
  END LOOP;
END $fk$;

-- ============================================================================
-- VERIFICATION (run separately after apply)
-- ============================================================================

-- 1. Confirm all 20 tables now have FK on tenant_id:
-- SELECT c.conrelid::regclass AS tbl, c.conname
-- FROM pg_constraint c
-- WHERE c.contype='f' AND c.conname LIKE '%tenant_id_fkey'
--   AND c.conrelid::regclass::text IN (
--     'accounting_config', 'accounting_periods', 'approval_settings', 'cash_accounts',
--     'chart_of_accounts', 'opening_ap_lines', 'opening_ar_lines', 'piutang_settings',
--     'product_brands', 'product_categories', 'product_units', 'saldo_awal_snapshots',
--     'sales_channel_settings', 'service_types', 't_job_runs', 't_jobs',
--     't_rpc_idempotency', 't_tenant_cost_daily', 'tenant_settings', 'warehouse_transfer_doc_seq'
--   )
-- ORDER BY tbl;
-- Expected: 20 rows.

-- 2. Confirm deprovision_tenant RPC still works (cascade fires):
-- Look at deprovision_tenant function definition; if it explicitly DELETEs from
-- each table, it might now double-delete via cascade. Review + adjust if needed.

-- 3. Confirm no new orphan rows created since orphan cleanup:
-- SELECT COUNT(*) FROM tenant_settings WHERE tenant_id NOT IN (SELECT id FROM tenants);
-- Expected: 0.

-- ============================================================================
-- ROLLBACK PLAN
-- ============================================================================

-- Drop the added FK constraints:
-- DO $rb$
-- DECLARE
--   v_tbl text;
--   v_tables text[] := ARRAY[...same list as above...];
-- BEGIN
--   FOREACH v_tbl IN ARRAY v_tables LOOP
--     EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
--                    v_tbl, v_tbl || '_tenant_id_fkey');
--   END LOOP;
-- END $rb$;

-- Restore orphan tenant_settings rows (if founder wants to keep them for forensic):
-- INSERT INTO tenant_settings SELECT * FROM _qa_week_orphan_tenant_settings;
-- DROP TABLE _qa_week_orphan_tenant_settings;
