export type DiscountGateTriggerReason = 'exceeds_amount' | 'exceeds_percent' | 'both' | null;

export type VerificationMethod = 'NONE' | 'PIN' | 'APP_INBOX';

export type DiscountApprovalStatus = 'awaiting' | 'approved' | 'rejected' | 'canceled';

export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface DiscountGateResult {
  gate_triggered: boolean;
  trigger_reason: DiscountGateTriggerReason;
  threshold_amount: number | null;
  threshold_percent: number | null;
  approval_required: boolean;
  verification_method: VerificationMethod;
}

export interface RequestDiscountApprovalInput {
  discountAmountRp: number;
  discountType: 'PERCENT' | 'AMOUNT';
  discountValue: number;
  subtotalRp: number;
  reason: string;
}

export interface LinkSaleToApprovalInput {
  saleId: string;
  requestId: number;
}

export interface UpsertApprovalSettingsInput {
  requestType: string;
  approvalRequired: boolean;
  verificationMethod: VerificationMethod;
  thresholdAmount?: number | null;
  thresholdPercent?: number | null;
  thresholdQty?: number | null;
  approverRole?: string;
  requestorBypassSelf?: boolean;
  reasonRequired?: boolean;
}
