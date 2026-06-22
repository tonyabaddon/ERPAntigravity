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
 * Also merges in coa_account_id and account_code from cash_accounts +
 * chart_of_accounts so the UI can display COA codes on account cards.
 * @returns Array of cash account balance rows (enriched with COA info)
 */
export async function fetchCashAccountBalances(): Promise<CashAccountBalance[]> {
  const sb = requireSupabase();

  // Parallel fetch: balances view + cash_accounts (for coa_account_id)
  const [balancesRes, accountsRes] = await Promise.all([
    sb.from('cash_account_balances').select('*').order('sort_order', { ascending: true }),
    sb.from('cash_accounts').select('id, coa_account_id'),
  ]);
  if (balancesRes.error) throw balancesRes.error;
  if (accountsRes.error) throw accountsRes.error;

  const balances = (balancesRes.data ?? []) as Omit<CashAccountBalance, 'coa_account_id' | 'account_code'>[];
  const accounts = (accountsRes.data ?? []) as { id: string; coa_account_id: string | null }[];

  // Build map: cash_account_id → coa_account_id
  const coaIdMap = new Map<string, string | null>();
  for (const a of accounts) {
    coaIdMap.set(a.id, a.coa_account_id);
  }

  // Collect distinct non-null coa_account_ids to look up account_code
  const coaIds = [...new Set(accounts.map(a => a.coa_account_id).filter(Boolean))] as string[];
  let codeMap = new Map<string, string>();
  if (coaIds.length > 0) {
    const { data: coaRows, error: coaErr } = await sb
      .from('chart_of_accounts')
      .select('id, account_code')
      .in('id', coaIds);
    if (!coaErr && coaRows) {
      for (const row of coaRows as { id: string; account_code: string }[]) {
        codeMap.set(row.id, row.account_code);
      }
    }
  }

  return balances.map(b => {
    const coaId = coaIdMap.get(b.cash_account_id) ?? null;
    const accountCode = coaId ? (codeMap.get(coaId) ?? null) : null;
    return { ...b, coa_account_id: coaId, account_code: accountCode };
  });
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
