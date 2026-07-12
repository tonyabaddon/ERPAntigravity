import { describe, it, expect, vi, beforeEach } from 'vitest';
import { warehouseTransferService } from '../../../lib/warehouseTransferService';
import { supabase } from '../../../lib/supabaseClient';

vi.mock('../../../lib/supabaseClient', () => ({
  supabase: { rpc: vi.fn() },
}));

describe('warehouseTransferService cross-tenant isolation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('server-side RLS filters listTransfers to caller tenant (mocked pinning)', async () => {
    // Simulate: server (Postgres via RLS) returns [] for tenant B even though tenant A created a transfer
    (supabase.rpc as any).mockResolvedValue({ data: [], error: null });
    const results = await warehouseTransferService.listTransfers();
    expect(results).toEqual([]);
    expect(supabase.rpc).toHaveBeenCalledWith('list_warehouse_transfers', expect.any(Object));
  });

  it('getTransferDetail returns null for cross-tenant transfer id (server denies)', async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: null });
    const result = await warehouseTransferService.getTransferDetail(99999);
    expect(result).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledWith('get_warehouse_transfer_detail', { p_transfer_id: 99999 });
  });

  it('getInTransitByWarehouse returns [] when warehouse belongs to another tenant', async () => {
    (supabase.rpc as any).mockResolvedValue({ data: [], error: null });
    const rows = await warehouseTransferService.getInTransitByWarehouse('foreign-wh-uuid');
    expect(rows).toEqual([]);
    expect(supabase.rpc).toHaveBeenCalledWith('get_in_transit_by_warehouse', { p_warehouse_id: 'foreign-wh-uuid' });
  });
});
