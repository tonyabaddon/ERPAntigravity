# Task 6 Report — `v_tenant_payment_coverage` view

**Status:** DONE

## Files

- `supabase/migrations/20261115000025_phase_b_wave5_tenant_payment_coverage_view.sql` — view + grants + comment
- `supabase/tests/wave5/v_tenant_payment_coverage.sql` — 13 pgTAP assertions

## Migration applied

Applied to Garindo prod (`ekhhojaezdfjfwuxyjkl`) via Supabase MCP. View owner: `postgres`.

## Smoke test results (all pass)

| Scenario | total_paid | expected | coverage_status |
|---|---|---|---|
| Zero payments (Garindo baseline) | 0 | 9,000,000 | UNPAID |
| 3,500,000 (39% — above 30% threshold) | 3,500,000 | 9,000,000 | DP_30 |
| 6,000,000 (67% — above 60% threshold) | 6,000,000 | 9,000,000 | DP_60 |
| 9,500,000 (106% — above 100%) | 9,500,000 | 9,000,000 | LUNAS |
| 1,000,000 (11% — below 30%) | 1,000,000 | 9,000,000 | OVERDUE |

All INSERT-based smoke tests ran inside a DO block with `RAISE EXCEPTION 'ROLLBACK_SENTINEL'` at the end — Garindo confirmed untouched (0 payments) after execution.

## Schema facts verified before writing

- `tenant_subscriptions.tenant_id` has a UNIQUE constraint → exactly one row per tenant; no row-multiplication in GROUP BY
- `activated_at` / `expires_at` are `DATE` (not timestamptz) → direct comparison with `period_from`/`period_to` (also `DATE`), no cast needed
- `plans.g_read_all` policy scoped to `{authenticated, vosi_rpc_owner}` → view JOINs on plans return `price_annual` correctly under RLS
- `tenants`, `tenant_payments`, `tenant_subscriptions` all have `p_platform_admin_only` → view reads correctly for admin callers

## Design decisions

**CTE `paid` anchors on `tenants`** — ensures every tenant row appears even with zero payments. The outer `LEFT JOIN paid ON paid.tenant_id = t.id` + `COALESCE` handles the zero-payment case cleanly.

**Explicit `GRANT SELECT` on view** — views do not inherit table-level grants; without this the admin frontend would get a permission error before RLS even fires.

**View owner: `postgres` (default)** — RLS on the underlying tables uses `_is_platform_admin_from_jwt()` (caller-based JWT check, not role-based), so ownership doesn't affect correctness. No `SECURITY INVOKER` override needed.

## Concerns / deferred items

1. **Pro-rate deferred** — subscriptions shorter than 365 days still use `plans.price_annual` as `expected`. Fair value would be `price_annual × (subscription_days / 365)`. Deferred per spec — most subscriptions are 1-year annual. Follow-up task required before multi-tenant onboarding at scale.

2. **Formula divergence with `record_payment` RPC** — the RPC computes coverage from `amount_paid_ytd` (payment_date EXTRACT year = current year). This view uses period-overlap with the subscription window (`tp.period_from <= ts.expires_at AND tp.period_to >= ts.activated_at`). These differ when payment_date year != subscription year. Both are intentional: RPC is a quick post-write snapshot; view is the authoritative canonical coverage per spec §15.5. Task 7/8 FE devs should use the view for display, not the RPC's `coverage_status`.

3. **Tenant-owner reads deferred** — `tenants` and `tenant_subscriptions` have `p_platform_admin_only` only; no `p_tenant_owner_read` policy exists. Tenant owners cannot see their own coverage row without impersonation. Acceptable for Wave 5 — coverage display is platform-admin only. Tenant-side display is future work.

4. **Performance at scale** — the view does a full scan of `tenant_payments` per tenant. At hundreds of tenants × thousands of payments, an index on `(tenant_id, period_from, period_to)` would help. Current `idx_tenant_payments_period` covers `(period_from, period_to)` but not leading on `tenant_id`. Flag for follow-up if query time degrades.

## pgTAP

13 assertions covering:
- View exists + 4 columns present (Cases 1-2)
- Garindo zero-payments → UNPAID (Case 3)
- INSERT 3.5M → DP_30 (Cases 4-4b)
- INSERT +2.5M = 6M → DP_60 (Case 5)
- INSERT +3.5M = 9.5M → LUNAS (Case 6)
- Payment outside subscription window excluded → UNPAID (Case 7)

All within `BEGIN; ... ROLLBACK;` — no persistent state change.

pgTAP not installed on prod — file ready for `supabase test db` when needed (Wave 1 Task 1 precedent).
