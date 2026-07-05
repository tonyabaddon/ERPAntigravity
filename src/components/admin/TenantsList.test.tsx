// src/components/admin/TenantsList.test.tsx
// Uses fireEvent (no @testing-library/user-event — not installed).
// No MemoryRouter / react-router-dom — project uses native <a href>.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { TenantsList } from './TenantsList';
import { adminToast } from '../../lib/adminToast';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const listMock = vi.fn();
const impersonateMock = vi.fn();

vi.mock('../../lib/adminApi', () => ({
  listTenantsAdmin: (filters: unknown) => listMock(filters),
}));

vi.mock('../../lib/supabaseClient', () => ({
  tenantContextService: {
    impersonateTenant: (slug: string) => impersonateMock(slug),
  },
}));

vi.mock('../../lib/adminToast', () => ({
  adminToast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function fakeTenant(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tenant_id: 't1',
    slug: 'garindo',
    name: 'Garindo Jaya',
    plan_code: 'PREMIUM' as const,
    status: 'ACTIVE' as const,
    expiry_mode: 'ACTIVE' as const,
    activated_at: '2024-01-01',
    expires_at: '2099-12-31',
    days_until_expiry: 26000,
    user_count: 3,
    sku_count: 466,
    industry: 'Retail/Toko umum',
    employee_range: '4-19 orang (Kecil)' as const,
    onboarded_at: '2024-01-01',
    last_login_at: '2026-06-01T10:00:00Z',
    txn_7d: 120,
    avg_daily_txn: 17,
    usage_status: 'AKTIF' as const,
    total_count: 1,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TenantsList', () => {
  beforeEach(() => {
    listMock.mockReset();
    impersonateMock.mockReset();
    vi.mocked(adminToast.error).mockReset();
    vi.mocked(adminToast.success).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders tenant rows after loading', async () => {
    listMock.mockResolvedValue([fakeTenant()]);
    render(<TenantsList />);
    await waitFor(() => expect(screen.getByText('Garindo Jaya')).toBeInTheDocument());
    expect(screen.getByText('garindo')).toBeInTheDocument();
  });

  it('shows empty state when no results', async () => {
    listMock.mockResolvedValue([]);
    render(<TenantsList />);
    await waitFor(() =>
      expect(screen.getByTestId('tenants-empty')).toBeInTheDocument()
    );
    expect(screen.getByText(/Tidak ada tenant ditemukan/)).toBeInTheDocument();
  });

  it('sends search filter to RPC on typing (debounced)', async () => {
    // Use fake timers with advanceTimers so waitFor polling works
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listMock.mockResolvedValue([]);

    render(<TenantsList />);

    // Advance past debounce to let initial fetch complete
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });
    await waitFor(() => expect(listMock).toHaveBeenCalled(), { timeout: 3000 });
    listMock.mockClear();
    listMock.mockResolvedValue([]);

    const search = screen.getByPlaceholderText(/Cari slug/i);
    fireEvent.change(search, { target: { value: 'apotek' } });

    // Advance past debounce
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'apotek' })
      ),
      { timeout: 3000 }
    );
  }, 10000);

  it('filters by plan_code when dropdown changes', async () => {
    listMock.mockResolvedValue([]);
    render(<TenantsList />);
    await waitFor(() => expect(listMock).toHaveBeenCalled(), { timeout: 3000 });
    listMock.mockClear();
    listMock.mockResolvedValue([]);

    const planSelect = screen.getByLabelText(/Filter paket/i);
    await act(async () => {
      fireEvent.change(planSelect, { target: { value: 'PREMIUM' } });
    });

    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ plan_code: 'PREMIUM' })
      ),
      { timeout: 3000 }
    );
  }, 10000);

  it('clicking sort header resends RPC with sort_by', async () => {
    listMock.mockResolvedValue([fakeTenant()]);
    render(<TenantsList />);
    await waitFor(() => expect(screen.getByText('Garindo Jaya')).toBeInTheDocument(), { timeout: 3000 });
    listMock.mockClear();
    listMock.mockResolvedValue([fakeTenant()]);

    // Click a sortable column header — click "Nama" twice to toggle asc→desc
    // (avoids matching the Kedaluwarsa filter option text)
    const namaHeader = screen.getAllByText(/Nama/)[0];
    await act(async () => {
      fireEvent.click(namaHeader);
    });

    // After clicking Nama (already sortBy='name' asc), it should toggle to desc
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ sort_by: 'name', sort_dir: 'desc' })
      ),
      { timeout: 3000 }
    );
  }, 10000);

  it('impersonate button calls RPC on confirm=true', async () => {
    listMock.mockResolvedValue([fakeTenant()]);
    impersonateMock.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<TenantsList />);
    await waitFor(() => expect(screen.getByText('Garindo Jaya')).toBeInTheDocument(), { timeout: 3000 });

    const impersonateBtn = screen.getByTitle(/Impersonasi Garindo Jaya/i);
    await act(async () => {
      fireEvent.click(impersonateBtn);
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(impersonateMock).toHaveBeenCalledWith('garindo'),
      { timeout: 3000 }
    );
  }, 10000);

  it('impersonate cancelled when confirm returns false', async () => {
    listMock.mockResolvedValue([fakeTenant()]);
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<TenantsList />);
    await waitFor(() => expect(screen.getByText('Garindo Jaya')).toBeInTheDocument(), { timeout: 3000 });

    const impersonateBtn = screen.getByTitle(/Impersonasi Garindo Jaya/i);
    fireEvent.click(impersonateBtn);

    expect(impersonateMock).not.toHaveBeenCalled();
  }, 10000);

  it('shows error toast and inline retry on RPC failure', async () => {
    listMock.mockRejectedValue(new Error('network error'));

    render(<TenantsList />);
    await waitFor(() =>
      expect(screen.getByTestId('tenants-error')).toBeInTheDocument(),
      { timeout: 3000 }
    );
    expect(adminToast.error).toHaveBeenCalled();
  }, 10000);

  it('pagination shows next/prev buttons when total_count > PAGE_SIZE', async () => {
    // Return rows with total_count=26
    const rows = Array.from({ length: 26 }, (_, i) =>
      fakeTenant({ tenant_id: `t${i}`, slug: `tenant-${i}`, name: `Tenant ${i}`, total_count: 26 })
    );
    listMock.mockResolvedValue(rows);

    render(<TenantsList />);
    await waitFor(() =>
      expect(screen.getByText(/Halaman 1 dari 2/)).toBeInTheDocument(),
      { timeout: 3000 }
    );

    const nextBtn = screen.getByLabelText(/Halaman selanjutnya/i);
    expect(nextBtn).not.toBeDisabled();

    const prevBtn = screen.getByLabelText(/Halaman sebelumnya/i);
    expect(prevBtn).toBeDisabled();
  }, 10000);
});
