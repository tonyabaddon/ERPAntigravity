// src/components/admin/TenantDetail/UsersTab.test.tsx
// Covers: table renders staff rows, empty state, error toast.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { UsersTab } from './UsersTab';
import type { TenantUserRow } from '../../../lib/adminTypes';

// ─── Mock adminApi ────────────────────────────────────────────────────────────

const listMock = vi.fn();

vi.mock('../../../lib/adminApi', () => ({
  listTenantUsersAdmin: (id: string) => listMock(id),
}));

// adminToast is called on error — mock it so it doesn't throw
vi.mock('../../../lib/adminToast', () => ({
  adminToast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ownerRow: TenantUserRow = {
  user_id:         'u1',
  email:           'tonywei.office@gmail.com',
  full_name:       'Tony Wei',
  role:            'owner',
  status:          'ACTIVE',
  last_sign_in_at: '2026-07-04T09:00:00Z',
  created_at:      '2026-07-04T04:43:49Z',
};

const staffRow: TenantUserRow = {
  user_id:         'u2',
  email:           'kasir@garindo.co.id',
  full_name:       'kasir@garindo.co.id',
  role:            'kasir',
  status:          'ACTIVE',
  last_sign_in_at: null,
  created_at:      '2026-07-04T05:00:00Z',
};

const disabledRow: TenantUserRow = {
  user_id:         'u3',
  email:           'old@garindo.co.id',
  full_name:       'Akun Lama',
  role:            'staff',
  status:          'DISABLED',
  last_sign_in_at: null,
  created_at:      '2026-01-01T00:00:00Z',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UsersTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders staff rows after loading', async () => {
    listMock.mockResolvedValue([ownerRow, staffRow]);
    render(<UsersTab tenantId="t1" />);

    await waitFor(() => expect(screen.getByText('Tony Wei')).toBeInTheDocument());

    // Names (ownerRow.full_name !== email; safe to use getByText)
    expect(screen.getByText('Tony Wei')).toBeInTheDocument();
    // staffRow.full_name === email so it appears twice — use getAllByText
    expect(screen.getAllByText('kasir@garindo.co.id').length).toBeGreaterThanOrEqual(1);
    // Owner email is distinct from full_name
    expect(screen.getByText('tonywei.office@gmail.com')).toBeInTheDocument();
    // Role badges
    expect(screen.getByText('owner')).toBeInTheDocument();
    expect(screen.getByText('kasir')).toBeInTheDocument();
  });

  it('shows column headers in Bahasa Indonesia', async () => {
    listMock.mockResolvedValue([ownerRow]);
    render(<UsersTab tenantId="t1" />);

    await waitFor(() => expect(screen.getByText('Tony Wei')).toBeInTheDocument());

    expect(screen.getByText('Nama')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Peran')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Login terakhir')).toBeInTheDocument();
    expect(screen.getByText('Bergabung sejak')).toBeInTheDocument();
  });

  it('renders DISABLED status badge distinctly', async () => {
    listMock.mockResolvedValue([disabledRow]);
    render(<UsersTab tenantId="t1" />);

    await waitFor(() => expect(screen.getByText('Akun Lama')).toBeInTheDocument());
    expect(screen.getByText('disabled')).toBeInTheDocument();
  });

  it('shows "–" for null last_sign_in_at', async () => {
    listMock.mockResolvedValue([staffRow]);
    render(<UsersTab tenantId="t1" />);

    // staffRow.full_name === email so getAllByText; just wait for rows to appear
    await waitFor(() =>
      expect(screen.getAllByText('kasir@garindo.co.id').length).toBeGreaterThanOrEqual(1)
    );
    // null last_sign_in ��� em-dash placeholder in login terakhir cell
    expect(screen.getByText('–')).toBeInTheDocument();
  });

  it('shows empty state when no users', async () => {
    listMock.mockResolvedValue([]);
    render(<UsersTab tenantId="t1" />);

    await waitFor(() =>
      expect(screen.getByText(/Belum ada pengguna terdaftar/)).toBeInTheDocument()
    );
  });

  it('shows loading state initially', () => {
    // Never resolves — stays in loading
    listMock.mockReturnValue(new Promise(() => undefined));
    render(<UsersTab tenantId="t1" />);

    expect(screen.getByTestId('users-tab-loading')).toBeInTheDocument();
  });

  it('shows error toast and error state on fetch failure', async () => {
    const { adminToast } = await import('../../../lib/adminToast');
    listMock.mockRejectedValue(new Error('RPC failed'));
    render(<UsersTab tenantId="t1" />);

    await waitFor(() =>
      expect(screen.getByTestId('users-tab-error')).toBeInTheDocument()
    );
    expect(adminToast.error).toHaveBeenCalledWith(
      expect.stringContaining('Gagal'),
      expect.any(String)
    );
  });

  it('calls listTenantUsersAdmin with the correct tenantId', async () => {
    listMock.mockResolvedValue([ownerRow]);
    render(<UsersTab tenantId="tenant-xyz" />);

    await waitFor(() => expect(listMock).toHaveBeenCalledWith('tenant-xyz'));
  });
});
