// src/components/admin/SuspendTenantModal.test.tsx
// Covers: renders warning + form; validation blocks submit; happy path; error paths;
//         ESC close; backdrop click; busy states.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SuspendTenantModal } from './SuspendTenantModal';
import type { AdminTenantRow } from '../../lib/adminTypes';
import { TenantNotFoundError } from '../../lib/adminTypes';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const suspendMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock('../../lib/adminApi', () => ({
  suspendTenant: (tenantId: string, reason: string) => suspendMock(tenantId, reason),
}));

vi.mock('../../lib/adminToast', () => ({
  adminToast: {
    success: (msg: string) => toastSuccessMock(msg),
    error: (msg: string) => toastErrorMock(msg),
    info: vi.fn(),
  },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseTenant: AdminTenantRow = {
  tenant_id: 'tid-001',
  slug: 'garindo-jaya',
  name: 'Garindo Jaya',
  plan_code: 'PRO',
  status: 'ACTIVE',
  expiry_mode: 'ACTIVE',
  activated_at: '2026-01-01',
  expires_at: '2027-07-05',
  days_until_expiry: 365,
  user_count: 3,
  sku_count: 100,
  industry: 'Retail',
  employee_range: '4-19 orang (Kecil)',
  onboarded_at: '2026-01-01T00:00:00Z',
  last_login_at: null,
  txn_7d: 10,
  avg_daily_txn: 1.4,
  usage_status: 'AKTIF',
  total_count: 1,
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function renderOpen(
  props: {
    tenant?: AdminTenantRow;
    onClose?: () => void;
    onSuccess?: () => void;
  } = {}
) {
  const onClose = props.onClose ?? vi.fn();
  const onSuccess = props.onSuccess ?? vi.fn();
  const tenant = props.tenant ?? baseTenant;
  render(
    <SuspendTenantModal
      open={true}
      tenant={tenant}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
  return { onClose, onSuccess };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SuspendTenantModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders null when open=false', () => {
    render(
      <SuspendTenantModal
        open={false}
        tenant={baseTenant}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders modal with header when open=true', () => {
    renderOpen();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Suspend Tenant')).toBeInTheDocument();
  });

  it('shows tenant name in JetBrains Mono area', () => {
    renderOpen();
    expect(screen.getByText('Garindo Jaya')).toBeInTheDocument();
  });

  it('renders warning callout with correct copy', () => {
    renderOpen();
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toContain('Tenant tidak bisa menulis data setelah di-suspend');
    expect(alert.textContent).toContain('Pastikan alasan tercatat untuk audit');
  });

  it('renders textarea for reason', () => {
    renderOpen();
    expect(screen.getByLabelText(/alasan suspend/i)).toBeInTheDocument();
  });

  it('submit button is disabled when reason is empty', () => {
    renderOpen();
    const submitBtn = screen.getByRole('button', { name: /konfirmasi suspend/i });
    expect(submitBtn).toBeDisabled();
  });

  it('submit button is disabled when reason < 5 chars', () => {
    renderOpen();
    const textarea = screen.getByLabelText(/alasan suspend/i);
    fireEvent.change(textarea, { target: { value: 'abc' } });
    const submitBtn = screen.getByRole('button', { name: /konfirmasi suspend/i });
    expect(submitBtn).toBeDisabled();
  });

  it('submit button is enabled when reason >= 5 chars', () => {
    renderOpen();
    const textarea = screen.getByLabelText(/alasan suspend/i);
    fireEvent.change(textarea, { target: { value: 'overdue 60 hari' } });
    const submitBtn = screen.getByRole('button', { name: /konfirmasi suspend/i });
    expect(submitBtn).not.toBeDisabled();
  });

  it('calls suspendTenant with correct args on submit (happy path)', async () => {
    suspendMock.mockResolvedValue({ ok: true, suspended_at: '2026-07-05T00:00:00Z', reason: 'overdue' });
    const { onClose, onSuccess } = renderOpen();

    const textarea = screen.getByLabelText(/alasan suspend/i);
    fireEvent.change(textarea, { target: { value: 'pembayaran overdue 60 hari' } });

    fireEvent.click(screen.getByRole('button', { name: /konfirmasi suspend/i }));

    await waitFor(() => {
      expect(suspendMock).toHaveBeenCalledWith('tid-001', 'pembayaran overdue 60 hari');
    });

    expect(toastSuccessMock).toHaveBeenCalledWith('Tenant di-suspend.');
    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows typed error toast and keeps modal open on AdminApiError', async () => {
    suspendMock.mockRejectedValue(new TenantNotFoundError());
    const { onClose, onSuccess } = renderOpen();

    const textarea = screen.getByLabelText(/alasan suspend/i);
    fireEvent.change(textarea, { target: { value: 'overdue 60 hari' } });

    fireEvent.click(screen.getByRole('button', { name: /konfirmasi suspend/i }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Tenant tidak ditemukan.');
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows generic error toast for unknown errors', async () => {
    suspendMock.mockRejectedValue(new Error('network failure'));
    const { onClose, onSuccess } = renderOpen();

    const textarea = screen.getByLabelText(/alasan suspend/i);
    fireEvent.change(textarea, { target: { value: 'overdue 60 hari' } });

    fireEvent.click(screen.getByRole('button', { name: /konfirmasi suspend/i }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Terjadi kesalahan tak terduga.');
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables submit button while submitting', async () => {
    let resolveSuspend!: () => void;
    suspendMock.mockReturnValue(
      new Promise<void>((res) => {
        resolveSuspend = res;
      })
    );
    renderOpen();

    const textarea = screen.getByLabelText(/alasan suspend/i);
    fireEvent.change(textarea, { target: { value: 'overdue 60 hari' } });

    const submitBtn = screen.getByRole('button', { name: /konfirmasi suspend/i });
    fireEvent.click(submitBtn);

    // While in-flight, button should be disabled and show spinner text
    expect(submitBtn).toBeDisabled();
    expect(screen.getByText('Menyimpan…')).toBeInTheDocument();

    resolveSuspend();
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
  });

  it('closes via ESC key when not submitting', async () => {
    const onClose = vi.fn();
    renderOpen({ onClose });

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('does not close via ESC while submitting', async () => {
    suspendMock.mockReturnValue(new Promise(() => {})); // never resolves
    const onClose = vi.fn();
    renderOpen({ onClose });

    const textarea = screen.getByLabelText(/alasan suspend/i);
    fireEvent.change(textarea, { target: { value: 'overdue 60 hari' } });

    // Start submitting
    fireEvent.click(screen.getByRole('button', { name: /konfirmasi suspend/i }));

    // Press ESC — should NOT close
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes via Batal button', () => {
    const onClose = vi.fn();
    renderOpen({ onClose });

    fireEvent.click(screen.getByRole('button', { name: /batal/i }));

    expect(onClose).toHaveBeenCalled();
  });

  it('closes via backdrop click when not submitting', () => {
    const onClose = vi.fn();
    renderOpen({ onClose });

    const backdrop = screen.getByTestId('modal-backdrop');
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalled();
  });

  it('does not close via backdrop click when submitting', () => {
    suspendMock.mockReturnValue(new Promise(() => {})); // never resolves
    const onClose = vi.fn();
    renderOpen({ onClose });

    const textarea = screen.getByLabelText(/alasan suspend/i);
    fireEvent.change(textarea, { target: { value: 'overdue 60 hari' } });

    fireEvent.click(screen.getByRole('button', { name: /konfirmasi suspend/i }));

    const backdrop = screen.getByTestId('modal-backdrop');
    fireEvent.click(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('resets reason when modal reopens', () => {
    const { rerender } = render(
      <SuspendTenantModal
        open={true}
        tenant={baseTenant}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    const textarea = screen.getByLabelText(/alasan suspend/i);
    fireEvent.change(textarea, { target: { value: 'some reason here' } });
    expect((textarea as HTMLTextAreaElement).value).toBe('some reason here');

    // Close then reopen
    rerender(
      <SuspendTenantModal
        open={false}
        tenant={baseTenant}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );
    rerender(
      <SuspendTenantModal
        open={true}
        tenant={baseTenant}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    const freshTextarea = screen.getByLabelText(/alasan suspend/i);
    expect((freshTextarea as HTMLTextAreaElement).value).toBe('');
  });
});
