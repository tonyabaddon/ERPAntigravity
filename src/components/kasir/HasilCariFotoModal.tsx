import React from 'react';
import type { SearchResult } from '../../lib/cariByFotoService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  results: SearchResult[];
  queryBlobUrl: string | null;
  queryFilename?: string | null;
  onChangePhoto: () => void;
  onAddToCart: (result: SearchResult) => void;
}

// Tier the similarity score so the eye can scan strong→weak matches.
function simColorClass(sim: number): string {
  if (sim >= 0.90) return 'text-emerald-700';
  if (sim >= 0.80) return 'text-emerald-600';
  return 'text-emerald-500';
}

export default function HasilCariFotoModal({ isOpen, onClose, results, queryBlobUrl, queryFilename, onChangePhoto, onAddToCart }: Props) {
  if (!isOpen) return null;
  const isEmpty = results.length === 0;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl max-w-3xl w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-[10px] font-extrabold text-emerald-700 uppercase tracking-widest">Hasil Cari by Foto</p>
            <h3 className="text-base font-extrabold text-[#012749] mt-0.5">Top {results.length} produk paling mirip</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 bg-slate-100 hover:bg-slate-200 rounded-full flex items-center justify-center">
            <span className="material-symbols-outlined text-base text-slate-600">close</span>
          </button>
        </div>
        <div className="flex items-center justify-between gap-4 mb-5 bg-emerald-50 border border-emerald-200 rounded-2xl p-3">
          <div className="flex items-center gap-3">
            {queryBlobUrl ? (
              <img src={queryBlobUrl} alt="query" className="w-16 h-16 rounded-xl object-cover" />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-slate-200" />
            )}
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-700">Foto yang dicari</p>
              <p className="text-[12.5px] font-bold text-emerald-900">{queryFilename ?? 'query.jpg'}</p>
              <p className="text-[10px] text-emerald-700 italic">Top {results.length} produk paling mirip berdasarkan visual similarity (CLIP)</p>
            </div>
          </div>
          <button onClick={onChangePhoto} className="px-3 py-2 bg-white border border-emerald-200 text-emerald-700 rounded-full text-[11px] font-extrabold inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-base">refresh</span> Ganti foto
          </button>
        </div>
        {isEmpty && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-[12px] text-amber-900">
            ⚠ Tidak menemukan produk yang cukup mirip dengan foto. Coba foto lain atau cari via teks/SKU.
          </div>
        )}
        <div className="space-y-2">
          {results.map((r, i) => {
            const isBest = i === 0;
            const lowStock = r.stock <= (r.min_stock || 10);
            const isLast = results.length > 1 && i === results.length - 1;
            const warehouseEntries = Object.entries(r.warehouse_stock).filter(([, q]) => q > 0);
            return (
              <div key={r.sku} className={`rounded-2xl p-3 flex items-center gap-3 ${isBest ? 'bg-emerald-50/40 border border-emerald-300' : 'bg-white border border-slate-200'} ${isLast ? 'opacity-80' : ''}`}>
                <img src={r.photo_url} alt={r.name} className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {isBest && <span className="text-[9px] font-extrabold bg-emerald-600 text-white px-2 py-0.5 rounded-full uppercase">Best match</span>}
                    {lowStock && <span className="text-[9px] font-extrabold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full uppercase">Tipis</span>}
                  </div>
                  <h4 className="text-sm font-extrabold text-[#012749] mt-1">{r.name}</h4>
                  <p className="text-[10.5px] font-mono text-slate-500">{r.sku}</p>
                  <p className="text-[11px] text-slate-600 mt-1">
                    <span className="font-bold text-[#012749]">Rp {new Intl.NumberFormat('id-ID').format(r.price)}</span>
                    {warehouseEntries.map(([w, q]) => (
                      <React.Fragment key={w}>
                        <span className="mx-1.5 text-slate-400">·</span>
                        <span className={`${lowStock ? 'text-amber-700' : 'text-emerald-700'} font-semibold`}>{w} {q}</span>
                      </React.Fragment>
                    ))}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={`text-[11px] font-extrabold ${simColorClass(r.similarity)}`}>{Math.round(r.similarity * 100)}%</div>
                  <div className="text-[9px] text-slate-500 uppercase tracking-widest">similarity</div>
                  <button
                    onClick={() => onAddToCart(r)}
                    className={`mt-1 px-3 py-1.5 rounded-full text-[10px] font-extrabold uppercase inline-flex items-center gap-1 ${isBest ? 'bg-[#2d8a4e] text-white' : 'bg-white border border-emerald-300 text-emerald-700'}`}>
                    <span className="material-symbols-outlined text-sm">add</span> Tambah
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-5 pt-4 border-t border-slate-200 text-center">
          <button onClick={onClose} className="text-[11.5px] font-bold text-[#012749] hover:underline inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-base">search</span>
            Tidak ada yang cocok? Cari manual via teks
          </button>
        </div>
      </div>
    </div>
  );
}
