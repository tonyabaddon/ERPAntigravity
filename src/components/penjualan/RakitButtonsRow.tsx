// src/components/penjualan/RakitButtonsRow.tsx
//
// Wizard Step 2 jasa-type picker. Header + framing now live on the parent
// (Step2Items renders the "Tambah Jasa (Optional)" label + skip-hint above
// this row), so this component is just the 2 tinted-button row matching
// the approved mockup palette: Custom Panel = purple, Wiring Panel = sky.
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
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={() => onOpen('jasa_custom_panel')}
        disabled={disabled}
        className={`px-3 py-2 text-xs font-semibold rounded-lg border transition ${
          disabled && formType === 'jasa_custom_panel'
            ? 'bg-purple-100 text-purple-800 border-purple-300 opacity-60 cursor-not-allowed'
            : 'bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100 disabled:opacity-50'
        }`}
      >
        + Custom Panel
      </button>
      <button
        type="button"
        onClick={() => onOpen('jasa_rakit')}
        disabled={disabled}
        className={`px-3 py-2 text-xs font-semibold rounded-lg border transition ${
          disabled && formType === 'jasa_rakit'
            ? 'bg-sky-100 text-sky-800 border-sky-300 opacity-60 cursor-not-allowed'
            : 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100 disabled:opacity-50'
        }`}
      >
        + Wiring Panel
      </button>
    </div>
  );
}
