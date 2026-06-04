import React, { useState } from 'react';
import { X, ArrowRight } from 'lucide-react';
import { StockItem } from '../types';
import { purchaseOrderService } from '../lib/pembelianService';

interface WarehouseTransferModalProps {
  item: StockItem;
  onClose: () => void;
  onTransferred: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function WarehouseTransferModal({ item, onClose, onTransferred, showToast }: WarehouseTransferModalProps) {
  const [from, setFrom] = useState<'atas' | 'bawah'>('atas');
  const [qty, setQty] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);

  const to: 'atas' | 'bawah' = from === 'atas' ? 'bawah' : 'atas';
  const fromQty = from === 'atas' ? (item.stock_atas ?? item.stock) : (item.stock_bawah ?? 0);
  const toQty = from === 'atas' ? (item.stock_bawah ?? 0) : (item.stock_atas ?? item.stock);
  const fromLabel = from === 'atas' ? 'Gudang Atas' : 'Gudang Bawah';
  const toLabel = from === 'atas' ? 'Gudang Bawah' : 'Gudang Atas';
  const fromColor = from === 'atas' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-amber-50 border-amber-200 text-amber-700';
  const toColor = from === 'atas' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-blue-50 border-blue-200 text-blue-700';

  async function handleConfirm() {
    const n = qty;
    if (!n || n <= 0) { showToast('Masukkan jumlah yang valid.', 'warning'); return; }
    if (n > fromQty) { showToast(`Stok ${fromLabel} hanya ${fromQty} pcs.`, 'warning'); return; }
    setSaving(true);
    try {
      await purchaseOrderService.transferWarehouse(item.sku, from, to, n);
      onTransferred();
    } catch (e: any) {
      showToast(e.message ?? 'Transfer gagal.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-extrabold text-[#012749]">Transfer Stok — {item.name}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className={`flex-1 border rounded-2xl p-3 text-center ${fromColor}`}>
              <div className="text-[10px] font-black uppercase tracking-wider mb-1">Dari</div>
              <div className="text-sm font-extrabold">{fromLabel}</div>
              <div className="text-xs font-bold mt-1">{fromQty} pcs</div>
            </div>
            <button
              onClick={() => setFrom(f => f === 'atas' ? 'bawah' : 'atas')}
              className="p-2 rounded-full bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer"
              title="Swap arah"
            >
              <ArrowRight className="w-4 h-4 text-slate-500" />
            </button>
            <div className={`flex-1 border rounded-2xl p-3 text-center ${toColor}`}>
              <div className="text-[10px] font-black uppercase tracking-wider mb-1">Ke</div>
              <div className="text-sm font-extrabold">{toLabel}</div>
              <div className="text-xs font-bold mt-1">{toQty} pcs</div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest">Jumlah Transfer (Pcs)</label>
            <input
              type="number"
              min="1"
              max={fromQty}
              value={qty}
              onChange={e => setQty(e.target.value === '' ? '' : parseInt(e.target.value) || '')}
              placeholder={`Maks ${fromQty}`}
              className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#2d8a4e]"
            />
          </div>
        </div>

        <div className="flex gap-3 px-6 pb-6">
          <button onClick={onClose} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-full text-xs font-bold hover:bg-slate-50 cursor-pointer">Batal</button>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="flex-1 py-2.5 bg-[#2d8a4e] text-white rounded-full text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
          >
            {saving ? 'Memproses...' : `Transfer ke ${toLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
}
