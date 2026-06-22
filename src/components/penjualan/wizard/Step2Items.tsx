import { useState } from 'react';
import type { KasirItem, RakitServiceType, DbServiceType } from '../../../types';
import type { SupabaseStockItem } from '../../../lib/supabaseClient';
import { formatRp } from '../../../lib/format';
import CartRows from '../CartRows';
import RakitButtonsRow from '../RakitButtonsRow';
import RakitInlineForm from '../RakitInlineForm';
import { isPreOrder } from '../../../lib/wizard/validation';

type CartItem = KasirItem & { _key: number };
type RakitLine = {
  id: string;
  type: RakitServiceType;
  description: string;
  estimatedPrice: number;
  hppEstimate: number;
};

interface Props {
  cart: CartItem[];
  stocks: SupabaseStockItem[];
  onAddItem: (stock: SupabaseStockItem) => void;
  onQtyChange: (key: number, qty: number) => void;
  onWarehouseChange: (key: number, warehouseId: string) => void;
  onRemoveItem: (key: number) => void;
  onClearCart: () => void;
  subtotal: number;          // SKU subtotal only
  rakitSubtotal: number;     // jasa subtotal only
  rakitLines: RakitLine[];
  rakitFormOpen: boolean;
  rakitFormType: RakitServiceType | null;
  onOpenRakitForm: (t: RakitServiceType) => void;
  onCancelRakitForm: () => void;
  onAddRakitLine: (line: { type: RakitServiceType; description: string; estimatedPrice: number; hppEstimate: number }) => void;
  onRemoveRakitLine: (id: string) => void;
  stockByWarehouseSku: Record<string, number>;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  /**
   * Active service_types from serviceTypesService.fetchActive(). Passed down
   * to CartRows so it can display st.name instead of hardcoded labels.
   * RakitButtonsRow fetches independently on its own useEffect.
   */
  serviceTypes?: DbServiceType[];
}

export default function Step2Items(props: Props) {
  const [q, setQ] = useState('');

  const filtered = q.trim().length > 0
    ? props.stocks.filter(s =>
        s.name.toLowerCase().includes(q.toLowerCase()) ||
        s.sku.toLowerCase().includes(q.toLowerCase())
      ).slice(0, 8)
    : [];

  const preOrderCount = props.cart
    .filter((it): it is CartItem & { sku: string } => typeof it.sku === 'string' && it.sku.length > 0)
    .filter((it) => isPreOrder(
      { sku: it.sku, qty: it.qty, warehouse_id: it.warehouse_id ?? undefined },
      props.stockByWarehouseSku,
    ))
    .length;

  const skuCount = props.cart.length;
  const jasaCount = props.rakitLines.length;
  const totalAll = props.subtotal + props.rakitSubtotal;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-6">
      {/* LEFT: Search + add + jasa buttons */}
      <div className="lg:col-span-5 space-y-3">
        <div>
          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Tambah Produk</label>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama / SKU…"
            className="w-full px-4 py-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-[#012749]/30 focus:border-[#012749]"
          />
        </div>

        {filtered.length > 0 && (
          <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
            {filtered.map((s) => {
              const atas = s.stock_atas ?? 0;
              const bawah = s.stock_bawah ?? 0;
              const hasStock = atas + bawah > 0;
              return (
                <div key={s.sku} className="px-4 py-3 hover:bg-slate-50 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">{s.name}</div>
                    <div className="text-[11px] text-slate-500">SKU: {s.sku} · {formatRp(s.price)}</div>
                    <div className="text-[11px] mt-0.5">
                      <span className={atas > 0 ? 'text-emerald-600' : 'text-rose-600'}>Atas: {atas}</span>
                      <span className="text-slate-400"> · </span>
                      <span className={bawah > 0 ? 'text-emerald-600' : 'text-rose-600'}>Bawah: {bawah}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => props.onAddItem(s)}
                    disabled={!hasStock && false /* allow pre-order add */}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-[#012749] text-white hover:opacity-90"
                  >
                    + Tambah
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-2">
          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 mt-4">Tambah Jasa (Optional)</label>
          <RakitButtonsRow
            formOpen={props.rakitFormOpen}
            formType={props.rakitFormType}
            onOpen={props.onOpenRakitForm}
          />
          <p className="text-[11px] text-slate-500 mt-1.5 italic">Skip jasa kalau pesanan ini cuma jual komponen.</p>
        </div>

        {props.rakitFormOpen && props.rakitFormType && (
          <div className="mt-3">
            <RakitInlineForm
              type={props.rakitFormType}
              serviceTypeName={(() => {
                // Resolve dynamic name from serviceTypes for form header.
                // code→RakitServiceType reverse map mirrors RakitButtonsRow.
                const CODE_TO_RAKIT: Record<string, string> = {
                  custom_panel: 'jasa_custom_panel',
                  wiring_panel: 'jasa_rakit',
                };
                const match = (props.serviceTypes ?? []).find(
                  st => CODE_TO_RAKIT[st.code] === props.rakitFormType,
                );
                return match?.name;
              })()}
              onAdd={props.onAddRakitLine}
              onCancel={props.onCancelRakitForm}
            />
          </div>
        )}
      </div>

      {/* RIGHT: Cart + totals */}
      <div className="lg:col-span-7">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
            Keranjang ({skuCount} item{jasaCount > 0 ? ` · ${jasaCount} jasa` : ''})
          </label>
          {(skuCount > 0 || jasaCount > 0) && (
            <button
              type="button"
              onClick={props.onClearCart}
              className="text-[11px] text-rose-600 font-semibold hover:underline"
            >
              × Kosongkan
            </button>
          )}
        </div>

        <CartRows
          items={props.cart}
          stocks={props.stocks}
          onQtyChange={props.onQtyChange}
          onWarehouseChange={props.onWarehouseChange}
          onRemove={props.onRemoveItem}
          rakitLines={props.rakitLines}
          onRemoveRakit={props.onRemoveRakitLine}
          stockByWarehouseSku={props.stockByWarehouseSku}
          serviceTypes={props.serviceTypes}
        />

        {preOrderCount > 0 && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800 flex items-start gap-2">
            <span>⏳</span>
            <div>
              <strong>{preOrderCount} item pre-order</strong> di pesanan ini — stok minus akan dipenuhi setelah supplier kirim
              (lihat menu Pembelian).
            </div>
          </div>
        )}

        {(skuCount > 0 || jasaCount > 0) && (
          <div className="mt-3 bg-slate-50 rounded-xl p-4 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-600">
                Subtotal Produk ({skuCount} item{preOrderCount > 0 ? `, ${preOrderCount} pre-order` : ''})
              </span>
              <span className="font-semibold">{formatRp(props.subtotal)}</span>
            </div>
            {jasaCount > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-600">Subtotal Jasa ({jasaCount} lump-sum)</span>
                <span className="font-semibold">{formatRp(props.rakitSubtotal)}</span>
              </div>
            )}
            <div className="border-t border-slate-200 my-1.5"></div>
            <div className="flex justify-between text-sm">
              <span className="font-bold text-slate-700">Total Pesanan</span>
              <span className="font-extrabold text-[#012749] text-lg">{formatRp(totalAll)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
