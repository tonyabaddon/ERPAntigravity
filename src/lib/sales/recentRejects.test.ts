import { describe, test, expect, vi, beforeEach } from 'vitest';

const { fromSpy } = vi.hoisted(() => ({ fromSpy: vi.fn() }));
vi.mock('../supabaseClient', () => ({
  supabase: { from: (table: string) => fromSpy(table) },
}));

import { fetchRecentRejectsByOrder } from './recentRejects';

function mockChain(rows: unknown[]) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
  };
  return chain;
}

describe('fetchRecentRejectsByOrder', () => {
  beforeEach(() => { fromSpy.mockReset(); });

  test('returns empty map when orderIds is empty (no query fired)', async () => {
    const result = await fetchRecentRejectsByOrder([]);
    expect(result).toEqual({});
    expect(fromSpy).not.toHaveBeenCalled();
  });

  test('returns empty map when no rejects found', async () => {
    fromSpy.mockReturnValueOnce(mockChain([]));
    const result = await fetchRecentRejectsByOrder(['order-1', 'order-2']);
    expect(result).toEqual({});
    expect(fromSpy).toHaveBeenCalledWith('audit_log');
  });

  test('returns map of most-recent reject per order', async () => {
    fromSpy.mockReturnValueOnce(mockChain([
      { actor_user_id: 'u1', created_at: '2026-06-18T10:00:00Z', payload: { order_id: 'order-1', reason: 'Margin tipis' } },
      { actor_user_id: 'u1', created_at: '2026-06-15T10:00:00Z', payload: { order_id: 'order-1', reason: 'Earlier reject' } },
      { actor_user_id: 'u2', created_at: '2026-06-17T10:00:00Z', payload: { order_id: 'order-2', reason: 'Cek labor' } },
    ]));
    const result = await fetchRecentRejectsByOrder(['order-1', 'order-2', 'order-3']);
    expect(result['order-1']?.reason).toBe('Margin tipis');
    expect(result['order-1']?.rejected_at).toBe('2026-06-18T10:00:00Z');
    expect(result['order-2']?.reason).toBe('Cek labor');
    expect(result['order-3']).toBeUndefined();
  });

  test('ignores rejects for orders not in the requested list', async () => {
    fromSpy.mockReturnValueOnce(mockChain([
      { actor_user_id: 'u1', created_at: '2026-06-18T10:00:00Z', payload: { order_id: 'unrelated-99', reason: 'X' } },
    ]));
    const result = await fetchRecentRejectsByOrder(['order-1']);
    expect(result).toEqual({});
  });
});
