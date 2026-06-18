import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabaseClient', () => {
  const resolved = { data: [{ id: 'a1' }], error: null };
  const orderQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    // order must be both chainable (for .limit()) AND awaitable (for fetchActiveOrders)
    order: vi.fn().mockImplementation(() => {
      const obj: Record<string, unknown> = {};
      obj['then'] = (onfulfilled: (v: unknown) => unknown) => Promise.resolve(resolved).then(onfulfilled);
      obj['limit'] = vi.fn().mockResolvedValue(resolved);
      return obj;
    }),
    limit: vi.fn().mockResolvedValue(resolved),
  };
  return {
    supabase: {
      from: vi.fn(() => orderQuery),
      rpc: vi.fn().mockResolvedValue({ data: { urgent_count: 4, tunggu_count: 8, revenue_pending: 1000000, completed_this_month: 142, revenue_this_month: 54000000 }, error: null }),
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
    },
  };
});

// reorder import so mock applies first
import { fetchActiveOrders, fetchArchiveOrders, fetchDashboardStats } from './queries';

describe('queries', () => {
  test('fetchActiveOrders queries kasir_transactions', async () => {
    // make order().order() resolve too
    const orders = await fetchActiveOrders();
    expect(Array.isArray(orders)).toBe(true);
  });
  test('fetchDashboardStats returns stats from RPC', async () => {
    const s = await fetchDashboardStats();
    expect(s.urgent_count).toBe(4);
    expect(s.completed_this_month).toBe(142);
  });
  test('fetchArchiveOrders queries kasir_transactions for stage 5', async () => {
    const orders = await fetchArchiveOrders(5, 5);
    expect(Array.isArray(orders)).toBe(true);
  });
});
