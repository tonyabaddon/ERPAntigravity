import { describe, it, expect, vi, beforeEach } from 'vitest';
import { warehouseTransferService } from '../../../lib/warehouseTransferService';
import { supabase } from '../../../lib/supabaseClient';

vi.mock('../../../lib/supabaseClient', () => ({
  supabase: { rpc: vi.fn() },
}));

describe('warehouseTransferService.initiateTransfer', () => {
  beforeEach(() => vi.clearAllMocks());
  it('calls RPC with mapped params and returns typed result', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: { transfer_id: 42, doc_no: 'TR-2026-07-001', idempotent: false }, error: null });
    const r = await warehouseTransferService.initiateTransfer({
      fromWarehouseId: 'wh-a', toWarehouseId: 'wh-b',
      receiverUserId: 'u-1', notes: 'test', clientRequestId: 'req-1',
      items: [{ sku: 'S1', qty: 5 }],
    });
    expect(supabase.rpc).toHaveBeenCalledWith('initiate_warehouse_transfer', {
      p_from_warehouse_id: 'wh-a', p_to_warehouse_id: 'wh-b',
      p_receiver_user_id: 'u-1', p_notes: 'test', p_client_request_id: 'req-1',
      p_items: [{ sku: 'S1', qty: 5 }],
    });
    expect(r).toEqual({ transfer_id: 42, doc_no: 'TR-2026-07-001', idempotent: false });
  });
  it('surfaces RPC error message', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: null, error: { code: 'P0001', message: 'TRANSFER_INSUFFICIENT_STOCK: sku=S1 tersedia=2 diminta=5' } });
    await expect(warehouseTransferService.initiateTransfer({
      fromWarehouseId: 'wh-a', toWarehouseId: 'wh-b', receiverUserId: 'u-1',
      notes: null, clientRequestId: null, items: [{ sku: 'S1', qty: 5 }],
    })).rejects.toMatchObject({ code: 'P0001', message: expect.stringContaining('TRANSFER_INSUFFICIENT_STOCK') });
  });
});
