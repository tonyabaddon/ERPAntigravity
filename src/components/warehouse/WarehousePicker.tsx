// src/components/warehouse/WarehousePicker.tsx
//
// Shared warehouse picker — collapses to a label for N=1, renders pill
// toggles for N=2 (matching the existing blue/amber Atas/Bawah pair),
// switches to a dropdown for N>=3. Used by every place that previously
// hardcoded 'atas' | 'bawah'. 2026-06-13 spec.

import React from 'react';
import { ChevronDown } from 'lucide-react';
import type { Warehouse } from '../../types';

interface CommonProps {
  warehouses: Warehouse[];                        // expected: filtered to active + sorted
  skuQtyByWarehouseId?: Record<string, number>;   // optional, for display ("Atas 211")
  disabled?: boolean;
  excludeIds?: string[];                          // for pair mode, exclude the other side
}

interface SingleProps extends CommonProps {
  mode: 'single';
  value: string | null;
  onChange: (id: string) => void;
}

type Props = SingleProps;

export default function WarehousePicker(props: Props) {
  const eligible = props.warehouses.filter(w => !props.excludeIds?.includes(w.id));

  if (eligible.length === 0) {
    return <span className="text-xs text-slate-400 italic">Tidak ada gudang aktif</span>;
  }

  if (eligible.length === 1) {
    const w = eligible[0];
    const qty = props.skuQtyByWarehouseId?.[w.id];
    return (
      <span className="inline-flex items-center px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-[11px] font-extrabold border border-blue-200">
        {w.name}{qty !== undefined && <span className="opacity-70 ml-1">· {qty}</span>}
      </span>
    );
  }

  if (eligible.length === 2) {
    return (
      <div className="flex gap-1">
        {eligible.map((w, i) => {
          const selected = props.value === w.id;
          const palette = i === 0
            ? selected ? 'bg-blue-100 text-blue-700' : 'text-slate-400 hover:bg-slate-50'
            : selected ? 'bg-amber-100 text-amber-700' : 'text-slate-400 hover:bg-slate-50';
          const qty = props.skuQtyByWarehouseId?.[w.id];
          return (
            <button
              key={w.id} type="button"
              disabled={props.disabled}
              onClick={() => props.onChange(w.id)}
              className={`px-2 py-1 rounded-sm text-[11px] font-extrabold flex items-center gap-1 ${palette}`}
            >
              {w.name} {qty !== undefined && <span className="text-[10px] opacity-70">{qty}</span>}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="relative">
      <select
        value={props.value ?? ''}
        onChange={e => props.onChange(e.target.value)}
        disabled={props.disabled}
        className="appearance-none bg-white border border-slate-200 rounded-sm px-3 py-1.5 pr-8 text-[11px] font-extrabold text-slate-700 outline-none focus:ring-1 focus:ring-[var(--color-caleo-primary)] disabled:opacity-50"
      >
        <option value="" disabled>Pilih gudang…</option>
        {eligible.map(w => {
          const qty = props.skuQtyByWarehouseId?.[w.id];
          return <option key={w.id} value={w.id}>{w.name}{qty !== undefined && ` · ${qty}`}</option>;
        })}
      </select>
      <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
    </div>
  );
}
