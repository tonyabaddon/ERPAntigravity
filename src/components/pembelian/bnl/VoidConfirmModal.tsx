import React, { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { purchaseInvoiceService } from '../../../lib/purchaseInvoiceService';
import type { DbPurchaseInvoice } from '../../../types';

interface Props {
  pi: DbPurchaseInvoice;
  onClose: () => void;
  onVoided: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function VoidConfirmModal({ pi, onClose, onVoided, showToast }: Props) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const valid = reason.trim().length >= 10;

  async function handleConfirm() {
    if (!valid) return;
    setSaving(true);
    try {
      await purchaseInvoiceService.void(pi.id, reason.trim());
      showToast(`${pi.pi_number} di-void. Kasir expense reversed.`, 'success');
      onVoided();
      onClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal void.', 'warning');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded border border-red-200 shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-red-100 bg-red-50">
          <h2 className="text-sm font-bold text-red-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Void {pi.pi_number}
          </h2>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="px-4 py-4 space-y-3">
          <p className="text-xs text-gray-600">
            Void akan membalik Kasir expense ({`Rp -${Math.round(pi.total).toLocaleString('id-ID')}`}). PI tetap visible di history dengan flag VOID. Tidak bisa di-undo.
          </p>
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">Alasan void (min. 10 karakter) *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)}
              rows={3} placeholder="Contoh: Customer batal beli, barang sudah dikembalikan ke grosir"
              className="w-full text-sm px-3 py-2 rounded border border-gray-300 focus:border-red-400 focus-visible:outline-none" />
            <div className="text-[11px] text-gray-400 mt-1">{reason.length} / 10 minimum</div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200">
          <button onClick={onClose} className="text-sm font-medium text-gray-600 px-4 py-2 rounded border border-gray-200 hover:bg-gray-50">Batal</button>
          <button onClick={handleConfirm} disabled={!valid || saving} className="text-sm font-semibold text-white bg-red-600 px-4 py-2 rounded hover:bg-red-700 disabled:opacity-50">
            {saving ? 'Memproses...' : 'Void'}
          </button>
        </div>
      </div>
    </div>
  );
}
