/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase } from '../supabaseClient';

/**
 * Result from closing an accounting period.
 */
export interface PeriodCloseResult {
  ok: true;
  closed_at: string;
}

/**
 * Ensures Supabase client is configured.
 * @throws Error if Supabase is not configured
 */
function requireSupabase() {
  if (!supabase) throw new Error('Supabase not configured');
  return supabase;
}

/**
 * Close an accounting period by year and month.
 * Calls the close_accounting_period RPC which updates the accounting_periods
 * table to mark the period as CLOSED.
 *
 * @param year - Period year (e.g., 2026)
 * @param month - Period month (1-12)
 * @returns PeriodCloseResult with ok flag and closed_at timestamp
 * @throws Error if period not found, not open, or user is not an active Owner
 */
export async function closeAccountingPeriod(
  year: number,
  month: number,
): Promise<PeriodCloseResult> {
  const sb = requireSupabase();

  const { data, error } = await sb.rpc('close_accounting_period', {
    p_year: year,
    p_month: month,
    p_tenant_id: null,
  });

  if (error) throw new Error(error.message);

  return (data as any) as PeriodCloseResult;
}
