/**
 * Wrappers for the Wave 6 payment verification RPCs.
 *
 * verify_payment(p_payment_id)        — super_admin only; PENDING → VERIFIED
 * reject_payment(p_payment_id, reason) — super_admin only; PENDING → REJECTED
 * list_pending_payments()              — platform_admin+; returns joined shape
 *
 * Error codes:
 *   P0403 SUPER_ADMIN_REQUIRED      → SuperAdminRequiredError
 *   P0403 PLATFORM_ADMIN_REQUIRED   → PlatformAdminRequiredError
 *   P0409 PAYMENT_NOT_PENDING       → PaymentNotPendingError
 *   P0002 PAYMENT_NOT_FOUND         → PaymentNotFoundError (re-mapped from P0002)
 */

import { supabase } from './supabaseClient';
import {
  SuperAdminRequiredError,
  PlatformAdminRequiredError,
  PaymentNotFoundError,
  PaymentNotPendingError,
} from './adminTypes';

// ─── Internal helpers ─────────────────────────────────────────────────────────

function normalizeRpcError(error: { message?: string; code?: string }): never {
  if (error.code === 'P0403') {
    if (error.message === 'SUPER_ADMIN_REQUIRED') {
      throw new SuperAdminRequiredError(error.message);
    }
    throw new PlatformAdminRequiredError(error.message);
  }
  if (error.code === 'P0409') {
    throw new PaymentNotPendingError(error.message);
  }
  if (error.code === 'P0002') {
    throw new PaymentNotFoundError(error.message);
  }
  throw new Error(error.message ?? 'RPC error');
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface PendingPayment {
  id: string;
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  amount: number;
  payment_method: string;
  payment_date: string;
  proof_url: string | null;
  bank_reference: string | null;
  notes: string | null;
  amount_anomaly: boolean;
  created_at: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const paymentVerificationApi = {
  /**
   * List all PENDING_VERIFICATION payments via the SECDEF list_pending_payments() RPC.
   * Requires platform_admin minimum. Ordered by created_at DESC.
   *
   * @throws PlatformAdminRequiredError  when caller is not a platform admin
   */
  async listPending(): Promise<PendingPayment[]> {
    if (!supabase) throw new Error('Supabase client not configured');
    const { data, error } = await supabase.rpc('list_pending_payments');
    if (error) normalizeRpcError(error);
    return (data ?? []) as PendingPayment[];
  },

  /**
   * Verify a payment (PENDING_VERIFICATION → VERIFIED).
   * Requires super_admin. Emits VERIFY_PAYMENT audit event.
   *
   * @throws SuperAdminRequiredError  when caller is not super_admin (P0403)
   * @throws PaymentNotFoundError     when payment UUID does not exist (P0002)
   * @throws PaymentNotPendingError   when payment is not PENDING_VERIFICATION (P0409)
   */
  async verify(paymentId: string): Promise<void> {
    if (!supabase) throw new Error('Supabase client not configured');
    const { error } = await supabase.rpc('verify_payment', {
      p_payment_id: paymentId,
    });
    if (error) normalizeRpcError(error);
  },

  /**
   * Reject a payment (PENDING_VERIFICATION → REJECTED).
   * Requires super_admin. Emits REJECT_PAYMENT audit event with rejection_reason.
   *
   * @throws SuperAdminRequiredError  when caller is not super_admin (P0403)
   * @throws PaymentNotFoundError     when payment UUID does not exist (P0002)
   * @throws PaymentNotPendingError   when payment is not PENDING_VERIFICATION (P0409)
   */
  async reject(paymentId: string, reason: string): Promise<void> {
    if (!supabase) throw new Error('Supabase client not configured');
    const { error } = await supabase.rpc('reject_payment', {
      p_payment_id: paymentId,
      p_reason: reason,
    });
    if (error) normalizeRpcError(error);
  },
};
