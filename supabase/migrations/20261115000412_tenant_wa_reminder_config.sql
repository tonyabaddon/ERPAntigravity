-- Sprint 2 (2026-07-19): Task 2.2 — Tenant-wide WA reminder configuration
-- Stores per-tenant editable WA message templates for Piutang reminders (H-3, H+3 rules)
-- Also includes Errata 1 addition: tenant_subscriptions.piutang_wa_reminder_enabled flag
-- RLS enforced: each tenant can only read/update its own config

CREATE TABLE IF NOT EXISTS public.tenant_wa_reminder_config (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  template_h3 TEXT NOT NULL DEFAULT
    'Halo {customer_nama} 👋, ini reminder ramah dari {toko_nama}. Invoice #{invoice_no} sebesar Rp {jumlah} akan jatuh tempo pada {due_date} (3 hari lagi). Kalau sudah dibayar mohon abaikan pesan ini. Terima kasih 🙏',
  template_h3_plus TEXT NOT NULL DEFAULT
    'Halo {customer_nama}, invoice #{invoice_no} sebesar Rp {jumlah} sudah lewat jatuh tempo (H+{overdue_days}). Mohon segera dibayar ya. Kalau ada kendala bisa reply pesan ini — kami siap bantu. Terima kasih 🙏 — {toko_nama}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.tenant_wa_reminder_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS t_select_own ON public.tenant_wa_reminder_config;
CREATE POLICY t_select_own ON public.tenant_wa_reminder_config
  FOR SELECT TO authenticated, vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id());

DROP POLICY IF EXISTS t_upsert_own ON public.tenant_wa_reminder_config;
CREATE POLICY t_upsert_own ON public.tenant_wa_reminder_config
  FOR ALL TO vosi_rpc_owner
  USING (tenant_id = public._resolve_tenant_id())
  WITH CHECK (tenant_id = public._resolve_tenant_id());

-- Seed default rows for all existing tenants
INSERT INTO public.tenant_wa_reminder_config (tenant_id)
SELECT id FROM public.tenants
ON CONFLICT DO NOTHING;

-- Errata 1 (2026-07-19): Add tenant-wide feature flag for Piutang WA reminder auto-scheduler
-- Required by Task 2.4 eligibility SQL. Default TRUE (Premium opt-in on ship).
ALTER TABLE public.tenant_subscriptions
  ADD COLUMN IF NOT EXISTS piutang_wa_reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.tenant_subscriptions.piutang_wa_reminder_enabled IS
  'Sprint 2 (2026-07-19): tenant-wide feature flag for Piutang WA reminder auto-scheduler. Required by piutang.eligibleInvoicesQuery(). Default TRUE (Premium opt-in on ship).';
