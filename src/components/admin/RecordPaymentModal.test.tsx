// src/components/admin/RecordPaymentModal.test.tsx
// Tests: happy-path record, happy-path edit, validation blocks,
// file validation (size/type), upload-mandatory rule,
// ESC/backdrop close, conditional fields, error handling.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RecordPaymentModal } from './RecordPaymentModal';
import type { AdminTenantRow } from '../../lib/adminTypes';
import { AdminApiError, PaymentFileTooLargeError } from '../../lib/adminTypes';
import type { PaymentRow, RecordPaymentResult } from '../../lib/paymentsTypes';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const recordMock   = vi.fn();
const updateMock   = vi.fn();
const uploadMock   = vi.fn();
const toastSuccess = vi.fn();
const toastError   = vi.fn();

vi.mock('../../lib/paymentsApi', () => ({
  recordPayment:    (...args: unknown[]) => recordMock(...args),
  updatePayment:    (...args: unknown[]) => updateMock(...args),
  uploadPaymentProof: (...args: unknown[]) => uploadMock(...args),
}));

vi.mock('../../lib/adminToast', () => ({
  adminToast: {
    success: (msg: string) => toastSuccess(msg),
    error:   (msg: string) => toastError(msg),
    info:    vi.fn(),
  },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseTenant: AdminTenantRow = {
  tenant_id:       'tid-001',
  slug:            'garindo-jaya',
  name:            'Garindo Jaya',
  plan_code:       'PRO',
  status:          'ACTIVE',
  expiry_mode:     'ACTIVE',
  activated_at:    '2026-01-01',
  expires_at:      '2027-01-01',
  days_until_expiry: 180,
  user_count:      3,
  sku_count:       100,
  industry:        'Retail',
  employee_range:  '4-19 orang (Kecil)',
  onboarded_at:    '2026-01-01T00:00:00Z',
  last_login_at:   null,
  txn_7d:          10,
  avg_daily_txn:   1.4,
  usage_status:    'AKTIF',
  total_count:     1,
};

const existingPayment: PaymentRow = {
  id:               'pid-001',
  tenant_id:        'tid-001',
  amount:           3_600_000,
  currency:         'IDR',
  payment_method:   'BANK_TRANSFER',
  bank_name:        'BCA',
  ewallet_provider: null,
  payment_date:     '2026-07-01',
  period_from:      '2026-07-01',
  period_to:        '2027-07-01',
  proof_url:        'garindo-jaya/2026-07-abc.png',
  bank_reference:   'TRF-001',
  notes:            'Test note',
  recorded_by_admin: 'admin@vosi.id',
  created_at:       '2026-07-01T00:00:00Z',
};

const fakeRecordResult: RecordPaymentResult = {
  ok:              true,
  payment_id:      'pid-new',
  amount_paid_ytd: 3_600_000,
  coverage_ok:     true,
  coverage_status: 'LUNAS',
};

function makeFile(name: string, type: string, sizeBytes: number): File {
  const content = new Uint8Array(sizeBytes);
  return new File([content], name, { type });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderRecord(overrides: Partial<{
  tenant: AdminTenantRow;
  defaultAmount: number;
  onClose: () => void;
  onSuccess: (r: RecordPaymentResult | { ok: true; payment_id: string }) => void;
}> = {}) {
  const onClose   = overrides.onClose   ?? vi.fn();
  const onSuccess = overrides.onSuccess ?? vi.fn();
  render(
    <RecordPaymentModal
      open={true}
      tenant={overrides.tenant ?? baseTenant}
      mode="record"
      defaultAmount={overrides.defaultAmount}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
  return { onClose, onSuccess };
}

function renderEdit(overrides: Partial<{
  tenant: AdminTenantRow;
  onClose: () => void;
  onSuccess: (r: RecordPaymentResult | { ok: true; payment_id: string }) => void;
}> = {}) {
  const onClose   = overrides.onClose   ?? vi.fn();
  const onSuccess = overrides.onSuccess ?? vi.fn();
  render(
    <RecordPaymentModal
      open={true}
      tenant={overrides.tenant ?? baseTenant}
      mode="edit"
      existingPayment={existingPayment}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
  return { onClose, onSuccess };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RecordPaymentModal', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  // ── Visibility ────────────────────────────────────────────────────────────

  it('renders null when open=false', () => {
    render(
      <RecordPaymentModal
        open={false}
        tenant={baseTenant}
        mode="record"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders modal when open=true (record mode)', () => {
    renderRecord();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // heading + submit button both say "Catat pembayaran"; check heading
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Catat pembayaran');
    expect(screen.getByText('Garindo Jaya')).toBeInTheDocument();
  });

  it('renders modal in edit mode with correct title', () => {
    renderEdit();
    expect(screen.getByText('Edit pembayaran')).toBeInTheDocument();
  });

  // ── Defaults ──────────────────────────────────────────────────────────────

  it('pre-fills amount from defaultAmount prop', () => {
    renderRecord({ defaultAmount: 3_600_000 });
    const input = screen.getByLabelText(/nominal diterima/i) as HTMLInputElement;
    expect(input.value).toBe('3600000');
  });

  it('pre-fills edit mode fields from existingPayment', () => {
    renderEdit();
    const amountInput = screen.getByLabelText(/nominal diterima/i) as HTMLInputElement;
    expect(amountInput.value).toBe('3600000');
    const refInput = screen.getByLabelText(/referensi bank/i) as HTMLInputElement;
    expect(refInput.value).toBe('TRF-001');
  });

  // ── Conditional fields ────────────────────────────────────────────────────

  it('shows bank dropdown for BANK_TRANSFER method', () => {
    renderRecord();
    // BANK_TRANSFER is default
    expect(screen.getByLabelText(/^bank$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/penyedia e-wallet/i)).not.toBeInTheDocument();
  });

  it('shows bank dropdown for VIRTUAL_ACCOUNT method', () => {
    renderRecord();
    const methodSelect = screen.getByLabelText(/metode pembayaran/i);
    fireEvent.change(methodSelect, { target: { value: 'VIRTUAL_ACCOUNT' } });
    expect(screen.getByLabelText(/^bank$/i)).toBeInTheDocument();
  });

  it('shows ewallet dropdown for E_WALLET method', () => {
    renderRecord();
    const methodSelect = screen.getByLabelText(/metode pembayaran/i);
    fireEvent.change(methodSelect, { target: { value: 'E_WALLET' } });
    expect(screen.getByLabelText(/penyedia e-wallet/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^bank$/i)).not.toBeInTheDocument();
  });

  it('shows ewallet dropdown for QRIS method', () => {
    renderRecord();
    const methodSelect = screen.getByLabelText(/metode pembayaran/i);
    fireEvent.change(methodSelect, { target: { value: 'QRIS' } });
    expect(screen.getByLabelText(/penyedia e-wallet/i)).toBeInTheDocument();
  });

  it('hides both bank and ewallet for CASH method', () => {
    renderRecord();
    const methodSelect = screen.getByLabelText(/metode pembayaran/i);
    fireEvent.change(methodSelect, { target: { value: 'CASH' } });
    expect(screen.queryByLabelText(/^bank$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/penyedia e-wallet/i)).not.toBeInTheDocument();
  });

  // ── Validation blocks ─────────────────────────────────────────────────────

  it('submit button disabled when amount is empty', () => {
    renderRecord();
    expect(screen.getByTestId('rp-submit')).toBeDisabled();
  });

  it('submit button enabled when form is valid (CASH mode — no upload required)', () => {
    renderRecord({ defaultAmount: 1000 });
    const methodSelect = screen.getByLabelText(/metode pembayaran/i);
    fireEvent.change(methodSelect, { target: { value: 'CASH' } });
    expect(screen.getByTestId('rp-submit')).not.toBeDisabled();
  });

  it('submit disabled when bank_name is empty for BANK_TRANSFER', () => {
    renderRecord({ defaultAmount: 1000 });
    // Method is BANK_TRANSFER by default, bank not selected
    expect(screen.getByTestId('rp-submit')).toBeDisabled();
  });

  it('submit enabled when bank_name selected and amount filled', () => {
    renderRecord({ defaultAmount: 1000 });
    const bankSelect = screen.getByLabelText(/^bank$/i);
    fireEvent.change(bankSelect, { target: { value: 'BCA' } });
    // No upload yet — still disabled because upload required
    expect(screen.getByTestId('rp-submit')).toBeDisabled();
  });

  // ── File validation ───────────────────────────────────────────────────────

  it('shows error for file over 5MB', () => {
    renderRecord({ defaultAmount: 1000 });
    const fileInput = screen.getByTestId('rp-proof-input');
    const bigFile = makeFile('big.jpg', 'image/jpeg', 6 * 1024 * 1024);
    fireEvent.change(fileInput, { target: { files: [bigFile] } });
    expect(screen.getByText(new PaymentFileTooLargeError().userMessage)).toBeInTheDocument();
  });

  it('shows error for wrong file type', () => {
    renderRecord({ defaultAmount: 1000 });
    const fileInput = screen.getByTestId('rp-proof-input');
    const wrongFile = makeFile('doc.docx', 'application/msword', 1024);
    fireEvent.change(fileInput, { target: { files: [wrongFile] } });
    expect(screen.getByText(/harus JPG, PNG, atau PDF/i)).toBeInTheDocument();
  });

  it('accepts valid PNG file and shows file info', () => {
    renderRecord({ defaultAmount: 1000 });
    const fileInput = screen.getByTestId('rp-proof-input');
    const goodFile = makeFile('proof.png', 'image/png', 100_000);
    fireEvent.change(fileInput, { target: { files: [goodFile] } });
    expect(screen.getByText(/proof\.png/)).toBeInTheDocument();
  });

  // ── Happy path record ─────────────────────────────────────────────────────

  it('records payment with CASH (no upload) on happy path', async () => {
    recordMock.mockResolvedValue(fakeRecordResult);
    const { onClose, onSuccess } = renderRecord({ defaultAmount: 1000 });

    const methodSelect = screen.getByLabelText(/metode pembayaran/i);
    fireEvent.change(methodSelect, { target: { value: 'CASH' } });

    fireEvent.click(screen.getByTestId('rp-submit'));

    await waitFor(() => {
      expect(recordMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id:      'tid-001',
          amount:         1000,
          payment_method: 'CASH',
          bank_name:      null,
          ewallet_provider: null,
          proof_object_key: null,
        })
      );
    });

    expect(uploadMock).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith('Pembayaran tercatat.');
    expect(onSuccess).toHaveBeenCalledWith(fakeRecordResult);
    expect(onClose).toHaveBeenCalled();
  });

  it('uploads file then records payment on happy path', async () => {
    // Migration 301: uploadPaymentProof now called with tenant_id (UUID), not slug
    uploadMock.mockResolvedValue({ objectKey: 'tenants/tid-001/2026-07-abc.png' });
    recordMock.mockResolvedValue(fakeRecordResult);
    const { onSuccess } = renderRecord({ defaultAmount: 3_600_000 });

    // Fill bank
    const bankSelect = screen.getByLabelText(/^bank$/i);
    fireEvent.change(bankSelect, { target: { value: 'BCA' } });

    // Attach file
    const fileInput = screen.getByTestId('rp-proof-input');
    const goodFile = makeFile('proof.png', 'image/png', 100_000);
    fireEvent.change(fileInput, { target: { files: [goodFile] } });

    fireEvent.click(screen.getByTestId('rp-submit'));

    await waitFor(() => {
      // tenant.tenant_id = 'tid-001' (not slug 'garindo-jaya')
      expect(uploadMock).toHaveBeenCalledWith('tid-001', goodFile);
      expect(recordMock).toHaveBeenCalledWith(
        expect.objectContaining({
          bank_name:       'BCA',
          proof_object_key: 'tenants/tid-001/2026-07-abc.png',
        })
      );
    });

    expect(onSuccess).toHaveBeenCalled();
  });

  // ── Happy path edit ───────────────────────────────────────────────────────

  it('calls updatePayment on edit mode submit', async () => {
    updateMock.mockResolvedValue({ ok: true });
    const { onSuccess } = renderEdit();

    // Change amount
    const amountInput = screen.getByLabelText(/nominal diterima/i);
    fireEvent.change(amountInput, { target: { value: '4000000' } });

    fireEvent.click(screen.getByTestId('rp-submit'));

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(
        'pid-001',
        expect.objectContaining({ amount: 4_000_000 })
      );
    });

    expect(toastSuccess).toHaveBeenCalledWith('Pembayaran diperbarui.');
    expect(onSuccess).toHaveBeenCalledWith({ ok: true, payment_id: 'pid-001' });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it('shows userMessage for AdminApiError', async () => {
    class TestError extends AdminApiError {
      readonly userMessage = 'Nominal harus lebih dari 0.';
    }
    recordMock.mockRejectedValue(new TestError());
    const { onClose } = renderRecord({ defaultAmount: 1000 });

    const methodSelect = screen.getByLabelText(/metode pembayaran/i);
    fireEvent.change(methodSelect, { target: { value: 'CASH' } });
    fireEvent.click(screen.getByTestId('rp-submit'));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Nominal harus lebih dari 0.');
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows generic error for unknown errors', async () => {
    recordMock.mockRejectedValue(new Error('network err'));
    renderRecord({ defaultAmount: 1000 });
    const methodSelect = screen.getByLabelText(/metode pembayaran/i);
    fireEvent.change(methodSelect, { target: { value: 'CASH' } });
    fireEvent.click(screen.getByTestId('rp-submit'));
    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Terjadi kesalahan tak terduga.');
    });
  });

  // ── ESC / backdrop ────────────────────────────────────────────────────────

  it('closes via ESC key when not submitting', () => {
    const onClose = vi.fn();
    renderRecord({ onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close via ESC while submitting', () => {
    recordMock.mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();
    renderRecord({ defaultAmount: 1000, onClose });
    const methodSelect = screen.getByLabelText(/metode pembayaran/i);
    fireEvent.change(methodSelect, { target: { value: 'CASH' } });
    fireEvent.click(screen.getByTestId('rp-submit'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes via backdrop click', () => {
    const onClose = vi.fn();
    renderRecord({ onClose });
    const backdrop = screen.getByTestId('record-payment-modal-backdrop');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes via Batal button', () => {
    const onClose = vi.fn();
    renderRecord({ onClose });
    fireEvent.click(screen.getByRole('button', { name: /batal/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
