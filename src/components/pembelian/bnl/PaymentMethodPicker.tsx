import React from 'react';
import { Banknote, CreditCard, Clock } from 'lucide-react';
import type { PiPaymentMethod } from '../../../types';

const OPTIONS: { value: PiPaymentMethod; label: string; icon: React.ReactNode; activeBg: string; activeColor: string }[] = [
  { value: 'CASH',     label: 'Cash',     icon: <Banknote className="w-5 h-5" />,   activeBg: 'bg-indigo-50',  activeColor: 'text-indigo-700' },
  { value: 'TRANSFER', label: 'Transfer', icon: <CreditCard className="w-5 h-5" />, activeBg: 'bg-sky-50',     activeColor: 'text-sky-700' },
  { value: 'TEMPO',    label: 'Tempo',    icon: <Clock className="w-5 h-5" />,      activeBg: 'bg-fuchsia-50', activeColor: 'text-fuchsia-700' },
];

export default function PaymentMethodPicker({ value, onChange }: { value: PiPaymentMethod; onChange: (v: PiPaymentMethod) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {OPTIONS.map(o => {
        const active = value === o.value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}
            className={`flex flex-col items-center gap-1 p-3 rounded-sm border-2 ${
              active ? `border-current ${o.activeBg} ${o.activeColor}` : 'border-gray-200 bg-white text-gray-500 hover:border-indigo-300'
            }`}>
            {o.icon}
            <span className="text-xs font-bold">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
