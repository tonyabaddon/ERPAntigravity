-- supabase/migrations/20261115000440_notification_prefs.sql
CREATE TABLE IF NOT EXISTS public.notification_prefs (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  quiet_hours_start TIME NOT NULL DEFAULT '22:00',
  quiet_hours_end TIME NOT NULL DEFAULT '07:00',
  consolidation_window_seconds INT NOT NULL DEFAULT 300 CHECK (consolidation_window_seconds >= 0 AND consolidation_window_seconds <= 1800),
  skip_digest_on_zero_omset BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_select_own ON public.notification_prefs FOR SELECT TO authenticated, vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id());
CREATE POLICY t_upsert_own ON public.notification_prefs FOR ALL TO vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id())
  WITH CHECK (tenant_id = public._resolve_tenant_id());

INSERT INTO public.notification_prefs (tenant_id)
SELECT id FROM public.tenants ON CONFLICT DO NOTHING;
