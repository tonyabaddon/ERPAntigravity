/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase } from '../supabaseClient';
import type {
  CoaAccount,
  AccountingConfig,
  AccountingPeriod,
  OpeningBalanceLine,
  TrialBalanceRow,
  GeneralLedgerRow,
} from './types';

/**
 * Ensures Supabase client is configured.
 * @throws Error if Supabase is not configured
 */
function requireSupabase() {
  if (!supabase) throw new Error('Supabase not configured');
  return supabase;
}

/**
 * Fetch all active chart of accounts.
 * @returns Array of COA accounts sorted by account code
 */
export async function fetchCoa(): Promise<CoaAccount[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('chart_of_accounts')
    .select('*')
    .order('account_code', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CoaAccount[];
}

/**
 * Fetch accounting configuration for current tenant.
 * @returns Accounting config or null if not set
 */
export async function fetchAccountingConfig(): Promise<AccountingConfig | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('accounting_config')
    .select('*')
    .is('tenant_id', null)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as AccountingConfig | null;
}

/**
 * Fetch all accounting periods for current tenant.
 * @returns Array of periods sorted by year/month descending
 */
export async function fetchAccountingPeriods(): Promise<AccountingPeriod[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('accounting_periods')
    .select('*')
    .is('tenant_id', null)
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AccountingPeriod[];
}

/**
 * Set opening balances for accounts at a specific date.
 * Creates journal entries in OPENING_BALANCE source.
 * @param balanceDate - ISO date string (YYYY-MM-DD)
 * @param lines - Array of opening balance lines
 * @returns Result with entry ID and number
 */
export async function setOpeningBalance(
  balanceDate: string,
  lines: OpeningBalanceLine[],
): Promise<{ ok: boolean; entry_id?: string; entry_number?: string }> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('set_opening_balance', {
    p_balance_date: balanceDate,
    p_lines: lines,
    p_tenant_id: null,
  });
  if (error) throw error;
  return data as { ok: boolean; entry_id?: string; entry_number?: string };
}

/**
 * Close an accounting period.
 * Generates closing entries and prevents further modifications.
 * @param year - Fiscal year (YYYY)
 * @param month - Month number (1-12)
 * @returns Result with ok flag
 */
export async function closeAccountingPeriod(year: number, month: number): Promise<{ ok: boolean }> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('close_accounting_period', {
    p_year: year,
    p_month: month,
    p_tenant_id: null,
  });
  if (error) throw error;
  return data as { ok: boolean };
}

/**
 * Close a fiscal year.
 * Generates year-end closing entries and transfers net income to retained earnings.
 * @param year - Fiscal year (YYYY)
 * @returns Result with closing summary (net income, revenue, expense totals)
 */
export async function closeFiscalYear(year: number): Promise<{
  ok: boolean;
  fiscal_year: number;
  net_income: number;
  total_pendapatan: number;
  total_beban: number;
  prive_closed: number;
}> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('close_fiscal_year', {
    p_year: year,
    p_tenant_id: null,
  });
  if (error) throw error;
  return data as { ok: boolean; fiscal_year: number; net_income: number; total_pendapatan: number; total_beban: number; prive_closed: number };
}

/**
 * Accrue period taxes (PPH and/or PPN) based on configuration.
 * Recognizes tax expense and liability.
 * @param year - Fiscal year (YYYY)
 * @param month - Month number (1-12)
 * @returns Result with tax summary (omzet, tax amount, rate percentage)
 */
export async function accruePeriodTaxes(year: number, month: number): Promise<{
  ok?: boolean;
  omzet: number;
  tax: number;
  pph_rate_pct?: number;
  skipped?: boolean;
}> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('accrue_period_taxes', {
    p_year: year,
    p_month: month,
    p_tenant_id: null,
  });
  if (error) throw error;
  return data as { ok?: boolean; omzet: number; tax: number; pph_rate_pct?: number; skipped?: boolean };
}

/**
 * Fetch trial balance (debit/credit totals by account).
 * @returns Array of trial balance rows sorted by account code
 */
export async function fetchTrialBalance(): Promise<TrialBalanceRow[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('trial_balance')
    .select('*')
    .order('account_code', { ascending: true });
  if (error) throw error;
  return (data ?? []) as TrialBalanceRow[];
}

/**
 * Fetch general ledger entries for a specific account and date range.
 * @param accountId - Account UUID
 * @param fromDate - Start date (YYYY-MM-DD)
 * @param toDate - End date (YYYY-MM-DD)
 * @returns Array of ledger entries sorted by date
 */
export async function fetchGeneralLedger(
  accountId: string,
  fromDate: string,
  toDate: string,
): Promise<GeneralLedgerRow[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('general_ledger')
    .select('*')
    .eq('account_id', accountId)
    .gte('entry_date', fromDate)
    .lte('entry_date', toDate)
    .order('entry_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as GeneralLedgerRow[];
}
