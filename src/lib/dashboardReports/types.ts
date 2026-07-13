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
