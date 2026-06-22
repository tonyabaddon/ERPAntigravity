/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase } from '../supabaseClient';

/**
 * Input for updating a Chart of Accounts entry.
 */
export interface CoaUpdateInput {
  id: string;
  accountName: string;
  description: string | null;
  isActive: boolean;
}

/**
 * Result from updating a COA account.
 */
export interface CoaUpdateResult {
  ok: true;
  updated_at: string;
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
 * Update a Chart of Accounts account.
 * Allows Owner to edit account name, description, and active status.
 * System accounts cannot be deactivated.
 *
 * @param input - Update input containing id, accountName, description, isActive
 * @returns CoaUpdateResult with ok flag and updated_at timestamp
 * @throws Error if account not found, validation fails, or user is not an active Owner
 */
export async function updateCoaAccount(input: CoaUpdateInput): Promise<CoaUpdateResult> {
  const sb = requireSupabase();

  const { data, error } = await sb.rpc('update_coa_account', {
    p_id: input.id,
    p_account_name: input.accountName,
    p_description: input.description,
    p_is_active: input.isActive,
  });

  if (error) throw new Error(error.message);

  return (data as any) as CoaUpdateResult;
}
