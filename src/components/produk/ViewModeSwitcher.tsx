// src/components/produk/ViewModeSwitcher.tsx
import React from 'react';

export type ViewMode = 'foto' | 'list';

interface Props {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
}

const PILL_BASE =
  'px-3 py-1.5 rounded-full text-xs font-bold inline-flex items-center gap-1.5';
const PILL_ACTIVE = 'bg-[#012749] text-white';
const PILL_INACTIVE = 'text-slate-600 hover:bg-white';

export default function ViewModeSwitcher({ value, onChange }: Props) {
  return (
    <div className="flex bg-slate-100 rounded-full p-1 gap-0.5" role="group" aria-label="View mode">
      <button
        type="button"
        className={`${PILL_BASE} ${value === 'foto' ? PILL_ACTIVE : PILL_INACTIVE} ${value === 'foto' ? 'font-extrabold' : ''}`}
        onClick={() => onChange('foto')}
        aria-pressed={value === 'foto'}
        title="Mode Foto — grid besar dengan foto dominan"
      >
        <span className="material-symbols-outlined text-base">grid_view</span> Foto
      </button>
      <button
        type="button"
        className={`${PILL_BASE} ${value === 'list' ? PILL_ACTIVE : PILL_INACTIVE} ${value === 'list' ? 'font-extrabold' : ''}`}
        onClick={() => onChange('list')}
        aria-pressed={value === 'list'}
        title="Mode List — tabular, foto sebagai thumbnail"
      >
        <span className="material-symbols-outlined text-base">view_list</span> List
      </button>
    </div>
  );
}
