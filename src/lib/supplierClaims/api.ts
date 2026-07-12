// Supplier claims API client (Item #1 rev 3).
// Wraps supabase.rpc() calls for the supplier_claims backend.

import { supabase } from '../supabaseClient';
import type {
  SupplierClaimRow,
  SupplierClaimDetail,
  ClaimEventRow,
  ListSupplierClaimsFilter,
  RecordOpnameDamageInput,
  DecideSupplierClaimInput,
  ResolveSupplierClaimInput,
  ClaimStatus,
} from './types';

interface RpcRow_ListClaim {
  id: string;
  sku: string;
  warehouse: string;
  qty: number;
  unit_cost: number;
  book_value: number;
  status: ClaimStatus;
  source_type: SupplierClaimRow['sourceType'];
  source_ref_id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  damage_notes: string | null;
  evidence_urls: string[] | null;
  created_at: string;
  owner_decision_at: string | null;
  resolved_at: string | null;
  resolution_amount: number | null;
}

function rowToClaim(r: RpcRow_ListClaim): SupplierClaimRow {
  return {
    id: r.id,
    sku: r.sku,
    warehouse: (r.warehouse === 'bawah' ? 'bawah' : 'atas') as 'atas' | 'bawah',
    qty: r.qty,
    unitCost: Number(r.unit_cost),
    bookValue: Number(r.book_value),
    status: r.status,
    sourceType: r.source_type,
    sourceRefId: r.source_ref_id,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    damageNotes: r.damage_notes,
    evidenceUrls: r.evidence_urls,
    createdAt: r.created_at,
    ownerDecisionAt: r.owner_decision_at,
    resolvedAt: r.resolved_at,
    resolutionAmount: r.resolution_amount == null ? null : Number(r.resolution_amount),
  };
}

/**
 * List supplier claims for the current tenant, filtered.
 */
export async function listSupplierClaims(
  filter: ListSupplierClaimsFilter = {},
): Promise<SupplierClaimRow[]> {
  const { data, error } = await supabase.rpc('list_supplier_claims', {
    p_filter_status: filter.status ?? null,
    p_filter_supplier_id: filter.supplierId ?? null,
    p_filter_source_type: filter.sourceType ?? null,
    p_date_from: filter.dateFrom ?? null,
    p_date_to: filter.dateTo ?? null,
    p_page_size: filter.pageSize ?? 50,
    p_offset: filter.offset ?? 0,
  });
  if (error) throw error;
  return ((data ?? []) as RpcRow_ListClaim[]).map(rowToClaim);
}

/**
 * Fetch a single claim with supplier + computed book_value.
 */
export async function getSupplierClaim(claimId: string): Promise<SupplierClaimDetail> {
  const { data, error } = await supabase.rpc('get_supplier_claim', { p_claim_id: claimId });
  if (error) throw error;
  return data as SupplierClaimDetail;
}

/**
 * List audit events for a specific claim.
 */
export async function listSupplierClaimEvents(claimId: string): Promise<ClaimEventRow[]> {
  const { data, error } = await supabase.rpc('list_supplier_claim_events', { p_claim_id: claimId });
  if (error) throw error;
  interface RpcEventRow {
    id: number;
    event_type: ClaimEventRow['eventType'];
    actor_user_id: string | null;
    payload: Record<string, unknown> | null;
    journal_entry_id: string | null;
    at: string;
  }
  return ((data ?? []) as RpcEventRow[]).map((r) => ({
    id: r.id,
    eventType: r.event_type,
    actorUserId: r.actor_user_id,
    payload: r.payload,
    journalEntryId: r.journal_entry_id,
    at: r.at,
  }));
}

/**
 * Admin: flag damaged qty on an opname count row (during counting phase).
 * Setting damagedQty=0 clears the flag.
 */
export async function recordOpnameDamage(input: RecordOpnameDamageInput): Promise<void> {
  const { error } = await supabase.rpc('record_opname_damage', {
    p_session_id: input.sessionId,
    p_sku: input.sku,
    p_warehouse: input.warehouse,
    p_damaged_qty: input.damagedQty,
    p_damage_notes: input.notes ?? null,
    p_damage_evidence_urls: input.evidenceUrls ?? null,
  });
  if (error) throw error;
}

/**
 * Owner: decide Dispose or Klaim on a pending claim.
 */
export async function decideSupplierClaim(
  input: DecideSupplierClaimInput,
): Promise<{ claim_id: string; new_status: ClaimStatus; journal_id: string | null }> {
  const { data, error } = await supabase.rpc('decide_supplier_claim', {
    p_claim_id: input.claimId,
    p_decision: input.decision,
    p_supplier_id: input.supplierId ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) throw error;
  return data as { claim_id: string; new_status: ClaimStatus; journal_id: string | null };
}

/**
 * Resolve a pending klaim once supplier responds (4 outcomes).
 */
export async function resolveSupplierClaim(
  input: ResolveSupplierClaimInput,
): Promise<{
  claim_id: string;
  new_status: ClaimStatus;
  journal_id: string | null;
  book_value: number;
  variance: number | null;
}> {
  const { data, error } = await supabase.rpc('resolve_supplier_claim', {
    p_claim_id: input.claimId,
    p_outcome: input.outcome,
    p_resolution_amount: input.resolutionAmount ?? null,
    p_resolution_target_id: input.resolutionTargetId ?? null,
    p_notes: input.notes ?? null,
    p_evidence_urls: input.evidenceUrls ?? null,
  });
  if (error) throw error;
  return data as {
    claim_id: string;
    new_status: ClaimStatus;
    journal_id: string | null;
    book_value: number;
    variance: number | null;
  };
}
