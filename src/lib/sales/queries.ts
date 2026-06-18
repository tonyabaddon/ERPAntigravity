import { supabase } from '../supabaseClient';
import type { Order, SalesDashboardStats } from './types';
import { rowToOrder } from './orderMapper';

export async function fetchActiveOrders(): Promise<Order[]> {
  const { data, error } = await supabase
    .from('kasir_transactions')
    .select('*')
    .eq('type', 'income')
    .in('funnel_stage', [1, 2, 3, 4])
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToOrder);
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
  return (data ?? []).map(rowToOrder);
}

// Fetches active orders + most recent N archive orders for stages 5 & 6 in a single
// merged list. Used by DaftarPesananScreen so clicking Stage 5/6 in the strip shows
// the recently completed/cancelled rows. Archive limit kept small to bound payload.
export async function fetchOrdersWithArchive(archiveLimit: number = 20): Promise<Order[]> {
  const [active, archive5, archive6] = await Promise.all([
    fetchActiveOrders(),
    fetchArchiveOrders(5, archiveLimit),
    fetchArchiveOrders(6, archiveLimit),
  ]);
  return [...active, ...archive5, ...archive6];
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
      callback(rowToOrder(payload.new));
    })
    .subscribe();
}
