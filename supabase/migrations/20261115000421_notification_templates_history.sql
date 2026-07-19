-- Migration 20261115000421: tenant_notification_templates_history + trigger
-- Versioning: auto-records every content UPDATE with actor + timestamp
-- Slot allocation: Phase 3 Task 3.1

CREATE TABLE IF NOT EXISTS public.tenant_notification_templates_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  actor_user_id UUID REFERENCES public.admin_users(id),
  old_content TEXT,
  new_content TEXT NOT NULL,
  edited_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_template_history_tenant_template_edited
  ON public.tenant_notification_templates_history (tenant_id, template_id, edited_at DESC);

ALTER TABLE public.tenant_notification_templates_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS t_select_own ON public.tenant_notification_templates_history;
CREATE POLICY t_select_own ON public.tenant_notification_templates_history
  FOR SELECT TO authenticated, vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id());

-- Trigger function: auto-record every UPDATE on tenant_notification_templates
CREATE OR REPLACE FUNCTION public.record_template_history()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.tenant_notification_templates_history
    (tenant_id, template_id, actor_user_id, old_content, new_content)
  VALUES (NEW.tenant_id, NEW.template_id, NEW.updated_by, OLD.content, NEW.content);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_template_history ON public.tenant_notification_templates;
CREATE TRIGGER trg_template_history
  AFTER UPDATE OF content ON public.tenant_notification_templates
  FOR EACH ROW
  WHEN (OLD.content IS DISTINCT FROM NEW.content)
  EXECUTE FUNCTION public.record_template_history();

GRANT SELECT ON public.tenant_notification_templates_history TO authenticated, vosi_rpc_owner;
