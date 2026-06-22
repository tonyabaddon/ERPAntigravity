/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase } from '../supabaseClient';
import type {
  AccountingPeriod,
  GeneralLedgerRow,
  TrialBalanceRow,
  NormalBalance,
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
 * Extended Trial Balance Row with COA metadata.
 * Includes parent account info and system flags.
 */
export interface TrialBalanceRowWithMetadata extends TrialBalanceRow {
  parent_id: string | null;
  is_system: boolean;
  is_active: boolean;
}

/**
 * Chart of Accounts tree node.
 * Represents an account in the COA hierarchy.
 */
export interface CoaTreeRow {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  account_subtype: string | null;
  parent_id: string | null;
  is_system: boolean;
  is_active: boolean;
  description: string | null;
  normal_balance: NormalBalance;
}

/**
 * Fetch trial balance with COA metadata.
 * Joins trial_balance view with chart_of_accounts to include parent_id, is_system, is_active.
 * Returns all active accounts with their debit/credit totals and net balance.
 * @returns Array of trial balance rows sorted by account code
 */
export async function fetchTrialBalance(): Promise<TrialBalanceRowWithMetadata[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('trial_balance')
    .select(
      `
      account_id,
      account_code,
      account_name,
      account_type,
      account_subtype,
      normal_balance,
      total_debit,
      total_credit,
      balance,
      coa:chart_of_accounts!account_id(parent_id, is_system, is_active)
      `
    )
    .order('account_code', { ascending: true });

  if (error) throw new Error(error.message);

  // Transform flat response into typed objects
  const rows = (data ?? []) as any[];
  return rows.map(row => ({
    account_id: row.account_id,
    account_code: row.account_code,
    account_name: row.account_name,
    account_type: row.account_type,
    account_subtype: row.account_subtype,
    normal_balance: row.normal_balance,
    total_debit: Number(row.total_debit),
    total_credit: Number(row.total_credit),
    balance: Number(row.balance),
    parent_id: row.coa?.[0]?.parent_id ?? null,
    is_system: row.coa?.[0]?.is_system ?? false,
    is_active: row.coa?.[0]?.is_active ?? true,
  })) as TrialBalanceRowWithMetadata[];
}

/**
 * Fetch accounting periods for current tenant.
 * Fetches from existing service.ts implementation.
 * @returns Array of accounting periods sorted by year/month descending
 */
export async function fetchAccountingPeriods(): Promise<AccountingPeriod[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('accounting_periods')
    .select('*')
    .is('tenant_id', null)
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as AccountingPeriod[];
}

/**
 * Fetch Chart of Accounts as a tree structure.
 * Returns accounts with hierarchy info (parent_id) and metadata.
 * @param includeInactive - If true, include inactive accounts (default: false)
 * @returns Array of COA accounts sorted by account code
 */
export async function fetchCoaTree(includeInactive: boolean = false): Promise<CoaTreeRow[]> {
  const sb = requireSupabase();
  let query = sb.from('chart_of_accounts').select(
    `
    id,
    account_code,
    account_name,
    account_type,
    account_subtype,
    parent_id,
    is_system,
    is_active,
    description,
    normal_balance
    `
  );

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query.order('account_code', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as CoaTreeRow[];
}

/**
 * Fetch general ledger entries for a specific account and date range.
 * Uses the general_ledger view to get detailed debit/credit entries.
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

  if (error) throw new Error(error.message);
  return (data ?? []) as GeneralLedgerRow[];
}
