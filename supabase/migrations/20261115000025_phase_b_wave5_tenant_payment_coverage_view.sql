BEGIN;

-- ============================================================
-- Phase B Wave 5 — Task 6
-- v_tenant_payment_coverage view
--
-- Schema facts verified before writing (via MCP):
--   • tenant_subscriptions.tenant_id has UNIQUE constraint → exactly
--     one row per tenant, no double-counting in GROUP BY
--   • tenant_subscriptions.activated_at / expires_at are DATE (not
--     timestamptz) → direct comparison with tp.period_from/period_to
--     (also DATE) — no cast needed
--   • plans has g_read_all policy TO {authenticated, vosi_rpc_owner}
--     → view JOIN on plans returns price_annual correctly under RLS
--   • tenants / tenant_payments / tenant_subscriptions all have
--     p_platform_admin_only policy → view reads correctly for admin
--
-- Pro-rate note (Wave 5 initial ship):
--   Subscriptions < 365 days still use plans.price_annual as `expected`.
--   Pro-rate logic is deferred — most Garindo subscriptions are 1-year
--   annual. If a subscription is shorter, the reported `expected` will
--   appear inflated relative to the pro-rated fair amount. Follow-up
--   task required before multi-tenant onboarding at scale.
--
-- Formula divergence note:
--   record_payment RPC computes coverage from amount_paid_ytd
--   (payment_date EXTRACT year = current year).
--   This view uses period-overlap with the subscription window:
--     tp.period_from <= ts.expires_at AND tp.period_to >= ts.activated_at
--   These differ when payment_date year != subscription year.
--   Both are intentional — RPC is a quick post-write snapshot;
--   view is the authoritative canonical coverage per spec §15.5.
--
-- Tenant-owner read note:
--   The underlying tenants + tenant_subscriptions tables have
--   p_platform_admin_only (no tenant-owner read policy). So tenant
--   owners cannot see their own row in this view without impersonation.
--   Acceptable for Wave 5 — coverage display is platform-admin only.
--   Tenant-side coverage display is deferred to a future wave.
-- ============================================================

-- ── Step 1: Create the view ──────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_tenant_payment_coverage AS
WITH paid AS (
  -- Anchor on tenants so every tenant produces a row even with zero payments.
  -- CTE avoids repeating the FILTER expression across multiple CASE branches.
  -- tenant_subscriptions.tenant_id is UNIQUE (verified via pg_constraint) →
  -- the LEFT JOINs produce exactly one row per tenant, no multiplication.
  SELECT
    t.id AS tenant_id,
    COALESCE(SUM(tp.amount) FILTER (
      WHERE tp.period_from <= ts.expires_at
        AND tp.period_to   >= ts.activated_at
    ), 0)::numeric AS total_paid
  FROM public.tenants t
  LEFT JOIN public.tenant_subscriptions ts ON ts.tenant_id = t.id
  LEFT JOIN public.tenant_payments tp ON tp.tenant_id = t.id
  GROUP BY t.id, ts.activated_at, ts.expires_at
)
SELECT
  t.id AS tenant_id,
  paid.total_paid                                  AS total_paid_covering_current_subscription,
  COALESCE(p.price_annual, 0)::numeric             AS expected,
  CASE
    WHEN COALESCE(p.price_annual, 0) = 0            THEN 'UNPAID'
    WHEN paid.total_paid = 0                         THEN 'UNPAID'
    WHEN paid.total_paid >= p.price_annual           THEN 'LUNAS'
    WHEN paid.total_paid >= p.price_annual * 0.6     THEN 'DP_60'
    WHEN paid.total_paid >= p.price_annual * 0.3     THEN 'DP_30'
    ELSE 'OVERDUE'
  END AS coverage_status
FROM public.tenants t
LEFT JOIN public.tenant_subscriptions ts ON ts.tenant_id = t.id
LEFT JOIN public.plans p ON p.code = ts.plan_code
LEFT JOIN paid ON paid.tenant_id = t.id;

-- ── Step 2: Grants ────────────────────────────────────────────────────────────
-- Views do NOT inherit table-level grants automatically. Explicit GRANT
-- required for admin frontend queries to succeed before RLS fires.

GRANT SELECT ON public.v_tenant_payment_coverage TO authenticated;
GRANT SELECT ON public.v_tenant_payment_coverage TO vosi_rpc_owner;

-- ── Step 3: Comment ───────────────────────────────────────────────────────────

COMMENT ON VIEW public.v_tenant_payment_coverage IS
  'category=P; Wave 5 Task 6. Per-tenant payment coverage against current subscription. '
  'Columns: tenant_id, total_paid_covering_current_subscription, expected, coverage_status. '
  'coverage_status enum: LUNAS / DP_60 / DP_30 / OVERDUE / UNPAID (per spec §15.5). '
  'Readable by platform admin via RLS inheritance. '
  'Tenant-owner reads deferred — tenants table lacks p_tenant_owner_read policy. '
  'Pro-rate for subscriptions < 365 days deferred (uses full price_annual as expected). '
  'tenant_subscriptions.tenant_id is UNIQUE → no row-multiplication in the LEFT JOIN.';

COMMIT;
