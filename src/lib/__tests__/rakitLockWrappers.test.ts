import { describe, test, expect, vi, beforeEach } from 'vitest';

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));
vi.mock('../supabaseClient', () => ({
  supabase: { rpc: mockRpc },
}));

import { approveAndAmendRakitLock } from '../sales/rakitLockOwnerEdit';

describe('approveAndAmendRakitLock', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  test('calls approve_and_amend_rakit_lock with correct params', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await approveAndAmendRakitLock(42, [{
      id: 'line-1',
      final_price: 8500000,
      tracking_mode: 'detail',
      labor_cost: 1000000,
      lump_sum_hpp: 0,
    }]);
    expect(mockRpc).toHaveBeenCalledWith('approve_and_amend_rakit_lock', {
      p_approval_id: 42,
      p_amended_lines: [{
        id: 'line-1',
        final_price: 8500000,
        tracking_mode: 'detail',
        labor_cost: 1000000,
        lump_sum_hpp: 0,
      }],
    });
  });

  test('throws on rpc error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'OWNER_ONLY' } });
    await expect(approveAndAmendRakitLock(42, [])).rejects.toMatchObject({ message: 'OWNER_ONLY' });
  });
});
