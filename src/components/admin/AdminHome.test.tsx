// src/components/admin/AdminHome.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AdminHome } from './AdminHome';

const dashboardMock = vi.fn();
const tenantsMock = vi.fn();
const auditMock = vi.fn();

vi.mock('../../lib/adminApi', () => ({
  getPlatformDashboardStats: () => dashboardMock(),
  listTenantsAdmin: () => tenantsMock(),
  listAuditEvents: () => auditMock(),
}));

vi.mock('../../lib/adminToast', () => ({
  adminToast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

// Minimal tenant fixture matching AdminTenantRow
const garindoTenant = {
  tenant_id: 'g1',
  slug: 'garindo',
  name: 'Garindo',
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
  last_login_at: null,
  txn_7d: 120,
  avg_daily_txn: 17,
  usage_status: 'AKTIF' as const,
  total_count: 1,
};

const apotekTenant = {
  ...garindoTenant,
  tenant_id: 't2',
  slug: 'apotek-sehat',
  name: 'Apotek Sehat',
  plan_code: 'PRO' as const,
  days_until_expiry: 30,
  expires_at: '2026-08-04',
  total_count: 2,
};

describe('AdminHome', () => {
  beforeEach(() => {
    dashboardMock.mockReset();
    tenantsMock.mockReset();
    auditMock.mockReset();
  });

  // ── Happy path: multiple tenants ─────────────────────────────────────────────

  it('shows KPI cards after loading', async () => {
    dashboardMock.mockResolvedValue({
      tenants_total: 2,
      active_count: 2,
      suspended_count: 0,
      expiring_45d: 1,
      plans_count: 3,
      pending_imports: 0,
    });
    tenantsMock.mockResolvedValue([garindoTenant, apotekTenant]);
    auditMock.mockResolvedValue([]);

    render(<AdminHome />);

    await waitFor(() => {
      expect(screen.getByText('Tenant aktif')).toBeInTheDocument();
      expect(screen.getByText('Total tenant')).toBeInTheDocument();
      expect(screen.getByText('Kedaluwarsa 45 hari')).toBeInTheDocument();
    });

    // KPI values: active_count=2 and tenants_total=2
    const twos = screen.getAllByText('2');
    expect(twos.length).toBeGreaterThanOrEqual(1);
  });

  it('shows attention queue with expiring tenant', async () => {
    dashboardMock.mockResolvedValue({
      tenants_total: 2,
      active_count: 2,
      suspended_count: 0,
      expiring_45d: 1,
      plans_count: 3,
      pending_imports: 0,
    });
    tenantsMock.mockResolvedValue([garindoTenant, apotekTenant]);
    auditMock.mockResolvedValue([]);

    render(<AdminHome />);

    await waitFor(() => {
      expect(screen.getByText('Apotek Sehat')).toBeInTheDocument();
    });
  });

  // ── Empty state: single tenant ───────────────────────────────────────────────

  it('shows EmptyHomeState when only 1 tenant (tenants_total=1)', async () => {
    dashboardMock.mockResolvedValue({
      tenants_total: 1,
      active_count: 1,
      suspended_count: 0,
      expiring_45d: 0,
      plans_count: 3,
      pending_imports: 0,
    });
    tenantsMock.mockResolvedValue([garindoTenant]);
    auditMock.mockResolvedValue([]);

    render(<AdminHome />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-home-state')).toBeInTheDocument();
      expect(screen.getByText(/Ayo onboard tenant kedua/)).toBeInTheDocument();
    });
  });

  it('shows "Semua tenteram" in attention queue when no issues', async () => {
    dashboardMock.mockResolvedValue({
      tenants_total: 1,
      active_count: 1,
      suspended_count: 0,
      expiring_45d: 0,
      plans_count: 3,
      pending_imports: 0,
    });
    tenantsMock.mockResolvedValue([garindoTenant]);
    auditMock.mockResolvedValue([]);

    render(<AdminHome />);

    await waitFor(() => {
      expect(screen.getByTestId('attention-queue-empty')).toBeInTheDocument();
      expect(screen.getByText(/Semua tenteram/)).toBeInTheDocument();
    });
  });

  it('shows "Belum ada aktivitas" when audit events empty', async () => {
    dashboardMock.mockResolvedValue({
      tenants_total: 1,
      active_count: 1,
      suspended_count: 0,
      expiring_45d: 0,
      plans_count: 3,
      pending_imports: 0,
    });
    tenantsMock.mockResolvedValue([garindoTenant]);
    auditMock.mockResolvedValue([]);

    render(<AdminHome />);

    await waitFor(() => {
      expect(screen.getByTestId('activity-feed-empty')).toBeInTheDocument();
      expect(screen.getByText('Belum ada aktivitas')).toBeInTheDocument();
    });
  });

  // ── Loading state ────────────────────────────────────────────────────────────

  it('shows loading skeleton while fetching', () => {
    // Promises that never resolve (simulates in-flight requests)
    dashboardMock.mockReturnValue(new Promise(() => {}));
    tenantsMock.mockReturnValue(new Promise(() => {}));
    auditMock.mockReturnValue(new Promise(() => {}));

    render(<AdminHome />);

    expect(screen.getByTestId('admin-home-loading')).toBeInTheDocument();
    // KPI cards are not yet rendered
    expect(screen.queryByText('Tenant aktif')).not.toBeInTheDocument();
  });

  // ── Error state ──────────────────────────────────────────────────────────────

  it('shows error state with retry button when fetch fails', async () => {
    dashboardMock.mockRejectedValue(new Error('network failure'));
    tenantsMock.mockResolvedValue([]);
    auditMock.mockResolvedValue([]);

    render(<AdminHome />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-home-error')).toBeInTheDocument();
    });

    expect(screen.getByText(/Gagal memuat dashboard/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Coba lagi/ })).toBeInTheDocument();
  });

  it('retry button triggers re-fetch', async () => {
    dashboardMock.mockRejectedValueOnce(new Error('first fail'));
    tenantsMock.mockResolvedValue([]);
    auditMock.mockResolvedValue([]);

    render(<AdminHome />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-home-error')).toBeInTheDocument();
    });

    // Set up successful response for retry
    dashboardMock.mockResolvedValue({
      tenants_total: 1,
      active_count: 1,
      suspended_count: 0,
      expiring_45d: 0,
      plans_count: 3,
      pending_imports: 0,
    });
    tenantsMock.mockResolvedValue([garindoTenant]);
    auditMock.mockResolvedValue([]);

    fireEvent.click(screen.getByRole('button', { name: /Coba lagi/ }));

    await waitFor(() => {
      expect(screen.getByText('Tenant aktif')).toBeInTheDocument();
    });
  });
});
