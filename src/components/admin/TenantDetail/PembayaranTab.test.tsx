// src/components/admin/TenantDetail/PembayaranTab.test.tsx
// Tests: loading skeleton, error state, empty state, table render,
// coverage summary, edit/delete action triggers, Bukti signed-URL,
// refetch on modal success.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PembayaranTab } from './PembayaranTab';
import type { AdminTenantRow } from '../../../lib/adminTypes';
import { StorageAccessDeniedError } from '../../../lib/adminTypes';
import type { PaymentRow } from '../../../lib/paymentsTypes';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const listMock      = vi.fn();
const coverageMock  = vi.fn();
const signedUrlMock = vi.fn();
const deleteMock    = vi.fn();
const toastSuccess  = vi.fn();
const toastError    = vi.fn();

vi.mock('../../../lib/paymentsApi', () => ({
  listPayments:                   (...args: unknown[]) => listMock(...args),
  getTenantCoverage:              (...args: unknown[]) => coverageMock(...args),
  generatePaymentProofSignedUrl:  (...args: unknown[]) => signedUrlMock(...args),
  deletePayment:                  (...args: unknown[]) => deleteMock(...args),
  recordPayment:                  vi.fn(),
  updatePayment:                  vi.fn(),
  uploadPaymentProof:             vi.fn(),
}));

vi.mock('../../../lib/adminToast', () => ({
  adminToast: {
    success: (msg: string) => toastSuccess(msg),
    error:   (msg: string) => toastError(msg),
    info:    vi.fn(),
  },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseTenant: AdminTenantRow = {
  tenant_id:        'tid-001',
  slug:             'garindo-jaya',
  name:             'Garindo Jaya',
  plan_code:        'PRO',
  status:           'ACTIVE',
  expiry_mode:      'ACTIVE',
  activated_at:     '2026-01-01',
  expires_at:       '2027-07-01',
  days_until_expiry: 365,
  user_count:       3,
  sku_count:        100,
  industry:         'Retail',
  employee_range:   '4-19 orang (Kecil)',
  onboarded_at:     '2026-01-01T00:00:00Z',
  last_login_at:    null,
  txn_7d:           10,
  avg_daily_txn:    1.4,
  usage_status:     'AKTIF',
  total_count:      1,
};

const currentYear = new Date().getFullYear();

const payment1: PaymentRow = {
  id:               'pid-001',
  tenant_id:        'tid-001',
  amount:           3_600_000,
  currency:         'IDR',
  payment_method:   'BANK_TRANSFER',
  bank_name:        'BCA',
  ewallet_provider: null,
  payment_date:     `${currentYear}-07-01`,
  period_from:      `${currentYear}-07-01`,
  period_to:        `${currentYear + 1}-07-01`,
  proof_url:        'garindo-jaya/2026-07-abc.png',
  bank_reference:   'TRF-001',
  notes:            'Test note',
  recorded_by_admin: 'admin@vosi.id',
  created_at:       `${currentYear}-07-01T00:00:00Z`,
};

const payment2: PaymentRow = {
  ...payment1,
  id:     'pid-002',
  amount: 1_000_000,
  payment_method: 'CASH',
  bank_name: null,
  payment_date: `${currentYear - 1}-01-01`,
  proof_url: null,
  bank_reference: null,
  notes: null,
};

function renderTab(overrides: Partial<{ row: AdminTenantRow }> = {}) {
  const row = overrides.row ?? baseTenant;
  render(
    <PembayaranTab
      tenantId="tid-001"
      tenantSlug="garindo-jaya"
      row={row}
    />
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PembayaranTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: coverage fetch returns null (em-dash badge)
    coverageMock.mockResolvedValue(null);
  });
  afterEach(() => vi.restoreAllMocks());

  // ── Loading ───────────────────────────────────────────────────────────────

  it('shows loading skeleton before fetch resolves', () => {
    listMock.mockReturnValue(new Promise(() => {}));
    renderTab();
    expect(screen.getByTestId('pembayaran-tab-loading')).toBeInTheDocument();
    expect(screen.getByTestId('pembayaran-tab-skeleton')).toBeInTheDocument();
  });

  // ── Error ─────────────────────────────────────────────────────────────────

  it('shows error state when fetch fails', async () => {
    listMock.mockRejectedValue(new Error('network error'));
    renderTab();

    await waitFor(() =>
      expect(screen.getByTestId('pembayaran-tab-error')).toBeInTheDocument()
    );
    expect(toastError).toHaveBeenCalled();
  });

  it('retry button refetches on error', async () => {
    listMock
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce([]);
    renderTab();

    await waitFor(() => screen.getByTestId('pembayaran-tab-error'));
    fireEvent.click(screen.getByRole('button', { name: /coba lagi/i }));

    await waitFor(() =>
      expect(screen.getByTestId('pembayaran-tab-empty')).toBeInTheDocument()
    );
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  // ── Empty ─────────────────────────────────────────────────────────────────

  it('shows empty state when no payments', async () => {
    listMock.mockResolvedValue([]);
    renderTab();

    await waitFor(() =>
      expect(screen.getByTestId('pembayaran-tab-empty')).toBeInTheDocument()
    );
    expect(screen.getByText(/belum ada pembayaran/i)).toBeInTheDocument();
    expect(screen.getByTestId('catat-pembayaran-cta')).toBeInTheDocument();
  });

  // ── Table render ──────────────────────────────────────────────────────────

  it('renders table with payment rows', async () => {
    listMock.mockResolvedValue([payment1, payment2]);
    renderTab();

    await waitFor(() =>
      expect(screen.getByTestId('pembayaran-tab')).toBeInTheDocument()
    );

    // Should have row data — use getAllByText since email appears in each row
    expect(screen.getByText('TRF-001')).toBeInTheDocument();
    expect(screen.getByText('Test note')).toBeInTheDocument();
    expect(screen.getAllByText('admin@vosi.id').length).toBeGreaterThanOrEqual(1);
  });

  // ── Coverage summary ──────────────────────────────────────────────────────

  it('renders coverage summary strip', async () => {
    listMock.mockResolvedValue([payment1]);
    // Coverage status comes from the view, not computed from payments
    coverageMock.mockResolvedValue('LUNAS');
    renderTab();

    await waitFor(() => screen.getByTestId('coverage-summary'));

    expect(screen.getByTestId('coverage-badge-LUNAS')).toBeInTheDocument();
    // expires_at
    expect(screen.getByText('2027-07-01')).toBeInTheDocument();
  });

  it('shows OVERDUE coverage when view returns OVERDUE', async () => {
    listMock.mockResolvedValue([payment1]);
    coverageMock.mockResolvedValue('OVERDUE');
    renderTab();

    await waitFor(() => screen.getByTestId('coverage-summary'));
    expect(screen.getByTestId('coverage-badge-OVERDUE')).toBeInTheDocument();
  });

  it('shows UNPAID when view returns UNPAID', async () => {
    listMock.mockResolvedValue([payment2]);
    coverageMock.mockResolvedValue('UNPAID');
    renderTab();

    await waitFor(() => screen.getByTestId('coverage-summary'));
    expect(screen.getByTestId('coverage-badge-UNPAID')).toBeInTheDocument();
  });

  // ── Bukti signed URL ──────────────────────────────────────────────────────

  it('opens signed URL on Bukti click', async () => {
    signedUrlMock.mockResolvedValue('https://cdn.example.com/signed.png');
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    listMock.mockResolvedValue([payment1]);
    renderTab();

    await waitFor(() => screen.getByTestId(`bukti-btn-${payment1.id}`));
    fireEvent.click(screen.getByTestId(`bukti-btn-${payment1.id}`));

    await waitFor(() => {
      expect(signedUrlMock).toHaveBeenCalledWith(payment1.proof_url);
      expect(windowOpenSpy).toHaveBeenCalledWith('https://cdn.example.com/signed.png', '_blank');
    });

    windowOpenSpy.mockRestore();
  });

  it('shows error toast when signed URL fails', async () => {
    signedUrlMock.mockRejectedValue(new StorageAccessDeniedError());
    listMock.mockResolvedValue([payment1]);
    renderTab();

    await waitFor(() => screen.getByTestId(`bukti-btn-${payment1.id}`));
    fireEvent.click(screen.getByTestId(`bukti-btn-${payment1.id}`));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(new StorageAccessDeniedError().userMessage);
    });
  });

  // ── Edit action ───────────────────────────────────────────────────────────

  it('opens RecordPaymentModal in edit mode when Edit clicked', async () => {
    listMock.mockResolvedValue([payment1]);
    renderTab();

    await waitFor(() => screen.getByTestId(`edit-payment-btn-${payment1.id}`));
    fireEvent.click(screen.getByTestId(`edit-payment-btn-${payment1.id}`));

    // RecordPaymentModal dialog should appear in edit mode
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    );
    expect(screen.getByText('Edit pembayaran')).toBeInTheDocument();
  });

  // ── Delete action ─────────────────────────────────────────────────────────

  it('opens delete confirmation dialog when Hapus clicked', async () => {
    listMock.mockResolvedValue([payment1]);
    renderTab();

    await waitFor(() => screen.getByTestId(`delete-payment-btn-${payment1.id}`));
    fireEvent.click(screen.getByTestId(`delete-payment-btn-${payment1.id}`));

    expect(screen.getByTestId('delete-payment-dialog')).toBeInTheDocument();
  });

  it('delete confirm button disabled when reason is empty', async () => {
    listMock.mockResolvedValue([payment1]);
    renderTab();

    await waitFor(() => screen.getByTestId(`delete-payment-btn-${payment1.id}`));
    fireEvent.click(screen.getByTestId(`delete-payment-btn-${payment1.id}`));

    expect(screen.getByTestId('delete-confirm-btn')).toBeDisabled();
  });

  it('calls deletePayment with reason and refreshes on confirm', async () => {
    deleteMock.mockResolvedValue({ ok: true });
    listMock
      .mockResolvedValueOnce([payment1])
      .mockResolvedValueOnce([]); // After delete
    renderTab();

    await waitFor(() => screen.getByTestId(`delete-payment-btn-${payment1.id}`));
    fireEvent.click(screen.getByTestId(`delete-payment-btn-${payment1.id}`));

    const reasonInput = screen.getByLabelText(/alasan penghapusan/i);
    fireEvent.change(reasonInput, { target: { value: 'Duplikat data' } });
    fireEvent.click(screen.getByTestId('delete-confirm-btn'));

    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith(payment1.id, 'Duplikat data');
      expect(toastSuccess).toHaveBeenCalledWith('Pembayaran dihapus.');
    });

    // Should refetch — empty state after second call
    await waitFor(() =>
      expect(screen.getByTestId('pembayaran-tab-empty')).toBeInTheDocument()
    );
  });

  // ── Catat button ──────────────────────────────────────────────────────────

  it('shows Catat pembayaran toolbar button in non-empty state', async () => {
    listMock.mockResolvedValue([payment1]);
    renderTab();

    await waitFor(() => screen.getByTestId('catat-pembayaran-btn'));
    expect(screen.getByTestId('catat-pembayaran-btn')).toBeInTheDocument();
  });
});
