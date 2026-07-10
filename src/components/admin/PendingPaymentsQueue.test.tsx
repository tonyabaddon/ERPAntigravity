// src/components/admin/PendingPaymentsQueue.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PendingPaymentsQueue } from './PendingPaymentsQueue';

vi.mock('../../lib/paymentVerificationApi', () => ({
  paymentVerificationApi: {
    listPending: vi.fn(),
    verify: vi.fn(),
    reject: vi.fn(),
  },
}));

vi.mock('../../lib/adminToast', () => ({
  adminToast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

import { paymentVerificationApi } from '../../lib/paymentVerificationApi';

const mockPayment = {
  id: 'pay-001',
  tenant_id: 'ten-001',
  tenant_slug: 'garindo-jaya',
  tenant_name: 'Garindo Jaya',
  amount: 1_500_000,
  payment_method: 'BANK_TRANSFER',
  payment_date: '2026-07-01',
  proof_url: 'https://example.com/proof.jpg',
  bank_reference: 'REF123456',
  notes: 'Pembayaran bulan Juli',
  amount_anomaly: false,
  created_at: '2026-07-01T10:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PendingPaymentsQueue', () => {
  it('shows loading skeleton before data arrives', () => {
    vi.mocked(paymentVerificationApi.listPending).mockReturnValue(new Promise(() => {}));
    render(<PendingPaymentsQueue />);
    expect(screen.getByTestId('pending-payments-loading')).toBeInTheDocument();
  });

  it('renders list of pending payments after load', async () => {
    vi.mocked(paymentVerificationApi.listPending).mockResolvedValue([mockPayment]);
    render(<PendingPaymentsQueue />);
    await waitFor(() =>
      expect(screen.getByTestId('pending-payments-list')).toBeInTheDocument()
    );
    expect(screen.getByTestId(`pending-payment-row-${mockPayment.id}`)).toBeInTheDocument();
    expect(screen.getByText('Garindo Jaya')).toBeInTheDocument();
    expect(screen.getByText('garindo-jaya')).toBeInTheDocument();
  });

  it('shows empty state when no pending payments', async () => {
    vi.mocked(paymentVerificationApi.listPending).mockResolvedValue([]);
    render(<PendingPaymentsQueue />);
    await waitFor(() =>
      expect(screen.getByTestId('pending-payments-empty')).toBeInTheDocument()
    );
    expect(screen.getByText('Tidak ada pembayaran menunggu verifikasi.')).toBeInTheDocument();
  });

  it('refetches list after verify action triggered via refresh button', async () => {
    vi.mocked(paymentVerificationApi.listPending)
      .mockResolvedValueOnce([mockPayment])
      .mockResolvedValueOnce([]);

    render(<PendingPaymentsQueue />);
    await waitFor(() =>
      expect(screen.getByTestId('pending-payments-list')).toBeInTheDocument()
    );

    // Simulate verify button click (triggers onRefresh on success)
    vi.mocked(paymentVerificationApi.verify).mockResolvedValue(undefined);
    fireEvent.click(screen.getByTestId(`verify-btn-${mockPayment.id}`));

    await waitFor(() =>
      expect(screen.getByTestId('pending-payments-empty')).toBeInTheDocument()
    );
    // listPending called at least twice (initial + after refresh)
    expect(vi.mocked(paymentVerificationApi.listPending)).toHaveBeenCalledTimes(2);
  });

  it('shows amount anomaly badge when amount_anomaly is true', async () => {
    const anomalyPayment = { ...mockPayment, id: 'pay-002', amount_anomaly: true };
    vi.mocked(paymentVerificationApi.listPending).mockResolvedValue([anomalyPayment]);
    render(<PendingPaymentsQueue />);
    await waitFor(() =>
      expect(screen.getByTestId('amount-anomaly-badge')).toBeInTheDocument()
    );
    expect(screen.getByText(/Amount tidak sesuai plan/)).toBeInTheDocument();
  });
});
