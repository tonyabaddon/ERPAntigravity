/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase } from '../supabaseClient';

/**
 * Input for recording a piutang (accounts receivable) payment.
 */
export interface PiutangPaymentInput {
  orderId: string;
  cashAccountId: string;
  proofUrl: string | null;
  verifiedByUserId: string;
  /** F-11: partial-payment amount. Omit / null → full close (backward-compatible). */
  amount?: number | null;
}

/**
 * Result from recording a piutang payment.
 */
export interface PiutangPaymentResult {
  ok: true;
  order_id: string;
  je_entry_id: string | null;
  /** F-11: amount actually posted this call. */
  amount_paid?: number;
  piutang_paid_amount?: number;
  outstanding_after?: number;
  full_close?: boolean;
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
 * Record a piutang payment with dual-write journal entry.
 * Debits the cash account and credits piutang, updating order payment status.
 *
 * @param input - Payment details including orderId, cashAccountId, proofUrl, verifiedByUserId
 * @returns PiutangPaymentResult with ok flag, order_id, and optional je_entry_id
 * @throws Error if order not found, validation fails, or RPC fails
 */
export async function recordPiutangPayment(input: PiutangPaymentInput): Promise<PiutangPaymentResult> {
  const sb = requireSupabase();

  const { data, error } = await sb.rpc('record_piutang_payment', {
    p_order_id: input.orderId,
    p_cash_account_id: input.cashAccountId,
    p_proof_url: input.proofUrl,
    p_verified_by_user_id: input.verifiedByUserId,
    // F-11: partial payment. Omit / null → RPC treats as full close for
    // backward compatibility with pre-fix callers.
    p_amount: input.amount ?? null,
  });

  if (error) throw new Error(error.message);

  return (data as { ok: true; order_id: string; je_entry_id: string | null }) as PiutangPaymentResult;
}
