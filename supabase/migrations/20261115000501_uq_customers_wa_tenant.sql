-- F5-05 (2026-07-20): swap customers unique constraint from (wa_number) alone
-- to composite (tenant_id, wa_number). Enables cross-tenant customer creation
-- when different tenants have customers with the same phone.
--
-- Safe by construction: existing constraint was STRONGER than new constraint,
-- so existing data satisfies new constraint automatically (verified: 0
-- duplicates on (tenant_id, wa_number) at apply time).
--
-- Idempotent: uses DROP CONSTRAINT IF EXISTS + guard on new constraint add.
--
-- Companion backend refactor: backend-go/internal/db/customers.go
-- (GetOrCreateCustomer signature (tenantID uuid.UUID, waNumber string)).
--
-- Related spec: docs/superpowers/plans/2026-07-20-qa-week-phase-1-plan.md

BEGIN;

ALTER TABLE customers DROP CONSTRAINT IF EXISTS uq_customers_wa;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_customers_wa_tenant'
      AND conrelid = 'public.customers'::regclass
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT uq_customers_wa_tenant UNIQUE (tenant_id, wa_number);
  END IF;
END $$;

COMMIT;
