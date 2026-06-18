import { supabase } from '../supabaseClient';
import type { Order, SalesDashboardStats } from './types';

export async function fetchActiveOrders(): Promise<Order[]> {
  const { data, error } = await supabase
    .from('kasir_transactions')
    .select('*')
    .eq('type', 'income')
    .in('funnel_stage', [1, 2, 3, 4])
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Order[];
}

export async function fetchArchiveOrders(stage: 5 | 6, limit: number = 5): Promise<Order[]> {
  const { data, error } = await supabase
    .from('kasir_transactions')
    .select('*')
    .eq('type', 'income')
    .eq('funnel_stage', stage)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as Order[];
}

export async function fetchDashboardStats(): Promise<SalesDashboardStats> {
  const { data, error } = await supabase.rpc('get_sales_dashboard_stats');
  if (error) throw error;
  return data as SalesDashboardStats;
}

export function subscribeOrders(callback: (order: Order) => void) {
  return supabase
    .channel('kasir-orders-funnel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'kasir_transactions' }, (payload) => {
      callback(payload.new as Order);
    })
    .subscribe();
}
