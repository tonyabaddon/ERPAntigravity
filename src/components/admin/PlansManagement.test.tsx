// src/components/admin/PlansManagement.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { PlansManagement } from './PlansManagement';

vi.mock('../../lib/adminPlansApi', () => ({
  listPlansAdmin: vi.fn().mockResolvedValue([
    {
      code: 'STARTER',
      name: 'Starter',
      description: 'Warung / kios kecil dengan operasi minimal',
      target_segment: 'MSME 1-3 karyawan',
      is_recommended: false,
      feature_bundle: { modul_kasir: true, modul_akuntansi: true, modul_pengiriman: true },
      sort_order: 1,
      tenant_count: 0,
    },
    {
      code: 'PRO',
      name: 'Pro',
      description: 'Toko retail dengan tempo + accounting',
      target_segment: 'MSME 5-15 karyawan',
      is_recommended: true,
      feature_bundle: {
        modul_kasir: true, modul_tempo: true, modul_akuntansi: true, modul_pengiriman: true,
        modul_diskon_kasir: true, modul_diskon_penjualan: true, modul_diskon_tagihan: true,
      },
      sort_order: 2,
      tenant_count: 1,
    },
    {
      code: 'PREMIUM',
      name: 'Premium',
      description: 'Distributor / manufaktur multi-gudang',
      target_segment: 'B2B 20+ karyawan',
      is_recommended: false,
      feature_bundle: {
        modul_kasir: true, modul_tempo: true, modul_akuntansi: true, modul_pengiriman: true,
        modul_multi_warehouse: true, modul_bom_recipe: true, modul_multi_tier_price: true,
        modul_jasa_layanan: true, modul_diskon_kasir: true, modul_diskon_penjualan: true,
        modul_diskon_tagihan: true,
      },
      sort_order: 3,
      tenant_count: 1,
    },
  ]),
}));

vi.mock('../../lib/adminToast', () => ({
  adminToast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

describe('PlansManagement', () => {
  it('renders 3 plan cards (STARTER, PRO, PREMIUM)', async () => {
    render(<PlansManagement />);
    await waitFor(() => expect(screen.getByText('STARTER')).toBeInTheDocument());
    expect(screen.getByText('PRO')).toBeInTheDocument();
    expect(screen.getByText('PREMIUM')).toBeInTheDocument();
  });

  it('shows PALING POPULER ribbon only on PRO card', async () => {
    render(<PlansManagement />);
    await waitFor(() => expect(screen.getByTestId('paling-populer-ribbon')).toBeInTheDocument());
    const ribbon = screen.getByTestId('paling-populer-ribbon');
    expect(ribbon).toHaveTextContent('PALING POPULER');
    // Only one ribbon exists
    expect(screen.getAllByTestId('paling-populer-ribbon')).toHaveLength(1);
  });

  it('renders feature bullet list for each plan', async () => {
    render(<PlansManagement />);
    await waitFor(() => expect(screen.getByTestId('feature-list-STARTER')).toBeInTheDocument());

    const starterList = screen.getByTestId('feature-list-STARTER');
    expect(within(starterList).getByText('Kasir (POS)')).toBeInTheDocument();
    expect(within(starterList).getByText('Akuntansi')).toBeInTheDocument();
    expect(within(starterList).getByText('Pengiriman')).toBeInTheDocument();

    const proList = screen.getByTestId('feature-list-PRO');
    expect(within(proList).getByText('Penjualan Tempo')).toBeInTheDocument();

    const premiumList = screen.getByTestId('feature-list-PREMIUM');
    expect(within(premiumList).getByText('Multi-Gudang')).toBeInTheDocument();
    expect(within(premiumList).getByText('BOM & Resep')).toBeInTheDocument();
  });

  it('renders disabled edit CTA on all cards with Wave 4a tooltip', async () => {
    render(<PlansManagement />);
    await waitFor(() => expect(screen.getByTestId('edit-btn-STARTER')).toBeInTheDocument());

    const starterBtn = screen.getByTestId('edit-btn-STARTER');
    expect(starterBtn).toBeDisabled();
    expect(starterBtn).toHaveAttribute('title', 'Tersedia di Wave 4a');

    const proBtn = screen.getByTestId('edit-btn-PRO');
    expect(proBtn).toBeDisabled();

    const premiumBtn = screen.getByTestId('edit-btn-PREMIUM');
    expect(premiumBtn).toBeDisabled();
  });

  it('shows tenant count for each plan', async () => {
    render(<PlansManagement />);
    await waitFor(() => expect(screen.getByText('STARTER')).toBeInTheDocument());
    expect(screen.getByText(/0 tenant aktif/)).toBeInTheDocument();
    // PRO + PREMIUM both have 1 tenant (2 instances)
    expect(screen.getAllByText(/1 tenant aktif/)).toHaveLength(2);
  });

  it('shows heading Paket (3)', async () => {
    render(<PlansManagement />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Paket (3)')
    );
  });
});
