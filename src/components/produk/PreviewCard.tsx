// src/components/produk/PreviewCard.tsx
import React from 'react';
import type { Warehouse } from '../../types';
import { formatIDR } from '../../lib/formatIDR';

export interface ProductPreviewState {
  name: string;          // computed from specs (auto-name)
  sku: string;           // user-entered or "auto"
  category: string;
  unit: string;
  price: number;
  hargaModal: number | null;
  stokAwal: number;
  gudangTujuanId: string | null;
  hasPhoto: boolean;
  thumbnailDataUrl: string | null;  // local blob URL from first chosen photo
  isPendingApproval: boolean;
}

interface Props {
  state: ProductPreviewState;
  warehouses: Warehouse[];
}

export default function PreviewCard({ state, warehouses }: Props) {
  const marginPct =
    state.hargaModal && state.price
      ? ((state.price - state.hargaModal) / state.price) * 100
      : null;

  return (
    <div className="lg:sticky lg:top-6 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded bg-violet-100 text-violet-700 flex items-center justify-center">
          <span className="material-symbols-outlined text-base">visibility</span>
        </div>
        <div>
          <div className="text-caleo-9 font-black uppercase tracking-widest text-violet-700">Live Preview</div>
          <div className="text-caleo-10 text-slate-500">Update otomatis saat Anda ngetik</div>
        </div>
      </div>

      {/* Preview 1: Daftar Stok */}
      <div className="bg-white rounded border border-[var(--color-caleo-mist)] p-4 shadow-sm">
        <div className="text-caleo-9 font-black uppercase tracking-widest text-slate-500 mb-2">Di Daftar Stok</div>
        <div className="bg-slate-50 rounded p-3 flex items-center gap-3 border border-slate-100">
          <div className="w-14 h-14 rounded overflow-hidden bg-slate-300 flex items-center justify-center shrink-0">
            {state.thumbnailDataUrl ? (
              <img src={state.thumbnailDataUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="material-symbols-outlined text-white text-2xl opacity-80">image</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-caleo-9 font-black uppercase tracking-widest bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded-full">
                {state.category || '—'}
              </span>
              <span className="text-caleo-9 font-extrabold text-slate-600 truncate">{state.sku || 'auto'}</span>
            </div>
            <h6 className="text-caleo-13 font-extrabold text-[var(--color-caleo-primary)] truncate">{state.name || 'Nama produk…'}</h6>
            <p className="text-caleo-10 text-slate-500">
              {formatIDR(state.price)} / {state.unit}
              {marginPct !== null && ` · Margin ${marginPct.toFixed(1)}%`}
            </p>
          </div>
        </div>
      </div>

      {/* Preview 2: Stok per Gudang */}
      <div className="bg-white rounded border border-[var(--color-caleo-mist)] p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="text-caleo-9 font-black uppercase tracking-widest text-slate-500">Stok per Gudang</div>
          {state.isPendingApproval && (
            <span className="text-caleo-9 font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
              Pending Approval
            </span>
          )}
        </div>
        <div className="space-y-1.5">
          {warehouses.filter(w => w.is_active).map(w => {
            const isTarget = state.gudangTujuanId === w.id;
            const qty = isTarget ? state.stokAwal : 0;
            return (
              <div key={w.id} className={`flex items-center justify-between rounded px-3 py-2 border ${
                isTarget ? 'bg-emerald-50 border-emerald-100' : 'bg-slate-50 border-slate-100'
              }`}>
                <div className="text-caleo-11 font-extrabold text-[var(--color-caleo-primary)]">{w.name}</div>
                <div className={`text-base font-black ${isTarget ? 'text-caleo-success' : 'text-slate-400'}`}>
                  {qty} {state.unit}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
