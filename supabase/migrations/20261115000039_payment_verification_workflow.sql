-- =============================================================================
-- Migration: 20261115000039_payment_verification_workflow.sql
-- Wave 6 Task 12: Payment verification schema (columns + coverage view rebuild)
--
-- THIS FILE WILL BE EXTENDED BY:
--   Task 13 — appends updated record_payment RPC (PENDING_VERIFICATION default)
--   Task 14 — appends verify_payment + reject_payment RPCs
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Part 1: Add verification columns to tenant_payments
-- ---------------------------------------------------------------------------
-- status: PENDING_VERIFICATION | VERIFIED | REJECTED
-- Default VERIFIED so all existing Wave 5 rows remain valid with no regression.
-- Between Task 12 apply and Task 13 apply, new payments auto-VERIFIED (acceptable
-- transition state — see Note G).
ALTER TABLE public.tenant_payments
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'VERIFIED'
    CHECK (status IN ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED'));

-- verified_by: optional FK to the platform_admin who approved this payment
ALTER TABLE public.tenant_payments
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES auth.users(id);

-- verified_at: timestamp when the payment was verified or rejected
ALTER TABLE public.tenant_payments
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- rejection_reason: free-text note from platform_admin when status='REJECTED'
ALTER TABLE public.tenant_payments
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- ---------------------------------------------------------------------------
-- Part 2: Rebuild v_tenant_payment_coverage
-- Wave 5 shape fully preserved; Wave 6 adds:
--   * VERIFIED filter on the coverage SUM
--   * total_pending column (PENDING_VERIFICATION payments, unfiltered by period)
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_tenant_payment_coverage CASCADE;

CREATE VIEW public.v_tenant_payment_coverage
  WITH (security_invoker = true) AS
WITH paid AS (
  SELECT t.id AS tenant_id,
         -- Wave 6: only VERIFIED payments contribute to coverage; PENDING and REJECTED do not
         COALESCE(SUM(tp.amount) FILTER (
           WHERE tp.status      = 'VERIFIED'
             AND tp.period_from <= ts.expires_at
             AND tp.period_to   >= ts.activated_at
         ), 0::numeric) AS total_paid,
         -- Wave 6: expose pending revenue separately (no period filter — all PENDING rows)
         COALESCE(SUM(tp.amount) FILTER (WHERE tp.status = 'PENDING_VERIFICATION'), 0::numeric)
           AS total_pending,
         t.slug AS tenant_slug,
         t.name AS tenant_name,
         ts.plan_code
  FROM tenants t
  LEFT JOIN tenant_subscriptions ts ON ts.tenant_id = t.id
  LEFT JOIN tenant_payments tp ON tp.tenant_id = t.id
  GROUP BY t.id, t.slug, t.name, ts.activated_at, ts.expires_at, ts.plan_code
)
SELECT t.id AS tenant_id,
       paid.total_paid AS total_paid_covering_current_subscription,
       paid.total_pending,
       COALESCE(p.price_annual, 0::numeric) AS expected,
       CASE
         WHEN COALESCE(p.price_annual, 0::numeric) = 0 THEN 'UNPAID'
         WHEN paid.total_paid = 0                       THEN 'UNPAID'
         WHEN paid.total_paid >= p.price_annual         THEN 'LUNAS'
         WHEN paid.total_paid >= p.price_annual * 0.6   THEN 'DP_60'
         WHEN paid.total_paid >= p.price_annual * 0.3   THEN 'DP_30'
         ELSE 'OVERDUE'
       END AS coverage_status,
       paid.tenant_slug,
       paid.tenant_name,
       paid.plan_code
FROM tenants t
LEFT JOIN tenant_subscriptions ts ON ts.tenant_id = t.id
LEFT JOIN plans p ON p.code = ts.plan_code
LEFT JOIN paid ON paid.tenant_id = t.id;

-- Re-issue GRANTs (DROP VIEW loses them)
GRANT SELECT ON public.v_tenant_payment_coverage TO authenticated, vosi_rpc_owner;
