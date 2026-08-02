import React, { useState } from 'react';
import type { StockItem, Warehouse, ProductPhoto } from '../../types';
import EmptyState from '../ui/EmptyState';
import type { PromoDiscountType } from '../../lib/promoProduk/types';
import { formatIDR } from '../../lib/formatIDR';
import StokGudangInline from './StokGudangInline';
import InlineExpandPanel from './InlineExpandPanel';
import PromoInlineEdit from '../promo/PromoInlineEdit';

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
  showToast?: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onPromoUpdated?: (sku: string, promo: { promo_discount_type: PromoDiscountType | null; promo_discount_value: number | null; promo_expires_at: string | null }) => void;
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

function promoDisplayLabel(item: StockItem): string {
  if (!item.promo_discount_type || item.promo_discount_value == null) return '—';
  if (item.promo_discount_type === 'PERCENT') return `${item.promo_discount_value}%`;
  return `${formatIDR(item.promo_discount_value)}/unit`;
}

function expiryDisplayLabel(item: StockItem): string {
  if (!item.promo_discount_type) return '—';
  if (!item.promo_expires_at) return '∞ permanen';
  const d = new Date(item.promo_expires_at);
  if (d < new Date()) return 'Kadaluwarsa';
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function CatalogListView({
  items, warehouses, minStockThreshold,
  expandedRows, currentPhotoIndex,
  onToggleRow, onPhotoSelect, onCloseRow, onEdit, onAddPhoto, onHistory,
  showToast, onPromoUpdated,
}: Props) {
  const [promoPopoverSku, setPromoPopoverSku] = useState<string | null>(null);

  return (
    <div className="bg-white rounded border border-[var(--color-caleo-mist)] shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b-2 border-slate-200 bg-slate-50/50">
            <th className="py-2.5 pl-3 pr-2 text-caleo-10 font-extrabold text-slate-500 uppercase tracking-wider w-14">Foto</th>
            <th className="py-2.5 px-2 text-caleo-10 font-extrabold text-slate-500 uppercase tracking-wider">SKU</th>
            <th className="py-2.5 px-2 text-caleo-10 font-extrabold text-slate-500 uppercase tracking-wider">Nama Produk</th>
            <th className="py-2.5 px-2 text-caleo-10 font-extrabold text-slate-500 uppercase tracking-wider">Kategori</th>
            <th className="py-2.5 px-2 text-caleo-10 font-extrabold text-slate-500 uppercase tracking-wider text-right">Harga</th>
            <th className="py-2.5 px-2 text-caleo-10 font-extrabold text-slate-500 uppercase tracking-wider">Promo</th>
            <th className="py-2.5 px-2 text-caleo-10 font-extrabold text-slate-500 uppercase tracking-wider">Berlaku Hingga</th>
            <th className="py-2.5 px-2 text-caleo-10 font-extrabold text-slate-500 uppercase tracking-wider text-center">Stok</th>
            <th className="py-2.5 px-2 text-caleo-10 font-extrabold text-slate-500 uppercase tracking-wider w-10"></th>
            <th className="py-2.5 px-2 pr-3 text-caleo-10 font-extrabold text-slate-500 uppercase tracking-wider text-right">Aksi</th>
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
            const hasPromo = !!item.promo_discount_type;
            const promoPopoverOpen = promoPopoverSku === item.sku;

            return (
              <React.Fragment key={item.sku}>
                <tr className={`border-b border-slate-100 hover:bg-blue-50/40 group ${isExpanded ? 'bg-violet-50/40' : ''}`}>
                  <td className="py-2 pl-3 pr-2">
                    {hasPhoto ? (
                      <button
                        type="button"
                        onClick={() => onToggleRow(item.sku)}
                        className={`w-10 h-10 rounded overflow-hidden bg-slate-100 ${isExpanded ? 'ring-2 ring-violet-500' : 'hover:ring-2 hover:ring-emerald-400'}`}
                        aria-label={`Lihat foto ${item.name}`}
                        aria-expanded={isExpanded}
                      >
                        <img src={firstPhoto.url} alt="" loading="lazy" className="w-full h-full object-cover" />
                      </button>
                    ) : (
                      <div className="w-10 h-10 bg-slate-50 border border-dashed border-slate-300 rounded flex items-center justify-center" title="Belum ada foto">
                        <span className="material-symbols-outlined text-base text-slate-400">image_not_supported</span>
                      </div>
                    )}
                  </td>
                  <td className="py-2 px-2 font-mono text-xs text-slate-600">{item.sku}</td>
                  <td className="py-2 px-2 font-bold text-[var(--color-caleo-primary)]">{item.name}</td>
                  <td className="py-2 px-2 text-slate-600">{item.category}</td>
                  <td className="py-2 px-2 text-right font-extrabold text-[var(--color-caleo-primary)]">
                    Rp {new Intl.NumberFormat('id-ID').format(item.price)}
                  </td>
                  {/* Promo column */}
                  <td className="py-2 px-2 relative">
                    <button
                      type="button"
                      onClick={() => setPromoPopoverSku(promoPopoverOpen ? null : item.sku)}
                      className={`text-xs font-semibold rounded px-2 py-0.5 transition-colors ${
                        hasPromo
                          ? 'text-blue-700 bg-blue-50 hover:bg-blue-100'
                          : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'
                      }`}
                      title={hasPromo ? 'Klik untuk edit promo' : 'Klik untuk set promo'}
                    >
                      {hasPromo ? promoDisplayLabel(item) : '+ Set promo'}
                    </button>
                    {promoPopoverOpen && showToast && (
                      <PromoInlineEdit
                        sku={item.sku}
                        skuName={item.name}
                        price={item.price}
                        currentType={item.promo_discount_type}
                        currentValue={item.promo_discount_value}
                        currentExpiresAt={item.promo_expires_at}
                        onClose={() => setPromoPopoverSku(null)}
                        onSaved={(promo) => {
                          onPromoUpdated?.(item.sku, promo);
                          setPromoPopoverSku(null);
                        }}
                        showToast={showToast}
                      />
                    )}
                  </td>
                  {/* Berlaku hingga column */}
                  <td className="py-2 px-2 text-xs text-slate-500">
                    {expiryDisplayLabel(item)}
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
                      className="text-[var(--color-caleo-primary)] hover:bg-slate-100 rounded-full p-1 opacity-60 group-hover:opacity-100"
                      aria-label={`Edit ${item.name}`}
                    >
                      <span className="material-symbols-outlined text-lg">edit</span>
                    </button>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="bg-violet-50/40 border-b-2 border-violet-300">
                    <td colSpan={10} className="px-3 pb-5 pt-1">
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
        <EmptyState message="Tidak ada produk yang cocok dengan filter pencarian." />
      )}
    </div>
  );
}
