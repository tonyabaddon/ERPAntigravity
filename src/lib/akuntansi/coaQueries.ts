/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase } from '../supabaseClient';

/**
 * Chart of Accounts dropdown option.
 * Used by modal pickers for account selection.
 */
export interface CoaOption {
  id: string;
  account_code: string;
  account_name: string;
  account_type?: string;
  account_subtype?: string | null;
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
 * Fetch active beban categories (BEBAN_OPERASIONAL subtype).
 * Used by ManualExpenseModal "Kategori Beban" dropdown.
 * Sorted by account_code ASC.
 * @returns Array of beban category options
 */
export async function fetchBebanCategories(): Promise<CoaOption[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('chart_of_accounts')
    .select('id, account_code, account_name')
    .eq('account_type', 'BEBAN')
    .eq('account_subtype', 'BEBAN_OPERASIONAL')
    .eq('is_active', true)
    .order('account_code', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as CoaOption[];
}

/**
 * Fetch active counterpart accounts for balance adjustment.
 * Returns PENDAPATAN + BEBAN accounts (excluding parent/group accounts).
 * Parent accounts are identified by NULL account_subtype.
 * Sorted by account_type, then account_code ASC.
 * Used by BalanceAdjustmentModal counterpart picker.
 * @returns Array of adjustment counterpart options
 */
export async function fetchAdjustmentCounterparts(): Promise<CoaOption[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('chart_of_accounts')
    .select('id, account_code, account_name, account_type, account_subtype')
    .in('account_type', ['PENDAPATAN', 'BEBAN'])
    .eq('is_active', true)
    .not('account_subtype', 'is', null)
    .order('account_type', { ascending: true })
    .order('account_code', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as CoaOption[];
}
