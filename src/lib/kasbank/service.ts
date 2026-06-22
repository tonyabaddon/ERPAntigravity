/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase } from '../supabaseClient';
import type {
  CashAccount,
  CashAccountBalance,
  CashAccountInput,
} from './types';
import { fetchGeneralLedger } from '../akuntansi/service';
import type { GeneralLedgerRow } from '../akuntansi/types';

/**
 * Ensures Supabase client is configured.
 * @throws Error if Supabase is not configured
 */
function requireSupabase() {
  if (!supabase) throw new Error('Supabase not configured');
  return supabase;
}

/**
 * Fetch all cash accounts ordered by sort_order.
 * @returns Array of cash accounts
 */
export async function fetchCashAccounts(): Promise<CashAccount[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('cash_accounts')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CashAccount[];
}

/**
 * Fetch all cash account balances from the view, ordered by sort_order.
 * @returns Array of cash account balance rows
 */
export async function fetchCashAccountBalances(): Promise<CashAccountBalance[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('cash_account_balances')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CashAccountBalance[];
}

/**
 * Create a new cash account.
 * @param input - Cash account input data
 * @returns Created cash account
 */
export async function createCashAccount(input: CashAccountInput): Promise<CashAccount> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('cash_accounts')
    .insert([input])
    .select()
    .single();
  if (error) throw error;
  return data as CashAccount;
}

/**
 * Update an existing cash account.
 * @param id - Cash account ID
 * @param patch - Partial update data
 * @returns Updated cash account
 */
export async function updateCashAccount(
  id: string,
  patch: Partial<CashAccountInput>,
): Promise<CashAccount> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('cash_accounts')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as CashAccount;
}

/**
 * Fetch account ledger for a specific cash account within date range.
 * Delegates to fetchGeneralLedger from akuntansi service.
 * @param coaAccountId - Chart of accounts account ID
 * @param fromDate - Start date (YYYY-MM-DD)
 * @param toDate - End date (YYYY-MM-DD)
 * @returns Array of general ledger entries
 */
export async function fetchAccountLedger(
  coaAccountId: string,
  fromDate: string,
  toDate: string,
): Promise<GeneralLedgerRow[]> {
  return fetchGeneralLedger(coaAccountId, fromDate, toDate);
}
