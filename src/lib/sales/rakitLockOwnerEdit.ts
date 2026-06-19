import { supabase } from '../supabaseClient';

/**
 * Owner edits an Admin-submitted rakit_lock approval request *and* approves it
 * in a single transaction. Backed by the `approve_and_amend_rakit_lock` RPC
 * (Milestone A, migration 20260619100002). Writes an `rakit_lock_approved_with_edit`
 * audit_log row that captures admin_submitted vs owner_amended diff.
 *
 * Kept in this sibling module (rather than supabaseClient.ts) so the standard
 * `vi.mock('../supabaseClient')` test idiom can intercept the `supabase` import.
 */
export async function approveAndAmendRakitLock(
  approvalId: number,
  amendedLines: Array<{
    id: string;
    final_price: number;
    tracking_mode: 'detail' | 'lumpsum';
    labor_cost: number;
    lump_sum_hpp: number;
    components?: Array<{
      sku: string;
      name: string;
      qty: number;
      warehouse: 'atas' | 'bawah';
      fifo_cost: number;
    }>;
  }>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.rpc('approve_and_amend_rakit_lock', {
    p_approval_id: approvalId,
    p_amended_lines: amendedLines,
  });
  if (error) throw error;
}
