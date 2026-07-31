import { useState } from 'react';
import type { StockQtyTier } from '../../types';
import { stockService } from '../../lib/supabaseClient';
import { extractErrorMessage } from '../../lib/extractErrorMessage';
import { captureError } from '../../lib/captureError';

interface Props {
  stockSku: string;
  basePrice: number;
  initialTiers: StockQtyTier[];
  onSaved: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

interface EditableRow {
  minQty: string; // string during editing; parsed on save
  price: string;
}

function toEditable(tiers: StockQtyTier[]): EditableRow[] {
  if (tiers.length === 0) return [{ minQty: '', price: '' }];
  return tiers
    .sort((a, b) => a.min_qty - b.min_qty)
    .map(t => ({ minQty: String(t.min_qty), price: String(t.price) }));
}

/**
 * Inline price-ladder editor for per-SKU qty tier pricing (Phase 2).
 * Owner types "Beli mulai N pcs" and "Rp X" for up to 5 tiers.
 * Saves atomically via set_stock_qty_tiers RPC (replaces entire tier set).
 */
export default function QtyTiersEditor({
  stockSku,
  basePrice,
  initialTiers,
  onSaved,
  showToast,
}: Props) {
  const [rows, setRows] = useState<EditableRow[]>(toEditable(initialTiers));
  const [saving, setSaving] = useState(false);

  function updateRow(i: number, patch: Partial<EditableRow>) {
    setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    if (rows.length >= 5) return;
    setRows(prev => [...prev, { minQty: '', price: '' }]);
  }

  function removeRow(i: number) {
    setRows(prev => prev.filter((_, idx) => idx !== i));
  }

  // Preview: pick the first valid tier qty and show what price applies.
  const previewQty = rows.length > 0 && rows[0].minQty ? parseInt(rows[0].minQty, 10) : 10;
  const previewTier = rows
    .filter(r => r.minQty && r.price)
    .map(r => ({ min_qty: parseInt(r.minQty, 10), price: parseFloat(r.price) }))
    .filter(t => !isNaN(t.min_qty) && !isNaN(t.price) && t.min_qty <= previewQty)
    .sort((a, b) => b.min_qty - a.min_qty)[0];
  const previewPrice = previewTier?.price ?? basePrice;

  function friendlyError(err: unknown): string {
    const raw = extractErrorMessage(err);
    if (raw.includes('QTP_INVALID_MIN_QTY')) {
      const hint = (err as { hint?: string })?.hint;
      if (hint === 'duplicate min_qty') return 'Threshold volume nggak boleh duplikat.';
      return `min_qty minimal 2 pcs (dapat "${hint ?? '?'}").`;
    }
    if (raw.includes('QTP_INVALID_PRICE')) {
      const hint = (err as { hint?: string })?.hint;
      return `Harga tier harus > 0 (dapat "${hint ?? '?'}").`;
    }
    if (raw.includes('QTP_TOO_MANY_TIERS')) return 'Max 5 tier per SKU.';
    if (raw.includes('QTP_STOCK_NOT_FOUND')) return 'SKU tidak ditemukan.';
    if (raw.includes('QTP_FORBIDDEN')) return 'Hanya Owner yang bisa mengubah tier volume.';
    return `Gagal simpan tier volume: ${raw}`;
  }

  async function onSave() {
    setSaving(true);
    try {
      const tiers = rows
        .map(r => ({ min_qty: parseInt(r.minQty, 10), price: parseFloat(r.price) }))
        .filter(t => !isNaN(t.min_qty) && !isNaN(t.price) && t.min_qty > 0 && t.price > 0)
        .sort((a, b) => a.min_qty - b.min_qty);

      // Warn if any tier price >= base price (volume pricing should be cheaper)
      const suspicious = tiers.find(t => t.price >= basePrice);
      if (
        suspicious &&
        !window.confirm(
          `Harga volume Rp ${suspicious.price.toLocaleString('id-ID')} untuk beli ${suspicious.min_qty}+ pcs lebih tinggi/sama dengan harga base Rp ${basePrice.toLocaleString('id-ID')}. Yakin simpan?`,
        )
      ) {
        setSaving(false);
        return;
      }

      console.info('[qty_tier] set', { stock_sku: stockSku, tier_count: tiers.length });
      await stockService.setQtyTiers(stockSku, tiers);
      showToast('Harga volume tersimpan.', 'success');
      onSaved();
    } catch (err) {
      captureError(err, { feature: 'qty_tier', action: 'set' });
      showToast(friendlyError(err), 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="bg-white rounded-xl border border-slate-200 p-4 space-y-3"
      data-testid="qty-tiers-editor"
    >
      <div>
        <h3 className="text-sm font-bold text-[#012749]">Harga Volume (opsional)</h3>
        <p className="text-[11px] text-slate-500 mt-1">
          Beli banyak lebih murah. Max 5 tier. Kosongkan semua kalau nggak dipakai.
        </p>
      </div>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Beli mulai</span>
            <input
              type="number"
              aria-label={`mulai-${i}`}
              value={row.minQty}
              onChange={e => updateRow(i, { minQty: e.target.value })}
              placeholder="5"
              className="w-20 px-2 py-1.5 border border-slate-300 rounded-lg text-sm"
            />
            <span className="text-xs text-slate-500">pcs Rp</span>
            <input
              type="number"
              aria-label={`harga-${i}`}
              value={row.price}
              onChange={e => updateRow(i, { price: e.target.value })}
              placeholder="8000"
              className="w-32 px-2 py-1.5 border border-slate-300 rounded-lg text-sm"
            />
            <button
              type="button"
              onClick={() => removeRow(i)}
              className="ml-auto text-slate-400 hover:text-red-500 text-sm"
              aria-label={`hapus tier ${i}`}
            >
              x
            </button>
          </div>
        ))}
      </div>

      <div>
        <button
          type="button"
          onClick={addRow}
          disabled={rows.length >= 5}
          className="text-xs font-semibold text-[#012749] hover:opacity-80 disabled:opacity-40"
        >
          + Tambah tier volume
        </button>
      </div>

      {previewTier && (
        <p className="text-[11px] text-slate-500 italic">
          Contoh: beli {previewQty} pcs = Rp{' '}
          {(previewPrice * previewQty).toLocaleString('id-ID')} (auto Rp{' '}
          {previewPrice.toLocaleString('id-ID')}/pcs)
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="px-4 py-2 text-xs font-bold rounded-lg bg-[#012749] text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Menyimpan...' : 'Simpan'}
        </button>
      </div>
    </div>
  );
}
