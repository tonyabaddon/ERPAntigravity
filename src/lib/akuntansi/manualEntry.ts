/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase } from '../supabaseClient';

/**
 * Result returned by all manual entry RPCs.
 */
export interface PostResult {
  ok: true;
  entry_id: string;
  entry_number: string;
}

/**
 * Input for recording an internal transfer between cash accounts.
 * Supports three subtypes: TRANSFER, CASH_DEPOSIT (setor kas), WALLET_TOPUP.
 */
export interface InternalTransferInput {
  fromCashId: string;
  toCashId: string;
  amount: number;
  entryDate: string;
  notes?: string | null;
  proofUrl?: string | null;
  sourceSubtype?: 'TRANSFER' | 'CASH_DEPOSIT' | 'WALLET_TOPUP';
}

/**
 * Input for recording owner personal drawing.
 */
export interface OwnerDrawingInput {
  fromCashId: string;
  amount: number;
  entryDate: string;
  reason: string;
  personalMemo?: string | null;
}

/**
 * Direction of balance adjustment (UP = asset increases, DOWN = asset decreases).
 */
export type AdjustmentDirection = 'UP' | 'DOWN';

/**
 * Input for recording a manual balance adjustment with PIN verification.
 */
export interface BalanceAdjustmentInput {
  cashAccountId: string;
  direction: AdjustmentDirection;
  amount: number;
  counterpartCoaId: string;
  reason: string;
  pin: string;
  entryDate: string;
}

/**
 * Input for recording an e-wallet spend.
 */
export interface WalletSpendInput {
  walletCashId: string;
  bebanCoaId: string;
  amount: number;
  entryDate: string;
  orderId?: string | null;
  notes?: string | null;
}

/**
 * Input for recording a manual expense from a cash account.
 */
export interface ManualExpenseInput {
  bebanCoaId: string;
  sourceCashId: string;
  amount: number;
  entryDate: string;
  description: string;
  proofUrl?: string | null;
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
 * Record an internal transfer between two cash accounts.
 * Debit: to_cash (increase); Credit: from_cash (decrease).
 * @param input - Transfer details
 * @returns Result with entry_id and entry_number
 * @throws Error if RPC fails
 */
export async function recordInternalTransfer(
  input: InternalTransferInput,
): Promise<PostResult> {
  const sb = requireSupabase();

  const { data, error } = await sb.rpc('record_internal_transfer', {
    p_from_cash_id: input.fromCashId,
    p_to_cash_id: input.toCashId,
    p_amount: input.amount,
    p_entry_date: input.entryDate,
    p_notes: input.notes ?? null,
    p_proof_url: input.proofUrl ?? null,
    p_source_subtype: input.sourceSubtype ?? 'TRANSFER',
  });

  if (error) throw new Error(error.message);
  return data as PostResult;
}

/**
 * Record an owner personal drawing.
 * Debit: 3-1200 Prive; Credit: from_cash.
 * @param input - Drawing details
 * @returns Result with entry_id and entry_number
 * @throws Error if RPC fails
 */
export async function recordOwnerDrawing(
  input: OwnerDrawingInput,
): Promise<PostResult> {
  const sb = requireSupabase();

  const { data, error } = await sb.rpc('record_owner_drawing', {
    p_from_cash_id: input.fromCashId,
    p_amount: input.amount,
    p_entry_date: input.entryDate,
    p_reason: input.reason,
    p_personal_memo: input.personalMemo ?? null,
  });

  if (error) throw new Error(error.message);
  return data as PostResult;
}

/**
 * Record a manual balance adjustment with PIN verification.
 * UP: Debit cash / Credit counterpart.
 * DOWN: Debit counterpart / Credit cash.
 * @param input - Adjustment details including PIN
 * @returns Result with entry_id and entry_number
 * @throws Error if RPC fails or PIN is invalid
 */
export async function recordBalanceAdjustment(
  input: BalanceAdjustmentInput,
): Promise<PostResult> {
  const sb = requireSupabase();

  const { data, error } = await sb.rpc('record_balance_adjustment', {
    p_cash_account_id: input.cashAccountId,
    p_direction: input.direction,
    p_amount: input.amount,
    p_counterpart_coa_id: input.counterpartCoaId,
    p_reason: input.reason,
    p_pin: input.pin,
    p_entry_date: input.entryDate,
  });

  if (error) throw new Error(error.message);
  return data as PostResult;
}

/**
 * Record an e-wallet spend (e.g. Lalamove fee from Shopee wallet).
 * Debit: beban_coa; Credit: wallet_cash.
 * @param input - Wallet spend details
 * @returns Result with entry_id and entry_number
 * @throws Error if RPC fails
 */
export async function recordWalletSpend(
  input: WalletSpendInput,
): Promise<PostResult> {
  const sb = requireSupabase();

  const { data, error } = await sb.rpc('record_wallet_spend', {
    p_wallet_cash_id: input.walletCashId,
    p_beban_coa_id: input.bebanCoaId,
    p_amount: input.amount,
    p_entry_date: input.entryDate,
    p_order_id: input.orderId ?? null,
    p_notes: input.notes ?? null,
  });

  if (error) throw new Error(error.message);
  return data as PostResult;
}

/**
 * Record a manual expense from a cash account.
 * Debit: beban_coa; Credit: source_cash.
 * @param input - Manual expense details
 * @returns Result with entry_id and entry_number
 * @throws Error if RPC fails
 */
export async function recordManualExpense(
  input: ManualExpenseInput,
): Promise<PostResult> {
  const sb = requireSupabase();

  const { data, error } = await sb.rpc('record_manual_expense', {
    p_beban_coa_id: input.bebanCoaId,
    p_source_cash_id: input.sourceCashId,
    p_amount: input.amount,
    p_entry_date: input.entryDate,
    p_description: input.description,
    p_proof_url: input.proofUrl ?? null,
  });

  if (error) throw new Error(error.message);
  return data as PostResult;
}
