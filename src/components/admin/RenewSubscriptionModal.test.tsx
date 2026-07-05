// src/components/admin/RenewSubscriptionModal.test.tsx
// Covers: form defaults, submit happy path, known error, unknown error, ESC close,
//         backdrop click close, past-date disable, null expires_at fallback.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { RenewSubscriptionModal } from './RenewSubscriptionModal';
import type { AdminTenantRow, RenewSubscriptionResult } from '../../lib/adminTypes';
import { TenantNotFoundError } from '../../lib/adminTypes';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const renewMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock('../../lib/adminApi', () => ({
  renewSubscription: (input: unknown) => renewMock(input),
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
  expires_at: '2026-07-05',          // today per test context
  days_until_expiry: 0,
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

const tenantNullExpiry: AdminTenantRow = {
  ...baseTenant,
  expires_at: null,
  days_until_expiry: null,
};

const fakeResult: RenewSubscriptionResult = {
  ok: true,
  tenant_id: 'tid-001',
  new_expires_at: '2027-07-05',
  new_grace_expires_at: '2027-07-12',
  plan_code: 'PRO',
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function renderOpen(
  props: {
    tenant?: AdminTenantRow;
    onClose?: () => void;
    onSuccess?: (r: RenewSubscriptionResult) => void;
  } = {}
) {
  const onClose = props.onClose ?? vi.fn();
  const onSuccess = props.onSuccess ?? vi.fn();
  const tenant = props.tenant ?? baseTenant;
  render(
    <RenewSubscriptionModal
      open={true}
      tenant={tenant}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
  return { onClose, onSuccess };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RenewSubscriptionModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders null when open=false', () => {
    render(
      <RenewSubscriptionModal
        open={false}
        tenant={baseTenant}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders modal when open=true', () => {
    renderOpen();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Perpanjang Masa Aktif')).toBeInTheDocument();
  });

  it('shows tenant name in subheader', () => {
    renderOpen();
    expect(screen.getByText('Garindo Jaya')).toBeInTheDocument();
  });

  it('shows current expires_at as reference', () => {
    renderOpen();
    expect(screen.getByText(/2026-07-05/)).toBeInTheDocument();
  });

  it('pre-fills date input with expires_at + 1 year', () => {
    renderOpen();
    const dateInput = screen.getByLabelText(/masa aktif baru/i) as HTMLInputElement;
    expect(dateInput.value).toBe('2027-07-05');
  });

  it('falls back to today + 1 year when expires_at is null', () => {
    renderOpen({ tenant: tenantNullExpiry });
    const dateInput = screen.getByLabelText(/masa aktif baru/i) as HTMLInputElement;
    // Should be a valid YYYY-MM-DD date roughly 1 year from now
    const today = new Date();
    const nextYear = today.getFullYear() + 1;
    expect(dateInput.value).toMatch(new RegExp(`^${nextYear}-`));
  });

  it('has plan select defaulting to "— Tidak diganti —"', () => {
    renderOpen();
    const select = screen.getByLabelText(/ganti paket/i) as HTMLSelectElement;
    expect(select.value).toBe('');
  });

  it('shows all plan options', () => {
    renderOpen();
    const select = screen.getByLabelText(/ganti paket/i);
    const options = within(select as HTMLElement)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value);
    expect(options).toContain('');
    expect(options).toContain('STARTER');
    expect(options).toContain('PRO');
    expect(options).toContain('PREMIUM');
  });

  it('renders notes textarea', () => {
    renderOpen();
    expect(screen.getByLabelText(/catatan internal/i)).toBeInTheDocument();
  });

  it('submit button is disabled when new date <= today', () => {
    renderOpen();
    const dateInput = screen.getByLabelText(/masa aktif baru/i) as HTMLInputElement;
    // Set a past date
    fireEvent.change(dateInput, { target: { value: '2020-01-01' } });
    const submitBtn = screen.getByRole('button', { name: /simpan perpanjangan/i });
    expect(submitBtn).toBeDisabled();
  });

  it('submit button is enabled when date is in the future', () => {
    renderOpen();
    const submitBtn = screen.getByRole('button', { name: /simpan perpanjangan/i });
    // Default date is +1 year, should be enabled
    expect(submitBtn).not.toBeDisabled();
  });

  it('calls renewSubscription with correct args on submit', async () => {
    renewMock.mockResolvedValue(fakeResult);
    const { onClose, onSuccess } = renderOpen();

    const dateInput = screen.getByLabelText(/masa aktif baru/i) as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2027-07-05' } });

    const select = screen.getByLabelText(/ganti paket/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'PRO' } });

    const notes = screen.getByLabelText(/catatan internal/i) as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: 'Renewal 1 tahun' } });

    fireEvent.click(screen.getByRole('button', { name: /simpan perpanjangan/i }));

    await waitFor(() => {
      expect(renewMock).toHaveBeenCalledWith({
        tenant_id: 'tid-001',
        new_expires_at: '2027-07-05',
        new_plan_code: 'PRO',
        notes: 'Renewal 1 tahun',
      });
    });

    expect(toastSuccessMock).toHaveBeenCalledWith('Masa aktif diperpanjang.');
    expect(onSuccess).toHaveBeenCalledWith(fakeResult);
    expect(onClose).toHaveBeenCalled();
  });

  it('sends null plan_code when "— Tidak diganti —" is selected', async () => {
    renewMock.mockResolvedValue(fakeResult);
    renderOpen();

    // Keep select at default (empty = no change)
    fireEvent.click(screen.getByRole('button', { name: /simpan perpanjangan/i }));

    await waitFor(() => {
      expect(renewMock).toHaveBeenCalledWith(
        expect.objectContaining({ new_plan_code: null })
      );
    });
  });

  it('shows known typed error toast and keeps modal open', async () => {
    renewMock.mockRejectedValue(new TenantNotFoundError());
    const { onClose, onSuccess } = renderOpen();

    fireEvent.click(screen.getByRole('button', { name: /simpan perpanjangan/i }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Tenant tidak ditemukan.');
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Modal still visible
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows generic error toast for unknown errors', async () => {
    renewMock.mockRejectedValue(new Error('network failure'));
    const { onClose, onSuccess } = renderOpen();

    fireEvent.click(screen.getByRole('button', { name: /simpan perpanjangan/i }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Terjadi kesalahan tak terduga.');
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables submit button while submitting', async () => {
    let resolveRenew!: (v: RenewSubscriptionResult) => void;
    renewMock.mockReturnValue(
      new Promise<RenewSubscriptionResult>((res) => {
        resolveRenew = res;
      })
    );
    renderOpen();

    const submitBtn = screen.getByRole('button', { name: /simpan perpanjangan/i });
    fireEvent.click(submitBtn);

    // While in-flight, button should be disabled
    expect(submitBtn).toBeDisabled();

    resolveRenew(fakeResult);
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
  });

  it('closes via ESC key when not submitting', async () => {
    const onClose = vi.fn();
    renderOpen({ onClose });

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('does not close via ESC while submitting', async () => {
    renewMock.mockReturnValue(new Promise(() => {})); // never resolves
    const onClose = vi.fn();
    renderOpen({ onClose });

    // Start submitting
    fireEvent.click(screen.getByRole('button', { name: /simpan perpanjangan/i }));

    // Press ESC
    fireEvent.keyDown(document, { key: 'Escape' });

    // onClose should NOT have been called
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
    renewMock.mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();
    renderOpen({ onClose });

    fireEvent.click(screen.getByRole('button', { name: /simpan perpanjangan/i }));

    const backdrop = screen.getByTestId('modal-backdrop');
    fireEvent.click(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });
});
