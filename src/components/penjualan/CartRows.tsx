import React from 'react';
import { Lock, LockOpen } from 'lucide-react';
import EmptyState from '../ui/EmptyState';
import { KasirItem } from '../../types';
import type { DiscountType, RakitServiceType, DbServiceType } from '../../types';
import type { SupabaseStockItem } from '../../lib/supabaseClient';
import { getTierPrice } from '../../lib/pricing/getActiveTiers';
import type { TierKey } from '../../lib/pricing/getActiveTiers';
import { getNextUpsellTier } from '../../lib/pricing/getApplicableQtyTier';
import { formatRp } from '../../lib/format';
import { formatIDR } from '../../lib/formatIDR';
import { useWarehouses } from '../../hooks/useWarehouses';
import WarehousePicker from '../warehouse/WarehousePicker';
import { isPreOrder } from '../../lib/wizard/validation';
import { DiscountInlineInput, useDiscountBinding } from '../ui/discount';
import { NumberInput } from '../ui/NumberInput';
import type { PromoRow } from '../../lib/promoProduk/types';
import { computeLinePromoDiscount } from '../../lib/promoProduk/types';

// Map from seeded service_types.code → legacy RakitServiceType union value (mirrors RakitButtonsRow).
const CODE_TO_RAKIT: Record<string, RakitServiceType> = {
  custom_panel: 'jasa_custom_panel',
  wiring_panel: 'jasa_rakit',
};

// Fallback label when serviceTypes prop is not supplied or code not seeded.
const RAKIT_LABEL_FALLBACK: Record<RakitServiceType, string> = {
  jasa_custom_panel: 'Jasa Custom Panel',
  jasa_rakit: 'Wiring Panel',
};

export interface CartRowsProps {
  items: (KasirItem & { _key: number })[];
  stocks: SupabaseStockItem[]; // for per-warehouse stock lookup
  onQtyChange: (key: number, qty: number) => void;
  onWarehouseChange: (key: number, warehouseId: string) => void;
  onRemove: (key: number) => void;
  onDiscountChange?: (key: number, discount_type: DiscountType, discount_value: number | null, discount_amount_rp: number) => void;
  rakitLines?: Array<{ id: string; type: RakitServiceType; description: string; estimatedPrice: number }>;
  onRemoveRakit?: (id: string) => void;
  /**
   * Active service_types from serviceTypesService.fetchActive(). When provided,
   * cart rakit rows display st.name instead of hardcoded labels.
   * Optional — falls back to RAKIT_LABEL_FALLBACK when omitted.
   */
  serviceTypes?: DbServiceType[];
  /**
   * Per-warehouse stock keyed by `${sku}|${warehouse_id}`. When qty > the
   * looked-up stock, the row renders a "PRE-ORDER · kurang N" chip inline.
   * Optional — when omitted / empty (current wizard behavior — the
   * warehouse↔legacy-column dictionary is follow-up work), the chip stays
   * dormant and rows render unchanged.
   */
  stockByWarehouseSku?: Record<string, number>;
  /**
   * Task 14: when false, the Diskon column is hidden entirely.
   * Defaults to true (shown) so existing callers are unaffected.
   */
  modulDiskonOn?: boolean;
  /** Task 7 (widened Phase 1b): active pricing tier — used for per-line tier warning. */
  activeTier?: TierKey;
  /** Task 7: when false, tier warnings are hidden. */
  showTierPill?: boolean;
  /** Item #4b: active promos by SKU. When present, displays a promo badge per matching line. */
  promos?: Map<string, PromoRow>;
  /**
   * Task 7 (Phase 2): per-SKU qty tiers for chip + upsell hint.
   * Key: SKU, Value: array of { min_qty, price }.
   * Optional — when omitted, qty tier chip / hint dormant.
   */
  stockQtyTiers?: Record<string, Array<{ min_qty: number; price: number }>>;
  /**
   * Phase 2.2: toggles manual_override on a specific cart line.
   * When flipping OFF, wizard re-prices to tier+qty-tier; when ON, no side effect.
   */
  onToggleManual?: (key: number) => void;
  /**
   * Phase 2.2: called when kasir types a new unit_price while manual mode is ON.
   * Wizard sets unit_price + master_price_at_sale, clears discount fields.
   */
  onManualPriceOverride?: (key: number, unit_price: number) => void;
}

// ── Per-row sub-component (isolates useDiscountBinding hook call) ─────────────
interface CartRowProps {
  item: KasirItem & { _key: number };
  stock: SupabaseStockItem | undefined;
  warehouses: ReturnType<typeof useWarehouses>['warehouses'];
  stockMap: Record<string, number>;
  onQtyChange: (key: number, qty: number) => void;
  onWarehouseChange: (key: number, warehouseId: string) => void;
  onRemove: (key: number) => void;
  onDiscountChange?: (key: number, discount_type: DiscountType, discount_value: number | null, discount_amount_rp: number) => void;
  modulDiskonOn: boolean;
  activeTier?: TierKey;
  showTierPill?: boolean;
  /** Item #4b: promo active for this SKU, if any. */
  promo?: PromoRow;
  /** Task 7 (Phase 2): per-SKU qty tiers for chip + upsell hint. */
  stockQtyTiers?: Record<string, Array<{ min_qty: number; price: number }>>;
  /** Phase 2.2: toggle manual_override for this line. */
  onToggleManual?: (key: number) => void;
  /** Phase 2.2: set unit_price directly when manual mode is active. */
  onManualPriceOverride?: (key: number, unit_price: number) => void;
}

function CartRow({
  item, stock, warehouses, stockMap,
  onQtyChange, onWarehouseChange, onRemove, onDiscountChange, modulDiskonOn,
  activeTier, showTierPill, promo, stockQtyTiers, onToggleManual, onManualPriceOverride,
}: CartRowProps) {
  const masterPrice = item.master_price_at_sale ?? item.unit_price;

  const binding = useDiscountBinding(masterPrice, item.qty, {
    discount_type: item.discount_type ?? null,
    discount_value: item.discount_value ?? null,
    discount_amount_rp: item.discount_amount_rp ?? 0,
  });

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

  const itemForCheck = {
    sku: item.sku ?? '',
    qty: item.qty,
    warehouse_id: item.warehouse_id ?? undefined,
  };
  const preOrder = itemForCheck.sku ? isPreOrder(itemForCheck, stockMap) : false;
  const stockAtWh = stockMap[`${itemForCheck.sku}|${itemForCheck.warehouse_id ?? ''}`] ?? 0;
  const shortage = preOrder ? Math.max(0, item.qty - stockAtWh) : 0;

  const handlePriceChange = (v: number) => {
    // Phase 2.2: when manual mode is active, route to override handler —
    // no masterPrice ceiling, no binding.setTypedPrice (binding re-initializes
    // on next render from updated master_price_at_sale).
    if (item.manual_override) {
      if (!Number.isFinite(v) || v < 0) return;
      onManualPriceOverride?.(item._key, v);
      return;
    }
    binding.setTypedPrice(v);
    if (onDiscountChange) {
      // After setTypedPrice the binding state hasn't flushed yet (React batch),
      // so recompute inline the same way the hook does.
      const perUnitOff = masterPrice - v;
      const lineTotal = perUnitOff * item.qty;
      if (!Number.isFinite(v) || v < 0 || v > masterPrice) return;
      if (lineTotal === 0) {
        onDiscountChange(item._key, null, null, 0);
      } else {
        onDiscountChange(item._key, 'AMOUNT', lineTotal, lineTotal);
      }
    }
  };

  const handleDiscountChange = (value: number | null, type: DiscountType) => {
    binding.setDiscountFromInput(value, type);
    if (onDiscountChange) {
      // Recompute amount inline (same logic as hook) so parent state stays
      // in sync within the same render cycle.
      let amount = 0;
      if (type !== null && value != null && Number.isFinite(value) && value > 0) {
        const base = masterPrice * item.qty;
        if (type === 'AMOUNT') amount = Math.min(value, base);
        else amount = Math.min(Math.round((base * value) / 100), base);
      }
      onDiscountChange(item._key, type, value, amount);
    }
  };

  // Item #4b: compute promo badge info (read-only, separate from editable discount)
  const promoDiscount = promo ? computeLinePromoDiscount(masterPrice, item.qty, promo) : null;
  const showPromoBadge = promoDiscount !== null && promoDiscount.discount > 0 && promoDiscount.snapshot !== null;

  // Effective discount for subtotal display: promo takes effect when no manual discount set.
  const hasManualDiscount = (item.discount_type != null) && (binding.state.discount_amount_rp > 0);
  const effectiveDiscount = hasManualDiscount
    ? binding.state.discount_amount_rp
    : (showPromoBadge && promoDiscount ? promoDiscount.discount : binding.state.discount_amount_rp);
  const lineAfterDiscount = masterPrice * item.qty - effectiveDiscount;

  return (
    <div
      key={item._key}
      className={`p-3 bg-slate-50 border border-slate-200 rounded mb-2 items-start text-xs ${
        modulDiskonOn
          ? 'grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-2'
          : 'grid grid-cols-[1fr_auto_auto_auto_auto] gap-2'
      }`}
    >
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-extrabold">{item.name}</span>
          {preOrder && (
            <span
              className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-caleo-10 font-bold uppercase tracking-wider"
              title={`Stok kurang ${shortage} unit di gudang ini`}
            >
              ⏳ Pre-order · kurang {shortage}
            </span>
          )}
          {/* Phase 1b Task 6: warn when non-base tier active but product has no explicit tier price */}
          {showTierPill && activeTier !== 'eceran' && stock && (() => {
            const tierPrice = getTierPrice(stock, activeTier!);
            const hasExplicit = tierPrice !== stock.price;
            return !hasExplicit ? (
              <span className="text-amber-600 text-caleo-10">⚠ Harga tier ini belum di-set — pakai harga base</span>
            ) : null;
          })()}
        </div>
        {/* Item #4b: Promo Produk badge — shown when a promo applies to this SKU */}
        {showPromoBadge && promoDiscount && promo && (
          <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-caleo-10 text-emerald-700 font-semibold">
            <span>🏷</span>
            <span>
              Promo:{' '}
              {promo.promo_discount_type === 'PERCENT'
                ? `${promo.promo_discount_value}%`
                : `${formatIDR(promo.promo_discount_value)}/unit`}{' '}
              = -{formatRp(promoDiscount.discount)}
            </span>
          </div>
        )}
        {/* Task 7: Qty tier chip + upsell hint */}
        <div className="flex items-center gap-2 flex-wrap mt-1">
          {item.qty_tier_applied && item.qty_tier_min_qty != null && (
            <span
              className="inline-block text-caleo-10 font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700"
              title={`Harga volume aktif — beli ${item.qty_tier_min_qty}+ jadi Rp ${item.unit_price.toLocaleString('id-ID')}`}
            >
              Vol {item.qty_tier_min_qty}+
            </span>
          )}
          {item.manual_override && (
            <span className="inline-block text-caleo-10 font-bold px-2 py-0.5 rounded-full bg-gray-200 text-gray-700">
              Manual
            </span>
          )}
        </div>
        {/* Task 7: Upsell hint */}
        {(() => {
          const skuTiers = item.sku && stockQtyTiers ? stockQtyTiers[item.sku] : undefined;
          const upsellTier = skuTiers ? getNextUpsellTier(skuTiers, item.qty, item.unit_price) : null;
          return upsellTier ? (
            <p className="text-caleo-11 text-slate-500 italic mt-1">
              Tip: beli {upsellTier.min_qty}+ pcs jadi Rp {upsellTier.price.toLocaleString('id-ID')}/pcs
              <span className="text-emerald-600 ml-1">
                (hemat Rp {(item.unit_price - upsellTier.price).toLocaleString('id-ID')}/pcs untuk customer)
              </span>
            </p>
          ) : null;
        })()}
        {/* Harga input with List label above */}
        <div className="mt-1">
          {modulDiskonOn && masterPrice > 0 && (
            <div className="text-caleo-10 text-slate-400 uppercase tracking-wide mb-0.5">
              List {formatRp(masterPrice)}
            </div>
          )}
          {modulDiskonOn ? (
            <div className="flex items-center gap-1">
              <NumberInput
                value={item.manual_override ? item.unit_price : binding.state.typed_price}
                onChange={handlePriceChange}
                className="w-28 text-right text-xs font-mono border border-slate-200 rounded px-2 py-1 bg-white"
              />
              <button
                type="button"
                onClick={() => onToggleManual?.(item._key)}
                title={item.manual_override
                  ? 'Mode manual — harga diedit langsung'
                  : 'Klik untuk edit harga manual (bukan diskon)'}
                className={`flex items-center justify-center w-6 h-6 rounded transition-colors ${
                  item.manual_override
                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                    : 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600'
                }`}
              >
                {item.manual_override
                  ? <Lock size={12} />
                  : <LockOpen size={12} />
                }
              </button>
            </div>
          ) : (
            <div className="text-caleo-11 text-slate-400 mt-0.5">@ {formatRp(item.unit_price)}</div>
          )}
        </div>
      </div>
      {/* Warehouse selector */}
      <div className="flex gap-0.5 bg-white border border-slate-200 rounded p-0.5">
        <WarehousePicker
          mode="single"
          warehouses={warehouses}
          skuQtyByWarehouseId={skuQtyByWarehouseId}
          value={item.warehouse_id ?? null}
          onChange={(id) => onWarehouseChange(item._key, id)}
        />
      </div>
      {/* Qty stepper */}
      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded p-0.5">
        <button type="button" onClick={() => onQtyChange(item._key, Math.max(1, item.qty - 1))} className="w-6 h-6 rounded bg-slate-100 font-extrabold">−</button>
        <NumberInput
          allowDecimal={false}
          value={item.qty}
          emptyAs={1}
          onChange={n => { if (Number.isInteger(n) && n >= 1) onQtyChange(item._key, n); }}
          className="w-10 text-center font-extrabold text-xs bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button type="button" onClick={() => onQtyChange(item._key, item.qty + 1)} className="w-6 h-6 rounded bg-slate-100 font-extrabold">+</button>
      </div>
      {/* Diskon column — gated by modulDiskonOn */}
      {modulDiskonOn && (
        <div className="min-w-[120px]">
          <DiscountInlineInput
            value={binding.state.discount_value}
            type={binding.state.discount_type}
            base={masterPrice * item.qty}
            onChange={handleDiscountChange}
          />
        </div>
      )}
      <div className="font-extrabold text-[var(--color-caleo-primary)] min-w-[90px] text-right text-caleo-13 pt-1">
        {formatRp(modulDiskonOn ? lineAfterDiscount : item.subtotal)}
      </div>
      <button type="button" onClick={() => onRemove(item._key)} className="text-slate-300 hover:text-rose-500 text-lg leading-none pt-1">✕</button>
    </div>
  );
}

export default function CartRows({ items, stocks, onQtyChange, onWarehouseChange, onRemove, onDiscountChange, rakitLines, onRemoveRakit, stockByWarehouseSku, serviceTypes, modulDiskonOn = true, activeTier, showTierPill, promos, stockQtyTiers, onToggleManual, onManualPriceOverride }: CartRowsProps) {
  // Build reverse lookup: RakitServiceType → display name from DB serviceTypes when supplied.
  const rakitLabelMap: Partial<Record<RakitServiceType, string>> = {};
  if (serviceTypes && serviceTypes.length > 0) {
    for (const st of serviceTypes) {
      const legacyType = CODE_TO_RAKIT[st.code];
      if (legacyType) rakitLabelMap[legacyType] = st.name;
    }
  }
  const getRakitLabel = (type: RakitServiceType): string =>
    rakitLabelMap[type] ?? RAKIT_LABEL_FALLBACK[type] ?? type;
  const stockMap = stockByWarehouseSku ?? {};
  const { warehouses } = useWarehouses();
  const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
  // Net subtotal when modul diskon on — matches per-row display formula
  // (master_price × qty − effectiveDiscount). Without this, the Keranjang
  // header showed gross while each row showed net → visual mismatch.
  // Item #4b: when promo applies and no manual discount is set, use promo discount.
  const subtotalNet = modulDiskonOn
    ? items.reduce((s, i) => {
        const masterPrice = i.master_price_at_sale ?? i.unit_price;
        const manualDiscount = i.discount_amount_rp ?? 0;
        const hasManual = (i.discount_type != null) && manualDiscount > 0;
        let effectiveDiscount = manualDiscount;
        if (!hasManual && i.sku && promos) {
          const p = promos.get(i.sku);
          if (p) {
            const pd = computeLinePromoDiscount(masterPrice, i.qty, p);
            if (pd.discount > 0 && pd.snapshot !== null) effectiveDiscount = pd.discount;
          }
        }
        return s + (masterPrice * i.qty - effectiveDiscount);
      }, 0)
    : subtotal;
  const rakitSubtotal = (rakitLines ?? []).reduce((s, r) => s + r.estimatedPrice, 0);
  const totalLineCount = items.length + (rakitLines?.length ?? 0);
  // Empty-state is only correct when BOTH SKU cart and jasa-rakit list are
  // empty. Returning early on items.length===0 hid pure-jasa lines and was
  // the root cause of the "0 ITEM · Rp X" ghost-cart bug surfaced by the
  // 2026-06-12 e2e audit — the rakit lines below this `if` never rendered
  // for a jasa-only cart even though their subtotal flowed into Total Invoice.
  if (totalLineCount === 0) {
    return (
      <EmptyState message="Belum ada item. Tambahkan dari hasil pencarian di atas." />
    );
  }

  return (
    <>
      <div className="bg-emerald-50 border border-emerald-300 rounded px-3 py-2 mb-2 flex justify-between items-center">
        <div className="font-extrabold text-emerald-700 text-caleo-13 flex items-center gap-2">
          🧺 Keranjang
          <span className="bg-emerald-700 text-white px-2 py-0.5 rounded-full text-caleo-11 font-extrabold">{totalLineCount} item</span>
        </div>
        <div className="font-extrabold text-emerald-700 text-caleo-13">{formatRp(subtotalNet + rakitSubtotal)}</div>
      </div>

      {items.map(item => {
        const stock = stocks.find(s => s.sku === item.sku);
        const promo = item.sku ? promos?.get(item.sku) : undefined;
        return (
          <CartRow
            key={item._key}
            item={item}
            stock={stock}
            warehouses={warehouses}
            stockMap={stockMap}
            onQtyChange={onQtyChange}
            onWarehouseChange={onWarehouseChange}
            onRemove={onRemove}
            onDiscountChange={onDiscountChange}
            modulDiskonOn={modulDiskonOn}
            activeTier={activeTier}
            showTierPill={showTierPill}
            promo={promo}
            stockQtyTiers={stockQtyTiers}
            onToggleManual={onToggleManual}
            onManualPriceOverride={onManualPriceOverride}
          />
        );
      })}

      {rakitLines && rakitLines.length > 0 && (
        <>
          <div className="text-caleo-10 font-extrabold text-orange-700 uppercase tracking-widest mb-2 mt-3 flex items-center gap-2">
            <span>🛠 Jasa</span>
            <span className="flex-1 border-t border-dotted border-slate-300" />
          </div>
          {rakitLines.map(r => {
            const isCustom = r.type === 'jasa_custom_panel';
            const label = getRakitLabel(r.type);
            return (
              <div
                key={r.id}
                className="rounded p-3 mb-2 grid grid-cols-[1fr_auto_auto] gap-3 items-center text-xs"
                style={{
                  background: isCustom
                    ? 'linear-gradient(90deg, rgba(14,165,233,0.08), rgba(14,165,233,0.02) 80%)'
                    : 'linear-gradient(90deg, rgba(245,158,11,0.08), rgba(245,158,11,0.02) 80%)',
                  borderLeft: isCustom ? '3px solid #0ea5e9' : '3px solid #f59e0b',
                }}
              >
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-caleo-10 font-extrabold uppercase tracking-wider ${
                      isCustom
                        ? 'bg-sky-50 text-sky-700 border border-sky-200'
                        : 'bg-orange-50 text-orange-700 border border-orange-200'
                    }`}>
                      {isCustom ? '📦' : '⚡'} {label}
                    </span>
                    <span className="font-extrabold text-caleo-13">{r.description}</span>
                  </div>
                  <div className="text-caleo-11 text-slate-500 mt-0.5">Estimasi · final di-adjust admin saat lock</div>
                </div>
                <div className={`font-extrabold text-sm ${isCustom ? 'text-sky-700' : 'text-amber-700'}`}>
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
            );
          })}
        </>
      )}
    </>
  );
}
