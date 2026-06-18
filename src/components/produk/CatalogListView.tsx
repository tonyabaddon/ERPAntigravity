import React from 'react';
import type { StockItem, Warehouse, ProductPhoto } from '../../types';
import StokGudangInline from './StokGudangInline';
import InlineExpandPanel from './InlineExpandPanel';

interface Props {
  items: StockItem[];
  warehouses: Warehouse[];
  minStockThreshold: number;
  expandedRows: Set<string>;
  currentPhotoIndex: Map<string, number>;
  onToggleRow: (sku: string) => void;
  onPhotoSelect: (sku: string, index: number) => void;
  onCloseRow: (sku: string) => void;
  onEdit: (sku: string) => void;
  onAddPhoto: (sku: string) => void;
  onHistory: (sku: string) => void;
}

function photoUrlsToMeta(urls?: ProductPhoto[]): ProductPhoto[] {
  return urls ?? [];
}

function buildStockMap(item: StockItem, warehouses: Warehouse[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of warehouses) {
    if (w.code === 'ATAS') m.set(w.id, item.stock_atas ?? 0);
    else if (w.code === 'BAWAH') m.set(w.id, item.stock_bawah ?? 0);
  }
  return m;
}

export default function CatalogListView({
  items, warehouses, minStockThreshold,
  expandedRows, currentPhotoIndex,
  onToggleRow, onPhotoSelect, onCloseRow, onEdit, onAddPhoto, onHistory,
}: Props) {
  return (
    <div className="bg-white rounded-3xl border border-[#e5eeff] shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b-2 border-slate-200 bg-slate-50/50">
            <th className="py-2.5 pl-3 pr-2 text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider w-14">Foto</th>
            <th className="py-2.5 px-2 text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider">SKU</th>
            <th className="py-2.5 px-2 text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider">Nama Produk</th>
            <th className="py-2.5 px-2 text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider">Kategori</th>
            <th className="py-2.5 px-2 text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider text-right">Harga</th>
            <th className="py-2.5 px-2 text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider text-center">Stok</th>
            <th className="py-2.5 px-2 text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider w-10"></th>
            <th className="py-2.5 px-2 pr-3 text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider text-right">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => {
            const isExpanded = expandedRows.has(item.sku);
            const stockMap = buildStockMap(item, warehouses);
            const photos = photoUrlsToMeta(item.photo_urls);
            const photoIndex = currentPhotoIndex.get(item.sku) ?? 0;
            const firstPhoto = photos[0];
            const hasPhoto = !!firstPhoto;
            return (
              <React.Fragment key={item.sku}>
                <tr className={`border-b border-slate-100 hover:bg-blue-50/40 group ${isExpanded ? 'bg-violet-50/40' : ''}`}>
                  <td className="py-2 pl-3 pr-2">
                    {hasPhoto ? (
                      <button
                        type="button"
                        onClick={() => onToggleRow(item.sku)}
                        className={`w-10 h-10 rounded-lg overflow-hidden bg-slate-100 ${isExpanded ? 'ring-2 ring-violet-500' : 'hover:ring-2 hover:ring-emerald-400'}`}
                        aria-label={`Lihat foto ${item.name}`}
                        aria-expanded={isExpanded}
                      >
                        <img src={firstPhoto.url} alt="" loading="lazy" className="w-full h-full object-cover" />
                      </button>
                    ) : (
                      <div className="w-10 h-10 bg-slate-50 border border-dashed border-slate-300 rounded-lg flex items-center justify-center" title="Belum ada foto">
                        <span className="material-symbols-outlined text-base text-slate-400">image_not_supported</span>
                      </div>
                    )}
                  </td>
                  <td className="py-2 px-2 font-mono text-[12px] text-slate-600">{item.sku}</td>
                  <td className="py-2 px-2 font-bold text-[#012749]">{item.name}</td>
                  <td className="py-2 px-2 text-slate-600">{item.category}</td>
                  <td className="py-2 px-2 text-right font-extrabold text-[#012749]">
                    Rp {new Intl.NumberFormat('id-ID').format(item.price)}
                  </td>
                  <td className="py-2 px-2 text-center">
                    <StokGudangInline
                      total={item.stock}
                      warehouses={warehouses}
                      stockByWarehouseId={stockMap}
                      minStock={minStockThreshold}
                    />
                  </td>
                  <td className="py-2 px-2 text-center">
                    <button
                      type="button"
                      onClick={() => hasPhoto && onToggleRow(item.sku)}
                      disabled={!hasPhoto}
                      className="p-1 rounded-full hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label={isExpanded ? 'Tutup panel' : 'Buka panel'}
                      aria-expanded={isExpanded}
                    >
                      <span className="material-symbols-outlined text-base text-slate-500">
                        {isExpanded ? 'expand_less' : 'expand_more'}
                      </span>
                    </button>
                  </td>
                  <td className="py-2 pr-3 px-2 text-right">
                    <button
                      type="button"
                      onClick={() => onEdit(item.sku)}
                      className="text-[#012749] hover:bg-slate-100 rounded-full p-1 opacity-60 group-hover:opacity-100"
                      aria-label={`Edit ${item.name}`}
                    >
                      <span className="material-symbols-outlined text-lg">edit</span>
                    </button>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="bg-violet-50/40 border-b-2 border-violet-300">
                    <td colSpan={8} className="px-3 pb-5 pt-1">
                      <InlineExpandPanel
                        item={item}
                        photos={photos}
                        warehouses={warehouses}
                        stockByWarehouseId={stockMap}
                        currentPhotoIndex={photoIndex}
                        onPhotoSelect={onPhotoSelect}
                        onClose={onCloseRow}
                        onEdit={onEdit}
                        onAddPhoto={onAddPhoto}
                        onHistory={onHistory}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      {items.length === 0 && (
        <p className="text-center py-12 text-slate-400 font-semibold text-sm">
          Tidak ada produk yang cocok dengan filter pencarian.
        </p>
      )}
    </div>
  );
}
