/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PelangganScreen from './PelangganScreen';
import * as supabaseClientModule from '../lib/supabaseClient';
import * as pengaturanServicesModule from '../lib/pengaturan/pengaturanServices';

// ── mocks ────────────────────────────────────────────────────────────────────

vi.mock('../lib/supabaseClient', async (importOriginal) => {
  const original = await importOriginal<typeof supabaseClientModule>();
  return {
    ...original,
    isSupabaseConfigured: true,
    customersService: {
      fetchAll: vi.fn(),
      fetchProfile: vi.fn(),
      updateNameCompany: vi.fn(),
      updateTier: vi.fn(),
      createCustomer: vi.fn(),
    },
  };
});

vi.mock('../lib/pengaturan/pengaturanServices', () => ({
  tenantSettingsService: {
    fetch: vi.fn(),
  },
}));

// ── fixtures ──────────────────────────────────────────────────────────────────

const BASE_SETTINGS = {
  id: 1,
  tenant_id: null,
  modul_kasir: true,
  modul_tempo: true,
  modul_pengiriman: true,
  modul_multi_warehouse: true,
  modul_akuntansi: true,
  modul_jasa_layanan: true,
  modul_bom_recipe: false,
  modul_diskon_kasir: false,
  modul_diskon_penjualan: false,
  modul_diskon_tagihan: false,
  modul_multi_tier_price: false,
  pajak_mode: 'NO_TAX' as const,
  pajak_ppn_rate_umum: 0,
  pajak_ppn_rate_mewah: 0,
  pajak_final_rate: 0,
  pajak_umkm_jenis_badan: null,
  pajak_umkm_terdaftar_at: null,
  pajak_umkm_expires_at: null,
  pajak_npwp: null,
  pajak_nik_as_npwp: false,
  pajak_efaktur_enabled: false,
  pajak_pkp_registered_at: null,
  pajak_coretax_id: null,
  pajak_regulation_year: 2026,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  updated_by: null,
};

const makeCustomer = (overrides = {}) => ({
  id: 'cust-1',
  wa_number: '628123456789',
  name: 'Budi Santoso',
  company: 'PT Maju Jaya',
  address: null,
  created_at: '2026-01-01T00:00:00Z',
  allows_tempo: false,
  term_days: 0,
  credit_limit: 0,
  tempo_activated_at: null,
  tempo_activated_by: null,
  default_pricing_tier: 'eceran' as const,
  order_count: 2,
  total_spend: 500000,
  ...overrides,
});

const ECERAN_CUSTOMER = makeCustomer({ id: 'cust-1', name: 'Budi Santoso', default_pricing_tier: 'eceran' });
const GROSIR_CUSTOMER = makeCustomer({ id: 'cust-2', name: 'Toko Grosir ABC', wa_number: '628999888777', default_pricing_tier: 'grosir' });
const ECERAN_CUSTOMER_2 = makeCustomer({ id: 'cust-3', name: 'Rina Wijaya', wa_number: '628111222333', default_pricing_tier: 'eceran' });

const BASE_PROPS = {
  onNavigate: vi.fn(),
  showToast: vi.fn(),
};

// ── tests ─────────────────────────────────────────────────────────────────────

describe('PelangganScreen — tier dropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (supabaseClientModule.customersService.fetchAll as ReturnType<typeof vi.fn>).mockResolvedValue([ECERAN_CUSTOMER]);
  });

  it('modul OFF → tier filter chips and tier badges hidden', async () => {
    (pengaturanServicesModule.tenantSettingsService.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...BASE_SETTINGS,
      modul_multi_tier_price: false,
    });

    render(<PelangganScreen {...BASE_PROPS} />);

    // Wait for customers to load
    await screen.findByText('Budi Santoso');

    // Tier filter chips should not be visible
    expect(screen.queryByRole('button', { name: /Eceran/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Grosir/i })).not.toBeInTheDocument();
    // Tier badge in list should not be visible (looking for the small badge text)
    // The word "Eceran" and "Grosir" as tier badges should not appear
    const eceranBadges = screen.queryAllByText('Eceran');
    expect(eceranBadges).toHaveLength(0);
  });

  it('modul ON → tier dropdown shows eceran default when editing', async () => {
    (pengaturanServicesModule.tenantSettingsService.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...BASE_SETTINGS,
      modul_multi_tier_price: true,
    });

    // Mock fetchProfile to return a profile for the customer
    (supabaseClientModule.customersService.fetchProfile as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...ECERAN_CUSTOMER,
      orders: [],
      leads: [],
      kasir_transactions: [],
    });

    render(<PelangganScreen {...BASE_PROPS} />);

    // Wait for customers list and select the customer
    await screen.findByText('Budi Santoso');
    fireEvent.click(screen.getByText('Budi Santoso'));

    // Wait for profile to load and edit button to appear
    const editBtn = await screen.findByRole('button', { name: /Edit/i });
    fireEvent.click(editBtn);

    // Tier dropdown should be visible with aria-label
    const tierSelect = await screen.findByRole('combobox', { name: /Tier Harga Default/i });
    expect((tierSelect as HTMLSelectElement).value).toBe('eceran');
  });

  it('modul ON + filter=Grosir → only grosir customers visible', async () => {
    (pengaturanServicesModule.tenantSettingsService.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...BASE_SETTINGS,
      modul_multi_tier_price: true,
    });

    (supabaseClientModule.customersService.fetchAll as ReturnType<typeof vi.fn>).mockResolvedValue([
      ECERAN_CUSTOMER,
      GROSIR_CUSTOMER,
      ECERAN_CUSTOMER_2,
    ]);

    render(<PelangganScreen {...BASE_PROPS} />);

    // Wait for all customers to load
    await screen.findByText('Budi Santoso');
    await screen.findByText('Toko Grosir ABC');
    await screen.findByText('Rina Wijaya');

    // Click the Grosir filter chip
    const grosirFilter = await screen.findByRole('button', { name: /^Grosir$/i });
    fireEvent.click(grosirFilter);

    // After filtering: only Grosir customer visible
    await waitFor(() => {
      expect(screen.queryByText('Budi Santoso')).not.toBeInTheDocument();
      expect(screen.queryByText('Rina Wijaya')).not.toBeInTheDocument();
      expect(screen.getByText('Toko Grosir ABC')).toBeInTheDocument();
    });
  });
});
