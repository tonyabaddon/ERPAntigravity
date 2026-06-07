import React from 'react';
import { KasirItem, WarehouseLocation } from '../../types';
import type { SupabaseStockItem } from '../../lib/supabaseClient';

function formatRp(n: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  }).format(n);
}

export interface CartRowsProps {
  items: (KasirItem & { _key: number })[];
  stocks: SupabaseStockItem[]; // for per-warehouse stock lookup
  onQtyChange: (key: number, qty: number) => void;
  onWarehouseChange: (key: number, wh: WarehouseLocation) => void;
  onRemove: (key: number) => void;
}

export default function CartRows({ items, stocks, onQtyChange, onWarehouseChange, onRemove }: CartRowsProps) {
  const subtotal = items.reduce((s, i) => s + i.subtotal, 0);

  if (items.length === 0) {
    return (
      <div className="px-6 py-8 text-center text-slate-400 text-[13px] bg-slate-50 border border-dashed border-slate-300 rounded-xl">
        Belum ada item. Tambahkan dari hasil pencarian di atas.
      </div>
    );
  }

  return (
    <>
      <div className="bg-emerald-50 border border-emerald-300 rounded-xl px-3 py-2 mb-2 flex justify-between items-center">
        <div className="font-extrabold text-emerald-700 text-[13px] flex items-center gap-2">
          🧺 Keranjang
          <span className="bg-emerald-700 text-white px-2 py-0.5 rounded-full text-[11px] font-extrabold">{items.length} item</span>
        </div>
        <div className="font-extrabold text-emerald-700 text-[13px]">{formatRp(subtotal)}</div>
      </div>

      {items.map(item => {
        const stock = stocks.find(s => s.sku === item.sku);
        const atas = stock?.stock_atas ?? 0;
        const bawah = stock?.stock_bawah ?? 0;
        return (
          <div
            key={item._key}
            className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl mb-2 items-center text-[12px]"
          >
            <div>
              <div className="font-extrabold">{item.name}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">@ {formatRp(item.unit_price)}</div>
            </div>
            {/* Warehouse selector */}
            <div className="flex gap-0.5 bg-white border border-slate-200 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => atas > 0 && onWarehouseChange(item._key, 'atas')}
                disabled={atas === 0}
                className={`px-2 py-1 rounded-md text-[11px] font-extrabold flex items-center gap-1 ${
                  item.warehouse === 'atas'
                    ? 'bg-blue-100 text-blue-700'
                    : atas === 0 ? 'opacity-40 cursor-not-allowed' : 'text-slate-400 hover:bg-slate-50'
                }`}
              >
                Atas <span className="text-[10px] opacity-70">{atas}</span>
              </button>
              <button
                type="button"
                onClick={() => bawah > 0 && onWarehouseChange(item._key, 'bawah')}
                disabled={bawah === 0}
                className={`px-2 py-1 rounded-md text-[11px] font-extrabold flex items-center gap-1 ${
                  item.warehouse === 'bawah'
                    ? 'bg-amber-100 text-amber-700'
                    : bawah === 0 ? 'opacity-40 cursor-not-allowed' : 'text-slate-400 hover:bg-slate-50'
                }`}
              >
                Bawah <span className="text-[10px] opacity-70">{bawah}</span>
              </button>
            </div>
            {/* Qty stepper */}
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
              <button type="button" onClick={() => onQtyChange(item._key, Math.max(1, item.qty - 1))} className="w-6 h-6 rounded bg-slate-100 font-extrabold">−</button>
              <input
                value={item.qty}
                onChange={e => onQtyChange(item._key, Math.max(1, parseInt(e.target.value || '1', 10)))}
                className="w-10 text-center font-extrabold text-[12px] bg-transparent outline-none"
              />
              <button type="button" onClick={() => onQtyChange(item._key, item.qty + 1)} className="w-6 h-6 rounded bg-slate-100 font-extrabold">+</button>
            </div>
            <div className="font-extrabold text-[#012749] min-w-[90px] text-right text-[13px]">{formatRp(item.subtotal)}</div>
            <button type="button" onClick={() => onRemove(item._key)} className="text-slate-300 hover:text-rose-500 text-lg leading-none">✕</button>
          </div>
        );
      })}
    </>
  );
}
