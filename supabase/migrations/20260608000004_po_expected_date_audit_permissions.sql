-- supabase/migrations/20260608000004_po_expected_date_audit_permissions.sql
-- Adds expected_receive_date + audit columns to purchase_orders.
-- Backfills permissions JSONB with action keys can_create_po / can_edit_po.

-- 1a. Add columns to purchase_orders
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS expected_receive_date DATE,
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user_id UUID REFERENCES admin_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_expected_receive_date
  ON purchase_orders(expected_receive_date)
  WHERE expected_receive_date IS NOT NULL;

-- 1b. Backfill permissions JSONB for existing admin users
UPDATE admin_users
SET permissions = COALESCE(permissions, '{}'::jsonb) || jsonb_build_object(
  'can_create_po', true,
  'can_edit_po', true
)
WHERE permissions IS NULL
   OR NOT (permissions ? 'can_create_po')
   OR NOT (permissions ? 'can_edit_po');
