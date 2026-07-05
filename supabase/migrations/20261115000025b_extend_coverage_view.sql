BEGIN;

-- ============================================================
-- Phase B Wave 5 — Task 11 fix C1
-- Extend v_tenant_payment_coverage with tenant_slug, tenant_name,
-- plan_code columns.
--
-- Bug: FE call sites (AdminRevenue, AttentionQueue,
-- RevenueTopTenants) select tenant_slug, tenant_name, plan_code
-- from the view, but the original view only had 4 columns:
-- tenant_id, total_paid_covering_current_subscription, expected,
-- coverage_status. Supabase returns 42703 silently → 3 features
-- rendered empty/broken.
--
-- Fix: CREATE OR REPLACE VIEW appending 3 new columns at the END
-- (Postgres requires existing column order preserved; new columns
-- appended — DROP+recreate is not needed).
--
-- Column order after this migration (position-stable for existing
-- callers):
--   1: tenant_id
--   2: total_paid_covering_current_subscription
--   3: expected
--   4: coverage_status   ← kept at pos-4 (existing callers)
--   5: tenant_slug       ← new
--   6: tenant_name       ← new
--   7: plan_code         ← new
-- ============================================================

CREATE OR REPLACE VIEW public.v_tenant_payment_coverage AS
WITH paid AS (
  SELECT
    t.id   AS tenant_id,
    COALESCE(SUM(tp.amount) FILTER (
      WHERE tp.period_from <= ts.expires_at
        AND tp.period_to   >= ts.activated_at
    ), 0)::numeric AS total_paid,
    t.slug         AS tenant_slug,
    t.name         AS tenant_name,
    ts.plan_code   AS plan_code
  FROM public.tenants t
  LEFT JOIN public.tenant_subscriptions ts ON ts.tenant_id = t.id
  LEFT JOIN public.tenant_payments tp ON tp.tenant_id = t.id
  GROUP BY t.id, t.slug, t.name, ts.activated_at, ts.expires_at, ts.plan_code
)
SELECT
  t.id                                                           AS tenant_id,
  paid.total_paid                                                AS total_paid_covering_current_subscription,
  COALESCE(p.price_annual, 0)::numeric                          AS expected,
  CASE
    WHEN COALESCE(p.price_annual, 0) = 0        THEN 'UNPAID'
    WHEN paid.total_paid = 0                     THEN 'UNPAID'
    WHEN paid.total_paid >= p.price_annual       THEN 'LUNAS'
    WHEN paid.total_paid >= p.price_annual * 0.6 THEN 'DP_60'
    WHEN paid.total_paid >= p.price_annual * 0.3 THEN 'DP_30'
    ELSE 'OVERDUE'
  END                                                            AS coverage_status,
  paid.tenant_slug,
  paid.tenant_name,
  paid.plan_code
FROM public.tenants t
LEFT JOIN public.tenant_subscriptions ts ON ts.tenant_id = t.id
LEFT JOIN public.plans p ON p.code = ts.plan_code
LEFT JOIN paid ON paid.tenant_id = t.id;

GRANT SELECT ON public.v_tenant_payment_coverage TO authenticated;
GRANT SELECT ON public.v_tenant_payment_coverage TO vosi_rpc_owner;

COMMENT ON VIEW public.v_tenant_payment_coverage IS
  'category=P; Wave 5 Task 11 C1. Per-tenant payment coverage against current subscription. '
  'Columns: tenant_id, total_paid_covering_current_subscription, expected, coverage_status, '
  'tenant_slug, tenant_name, plan_code. '
  'coverage_status enum: LUNAS / DP_60 / DP_30 / OVERDUE / UNPAID (per spec §15.5). '
  'Readable by platform admin via RLS inheritance. '
  'Tenant-owner reads deferred — tenants table lacks p_tenant_owner_read policy. '
  'Pro-rate for subscriptions < 365 days deferred (uses full price_annual as expected). '
  'tenant_subscriptions.tenant_id is UNIQUE → no row-multiplication in the LEFT JOIN.';

COMMIT;
