// src/lib/costDashboardApi.ts
// P2-A: API helpers for the per-tenant cost dashboard.
// All calls require platform_admin JWT (enforced server-side via RLS + RPC gate).

import { supabase } from './supabaseClient';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TenantCostRow {
  /** From tenants table */
  tenant_id: string;
  slug: string;
  name: string;
  /** From t_tenant_cost_daily (null if no data yet for this date) */
  usage_date: string | null;
  gemini_calls: number;
  gemini_input_tokens: number;
  gemini_output_tokens: number;
  cloud_run_requests: number;
  storage_bytes: number;
  updated_at: string | null;
  /** Computed cost estimates (USD) — rough guidance only, actual bills are authoritative */
  est_gemini_usd: number;
  est_storage_usd: number;
  est_total_usd: number;
}

export interface BackfillResult {
  ok: boolean;
  date: string;
  rows_upserted: number;
}

// ─── Cost estimation constants ─────────────────────────────────────────────────
// Gemini 2.5 Flash Lite pricing (approximate — verify at ai.google.dev/pricing)
const GEMINI_INPUT_USD_PER_M  = 0.075;   // $0.075 per 1M input tokens
const GEMINI_OUTPUT_USD_PER_M = 0.300;   // $0.30 per 1M output tokens
// Supabase Storage: first 1 GB free, then $0.021/GB/month prorated to $/day
const STORAGE_FREE_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB
const STORAGE_USD_PER_GB_MONTH = 0.021;
const DAYS_IN_MONTH = 30;

function estimateCosts(row: Omit<TenantCostRow, 'est_gemini_usd' | 'est_storage_usd' | 'est_total_usd'>): {
  est_gemini_usd: number;
  est_storage_usd: number;
  est_total_usd: number;
} {
  const gemini_usd =
    (row.gemini_input_tokens  / 1_000_000) * GEMINI_INPUT_USD_PER_M +
    (row.gemini_output_tokens / 1_000_000) * GEMINI_OUTPUT_USD_PER_M;

  const billable_bytes = Math.max(0, row.storage_bytes - STORAGE_FREE_BYTES);
  const storage_usd =
    (billable_bytes / (1024 * 1024 * 1024)) * STORAGE_USD_PER_GB_MONTH / DAYS_IN_MONTH;

  return {
    est_gemini_usd:  Math.round(gemini_usd * 10_000) / 10_000,
    est_storage_usd: Math.round(storage_usd * 10_000) / 10_000,
    est_total_usd:   Math.round((gemini_usd + storage_usd) * 10_000) / 10_000,
  };
}

// ─── API ───────────────────────────────────────────────────────────────────────

/**
 * Fetch cost signals for all active tenants for a given date.
 * LEFT JOINs from tenants table so every tenant appears, even with zero data.
 * Requires platform_admin JWT.
 */
export async function listTenantCosts(date: string): Promise<TenantCostRow[]> {
  if (!supabase) throw new Error('Supabase client not configured');

  // Fetch all active tenants (need slug + name for display)
  const { data: tenants, error: tenantsError } = await supabase
    .from('tenants')
    .select('id, slug, name')
    .eq('status', 'ACTIVE')
    .order('name');

  if (tenantsError) throw new Error(`listTenantCosts: tenants error — ${tenantsError.message}`);

  const tenantList = (tenants ?? []) as { id: string; slug: string; name: string }[];

  if (tenantList.length === 0) return [];

  // Fetch cost rows for this date
  const { data: costRows, error: costError } = await supabase
    .from('t_tenant_cost_daily')
    .select('*')
    .eq('usage_date', date);

  if (costError) throw new Error(`listTenantCosts: cost rows error — ${costError.message}`);

  const costMap = new Map<string, Record<string, unknown>>(
    ((costRows ?? []) as Record<string, unknown>[]).map((r) => [r.tenant_id as string, r]),
  );

  return tenantList.map((t) => {
    const cost = costMap.get(t.id);
    const base = {
      tenant_id:            t.id,
      slug:                 t.slug,
      name:                 t.name,
      usage_date:           cost ? (cost.usage_date as string) : null,
      gemini_calls:         (cost?.gemini_calls         as number) ?? 0,
      gemini_input_tokens:  (cost?.gemini_input_tokens  as number) ?? 0,
      gemini_output_tokens: (cost?.gemini_output_tokens as number) ?? 0,
      cloud_run_requests:   (cost?.cloud_run_requests   as number) ?? 0,
      storage_bytes:        (cost?.storage_bytes        as number) ?? 0,
      updated_at:           (cost?.updated_at           as string) ?? null,
    };
    return { ...base, ...estimateCosts(base) };
  });
}

/**
 * Invoke backfill_tenant_cost_daily RPC for the given date.
 * Aggregates storage bytes per tenant from storage.objects.
 * Idempotent — safe to re-run for the same date.
 */
export async function backfillTenantCostDaily(date: string): Promise<BackfillResult> {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.rpc('backfill_tenant_cost_daily', {
    p_date: date,
  });
  if (error) throw new Error(`backfillTenantCostDaily: ${error.message}`);
  return data as BackfillResult;
}
