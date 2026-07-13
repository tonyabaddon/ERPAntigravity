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
