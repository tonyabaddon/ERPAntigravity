import React from 'react';
import type { SalesChannel } from '../../types';
import { useSalesChannels } from '../../contexts/SalesChannelsContext';
import { getChannelDef } from '../../lib/salesChannels';
import ChannelIcon from '../icons/ChannelIcon';

export interface ChannelSelectorProps {
  value: SalesChannel;
  onChange: (next: SalesChannel) => void;
}

// Per-channel one-line hint shown below the grid once a channel is selected.
// Mirrors the mockup caption pattern: "Channel terpilih: <label> · <hint>".
function selectedHint(code: SalesChannel): string {
  switch (code) {
    case 'walkin':    return 'Tidak perlu nomor order marketplace.';
    case 'grosir':    return 'B2B grosir — lanjut isi customer + items.';
    case 'sales':     return 'Sales lapangan — lanjut isi customer + items.';
    case 'expo':      return 'Pameran / expo — lanjut isi customer + items.';
    case 'whatsapp':  return 'Isi nomor WA + chat URL di step ini.';
    case 'instagram': return 'Isi nomor WA untuk follow-up.';
    case 'website':   return 'Order via website sendiri.';
    default:          return 'Marketplace — isi nomor order di step ini.';
  }
}

export default function ChannelSelector({ value, onChange }: ChannelSelectorProps) {
  const { visibleByGroup } = useSalesChannels();
  // Flatten ordered groups (offline → marketplace → direct) into a single
  // grid that matches the mockup. The grouping metadata still drives the
  // order so Walk-in stays first.
  const visible: SalesChannel[] = [
    ...visibleByGroup.offline,
    ...visibleByGroup.marketplace,
    ...visibleByGroup.direct,
  ];
  const selectedDef = getChannelDef(value);

  return (
    <div>
      <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
        {visible.map((code) => {
          const def = getChannelDef(code);
          const isActive = code === value;
          return (
            <button
              key={code}
              type="button"
              onClick={() => onChange(code)}
              className={`flex flex-col items-center gap-1 p-3 rounded-xl transition ${
                isActive
                  ? 'bg-[#012749]/5 border-2 border-[#012749] text-[#012749]'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <ChannelIcon code={code} size={20} tint="none" className={isActive ? 'text-[#012749]' : 'text-slate-500'} />
              <span className={`text-[11px] ${isActive ? 'font-bold' : 'font-semibold'}`}>{def.label}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500 mt-2">
        Channel terpilih: <strong className="text-[#012749]">{selectedDef.label}</strong> · {selectedHint(value)}
      </p>
    </div>
  );
}
