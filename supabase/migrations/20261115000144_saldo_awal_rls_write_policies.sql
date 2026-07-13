-- 20261115000144_saldo_awal_rls_write_policies.sql
-- Item #5 hotfix: FORCE RLS + only SELECT policies blocked INSERT/UPDATE/DELETE
-- from SECDEF RPCs. Add write policy per table with tenant_id match.
-- Discovered via E2E backend smoke test after Tranche B deploy.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_write_own' AND polrelid='public.saldo_awal_snapshots'::regclass) THEN
    CREATE POLICY p_write_own ON public.saldo_awal_snapshots
      FOR ALL
      USING (tenant_id = public._resolve_tenant_id())
      WITH CHECK (tenant_id = public._resolve_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_write_own' AND polrelid='public.opening_ar_lines'::regclass) THEN
    CREATE POLICY p_write_own ON public.opening_ar_lines
      FOR ALL
      USING (tenant_id = public._resolve_tenant_id())
      WITH CHECK (tenant_id = public._resolve_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_write_own' AND polrelid='public.opening_ap_lines'::regclass) THEN
    CREATE POLICY p_write_own ON public.opening_ap_lines
      FOR ALL
      USING (tenant_id = public._resolve_tenant_id())
      WITH CHECK (tenant_id = public._resolve_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_write_own' AND polrelid='public.year_end_close_events'::regclass) THEN
    CREATE POLICY p_write_own ON public.year_end_close_events
      FOR ALL
      USING (tenant_id = public._resolve_tenant_id())
      WITH CHECK (tenant_id = public._resolve_tenant_id());
  END IF;
END $$;
