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

  return (data as { ok: true; closed_at: string }) as PeriodCloseResult;
}

/**
 * Result from year-end fiscal close.
 * Posts JEs to close Pendapatan + Beban → Ikhtisar Laba Rugi (3-1900),
 * then Ikhtisar → Laba Ditahan (3-1100), then Prive → Modal Owner.
 */
export interface YearEndCloseResult {
  ok: true;
  fiscal_year: number;
  total_pendapatan: number;
  total_beban: number;
  net_income: number;
  prive_closed: number;
  closed_at: string;
}

/**
 * Close a fiscal year — posts 4-step JE sequence:
 *   1. D Pendapatan, K Ikhtisar (zero out revenue accounts)
 *   2. D Ikhtisar, K Beban (zero out expense accounts)
 *   3. D/K Ikhtisar ↔ Laba Ditahan (net income to retained earnings)
 *   4. D Modal Owner, K Prive (close drawing account)
 *
 * Prerequisite: all months of the year should be CLOSED already.
 *
 * @param year - Fiscal year (e.g., 2025)
 */
export async function closeFiscalYear(year: number): Promise<YearEndCloseResult> {
  const sb = requireSupabase();

  const { data, error } = await sb.rpc('close_fiscal_year', {
    p_year: year,
    p_tenant_id: null,
  });

  if (error) throw new Error(error.message);

  return data as YearEndCloseResult;
}
