// src/components/admin/TenantsTable.test.tsx
// Tests for TenantsTable: status-conditional action buttons, Suspend modal open,
// Aktifkan confirm+success flow, ARCHIVED row shows —, impersonation preserved.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TenantsTable } from './TenantsTable';
import type { AdminTenantRow } from '../../lib/adminTypes';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const activateMock = vi.fn();
const suspendMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock('../../lib/adminApi', () => ({
  activateTenant: (tenantId: string) => activateMock(tenantId),
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

function fakeTenant(overrides: Partial<AdminTenantRow> = {}): AdminTenantRow {
  return {
    tenant_id: 't1',
    slug: 'garindo',
    name: 'Garindo Jaya',
    plan_code: 'PREMIUM',
    status: 'ACTIVE',
    expiry_mode: 'ACTIVE',
    activated_at: '2024-01-01',
    expires_at: '2099-12-31',
    days_until_expiry: 26000,
    user_count: 3,
    sku_count: 466,
    industry: 'Retail',
    employee_range: '4-19 orang (Kecil)',
    onboarded_at: '2024-01-01T00:00:00Z',
    last_login_at: '2026-06-01T10:00:00Z',
    txn_7d: 120,
    avg_daily_txn: 17,
    usage_status: 'AKTIF',
    total_count: 1,
    ...overrides,
  };
}

function defaultProps(
  rows: AdminTenantRow[],
  overrides: {
    onImpersonate?: (slug: string) => void;
    onRowActionSuccess?: () => void;
  } = {}
) {
  return {
    rows,
    sortBy: 'name' as const,
    sortDir: 'asc' as const,
    onSort: vi.fn(),
    onImpersonate: overrides.onImpersonate ?? vi.fn(),
    impersonating: null,
    onRowActionSuccess: overrides.onRowActionSuccess ?? vi.fn(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TenantsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    suspendMock.mockReset();
    activateMock.mockReset();
  });

  it('renders empty state when rows is empty', () => {
    render(<TenantsTable {...defaultProps([])} />);
    expect(screen.getByTestId('tenants-empty')).toBeInTheDocument();
  });

  it('renders Suspend button for ACTIVE tenant', () => {
    render(<TenantsTable {...defaultProps([fakeTenant({ status: 'ACTIVE' })])} />);
    expect(screen.getByRole('button', { name: /suspend garindo jaya/i })).toBeInTheDocument();
  });

  it('renders Aktifkan button for SUSPENDED tenant', () => {
    render(
      <TenantsTable
        {...defaultProps([fakeTenant({ status: 'SUSPENDED' })])}
      />
    );
    expect(screen.getByRole('button', { name: /aktifkan garindo jaya/i })).toBeInTheDocument();
  });

  it('renders em-dash for ARCHIVED tenant (no action buttons)', () => {
    render(
      <TenantsTable
        {...defaultProps([fakeTenant({ status: 'ARCHIVED' })])}
      />
    );
    // No Suspend or Aktifkan button
    expect(screen.queryByRole('button', { name: /suspend garindo jaya/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /aktifkan garindo jaya/i })).not.toBeInTheDocument();
    // Should have an em-dash placeholder — tested via testid
    expect(screen.getByTestId('no-action-archived-t1')).toBeInTheDocument();
  });

  it('clicking Suspend button opens SuspendTenantModal', async () => {
    render(<TenantsTable {...defaultProps([fakeTenant({ status: 'ACTIVE' })])} />);

    const suspendBtn = screen.getByRole('button', { name: /suspend garindo jaya/i });
    fireEvent.click(suspendBtn);

    await waitFor(() =>
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    );
    expect(screen.getByText('Suspend Tenant')).toBeInTheDocument();
  });

  it('clicking Aktifkan then confirming calls activateTenant and toasts success', async () => {
    activateMock.mockResolvedValue({ ok: true, status: 'ACTIVE' });
    const onRowActionSuccess = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <TenantsTable
        {...defaultProps(
          [fakeTenant({ status: 'SUSPENDED' })],
          { onRowActionSuccess }
        )}
      />
    );

    const aktifkanBtn = screen.getByRole('button', { name: /aktifkan garindo jaya/i });
    fireEvent.click(aktifkanBtn);

    await waitFor(() => {
      expect(activateMock).toHaveBeenCalledWith('t1');
    });

    expect(toastSuccessMock).toHaveBeenCalledWith('Tenant diaktifkan.');
    expect(onRowActionSuccess).toHaveBeenCalled();
  });

  it('clicking Aktifkan then cancelling does NOT call activateTenant', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <TenantsTable {...defaultProps([fakeTenant({ status: 'SUSPENDED' })])} />
    );

    const aktifkanBtn = screen.getByRole('button', { name: /aktifkan garindo jaya/i });
    fireEvent.click(aktifkanBtn);

    expect(activateMock).not.toHaveBeenCalled();
  });

  it('toasts error.userMessage when activateTenant throws AdminApiError', async () => {
    const { CannotActivateArchivedError } = await import('../../lib/adminTypes');
    activateMock.mockRejectedValue(new CannotActivateArchivedError());
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <TenantsTable {...defaultProps([fakeTenant({ status: 'SUSPENDED' })])} />
    );

    fireEvent.click(screen.getByRole('button', { name: /aktifkan garindo jaya/i }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Tenant yang sudah diarsipkan tidak bisa diaktifkan lagi.'
      );
    });
  });

  it('toasts generic error for unknown activate failure', async () => {
    activateMock.mockRejectedValue(new Error('network'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <TenantsTable {...defaultProps([fakeTenant({ status: 'SUSPENDED' })])} />
    );

    fireEvent.click(screen.getByRole('button', { name: /aktifkan garindo jaya/i }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Terjadi kesalahan tak terduga.');
    });
  });

  it('Impersonasi button still present on ACTIVE row alongside Suspend', () => {
    render(<TenantsTable {...defaultProps([fakeTenant({ status: 'ACTIVE' })])} />);
    expect(screen.getByTitle(/Impersonasi Garindo Jaya/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /suspend garindo jaya/i })).toBeInTheDocument();
  });

  it('Impersonasi button still present on SUSPENDED row alongside Aktifkan', () => {
    render(
      <TenantsTable {...defaultProps([fakeTenant({ status: 'SUSPENDED' })])} />
    );
    expect(screen.getByTitle(/Impersonasi Garindo Jaya/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /aktifkan garindo jaya/i })).toBeInTheDocument();
  });

  it('calls onRowActionSuccess after successful suspend', async () => {
    suspendMock.mockResolvedValue({ ok: true, suspended_at: '', reason: '' });
    const onRowActionSuccess = vi.fn();

    render(
      <TenantsTable
        {...defaultProps(
          [fakeTenant({ status: 'ACTIVE' })],
          { onRowActionSuccess }
        )}
      />
    );

    // Open modal
    fireEvent.click(screen.getByRole('button', { name: /suspend garindo jaya/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    // Fill in reason and submit
    const textarea = screen.getByLabelText(/alasan suspend/i);
    fireEvent.change(textarea, { target: { value: 'pembayaran overdue 60 hari' } });
    fireEvent.click(screen.getByRole('button', { name: /konfirmasi suspend/i }));

    await waitFor(() => expect(onRowActionSuccess).toHaveBeenCalled());
  });
});
