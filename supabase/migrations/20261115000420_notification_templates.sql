-- Migration 20261115000420: tenant_notification_templates table + RLS
-- Universal template registry: 10 template_ids × N tenants
-- Slot allocation: Phase 3 Task 3.1

CREATE TABLE IF NOT EXISTS public.tenant_notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,  -- e.g., 'booking_expiry', 'payment_verified'
  content TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id),
  UNIQUE (tenant_id, template_id)
);

ALTER TABLE public.tenant_notification_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS t_select_own ON public.tenant_notification_templates;
CREATE POLICY t_select_own ON public.tenant_notification_templates
  FOR SELECT TO authenticated, vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id());

DROP POLICY IF EXISTS t_upsert_own ON public.tenant_notification_templates;
CREATE POLICY t_upsert_own ON public.tenant_notification_templates
  FOR ALL TO vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id())
  WITH CHECK (tenant_id = public._resolve_tenant_id());

GRANT SELECT ON public.tenant_notification_templates TO authenticated, vosi_rpc_owner;
GRANT INSERT, UPDATE, DELETE ON public.tenant_notification_templates TO vosi_rpc_owner;
