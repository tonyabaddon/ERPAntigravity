import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ModulSwitchesPanel from './ModulSwitchesPanel';
import * as services from '../../lib/pengaturan/pengaturanServices';

vi.mock('../../lib/pengaturan/pengaturanServices', () => ({
  tenantSettingsService: {
    fetch: vi.fn(),
    updateModul: vi.fn(),
  },
}));

describe('ModulSwitchesPanel — multi-tier modul', () => {
  beforeEach(() => {
    (services as any).tenantSettingsService.fetch.mockResolvedValue({
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
      pajak_mode: 'NO_TAX',
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
    });
  });

  it('renders the Multi-Tier Pricing toggle row', async () => {
    render(<ModulSwitchesPanel showToast={vi.fn()} />);
    expect(await screen.findByText(/Multi-Tier Pricing/i)).toBeInTheDocument();
    expect(screen.getByText(/harga grosir terpisah/i)).toBeInTheDocument();
  });
});
