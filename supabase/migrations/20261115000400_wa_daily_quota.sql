-- B4 fix: enforce Calista 300 chat/hari cap per tenant.
--
-- Landing/pricing.md claim "300 conv/hari per tenant" was not enforced in
-- code. This migration adds columns tracked by the internal/notification
-- package's Quota check. Reset happens implicitly when wa_daily_quota_reset_date
-- < CURRENT_DATE (row updated to today, counter zeroed).
--
-- Idempotent: safe to re-run.

ALTER TABLE public.tenant_subscriptions
  ADD COLUMN IF NOT EXISTS wa_daily_quota_used INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wa_daily_quota_reset_date DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS wa_daily_quota_limit INT NOT NULL DEFAULT 300;

COMMENT ON COLUMN public.tenant_subscriptions.wa_daily_quota_used IS
  'B4 fix (2026-07-19): rolling daily counter of WA sends to customers. Reset to 0 when wa_daily_quota_reset_date < CURRENT_DATE. Default 300 = Calista Premium tier cap per landing claim.';
