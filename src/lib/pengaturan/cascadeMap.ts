import type { DbTenantSettings, ApprovalRequestType, ModulSwitchKey } from '../../types';

export type MenuKey =
  | 'kasir' | 'piutang' | 'tukarFaktur' | 'transferGudang' | 'pesananWip'
  | 'akuntansi' | 'trialBalance' | 'bukuBesar' | 'laporanSakEmkm';

export type FieldKey =
  | 'ppn_line' | 'pph_final_footnote'
  | 'tempo_chip' | 'allows_tempo_field' | 'credit_limit_field'
  | 'ongkir_field' | 'warehouse_picker'
  | 'rakit_buttons' | 'walkin_channel'
  | 'tier_pill_kasir' | 'tier_dropdown_customer'
  | 'price_grosir_column' | 'csv_bulk_grosir_button';

export function isMenuVisible(key: MenuKey, settings: DbTenantSettings): boolean {
  switch (key) {
    case 'kasir':            return settings.modul_kasir;
    case 'piutang':          return settings.modul_tempo;
    case 'tukarFaktur':      return settings.modul_tempo;
    case 'transferGudang':   return settings.modul_multi_warehouse;
    case 'pesananWip':       return settings.modul_jasa_layanan;
    case 'akuntansi':
    case 'trialBalance':
    case 'bukuBesar':
    case 'laporanSakEmkm':   return settings.modul_akuntansi;
    default: return true;
  }
}

export function isFieldVisible(key: FieldKey, settings: DbTenantSettings): boolean {
  switch (key) {
    case 'ppn_line':              return settings.pajak_mode === 'PKP';
    case 'pph_final_footnote':    return settings.pajak_mode === 'FINAL_UMKM';
    case 'tempo_chip':
    case 'allows_tempo_field':
    case 'credit_limit_field':    return settings.modul_tempo;
    case 'ongkir_field':          return settings.modul_pengiriman;
    case 'warehouse_picker':      return settings.modul_multi_warehouse;
    case 'rakit_buttons':         return settings.modul_jasa_layanan;
    case 'walkin_channel':        return settings.modul_kasir;
    case 'tier_pill_kasir':
    case 'tier_dropdown_customer':
    case 'price_grosir_column':
    case 'csv_bulk_grosir_button': return settings.modul_multi_tier_price;
    default: return true;
  }
}

export function isApprovalGateVisible(gate: ApprovalRequestType, settings: DbTenantSettings): boolean {
  if (gate.startsWith('kasir_'))          return settings.modul_kasir;
  if (gate.startsWith('customer_credit')) return settings.modul_tempo;
  if (gate === 'piutang_write_off')       return settings.modul_tempo;
  if (gate === 'rakit_lock')              return settings.modul_jasa_layanan;
  return true;
}

export type ImpactLevel = 'info' | 'warn' | 'error';

export interface UsageStats {
  tempoActiveCustomers?: number;
  tempoOutstanding?: number;
  warehouseCount?: number;
  kasirDailyAvg?: number;
  pengirimanRatio?: number;
  jasaActiveCount?: number;
  bomRecipeCount?: number;
  tierEnabledCustomerCount?: number;
}

export interface ImpactSummary {
  level: ImpactLevel;
  message: string;
}

export function cascadeImpactSummary(key: ModulSwitchKey, stats: UsageStats): ImpactSummary {
  switch (key) {
    case 'modul_tempo':
      if ((stats.tempoActiveCustomers ?? 0) > 0)
        return { level: 'warn', message: `${stats.tempoActiveCustomers} pelanggan aktif TEMPO akan jadi Cash-Only; menu Piutang & Tukar Faktur hilang` };
      return { level: 'info', message: 'Belum ada pelanggan TEMPO — aman dimatikan' };
    case 'modul_multi_warehouse':
      if ((stats.warehouseCount ?? 0) > 1)
        return { level: 'warn', message: `${stats.warehouseCount} gudang akan di-collapse ke gudang default; transfer gudang hilang` };
      return { level: 'info', message: 'Cuma 1 gudang — aman dimatikan' };
    case 'modul_kasir':
      if ((stats.kasirDailyAvg ?? 0) > 0)
        return { level: 'warn', message: `~${Math.round(stats.kasirDailyAvg!)} transaksi kasir/hari; menu Kasir + channel Walk-in hilang` };
      return { level: 'info', message: 'Kasir jarang dipakai — aman dimatikan' };
    case 'modul_jasa_layanan':
      if ((stats.jasaActiveCount ?? 0) > 0)
        return { level: 'warn', message: `${stats.jasaActiveCount} jenis jasa aktif; tombol Custom/Wiring di wizard hilang` };
      return { level: 'info', message: 'Belum ada jasa aktif — aman dimatikan' };
    case 'modul_pengiriman':
      if ((stats.pengirimanRatio ?? 0) > 0.1)
        return { level: 'warn', message: `${Math.round((stats.pengirimanRatio!) * 100)}% transaksi pakai ongkir; baris pengiriman hilang dari invoice` };
      return { level: 'info', message: 'Jarang pakai ongkir — aman dimatikan' };
    case 'modul_akuntansi':
      return { level: 'info', message: 'Akan aktif setelah Phase 0a rilis — tidak ada dampak Phase 1' };
    case 'modul_bom_recipe':
      if ((stats.bomRecipeCount ?? 0) > 0)
        return { level: 'warn', message: `${stats.bomRecipeCount} resep aktif; SKU dengan komposisi akan break` };
      return { level: 'info', message: 'Tidak ada resep — defer ke V3' };
    case 'modul_multi_tier_price':
      if ((stats.tierEnabledCustomerCount ?? 0) > 0)
        return { level: 'warn', message: `${stats.tierEnabledCustomerCount} customer ter-tag grosir akan kembali jadi harga eceran; data tetap tersimpan` };
      return { level: 'info', message: 'Belum ada customer grosir — aman dimatikan' };
    case 'modul_diskon_kasir':
    case 'modul_diskon_penjualan':
    case 'modul_diskon_tagihan':
      return { level: 'info', message: 'No cascade impact — discount module' };
    default:
      return { level: 'info', message: '' };
  }
}
