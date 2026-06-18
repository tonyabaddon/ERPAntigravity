import type { FunnelSubStage, FunnelStage, OrderType } from './types';

export interface SubStageMeta {
  id: FunnelSubStage;
  stage: FunnelStage;
  name: string;
  icon: string;
  actionType: 'urgent' | 'passive';
  nextLabel: string;
  forTypes: OrderType[];
}

export const SUB_STAGES: SubStageMeta[] = [
  { id: '1a', stage: 1, name: 'Sedang Chat AI', icon: '💬', actionType: 'passive', nextLabel: 'AI handle · admin tidak perlu action', forTypes: ['KOMPONEN'] },
  { id: '2a', stage: 2, name: 'Tunggu Konfirmasi Customer', icon: '📩', actionType: 'passive', nextLabel: 'Tunggu customer balas Setuju', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '2b', stage: 2, name: 'Perlu Disetujui Admin', icon: '⚠️', actionType: 'urgent', nextLabel: 'Cek items + set ongkir + payment type', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '2c', stage: 2, name: 'Tunggu Customer Bayar', icon: '⏳', actionType: 'passive', nextLabel: 'SO terkirim · tunggu transfer', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '2d', stage: 2, name: 'Perlu Cek Bukti Transfer', icon: '⚡', actionType: 'urgent', nextLabel: 'Customer baru upload bukti · cek di sini', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '2e', stage: 2, name: 'Ditolak', icon: '❌', actionType: 'passive', nextLabel: 'Tunggu customer upload ulang atau pilih alternatif', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '3a', stage: 3, name: 'Sedang Siapkan Barang', icon: '🔧', actionType: 'urgent', nextLabel: 'Kerjakan barang fisik di gudang', forTypes: ['KOMPONEN'] },
  { id: '3b', stage: 3, name: 'Perlu Cek Bukti Pelunasan', icon: '⚡', actionType: 'urgent', nextLabel: 'Customer baru bayar pelunasan · cek bukti', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '3c', stage: 3, name: 'Barang Siap, Lanjut Kirim/Ambil', icon: '✓', actionType: 'urgent', nextLabel: 'Klik Barang Siap untuk lanjut pengiriman', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '3d', stage: 3, name: 'DP done · Tunggu Pelunasan', icon: '💛', actionType: 'passive', nextLabel: 'Tunggu customer lunasi · bisa kirim reminder', forTypes: ['KOMPONEN'] },
  { id: '3e', stage: 3, name: 'Bukti Pelunasan Ditolak', icon: '❌', actionType: 'passive', nextLabel: 'Bukti baru ditolak · tunggu upload ulang', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '3f', stage: 3, name: 'Sedang Dirakit / Fabrikasi', icon: '🛠️', actionType: 'urgent', nextLabel: 'Multi-hari · teknisi kerja · pantau progress', forTypes: ['CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '3g', stage: 3, name: 'Tunggu Owner Cek Biaya Final', icon: '🔒', actionType: 'urgent', nextLabel: 'Admin submit biaya · owner review di Persetujuan', forTypes: ['CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '3h', stage: 3, name: 'Biaya Final OK · Tunggu Pelunasan', icon: '💛', actionType: 'passive', nextLabel: 'Invoice pelunasan akurat sudah dikirim · tunggu transfer', forTypes: ['CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '4a', stage: 4, name: 'Sedang Dikirim', icon: '🚚', actionType: 'passive', nextLabel: 'Pantau · tracking sudah dikirim ke customer', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '4b', stage: 4, name: 'Siap Diambil di Toko', icon: '🏪', actionType: 'urgent', nextLabel: 'Saat customer datang, klik Sudah Diterima', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '4d', stage: 4, name: 'Ada Masalah Pengiriman', icon: '🆘', actionType: 'urgent', nextLabel: 'Hubungi customer + kurir · resolve', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '5a', stage: 5, name: 'Semua Pesanan Selesai', icon: '✓', actionType: 'passive', nextLabel: 'Selesai · download dokumen kapan saja', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '6a', stage: 6, name: 'Dibatalkan Customer', icon: '✗', actionType: 'passive', nextLabel: 'Customer batal · history', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
  { id: '6b', stage: 6, name: 'Bukti Pembayaran Ditolak Final', icon: '✗', actionType: 'passive', nextLabel: 'Admin reject final · history', forTypes: ['KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL'] },
];

export const STAGE_NAMES: Record<FunnelStage, { icon: string; name: string }> = {
  1: { icon: '💬', name: 'Bertanya' },
  2: { icon: '💰', name: 'Konfirmasi & Belum Bayar' },
  3: { icon: '📦', name: 'Diproses' },
  4: { icon: '🚚', name: 'Dikirim / Siap Diambil' },
  5: { icon: '✓', name: 'Diterima' },
  6: { icon: '✗', name: 'Dibatalkan' },
};

export function getSubStageMeta(id: FunnelSubStage): SubStageMeta {
  const meta = SUB_STAGES.find(s => s.id === id);
  if (!meta) throw new Error(`Unknown sub-stage: ${id}`);
  return meta;
}

export function isUrgentSubStage(id: FunnelSubStage): boolean {
  return getSubStageMeta(id).actionType === 'urgent';
}

export function getSubStagesForStage(stage: FunnelStage): SubStageMeta[] {
  return SUB_STAGES.filter(s => s.stage === stage);
}
