# Dashboard vs Laporan Split (Item #3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape Dashboard into single "action items" surface (all roles same, auto-hide when N=0), redesign Laporan Performa with Gross Profit + delta + slow-mover + top customer + profit-per-channel; remove AI Efficiency KPI + Chat chart from both.

**Architecture:** Add 6 SECDEF read-only RPCs (single migration slot 130) that aggregate against existing tables (kasir_transactions, purchase_invoices, approval_requests, stocks); FE consumes via typed dashboardService/reportsService; Dashboard replaces old KPI+chart section with today strip + 5 action cards; Laporan Performa rebuilds KPI row + adds slow-mover/top-customer/profit-per-channel sections. Zero schema changes.

**Tech Stack:** Supabase PostgreSQL (SECDEF STABLE RPCs owned by `vosi_rpc_owner`), React + TypeScript + Vite + Tailwind, recharts (existing charts library).

**Spec:** [docs/superpowers/specs/2026-07-13-dashboard-laporan-split-design.md](../specs/2026-07-13-dashboard-laporan-split-design.md)

## Global Constraints

- All new RPCs: `SECURITY DEFINER STABLE`, owned by `vosi_rpc_owner`, `REVOKE ALL FROM PUBLIC`, `REVOKE EXECUTE FROM anon`, `GRANT EXECUTE TO authenticated`, filter by `_resolve_tenant_id()`
- Migration slot 20261115000130 (single-file bundle for all 6 read RPCs)
- Font 13-14px UI body (per feedback `font_sizing`)
- Bahasa Indonesia MSME tone
- Badge palette: emerald / amber / rose / slate
- Delta arrow indicators: ▲ `text-emerald-600` (positive), ▼ `text-rose-600` (negative), `—` `text-slate-400` (flat or no baseline)
- Rupiah format via existing `formatIDR()` from `src/lib/formatIDR.ts`
- Card auto-hide pattern: return `null` when primary count = 0 (per `PromoProdukCard.tsx` reference at `src/components/dashboard/PromoProdukCard.tsx`)
- Reuse existing SalesInboxBadge count logic for Sales Inbox card (via `src/lib/salesInboxCategorize.ts` + realtime channel already set up)
- Zero schema changes to existing tables
- Advisor `mcp__plugin_supabase_supabase__get_advisors` after migration
- Advisor triggers per CLAUDE.md: diff >100 lines OR touches >3 files (this plan meets both — call `advisor()` before final commit)

---

### Task 1: Backend RPCs — dashboard maintenance + today snapshot + period summary with delta + slow-moving stock + top customers + profit per channel

**Files:**
- Create: `supabase/migrations/20261115000130_dashboard_laporan_read_rpcs.sql`

**Interfaces:**
- Consumes: existing tables `kasir_transactions`, `purchase_invoices`, `approval_requests`, `stocks`, `customers`; existing helpers `_resolve_tenant_id()`
- Produces:
  - `get_dashboard_maintenance_counts()` returns TABLE `(approval_pending INT, piutang_overdue_count INT, piutang_overdue_sum NUMERIC, hutang_overdue_count INT, hutang_overdue_sum NUMERIC, fulfillment_queue_count INT)`
  - `get_today_snapshot()` returns TABLE `(revenue_today NUMERIC, count_today INT)`
  - `get_performa_summary_with_delta(p_days INT)` returns TABLE `(revenue NUMERIC, gross_profit NUMERIC, order_count INT, avg_order_value NUMERIC, prev_revenue NUMERIC, prev_gross_profit NUMERIC, prev_order_count INT, prev_avg_order_value NUMERIC)` — one row
  - `get_slow_moving_stock(p_days INT, p_limit INT DEFAULT 20)` returns TABLE `(sku TEXT, name TEXT, stock INT, qty_sold INT, days_stagnant INT, severity TEXT)`
  - `get_top_customers(p_days INT, p_limit INT DEFAULT 10)` returns TABLE `(customer_id TEXT, customer_name TEXT, customer_company TEXT, total_revenue NUMERIC, transaction_count INT, last_purchase_date DATE, days_since_last INT)`
  - `get_profit_per_channel(p_days INT)` returns TABLE `(channel TEXT, revenue NUMERIC, gross_profit NUMERIC, margin_pct NUMERIC)`

- [ ] **Step 1: Write migration file**

```sql
-- 20261115000130_dashboard_laporan_read_rpcs.sql
-- Item #3: Dashboard + Laporan read RPCs (6 functions).
-- All SECDEF STABLE, tenant-scoped via _resolve_tenant_id().
-- See docs/superpowers/specs/2026-07-13-dashboard-laporan-split-design.md

-- ── 1. get_dashboard_maintenance_counts ────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_dashboard_maintenance_counts()
RETURNS TABLE(
  approval_pending        INT,
  piutang_overdue_count   INT,
  piutang_overdue_sum     NUMERIC,
  hutang_overdue_count    INT,
  hutang_overdue_sum      NUMERIC,
  fulfillment_queue_count INT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    approval_pending := 0; piutang_overdue_count := 0; piutang_overdue_sum := 0;
    hutang_overdue_count := 0; hutang_overdue_sum := 0; fulfillment_queue_count := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT COALESCE((SELECT COUNT(*)::INT FROM public.approval_requests
                    WHERE tenant_id = v_tenant AND status = 'pending'), 0)
    INTO approval_pending;

  -- Piutang overdue: kasir_transactions with payment_type='TEMPO', not lunas, past due
  -- Uses total_amount - COALESCE(paid_amount, 0) as remaining
  SELECT
    COALESCE(COUNT(*)::INT, 0),
    COALESCE(SUM(total_amount - COALESCE(dp_amount, 0)), 0)
  INTO piutang_overdue_count, piutang_overdue_sum
  FROM public.kasir_transactions
  WHERE tenant_id = v_tenant
    AND payment_type = 'TEMPO'
    AND status = 'AWAITING_LUNAS'
    AND lunas_at IS NULL
    AND cancelled_at IS NULL
    -- overdue means date + tempo_days_grace < today; we approximate with
    -- "created more than 30d ago and still awaiting lunas"; tenant-level grace
    -- can refine later via piutang_settings.
    AND created_at < now() - INTERVAL '30 days';

  -- Hutang supplier overdue
  SELECT
    COALESCE(COUNT(*)::INT, 0),
    COALESCE(SUM(total - COALESCE(paid_amount, 0)), 0)
  INTO hutang_overdue_count, hutang_overdue_sum
  FROM public.purchase_invoices
  WHERE tenant_id = v_tenant
    AND payment_due_at IS NOT NULL
    AND payment_due_at < now()
    AND paid_at IS NULL
    AND voided_at IS NULL;

  -- Fulfillment antrean
  SELECT COALESCE(COUNT(*)::INT, 0)
    INTO fulfillment_queue_count
  FROM public.kasir_transactions
  WHERE tenant_id = v_tenant
    AND status IN ('AWAITING_LUNAS','WIP','PENDING_LOCK_APPROVAL')
    AND cancelled_at IS NULL;

  RETURN NEXT;
END $$;

ALTER FUNCTION public.get_dashboard_maintenance_counts() OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.get_dashboard_maintenance_counts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_maintenance_counts() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_maintenance_counts() TO authenticated;

COMMENT ON FUNCTION public.get_dashboard_maintenance_counts IS
  'Item #3: single-round-trip aggregate for Dashboard maintenance cards.';


-- ── 2. get_today_snapshot ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_today_snapshot()
RETURNS TABLE(
  revenue_today NUMERIC,
  count_today   INT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    revenue_today := 0; count_today := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM(total_amount), 0),
    COALESCE(COUNT(*)::INT, 0)
  INTO revenue_today, count_today
  FROM public.kasir_transactions
  WHERE tenant_id = v_tenant
    AND date = CURRENT_DATE
    AND status IN ('PAID','AWAITING_LUNAS','WIP','PENDING_LOCK_APPROVAL')
    AND cancelled_at IS NULL;

  RETURN NEXT;
END $$;

ALTER FUNCTION public.get_today_snapshot() OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.get_today_snapshot() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_today_snapshot() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_today_snapshot() TO authenticated;

COMMENT ON FUNCTION public.get_today_snapshot IS
  'Item #3: Dashboard today strip (revenue + count for CURRENT_DATE).';


-- ── 3. get_performa_summary_with_delta ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_performa_summary_with_delta(p_days INT)
RETURNS TABLE(
  revenue                NUMERIC,
  gross_profit           NUMERIC,
  order_count            INT,
  avg_order_value        NUMERIC,
  prev_revenue           NUMERIC,
  prev_gross_profit      NUMERIC,
  prev_order_count       INT,
  prev_avg_order_value   NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_tenant       UUID;
  v_today        DATE := CURRENT_DATE;
  v_curr_start   DATE;
  v_prev_start   DATE;
  v_prev_end     DATE;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID OR p_days IS NULL OR p_days <= 0 THEN
    revenue := 0; gross_profit := 0; order_count := 0; avg_order_value := 0;
    prev_revenue := 0; prev_gross_profit := 0; prev_order_count := 0; prev_avg_order_value := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  v_curr_start := v_today - (p_days - 1);
  v_prev_end   := v_curr_start - 1;
  v_prev_start := v_prev_end - (p_days - 1);

  SELECT
    COALESCE(SUM(subtotal), 0),
    COALESCE(SUM(subtotal - COALESCE(hpp_total, 0)), 0),
    COALESCE(COUNT(*)::INT, 0),
    CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(subtotal), 0) / COUNT(*) ELSE 0 END
  INTO revenue, gross_profit, order_count, avg_order_value
  FROM public.kasir_transactions
  WHERE tenant_id = v_tenant
    AND date BETWEEN v_curr_start AND v_today
    AND status IN ('PAID','AWAITING_LUNAS','WIP','PENDING_LOCK_APPROVAL')
    AND cancelled_at IS NULL;

  SELECT
    COALESCE(SUM(subtotal), 0),
    COALESCE(SUM(subtotal - COALESCE(hpp_total, 0)), 0),
    COALESCE(COUNT(*)::INT, 0),
    CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(subtotal), 0) / COUNT(*) ELSE 0 END
  INTO prev_revenue, prev_gross_profit, prev_order_count, prev_avg_order_value
  FROM public.kasir_transactions
  WHERE tenant_id = v_tenant
    AND date BETWEEN v_prev_start AND v_prev_end
    AND status IN ('PAID','AWAITING_LUNAS','WIP','PENDING_LOCK_APPROVAL')
    AND cancelled_at IS NULL;

  RETURN NEXT;
END $$;

ALTER FUNCTION public.get_performa_summary_with_delta(INT) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.get_performa_summary_with_delta(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_performa_summary_with_delta(INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_performa_summary_with_delta(INT) TO authenticated;

COMMENT ON FUNCTION public.get_performa_summary_with_delta IS
  'Item #3: Laporan Performa KPI (revenue, gross_profit, orders, AOV) + previous-period counterparts for delta calc.';


-- ── 4. get_slow_moving_stock ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_slow_moving_stock(p_days INT, p_limit INT DEFAULT 20)
RETURNS TABLE(
  sku            TEXT,
  name           TEXT,
  stock          INT,
  qty_sold       INT,
  days_stagnant  INT,
  severity       TEXT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_tenant     UUID;
  v_period_start DATE;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID OR p_days IS NULL OR p_days <= 0 THEN
    RETURN;
  END IF;

  v_period_start := CURRENT_DATE - (COALESCE(p_days, 30) - 1);

  RETURN QUERY
  WITH sales_agg AS (
    SELECT
      (item->>'sku')::TEXT AS sku,
      SUM((item->>'qty')::INT) AS qty_sold,
      MAX(kt.date) AS last_sale_date
    FROM public.kasir_transactions kt,
         jsonb_array_elements(kt.items) AS item
    WHERE kt.tenant_id = v_tenant
      AND kt.date >= v_period_start
      AND kt.status IN ('PAID','COMPLETED','AWAITING_LUNAS')
      AND kt.cancelled_at IS NULL
      AND item->>'sku' IS NOT NULL
    GROUP BY 1
  ),
  all_time_last_sale AS (
    SELECT
      (item->>'sku')::TEXT AS sku,
      MAX(kt.date) AS last_sale_date_all
    FROM public.kasir_transactions kt,
         jsonb_array_elements(kt.items) AS item
    WHERE kt.tenant_id = v_tenant
      AND kt.status IN ('PAID','COMPLETED','AWAITING_LUNAS')
      AND kt.cancelled_at IS NULL
      AND item->>'sku' IS NOT NULL
    GROUP BY 1
  )
  SELECT
    s.sku::TEXT,
    s.name::TEXT,
    s.stock::INT,
    COALESCE(sa.qty_sold, 0)::INT AS qty_sold,
    (CURRENT_DATE - COALESCE(atls.last_sale_date_all, s.updated_at::date))::INT AS days_stagnant,
    CASE
      WHEN COALESCE(sa.qty_sold, 0) = 0
           AND (CURRENT_DATE - COALESCE(atls.last_sale_date_all, s.updated_at::date))::INT >= 45
        THEN 'dead'
      WHEN COALESCE(sa.qty_sold, 0) = 0
        THEN 'slow'
      WHEN sa.qty_sold IS NOT NULL AND s.stock > 0 AND sa.qty_sold < GREATEST(s.stock * 0.1, 1)
        THEN 'slow'
      ELSE 'active'
    END::TEXT AS severity
  FROM public.stocks s
  LEFT JOIN sales_agg sa ON sa.sku = s.sku
  LEFT JOIN all_time_last_sale atls ON atls.sku = s.sku
  WHERE s.tenant_id = v_tenant
    AND s.stock > 0
    AND (
      COALESCE(sa.qty_sold, 0) = 0
      OR (s.stock > 0 AND sa.qty_sold IS NOT NULL AND sa.qty_sold < GREATEST(s.stock * 0.1, 1))
    )
  ORDER BY days_stagnant DESC NULLS LAST, s.sku
  LIMIT COALESCE(p_limit, 20);
END $$;

ALTER FUNCTION public.get_slow_moving_stock(INT, INT) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.get_slow_moving_stock(INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_slow_moving_stock(INT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_slow_moving_stock(INT, INT) TO authenticated;

COMMENT ON FUNCTION public.get_slow_moving_stock IS
  'Item #3: Laporan Produk Slow-Moving list. Severity: dead (45d+ no sale), slow (<10% turnover).';


-- ── 5. get_top_customers ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_top_customers(p_days INT, p_limit INT DEFAULT 10)
RETURNS TABLE(
  customer_id        TEXT,
  customer_name      TEXT,
  customer_company   TEXT,
  total_revenue      NUMERIC,
  transaction_count  INT,
  last_purchase_date DATE,
  days_since_last    INT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_tenant       UUID;
  v_period_start DATE;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID OR p_days IS NULL OR p_days <= 0 THEN
    RETURN;
  END IF;

  v_period_start := CURRENT_DATE - (p_days - 1);

  RETURN QUERY
  SELECT
    kt.customer_id::TEXT,
    kt.customer_name::TEXT,
    kt.customer_company::TEXT,
    COALESCE(SUM(kt.subtotal), 0)::NUMERIC AS total_revenue,
    COUNT(*)::INT AS transaction_count,
    MAX(kt.date) AS last_purchase_date,
    (CURRENT_DATE - MAX(kt.date))::INT AS days_since_last
  FROM public.kasir_transactions kt
  WHERE kt.tenant_id = v_tenant
    AND kt.date >= v_period_start
    AND kt.status IN ('PAID','AWAITING_LUNAS','COMPLETED')
    AND kt.cancelled_at IS NULL
    AND kt.customer_id IS NOT NULL
    AND length(trim(COALESCE(kt.customer_name, ''))) > 0
  GROUP BY kt.customer_id, kt.customer_name, kt.customer_company
  ORDER BY total_revenue DESC
  LIMIT COALESCE(p_limit, 10);
END $$;

ALTER FUNCTION public.get_top_customers(INT, INT) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.get_top_customers(INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_top_customers(INT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_top_customers(INT, INT) TO authenticated;

COMMENT ON FUNCTION public.get_top_customers IS
  'Item #3: Laporan Top Customer aggregation (revenue + tx count + last purchase).';


-- ── 6. get_profit_per_channel ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_profit_per_channel(p_days INT)
RETURNS TABLE(
  channel      TEXT,
  revenue      NUMERIC,
  gross_profit NUMERIC,
  margin_pct   NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_tenant       UUID;
  v_period_start DATE;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID OR p_days IS NULL OR p_days <= 0 THEN
    RETURN;
  END IF;

  v_period_start := CURRENT_DATE - (p_days - 1);

  RETURN QUERY
  SELECT
    kt.channel::TEXT,
    COALESCE(SUM(kt.subtotal), 0)::NUMERIC AS revenue,
    COALESCE(SUM(kt.subtotal - COALESCE(kt.hpp_total, 0)), 0)::NUMERIC AS gross_profit,
    CASE WHEN SUM(kt.subtotal) > 0
      THEN (SUM(kt.subtotal - COALESCE(kt.hpp_total, 0)) * 100.0 / SUM(kt.subtotal))::NUMERIC
      ELSE 0
    END AS margin_pct
  FROM public.kasir_transactions kt
  WHERE kt.tenant_id = v_tenant
    AND kt.date >= v_period_start
    AND kt.status IN ('PAID','AWAITING_LUNAS','COMPLETED')
    AND kt.cancelled_at IS NULL
  GROUP BY kt.channel
  ORDER BY gross_profit DESC NULLS LAST;
END $$;

ALTER FUNCTION public.get_profit_per_channel(INT) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.get_profit_per_channel(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_profit_per_channel(INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_profit_per_channel(INT) TO authenticated;

COMMENT ON FUNCTION public.get_profit_per_channel IS
  'Item #3: Laporan Analisis Kanal — revenue + gross_profit + margin per channel.';
```

- [ ] **Step 2: Apply migration**

Use `mcp__plugin_supabase_supabase__apply_migration` with:
- `project_id: ekhhojaezdfjfwuxyjkl`
- `name: dashboard_laporan_read_rpcs`
- `query`: the SQL above

- [ ] **Step 3: Smoke test with rollback-marker**

Run via `mcp__plugin_supabase_supabase__execute_sql`:

```sql
DO $$
DECLARE
  v_tenant  UUID := '11111111-1111-1111-1111-111111111111'::uuid;  -- Garindo
  v_owner   UUID := '227c28f4-09f6-4dc9-af7a-01b0feb2c194'::uuid;
  v_maint   RECORD;
  v_today   RECORD;
  v_perf    RECORD;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_owner::text, 'role', 'authenticated', 'tenant_id', v_tenant::text)::text, true);

  SELECT * INTO v_maint FROM public.get_dashboard_maintenance_counts();
  RAISE NOTICE 'maint: appr=% piutang=%/% hutang=%/% fulfill=%',
    v_maint.approval_pending, v_maint.piutang_overdue_count, v_maint.piutang_overdue_sum,
    v_maint.hutang_overdue_count, v_maint.hutang_overdue_sum, v_maint.fulfillment_queue_count;

  SELECT * INTO v_today FROM public.get_today_snapshot();
  RAISE NOTICE 'today: revenue=% count=%', v_today.revenue_today, v_today.count_today;

  SELECT * INTO v_perf FROM public.get_performa_summary_with_delta(7);
  RAISE NOTICE 'perf 7d: rev=% gp=% ord=% aov=% (prev rev=%)',
    v_perf.revenue, v_perf.gross_profit, v_perf.order_count, v_perf.avg_order_value, v_perf.prev_revenue;

  PERFORM * FROM public.get_slow_moving_stock(30, 20);
  PERFORM * FROM public.get_top_customers(30, 10);
  PERFORM * FROM public.get_profit_per_channel(30);

  RAISE EXCEPTION 'rollback-marker: all 6 read RPCs smoke complete';
END $$;
```

Expected: `ERROR: P0001: rollback-marker: all 6 read RPCs smoke complete` (success marker). NOTICE lines show actual counts for Garindo.

- [ ] **Step 4: Run advisor check**

`mcp__plugin_supabase_supabase__get_advisors(project_id: ekhhojaezdfjfwuxyjkl, type: security)` — verify no NEW critical findings related to the 6 new RPCs.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261115000130_dashboard_laporan_read_rpcs.sql
git commit -m "feat(item-3): backend read RPCs for Dashboard + Laporan reshuffle

- get_dashboard_maintenance_counts (single-round-trip for 4 cards)
- get_today_snapshot (today strip)
- get_performa_summary_with_delta (KPI + prev period)
- get_slow_moving_stock (dead + slow SKUs)
- get_top_customers (top 10 by revenue)
- get_profit_per_channel (revenue + margin per channel)

All SECDEF STABLE, tenant-scoped, anon-revoked. Zero schema change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Frontend service module + types

**Files:**
- Create: `src/lib/dashboardReports/types.ts`
- Create: `src/lib/dashboardReports/api.ts`

**Interfaces:**
- Consumes: Task 1 RPCs; existing `supabase` client from `src/lib/supabaseClient.ts`
- Produces:
  - Types: `MaintenanceCounts`, `TodaySnapshot`, `PerformaSummaryWithDelta`, `SlowMovingRow`, `TopCustomerRow`, `ChannelProfitRow`, `PeriodDays = 7 | 30 | 90`
  - API fns: `getDashboardMaintenanceCounts()`, `getTodaySnapshot()`, `getPerformaSummaryWithDelta(days)`, `getSlowMovingStock(days, limit?)`, `getTopCustomers(days, limit?)`, `getProfitPerChannel(days)`
  - Helper: `computeDelta(current: number, previous: number) → { pct: number|null, direction: 'up'|'down'|'flat' }`

- [ ] **Step 1: Write `src/lib/dashboardReports/types.ts`**

```typescript
export type PeriodDays = 7 | 30 | 90;
export type SlowMoveSeverity = 'dead' | 'slow' | 'active';

export interface MaintenanceCounts {
  approval_pending: number;
  piutang_overdue_count: number;
  piutang_overdue_sum: number;
  hutang_overdue_count: number;
  hutang_overdue_sum: number;
  fulfillment_queue_count: number;
}

export interface TodaySnapshot {
  revenue_today: number;
  count_today: number;
}

export interface PerformaSummaryWithDelta {
  revenue: number;
  gross_profit: number;
  order_count: number;
  avg_order_value: number;
  prev_revenue: number;
  prev_gross_profit: number;
  prev_order_count: number;
  prev_avg_order_value: number;
}

export interface SlowMovingRow {
  sku: string;
  name: string;
  stock: number;
  qty_sold: number;
  days_stagnant: number;
  severity: SlowMoveSeverity;
}

export interface TopCustomerRow {
  customer_id: string;
  customer_name: string;
  customer_company: string | null;
  total_revenue: number;
  transaction_count: number;
  last_purchase_date: string;
  days_since_last: number;
}

export interface ChannelProfitRow {
  channel: string;
  revenue: number;
  gross_profit: number;
  margin_pct: number;
}

export interface DeltaResult {
  pct: number | null;
  direction: 'up' | 'down' | 'flat';
}

export function computeDelta(current: number, previous: number): DeltaResult {
  if (previous === 0 || previous == null) {
    return { pct: null, direction: 'flat' };
  }
  const pct = ((current - previous) / previous) * 100;
  const rounded = Math.round(pct * 10) / 10;
  const direction: DeltaResult['direction'] =
    Math.abs(rounded) < 0.05 ? 'flat' : rounded > 0 ? 'up' : 'down';
  return { pct: rounded, direction };
}
```

- [ ] **Step 2: Write `src/lib/dashboardReports/api.ts`**

```typescript
import { supabase } from '../supabaseClient';
import type {
  MaintenanceCounts,
  TodaySnapshot,
  PerformaSummaryWithDelta,
  SlowMovingRow,
  TopCustomerRow,
  ChannelProfitRow,
  PeriodDays,
} from './types';

const EMPTY_MAINTENANCE: MaintenanceCounts = {
  approval_pending: 0,
  piutang_overdue_count: 0,
  piutang_overdue_sum: 0,
  hutang_overdue_count: 0,
  hutang_overdue_sum: 0,
  fulfillment_queue_count: 0,
};

const EMPTY_TODAY: TodaySnapshot = { revenue_today: 0, count_today: 0 };

const EMPTY_PERFORMA: PerformaSummaryWithDelta = {
  revenue: 0, gross_profit: 0, order_count: 0, avg_order_value: 0,
  prev_revenue: 0, prev_gross_profit: 0, prev_order_count: 0, prev_avg_order_value: 0,
};

export async function getDashboardMaintenanceCounts(): Promise<MaintenanceCounts> {
  const { data, error } = await supabase.rpc('get_dashboard_maintenance_counts');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as MaintenanceCounts | undefined) ?? EMPTY_MAINTENANCE;
}

export async function getTodaySnapshot(): Promise<TodaySnapshot> {
  const { data, error } = await supabase.rpc('get_today_snapshot');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as TodaySnapshot | undefined) ?? EMPTY_TODAY;
}

export async function getPerformaSummaryWithDelta(days: PeriodDays): Promise<PerformaSummaryWithDelta> {
  const { data, error } = await supabase.rpc('get_performa_summary_with_delta', { p_days: days });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as PerformaSummaryWithDelta | undefined) ?? EMPTY_PERFORMA;
}

export async function getSlowMovingStock(days: PeriodDays, limit = 20): Promise<SlowMovingRow[]> {
  const { data, error } = await supabase.rpc('get_slow_moving_stock', { p_days: days, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as SlowMovingRow[];
}

export async function getTopCustomers(days: PeriodDays, limit = 10): Promise<TopCustomerRow[]> {
  const { data, error } = await supabase.rpc('get_top_customers', { p_days: days, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as TopCustomerRow[];
}

export async function getProfitPerChannel(days: PeriodDays): Promise<ChannelProfitRow[]> {
  const { data, error } = await supabase.rpc('get_profit_per_channel', { p_days: days });
  if (error) throw error;
  return (data ?? []) as ChannelProfitRow[];
}
```

- [ ] **Step 3: Verify TS clean**

Run: `npx tsc --noEmit`
Expected: no errors related to `src/lib/dashboardReports/`

- [ ] **Step 4: Commit**

```bash
git add src/lib/dashboardReports/
git commit -m "feat(item-3): dashboardReports API client + typed helpers

Wraps 6 backend RPCs from slot 130. Exports computeDelta helper
for KPI delta rendering (returns pct + direction, handles
zero-baseline edge case).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Dashboard reshuffle — delete old KPI/charts + add today strip + 4 maintenance cards

**Files:**
- Modify: `src/components/DashboardScreen.tsx`
- Create: `src/components/dashboard/TodayStripCard.tsx`
- Create: `src/components/dashboard/MaintenanceCard.tsx`
- Create: `src/components/dashboard/DashboardMaintenanceSection.tsx`

**Interfaces:**
- Consumes: Task 2 API (`getTodaySnapshot`, `getDashboardMaintenanceCounts`); existing `PromoProdukCard`, `PreOrderFulfillmentsCard`, `formatIDR`, `useNavigate`/prop navigate
- Produces:
  - `<TodayStripCard />` — small text strip under greeting: "Hari ini: Rp X · Y transaksi"
  - `<MaintenanceCard {icon, title, count, detail, ctaLabel, onCta, badgeVariant} />` — reusable action card
  - `<DashboardMaintenanceSection {onNavigate} />` — self-fetching wrapper that renders 4 MaintenanceCards for Persetujuan/Piutang/Hutang/Fulfillment/SalesInbox
- Preserves: existing `Pre-order fulfillments`, `Promo Produk`, `Log Aktivitas AI`, `Stok Tipis` count

- [ ] **Step 1: Read `src/components/dashboard/PromoProdukCard.tsx` fully as design reference**

Reference file for card pattern (auto-hide, badge, CTA button style, spacing).

- [ ] **Step 2: Write `src/components/dashboard/MaintenanceCard.tsx`**

```typescript
import React from 'react';
import { ArrowRight } from 'lucide-react';

interface Props {
  icon: React.ReactNode;
  title: string;
  count: number;
  detail: string;
  ctaLabel: string;
  onCta: () => void;
  badgeVariant?: 'amber' | 'rose' | 'emerald' | 'slate';
}

const BADGE_CLASSES: Record<NonNullable<Props['badgeVariant']>, string> = {
  amber:   'bg-amber-50 text-amber-700 border-amber-200',
  rose:    'bg-rose-50 text-rose-700 border-rose-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  slate:   'bg-slate-100 text-slate-600 border-slate-200',
};

export default function MaintenanceCard({
  icon, title, count, detail, ctaLabel, onCta, badgeVariant = 'slate',
}: Props) {
  if (count <= 0) return null;
  return (
    <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200">
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center border ${BADGE_CLASSES[badgeVariant]}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{title}</div>
          <div className="text-2xl font-extrabold text-slate-800 mt-0.5">{count}</div>
          <div className="text-xs text-slate-600 mt-0.5 truncate">{detail}</div>
        </div>
      </div>
      <button
        onClick={onCta}
        className="w-full flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-xl transition-colors"
      >
        {ctaLabel}
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Write `src/components/dashboard/TodayStripCard.tsx`**

```typescript
import React, { useEffect, useState } from 'react';
import { getTodaySnapshot } from '../../lib/dashboardReports/api';
import type { TodaySnapshot } from '../../lib/dashboardReports/types';
import { formatIDR } from '../../lib/formatIDR';

export default function TodayStripCard() {
  const [snap, setSnap] = useState<TodaySnapshot | null>(null);

  useEffect(() => {
    getTodaySnapshot().then(setSnap).catch((err) => {
      console.error('[TodayStripCard]', err);
      setSnap({ revenue_today: 0, count_today: 0 });
    });
  }, []);

  if (!snap) {
    return <div className="text-sm text-slate-400">Memuat data hari ini...</div>;
  }

  return (
    <div className="text-sm text-slate-600">
      Hari ini: <span className="font-bold text-slate-800">{formatIDR(snap.revenue_today)}</span>
      {' · '}
      <span className="font-bold text-slate-800">{snap.count_today} transaksi</span>
    </div>
  );
}
```

- [ ] **Step 4: Write `src/components/dashboard/DashboardMaintenanceSection.tsx`**

```typescript
import React, { useEffect, useState } from 'react';
import { CheckCircle2, DollarSign, TrendingDown, Package, MessageSquare } from 'lucide-react';
import MaintenanceCard from './MaintenanceCard';
import { getDashboardMaintenanceCounts } from '../../lib/dashboardReports/api';
import type { MaintenanceCounts } from '../../lib/dashboardReports/types';
import { formatIDR } from '../../lib/formatIDR';
import { categoryCounts } from '../../lib/salesInboxCategorize';
import { supabase } from '../../lib/supabaseClient';

interface Props {
  onNavigate: (screen: string) => void;
}

export default function DashboardMaintenanceSection({ onNavigate }: Props) {
  const [counts, setCounts] = useState<MaintenanceCounts | null>(null);
  const [inboxCount, setInboxCount] = useState<number>(0);

  useEffect(() => {
    getDashboardMaintenanceCounts()
      .then(setCounts)
      .catch((err) => {
        console.error('[DashboardMaintenanceSection]', err);
        setCounts({
          approval_pending: 0,
          piutang_overdue_count: 0, piutang_overdue_sum: 0,
          hutang_overdue_count: 0, hutang_overdue_sum: 0,
          fulfillment_queue_count: 0,
        });
      });
  }, []);

  useEffect(() => {
    let mounted = true;
    async function fetchInbox() {
      try {
        const cc = await categoryCounts(supabase);
        if (mounted) setInboxCount(cc?.total ?? 0);
      } catch (err) {
        console.error('[inbox count]', err);
      }
    }
    void fetchInbox();
    const channel = supabase.channel('dashboard-inbox-count').on('postgres_changes' as unknown as 'system',
      { event: '*', schema: 'public', table: 'conversations' } as unknown as { event: string },
      () => { void fetchInbox(); }).subscribe();
    return () => { mounted = false; void channel.unsubscribe(); };
  }, []);

  if (!counts) return null;

  const anyVisible = counts.approval_pending > 0 || counts.piutang_overdue_count > 0
    || counts.hutang_overdue_count > 0 || counts.fulfillment_queue_count > 0
    || inboxCount > 0;
  if (!anyVisible) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      <MaintenanceCard
        icon={<CheckCircle2 className="w-5 h-5" />}
        title="Persetujuan pending"
        count={counts.approval_pending}
        detail={`${counts.approval_pending} permintaan menunggu approval`}
        ctaLabel="Buka Inbox"
        onCta={() => onNavigate('persetujuan')}
        badgeVariant="amber"
      />
      <MaintenanceCard
        icon={<DollarSign className="w-5 h-5" />}
        title="Piutang overdue"
        count={counts.piutang_overdue_count}
        detail={`${counts.piutang_overdue_count} faktur · ${formatIDR(counts.piutang_overdue_sum)}`}
        ctaLabel="Buka Piutang"
        onCta={() => onNavigate('piutang')}
        badgeVariant="rose"
      />
      <MaintenanceCard
        icon={<TrendingDown className="w-5 h-5" />}
        title="Hutang supplier overdue"
        count={counts.hutang_overdue_count}
        detail={`${counts.hutang_overdue_count} tagihan · ${formatIDR(counts.hutang_overdue_sum)}`}
        ctaLabel="Buka Tagihan"
        onCta={() => onNavigate('pembelian')}
        badgeVariant="rose"
      />
      <MaintenanceCard
        icon={<Package className="w-5 h-5" />}
        title="Fulfillment antrean"
        count={counts.fulfillment_queue_count}
        detail={`${counts.fulfillment_queue_count} pesanan siap kirim / lunas / WIP`}
        ctaLabel="Buka Daftar Pesanan"
        onCta={() => onNavigate('daftarPesanan')}
        badgeVariant="emerald"
      />
      <MaintenanceCard
        icon={<MessageSquare className="w-5 h-5" />}
        title="Sales Inbox"
        count={inboxCount}
        detail={`${inboxCount} chat belum di-jawab`}
        ctaLabel="Buka Sales Inbox"
        onCta={() => onNavigate('sales-inbox')}
        badgeVariant="amber"
      />
    </div>
  );
}
```

Note: `categoryCounts` from `src/lib/salesInboxCategorize.ts` — implementer must verify actual export shape; if it returns array not `{total}`, adapt to sum the array elements. If the module exports a different fn name, use that.

- [ ] **Step 5: Modify `src/components/DashboardScreen.tsx` — remove old + wire new**

Steps to perform:
1. Delete these JSX blocks:
   - Period toggle (7d/30d/90d buttons)
   - KPI card 1 "Total Omset"
   - KPI card 2 "Pesanan Terproses"
   - KPI card 3 "Otomasi Balasan AI"
   - Recharts panel 1 "Revenue per Channel"
   - Recharts panel 2 "Interaksi Balasan Chat Otomatis"
2. Delete unused imports (recharts, unused icons, etc.)
3. Delete unused state hooks (`summary`, `revenueByChannel`, `dailyConvs`, `period`, `aiRate`)
4. Delete unused useEffect that fetched period-based data
5. Keep: `<PromoProdukCard>`, `<PreOrderFulfillmentsCard>`, `<Detak Jantung Log Aktivitas>`, `<Stok Tipis>` card (as a MaintenanceCard-style now)
6. Add imports: `import DashboardMaintenanceSection from './dashboard/DashboardMaintenanceSection';` and `import TodayStripCard from './dashboard/TodayStripCard';`
7. Restructure JSX below the greeting to render sections in order:

```tsx
<div>
  <h2>Selamat Datang di Hub Kendali {storeName}</h2>
  <p className="...">Pantau tindakan yang perlu Anda ambil dan status inventaris.</p>
  <TodayStripCard />
</div>

{/* Perlu Perhatian: maintenance section */}
<section>
  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Perlu Perhatian</h3>
  <DashboardMaintenanceSection onNavigate={(s) => onNavigate(s as any)} />
</section>

{/* Antrean Kerja + Monitoring Stok bundled (Promo, PreOrder, Stok tipis reuse existing cards) */}
<section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
  <PromoProdukCard onNavigate={(s) => onNavigate(s as any)} />
  <PreOrderFulfillmentsCard />
  {/* Optional: Stok tipis MaintenanceCard using existing lowStockCount fetch */}
  <MaintenanceCard
    icon={<AlertTriangle className="w-5 h-5" />}
    title="Stok tipis"
    count={lowStockCount}
    detail={`${lowStockCount} SKU perlu reorder`}
    ctaLabel="Buka Produk & Stok"
    onCta={() => onNavigate('ai-stock')}
    badgeVariant={lowStockCount > 20 ? 'rose' : 'amber'}
  />
</section>

{/* Aktivitas Sistem (existing log) */}
<section>
  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Aktivitas Sistem</h3>
  {/* existing Detak Jantung Log Aktivitas AI markup unchanged */}
</section>
```

Note: preserve existing color palette + section spacing patterns. Do NOT introduce new design tokens. Reuse existing header greeting styles.

- [ ] **Step 6: Verify TS + lint clean + local dev**

Run:
- `npx tsc --noEmit` — expect no errors
- `npm run lint`
- `npm run dev` and manually visit `/?screen=dashboard` — greeting, today strip, maintenance section (empty state if no data), Promo Produk card + Pre-order card + Log AI all visible.

- [ ] **Step 7: Commit**

```bash
git add src/components/DashboardScreen.tsx src/components/dashboard/
git commit -m "feat(item-3): Dashboard reshuffle — action-cards + today strip

Delete 3 duplicate KPI + 2 charts (moved to Laporan responsibility).
Add TodayStripCard (revenue + tx count for today).
Add DashboardMaintenanceSection with 5 auto-hiding cards:
- Persetujuan pending
- Piutang overdue (count + Rp sum)
- Hutang supplier overdue (count + Rp sum)
- Fulfillment antrean
- Sales Inbox unread (reuses categoryCounts + realtime channel)

Existing Pre-order, Promo Produk, Log AI, Stok Tipis kept.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Laporan Performa — KPI row rebuild + delta + profit-per-channel + remove AI

**Files:**
- Modify: `src/components/LaporanScreen.tsx`

**Interfaces:**
- Consumes: Task 2 API (`getPerformaSummaryWithDelta`, `getProfitPerChannel`, `computeDelta`); existing `KpiCard`, recharts
- Produces:
  - Replace existing 4 KPI cards with new 4 (Total Omset, Gross Profit, Pesanan Terproses, AOV) — all with delta indicators
  - Add "Profit per Channel" donut/bar next to existing Revenue per Channel bar
  - Remove AI Efficiency KPI card + Chat AI vs Manual chart panel
  - Remove associated state hooks (`dailyConvs`, `convCount`, `aiConvCount` from Summary type — check what to keep)

- [ ] **Step 1: Rewrite KPI section in LaporanScreen.tsx**

Replace 4-card KPI grid with:

```tsx
import { getPerformaSummaryWithDelta, getProfitPerChannel, computeDelta } from '../lib/dashboardReports/api';
import type { PerformaSummaryWithDelta, ChannelProfitRow, PeriodDays } from '../lib/dashboardReports/types';
import { TrendingUp, DollarSign, ShoppingBag, Receipt } from 'lucide-react';

// Inside component:
const [perfSummary, setPerfSummary] = useState<PerformaSummaryWithDelta | null>(null);
const [profitPerChannel, setProfitPerChannel] = useState<ChannelProfitRow[]>([]);

useEffect(() => {
  const days = (period === '7d' ? 7 : period === '30d' ? 30 : 90) as PeriodDays;
  setPerfSummary(null);
  setProfitPerChannel([]);
  Promise.allSettled([
    getPerformaSummaryWithDelta(days),
    getProfitPerChannel(days),
  ]).then(([summaryRes, profitRes]) => {
    if (summaryRes.status === 'fulfilled') setPerfSummary(summaryRes.value);
    if (profitRes.status === 'fulfilled') setProfitPerChannel(profitRes.value);
  });
}, [period]);

function DeltaBadge({ current, previous, formatFn }: { current: number; previous: number; formatFn?: (v: number) => string }) {
  const d = computeDelta(current, previous);
  if (d.pct == null) {
    return <span className="text-[11px] text-slate-400">— tidak ada data periode sebelumnya</span>;
  }
  const arrow = d.direction === 'up' ? '▲' : d.direction === 'down' ? '▼' : '—';
  const cls = d.direction === 'up' ? 'text-emerald-600' : d.direction === 'down' ? 'text-rose-600' : 'text-slate-500';
  return (
    <span className={`text-[11px] font-semibold ${cls}`}>
      {arrow} {d.pct > 0 ? '+' : ''}{d.pct}% vs periode sebelumnya
    </span>
  );
}

// KPI grid replacement:
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
  <KpiCard
    icon={<TrendingUp className="w-6 h-6" />}
    iconBg="bg-blue-50" iconColor="text-[#1e3d60]"
    badge="Revenue" badgeClass="text-[#2d8a4e] bg-emerald-50"
    label="Total Omset"
    value={perfSummary ? formatRupiah(perfSummary.revenue) : '...'}
    sub={perfSummary ? <DeltaBadge current={perfSummary.revenue} previous={perfSummary.prev_revenue} /> : 'Memuat...'}
  />
  <KpiCard
    icon={<DollarSign className="w-6 h-6" />}
    iconBg="bg-emerald-50" iconColor="text-emerald-700"
    badge={perfSummary && perfSummary.revenue > 0
      ? `${Math.round((perfSummary.gross_profit / perfSummary.revenue) * 100)}% margin`
      : 'Margin'}
    badgeClass="text-emerald-700 bg-emerald-50"
    label="Gross Profit"
    value={perfSummary ? formatRupiah(perfSummary.gross_profit) : '...'}
    sub={perfSummary ? <DeltaBadge current={perfSummary.gross_profit} previous={perfSummary.prev_gross_profit} /> : 'Memuat...'}
  />
  <KpiCard
    icon={<ShoppingBag className="w-6 h-6" />}
    iconBg="bg-amber-50" iconColor="text-amber-600"
    badge="Selesai" badgeClass="text-blue-600 bg-blue-50"
    label="Pesanan Terproses"
    value={perfSummary ? `${perfSummary.order_count} Transaksi` : '...'}
    sub={perfSummary ? <DeltaBadge current={perfSummary.order_count} previous={perfSummary.prev_order_count} /> : 'Memuat...'}
  />
  <KpiCard
    icon={<Receipt className="w-6 h-6" />}
    iconBg="bg-violet-50" iconColor="text-violet-600"
    badge="Rata-rata" badgeClass="text-violet-700 bg-violet-50"
    label="Nilai Rata-rata Pesanan"
    value={perfSummary ? formatRupiah(perfSummary.avg_order_value) : '...'}
    sub={perfSummary ? <DeltaBadge current={perfSummary.avg_order_value} previous={perfSummary.prev_avg_order_value} /> : 'Memuat...'}
  />
</div>
```

Note: `KpiCard.sub` accepts ReactNode; verify existing `KpiCard` component signature at `src/components/ui/KpiCard.tsx`. If `sub` is string-only, extend it to `ReactNode` in that component with same-name prop.

- [ ] **Step 2: Delete AI Efficiency KPI card + Chat AI/Manual chart**

Remove:
- The 4th KPI card in the existing 4-card grid (Otomasi AI) — replaced by AOV / re-purposed as done in Step 1
- The "Interaksi Chat — AI vs Manual" chart panel div (find by header text)
- Related useEffect that fetches `reportsService.fetchDailyConversations`
- Related state: `dailyConvs`, `convCount`, `aiConvCount` (from Summary type — keep the `convCount` reads if used elsewhere; if only feeds AI card, delete)

- [ ] **Step 3: Add Profit per Channel visualization next to Revenue per Channel**

In the Revenue per Channel section, extend the flex row to include a compact "Profit per Channel" panel (donut or list). Replace existing donut area with:

```tsx
{/* Right: Profit per Channel (replaces old channel-total donut) */}
<div className="lg:w-64 flex flex-col">
  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Profit per Channel</p>
  {profitPerChannel.length === 0 ? (
    <p className="text-xs text-gray-300 italic">Belum ada data</p>
  ) : (
    <div className="space-y-2">
      {profitPerChannel.map((row) => (
        <div key={row.channel} className="border border-slate-100 rounded-xl p-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-700">{row.channel}</span>
            <span className="font-bold text-emerald-700">{Math.round(row.margin_pct)}%</span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            {formatRupiah(row.revenue)} · Profit {formatRupiah(row.gross_profit)}
          </div>
        </div>
      ))}
    </div>
  )}
</div>
```

- [ ] **Step 4: Verify TS + lint + local dev**

Run:
- `npx tsc --noEmit` — expect no errors
- `npm run lint`
- `npm run dev` and visit `/?screen=laporan` — Performa tab shows: Gross Profit KPI + delta arrows on all 4, Profit per Channel replaces donut; AI Efficiency card + Chat chart gone.

- [ ] **Step 5: Commit**

```bash
git add src/components/LaporanScreen.tsx src/components/ui/KpiCard.tsx
git commit -m "feat(item-3): Laporan KPI row rebuild + delta + profit per channel

- Add Gross Profit KPI (with margin % badge)
- Add period-over-period delta arrows on all 4 KPI cards
- Replace AI Efficiency KPI with AOV (moved up from row 3)
- Add Profit per Channel panel replacing channel-total donut
- Remove Chat AI vs Manual chart panel
- Remove associated state fetching

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Laporan Performa — slow-mover section + top customer section

**Files:**
- Modify: `src/components/LaporanScreen.tsx`
- Create: `src/components/laporan/SlowMoverTable.tsx`
- Create: `src/components/laporan/TopCustomerTable.tsx`

**Interfaces:**
- Consumes: Task 2 API (`getSlowMovingStock`, `getTopCustomers`)
- Produces:
  - `<SlowMoverTable {days} />` — self-fetching table (auto-hides section when no rows)
  - `<TopCustomerTable {days, onOpenCustomer} />` — self-fetching table (auto-hides section when no rows)
- Wires both into LaporanScreen under existing "Produk Terlaris" table

- [ ] **Step 1: Write `src/components/laporan/SlowMoverTable.tsx`**

```typescript
import React, { useEffect, useState } from 'react';
import { getSlowMovingStock } from '../../lib/dashboardReports/api';
import type { SlowMovingRow, PeriodDays } from '../../lib/dashboardReports/types';

interface Props { days: PeriodDays; }

export default function SlowMoverTable({ days }: Props) {
  const [rows, setRows] = useState<SlowMovingRow[] | null>(null);

  useEffect(() => {
    setRows(null);
    getSlowMovingStock(days, 20).then(setRows).catch((err) => {
      console.error('[SlowMoverTable]', err);
      setRows([]);
    });
  }, [days]);

  if (rows === null) {
    return <p className="text-sm text-slate-400 italic">Memuat data slow-moving...</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400 italic">Tidak ada SKU slow-moving dalam periode ini.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-gray-400 uppercase border-b border-gray-100">
          <th className="text-left pb-3 font-bold">SKU</th>
          <th className="text-left pb-3 font-bold">Nama</th>
          <th className="text-right pb-3 font-bold">Stok</th>
          <th className="text-right pb-3 font-bold">Terjual periode</th>
          <th className="text-right pb-3 font-bold">Umur stagnasi</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.sku} className="border-b border-gray-50 hover:bg-slate-50 transition-colors">
            <td className="py-3 font-mono text-xs text-slate-600">{r.sku}</td>
            <td className="py-3 text-slate-800 font-semibold">{r.name}</td>
            <td className="py-3 text-right text-slate-600">{r.stock}</td>
            <td className="py-3 text-right text-slate-600">{r.qty_sold} unit</td>
            <td className="py-3 text-right">
              <span className={r.severity === 'dead' ? 'text-rose-700 font-bold' : 'text-amber-700 font-semibold'}>
                {r.days_stagnant} hari {r.severity === 'dead' ? '💀' : '⚠'}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: Write `src/components/laporan/TopCustomerTable.tsx`**

```typescript
import React, { useEffect, useState } from 'react';
import { getTopCustomers } from '../../lib/dashboardReports/api';
import type { TopCustomerRow, PeriodDays } from '../../lib/dashboardReports/types';

interface Props {
  days: PeriodDays;
  onOpenCustomer?: (customerId: string) => void;
}

function formatRupiah(val: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  }).format(val);
}

export default function TopCustomerTable({ days, onOpenCustomer }: Props) {
  const [rows, setRows] = useState<TopCustomerRow[] | null>(null);

  useEffect(() => {
    setRows(null);
    getTopCustomers(days, 10).then(setRows).catch((err) => {
      console.error('[TopCustomerTable]', err);
      setRows([]);
    });
  }, [days]);

  if (rows === null) {
    return <p className="text-sm text-slate-400 italic">Memuat data customer...</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400 italic">Belum ada transaksi customer dalam periode ini.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-gray-400 uppercase border-b border-gray-100">
          <th className="text-left pb-3 font-bold">#</th>
          <th className="text-left pb-3 font-bold">Customer</th>
          <th className="text-right pb-3 font-bold">Total belanja</th>
          <th className="text-right pb-3 font-bold"># Trans</th>
          <th className="text-right pb-3 font-bold">Terakhir beli</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr
            key={r.customer_id}
            className={`border-b border-gray-50 transition-colors ${onOpenCustomer ? 'cursor-pointer hover:bg-slate-50' : ''}`}
            onClick={() => onOpenCustomer?.(r.customer_id)}
          >
            <td className="py-3 text-gray-300 font-bold w-8">{i + 1}</td>
            <td className="py-3">
              <div className="text-slate-800 font-semibold">{r.customer_name}</div>
              {r.customer_company && (
                <div className="text-xs text-slate-500">{r.customer_company}</div>
              )}
            </td>
            <td className="py-3 text-right font-bold text-emerald-700">{formatRupiah(r.total_revenue)}</td>
            <td className="py-3 text-right text-slate-600">{r.transaction_count}x</td>
            <td className="py-3 text-right">
              <span className={r.days_since_last > 14 ? 'text-amber-700' : 'text-slate-600'}>
                {r.days_since_last === 0 ? 'Hari ini' : `${r.days_since_last} hari lalu`}
                {r.days_since_last > 14 && ' ⚠'}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: Wire both tables into LaporanScreen.tsx**

After existing "Produk Terlaris" section, add:

```tsx
{/* Slow-moving stock */}
<div className="bg-white rounded-3xl p-6 md:p-8 border border-[#e5eeff] shadow-xl">
  <h4 className="text-lg font-bold text-[#012749] mb-4">Produk Slow-Moving</h4>
  <p className="text-xs text-slate-500 mb-4">SKU dengan penjualan rendah dalam periode. Pertimbangkan bundling, diskon, atau retur ke supplier.</p>
  <SlowMoverTable days={(period === '7d' ? 7 : period === '30d' ? 30 : 90) as PeriodDays} />
</div>

{/* Top Customer */}
<div className="bg-white rounded-3xl p-6 md:p-8 border border-[#e5eeff] shadow-xl">
  <h4 className="text-lg font-bold text-[#012749] mb-4">Top 10 Customer</h4>
  <p className="text-xs text-slate-500 mb-4">Customer dengan total belanja tertinggi dalam periode. Klik baris untuk membuka detail customer.</p>
  <TopCustomerTable
    days={(period === '7d' ? 7 : period === '30d' ? 30 : 90) as PeriodDays}
    onOpenCustomer={(id) => { /* Wire to onNavigate or existing customer detail prop; if not available, skip onOpenCustomer prop */ }}
  />
</div>
```

If `onNavigate` prop or equivalent customer-detail handler is accessible in LaporanScreen from parent (`App.tsx`), route to `pelanggan/detail(customer_id)`. Otherwise pass `undefined` and rows just render non-interactive for MVP.

- [ ] **Step 4: Import new components + PeriodDays type at top of LaporanScreen.tsx**

```typescript
import SlowMoverTable from './laporan/SlowMoverTable';
import TopCustomerTable from './laporan/TopCustomerTable';
import type { PeriodDays } from '../lib/dashboardReports/types';
```

- [ ] **Step 5: Verify TS + lint clean + local dev**

- `npx tsc --noEmit`
- `npm run lint`
- `npm run dev`, visit `/?screen=laporan`, click Performa tab, toggle 7d/30d/90d — slow-mover + top customer tables update.

- [ ] **Step 6: Commit**

```bash
git add src/components/laporan/ src/components/LaporanScreen.tsx
git commit -m "feat(item-3): Laporan slow-mover + top customer sections

- SlowMoverTable: SKUs with low turnover, severity badges (dead/slow)
- TopCustomerTable: top 10 by revenue, dormancy warning (>14 days)
  optional deep link to Pelanggan detail

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## After all tasks

- [ ] Run `npm run lint`, `npm run audit:numinput`, `npm run audit:secdef-null-tenant`
- [ ] Run `mcp__plugin_supabase_supabase__get_advisors` — no new criticals related to slot 130 RPCs
- [ ] Call `advisor()` on final diff before pushing (per CLAUDE.md diff-size trigger — this ships >100 lines across >3 files)
- [ ] `git push origin main` → triggers Cloud Build → Cloud Run --no-traffic → tag URL smoke → 100% traffic
- [ ] MCP chrome smoke on Garindo:
  - Dashboard: greeting + today strip render; maintenance section either shows real data or hides gracefully; Promo card + Pre-order card + Log AI still work.
  - Laporan Performa: 4 KPI cards with delta arrows, Gross Profit visible with margin badge; Profit per Channel replaces donut; slow-mover + top customer tables render; AI Efficiency card + Chat chart absent.
  - Laporan Akuntansi: unchanged (regression check).
- [ ] Update `progress.md` with Item #3 shipping entry
- [ ] Update memory `migration_slot_allocation` — 130 now claimed for Item #3
