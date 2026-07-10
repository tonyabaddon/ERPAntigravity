// src/components/admin/AdminRoutes.test.tsx
// Tests that each /admin/* path renders the correct stub component when the user is admin.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AdminRoutes } from './AdminRoutes';

// Needed for TenantDetailShell (mounted on /admin/tenants/:id)
const tenantsMock = vi.fn();

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() =>
        Promise.resolve({
          data: {
            session: {
              user: { email: 'admin@vosi.app' },
              access_token: buildFakeJwt({ impersonating: false }),
            },
          },
          error: null,
        })
      ),
      signOut: vi.fn(() => Promise.resolve({ error: null })),
    },
  },
  tenantContextService: {
    isPlatformAdmin: vi.fn(() => Promise.resolve(true)),
    stopImpersonation: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../../lib/adminToast', () => ({
  adminToast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../../lib/paymentVerificationApi', () => ({
  paymentVerificationApi: {
    listPending: vi.fn(() => Promise.resolve([])),
    verify: vi.fn(),
    reject: vi.fn(),
  },
}));

vi.mock('../../lib/adminApi', () => ({
  getPlatformDashboardStats: vi.fn(() => Promise.resolve({
    tenants_total: 1, active_count: 1, suspended_count: 0,
    expiring_45d: 0, plans_count: 1, pending_imports: 0,
  })),
  listTenantsAdmin: (f: unknown) => tenantsMock(f),
  listAuditEvents: vi.fn(() => Promise.resolve([])),
  // OverviewTab (Task 11) calls this; resolve with empty extras so it doesn't throw.
  getTenantOverviewExtras: vi.fn(() =>
    Promise.resolve({ annual_revenue_range: null, effective_features: null })
  ),
}));

vi.mock('../../lib/adminPlansApi', () => ({
  listPlansAdmin: vi.fn(() =>
    Promise.resolve([
      { code: 'STARTER', name: 'Starter', description: null, target_segment: null, is_recommended: false, feature_bundle: {}, sort_order: 1, tenant_count: 0 },
      { code: 'PRO', name: 'Pro', description: null, target_segment: null, is_recommended: true, feature_bundle: {}, sort_order: 2, tenant_count: 0 },
      { code: 'PREMIUM', name: 'Premium', description: null, target_segment: null, is_recommended: false, feature_bundle: {}, sort_order: 3, tenant_count: 0 },
    ])
  ),
}));

// Minimal tenant row for route-level smoke test
const garindoRow = {
  tenant_id: 'g1', slug: 'garindo-jaya', name: 'Garindo Jaya',
  plan_code: 'PREMIUM' as const, status: 'ACTIVE' as const,
  expiry_mode: 'ACTIVE' as const, activated_at: '2024-01-01',
  expires_at: '2099-12-31', days_until_expiry: 26000,
  user_count: 3, sku_count: 466, industry: 'Retail',
  employee_range: '4-19 orang (Kecil)' as const,
  onboarded_at: '2024-01-01', last_login_at: null,
  txn_7d: 0, avg_daily_txn: 0, usage_status: 'AKTIF' as const,
  total_count: 1,
};

function buildFakeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fakesig`;
}

function setPathname(path: string) {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...window.location, pathname: path },
  });
}

describe('AdminRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no tenants (safe for non-detail routes; overridden per test)
    tenantsMock.mockResolvedValue([]);
  });

  it('renders AdminHome stub at /admin', async () => {
    setPathname('/admin');
    render(<AdminRoutes />);
    await waitFor(() =>
      expect(screen.getByText(/Beranda Admin.*Task 8/)).toBeInTheDocument()
    );
  });

  it('renders TenantsList stub at /admin/tenants', async () => {
    setPathname('/admin/tenants');
    render(<AdminRoutes />);
    await waitFor(() =>
      expect(screen.getByText(/Daftar Tenant.*Task 9/)).toBeInTheDocument()
    );
  });

  it('renders TenantDetailShell at /admin/tenants/:slug', async () => {
    tenantsMock.mockResolvedValue([garindoRow]);
    setPathname('/admin/tenants/garindo-jaya');
    render(<AdminRoutes />);
    await waitFor(() =>
      expect(screen.getByTestId('tenant-detail-shell')).toBeInTheDocument()
    );
    // Tenant name in header (also in OverviewTab Profil row; check h1)
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Garindo Jaya');
    // Tab strip: scope to tablist to avoid ambiguity with sidebar "Log aktivitas"
    const tablist = screen.getByRole('tablist');
    expect(tablist).toHaveTextContent('Ringkasan');
    expect(tablist).toHaveTextContent('Pengguna');
    expect(tablist).toHaveTextContent('Log aktivitas');
  });

  it('renders AuditLogViewer at /admin/audit', async () => {
    setPathname('/admin/audit');
    render(<AdminRoutes />);
    // AuditLogViewer (Task 13) renders the heading "Log Aktivitas"
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Log Aktivitas' })).toBeInTheDocument()
    );
  });

  it('renders PlansManagement at /admin/plans', async () => {
    setPathname('/admin/plans');
    render(<AdminRoutes />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Paket (3)')
    );
  });
});
