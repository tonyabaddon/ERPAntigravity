import { describe, it, expect, vi, beforeEach } from 'vitest';
import { paymentVerificationApi } from './paymentVerificationApi';
import {
  SuperAdminRequiredError,
  PlatformAdminRequiredError,
  PaymentNotFoundError,
  PaymentNotPendingError,
} from './adminTypes';

// ─── Mock supabaseClient ──────────────────────────────────────────────────────

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

vi.mock('./supabaseClient', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
  isSupabaseConfigured: true,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PAYMENT_ID = 'cccccccc-3333-3333-3333-cccccccccccc';

const pendingPaymentRow = {
  id: PAYMENT_ID,
  tenant_id: 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb',
  tenant_slug: 'garindo',
  tenant_name: 'Garindo Jaya Panel',
  amount: 1500000,
  payment_method: 'TRANSFER',
  payment_date: '2026-07-01',
  proof_url: 'payment-proofs/garindo/proof.jpg',
  bank_reference: 'REF123',
  notes: null,
  amount_anomaly: false,
  created_at: '2026-07-01T08:00:00+00:00',
};

// ─── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  mockRpc.mockReset();
});

// ─── listPending ──────────────────────────────────────────────────────────────

describe('paymentVerificationApi.listPending', () => {
  it('calls list_pending_payments with no params and returns rows', async () => {
    mockRpc.mockResolvedValueOnce({ data: [pendingPaymentRow], error: null });

    const result = await paymentVerificationApi.listPending();

    expect(mockRpc).toHaveBeenCalledWith('list_pending_payments');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(PAYMENT_ID);
    expect(result[0].amount_anomaly).toBe(false);
  });

  it('returns empty array when no pending payments', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    const result = await paymentVerificationApi.listPending();
    expect(result).toEqual([]);
  });

  it('throws PlatformAdminRequiredError on P0403 PLATFORM_ADMIN_REQUIRED', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0403', message: 'PLATFORM_ADMIN_REQUIRED' },
    });
    await expect(paymentVerificationApi.listPending()).rejects.toBeInstanceOf(
      PlatformAdminRequiredError,
    );
  });
});

// ─── verify ──────────────────────────────────────────────────────────────────

describe('paymentVerificationApi.verify', () => {
  it('calls verify_payment with correct p_payment_id', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { payment_id: PAYMENT_ID, status: 'VERIFIED' },
      error: null,
    });

    await paymentVerificationApi.verify(PAYMENT_ID);

    expect(mockRpc).toHaveBeenCalledWith('verify_payment', {
      p_payment_id: PAYMENT_ID,
    });
  });

  it('throws SuperAdminRequiredError on P0403 SUPER_ADMIN_REQUIRED', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0403', message: 'SUPER_ADMIN_REQUIRED' },
    });
    await expect(paymentVerificationApi.verify(PAYMENT_ID)).rejects.toBeInstanceOf(
      SuperAdminRequiredError,
    );
  });

  it('throws PaymentNotFoundError on P0002 PAYMENT_NOT_FOUND', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0002', message: 'PAYMENT_NOT_FOUND' },
    });
    await expect(paymentVerificationApi.verify(PAYMENT_ID)).rejects.toBeInstanceOf(
      PaymentNotFoundError,
    );
  });

  it('throws PaymentNotPendingError on P0409 PAYMENT_NOT_PENDING', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0409', message: 'PAYMENT_NOT_PENDING' },
    });
    await expect(paymentVerificationApi.verify(PAYMENT_ID)).rejects.toBeInstanceOf(
      PaymentNotPendingError,
    );
  });
});

// ─── reject ──────────────────────────────────────────────────────────────────

describe('paymentVerificationApi.reject', () => {
  it('calls reject_payment with correct p_payment_id and p_reason', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { payment_id: PAYMENT_ID, status: 'REJECTED' },
      error: null,
    });

    await paymentVerificationApi.reject(PAYMENT_ID, 'Bukti tidak valid');

    expect(mockRpc).toHaveBeenCalledWith('reject_payment', {
      p_payment_id: PAYMENT_ID,
      p_reason: 'Bukti tidak valid',
    });
  });

  it('throws SuperAdminRequiredError on P0403 SUPER_ADMIN_REQUIRED', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0403', message: 'SUPER_ADMIN_REQUIRED' },
    });
    await expect(
      paymentVerificationApi.reject(PAYMENT_ID, 'reason'),
    ).rejects.toBeInstanceOf(SuperAdminRequiredError);
  });

  it('throws PaymentNotFoundError on P0002 PAYMENT_NOT_FOUND', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0002', message: 'PAYMENT_NOT_FOUND' },
    });
    await expect(
      paymentVerificationApi.reject(PAYMENT_ID, 'reason'),
    ).rejects.toBeInstanceOf(PaymentNotFoundError);
  });

  it('throws PaymentNotPendingError on P0409 PAYMENT_NOT_PENDING', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0409', message: 'PAYMENT_NOT_PENDING' },
    });
    await expect(
      paymentVerificationApi.reject(PAYMENT_ID, 'reason'),
    ).rejects.toBeInstanceOf(PaymentNotPendingError);
  });
});
