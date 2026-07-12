import { supabase } from './supabaseClient';

export type WarehouseTransferStatus = 'IN_TRANSIT' | 'RECEIVED' | 'PARTIAL' | 'CANCELLED';

export interface WarehouseTransferHeader {
  id: number;
  doc_no: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  sender_user_id: string;
  receiver_user_id: string;
  status: WarehouseTransferStatus;
  total_qty_sent: number;
  total_qty_received: number | null;
  total_loss_qty: number | null;
  initiated_at: string;
  received_at: string | null;
  cancelled_at: string | null;
  n_items: number;
  notes?: string | null;
  cancel_reason?: string | null;
}

export interface WarehouseTransferItem {
  transfer_id: number;
  line_no: number;
  sku: string;
  qty_sent: number;
  qty_received: number | null;
  loss_qty: number | null;
  loss_movement_id: number | null;
}

export interface WarehouseTransferDetail {
  header: WarehouseTransferHeader;
  items: WarehouseTransferItem[];
}

export interface InitiateTransferInput {
  fromWarehouseId: string;
  toWarehouseId: string;
  receiverUserId: string;
  notes: string | null;
  clientRequestId: string | null;
  items: Array<{ sku: string; qty: number }>;
}

async function initiateTransfer(input: InitiateTransferInput) {
  const { data, error } = await supabase.rpc('initiate_warehouse_transfer', {
    p_from_warehouse_id: input.fromWarehouseId,
    p_to_warehouse_id:   input.toWarehouseId,
    p_receiver_user_id:  input.receiverUserId,
    p_notes:             input.notes,
    p_client_request_id: input.clientRequestId,
    p_items:             input.items,
  });
  if (error) throw error;
  return data as { transfer_id: number; doc_no: string; idempotent: boolean };
}

async function receiveTransfer(
  transferId: number,
  items: Array<{ sku: string; qty_received: number }>,
) {
  const { data, error } = await supabase.rpc('receive_warehouse_transfer', {
    p_transfer_id: transferId, p_items: items,
  });
  if (error) throw error;
  return data as { status: WarehouseTransferStatus; total_loss_qty: number };
}

async function cancelTransfer(transferId: number, reason: string) {
  const { data, error } = await supabase.rpc('cancel_warehouse_transfer', {
    p_transfer_id: transferId, p_reason: reason,
  });
  if (error) throw error;
  return data as { status: 'CANCELLED' };
}

export interface ListFilters {
  statusFilter?: WarehouseTransferStatus[] | null;
  warehouseId?: string | null;
  search?: string | null;
  since?: string | null;
  limit?: number;
  cursor?: number | null;
}

async function listTransfers(filters: ListFilters = {}) {
  const { data, error } = await supabase.rpc('list_warehouse_transfers', {
    p_status_filter: filters.statusFilter ?? null,
    p_warehouse_id:  filters.warehouseId ?? null,
    p_search:        filters.search ?? null,
    p_since:         filters.since ?? null,
    p_limit:         filters.limit ?? 50,
    p_cursor:        filters.cursor ?? null,
  });
  if (error) throw error;
  return (data ?? []) as WarehouseTransferHeader[];
}

async function getTransferDetail(id: number): Promise<WarehouseTransferDetail | null> {
  const { data, error } = await supabase.rpc('get_warehouse_transfer_detail', { p_transfer_id: id });
  if (error) throw error;
  return data as WarehouseTransferDetail | null;
}

async function getInTransitByWarehouse(warehouseId: string) {
  const { data, error } = await supabase.rpc('get_in_transit_by_warehouse', { p_warehouse_id: warehouseId });
  if (error) throw error;
  return (data ?? []) as Array<{ sku: string; in_transit_qty: number }>;
}

export const warehouseTransferService = {
  initiateTransfer,
  receiveTransfer,
  cancelTransfer,
  listTransfers,
  getTransferDetail,
  getInTransitByWarehouse,
};
