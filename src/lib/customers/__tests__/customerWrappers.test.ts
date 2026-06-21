import { describe, test, expect, vi, beforeEach } from 'vitest';

const { mockRpc, mockFrom } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock('../../supabaseClient', () => ({
  supabase: { rpc: mockRpc, from: mockFrom },
}));

import {
  insertNewCustomer,
  requestCustomerCreditActivate,
  rejectCustomerCreditActivate,
} from '../customerWrappers';

describe('insertNewCustomer', () => {
  beforeEach(() => { mockRpc.mockReset(); mockFrom.mockReset(); });

  test('inserts with allows_tempo=false default', async () => {
    const insert = vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: 'c-1', name: 'X', wa_number: '081', allows_tempo: false }, error: null }) }),
    });
    mockFrom.mockReturnValue({ insert });
    const result = await insertNewCustomer({ name: 'X', wa_number: '081' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ name: 'X', wa_number: '081', allows_tempo: false }));
    expect(result).toEqual(expect.objectContaining({ id: 'c-1' }));
  });

  test('throws on insert error', async () => {
    const insert = vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'duplicate phone' } }) }),
    });
    mockFrom.mockReturnValue({ insert });
    await expect(insertNewCustomer({ name: 'X', wa_number: '081' })).rejects.toMatchObject({ message: 'duplicate phone' });
  });
});

describe('requestCustomerCreditActivate', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  test('calls RPC with correct args + returns request_id', async () => {
    mockRpc.mockResolvedValueOnce({ data: 42, error: null });
    const result = await requestCustomerCreditActivate('c-1', 14, 5000000, 'regular customer');
    expect(mockRpc).toHaveBeenCalledWith('request_customer_credit_activate', {
      p_customer_id: 'c-1',
      p_term_days: 14,
      p_credit_limit: 5000000,
      p_reason: 'regular customer',
    });
    expect(result).toEqual({ request_id: 42 });
  });

  test('reason optional', async () => {
    mockRpc.mockResolvedValueOnce({ data: 42, error: null });
    await requestCustomerCreditActivate('c-1', 14, 5000000);
    expect(mockRpc).toHaveBeenCalledWith('request_customer_credit_activate',
      expect.objectContaining({ p_reason: null }));
  });

  test('throws on RPC error preserving prefix', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'OWNER_ONLY: …' } });
    await expect(requestCustomerCreditActivate('c-1', 14, 5000000)).rejects.toMatchObject({ message: 'OWNER_ONLY: …' });
  });
});

describe('rejectCustomerCreditActivate', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  test('calls RPC with id + reason', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await rejectCustomerCreditActivate(42, 'limit too high');
    expect(mockRpc).toHaveBeenCalledWith('reject_customer_credit_activate', {
      p_request_id: 42,
      p_reason: 'limit too high',
    });
  });

  test('throws on OWNER_ONLY', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'OWNER_ONLY: caller is not an active Owner' } });
    await expect(rejectCustomerCreditActivate(42, 'x')).rejects.toMatchObject({ message: 'OWNER_ONLY: caller is not an active Owner' });
  });
});
