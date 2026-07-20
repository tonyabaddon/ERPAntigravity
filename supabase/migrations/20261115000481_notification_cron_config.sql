-- supabase/migrations/20261115000481_notification_cron_config.sql
-- Follow-up F4: per-tenant config for notification cron jobs 2-4
--   (Cards 2-4 in NotificationCronScreen.tsx).
-- Card 1 (Piutang) remains on tenant_wa_reminder_config.enabled (unchanged).
--
-- Reversibility: REVERSIBLE — additive table, no existing column changes.
-- Idempotent: CREATE IF NOT EXISTS, DROP POLICY IF EXISTS, INSERT ON CONFLICT.

CREATE TABLE IF NOT EXISTS public.tenant_notification_cron_config (
  tenant_id                   UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  hutang_summary_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  approval_sla_enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  approval_sla_threshold_minutes INT NOT NULL DEFAULT 120
    CHECK (approval_sla_threshold_minutes >= 30 AND approval_sla_threshold_minutes <= 480),
  feedback_request_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  feedback_delay_days          INT NOT NULL DEFAULT 7
    CHECK (feedback_delay_days >= 3 AND feedback_delay_days <= 14),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_notification_cron_config ENABLE ROW LEVEL SECURITY;

-- SELECT: authenticated (frontend reads) + vosi_rpc_owner (backend pollers)
DROP POLICY IF EXISTS t_select_own ON public.tenant_notification_cron_config;
CREATE POLICY t_select_own ON public.tenant_notification_cron_config
  FOR SELECT TO authenticated, vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id());

-- WRITE: authenticated (direct frontend upsert) + vosi_rpc_owner (future SECDEF path)
-- Note: unlike tenant_wa_reminder_config (which only grants vosi_rpc_owner),
-- we include authenticated here so the frontend can upsert directly, matching
-- the same pattern used by notification_prefs but with explicit authenticated grant.
DROP POLICY IF EXISTS t_upsert_own ON public.tenant_notification_cron_config;
CREATE POLICY t_upsert_own ON public.tenant_notification_cron_config
  FOR ALL TO authenticated, vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id())
  WITH CHECK (tenant_id = public._resolve_tenant_id());

-- Seed default rows for all existing tenants (fail-open: new tenants without
-- a config row still get notifications via COALESCE(cfg.col, TRUE) in pollers).
INSERT INTO public.tenant_notification_cron_config (tenant_id)
SELECT id FROM public.tenants
ON CONFLICT DO NOTHING;
