-- Phase 1 Task 1 (2026-07-22): add environment column to tenants for
-- staging/prod isolation. Existing 3 tenants backfill to 'production'.
-- Staging tenants created in Task 4 via provision_tenant with
-- p_environment='staging'.
--
-- Idempotent via IF NOT EXISTS pattern.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tenants'
      AND column_name = 'environment'
  ) THEN
    ALTER TABLE tenants
      ADD COLUMN environment TEXT NOT NULL DEFAULT 'production'
      CHECK (environment IN ('production', 'staging'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tenants_environment ON tenants (environment);
