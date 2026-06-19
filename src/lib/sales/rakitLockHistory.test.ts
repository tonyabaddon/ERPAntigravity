import { describe, test, expect, vi, beforeEach } from 'vitest';

const { fromSpy } = vi.hoisted(() => ({ fromSpy: vi.fn() }));
vi.mock('../supabaseClient', () => ({
  supabase: { from: (table: string) => fromSpy(table) },
}));

import { fetchRakitLockHistory } from './queries';

function mockChain(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
  };
}

describe('fetchRakitLockHistory', () => {
  beforeEach(() => { fromSpy.mockReset(); });

  test('returns events for the given order in DESC time order', async () => {
    fromSpy.mockReturnValueOnce(mockChain([
      { event_type: 'rakit_lock_approved_with_edit', actor_user_id: 'u1', created_at: '2026-06-18T15:00:00Z',
        payload: { order_id: 'ord-1', admin_submitted: { foo: 1 }, owner_amended: { foo: 2 }, diff_keys: ['foo'] } },
      { event_type: 'rakit_lock_requested', actor_user_id: 'u2', created_at: '2026-06-18T10:00:00Z',
        payload: { order_id: 'ord-1', admin_submitted: { foo: 1 } } },
    ]));
    const events = await fetchRakitLockHistory('ord-1');
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('approved_with_edit');
    expect(events[1].type).toBe('requested');
    if (events[0].type === 'approved_with_edit') {
      expect(events[0].diff_keys).toEqual(['foo']);
    }
  });

  test('filters out events for other orders', async () => {
    fromSpy.mockReturnValueOnce(mockChain([
      { event_type: 'rakit_lock_requested', actor_user_id: 'u1', created_at: '2026-06-18T10:00:00Z',
        payload: { order_id: 'ord-1', admin_submitted: {} } },
      { event_type: 'rakit_lock_requested', actor_user_id: 'u1', created_at: '2026-06-18T11:00:00Z',
        payload: { order_id: 'ord-2', admin_submitted: {} } },
    ]));
    const events = await fetchRakitLockHistory('ord-1');
    expect(events).toHaveLength(1);
  });

  test('maps rejected event with reason', async () => {
    fromSpy.mockReturnValueOnce(mockChain([
      { event_type: 'rakit_lock_rejected', actor_user_id: 'u1', created_at: '2026-06-18T12:00:00Z',
        payload: { order_id: 'ord-1', reason: 'Margin tipis' } },
    ]));
    const events = await fetchRakitLockHistory('ord-1');
    expect(events).toHaveLength(1);
    if (events[0].type === 'rejected') {
      expect(events[0].reason).toBe('Margin tipis');
    }
  });

  test('returns empty array on supabase error', async () => {
    fromSpy.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: (resolve: (v: { data: null; error: { message: string } }) => void) =>
        resolve({ data: null, error: { message: 'boom' } }),
    });
    const events = await fetchRakitLockHistory('ord-1');
    expect(events).toEqual([]);
  });
});
