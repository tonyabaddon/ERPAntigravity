import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AdminSidebar } from './AdminSidebar';

// Mock adminAuth so the sidebar's isSuperAdmin() call is controllable in tests.
vi.mock('../../lib/adminAuth', () => ({
  isSuperAdmin: vi.fn(),
}));

// Mock paymentVerificationApi so the sidebar's pendingCount poll doesn't hit Supabase.
vi.mock('../../lib/paymentVerificationApi', () => ({
  paymentVerificationApi: {
    listPending: vi.fn(() => Promise.resolve([])),
  },
}));

import { isSuperAdmin } from '../../lib/adminAuth';
import { paymentVerificationApi } from '../../lib/paymentVerificationApi';

beforeEach(() => {
  // Default: super_admin — existing tests continue to pass (all items visible).
  vi.mocked(isSuperAdmin).mockResolvedValue(true);
  vi.mocked(paymentVerificationApi.listPending).mockResolvedValue([]);
});

describe('AdminSidebar', () => {
  it('renders all top-level nav items in Bahasa Indonesia', () => {
    render(<AdminSidebar activePath="/admin" />);
    expect(screen.getByText('Beranda')).toBeInTheDocument();
    expect(screen.getByText('Tenant')).toBeInTheDocument();
    expect(screen.getByText('Paket')).toBeInTheDocument();
    expect(screen.getByText('Log aktivitas')).toBeInTheDocument();
    expect(screen.getByText('Pengaturan')).toBeInTheDocument();
    expect(screen.getByText('Bantuan')).toBeInTheDocument();
  });

  it('marks Beranda as active when path is /admin (exact match)', () => {
    render(<AdminSidebar activePath="/admin" />);
    const berandaLink = screen.getByText('Beranda').closest('a');
    expect(berandaLink).toHaveAttribute('aria-current', 'page');
  });

  it('does NOT mark Beranda active when on /admin/tenants', () => {
    render(<AdminSidebar activePath="/admin/tenants" />);
    const berandaLink = screen.getByText('Beranda').closest('a');
    expect(berandaLink).not.toHaveAttribute('aria-current', 'page');
  });

  it('marks Tenant as active when on /admin/tenants', () => {
    render(<AdminSidebar activePath="/admin/tenants" />);
    const tenantLink = screen.getByText('Tenant').closest('a');
    expect(tenantLink).toHaveAttribute('aria-current', 'page');
  });

  it('marks Tenant as active when on a nested tenant route', () => {
    render(<AdminSidebar activePath="/admin/tenants/some-tenant-id" />);
    const tenantLink = screen.getByText('Tenant').closest('a');
    expect(tenantLink).toHaveAttribute('aria-current', 'page');
  });

  it('renders Caleo Admin brand text', () => {
    render(<AdminSidebar activePath="/admin" />);
    expect(screen.getByText('Caleo Admin')).toBeInTheDocument();
  });

  it('super_admin sees all nav items including Paket, Pendapatan, and Verifikasi Pembayaran', async () => {
    vi.mocked(isSuperAdmin).mockResolvedValue(true);
    render(<AdminSidebar activePath="/admin" />);
    await waitFor(() => {
      expect(screen.getByText('Paket')).toBeInTheDocument();
      expect(screen.getByText('Pendapatan')).toBeInTheDocument();
    });
    expect(screen.getByText('Beranda')).toBeInTheDocument();
    expect(screen.getByText('Tenant')).toBeInTheDocument();
    expect(screen.getByText('Log aktivitas')).toBeInTheDocument();
    expect(screen.getByText('Pengaturan')).toBeInTheDocument();
    expect(screen.getByText('Bantuan')).toBeInTheDocument();
  });

  it('super_admin sees Verifikasi Pembayaran nav item', async () => {
    vi.mocked(isSuperAdmin).mockResolvedValue(true);
    render(<AdminSidebar activePath="/admin" />);
    await waitFor(() => {
      expect(screen.getByText('Verifikasi Pembayaran')).toBeInTheDocument();
    });
  });

  it('renders pending badge count when listPending returns items (super_admin only)', async () => {
    vi.mocked(isSuperAdmin).mockResolvedValue(true);
    vi.mocked(paymentVerificationApi.listPending).mockResolvedValue([
      {
        id: 'pay-1', tenant_id: 't1', tenant_slug: 'slug', tenant_name: 'T1',
        amount: 100000, payment_method: 'TRANSFER', payment_date: '2026-07-01',
        proof_url: null, bank_reference: null, notes: null,
        amount_anomaly: false, created_at: '2026-07-01T00:00:00Z',
      },
      {
        id: 'pay-2', tenant_id: 't2', tenant_slug: 'slug2', tenant_name: 'T2',
        amount: 200000, payment_method: 'TRANSFER', payment_date: '2026-07-02',
        proof_url: null, bank_reference: null, notes: null,
        amount_anomaly: false, created_at: '2026-07-02T00:00:00Z',
      },
    ]);
    render(<AdminSidebar activePath="/admin" />);
    await waitFor(() => {
      expect(screen.getByTestId('badge--admin-payments-pending')).toBeInTheDocument();
    });
    expect(screen.getByTestId('badge--admin-payments-pending')).toHaveTextContent('2');
  });

  it('sales_rep sees Paket (read-only) but not Pendapatan or Verifikasi Pembayaran', async () => {
    vi.mocked(isSuperAdmin).mockResolvedValue(false);
    render(<AdminSidebar activePath="/admin" />);
    await waitFor(() => {
      expect(screen.getByText('Paket')).toBeInTheDocument();
      expect(screen.queryByText('Pendapatan')).not.toBeInTheDocument();
      expect(screen.queryByText('Verifikasi Pembayaran')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Beranda')).toBeInTheDocument();
    expect(screen.getByText('Tenant')).toBeInTheDocument();
    expect(screen.getByText('Log aktivitas')).toBeInTheDocument();
    expect(screen.getByText('Pengaturan')).toBeInTheDocument();
    expect(screen.getByText('Bantuan')).toBeInTheDocument();
  });
});
