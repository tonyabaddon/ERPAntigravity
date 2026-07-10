// src/components/admin/TenantDetail/DeleteTenantModal.test.tsx
// Unit tests for DeleteTenantModal:
//  1. Renders correctly when open
//  2. Hapus Permanen disabled until both reason ≥ 5 chars and slug matches
//  3. Submits and calls deprovisionTenant on valid input
//  4. Shows error toast on API failure
//  5. Closes on backdrop click (when not submitting)
//  6. Does not render when closed
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeleteTenantModal } from './DeleteTenantModal';
import type { AdminTenantRow } from '../../../lib/adminTypes';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../../lib/adminApi', () => ({
  deprovisionTenant: vi.fn(),
}));

vi.mock('../../../lib/adminToast', () => ({
  adminToast: {
    error:   vi.fn(),
    success: vi.fn(),
    info:    vi.fn(),
  },
}));

import { deprovisionTenant } from '../../../lib/adminApi';
import { adminToast } from '../../../lib/adminToast';

// ─── Fixture ──────────────────────────────────────────────────────────────────

const fakeTenant: AdminTenantRow = {
  tenant_id:       'tid-999',
  slug:            'test-delete-slug',
  name:            'Test Delete Tenant',
  plan_code:       'STARTER',
  status:          'ACTIVE',
  expiry_mode:     'ACTIVE',
  activated_at:    '2024-01-01',
  expires_at:      '2099-12-31',
  days_until_expiry: 26000,
  user_count:      1,
  sku_count:       0,
  industry:        null,
  employee_range:  null,
  onboarded_at:    '2024-01-01',
  last_login_at:   null,
  txn_7d:          0,
  avg_daily_txn:   0,
  usage_status:    'VAKUM',
  total_count:     1,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DeleteTenantModal', () => {
  const onClose   = vi.fn();
  const onDeleted = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when open=false', () => {
    render(
      <DeleteTenantModal
        open={false}
        tenant={fakeTenant}
        onClose={onClose}
        onDeleted={onDeleted}
      />
    );
    expect(screen.queryByTestId('delete-tenant-modal')).not.toBeInTheDocument();
  });

  it('renders modal with title and tenant name when open', () => {
    render(
      <DeleteTenantModal
        open={true}
        tenant={fakeTenant}
        onClose={onClose}
        onDeleted={onDeleted}
      />
    );
    expect(screen.getByTestId('delete-tenant-modal')).toBeInTheDocument();
    expect(screen.getByText('Hapus Tenant Permanen')).toBeInTheDocument();
    expect(screen.getByText('Test Delete Tenant')).toBeInTheDocument();
    expect(screen.getByText(/Semua data tenant akan hilang selamanya/)).toBeInTheDocument();
  });

  it('Hapus Permanen disabled when reason or slug is missing', () => {
    render(
      <DeleteTenantModal
        open={true}
        tenant={fakeTenant}
        onClose={onClose}
        onDeleted={onDeleted}
      />
    );
    const btn = screen.getByTestId('hapus-permanen-btn');
    expect(btn).toBeDisabled();
  });

  it('Hapus Permanen disabled when reason valid but slug wrong', () => {
    render(
      <DeleteTenantModal
        open={true}
        tenant={fakeTenant}
        onClose={onClose}
        onDeleted={onDeleted}
      />
    );
    fireEvent.change(screen.getByLabelText('Alasan hapus tenant'), {
      target: { value: 'tenant sudah tidak dipakai' },
    });
    fireEvent.change(screen.getByTestId('slug-confirm-input'), {
      target: { value: 'wrong-slug' },
    });
    expect(screen.getByTestId('hapus-permanen-btn')).toBeDisabled();
  });

  it('Hapus Permanen enabled only when both reason valid AND slug matches', () => {
    render(
      <DeleteTenantModal
        open={true}
        tenant={fakeTenant}
        onClose={onClose}
        onDeleted={onDeleted}
      />
    );
    fireEvent.change(screen.getByLabelText('Alasan hapus tenant'), {
      target: { value: 'tenant test, data tidak penting' },
    });
    fireEvent.change(screen.getByTestId('slug-confirm-input'), {
      target: { value: 'test-delete-slug' },
    });
    expect(screen.getByTestId('hapus-permanen-btn')).not.toBeDisabled();
  });

  it('calls deprovisionTenant and onDeleted on successful submit', async () => {
    vi.mocked(deprovisionTenant).mockResolvedValue({
      deleted_slug: 'test-delete-slug',
      deleted_at:   '2026-07-10T00:00:00Z',
      actor:        'uid-001',
    });

    render(
      <DeleteTenantModal
        open={true}
        tenant={fakeTenant}
        onClose={onClose}
        onDeleted={onDeleted}
      />
    );

    const reason = 'tenant test, data tidak penting';
    fireEvent.change(screen.getByLabelText('Alasan hapus tenant'), {
      target: { value: reason },
    });
    fireEvent.change(screen.getByTestId('slug-confirm-input'), {
      target: { value: 'test-delete-slug' },
    });
    fireEvent.click(screen.getByTestId('hapus-permanen-btn'));

    await waitFor(() =>
      expect(deprovisionTenant).toHaveBeenCalledWith('tid-999', reason)
    );
    expect(adminToast.success).toHaveBeenCalledWith(
      expect.stringContaining('test-delete-slug')
    );
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it('shows error toast and stays open on API failure', async () => {
    const { SuperAdminRequiredError } = await import('../../../lib/adminTypes');
    vi.mocked(deprovisionTenant).mockRejectedValue(new SuperAdminRequiredError());

    render(
      <DeleteTenantModal
        open={true}
        tenant={fakeTenant}
        onClose={onClose}
        onDeleted={onDeleted}
      />
    );

    fireEvent.change(screen.getByLabelText('Alasan hapus tenant'), {
      target: { value: 'alasan cukup panjang' },
    });
    fireEvent.change(screen.getByTestId('slug-confirm-input'), {
      target: { value: 'test-delete-slug' },
    });
    fireEvent.click(screen.getByTestId('hapus-permanen-btn'));

    await waitFor(() =>
      expect(adminToast.error).toHaveBeenCalled()
    );
    expect(onDeleted).not.toHaveBeenCalled();
    // Modal stays open (onClose not called)
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose on Batal click', () => {
    render(
      <DeleteTenantModal
        open={true}
        tenant={fakeTenant}
        onClose={onClose}
        onDeleted={onDeleted}
      />
    );
    fireEvent.click(screen.getByText('Batal'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on backdrop click', () => {
    render(
      <DeleteTenantModal
        open={true}
        tenant={fakeTenant}
        onClose={onClose}
        onDeleted={onDeleted}
      />
    );
    const backdrop = screen.getByTestId('delete-tenant-modal-backdrop');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
