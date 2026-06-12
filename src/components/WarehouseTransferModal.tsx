import { useState } from 'react';
import { X, ArrowRight } from 'lucide-react';
import { StockItem } from '../types';
import { purchaseOrderService } from '../lib/pembelianService';
import { useWarehouses } from '../hooks/useWarehouses';
import WarehousePicker from './warehouse/WarehousePicker';

interface Props {
  item: StockItem;
  onClose: () => void;
  onTransferred: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function WarehouseTransferModal({ item, onClose, onTransferred, showToast }: Props) {
  const { warehouses } = useWarehouses();
  const [fromId, setFromId] = useState<string>(warehouses[0]?.id ?? '');
  const [toId, setToId] = useState<string>(warehouses[1]?.id ?? '');
  const [qty, setQty] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);

  // qty in stock_levels per warehouse — passed through StockItem if available.
  // The StockItem doesn't currently expose per-warehouse qty as a typed field;
  // callers may extend with a transient property. Falls back to empty map.
  const qtyByWarehouseId: Record<string, number> =
    (item as unknown as { qty_by_warehouse_id?: Record<string, number> }).qty_by_warehouse_id ?? {};

  async function handleConfirm() {
    if (!fromId || !toId) { showToast('Pilih gudang asal + tujuan', 'warning'); return; }
    if (fromId === toId) { showToast('Gudang asal dan tujuan harus berbeda', 'warning'); return; }
    const n = qty;
    if (!n || n <= 0) { showToast('Masukkan jumlah yang valid', 'warning'); return; }
    setSaving(true);
    try {
      await purchaseOrderService.transferWarehouse(item.sku, fromId, toId, n);
      onTransferred();
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      let msg = err?.message ?? 'Transfer gagal';
      if (err?.code === '42501') {
        msg = 'Server menolak transfer — hubungi admin sistem (migrasi belum di-apply)';
      } else if (err?.code === 'P0001') {
        msg = err?.message ?? 'Transfer ditolak server';
      }
      showToast(msg, 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-extrabold text-[#012749]">Transfer Stok — {item.name}</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-slate-400" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <div>
              <div className="text-[10px] font-black uppercase tracking-wider mb-1 text-slate-400">Dari</div>
              <WarehousePicker mode="single" warehouses={warehouses}
                skuQtyByWarehouseId={qtyByWarehouseId}
                value={fromId} onChange={setFromId} excludeIds={[toId]} />
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400" />
            <div>
              <div className="text-[10px] font-black uppercase tracking-wider mb-1 text-slate-400">Ke</div>
              <WarehousePicker mode="single" warehouses={warehouses}
                skuQtyByWarehouseId={qtyByWarehouseId}
                value={toId} onChange={setToId} excludeIds={[fromId]} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest">Jumlah Transfer (Pcs)</label>
            <input type="number" min="1" value={qty}
              onChange={e => setQty(e.target.value === '' ? '' : parseInt(e.target.value) || '')}
              className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#2d8a4e]" />
          </div>
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={onClose} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-full text-xs font-bold hover:bg-slate-50">Batal</button>
          <button onClick={handleConfirm} disabled={saving}
            className="flex-1 py-2.5 bg-[#2d8a4e] text-white rounded-full text-xs font-bold hover:bg-emerald-700 disabled:opacity-50">
            {saving ? 'Memproses…' : 'Transfer'}
          </button>
        </div>
      </div>
    </div>
  );
}
