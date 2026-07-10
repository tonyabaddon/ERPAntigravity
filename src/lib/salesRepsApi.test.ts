// src/lib/salesRepsApi.test.ts
// Unit tests for salesRepsApi typed wrappers.
// Mocks supabase client; no network calls.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salesRepsApi } from './salesRepsApi';
import {
  PlatformAdminRequiredError,
  SuperAdminRequiredError,
  TenantNotFoundError,
  InvalidFilterError,
} from './adminTypes';

// ─── Mock supabaseClient ──────────────────────────────────────────────────────
// vi.hoisted ensures the mock factory runs before module-level import resolution.
const { mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock('./supabaseClient', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';

const sampleRow = {
  user_id: USER_ID,
  email: 'rep@example.com',
  name: 'Alice Rep',
  role: 'sales_rep' as const,
  status: 'active' as const,
  created_at: '2026-07-10T00:00:00Z',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a fluent .from().select()…order() chain mock that resolves with the given result. */
function makeFromChain(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
  };
  mockFrom.mockReturnValue(chain);
  return chain;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('salesRepsApi.list', () => {
  it('happy path — returns SalesRep[] on success', async () => {
    makeFromChain({ data: [sampleRow], error: null });
    const result = await salesRepsApi.list();
    expect(result).toHaveLength(1);
    expect(result[0].user_id).toBe(USER_ID);
    expect(result[0].role).toBe('sales_rep');
    expect(mockFrom).toHaveBeenCalledWith('platform_admins');
  });

  it('returns empty array when no sales reps exist', async () => {
    makeFromChain({ data: [], error: null });
    const result = await salesRepsApi.list();
    expect(result).toEqual([]);
  });

  it('propagates P0403 as PlatformAdminRequiredError', async () => {
    makeFromChain({ data: null, error: { code: 'P0403', message: 'PLATFORM_ADMIN_REQUIRED' } });
    await expect(salesRepsApi.list()).rejects.toBeInstanceOf(PlatformAdminRequiredError);
  });
});

describe('salesRepsApi.create', () => {
  it('happy path — returns synthetic SalesRep on success', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const result = await salesRepsApi.create(USER_ID, 'rep@example.com', 'Alice Rep');
    expect(result.user_id).toBe(USER_ID);
    expect(result.role).toBe('sales_rep');
    expect(result.status).toBe('active');
    expect(mockRpc).toHaveBeenCalledWith('create_sales_rep', {
      p_user_id: USER_ID,
      p_email: 'rep@example.com',
      p_name: 'Alice Rep',
    });
  });

  it('propagates P0403 SUPER_ADMIN_REQUIRED as SuperAdminRequiredError', async () => {
    mockRpc.mockResolvedValue({ error: { code: 'P0403', message: 'SUPER_ADMIN_REQUIRED' } });
    await expect(salesRepsApi.create(USER_ID, 'rep@example.com', 'Alice')).rejects.toBeInstanceOf(
      SuperAdminRequiredError
    );
  });

  it('propagates P0002 as TenantNotFoundError (user UUID not found)', async () => {
    mockRpc.mockResolvedValue({ error: { code: 'P0002', message: 'no_data_found' } });
    await expect(salesRepsApi.create(USER_ID, 'rep@example.com', 'Alice')).rejects.toBeInstanceOf(
      TenantNotFoundError
    );
  });

  it('propagates 22023 as InvalidFilterError', async () => {
    mockRpc.mockResolvedValue({ error: { code: '22023', message: 'INVALID_PARAM' } });
    await expect(salesRepsApi.create(USER_ID, 'rep@example.com', 'Alice')).rejects.toBeInstanceOf(
      InvalidFilterError
    );
  });
});

describe('salesRepsApi.deactivate', () => {
  it('happy path — resolves void on success', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(salesRepsApi.deactivate(USER_ID, 'Resigned')).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenCalledWith('deactivate_sales_rep', {
      p_user_id: USER_ID,
      p_reason: 'Resigned',
    });
  });

  it('propagates P0403 SUPER_ADMIN_REQUIRED as SuperAdminRequiredError', async () => {
    mockRpc.mockResolvedValue({ error: { code: 'P0403', message: 'SUPER_ADMIN_REQUIRED' } });
    await expect(salesRepsApi.deactivate(USER_ID, 'reason')).rejects.toBeInstanceOf(
      SuperAdminRequiredError
    );
  });

  it('propagates generic error as Error', async () => {
    mockRpc.mockResolvedValue({ error: { code: '99999', message: 'unknown error' } });
    await expect(salesRepsApi.deactivate(USER_ID, 'reason')).rejects.toThrow('unknown error');
  });
});
