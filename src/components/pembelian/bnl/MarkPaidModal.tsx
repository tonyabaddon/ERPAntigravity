import React, { useState } from 'react';
import { X, Upload } from 'lucide-react';
import { purchaseInvoiceService } from '../../../lib/purchaseInvoiceService';
import type { DbPurchaseInvoice } from '../../../types';
import { formatIDR } from '../../../lib/formatIDR';

interface Props {
  pi: DbPurchaseInvoice;
  onClose: () => void;
  onPaid: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function MarkPaidModal({ pi, onClose, onPaid, showToast }: Props) {
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    setSaving(true);
    try {
      let url: string | undefined;
      if (proofFile) {
        url = await purchaseInvoiceService.uploadAttachment(proofFile, `payment-proofs/${pi.id}`);
      }
      await purchaseInvoiceService.markPaid(pi.id, url);
      showToast(`${pi.pi_number} ditandai Lunas.`, 'success');
      onPaid();
      onClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal menandai Lunas.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded border border-gray-200 shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200">
          <h2 className="text-sm font-bold text-gray-900">Tandai Lunas — {pi.pi_number}</h2>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="px-4 py-4 space-y-3">
          <div className="bg-gray-50 rounded px-3 py-3 text-xs space-y-1">
            <div className="flex justify-between"><span className="text-gray-500">Supplier</span><span className="font-semibold">{pi.supplier?.name}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Total</span><span className="font-bold">{formatIDR(Math.round(pi.total))}</span></div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Upload Bukti Bayar (opsional)</label>
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded px-4 py-4 text-xs text-gray-400 hover:border-indigo-300 cursor-pointer">
              <Upload className="w-6 h-6 mb-1 text-gray-300" />
              {proofFile ? proofFile.name : 'Klik untuk upload bukti'}
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setProofFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200">
          <button onClick={onClose} className="text-sm font-medium text-gray-600 px-4 py-2 rounded border border-gray-200 hover:bg-gray-50">Batal</button>
          <button onClick={handleConfirm} disabled={saving} className="text-sm font-semibold text-white bg-green-600 px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50">
            {saving ? 'Memproses...' : 'Konfirmasi Lunas'}
          </button>
        </div>
      </div>
    </div>
  );
}
