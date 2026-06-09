import React, { useState } from 'react';
import { Search } from 'lucide-react';
import type { SupabaseStockItem } from '../../lib/supabaseClient';
import { formatRp } from '../../lib/format';

export interface ItemSearchPanelProps {
  stocks: SupabaseStockItem[];
  cartCount: number;
  cartSubtotal: number;
  onAdd: (stock: SupabaseStockItem) => void;
  children?: React.ReactNode; // cart content rendered below by parent
}

export default function ItemSearchPanel({ stocks, cartCount, cartSubtotal, onAdd, children }: ItemSearchPanelProps) {
  const [q, setQ] = useState('');

  const filtered = q.trim().length > 0
    ? stocks.filter(s =>
        s.name.toLowerCase().includes(q.toLowerCase()) ||
        s.sku.toLowerCase().includes(q.toLowerCase())
      ).slice(0, 8)
    : [];

  return (
    <div className="bg-gradient-to-b from-amber-50 to-white border-2 border-amber-200 rounded-2xl overflow-hidden shadow-md">
      {/* Header */}
      <div className="bg-amber-500 text-white px-4 py-3 flex justify-between items-center">
        <h3 className="font-extrabold text-[13px] uppercase tracking-wide flex items-center gap-2">
          🛒 Tambah Barang & Keranjang
        </h3>
        <span className="bg-white text-orange-700 px-3 py-1 rounded-full text-[11px] font-extrabold">
          {cartCount} ITEM · {formatRp(cartSubtotal)}
        </span>
      </div>

      <div className="p-4">
        <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-widest pl-1 block mb-2">
          Cari Barang
        </label>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Ketik nama atau SKU barang…"
            className="w-full pl-10 pr-3 py-3 border-2 border-slate-200 rounded-xl text-[13px] font-semibold bg-white focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
          />
        </div>

        {filtered.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl mb-3 shadow">
            {filtered.map(s => {
              const atas = s.stock_atas ?? 0;
              const bawah = s.stock_bawah ?? 0;
              return (
                <div key={s.sku} className="px-4 py-3 grid grid-cols-[1fr_auto_auto] gap-3 items-center text-[12px] border-b border-slate-100 last:border-b-0">
                  <div>
                    <div className="font-extrabold">{s.name}</div>
                    <div className="text-slate-400 text-[11px] mt-0.5">SKU: {s.sku}</div>
                  </div>
                  <div className="flex gap-1">
                    <span className={`px-2 py-1 rounded-md text-[11px] font-extrabold border ${atas > 0 ? 'bg-blue-100 text-blue-700 border-blue-300' : 'bg-rose-100 text-rose-700 border-rose-300'}`}>
                      Atas {atas}
                    </span>
                    <span className={`px-2 py-1 rounded-md text-[11px] font-extrabold border ${bawah > 0 ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-rose-100 text-rose-700 border-rose-300'}`}>
                      Bawah {bawah}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className="font-extrabold text-[#012749] text-[12px]">{formatRp(s.price)}</div>
                    <button
                      type="button"
                      onClick={() => onAdd(s)}
                      disabled={atas + bawah === 0}
                      className="bg-[#2d8a4e] text-white px-3 py-1 rounded-md text-[11px] font-extrabold hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      + Tambah
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Cart rendered by parent via children */}
        {children}
      </div>
    </div>
  );
}
