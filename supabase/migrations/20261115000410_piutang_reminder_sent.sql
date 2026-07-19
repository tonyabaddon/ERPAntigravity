-- supabase/migrations/20261115000410_piutang_reminder_sent.sql
-- Sprint 2: audit table for every Piutang reminder attempt.
-- Dedup key: (invoice_id, rule_type, DATE(sent_at)) — prevents duplicate
-- sends across cron runs + manual overrides on same day.

CREATE TABLE IF NOT EXISTS public.piutang_reminder_sent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  invoice_id UUID NOT NULL,  -- FK to orders(id) but forgiving (order might be deleted)
  customer_id UUID NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('H-3', 'H+3', 'MANUAL')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_date DATE NOT NULL,  -- denormalized for dedup uniqueness constraint
  status TEXT NOT NULL CHECK (status IN ('SENT', 'FAILED', 'SKIPPED', 'SKIPPED_QUOTA', 'PERMANENT_FAILED')),
  message_body TEXT NOT NULL,
  error_message TEXT,
  UNIQUE (invoice_id, rule_type, sent_date)
);

CREATE INDEX IF NOT EXISTS idx_piutang_reminder_sent_tenant_time
  ON public.piutang_reminder_sent (tenant_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_piutang_reminder_sent_invoice
  ON public.piutang_reminder_sent (invoice_id);

ALTER TABLE public.piutang_reminder_sent ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS t_select_own ON public.piutang_reminder_sent;
CREATE POLICY t_select_own ON public.piutang_reminder_sent
  FOR SELECT TO authenticated, vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id());

DROP POLICY IF EXISTS t_insert_own ON public.piutang_reminder_sent;
CREATE POLICY t_insert_own ON public.piutang_reminder_sent
  FOR INSERT TO vosi_rpc_owner
  WITH CHECK (tenant_id = public._resolve_tenant_id());
