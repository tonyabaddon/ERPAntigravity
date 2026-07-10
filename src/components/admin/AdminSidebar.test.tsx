import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AdminSidebar } from './AdminSidebar';

// Mock adminAuth so the sidebar's isSuperAdmin() call is controllable in tests.
vi.mock('../../lib/adminAuth', () => ({
  isSuperAdmin: vi.fn(),
}));

import { isSuperAdmin } from '../../lib/adminAuth';

beforeEach(() => {
  // Default: super_admin — existing tests continue to pass (all 7 items visible).
  vi.mocked(isSuperAdmin).mockResolvedValue(true);
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

  it('renders VOSI Admin brand text', () => {
    render(<AdminSidebar activePath="/admin" />);
    expect(screen.getByText('VOSI Admin')).toBeInTheDocument();
  });

  it('super_admin sees all 7 nav items including Paket and Pendapatan', async () => {
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

  it('sales_rep sees only 5 items (Paket and Pendapatan hidden)', async () => {
    vi.mocked(isSuperAdmin).mockResolvedValue(false);
    render(<AdminSidebar activePath="/admin" />);
    await waitFor(() => {
      expect(screen.queryByText('Paket')).not.toBeInTheDocument();
      expect(screen.queryByText('Pendapatan')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Beranda')).toBeInTheDocument();
    expect(screen.getByText('Tenant')).toBeInTheDocument();
    expect(screen.getByText('Log aktivitas')).toBeInTheDocument();
    expect(screen.getByText('Pengaturan')).toBeInTheDocument();
    expect(screen.getByText('Bantuan')).toBeInTheDocument();
  });
});
