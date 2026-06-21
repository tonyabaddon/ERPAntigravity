import React from 'react';
import { KasirItem } from '../../types';
import type { RakitServiceType } from '../../types';
import type { SupabaseStockItem } from '../../lib/supabaseClient';
import { formatRp } from '../../lib/format';
import { useWarehouses } from '../../hooks/useWarehouses';
import WarehousePicker from '../warehouse/WarehousePicker';
import { isPreOrder } from '../../lib/wizard/validation';

export interface CartRowsProps {
  items: (KasirItem & { _key: number })[];
  stocks: SupabaseStockItem[]; // for per-warehouse stock lookup
  onQtyChange: (key: number, qty: number) => void;
  onWarehouseChange: (key: number, warehouseId: string) => void;
  onRemove: (key: number) => void;
  rakitLines?: Array<{ id: string; type: RakitServiceType; description: string; estimatedPrice: number }>;
  onRemoveRakit?: (id: string) => void;
  /**
   * Per-warehouse stock keyed by `${sku}|${warehouse_id}`. When qty > the
   * looked-up stock, the row renders a "PRE-ORDER · kurang N" chip inline.
   * Optional — when omitted / empty (current wizard behavior — the
   * warehouse↔legacy-column dictionary is follow-up work), the chip stays
   * dormant and rows render unchanged.
   */
  stockByWarehouseSku?: Record<string, number>;
}

export default function CartRows({ items, stocks, onQtyChange, onWarehouseChange, onRemove, rakitLines, onRemoveRakit, stockByWarehouseSku }: CartRowsProps) {
  const stockMap = stockByWarehouseSku ?? {};
  const { warehouses } = useWarehouses();
  const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const rakitSubtotal = (rakitLines ?? []).reduce((s, r) => s + r.estimatedPrice, 0);
  const totalLineCount = items.length + (rakitLines?.length ?? 0);
  // Empty-state is only correct when BOTH SKU cart and jasa-rakit list are
  // empty. Returning early on items.length===0 hid pure-jasa lines and was
  // the root cause of the "0 ITEM · Rp X" ghost-cart bug surfaced by the
  // 2026-06-12 e2e audit — the rakit lines below this `if` never rendered
  // for a jasa-only cart even though their subtotal flowed into Total Invoice.
  if (totalLineCount === 0) {
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
          <span className="bg-emerald-700 text-white px-2 py-0.5 rounded-full text-[11px] font-extrabold">{totalLineCount} item</span>
        </div>
        <div className="font-extrabold text-emerald-700 text-[13px]">{formatRp(subtotal + rakitSubtotal)}</div>
      </div>

      {items.map(item => {
        const stock = stocks.find(s => s.sku === item.sku);
        // Build a qty map keyed by warehouse id using the warehouse code
        // to match stock_atas / stock_bawah fields on SupabaseStockItem.
        const skuQtyByWarehouseId: Record<string, number> = {};
        if (stock) {
          for (const w of warehouses) {
            const lowerCode = w.code.toLowerCase();
            if (lowerCode === 'atas') skuQtyByWarehouseId[w.id] = stock.stock_atas ?? 0;
            else if (lowerCode === 'bawah') skuQtyByWarehouseId[w.id] = stock.stock_bawah ?? 0;
          }
        }
        // Pre-order detection: when qty exceeds the per-warehouse stock at
        // the picked warehouse, surface a chip so the operator can confirm
        // intent before saving. Powered by the shared isPreOrder validator
        // (the same helper the future T25 audit will use server-side). If
        // the parent doesn't pass stockByWarehouseSku (current wizard does
        // not — warehouse↔legacy-column lookup is follow-up scope), the map
        // is empty and the chip stays dormant.
        const itemForCheck = {
          sku: item.sku ?? '',
          qty: item.qty,
          warehouse_id: item.warehouse_id ?? undefined,
        };
        const preOrder = itemForCheck.sku
          ? isPreOrder(itemForCheck, stockMap)
          : false;
        const stockAtWh = stockMap[`${itemForCheck.sku}|${itemForCheck.warehouse_id ?? ''}`] ?? 0;
        const shortage = preOrder ? Math.max(0, item.qty - stockAtWh) : 0;

        return (
          <div
            key={item._key}
            className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl mb-2 items-center text-[12px]"
          >
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-extrabold">{item.name}</span>
                {preOrder && (
                  <span
                    className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold uppercase tracking-wider"
                    title={`Stok kurang ${shortage} unit di gudang ini`}
                  >
                    ⏳ Pre-order · kurang {shortage}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">@ {formatRp(item.unit_price)}</div>
            </div>
            {/* Warehouse selector */}
            <div className="flex gap-0.5 bg-white border border-slate-200 rounded-lg p-0.5">
              <WarehousePicker
                mode="single"
                warehouses={warehouses}
                skuQtyByWarehouseId={skuQtyByWarehouseId}
                value={item.warehouse_id ?? null}
                onChange={(id) => onWarehouseChange(item._key, id)}
              />
            </div>
            {/* Qty stepper */}
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
              <button type="button" onClick={() => onQtyChange(item._key, Math.max(1, item.qty - 1))} className="w-6 h-6 rounded bg-slate-100 font-extrabold">−</button>
              <input
                type="number"
                min={1}
                value={item.qty}
                onChange={e => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 1) onQtyChange(item._key, n);
                }}
                className="w-10 text-center font-extrabold text-[12px] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button type="button" onClick={() => onQtyChange(item._key, item.qty + 1)} className="w-6 h-6 rounded bg-slate-100 font-extrabold">+</button>
            </div>
            <div className="font-extrabold text-[#012749] min-w-[90px] text-right text-[13px]">{formatRp(item.subtotal)}</div>
            <button type="button" onClick={() => onRemove(item._key)} className="text-slate-300 hover:text-rose-500 text-lg leading-none">✕</button>
          </div>
        );
      })}

      {rakitLines && rakitLines.length > 0 && (
        <>
          <div className="text-[10px] font-extrabold text-orange-700 uppercase tracking-widest mb-2 mt-3 flex items-center gap-2">
            <span>🛠 Jasa Rakit</span>
            <span className="flex-1 border-t border-dotted border-slate-300" />
          </div>
          {rakitLines.map(r => (
            <div
              key={r.id}
              className="rounded-xl p-3 mb-2 grid grid-cols-[1fr_auto_auto] gap-3 items-center text-[12px]"
              style={{
                background: r.type === 'jasa_custom_panel'
                  ? 'linear-gradient(90deg, rgba(14,165,233,0.08), rgba(14,165,233,0.02) 80%)'
                  : 'linear-gradient(90deg, rgba(245,158,11,0.08), rgba(245,158,11,0.02) 80%)',
                borderLeft: r.type === 'jasa_custom_panel' ? '3px solid #0ea5e9' : '3px solid #f59e0b',
              }}
            >
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                    r.type === 'jasa_custom_panel'
                      ? 'bg-sky-50 text-sky-700 border border-sky-200'
                      : 'bg-orange-50 text-orange-700 border border-orange-200'
                  }`}>
                    {r.type === 'jasa_custom_panel' ? '📦 Jasa Custom Panel' : '⚡ Jasa Rakit'}
                  </span>
                  <span className="font-extrabold text-[13px]">{r.description}</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">Estimasi · final di-adjust admin saat lock</div>
              </div>
              <div className={`font-extrabold text-[14px] ${r.type === 'jasa_custom_panel' ? 'text-sky-700' : 'text-amber-700'}`}>
                {formatRp(r.estimatedPrice)}
              </div>
              <button
                type="button"
                onClick={() => onRemoveRakit?.(r.id)}
                className="text-slate-300 hover:text-rose-500 text-lg"
              >
                ✕
              </button>
            </div>
          ))}
        </>
      )}
    </>
  );
}
