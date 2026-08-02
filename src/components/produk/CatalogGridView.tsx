import React, { useState, useMemo } from 'react';
import type { StockItem } from '../../types';
import { formatIDR } from '../../lib/formatIDR';

interface Props {
  stockList: StockItem[];
  onAdd: () => void;
  onEdit: (sku: string) => void;
  /** When true, parent owns the search/filter/add toolbar (e.g. lifted to StockManagerScreen). */
  hideToolbar?: boolean;
}

export default function CatalogGridView({ stockList, onAdd, onEdit, hideToolbar }: Props) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('Semua');
  const categories = useMemo(() =>
    ['Semua', ...Array.from(new Set(stockList.map(s => s.category)))], [stockList]);
  const filtered = useMemo(() => {
    if (hideToolbar) return stockList; // parent already filtered
    return stockList.filter(s => {
      if (cat !== 'Semua' && s.category !== cat) return false;
      if (q && !s.name.toLowerCase().includes(q.toLowerCase()) && !s.sku.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [stockList, q, cat, hideToolbar]);

  return (
    <section className="bg-white rounded-[2.5rem] p-6 border border-[#e5eeff] shadow-xl">
      {!hideToolbar && (
        <div className="flex flex-col lg:flex-row gap-3 mb-5">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Cari nama atau SKU…"
                 className="flex-1 px-4 py-3 bg-[#eff4ff] rounded-full text-xs font-bold" />
          <select value={cat} onChange={e => setCat(e.target.value)}
                  className="px-4 py-3 bg-[#eff4ff] rounded-full text-xs font-black">
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={onAdd}
                  className="px-5 py-3 bg-[#2d8a4e] text-white rounded-full text-xs font-extrabold uppercase tracking-wider">
            + Tambah Barang
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {filtered.map(item => (
          <button key={item.sku} onClick={() => onEdit(item.sku)}
                  className="text-left bg-slate-50 rounded-sm p-3 border border-slate-100 hover:border-emerald-200 hover:shadow-md transition">
            <div className="aspect-square rounded-sm overflow-hidden bg-slate-200 mb-2">
              {item.photo_urls?.[0]?.url ? (
                <img src={item.photo_urls[0].url} alt={item.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="material-symbols-outlined text-slate-400 text-3xl">image</span>
                </div>
              )}
            </div>
            <div className="text-[9px] font-black uppercase tracking-widest bg-amber-100 text-amber-900 inline-block px-1.5 py-0.5 rounded-full mb-1">
              {item.category}
            </div>
            <h6 className="text-xs font-extrabold text-[#012749] line-clamp-2">{item.name}</h6>
            <p className="text-[10.5px] text-slate-500 mt-0.5">
              {formatIDR(item.price)} / {item.unit ?? 'pcs'}
            </p>
            <p className="text-[10px] text-slate-400">Stok: {item.stock}</p>
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-slate-400 text-xs">Tidak ada produk yang cocok</div>
      )}
    </section>
  );
}
