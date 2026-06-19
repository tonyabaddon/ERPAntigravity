import { supabase } from '../supabaseClient';

export interface RejectInfo {
  reason: string;
  rejected_at: string;
  rejected_by: string | null;
}

/**
 * Batch fetch the most-recent `rakit_lock_rejected` audit_log entry per
 * order, within the last 7 days. Used by DaftarPesananScreen to surface a
 * chip on funnel sub-stage 3f rows.
 *
 * Returns an empty map when `orderIds` is empty (avoids a wasted query).
 */
export async function fetchRecentRejectsByOrder(
  orderIds: string[],
): Promise<Record<string, RejectInfo>> {
  if (orderIds.length === 0) return {};
  if (!supabase) return {};

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('audit_log')
    .select('actor_user_id, created_at, payload')
    .eq('event_type', 'rakit_lock_rejected')
    .gte('created_at', sevenDaysAgo)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('fetchRecentRejectsByOrder failed', error);
    return {};
  }

  const allowed = new Set(orderIds);
  const map: Record<string, RejectInfo> = {};
  for (const row of data ?? []) {
    const payload = (row as { payload: { order_id?: string; reason?: string } }).payload;
    const orderId = payload?.order_id;
    if (!orderId || !allowed.has(orderId)) continue;
    if (map[orderId]) continue;
    map[orderId] = {
      reason: payload.reason ?? '(tanpa alasan)',
      rejected_at: (row as { created_at: string }).created_at,
      rejected_by: (row as { actor_user_id: string | null }).actor_user_id,
    };
  }
  return map;
}
