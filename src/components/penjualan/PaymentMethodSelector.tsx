import React from 'react';
import { KasirPaymentMethod, KasirPaymentSubtype } from '../../types';

const METHODS: { key: KasirPaymentMethod; label: string; ico: string }[] = [
  { key: 'cash',     label: 'Cash',     ico: '💵' },
  { key: 'transfer', label: 'Transfer', ico: '🏦' },
  { key: 'edc',      label: 'EDC',      ico: '💳' },
];

export interface PaymentMethodSelectorProps {
  method: KasirPaymentMethod;
  subtype: KasirPaymentSubtype;
  onMethodChange: (m: KasirPaymentMethod) => void;
  onSubtypeChange: (s: KasirPaymentSubtype) => void;
}

export default function PaymentMethodSelector({ method, subtype, onMethodChange, onSubtypeChange }: PaymentMethodSelectorProps) {
  return (
    <div>
      <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-widest pl-1 block mb-2">
        Metode Pembayaran
      </label>
      <div className="grid grid-cols-3 gap-2">
        {METHODS.map(m => (
          <button
            key={m.key}
            type="button"
            onClick={() => {
              onMethodChange(m.key);
              if (m.key !== 'edc') onSubtypeChange(null);
              else if (subtype === null) onSubtypeChange('debit');
            }}
            className={`border rounded-xl py-3 px-2 text-[12px] font-bold flex flex-col items-center gap-1 ${
              method === m.key
                ? 'bg-[#012749] text-white border-[#012749]'
                : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50'
            }`}
          >
            <span className="text-base">{m.ico}</span>
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      {method === 'edc' && (
        <div className="flex gap-2 mt-2">
          {(['debit','qris'] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => onSubtypeChange(s)}
              className={`px-3 py-1.5 text-[11px] font-bold rounded-full border ${
                subtype === s
                  ? 'bg-amber-400 text-amber-900 border-amber-400'
                  : 'bg-white text-slate-500 border-slate-300'
              }`}
            >
              {s === 'debit' ? 'Debit' : 'QRIS'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
