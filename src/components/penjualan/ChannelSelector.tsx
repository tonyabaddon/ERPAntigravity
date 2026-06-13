import React from 'react';
import type { SalesChannel } from '../../types';
import { useSalesChannels } from '../../contexts/SalesChannelsContext';
import { getChannelDef, type ChannelGroup } from '../../lib/salesChannels';
import ChannelIcon from '../icons/ChannelIcon';

export interface ChannelSelectorProps {
  value: SalesChannel;
  onChange: (next: SalesChannel) => void;
}

const GROUP_LABEL: Record<ChannelGroup, string> = {
  offline: 'Offline',
  marketplace: 'Marketplace',
  direct: 'Direct Online',
};

const GROUP_ORDER: ChannelGroup[] = ['offline', 'marketplace', 'direct'];

export default function ChannelSelector({ value, onChange }: ChannelSelectorProps) {
  const { visibleByGroup } = useSalesChannels();

  return (
    <div>
      <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-widest pl-1 block mb-3">
        Kanal Penjualan
      </label>
      {GROUP_ORDER.map(group => {
        const channels = visibleByGroup[group];
        if (channels.length === 0) return null;
        return (
          <div key={group} className="mb-3">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 pl-1">
              {GROUP_LABEL[group]}
            </div>
            <div className="flex gap-2 flex-wrap">
              {channels.map(code => {
                const def = getChannelDef(code);
                const isActive = value === code;
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => onChange(code)}
                    className={`px-4 py-2 rounded-full text-[13px] font-bold border flex items-center gap-1.5 transition ${
                      isActive
                        ? `${def.bgClass} ${def.textClass} ${def.borderClass} shadow-sm -translate-y-px`
                        : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className="w-5 h-5 rounded flex items-center justify-center"
                      style={{ background: isActive ? def.brandColor : 'transparent' }}
                    >
                      <ChannelIcon code={code} size={14} className={isActive ? '' : 'text-slate-400'} />
                    </span>
                    <span>{def.label}</span>
                    {code === 'whatsapp' && isActive && (
                      <span className="ml-1 text-[10px] bg-amber-400 text-amber-900 px-1.5 py-0.5 rounded font-extrabold">MANUAL</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="text-[11px] text-slate-400 pl-1 mt-1">
        Atur kanal aktif di Pengaturan → Kanal Penjualan
      </div>
    </div>
  );
}
