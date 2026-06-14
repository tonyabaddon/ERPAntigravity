-- supabase/migrations/20260614000008_customers_tempo_fields.sql
-- Phase 1A: per-customer tempo whitelist columns. Owner-PIN-gated writes
-- enforced via SECURITY DEFINER RPCs in later piutang migrations; no anon/auth
-- UPDATE policy is added for these columns. Pre-Layer-A, all customer rows
-- share an implicit tenant (sentinel UUID). Layer A will retrofit tenant_id
-- onto customers itself.
--
-- NOTE: Originally planned as 20260614000001. Bumped to 000008 because slots
-- 000001-000007 were claimed by parallel opname migrations on the same date.
-- Spec: docs/superpowers/specs/2026-06-14-piutang-tempo-design.md §4.1

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS allows_tempo        boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS term_days           int           NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_limit        numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tempo_activated_at  timestamptz,
  ADD COLUMN IF NOT EXISTS tempo_activated_by  uuid;

CREATE INDEX IF NOT EXISTS idx_customers_allows_tempo
  ON public.customers(allows_tempo) WHERE allows_tempo = true;

COMMENT ON COLUMN public.customers.allows_tempo IS
  'Owner-approved tempo eligibility. Set only via approve_customer_credit_activate / _deactivate RPCs.';
COMMENT ON COLUMN public.customers.credit_limit IS
  'Max outstanding INVOICE_TEMPO total per customer. Changes only via approve_customer_credit_limit_change RPC.';
