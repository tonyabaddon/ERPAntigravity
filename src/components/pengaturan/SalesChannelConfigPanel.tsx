import React from 'react';
import { ToggleLeft, ToggleRight, Lock } from 'lucide-react';
import { useSalesChannels } from '../../contexts/SalesChannelsContext';
import { CHANNEL_GROUPS, CHANNEL_LOCKED, getChannelDef, type ChannelGroup } from '../../lib/salesChannels';
import ChannelIcon from '../icons/ChannelIcon';
import type { SalesChannel } from '../../types';

interface SalesChannelConfigPanelProps {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

const GROUP_TITLE: Record<ChannelGroup, string> = {
  offline: 'Offline',
  marketplace: 'Marketplace',
  direct: 'Direct Online',
};

const GROUP_HINT: Record<ChannelGroup, string | null> = {
  offline: null,
  marketplace: 'Marketplace channel wajib isi "Nomor Order Marketplace" saat pencatatan.',
  direct: null,
};

export default function SalesChannelConfigPanel({ showToast }: SalesChannelConfigPanelProps) {
  const { settings, isLoading, toggleVisibility } = useSalesChannels();

  const visibleCount = Object.values(settings).filter(s => s.isVisible).length;

  const handleToggle = async (code: SalesChannel) => {
    if (CHANNEL_LOCKED.has(code)) {
      showToast('Walk-in adalah kanal default dan tidak bisa dinonaktifkan.', 'info');
      return;
    }
    try {
      await toggleVisibility(code);
    } catch (err) {
      console.error('toggleVisibility error:', err);
      showToast('Gagal mengubah status kanal.', 'warning');
    }
  };

  if (isLoading) {
    return <p className="text-sm text-gray-400 p-6">Memuat...</p>;
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Intro */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">🏷️</span>
          <h2 className="text-lg font-bold text-gray-800">Kanal Penjualan</h2>
        </div>
        <p className="text-xs text-gray-500 max-w-2xl">
          Pilih kanal yang akan muncul di form pencatatan penjualan. Data historis pada kanal yang dinonaktifkan tetap muncul di laporan & rekonsiliasi.
        </p>
        <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-full text-xs font-bold text-emerald-700">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          {visibleCount} kanal aktif dari 14 · Perubahan tersimpan otomatis
        </div>
      </div>

      {/* Group sections */}
      {(['offline', 'marketplace', 'direct'] as ChannelGroup[]).map(group => (
        <div key={group}>
          <div className="text-[11px] font-extrabold text-slate-500 uppercase tracking-widest mb-3 pl-1">
            {GROUP_TITLE[group]}
          </div>
          {GROUP_HINT[group] && (
            <p className="text-[11px] text-slate-400 italic mb-2 pl-1">{GROUP_HINT[group]}</p>
          )}
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {CHANNEL_GROUPS[group].map(code => {
              const def = getChannelDef(code);
              const isVisible = settings[code]?.isVisible ?? true;
              const isLocked = CHANNEL_LOCKED.has(code);
              return (
                <div key={code} className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center"
                      style={{ background: def.brandColor }}
                    >
                      <ChannelIcon code={code} size={18} />
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-gray-800">{def.label}</div>
                      <div className="text-[11px] text-gray-400">
                        invoice {def.invoicePrefix}-… {def.flow === 'orders' && '· flow orders'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggle(code)}
                    disabled={isLocked}
                    title={isLocked ? 'Walk-in tidak bisa dinonaktifkan' : ''}
                    className="flex items-center gap-2"
                  >
                    <span className={`text-[11px] font-bold uppercase tracking-wide ${
                      isLocked ? 'text-slate-500'
                      : isVisible ? 'text-emerald-700'
                      : 'text-slate-400'
                    }`}>
                      {isLocked ? 'Aktif (dikunci)' : isVisible ? 'Aktif' : 'Non-aktif'}
                    </span>
                    {isLocked
                      ? <Lock size={20} className="text-slate-400" />
                      : isVisible
                        ? <ToggleRight size={28} className="text-emerald-600" />
                        : <ToggleLeft size={28} className="text-slate-300" />
                    }
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="border-t border-gray-100 pt-4 text-[11px] text-gray-400">
        💡 Tip: Data historis pada kanal yang dinonaktifkan tetap muncul di Rekonsiliasi & Laporan. Visibility hanya filter input baru.
      </div>
    </div>
  );
}
