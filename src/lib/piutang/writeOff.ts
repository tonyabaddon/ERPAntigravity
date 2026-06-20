import { supabase } from '../supabaseClient';

/**
 * Phase 1C task 2 — Piutang write-off RPC wrappers.
 *
 * Kept in a sibling module (rather than supabaseClient.ts) so the standard
 * `vi.mock('../supabaseClient')` test idiom can intercept the `supabase`
 * import. Mirrors src/lib/sales/rakitLockOwnerEdit.ts.
 *
 * Most wrappers re-throw RPC errors with the raised prefix intact so
 * consumers can pattern-match on prefixes like `ORDER_NOT_TEMPO:`,
 * `OWNER_ONLY:`, `WRITE_OFF_ALREADY_PENDING:`, `NOT_WRITTEN_OFF:`.
 *
 * approve_tempo_write_off returns a discriminated JSONB result (status code)
 * because PL/pgSQL rolls back in-function writes when the function raises,
 * which would break the atomic auto-reject + audit pattern on the race
 * branch.
 */

export async function requestTempoWriteOff(
  orderId: string,
  reason: string,
): Promise<{ approval_id: number }> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.rpc('request_tempo_write_off', {
    p_order_id: orderId,
    p_reason: reason,
  });
  if (error) throw error;
  return { approval_id: data as number };
}

export type ApproveTempoWriteOffResult =
  | { status: 'approved' }
  | { status: 'auto_rejected_race'; new_order_status: string };

export async function approveTempoWriteOff(
  approvalId: number,
): Promise<ApproveTempoWriteOffResult> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.rpc('approve_tempo_write_off', {
    p_approval_id: approvalId,
  });
  if (error) throw error;
  return data as ApproveTempoWriteOffResult;
}

export async function rejectTempoWriteOff(
  approvalId: number,
  reason: string,
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.rpc('reject_tempo_write_off', {
    p_approval_id: approvalId,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function revertTempoWriteOff(orderId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.rpc('revert_tempo_write_off', {
    p_order_id: orderId,
  });
  if (error) throw error;
}
