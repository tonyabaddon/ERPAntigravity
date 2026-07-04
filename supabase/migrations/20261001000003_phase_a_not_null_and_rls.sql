-- supabase/migrations/20261001000003_phase_a_not_null_and_rls.sql
-- Phase A: promote tenant_id to NOT NULL and apply RLS hardening.
-- Rollback: ALTER COLUMN tenant_id DROP NOT NULL per affected table.

DO $$
DECLARE
  r RECORD;
  v_nullable_count BIGINT;
BEGIN
  FOR r IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id' AND is_nullable = 'YES'
      AND table_name NOT IN ('tenants','platform_admins','tenant_users','plans','tenant_subscriptions','tenant_activity_daily','platform_admin_audit')
  LOOP
    -- Safety check: verify no NULL rows remain before enforcing
    EXECUTE format('SELECT COUNT(*) FROM public.%I WHERE tenant_id IS NULL', r.table_name) INTO v_nullable_count;
    IF v_nullable_count > 0 THEN
      RAISE EXCEPTION 'Table % has % NULL tenant_id rows; backfill incomplete', r.table_name, v_nullable_count;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET NOT NULL', r.table_name);
    RAISE NOTICE 'NOT NULL enforced on %', r.table_name;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_sync_settings_from_sub ON public.tenant_subscriptions;
CREATE TRIGGER trg_sync_settings_from_sub
AFTER INSERT OR UPDATE ON public.tenant_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.sync_tenant_settings_from_subscription();

DROP TRIGGER IF EXISTS trg_resync_on_plan_change ON public.plans;
CREATE TRIGGER trg_resync_on_plan_change
AFTER UPDATE OF feature_bundle ON public.plans
FOR EACH ROW EXECUTE FUNCTION public.resync_all_tenants_on_plan_change();

-- Force sync of Garindo's tenant_settings from its subscription row
-- so tenant_settings matches PREMIUM feature bundle immediately.
UPDATE public.tenant_subscriptions
SET updated_at = now()
WHERE tenant_id = '11111111-1111-1111-1111-111111111111';

-- ═══════════════════════════════════════════════════════════════════
-- STUB: _guard_expiry_write() — created early so RLS WITH CHECK clauses
-- in Task 7 can reference it (CREATE POLICY validates function existence
-- at creation time). Task 8 (file 20261001000004) REPLACES this stub
-- with the real JWT-reading implementation via CREATE OR REPLACE.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._guard_expiry_write()
RETURNS void LANGUAGE plpgsql STABLE AS $$
BEGIN
  -- Stub: allow all writes during migration application.
  -- Task 8 replaces this body with a JWT-claim check.
  RETURN;
END $$;

REVOKE ALL ON FUNCTION public._guard_expiry_write() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._guard_expiry_write() TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════
-- HELPER: _is_platform_admin_from_jwt() — reads the is_platform_admin
-- claim baked into the JWT by custom_access_token_hook (Task 8). Used by
-- Category-P RLS policies below. Post-pivot fix: the original template
-- referenced current_setting('app.is_platform_admin') — that GUC was set
-- by the pre-pivot _pgrst_pre_request hook which no longer exists.
-- With the Auth Hook, is_platform_admin lives in JWT claims instead.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._is_platform_admin_from_jwt()
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_claims_text text;
BEGIN
  v_claims_text := current_setting('request.jwt.claims', true);
  IF v_claims_text IS NULL OR v_claims_text = '' THEN
    RETURN false;
  END IF;
  RETURN COALESCE(((v_claims_text::jsonb) ->> 'is_platform_admin')::boolean, false);
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END $$;

REVOKE ALL ON FUNCTION public._is_platform_admin_from_jwt() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._is_platform_admin_from_jwt() TO authenticated, service_role, supabase_auth_admin;

-- ═══════════════════════════════════════════════════════════════════
-- Task 7: RLS hardening block (composed statically from templates in
-- scripts/generate-rls-audit-migration.ts + scripts/rls-audit-config.yaml).
-- Docker unavailable at composition time; equivalent to running:
--   npx tsx scripts/generate-rls-audit-migration.ts > /tmp/rls.sql
-- ═══════════════════════════════════════════════════════════════════

-- accounting_config (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='accounting_config' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'accounting_config');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.accounting_config FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.accounting_config FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.accounting_config FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.accounting_config FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.accounting_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_config FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_config FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounting_config TO authenticated;

-- accounting_periods (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='accounting_periods' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'accounting_periods');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.accounting_periods FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.accounting_periods FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.accounting_periods FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.accounting_periods FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.accounting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_periods FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_periods FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounting_periods TO authenticated;

-- admin_users (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='admin_users' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'admin_users');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.admin_users FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.admin_users FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.admin_users FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.admin_users FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_users FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_users TO authenticated;

-- ai_call_log (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='ai_call_log' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'ai_call_log');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.ai_call_log FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.ai_call_log FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.ai_call_log FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.ai_call_log FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.ai_call_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_call_log FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_call_log FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_call_log TO authenticated;

-- approval_requests (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='approval_requests' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'approval_requests');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.approval_requests FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.approval_requests FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.approval_requests FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.approval_requests FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.approval_requests FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_requests TO authenticated;

-- approval_settings (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='approval_settings' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'approval_settings');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.approval_settings FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.approval_settings FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.approval_settings FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.approval_settings FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.approval_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_settings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.approval_settings FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_settings TO authenticated;

-- audit_log (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='audit_log' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'audit_log');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.audit_log FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.audit_log FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.audit_log FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_log FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_log TO authenticated;

-- bank_accounts (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='bank_accounts' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'bank_accounts');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.bank_accounts FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.bank_accounts FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.bank_accounts FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.bank_accounts FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.bank_accounts FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_accounts TO authenticated;

-- bank_config (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='bank_config' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'bank_config');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.bank_config FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.bank_config FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.bank_config FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.bank_config FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.bank_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_config FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.bank_config FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_config TO authenticated;

-- bank_imports (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='bank_imports' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'bank_imports');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.bank_imports FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.bank_imports FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.bank_imports FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.bank_imports FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.bank_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_imports FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.bank_imports FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_imports TO authenticated;

-- bank_line_allocations (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='bank_line_allocations' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'bank_line_allocations');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.bank_line_allocations FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.bank_line_allocations FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.bank_line_allocations FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.bank_line_allocations FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.bank_line_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_line_allocations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.bank_line_allocations FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_line_allocations TO authenticated;

-- bank_statement_lines (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='bank_statement_lines' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'bank_statement_lines');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.bank_statement_lines FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.bank_statement_lines FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.bank_statement_lines FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.bank_statement_lines FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_lines FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.bank_statement_lines FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_statement_lines TO authenticated;

-- cash_accounts (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='cash_accounts' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'cash_accounts');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.cash_accounts FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.cash_accounts FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.cash_accounts FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.cash_accounts FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.cash_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_accounts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_accounts FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_accounts TO authenticated;

-- cash_deposit_batch_items (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='cash_deposit_batch_items' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'cash_deposit_batch_items');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.cash_deposit_batch_items FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.cash_deposit_batch_items FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.cash_deposit_batch_items FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.cash_deposit_batch_items FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.cash_deposit_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_deposit_batch_items FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_deposit_batch_items FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_deposit_batch_items TO authenticated;

-- cash_deposit_batches (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='cash_deposit_batches' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'cash_deposit_batches');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.cash_deposit_batches FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.cash_deposit_batches FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.cash_deposit_batches FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.cash_deposit_batches FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.cash_deposit_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_deposit_batches FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_deposit_batches FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_deposit_batches TO authenticated;

-- chart_of_accounts (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='chart_of_accounts' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'chart_of_accounts');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.chart_of_accounts FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.chart_of_accounts FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.chart_of_accounts FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.chart_of_accounts FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_of_accounts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.chart_of_accounts FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chart_of_accounts TO authenticated;

-- clip_inference_log (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='clip_inference_log' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'clip_inference_log');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.clip_inference_log FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.clip_inference_log FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.clip_inference_log FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.clip_inference_log FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.clip_inference_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clip_inference_log FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.clip_inference_log FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clip_inference_log TO authenticated;

-- company_settings (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='company_settings' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'company_settings');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.company_settings FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.company_settings FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.company_settings FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.company_settings FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_settings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_settings FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_settings TO authenticated;

-- conversations (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='conversations' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'conversations');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.conversations FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.conversations FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.conversations FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversations FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;

-- customers (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='customers' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'customers');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.customers FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.customers FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.customers FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.customers FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.customers FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;

-- gl_dual_write_anomalies (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='gl_dual_write_anomalies' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'gl_dual_write_anomalies');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.gl_dual_write_anomalies FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.gl_dual_write_anomalies FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.gl_dual_write_anomalies FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.gl_dual_write_anomalies FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.gl_dual_write_anomalies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gl_dual_write_anomalies FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.gl_dual_write_anomalies FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gl_dual_write_anomalies TO authenticated;

-- invoice_counters (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='invoice_counters' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'invoice_counters');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.invoice_counters FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.invoice_counters FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.invoice_counters FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.invoice_counters FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_counters FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_counters FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_counters TO authenticated;

-- journal_entries (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='journal_entries' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'journal_entries');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.journal_entries FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.journal_entries FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.journal_entries FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.journal_entries FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.journal_entries FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_entries TO authenticated;

-- journal_entry_lines (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='journal_entry_lines' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'journal_entry_lines');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.journal_entry_lines FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.journal_entry_lines FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.journal_entry_lines FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.journal_entry_lines FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.journal_entry_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entry_lines FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.journal_entry_lines FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_entry_lines TO authenticated;

-- kasir_counters (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='kasir_counters' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'kasir_counters');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.kasir_counters FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.kasir_counters FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.kasir_counters FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.kasir_counters FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.kasir_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kasir_counters FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.kasir_counters FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kasir_counters TO authenticated;

-- kasir_transactions (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='kasir_transactions' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'kasir_transactions');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.kasir_transactions FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.kasir_transactions FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.kasir_transactions FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.kasir_transactions FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.kasir_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kasir_transactions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.kasir_transactions FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kasir_transactions TO authenticated;

-- leads (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='leads' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'leads');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.leads FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.leads FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.leads FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.leads FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.leads FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;

-- llm_calls (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='llm_calls' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'llm_calls');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.llm_calls FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.llm_calls FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.llm_calls FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.llm_calls FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.llm_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_calls FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.llm_calls FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.llm_calls TO authenticated;

-- messages (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='messages' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'messages');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.messages FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.messages FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.messages FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.messages FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;

-- notification_config (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='notification_config' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'notification_config');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.notification_config FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.notification_config FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.notification_config FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.notification_config FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.notification_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_config FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_config FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_config TO authenticated;

-- operating_hours (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='operating_hours' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'operating_hours');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.operating_hours FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.operating_hours FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.operating_hours FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.operating_hours FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.operating_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operating_hours FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.operating_hours FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operating_hours TO authenticated;

-- orders (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='orders' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'orders');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.orders FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.orders FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.orders FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.orders FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.orders FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;

-- payable_slots (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='payable_slots' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'payable_slots');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.payable_slots FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.payable_slots FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.payable_slots FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.payable_slots FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.payable_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payable_slots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.payable_slots FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payable_slots TO authenticated;

-- pembayaran (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='pembayaran' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'pembayaran');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.pembayaran FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.pembayaran FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.pembayaran FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.pembayaran FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.pembayaran ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pembayaran FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pembayaran FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pembayaran TO authenticated;

-- pembayaran_items (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='pembayaran_items' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'pembayaran_items');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.pembayaran_items FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.pembayaran_items FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.pembayaran_items FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.pembayaran_items FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.pembayaran_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pembayaran_items FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pembayaran_items FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pembayaran_items TO authenticated;

-- pesanan (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='pesanan' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'pesanan');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.pesanan FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.pesanan FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.pesanan FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.pesanan FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.pesanan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pesanan FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pesanan FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pesanan TO authenticated;

-- pesanan_items (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='pesanan_items' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'pesanan_items');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.pesanan_items FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.pesanan_items FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.pesanan_items FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.pesanan_items FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.pesanan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pesanan_items FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pesanan_items FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pesanan_items TO authenticated;

-- piutang_settings (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='piutang_settings' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'piutang_settings');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.piutang_settings FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.piutang_settings FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.piutang_settings FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.piutang_settings FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.piutang_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.piutang_settings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.piutang_settings FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.piutang_settings TO authenticated;

-- piutang_write_off_requests (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='piutang_write_off_requests' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'piutang_write_off_requests');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.piutang_write_off_requests FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.piutang_write_off_requests FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.piutang_write_off_requests FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.piutang_write_off_requests FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.piutang_write_off_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.piutang_write_off_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.piutang_write_off_requests FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.piutang_write_off_requests TO authenticated;

-- price_change_requests (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='price_change_requests' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'price_change_requests');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.price_change_requests FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.price_change_requests FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.price_change_requests FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.price_change_requests FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.price_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_change_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.price_change_requests FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_change_requests TO authenticated;

-- product_brands (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='product_brands' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'product_brands');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.product_brands FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.product_brands FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.product_brands FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.product_brands FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.product_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_brands FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_brands FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_brands TO authenticated;

-- product_categories (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='product_categories' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'product_categories');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.product_categories FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.product_categories FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.product_categories FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.product_categories FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_categories FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_categories TO authenticated;

-- product_price_audit (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='product_price_audit' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'product_price_audit');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.product_price_audit FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.product_price_audit FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.product_price_audit FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.product_price_audit FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.product_price_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_price_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_price_audit FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_price_audit TO authenticated;

-- product_units (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='product_units' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'product_units');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.product_units FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.product_units FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.product_units FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.product_units FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.product_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_units FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_units FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_units TO authenticated;

-- purchase_invoice_items (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='purchase_invoice_items' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'purchase_invoice_items');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.purchase_invoice_items FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.purchase_invoice_items FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.purchase_invoice_items FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.purchase_invoice_items FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.purchase_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_invoice_items FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_invoice_items FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_invoice_items TO authenticated;

-- purchase_invoices (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='purchase_invoices' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'purchase_invoices');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.purchase_invoices FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.purchase_invoices FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.purchase_invoices FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.purchase_invoices FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.purchase_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_invoices FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_invoices FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_invoices TO authenticated;

-- purchase_order_items (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='purchase_order_items' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'purchase_order_items');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.purchase_order_items FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.purchase_order_items FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.purchase_order_items FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.purchase_order_items FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_order_items FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_order_items TO authenticated;

-- purchase_orders (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='purchase_orders' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'purchase_orders');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.purchase_orders FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.purchase_orders FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.purchase_orders FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.purchase_orders FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_orders FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_orders TO authenticated;

-- rakit_components (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='rakit_components' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'rakit_components');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.rakit_components FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.rakit_components FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.rakit_components FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.rakit_components FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.rakit_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rakit_components FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.rakit_components FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rakit_components TO authenticated;

-- rakit_job_lines (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='rakit_job_lines' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'rakit_job_lines');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.rakit_job_lines FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.rakit_job_lines FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.rakit_job_lines FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.rakit_job_lines FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.rakit_job_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rakit_job_lines FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.rakit_job_lines FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rakit_job_lines TO authenticated;

-- rakit_lock_requests (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='rakit_lock_requests' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'rakit_lock_requests');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.rakit_lock_requests FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.rakit_lock_requests FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.rakit_lock_requests FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.rakit_lock_requests FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.rakit_lock_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rakit_lock_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.rakit_lock_requests FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rakit_lock_requests TO authenticated;

-- reconciliation_audit_log (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='reconciliation_audit_log' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'reconciliation_audit_log');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.reconciliation_audit_log FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.reconciliation_audit_log FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.reconciliation_audit_log FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.reconciliation_audit_log FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.reconciliation_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_audit_log FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.reconciliation_audit_log FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reconciliation_audit_log TO authenticated;

-- reconciliation_periods (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='reconciliation_periods' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'reconciliation_periods');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.reconciliation_periods FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.reconciliation_periods FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.reconciliation_periods FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.reconciliation_periods FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.reconciliation_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_periods FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.reconciliation_periods FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reconciliation_periods TO authenticated;

-- reconciliation_settings (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='reconciliation_settings' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'reconciliation_settings');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.reconciliation_settings FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.reconciliation_settings FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.reconciliation_settings FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.reconciliation_settings FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.reconciliation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_settings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.reconciliation_settings FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reconciliation_settings TO authenticated;

-- sales_channel_settings (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='sales_channel_settings' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'sales_channel_settings');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.sales_channel_settings FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.sales_channel_settings FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.sales_channel_settings FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.sales_channel_settings FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.sales_channel_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_channel_settings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_channel_settings FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_channel_settings TO authenticated;

-- sales_order_counters (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='sales_order_counters' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'sales_order_counters');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.sales_order_counters FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.sales_order_counters FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.sales_order_counters FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.sales_order_counters FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.sales_order_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order_counters FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_order_counters FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_order_counters TO authenticated;

-- sales_orders (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='sales_orders' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'sales_orders');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.sales_orders FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.sales_orders FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.sales_orders FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.sales_orders FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_orders FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_orders FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_orders TO authenticated;

-- service_types (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='service_types' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'service_types');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.service_types FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.service_types FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.service_types FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.service_types FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.service_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_types FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_types FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_types TO authenticated;

-- stock_adjustments (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='stock_adjustments' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'stock_adjustments');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.stock_adjustments FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.stock_adjustments FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.stock_adjustments FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.stock_adjustments FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_adjustments FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_adjustments TO authenticated;

-- stock_levels (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='stock_levels' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'stock_levels');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.stock_levels FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.stock_levels FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.stock_levels FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.stock_levels FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.stock_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_levels FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_levels FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_levels TO authenticated;

-- stock_lot_consumption (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='stock_lot_consumption' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'stock_lot_consumption');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.stock_lot_consumption FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.stock_lot_consumption FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.stock_lot_consumption FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.stock_lot_consumption FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.stock_lot_consumption ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_lot_consumption FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_lot_consumption FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_lot_consumption TO authenticated;

-- stock_lots (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='stock_lots' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'stock_lots');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.stock_lots FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.stock_lots FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.stock_lots FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.stock_lots FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.stock_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_lots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_lots FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_lots TO authenticated;

-- stock_movements (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='stock_movements' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'stock_movements');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.stock_movements FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.stock_movements FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.stock_movements FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.stock_movements FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_movements FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_movements TO authenticated;

-- stock_opname_counts (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='stock_opname_counts' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'stock_opname_counts');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.stock_opname_counts FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.stock_opname_counts FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.stock_opname_counts FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.stock_opname_counts FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.stock_opname_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_opname_counts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_opname_counts FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_opname_counts TO authenticated;

-- stock_opname_sessions (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='stock_opname_sessions' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'stock_opname_sessions');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.stock_opname_sessions FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.stock_opname_sessions FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.stock_opname_sessions FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.stock_opname_sessions FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.stock_opname_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_opname_sessions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_opname_sessions FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_opname_sessions TO authenticated;

-- stock_photo_embeddings (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='stock_photo_embeddings' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'stock_photo_embeddings');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.stock_photo_embeddings FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.stock_photo_embeddings FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.stock_photo_embeddings FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.stock_photo_embeddings FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.stock_photo_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_photo_embeddings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_photo_embeddings FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_photo_embeddings TO authenticated;

-- stock_price_history (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='stock_price_history' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'stock_price_history');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.stock_price_history FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.stock_price_history FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.stock_price_history FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.stock_price_history FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.stock_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_price_history FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_price_history FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_price_history TO authenticated;

-- stocks (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='stocks' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'stocks');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.stocks FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.stocks FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.stocks FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.stocks FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stocks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.stocks FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stocks TO authenticated;

-- store_bank_accounts (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='store_bank_accounts' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'store_bank_accounts');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.store_bank_accounts FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.store_bank_accounts FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.store_bank_accounts FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.store_bank_accounts FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.store_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_bank_accounts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.store_bank_accounts FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_bank_accounts TO authenticated;

-- store_settings (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='store_settings' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'store_settings');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.store_settings FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.store_settings FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.store_settings FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.store_settings FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_settings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.store_settings FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_settings TO authenticated;

-- suppliers (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='suppliers' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'suppliers');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.suppliers FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.suppliers FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.suppliers FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.suppliers FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.suppliers FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;

-- tenant_settings (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='tenant_settings' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'tenant_settings');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.tenant_settings FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.tenant_settings FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.tenant_settings FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.tenant_settings FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_settings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_settings FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_settings TO authenticated;

-- tukar_faktur (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='tukar_faktur' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'tukar_faktur');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.tukar_faktur FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.tukar_faktur FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.tukar_faktur FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.tukar_faktur FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.tukar_faktur ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tukar_faktur FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.tukar_faktur FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tukar_faktur TO authenticated;

-- wa_recipients (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='wa_recipients' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'wa_recipients');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.wa_recipients FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.wa_recipients FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.wa_recipients FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.wa_recipients FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.wa_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_recipients FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.wa_recipients FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_recipients TO authenticated;

-- warehouse_audit_log (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='warehouse_audit_log' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'warehouse_audit_log');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.warehouse_audit_log FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.warehouse_audit_log FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.warehouse_audit_log FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.warehouse_audit_log FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.warehouse_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_audit_log FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.warehouse_audit_log FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_audit_log TO authenticated;

-- warehouse_transfers (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='warehouse_transfers' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'warehouse_transfers');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.warehouse_transfers FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.warehouse_transfers FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.warehouse_transfers FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.warehouse_transfers FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.warehouse_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_transfers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.warehouse_transfers FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_transfers TO authenticated;

-- warehouses (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='warehouses' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'warehouses');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.warehouses FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.warehouses FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.warehouses FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.warehouses FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.warehouses FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouses TO authenticated;

-- whatsapp_numbers (category=T)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_numbers' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'whatsapp_numbers');
    END LOOP;
END $$;
CREATE POLICY "t_select_own" ON public.whatsapp_numbers FOR SELECT TO authenticated
      USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_insert_own" ON public.whatsapp_numbers FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_update_own" ON public.whatsapp_numbers FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
CREATE POLICY "t_delete_own" ON public.whatsapp_numbers FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _guard_expiry_write() IS NULL);
ALTER TABLE public.whatsapp_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_numbers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_numbers FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_numbers TO authenticated;

-- platform_admin_active_impersonation (category=P)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='platform_admin_active_impersonation' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'platform_admin_active_impersonation');
    END LOOP;
END $$;
CREATE POLICY "p_platform_admin_only" ON public.platform_admin_active_impersonation FOR ALL TO authenticated
  USING (public._is_platform_admin_from_jwt())
  WITH CHECK (public._is_platform_admin_from_jwt());
ALTER TABLE public.platform_admin_active_impersonation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admin_active_impersonation FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_admin_active_impersonation FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_admin_active_impersonation TO authenticated;

-- platform_admin_audit (category=P)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='platform_admin_audit' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'platform_admin_audit');
    END LOOP;
END $$;
CREATE POLICY "p_platform_admin_only" ON public.platform_admin_audit FOR ALL TO authenticated
  USING (public._is_platform_admin_from_jwt())
  WITH CHECK (public._is_platform_admin_from_jwt());
ALTER TABLE public.platform_admin_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admin_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_admin_audit FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_admin_audit TO authenticated;

-- platform_admins (category=P)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='platform_admins' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'platform_admins');
    END LOOP;
END $$;
CREATE POLICY "p_platform_admin_only" ON public.platform_admins FOR ALL TO authenticated
  USING (public._is_platform_admin_from_jwt())
  WITH CHECK (public._is_platform_admin_from_jwt());
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_admins FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_admins TO authenticated;

-- tenant_activity_daily (category=P)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='tenant_activity_daily' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'tenant_activity_daily');
    END LOOP;
END $$;
CREATE POLICY "p_platform_admin_only" ON public.tenant_activity_daily FOR ALL TO authenticated
  USING (public._is_platform_admin_from_jwt())
  WITH CHECK (public._is_platform_admin_from_jwt());
ALTER TABLE public.tenant_activity_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_activity_daily FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_activity_daily FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_activity_daily TO authenticated;

-- tenant_subscriptions (category=P)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='tenant_subscriptions' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'tenant_subscriptions');
    END LOOP;
END $$;
CREATE POLICY "p_platform_admin_only" ON public.tenant_subscriptions FOR ALL TO authenticated
  USING (public._is_platform_admin_from_jwt())
  WITH CHECK (public._is_platform_admin_from_jwt());
ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_subscriptions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_subscriptions FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_subscriptions TO authenticated;

-- tenants (category=P)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='tenants' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'tenants');
    END LOOP;
END $$;
CREATE POLICY "p_platform_admin_only" ON public.tenants FOR ALL TO authenticated
  USING (public._is_platform_admin_from_jwt())
  WITH CHECK (public._is_platform_admin_from_jwt());
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenants FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO authenticated;

-- plans (category=G)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='plans' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'plans');
    END LOOP;
END $$;
CREATE POLICY "g_read_all" ON public.plans FOR SELECT TO authenticated USING (true);
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plans FROM anon, PUBLIC;
GRANT SELECT ON public.plans TO authenticated;

-- tenant_users (category=A)
DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='tenant_users' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, 'tenant_users');
    END LOOP;
END $$;
CREATE POLICY "a_self_or_tenant_admin" ON public.tenant_users FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (tenant_id = _resolve_tenant_id()
        AND EXISTS (SELECT 1 FROM public.tenant_users me
                    WHERE me.tenant_id = public.tenant_users.tenant_id
                      AND me.user_id = auth.uid()
                      AND me.role IN ('owner','admin')))
  );
CREATE POLICY "a_admin_write" ON public.tenant_users FOR ALL TO authenticated
  USING (tenant_id = _resolve_tenant_id()
         AND EXISTS (SELECT 1 FROM public.tenant_users me
                     WHERE me.tenant_id = public.tenant_users.tenant_id
                       AND me.user_id = auth.uid()
                       AND me.role IN ('owner','admin')))
  WITH CHECK (tenant_id = _resolve_tenant_id());
ALTER TABLE public.tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_users FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_users FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_users TO authenticated;
