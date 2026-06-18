import { describe, test, expect, vi } from 'vitest';

vi.mock('../supabaseClient', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: { ok: true, new_version: 2, new_sub_stage: '2c' }, error: null }),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  },
}));

import { transitionOrder } from './mutations';

describe('mutations', () => {
  test('transitionOrder returns success result', async () => {
    const r = await transitionOrder({ id: 'o1', fromSubStage: '2b', toSubStage: '2c', expectedVersion: 1 });
    expect(r.ok).toBe(true);
    expect(r.newVersion).toBe(2);
    expect(r.newSubStage).toBe('2c');
  });
});
