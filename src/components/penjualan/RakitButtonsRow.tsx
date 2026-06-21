// src/components/penjualan/RakitButtonsRow.tsx
import React from 'react';
import type { RakitServiceType } from '../../types';

interface RakitButtonsRowProps {
  formOpen: boolean;
  formType: RakitServiceType | null;
  onOpen: (type: RakitServiceType) => void;
}

export default function RakitButtonsRow({ formOpen, formType, onOpen }: RakitButtonsRowProps) {
  const disabled = formOpen;
  return (
    <div className="bg-amber-50/60 border border-amber-200 rounded-2xl p-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-base">🛠</span>
          <div>
            <div className="font-extrabold text-[13px] text-orange-700">Tambah Jasa</div>
            <div className="text-[11px] text-orange-700/70">
              Pilih tipe jasa &middot; invoice WIP sampai lock + approval
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onOpen('jasa_rakit')}
          disabled={disabled}
          className={`py-2.5 px-3 rounded-xl text-[12px] font-extrabold text-white transition ${
            disabled && formType === 'jasa_rakit'
              ? 'bg-amber-300 opacity-60 cursor-not-allowed'
              : 'bg-amber-500 hover:bg-amber-600 disabled:opacity-50'
          }`}
        >
          ⚡ + Tambah Wiring Panel
        </button>
        <button
          type="button"
          onClick={() => onOpen('jasa_custom_panel')}
          disabled={disabled}
          className={`py-2.5 px-3 rounded-xl text-[12px] font-extrabold text-white transition ${
            disabled && formType === 'jasa_custom_panel'
              ? 'bg-sky-300 opacity-60 cursor-not-allowed'
              : 'bg-sky-500 hover:bg-sky-600 disabled:opacity-50'
          }`}
        >
          📦 + Tambah Jasa Custom Panel
        </button>
      </div>
    </div>
  );
}
