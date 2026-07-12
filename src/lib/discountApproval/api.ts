import { supabase } from '../supabaseClient';
import type {
  DiscountGateResult,
  RequestDiscountApprovalInput,
  LinkSaleToApprovalInput,
  UpsertApprovalSettingsInput,
} from './types';

export async function checkDiscountGate(
  discountAmountRp: number,
  subtotalRp: number,
): Promise<DiscountGateResult> {
  const { data, error } = await supabase.rpc('check_kasir_discount_gate', {
    p_discount_amount_rp: discountAmountRp,
    p_subtotal_rp: subtotalRp,
  });
  if (error) throw error;
  return data as DiscountGateResult;
}

/**
 * Request owner approval for a discount above threshold. Returns the new
 * approval_request id, or -1 if the caller is bypass-eligible (owner with
 * requestor_bypass_self=true) — in that case, admin proceeds normally
 * without a request row.
 */
export async function requestDiscountApproval(
  input: RequestDiscountApprovalInput,
): Promise<number> {
  const { data, error } = await supabase.rpc('request_kasir_discount_approval', {
    p_discount_amount_rp: input.discountAmountRp,
    p_discount_type: input.discountType,
    p_discount_value: input.discountValue,
    p_subtotal_rp: input.subtotalRp,
    p_reason: input.reason,
  });
  if (error) throw error;
  return data as number;
}

/**
 * Link a sale row to an approved discount request for audit trail.
 * Called by frontend AFTER existing record_kasir_sale succeeds.
 * Idempotent.
 */
export async function linkSaleToApproval(input: LinkSaleToApprovalInput): Promise<void> {
  const { error } = await supabase.rpc('link_kasir_sale_to_approval', {
    p_sale_id: input.saleId,
    p_request_id: input.requestId,
  });
  if (error) throw error;
}

/**
 * Admin (or Owner) cancels a pending discount approval request.
 * On success, the request transitions to `expired` with decision_channel
 * `canceled_by_user` (distinguishes from time-based auto-expire).
 */
export async function cancelDiscountRequest(requestId: number): Promise<void> {
  const { error } = await supabase.rpc('cancel_kasir_discount_request', {
    p_request_id: requestId,
  });
  if (error) throw error;
}

/**
 * Upsert an approval_settings row per (tenant, request_type) with full
 * 7-knob config. Rejects verification_method='WA_BUTTON'.
 */
export async function upsertApprovalSettings(
  input: UpsertApprovalSettingsInput,
): Promise<void> {
  const { error } = await supabase.rpc('upsert_approval_settings', {
    p_request_type: input.requestType,
    p_approval_required: input.approvalRequired,
    p_verification_method: input.verificationMethod,
    p_threshold_amount: input.thresholdAmount ?? null,
    p_threshold_percent: input.thresholdPercent ?? null,
    p_threshold_qty: input.thresholdQty ?? null,
    p_approver_role: input.approverRole ?? 'Owner',
    p_requestor_bypass_self: input.requestorBypassSelf ?? false,
    p_reason_required: input.reasonRequired ?? false,
  });
  if (error) throw error;
}

/**
 * Subscribe to real-time status changes on an approval_requests row.
 * Calls onStatusChange whenever the row's status changes. Returns
 * unsubscribe fn.
 */
export function subscribeToApprovalRequest(
  requestId: number,
  onStatusChange: (newStatus: string) => void,
): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`approval_request_${requestId}`)
    .on(
      'postgres_changes' as unknown as 'system',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'approval_requests',
        filter: `id=eq.${requestId}`,
      } as unknown as { event: string },
      (payload: { new?: { status?: string } }) => {
        const newStatus = payload.new?.status;
        if (newStatus) onStatusChange(newStatus);
      },
    )
    .subscribe();
  return () => {
    void channel.unsubscribe();
  };
}
