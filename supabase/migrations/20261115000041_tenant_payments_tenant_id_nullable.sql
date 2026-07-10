-- Wave 6 hotfix: Task 6 changed tenant_payments.tenant_id FK to ON DELETE SET NULL
-- but left the column NOT NULL. E2E discovered this on 2026-07-11 when
-- deprovision_tenant on a tenant with real payments raised 23502.
--
-- Applied to prod via MCP the same day as
-- "tenant_payments_tenant_id_nullable_for_set_null_fk". This file makes the
-- change tracked in migration history for supabase db reset parity.

ALTER TABLE public.tenant_payments ALTER COLUMN tenant_id DROP NOT NULL;

COMMENT ON COLUMN public.tenant_payments.tenant_id IS
  'Nullable to accommodate ON DELETE SET NULL FK — payments for deprovisioned tenants get orphaned but preserved for revenue history.';
