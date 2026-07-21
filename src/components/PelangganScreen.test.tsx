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

// NewCustomerInlineForm dependency mocks
vi.mock('../lib/customers/customerWrappers', () => ({
  insertNewCustomer: vi.fn(),
  requestCustomerCreditActivate: vi.fn(),
}));

vi.mock('../lib/extractErrorMessage', () => ({
  extractErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

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

// ── F5-01: Tambah Pelanggan button + modal ─────────────────────────────────────

describe('PelangganScreen — F5-01 Tambah Pelanggan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Persistent defaults for all F5-01 tests
    (supabaseClientModule.customersService.fetchAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (pengaturanServicesModule.tenantSettingsService.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...BASE_SETTINGS,
      modul_multi_tier_price: false,
    });
  });

  it('renders "+ Tambah Pelanggan" button in header', async () => {
    render(<PelangganScreen {...BASE_PROPS} />);
    // Wait for the screen to finish initial load
    await waitFor(() => expect(supabaseClientModule.customersService.fetchAll).toHaveBeenCalled());
    const btn = screen.getByRole('button', { name: /tambah pelanggan/i });
    expect(btn).toBeInTheDocument();
  });

  it('clicking button opens the Tambah Pelanggan modal', async () => {
    render(<PelangganScreen {...BASE_PROPS} />);
    await waitFor(() => expect(supabaseClientModule.customersService.fetchAll).toHaveBeenCalled());
    const btn = screen.getByRole('button', { name: /tambah pelanggan/i });
    fireEvent.click(btn);
    // Modal heading visible
    expect(screen.getByText('Tambah Pelanggan Baru')).toBeInTheDocument();
    // NewCustomerInlineForm renders inside modal (check for "Customer Baru" heading from the form)
    expect(screen.getByText('Customer Baru')).toBeInTheDocument();
    // Simpan & Pilih button exists inside modal
    expect(screen.getByRole('button', { name: /simpan/i })).toBeInTheDocument();
  });

  it('clicking Tutup (×) button in modal closes it', async () => {
    render(<PelangganScreen {...BASE_PROPS} />);
    await waitFor(() => expect(supabaseClientModule.customersService.fetchAll).toHaveBeenCalled());
    const btn = screen.getByRole('button', { name: /tambah pelanggan/i });
    fireEvent.click(btn);
    expect(screen.getByText('Tambah Pelanggan Baru')).toBeInTheDocument();
    // Click the X (Tutup) button in the modal header
    fireEvent.click(screen.getByRole('button', { name: /tutup/i }));
    expect(screen.queryByText('Tambah Pelanggan Baru')).not.toBeInTheDocument();
  });

  it('onSaved closes modal and shows toast with customer name', async () => {
    const { insertNewCustomer } = await import('../lib/customers/customerWrappers');
    const mockInsert = insertNewCustomer as ReturnType<typeof vi.fn>;
    const savedCustomer = {
      id: 'new-1', name: 'Dewi Rahayu', wa_number: '628111222333',
      company: '', address: null, created_at: '2026-01-01T00:00:00Z',
    };
    mockInsert.mockResolvedValue(savedCustomer);

    render(<PelangganScreen {...BASE_PROPS} />);
    await waitFor(() => expect(supabaseClientModule.customersService.fetchAll).toHaveBeenCalled());

    // Open modal
    fireEvent.click(screen.getByRole('button', { name: /tambah pelanggan/i }));
    expect(screen.getByText('Tambah Pelanggan Baru')).toBeInTheDocument();

    // Fill Nama and No HP fields (NewCustomerInlineForm uses role=textbox inputs)
    const inputs = screen.getAllByRole('textbox');
    // inputs[0] = Nama, inputs[1] = No HP/WA (labels are not associated via htmlFor)
    fireEvent.change(inputs[0], { target: { value: 'Dewi Rahayu' } });
    fireEvent.change(inputs[1], { target: { value: '628111222333' } });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => {
      expect(BASE_PROPS.showToast).toHaveBeenCalledWith(
        expect.stringContaining('Dewi Rahayu'),
        'success'
      );
    });
    // Modal closed after save
    expect(screen.queryByText('Tambah Pelanggan Baru')).not.toBeInTheDocument();
  });
});

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
