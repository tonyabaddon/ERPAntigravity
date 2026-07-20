import { supabase } from '../supabaseClient';
import type { Order, SalesDashboardStats } from './types';
import { rowToOrder } from './orderMapper';

export type RakitLockHistoryEvent =
  | { type: 'requested';                created_at: string; actor_user_id: string | null; admin_submitted: unknown }
  | { type: 'approved';                  created_at: string; actor_user_id: string | null }
  | { type: 'approved_with_edit';        created_at: string; actor_user_id: string | null; admin_submitted: unknown; owner_amended: unknown; diff_keys: string[] }
  | { type: 'rejected';                  created_at: string; actor_user_id: string | null; reason: string };

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

/**
 * tenant_id filter is REQUIRED. Realtime bandwidth is billed per-connection;
 * unfiltered subscriptions receive all-tenant events + RLS-drop client-side.
 * Server-side filter cuts inbound bytes and enforces isolation belt-and-suspenders.
 */
export function subscribeOrders(tenantId: string, callback: (order: Order) => void) {
  return supabase
    .channel('kasir-orders-funnel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'kasir_transactions', filter: `tenant_id=eq.${tenantId}` }, (payload) => {
      callback(rowToOrder(payload.new));
    })
    .subscribe();
}

/**
 * Reads typed rakit_lock event history for a single order from `audit_log`.
 * Powers the RiwayatPersetujuanPanel (Milestone E). Returns events in DESC
 * created_at order (newest first); empty array on supabase error.
 *
 * Note: filtering by `payload->>'order_id'` could be pushed into the SQL
 * query, but JSONB key lookups via supabase-js .filter() are awkward; we
 * over-fetch by event_type and filter in JS. Volume is bounded (one order's
 * worth of rakit events ≈ 1-5 rows in practice), so cost is negligible.
 */
export async function fetchRakitLockHistory(orderId: string): Promise<RakitLockHistoryEvent[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('audit_log')
    .select('event_type, actor_user_id, created_at, payload')
    .in('event_type', [
      'rakit_lock_requested',
      'rakit_lock_approved',
      'rakit_lock_approved_with_edit',
      'rakit_lock_rejected',
    ])
    .order('created_at', { ascending: false });
  if (error) {
    console.error('fetchRakitLockHistory failed', error);
    return [];
  }
  const events: RakitLockHistoryEvent[] = [];
  for (const row of data ?? []) {
    const r = row as { event_type: string; actor_user_id: string | null; created_at: string; payload: Record<string, unknown> };
    if (r.payload?.order_id !== orderId) continue;
    if (r.event_type === 'rakit_lock_requested') {
      events.push({ type: 'requested', created_at: r.created_at, actor_user_id: r.actor_user_id, admin_submitted: r.payload.admin_submitted });
    } else if (r.event_type === 'rakit_lock_approved') {
      events.push({ type: 'approved', created_at: r.created_at, actor_user_id: r.actor_user_id });
    } else if (r.event_type === 'rakit_lock_approved_with_edit') {
      events.push({
        type: 'approved_with_edit',
        created_at: r.created_at,
        actor_user_id: r.actor_user_id,
        admin_submitted: r.payload.admin_submitted,
        owner_amended: r.payload.owner_amended,
        diff_keys: (r.payload.diff_keys as string[]) ?? [],
      });
    } else if (r.event_type === 'rakit_lock_rejected') {
      events.push({ type: 'rejected', created_at: r.created_at, actor_user_id: r.actor_user_id, reason: (r.payload.reason as string) ?? '' });
    }
  }
  return events;
}
