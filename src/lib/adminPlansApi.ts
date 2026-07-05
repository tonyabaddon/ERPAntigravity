/**
 * Plans API for the platform-admin panel (Phase B Wave 1).
 *
 * Uses a direct table query since plans.g_read_all grants SELECT to any
 * authenticated user (USING true), so no SECDEF RPC is needed.
 * tenant_count is derived client-side from tenant_subscriptions to avoid
 * an extra RPC and keep the query surface minimal.
 */

import { supabase } from './supabaseClient';

export interface PlanRow {
  code: 'STARTER' | 'PRO' | 'PREMIUM';
  name: string;
  description: string | null;
  target_segment: string | null;
  is_recommended: boolean;
  feature_bundle: Record<string, boolean>;
  sort_order: number;
  tenant_count: number;
  /** Annual price in IDR (from plans.price_annual). Null for legacy rows without price. */
  price_annual: number | null;
}

export async function listPlansAdmin(): Promise<PlanRow[]> {
  if (!supabase) throw new Error('Supabase client not configured');

  const { data, error } = await supabase
    .from('plans')
    .select('code, name, description, target_segment, is_recommended, feature_bundle, sort_order, price_annual')
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`plans query failed: ${error.message}`);

  const { data: counts, error: cErr } = await supabase
    .from('tenant_subscriptions')
    .select('plan_code');
  if (cErr) throw new Error(`tenant_subscriptions query failed: ${cErr.message}`);

  const countMap: Record<string, number> = {};
  for (const row of counts ?? []) {
    countMap[row.plan_code] = (countMap[row.plan_code] ?? 0) + 1;
  }

  return (data ?? []).map((p) => ({
    code: p.code as 'STARTER' | 'PRO' | 'PREMIUM',
    name: p.name as string,
    description: (p.description as string | null) ?? null,
    target_segment: (p.target_segment as string | null) ?? null,
    is_recommended: (p.is_recommended as boolean) ?? false,
    feature_bundle: (p.feature_bundle as Record<string, boolean>) ?? {},
    sort_order: (p.sort_order as number) ?? 0,
    tenant_count: countMap[p.code] ?? 0,
    price_annual: (p.price_annual as number | null) ?? null,
  }));
}
