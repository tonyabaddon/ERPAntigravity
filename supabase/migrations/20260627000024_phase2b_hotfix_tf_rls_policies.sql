-- supabase/migrations/20260627000024_phase2b_hotfix_tf_rls_policies.sql
-- Phase 2b hotfix #5: tukar_faktur had RLS enabled but no policies — denied all
-- authenticated reads. Frontend list/detail pages returned empty data, showed
-- "Tukar Faktur tidak ditemukan". Backend smoke worked because Supabase MCP uses
-- service_role which bypasses RLS.
-- Fix: mirror Phase 2a pesanan RLS pattern — authenticated read, no direct writes
-- (RPCs are SECURITY DEFINER and bypass).

BEGIN;

CREATE POLICY tukar_faktur_read ON public.tukar_faktur
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY tukar_faktur_no_direct_write ON public.tukar_faktur
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

COMMIT;
