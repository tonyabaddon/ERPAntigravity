import React from 'react';
import type { StockItem, ProductPhoto, Warehouse } from '../../types';

interface Props {
  item: StockItem;
  photos: ProductPhoto[];
  warehouses: Warehouse[];
  stockByWarehouseId: Map<string, number>;
  currentPhotoIndex: number;
  onPhotoSelect: (sku: string, index: number) => void;
  onClose: (sku: string) => void;
  onEdit: (sku: string) => void;
  onAddPhoto: (sku: string) => void;
  onHistory: (sku: string) => void;
}

export default function InlineExpandPanel({
  item, photos, warehouses, stockByWarehouseId,
  currentPhotoIndex, onPhotoSelect, onClose, onEdit, onAddPhoto, onHistory,
}: Props) {
  const mainPhoto = photos[currentPhotoIndex];
  const sortedWarehouses = [...warehouses].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="bg-white rounded-sm border border-violet-200 p-5 shadow-md">
      <div className="flex gap-6">
        <div className="w-[280px] h-[280px] rounded-sm flex-shrink-0 bg-slate-100 flex items-center justify-center overflow-hidden">
          {mainPhoto ? (
            <img src={mainPhoto.url} alt={item.name} className="w-full h-full object-cover" />
          ) : (
            <span className="material-symbols-outlined text-6xl text-slate-300">image_not_supported</span>
          )}
        </div>
        <div className="flex-1 flex flex-col">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-[10px] font-extrabold text-violet-700 uppercase tracking-widest">
                Foto Produk · {photos.length > 0 ? `${currentPhotoIndex + 1} dari ${photos.length}` : 'belum ada foto'}
              </p>
              <h3 className="text-base font-extrabold text-[var(--color-caleo-primary)] mt-0.5">{item.name}</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                <span className="font-mono">{item.sku}</span> · {item.category}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onClose(item.sku)}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full text-[11px] font-extrabold inline-flex items-center gap-1"
              aria-label={`Tutup panel ${item.name}`}
            >
              <span className="material-symbols-outlined text-base">close</span> Tutup
            </button>
          </div>
          {photos.length > 1 && (
            <>
              <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                Foto lain — klik untuk ganti foto utama
              </p>
              <div className="flex gap-2 mb-4">
                {photos.map((p, i) => (
                  <button
                    type="button"
                    key={p.path}
                    onClick={() => onPhotoSelect(item.sku, i)}
                    aria-label={`Foto ${i + 1} dari ${photos.length}`}
                    aria-current={i === currentPhotoIndex}
                    className={`w-16 h-16 rounded-sm overflow-hidden bg-slate-100 ${
                      i === currentPhotoIndex
                        ? 'ring-2 ring-violet-500'
                        : 'opacity-60 hover:opacity-100 ring-2 ring-transparent hover:ring-violet-300'
                    }`}
                  >
                    <img src={p.url} alt={`Foto ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="bg-slate-50 rounded-sm px-3 py-2 mb-3">
            <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1">
              Stok per Gudang
            </p>
            <div className="flex flex-wrap gap-4 text-[12px]">
              {sortedWarehouses.map(w => (
                <span key={w.id} className="font-bold">
                  <span className="text-slate-500">{w.name}:</span>{' '}
                  <span className="text-emerald-700">{stockByWarehouseId.get(w.id) ?? 0}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="flex gap-2 mt-auto flex-wrap">
            <button type="button" onClick={() => onEdit(item.sku)} className="px-4 py-2 bg-[var(--color-caleo-primary)] hover:bg-[#01345f] text-white rounded-full text-[11px] font-extrabold uppercase tracking-wider inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base">edit</span> Edit Produk
            </button>
            <button type="button" onClick={() => onAddPhoto(item.sku)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-[var(--color-caleo-primary)] rounded-full text-[11px] font-extrabold uppercase tracking-wider inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base">add_a_photo</span> Tambah Foto
            </button>
            <button type="button" onClick={() => onHistory(item.sku)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-[var(--color-caleo-primary)] rounded-full text-[11px] font-extrabold uppercase tracking-wider inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base">history</span> Riwayat Stok
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
