import React, { useState } from 'react';
import { X } from 'lucide-react';
import { DbPurchaseOrderItem } from '../../types';
import { purchaseOrderService } from '../../lib/pembelianService';
import { captureError } from '../../lib/captureError';

interface ReceiveReplacementModalProps {
  item: DbPurchaseOrderItem;
  onClose: () => void;
  onReplaced: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function ReceiveReplacementModal({ item, onClose, onReplaced, showToast }: ReceiveReplacementModalProps) {
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    setSaving(true);
    try {
      await purchaseOrderService.receiveReplacement(item.id);
      showToast(`${item.qty_damaged} unit pengganti "${item.product_name}" diterima. Stok bertambah.`, 'success');
      onReplaced();
      onClose();
    } catch (e) {
      captureError(e, { feature: 'pembelian', action: 'receive_replacement' });
      showToast(e instanceof Error ? e.message : 'Gagal mengkonfirmasi penerimaan pengganti.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-bold text-gray-900">Terima Barang Pengganti</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-700">
            Stok akan bertambah otomatis setelah pengganti dikonfirmasi.
          </div>
          <div className="bg-gray-50 rounded-lg px-3 py-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-500">Produk</span>
              <span className="font-semibold text-gray-800">{item.product_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">SKU</span>
              <span className="font-mono text-gray-500">{item.sku}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Qty Pengganti</span>
              <span className="font-bold text-emerald-600">{item.qty_damaged} unit</span>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={onClose} className="text-sm font-medium text-gray-600 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Batal</button>
          <button onClick={handleConfirm} disabled={saving} className="text-sm font-semibold text-white bg-emerald-600 px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            {saving ? 'Memproses...' : 'Konfirmasi Terima'}
          </button>
        </div>
      </div>
    </div>
  );
}
