// PromoInlineEdit.tsx
// Small popover mini-form for setting/clearing a promo on a single SKU.
// Rendered inline from CatalogListView column cell click.

import React, { useEffect, useRef, useState } from 'react';
import { upsertStockPromo } from '../../lib/promoProduk/api';
import type { PromoDiscountType } from '../../lib/promoProduk/types';
import { formatIDR } from '../../lib/formatIDR';
import { wibDateString } from '../../lib/format';
import { extractErrorMessage } from '../../lib/extractErrorMessage';

interface Props {
  sku: string;
  skuName: string;
  price: number;
  currentType: PromoDiscountType | null | undefined;
  currentValue: number | null | undefined;
  currentExpiresAt: string | null | undefined;
  onClose: () => void;
  onSaved: (promo: {
    promo_discount_type: PromoDiscountType | null;
    promo_discount_value: number | null;
    promo_expires_at: string | null;
  }) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function PromoInlineEdit({
  sku,
  skuName,
  price,
  currentType,
  currentValue,
  currentExpiresAt,
  onClose,
  onSaved,
  showToast,
}: Props) {
  const [discountType, setDiscountType] = useState<PromoDiscountType>(currentType ?? 'PERCENT');
  const [discountValue, setDiscountValue] = useState<string>(
    currentValue != null ? String(currentValue) : '',
  );
  const [expiryMode, setExpiryMode] = useState<'forever' | 'date'>(
    currentExpiresAt ? 'date' : 'forever',
  );
  const [expiryDate, setExpiryDate] = useState<string>(
    currentExpiresAt ? currentExpiresAt.slice(0, 10) : '',
  );
  const [saving, setSaving] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const numValue = parseFloat(discountValue);

  const validationError = (() => {
    if (!discountValue || isNaN(numValue) || numValue <= 0) return 'Nilai harus > 0';
    if (discountType === 'PERCENT' && (numValue < 0.01 || numValue > 100)) return 'Persen 0.01–100';
    if (discountType === 'AMOUNT' && numValue > price) return `Melebihi harga (${formatIDR(price)})`;
    if (expiryMode === 'date') {
      if (!expiryDate) return 'Pilih tanggal';
      if (new Date(expiryDate) <= new Date()) return 'Harus di masa depan';
    }
    return null;
  })();

  const handleSave = async () => {
    if (validationError) { showToast(validationError, 'warning'); return; }
    setSaving(true);
    try {
      const expiresAt = expiryMode === 'date' ? new Date(expiryDate).toISOString() : null;
      await upsertStockPromo({
        sku,
        promoDiscountType: discountType,
        promoDiscountValue: numValue,
        promoExpiresAt: expiresAt,
      });
      showToast('Promo berhasil disimpan', 'success');
      onSaved({ promo_discount_type: discountType, promo_discount_value: numValue, promo_expires_at: expiresAt });
      onClose();
    } catch (err) {
      const msg = extractErrorMessage(err);
      showToast(`Gagal: ${msg}`, 'warning');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!window.confirm(`Hapus promo untuk ${sku}?`)) return;
    setSaving(true);
    try {
      await upsertStockPromo({ sku, promoDiscountType: null, promoDiscountValue: null, promoExpiresAt: null });
      showToast('Promo dihapus', 'success');
      onSaved({ promo_discount_type: null, promo_discount_value: null, promo_expires_at: null });
      onClose();
    } catch (err) {
      const msg = extractErrorMessage(err);
      showToast(`Gagal: ${msg}`, 'warning');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={popoverRef}
      className="absolute z-20 left-0 top-full mt-1 bg-white border border-slate-200 rounded-sm shadow-xl w-72 p-4 space-y-3"
      style={{ minWidth: '260px' }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-700">Set Promo — {sku}</span>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 text-lg leading-none">×</button>
      </div>
      <p className="text-[11px] text-slate-500">{skuName} · {formatIDR(price)}/unit</p>

      {/* Type toggle */}
      <div className="flex gap-2">
        {(['PERCENT', 'AMOUNT'] as PromoDiscountType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setDiscountType(t)}
            className={`flex-1 py-1 rounded-full text-xs font-bold border transition-colors ${
              discountType === t
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-600 border-slate-300'
            }`}
          >
            {t === 'PERCENT' ? '% Persen' : 'Rp Nominal'}
          </button>
        ))}
      </div>

      {/* Value */}
      <div className="flex items-center gap-1">
        {discountType === 'AMOUNT' && <span className="text-xs text-slate-500">Rp</span>}
        <input
          type="number"
          min={0.01}
          step={discountType === 'PERCENT' ? 0.01 : 100}
          value={discountValue}
          onChange={(e) => setDiscountValue(e.target.value)}
          placeholder={discountType === 'PERCENT' ? 'Misal 10' : 'Misal 5000'}
          className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        {discountType === 'PERCENT' && <span className="text-xs text-slate-500">%</span>}
      </div>

      {/* Expiry */}
      <div>
        <div className="flex gap-3 text-xs mb-1">
          <label className="flex items-center gap-1">
            <input type="radio" checked={expiryMode === 'forever'} onChange={() => { setExpiryMode('forever'); setExpiryDate(''); }} />
            Selamanya
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={expiryMode === 'date'} onChange={() => setExpiryMode('date')} />
            Tanggal
          </label>
        </div>
        {expiryMode === 'date' && (
          <input
            type="date"
            value={expiryDate}
            min={wibDateString()}
            onChange={(e) => setExpiryDate(e.target.value)}
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        )}
      </div>

      {validationError && (
        <p className="text-xs text-rose-600">{validationError}</p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={saving || !!validationError}
          onClick={handleSave}
          className="flex-1 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
        {currentType && (
          <button
            type="button"
            disabled={saving}
            onClick={handleClear}
            className="px-3 py-1.5 bg-rose-50 text-rose-600 border border-rose-200 text-xs font-bold rounded-sm hover:bg-rose-100 disabled:opacity-50"
          >
            Hapus
          </button>
        )}
      </div>
    </div>
  );
}
