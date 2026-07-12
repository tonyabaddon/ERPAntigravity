-- Migration: kasir_discount approval gate — per-tenant seed (Item #4, slot 111)
-- Runs after slot 110 which added 'kasir_discount' to approval_request_type enum.
-- Separated because ALTER TYPE ADD VALUE commits the label but it is not visible
-- within the same transaction (Postgres 55P04 restriction).

-- 3. Per-tenant seed rows (one per tenant, idempotent via NOT EXISTS guard)
INSERT INTO public.approval_settings (
  tenant_id, request_type, approval_required, verification_method,
  threshold_amount, threshold_percent, threshold_qty,
  approver_role, requestor_bypass_self, reason_required
)
SELECT t.id, 'kasir_discount', false, 'APP_INBOX',
       NULL, NULL, NULL,
       'Owner', false, true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.approval_settings
   WHERE tenant_id = t.id AND request_type = 'kasir_discount'
);
