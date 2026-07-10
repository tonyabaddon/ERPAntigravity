// src/components/admin/TenantDetail/TenantDetailShell.test.tsx
// Unit tests for TenantDetailShell:
//   1. Fetches tenant and renders header + 3-tab strip
//   2. Tab switching updates URL and renders correct panel
//   3. Not-found state renders "Tenant tidak ditemukan"
//   4. Distinct loading vs not-found states
//   5. TenantDangerZone visible for super_admin, hidden for sales_rep
// C1 fix: prop renamed tenantId→tenantSlug; lookup now by slug not tenant_id UUID.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TenantDetailShell } from './TenantDetailShell';
import type { AdminTenantRow } from '../../../lib/adminTypes';

const tenantsMock   = vi.fn();
const isSuperAdminMock = vi.fn();

vi.mock('../../../lib/adminApi', () => ({
  listTenantsAdmin: (f: unknown) => tenantsMock(f),
  // OverviewTab (Task 11) calls this; resolve with empty extras so it doesn't hang.
  getTenantOverviewExtras: () =>
    Promise.resolve({ annual_revenue_range: null, effective_features: null }),
  // UsersTab (Task 12) calls this; resolve with empty array so it renders quickly.
  listTenantUsersAdmin: () => Promise.resolve([]),
  // AuditTab (Task 13) calls this; resolve with empty array so it renders quickly.
  listAuditEvents: () => Promise.resolve([]),
}));

vi.mock('../../../lib/adminAuth', () => ({
  isSuperAdmin: () => isSuperAdminMock(),
}));

vi.mock('../../../lib/adminToast', () => ({
  adminToast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

// ─── Fixture ──────────────────────────────────────────────────────────────────

const fakeTenant: AdminTenantRow = {
  tenant_id: 'tid-001',
  slug: 'garindo-jaya',
  name: 'Garindo Jaya',
  plan_code: 'PREMIUM',
  status: 'ACTIVE',
  expiry_mode: 'ACTIVE',
  activated_at: '2024-01-01',
  expires_at: '2099-12-31',
  days_until_expiry: 26000,
  user_count: 5,
  sku_count: 466,
  industry: 'Retail',
  employee_range: '4-19 orang (Kecil)',
  onboarded_at: '2024-01-01',
  last_login_at: null,
  txn_7d: 20,
  avg_daily_txn: 3,
  usage_status: 'AKTIF',
  total_count: 1,
};

// ─── URL helpers ──────────────────────────────────────────────────────────────

function setSearch(search: string) {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: {
      ...window.location,
      href: `http://localhost/admin/tenants/tid-001${search}`,
      search,
    },
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TenantDetailShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: non-super-admin (sales_rep) — safe default hides danger zone
    isSuperAdminMock.mockResolvedValue(false);
    // Reset URL to no tab param
    setSearch('');
  });

  afterEach(() => {
    // Clean up any popstate listeners
  });

  it('shows loading state before fetch resolves', () => {
    // Never-resolving promise keeps us in loading
    tenantsMock.mockReturnValue(new Promise(() => {}));
    render(<TenantDetailShell tenantSlug="garindo-jaya" />);
    expect(screen.getByTestId('tenant-detail-loading')).toBeInTheDocument();
  });

  it('fetches tenant by slug and renders header + tab strip', async () => {
    tenantsMock.mockResolvedValue([fakeTenant]);
    render(<TenantDetailShell tenantSlug="garindo-jaya" />);

    await waitFor(() =>
      expect(screen.getByTestId('tenant-detail-shell')).toBeInTheDocument()
    );

    // Header — name + plan appear in both header and OverviewTab; check header specifically
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Garindo Jaya');
    expect(heading).toHaveTextContent('PREMIUM');

    // Tab strip (Bahasa Indonesia labels)
    expect(screen.getByText('Ringkasan')).toBeInTheDocument();
    expect(screen.getByText('Pengguna')).toBeInTheDocument();
    expect(screen.getByText('Log aktivitas')).toBeInTheDocument();

    // Breadcrumb — slug also appears in OverviewTab, so use getAllByText
    expect(screen.getByText('Tenant')).toBeInTheDocument();
    expect(screen.getAllByText('garindo-jaya').length).toBeGreaterThanOrEqual(1);
  });

  it('shows Ringkasan (overview) tab by default', async () => {
    tenantsMock.mockResolvedValue([fakeTenant]);
    render(<TenantDetailShell tenantSlug="garindo-jaya" />);

    await waitFor(() => screen.getByTestId('tenant-detail-shell'));
    expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
  });

  it('switches to Pengguna tab when clicked (pushState called + event dispatched)', async () => {
    tenantsMock.mockResolvedValue([fakeTenant]);
    render(<TenantDetailShell tenantSlug="garindo-jaya" />);

    await waitFor(() => screen.getByTestId('tenant-detail-shell'));

    // Intercept pushState and simulate the URL change manually
    const pushStateSpy = vi.spyOn(window.history, 'pushState').mockImplementation(
      (_state, _title, url) => {
        // Update search so useSyncExternalStore snapshot reflects the new tab
        const search = String(url ?? '');
        Object.defineProperty(window, 'location', {
          writable: true,
          value: { ...window.location, search },
        });
      }
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Pengguna' }));

    // UsersTab (Task 12 — stub replaced); empty array → empty state rendered
    await waitFor(() =>
      expect(screen.getByTestId('users-tab-empty')).toBeInTheDocument()
    );
    expect(screen.queryByTestId('overview-tab')).not.toBeInTheDocument();

    expect(pushStateSpy).toHaveBeenCalledWith({}, '', '?tab=pengguna');
    pushStateSpy.mockRestore();
  });

  it('switches to Log aktivitas tab when clicked', async () => {
    tenantsMock.mockResolvedValue([fakeTenant]);
    render(<TenantDetailShell tenantSlug="garindo-jaya" />);

    await waitFor(() => screen.getByTestId('tenant-detail-shell'));

    const pushStateSpy = vi.spyOn(window.history, 'pushState').mockImplementation(
      (_state, _title, url) => {
        const search = String(url ?? '');
        Object.defineProperty(window, 'location', {
          writable: true,
          value: { ...window.location, search },
        });
      }
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Log aktivitas' }));

    // AuditTab replaces stub in Task 13 — audit-tab testid (after load) or
    // audit-tab-loading (while fetching) confirms the tab rendered.
    await waitFor(() => {
      const loading = screen.queryByTestId('audit-tab-loading');
      const tab     = screen.queryByTestId('audit-tab');
      expect(loading !== null || tab !== null).toBe(true);
    });

    expect(pushStateSpy).toHaveBeenCalledWith({}, '', '?tab=log-aktivitas');
    pushStateSpy.mockRestore();
  });

  it('shows not-found state when slug does not match any row', async () => {
    tenantsMock.mockResolvedValue([fakeTenant]); // has garindo-jaya, not bogus-slug
    render(<TenantDetailShell tenantSlug="bogus-slug" />);

    await waitFor(() =>
      expect(screen.getByTestId('tenant-not-found')).toBeInTheDocument()
    );
    expect(screen.getByText(/Tenant tidak ditemukan/)).toBeInTheDocument();
    expect(screen.getByText(/bogus-slug/)).toBeInTheDocument();
    // Back link
    expect(screen.getByRole('link', { name: /Kembali ke daftar tenant/ })).toBeInTheDocument();
  });

  it('shows not-found state when API returns empty array', async () => {
    tenantsMock.mockResolvedValue([]);
    render(<TenantDetailShell tenantSlug="garindo-jaya" />);

    await waitFor(() =>
      expect(screen.getByTestId('tenant-not-found')).toBeInTheDocument()
    );
  });

  it('is distinct: loading state has no not-found marker', () => {
    tenantsMock.mockReturnValue(new Promise(() => {}));
    render(<TenantDetailShell tenantSlug="garindo-jaya" />);
    expect(screen.queryByTestId('tenant-not-found')).not.toBeInTheDocument();
    expect(screen.getByTestId('tenant-detail-loading')).toBeInTheDocument();
  });

  it('passes page_size to listTenantsAdmin call (client-side slug find)', async () => {
    tenantsMock.mockResolvedValue([fakeTenant]);
    render(<TenantDetailShell tenantSlug="garindo-jaya" />);
    await waitFor(() => screen.getByTestId('tenant-detail-shell'));
    // Should have been called with page_size (not search: tenantSlug)
    expect(tenantsMock).toHaveBeenCalledWith(expect.objectContaining({ page_size: expect.any(Number) }));
  });

  it('shows TenantDangerZone for super_admin', async () => {
    isSuperAdminMock.mockResolvedValue(true);
    tenantsMock.mockResolvedValue([fakeTenant]);
    render(<TenantDetailShell tenantSlug="garindo-jaya" />);

    await waitFor(() => screen.getByTestId('tenant-detail-shell'));
    await waitFor(() =>
      expect(screen.getByTestId('tenant-danger-zone')).toBeInTheDocument()
    );
    expect(screen.getByText('Zona Bahaya')).toBeInTheDocument();
  });

  it('hides TenantDangerZone for sales_rep', async () => {
    isSuperAdminMock.mockResolvedValue(false);
    tenantsMock.mockResolvedValue([fakeTenant]);
    render(<TenantDetailShell tenantSlug="garindo-jaya" />);

    await waitFor(() => screen.getByTestId('tenant-detail-shell'));
    // Give time for isSuperAdmin async to resolve
    await waitFor(() => expect(isSuperAdminMock).toHaveBeenCalled());
    expect(screen.queryByTestId('tenant-danger-zone')).not.toBeInTheDocument();
  });
});
