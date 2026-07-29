import { describe, test, expect } from 'vitest';
import { isMenuVisible, isFieldVisible, isApprovalGateVisible, cascadeImpactSummary } from './cascadeMap';
import type { DbTenantSettings } from '../../types';

const baseSettings: DbTenantSettings = {
  id: 1, tenant_id: null,
  modul_kasir: true, modul_tempo: true, modul_pengiriman: true,
  modul_multi_warehouse: true, modul_akuntansi: true,
  modul_jasa_layanan: true, modul_bom_recipe: false,
  modul_diskon_kasir: false, modul_diskon_penjualan: false, modul_diskon_tagihan: false,
  modul_multi_tier_price: false,
  // Phase 1b: tier labels
  tier_1_label: 'Eceran', tier_2_label: 'Grosir', tier_3_label: null, tier_4_label: null,
  pajak_mode: 'FINAL_UMKM', pajak_ppn_rate_umum: 11, pajak_ppn_rate_mewah: 12,
  pajak_final_rate: 0.5,
  pajak_umkm_jenis_badan: 'OP', pajak_umkm_terdaftar_at: '2022-01-01',
  pajak_umkm_expires_at: '2029-01-01',
  pajak_npwp: null, pajak_nik_as_npwp: false,
  pajak_efaktur_enabled: false, pajak_pkp_registered_at: null, pajak_coretax_id: null,
  pajak_regulation_year: 2026,
  created_at: '2026-06-21T00:00:00Z', updated_at: '2026-06-21T00:00:00Z', updated_by: null,
};

describe('cascadeMap', () => {
  test('kasir menu hidden when modul_kasir=false', () => {
    expect(isMenuVisible('kasir', { ...baseSettings, modul_kasir: false })).toBe(false);
    expect(isMenuVisible('kasir', baseSettings)).toBe(true);
  });

  test('piutang menu hidden when modul_tempo=false', () => {
    expect(isMenuVisible('piutang', { ...baseSettings, modul_tempo: false })).toBe(false);
  });

  test('transfer gudang hidden when modul_multi_warehouse=false', () => {
    expect(isMenuVisible('transferGudang', { ...baseSettings, modul_multi_warehouse: false })).toBe(false);
  });

  test('PPN line visible only in PKP mode', () => {
    expect(isFieldVisible('ppn_line', { ...baseSettings, pajak_mode: 'PKP' })).toBe(true);
    expect(isFieldVisible('ppn_line', { ...baseSettings, pajak_mode: 'FINAL_UMKM' })).toBe(false);
  });

  test('TEMPO chip hidden when modul_tempo=false', () => {
    expect(isFieldVisible('tempo_chip', { ...baseSettings, modul_tempo: false })).toBe(false);
  });

  test('rakit_lock gate hidden when modul_jasa_layanan=false', () => {
    expect(isApprovalGateVisible('rakit_lock', { ...baseSettings, modul_jasa_layanan: false })).toBe(false);
  });

  test('kasir gates hidden when modul_kasir=false', () => {
    const s = { ...baseSettings, modul_kasir: false };
    expect(isApprovalGateVisible('kasir_void', s)).toBe(false);
    expect(isApprovalGateVisible('kasir_refund', s)).toBe(false);
    expect(isApprovalGateVisible('kasir_price_override', s)).toBe(false);
  });

  test('customer credit gates hidden when modul_tempo=false', () => {
    const s = { ...baseSettings, modul_tempo: false };
    expect(isApprovalGateVisible('customer_credit_activate', s)).toBe(false);
    expect(isApprovalGateVisible('piutang_write_off', s)).toBe(false);
  });

  test('cascadeImpactSummary returns warning when TEMPO off with active customers', () => {
    const summary = cascadeImpactSummary('modul_tempo', { tempoActiveCustomers: 12 });
    expect(summary).toMatchObject({ level: 'warn' });
    expect(summary.message).toContain('12');
  });

  test('cascadeImpactSummary returns info when modul off with no usage', () => {
    const summary = cascadeImpactSummary('modul_bom_recipe', {});
    expect(summary.level).toBe('info');
  });

  // Multi-tier pricing tests (Task 2)
  describe('cascadeMap multi-tier pricing', () => {
    const onSettings = { ...baseSettings, modul_multi_tier_price: true };
    const offSettings = { ...baseSettings, modul_multi_tier_price: false };

    test('hides tier_pill_kasir when modul OFF', () => {
      expect(isFieldVisible('tier_pill_kasir', offSettings)).toBe(false);
    });
    test('shows tier_pill_kasir when modul ON', () => {
      expect(isFieldVisible('tier_pill_kasir', onSettings)).toBe(true);
    });
    test('shows price_grosir_column when modul ON', () => {
      expect(isFieldVisible('price_grosir_column', onSettings)).toBe(true);
    });
    test('shows csv_bulk_tier_prices_button when modul ON', () => {
      expect(isFieldVisible('csv_bulk_tier_prices_button', onSettings)).toBe(true);
    });
    test('cascadeImpactSummary warns when customers tagged non-eceran tier', () => {
      const summary = cascadeImpactSummary('modul_multi_tier_price' as any, { tierEnabledCustomerCount: 12 });
      expect(summary.level).toBe('warn');
      expect(summary.message).toMatch(/12 customer/);
    });
    test('cascadeImpactSummary info when no grosir customer', () => {
      const summary = cascadeImpactSummary('modul_multi_tier_price' as any, {});
      expect(summary.level).toBe('info');
    });
  });
});
