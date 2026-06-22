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
  AccountType,
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
 * Raw line row returned from journal_entry_lines joined with journal_entries + chart_of_accounts.
 * The embedded relations may be an array or object depending on supabase-js inference.
 */
interface RawJournalLine {
  account_id: string;
  side: 'DEBIT' | 'CREDIT';
  amount: number;
  journal_entries: Array<{ entry_date: string }> | { entry_date: string } | null;
  chart_of_accounts:
    | Array<{
        id: string;
        account_code: string;
        account_name: string;
        account_type: string;
        account_subtype: string | null;
        parent_id: string | null;
        is_system: boolean;
        is_active: boolean;
        normal_balance: NormalBalance;
      }>
    | {
        id: string;
        account_code: string;
        account_name: string;
        account_type: string;
        account_subtype: string | null;
        parent_id: string | null;
        is_system: boolean;
        is_active: boolean;
        normal_balance: NormalBalance;
      }
    | null;
}

/**
 * Fetch trial balance as of a given date, filtering entries with entry_date <= asOfDate.
 * Queries journal_entry_lines directly (bypasses the all-time trial_balance view) so that
 * period selection in the UI actually changes which entries are aggregated.
 *
 * @param asOfDate - ISO date string (YYYY-MM-DD); only entries on or before this date are included
 * @returns Array of trial balance rows sorted by account code
 */
export async function fetchTrialBalanceAsOf(asOfDate: string): Promise<TrialBalanceRowWithMetadata[]> {
  const sb = requireSupabase();

  const { data, error } = await sb
    .from('journal_entry_lines')
    .select(
      `
      account_id,
      side,
      amount,
      journal_entries!inner(entry_date),
      chart_of_accounts!inner(id, account_code, account_name, account_type, account_subtype, parent_id, is_system, is_active, normal_balance)
      `,
    )
    .lte('journal_entries.entry_date', asOfDate);

  if (error) throw new Error(error.message);

  const lines = (data ?? []) as RawJournalLine[];

  // Aggregate per account_id
  type AccMap = {
    account_id: string;
    account_code: string;
    account_name: string;
    account_type: AccountType;
    account_subtype: string | null;
    normal_balance: NormalBalance;
    parent_id: string | null;
    is_system: boolean;
    is_active: boolean;
    total_debit: number;
    total_credit: number;
  };
  const accMap = new Map<string, AccMap>();

  for (const line of lines) {
    const coa = Array.isArray(line.chart_of_accounts)
      ? line.chart_of_accounts[0]
      : line.chart_of_accounts;
    if (!coa) continue;

    let acc = accMap.get(line.account_id);
    if (!acc) {
      acc = {
        account_id: line.account_id,
        account_code: coa.account_code,
        account_name: coa.account_name,
        account_type: coa.account_type as AccountType,
        account_subtype: coa.account_subtype,
        normal_balance: coa.normal_balance,
        parent_id: coa.parent_id,
        is_system: coa.is_system,
        is_active: coa.is_active,
        total_debit: 0,
        total_credit: 0,
      };
      accMap.set(line.account_id, acc);
    }

    const amount = Number(line.amount);
    if (line.side === 'DEBIT') {
      acc.total_debit += amount;
    } else {
      acc.total_credit += amount;
    }
  }

  // Build final rows with balance
  const rows: TrialBalanceRowWithMetadata[] = Array.from(accMap.values()).map(acc => {
    const balance =
      acc.normal_balance === 'DEBIT'
        ? acc.total_debit - acc.total_credit
        : acc.total_credit - acc.total_debit;
    return {
      account_id: acc.account_id,
      account_code: acc.account_code,
      account_name: acc.account_name,
      account_type: acc.account_type,
      account_subtype: acc.account_subtype,
      normal_balance: acc.normal_balance,
      total_debit: acc.total_debit,
      total_credit: acc.total_credit,
      balance,
      parent_id: acc.parent_id,
      is_system: acc.is_system,
      is_active: acc.is_active,
    };
  });

  // Sort by account_code ascending (mimic the old view behavior)
  rows.sort((a, b) => a.account_code.localeCompare(b.account_code));

  return rows;
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
