-- Migration 319: P2-B — add rate_limit_per_second to tenant_subscriptions
ALTER TABLE tenant_subscriptions
  ADD COLUMN IF NOT EXISTS rate_limit_per_second int NOT NULL DEFAULT 100;

COMMENT ON COLUMN tenant_subscriptions.rate_limit_per_second IS
  'P2-B: per-tenant API rate limit (Cloud Run req/s). Default 100 (STARTER tier).';
