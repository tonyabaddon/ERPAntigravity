-- Smoke test: kasir_discount approval schema (Task 1 / slot 110)
-- Run via MCP execute_sql BEFORE migration to verify FAIL, AFTER to verify PASS.

-- Verify enum value added
SELECT 'kasir_discount enum exists' WHERE EXISTS (
  SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'approval_request_type' AND e.enumlabel = 'kasir_discount'
);

-- Verify kasir_transactions columns
SELECT 'kasir_transactions.discount_approval_request_id exists' WHERE EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name='kasir_transactions' AND column_name='discount_approval_request_id'
);
SELECT 'kasir_transactions.discount_approval_status exists' WHERE EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name='kasir_transactions' AND column_name='discount_approval_status'
);

-- Verify seed rows created for all tenants
SELECT COUNT(*)::TEXT AS seed_count FROM public.approval_settings
 WHERE request_type = 'kasir_discount';

-- All seed rows must have approval_required=false (opt-in default)
SELECT 'all seeds opt-in' WHERE NOT EXISTS (
  SELECT 1 FROM public.approval_settings
   WHERE request_type = 'kasir_discount' AND approval_required <> false
);
