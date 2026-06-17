import React from 'react';
import type { Warehouse } from '../../types';
import { pickTopGudang } from './stokGudangFormat';

interface Props {
  total: number;
  warehouses: Warehouse[];
  stockByWarehouseId: Map<string, number>;
  minStock: number;
}

export default function StokGudangInline({ total, warehouses, stockByWarehouseId, minStock }: Props) {
  const { shown, remaining } = pickTopGudang(warehouses, stockByWarehouseId);

  const totalColor =
    total <= 3 ? 'text-rose-700'
      : total <= minStock ? 'text-amber-700'
      : 'text-emerald-700';

  return (
    <div className="flex flex-col items-center leading-tight">
      <span className={`text-sm font-extrabold ${totalColor}`}>{total}</span>
      {shown.length > 0 && (
        <span className="text-[10.5px] text-slate-500 mt-0.5">
          {shown.map((g, i) => (
            <React.Fragment key={g.name}>
              {i > 0 && <span className="mx-1 text-slate-300">·</span>}
              <span>{g.name} {g.qty}</span>
            </React.Fragment>
          ))}
          {remaining > 0 && <span className="ml-1 text-slate-400">+{remaining} lagi</span>}
        </span>
      )}
    </div>
  );
}
