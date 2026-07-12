// Types for supplier claims feature (Item #1 rev 3).
// Mirrors DB CHECK constraints on supplier_claims + supplier_claim_events.

export type ClaimStatus =
  | 'AWAITING_OWNER_DECISION'
  | 'DISPOSED'
  | 'PENDING'
  | 'RESOLVED_REPLACED'
  | 'RESOLVED_CREDITED'
  | 'RESOLVED_CASHED'
  | 'REJECTED';

export type ClaimSourceType = 'PO_RECEIPT' | 'STOCK_OPNAME' | 'STOCK_ADJUSTMENT';

export type OwnerDecision = 'DISPOSE' | 'KLAIM';

export type ClaimOutcome = 'REPLACED' | 'CREDITED' | 'CASHED' | 'REJECTED';

export type ClaimEventType =
  | 'CREATED'
  | 'OWNER_DECIDED_DISPOSE'
  | 'OWNER_DECIDED_KLAIM'
  | 'APPROVAL_REQUESTED'
  | 'APPROVAL_GRANTED'
  | 'RESOLVED'
  | 'VOIDED';

export interface SupplierClaimRow {
  id: string; // UUID
  sku: string;
  warehouse: 'atas' | 'bawah';
  qty: number;
  unitCost: number;
  bookValue: number;
  status: ClaimStatus;
  sourceType: ClaimSourceType;
  sourceRefId: string;
  supplierId: string | null;
  supplierName: string | null;
  damageNotes: string | null;
  evidenceUrls: string[] | null;
  createdAt: string;
  ownerDecisionAt: string | null;
  resolvedAt: string | null;
  resolutionAmount: number | null;
}

export interface SupplierClaimDetail {
  claim: {
    id: string;
    tenant_id: string;
    supplier_id: string | null;
    sku: string;
    warehouse: string;
    qty: number;
    unit_cost: number;
    currency_code: string;
    source_type: ClaimSourceType;
    source_ref_id: string;
    damage_notes: string | null;
    evidence_urls: string[] | null;
    status: ClaimStatus;
    owner_decision_at: string | null;
    owner_decided_by: string | null;
    owner_decision_notes: string | null;
    resolution_amount: number | null;
    resolution_target_id: string | null;
    resolved_at: string | null;
    resolved_by: string | null;
    resolution_journal_id: string | null;
    resolution_notes: string | null;
    approval_request_id: number | null;
    create_journal_id: string | null;
    created_at: string;
    created_by: string;
  };
  supplier: { id: string; name: string; phone: string | null } | null;
  book_value: number;
}

export interface ClaimEventRow {
  id: number;
  eventType: ClaimEventType;
  actorUserId: string | null;
  payload: Record<string, unknown> | null;
  journalEntryId: string | null;
  at: string;
}

export interface ListSupplierClaimsFilter {
  status?: ClaimStatus[];
  supplierId?: string;
  sourceType?: ClaimSourceType[];
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string;
  pageSize?: number;
  offset?: number;
}

export interface RecordOpnameDamageInput {
  sessionId: number;
  sku: string;
  warehouse: 'atas' | 'bawah';
  damagedQty: number;
  notes?: string;
  evidenceUrls?: string[];
}

export interface DecideSupplierClaimInput {
  claimId: string;
  decision: OwnerDecision;
  supplierId?: string; // required when decision='KLAIM'
  notes?: string;
}

export interface ResolveSupplierClaimInput {
  claimId: string;
  outcome: ClaimOutcome;
  resolutionAmount?: number;
  resolutionTargetId?: string; // AP invoice UUID for CREDITED, account code for CASHED
  notes?: string;
  evidenceUrls?: string[];
}
