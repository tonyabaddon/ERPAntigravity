import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RevenueTopTenants } from './RevenueTopTenants';
import type { RevenueStats } from '../../lib/paymentsTypes';
import type { AdminTenantRow } from '../../lib/adminTypes';

function makeTrend() {
  return Array.from({ length: 12 }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, '0')}`,
    total: 0,
  }));
}

const tenant1: AdminTenantRow = {
  tenant_id: 't1',
  slug: 'garindo',
  name: 'Garindo',
  plan_code: 'PREMIUM',
  status: 'ACTIVE',
  expiry_mode: 'ACTIVE',
  activated_at: '2024-01-01',
  expires_at: '2099-12-31',
  days_until_expiry: 26000,
  user_count: 3,
  sku_count: 100,
  industry: null,
  employee_range: null,
  onboarded_at: '2024-01-01',
  last_login_at: null,
  txn_7d: 10,
  avg_daily_txn: 1,
  usage_status: 'AKTIF',
  total_count: 2,
};

const tenant2: AdminTenantRow = {
  ...tenant1,
  tenant_id: 't2',
  slug: 'apotek',
  name: 'Apotek Sehat',
  plan_code: 'PRO',
};

const tenantStats: RevenueStats = {
  total: 10_000_000,
  breakdown: [
    { key: 't1', amount: 7_000_000, count: 7 },
    { key: 't2', amount: 3_000_000, count: 3 },
  ],
  monthly_trend: makeTrend(),
};

const emptyStats: RevenueStats = {
  total: 0,
  breakdown: [],
  monthly_trend: makeTrend(),
};

describe('RevenueTopTenants', () => {
  let originalLocation: Location;

  beforeEach(() => {
    originalLocation = window.location;
    // jsdom doesn't allow direct assignment to window.location.href in vitest
    // so we use a spy approach
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    });
  });

  it('renders section title', () => {
    render(
      <RevenueTopTenants
        tenantStats={tenantStats}
        allTenants={[tenant1, tenant2]}
      />,
    );
    expect(screen.getByText('Tenant teratas')).toBeInTheDocument();
  });

  it('renders top tenants sorted by revenue descending', () => {
    render(
      <RevenueTopTenants
        tenantStats={tenantStats}
        allTenants={[tenant1, tenant2]}
      />,
    );
    // Garindo has higher revenue so rank #1
    const rows = screen.getAllByRole('row');
    // rows[0] = thead, rows[1] = Garindo (rank 1), rows[2] = Apotek (rank 2)
    expect(rows[1]).toHaveTextContent('Garindo');
    expect(rows[2]).toHaveTextContent('Apotek Sehat');
  });

  it('renders revenue amounts formatted as IDR', () => {
    render(
      <RevenueTopTenants
        tenantStats={tenantStats}
        allTenants={[tenant1, tenant2]}
      />,
    );
    expect(screen.getByText('Rp 7.000.000')).toBeInTheDocument();
    expect(screen.getByText('Rp 3.000.000')).toBeInTheDocument();
  });

  it('renders plan badges', () => {
    render(
      <RevenueTopTenants
        tenantStats={tenantStats}
        allTenants={[tenant1, tenant2]}
      />,
    );
    expect(screen.getByText('PREMIUM')).toBeInTheDocument();
    expect(screen.getByText('PRO')).toBeInTheDocument();
  });

  it('renders coverage badges when coverageMap provided', () => {
    render(
      <RevenueTopTenants
        tenantStats={tenantStats}
        allTenants={[tenant1, tenant2]}
        coverageMap={{ t1: 'LUNAS', t2: 'OVERDUE' }}
      />,
    );
    expect(screen.getByText('Lunas')).toBeInTheDocument();
    expect(screen.getByText('Terlambat')).toBeInTheDocument();
  });

  it('navigates to tenant pembayaran tab on row click', () => {
    render(
      <RevenueTopTenants
        tenantStats={tenantStats}
        allTenants={[tenant1, tenant2]}
      />,
    );
    const firstDataRow = screen.getByRole('row', { name: /Garindo/ });
    fireEvent.click(firstDataRow);
    expect(window.location.href).toBe('/admin/tenants/garindo?tab=pembayaran');
  });

  it('renders empty state when no revenue data', () => {
    render(
      <RevenueTopTenants
        tenantStats={emptyStats}
        allTenants={[tenant1, tenant2]}
      />,
    );
    expect(screen.getByTestId('top-tenants-empty')).toBeInTheDocument();
  });

  it('limits to top 10 tenants', () => {
    // Create 15 tenants + stats
    const manyTenants: AdminTenantRow[] = Array.from({ length: 15 }, (_, i) => ({
      ...tenant1,
      tenant_id: `t${i}`,
      slug: `tenant-${i}`,
      name: `Tenant ${i}`,
    }));
    const manyStats: RevenueStats = {
      total: 15_000_000,
      breakdown: manyTenants.map((t, i) => ({
        key: t.tenant_id,
        amount: (15 - i) * 100_000,
        count: 1,
      })),
      monthly_trend: makeTrend(),
    };
    render(
      <RevenueTopTenants
        tenantStats={manyStats}
        allTenants={manyTenants}
      />,
    );
    // Should render exactly 10 data rows (tbody rows) + 1 header = 11 total
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBe(11); // 1 header + 10 data
  });
});
