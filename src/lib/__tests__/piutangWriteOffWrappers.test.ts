import { describe, test, expect, vi, beforeEach } from 'vitest';

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));
vi.mock('../supabaseClient', () => ({
  supabase: { rpc: mockRpc },
}));

import {
  requestTempoWriteOff,
  approveTempoWriteOff,
  rejectTempoWriteOff,
  revertTempoWriteOff,
} from '../piutang/writeOff';

describe('requestTempoWriteOff', () => {
  beforeEach(() => mockRpc.mockReset());

  test('calls request_tempo_write_off with correct params', async () => {
    mockRpc.mockResolvedValueOnce({ data: 42, error: null });
    const result = await requestTempoWriteOff('order-1', 'Customer bankrupt 2026-06-15');
    expect(mockRpc).toHaveBeenCalledWith('request_tempo_write_off', {
      p_order_id: 'order-1',
      p_reason: 'Customer bankrupt 2026-06-15',
    });
    expect(result).toEqual({ approval_id: 42 });
  });

  test('throws on RPC error preserving prefix', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'ORDER_NOT_TEMPO: cannot write off status=PAYMENT_VERIFIED' } });
    await expect(requestTempoWriteOff('order-1', 'reason here long enough'))
      .rejects.toMatchObject({ message: 'ORDER_NOT_TEMPO: cannot write off status=PAYMENT_VERIFIED' });
  });
});

describe('approveTempoWriteOff', () => {
  beforeEach(() => mockRpc.mockReset());

  test('returns {status:approved} on happy path', async () => {
    mockRpc.mockResolvedValueOnce({ data: { status: 'approved' }, error: null });
    const result = await approveTempoWriteOff(99);
    expect(mockRpc).toHaveBeenCalledWith('approve_tempo_write_off', { p_approval_id: 99 });
    expect(result).toEqual({ status: 'approved' });
  });

  test('returns {status:auto_rejected_race} on race', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { status: 'auto_rejected_race', new_order_status: 'PAYMENT_VERIFIED' },
      error: null,
    });
    const result = await approveTempoWriteOff(99);
    expect(result).toEqual({ status: 'auto_rejected_race', new_order_status: 'PAYMENT_VERIFIED' });
  });

  test('throws on OWNER_ONLY', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'OWNER_ONLY: caller is not an active Owner' } });
    await expect(approveTempoWriteOff(99)).rejects.toMatchObject({ message: 'OWNER_ONLY: caller is not an active Owner' });
  });
});

describe('rejectTempoWriteOff', () => {
  beforeEach(() => mockRpc.mockReset());

  test('calls reject_tempo_write_off with id + reason', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await rejectTempoWriteOff(99, 'still trying to collect');
    expect(mockRpc).toHaveBeenCalledWith('reject_tempo_write_off', {
      p_approval_id: 99,
      p_reason: 'still trying to collect',
    });
  });
});

describe('revertTempoWriteOff', () => {
  beforeEach(() => mockRpc.mockReset());

  test('calls revert_tempo_write_off with order id', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await revertTempoWriteOff('order-1');
    expect(mockRpc).toHaveBeenCalledWith('revert_tempo_write_off', { p_order_id: 'order-1' });
  });

  test('throws on NOT_WRITTEN_OFF', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'NOT_WRITTEN_OFF: status=INVOICE_TEMPO' } });
    await expect(revertTempoWriteOff('order-1')).rejects.toMatchObject({ message: 'NOT_WRITTEN_OFF: status=INVOICE_TEMPO' });
  });
});
