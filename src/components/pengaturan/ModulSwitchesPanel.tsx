import React, { useState, useEffect } from 'react';
import { tenantSettingsService } from '../../lib/pengaturan/pengaturanServices';
import { captureError } from '../../lib/captureError';
import { cascadeImpactSummary, type UsageStats } from '../../lib/pengaturan/cascadeMap';
import type { DbTenantSettings, ModulSwitchKey } from '../../types';
import SettingCard from './SettingCard';
import ToggleSwitch from './ToggleSwitch';

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

const MODULS: Array<{ key: ModulSwitchKey; icon: string; title: string; description: string }> = [
  { key: 'modul_kasir',           icon: '⚙️', title: 'Modul Kasir / POS',         description: 'Meja kasir dengan struk thermal, drawer kas, scan barcode.' },
  { key: 'modul_tempo',           icon: '💳', title: 'Modul TEMPO / Piutang',     description: 'Pelanggan boleh ambil utang, bayar nanti.' },
  { key: 'modul_pengiriman',      icon: '🚚', title: 'Modul Pengiriman',          description: 'Tambah ongkir sebagai baris invoice.' },
  { key: 'modul_multi_warehouse', icon: '🏬', title: 'Modul Multi-warehouse',     description: 'Stok di lebih dari 1 gudang.' },
  { key: 'modul_akuntansi',       icon: '🧾', title: 'Modul Akuntansi',           description: 'Buku Besar, Trial Balance, Laporan SAK EMKM.' },
  { key: 'modul_jasa_layanan',    icon: '🛠️', title: 'Modul Jasa & Layanan',     description: 'Tawarkan jasa selain produk fisik (tenant-defined types).' },
  { key: 'modul_bom_recipe',      icon: '🍳', title: 'Modul Resep / BOM',         description: 'Produk dengan komposisi material (untuk F&B / manufaktur).' },
  { key: 'modul_diskon_kasir',    icon: '🏷️', title: 'Diskon di Kasir',           description: 'Kolom Diskon di cart + baris Diskon Order di total bar Kasir.' },
  { key: 'modul_diskon_penjualan',icon: '🏷️', title: 'Diskon di Penjualan',       description: 'Kolom Diskon di Step 2 + Diskon Order di Step 3 wizard Catat Penjualan.' },
  { key: 'modul_diskon_tagihan',  icon: '🏷️', title: 'Diskon di Tagihan PI',      description: 'Kolom Diskon per item + Diskon Tagihan di total Pembelian Tagihan.' },
  { key: 'modul_multi_tier_price', icon: '💵', title: 'Modul Multi-Tier Pricing', description: 'Aktifkan harga grosir terpisah dari eceran. Customer dapat di-tag tier default; kasir bebas switch.' },
];

export default function ModulSwitchesPanel({ showToast }: Props) {
  const [settings, setSettings] = useState<DbTenantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<UsageStats>({});

  useEffect(() => {
    tenantSettingsService.fetch()
      .then(setSettings)
      .catch(err => { captureError(err, { feature: 'pengaturan_modul', action: 'load_modul_settings' }); showToast('Gagal memuat pengaturan modul', 'warning'); })
      .finally(() => setLoading(false));
    // Future: fetch UsageStats from a dedicated RPC (defer V2 — show static for now)
  }, []);

  const handleToggle = async (key: ModulSwitchKey, newValue: boolean) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: newValue });
    try {
      await tenantSettingsService.updateModul(key, newValue);
      showToast(`${key} → ${newValue ? 'ON' : 'OFF'}`, 'success');
    } catch (err) {
      captureError(err, { feature: 'pengaturan_modul', action: 'toggle_modul' });
      setSettings(settings);
      showToast('Gagal simpan; coba lagi', 'warning');
    }
  };

  if (loading) return <p className="text-sm text-slate-500 p-6">Memuat…</p>;
  if (!settings) return <p className="text-sm text-caleo-danger p-6">Tidak bisa memuat pengaturan</p>;

  return (
    <div className="space-y-3">
      {MODULS.map(m => (
        <SettingCard
          key={m.key}
          icon={m.icon}
          title={m.title}
          description={m.description}
          impactSummary={settings[m.key] ? cascadeImpactSummary(m.key, stats) : undefined}
          highlight={m.key === 'modul_jasa_layanan' && settings.modul_jasa_layanan}
        >
          <ToggleSwitch
            checked={settings[m.key]}
            onChange={(v) => handleToggle(m.key, v)}
            ariaLabel={m.title}
          />
        </SettingCard>
      ))}
    </div>
  );
}
