import React from 'react';
import { KasirChannel } from '../../types';

const CHANNELS: { key: KasirChannel; label: string; ico: string; activeClass: string }[] = [
  { key: 'walkin',    label: 'Walk-in',     ico: '🏪', activeClass: 'bg-blue-50 text-blue-700 border-blue-700' },
  { key: 'tokopedia', label: 'Tokopedia',   ico: '🛍️', activeClass: 'bg-amber-100 text-amber-700 border-amber-600 shadow-amber-200/40 shadow-md' },
  { key: 'grosir',    label: 'Grosir',      ico: '🏭', activeClass: 'bg-violet-100 text-violet-700 border-violet-600' },
  { key: 'whatsapp',  label: 'WhatsApp',    ico: '💬', activeClass: 'bg-green-100 text-green-700 border-green-600 shadow-green-200/40 shadow-md' },
];

export interface ChannelSelectorProps {
  value: KasirChannel;
  onChange: (next: KasirChannel) => void;
}

export default function ChannelSelector({ value, onChange }: ChannelSelectorProps) {
  return (
    <div>
      <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-widest pl-1 block mb-2">
        Kanal Penjualan
      </label>
      <div className="flex gap-2 flex-wrap">
        {CHANNELS.map(c => (
          <button
            key={c.key}
            type="button"
            onClick={() => onChange(c.key)}
            className={`px-4 py-2 rounded-full text-[13px] font-bold border flex items-center gap-1.5 transition ${
              value === c.key
                ? c.activeClass
                : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50'
            }`}
          >
            <span>{c.ico}</span>
            <span>{c.label}</span>
            {c.key === 'whatsapp' && value === c.key && (
              <span className="ml-1 text-[10px] bg-amber-400 text-amber-900 px-1.5 py-0.5 rounded font-extrabold">MANUAL</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
