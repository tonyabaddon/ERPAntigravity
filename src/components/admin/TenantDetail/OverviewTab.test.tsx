// src/components/admin/TenantDetail/OverviewTab.test.tsx
// Covers: 4-quadrant renders, NULL fields → em-dash, feature list enabled/disabled.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { OverviewTab } from './OverviewTab';
import type { AdminTenantRow } from '../../../lib/adminTypes';

// ─── Mock adminApi ────────────────────────────────────────────────────────────

const overviewExtrasMock = vi.fn();

vi.mock('../../../lib/adminApi', () => ({
  getTenantOverviewExtras: (id: string) => overviewExtrasMock(id),
  // RenewSubscriptionModal (imported by OverviewTab) also calls renewSubscription
  renewSubscription: vi.fn(),
}));

// Stub sonner/adminToast — OverviewTab now imports RenewSubscriptionModal which
// imports adminToast → sonner. sonner is a runtime dep, not installed in test env.
vi.mock('../../../lib/adminToast', () => ({
  adminToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseTenant: AdminTenantRow = {
  tenant_id: 't1',
  slug: 'apotek-sehat',
  name: 'Apotek Sehat',
  plan_code: 'PRO',
  status: 'ACTIVE',
  expiry_mode: 'ACTIVE',
  activated_at: '2026-07-04',
  expires_at: '2026-08-18',
  days_until_expiry: 45,
  user_count: 1,
  sku_count: 234,
  industry: 'Apotek/Farmasi',
  employee_range: '4-19 orang (Kecil)',
  onboarded_at: '2026-07-04T09:15:00Z',
  last_login_at: '2026-07-01T08:00:00Z',
  txn_7d: 42,
  avg_daily_txn: 6,
  usage_status: 'AKTIF',
  total_count: 1,
};

const fullExtras = {
  annual_revenue_range: '300 juta - 2.5 miliar (Kecil)',
  effective_features: {
    modul_kasir: true,
    modul_tempo: true,
    modul_akuntansi: false,
    modul_bom_recipe: false,
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OverviewTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    overviewExtrasMock.mockResolvedValue(fullExtras);
  });

  it('renders all four quadrant panels', async () => {
    render(<OverviewTab tenant={baseTenant} />);

    await waitFor(() =>
      expect(screen.queryByText('Memuat fitur…')).not.toBeInTheDocument()
    );

    // Panel headings (uppercase via CSS, matched case-insensitively via regex)
    expect(screen.getByText(/profil/i)).toBeInTheDocument();
    expect(screen.getByText(/paket & masa aktif/i)).toBeInTheDocument();
    expect(screen.getByText(/aktivitas/i)).toBeInTheDocument();
    expect(screen.getByText(/fitur aktif/i)).toBeInTheDocument();
  });

  it('shows industry and employee_range chips', async () => {
    render(<OverviewTab tenant={baseTenant} />);
    await waitFor(() =>
      expect(screen.queryByText('Memuat fitur…')).not.toBeInTheDocument()
    );
    expect(screen.getByText('Apotek/Farmasi')).toBeInTheDocument();
    expect(screen.getByText('4-19 orang (Kecil)')).toBeInTheDocument();
  });

  it('shows annual_revenue_range from extras', async () => {
    render(<OverviewTab tenant={baseTenant} />);
    await waitFor(() =>
      expect(screen.getByText('300 juta - 2.5 miliar (Kecil)')).toBeInTheDocument()
    );
  });

  it('shows amber/danger highlight with day count when expires_at within 45d', async () => {
    render(<OverviewTab tenant={baseTenant} />);
    await waitFor(() =>
      expect(screen.queryByText('Memuat fitur…')).not.toBeInTheDocument()
    );
    // expires_at text
    expect(screen.getByText(/2026-08-18/)).toBeInTheDocument();
    // days countdown
    expect(screen.getByText(/45d/)).toBeInTheDocument();
  });

  it('renders NULL industry + employee_range as em-dash with Belum diisi tooltip', async () => {
    const nullTenant: AdminTenantRow = {
      ...baseTenant,
      industry: null,
      employee_range: null,
    };
    overviewExtrasMock.mockResolvedValue({
      annual_revenue_range: null,
      effective_features: null,
    });
    render(<OverviewTab tenant={nullTenant} />);
    await waitFor(() =>
      expect(screen.queryByText('Memuat fitur…')).not.toBeInTheDocument()
    );
    // Multiple em-dashes should exist for the null fields
    const emDashes = screen.getAllByTitle('Belum diisi');
    expect(emDashes.length).toBeGreaterThanOrEqual(3); // industry, employee_range, annual_revenue_range
  });

  it('renders enabled features with success indicator and disabled with muted text', async () => {
    render(<OverviewTab tenant={baseTenant} />);
    await waitFor(() => {
      expect(screen.getByText('Kasir (POS)')).toBeInTheDocument();
      expect(screen.getByText('Akuntansi')).toBeInTheDocument();
    });
    // Disabled features should show "nonaktif" label
    const nonaktifLabels = screen.getAllByText('nonaktif');
    expect(nonaktifLabels.length).toBe(2); // modul_akuntansi + modul_bom_recipe
  });

  it('shows "Data fitur tidak tersedia" when features are null', async () => {
    overviewExtrasMock.mockResolvedValue({
      annual_revenue_range: null,
      effective_features: null,
    });
    render(<OverviewTab tenant={baseTenant} />);
    await waitFor(() =>
      expect(screen.getByText('Data fitur tidak tersedia.')).toBeInTheDocument()
    );
  });

  it('calls getTenantOverviewExtras with the correct tenant_id', async () => {
    render(<OverviewTab tenant={baseTenant} />);
    await waitFor(() =>
      expect(overviewExtrasMock).toHaveBeenCalledWith('t1')
    );
  });
});
