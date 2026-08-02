import React, { useState } from 'react';
import { X, Upload } from 'lucide-react';
import { DbPurchaseOrder } from '../../types';
import { purchaseOrderService } from '../../lib/pembelianService';
import { kasirService } from '../../lib/supabaseClient';
import { wibDateString } from '../../lib/format';
import { formatIDR } from '../../lib/formatIDR';
import { captureError } from '../../lib/captureError';

interface MarkAsPaidModalProps {
  po: DbPurchaseOrder;
  onClose: () => void;
  onPaid: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}


export default function MarkAsPaidModal({ po, onClose, onPaid, showToast }: MarkAsPaidModalProps) {
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    setSaving(true);
    try {
      let proofUrl: string | undefined;
      if (proofFile) {
        proofUrl = await purchaseOrderService.uploadDocument(proofFile, `payment-proofs/${po.id}`);
      }
      await purchaseOrderService.markPaid(po.id, proofUrl);
      try {
        await kasirService.insertExpense({
          date: wibDateString(),
          expense_category: 'Pembelian Stok',
          description: `Pembayaran PO ${po.po_number} — ${po.supplier?.name ?? ''}`.trim(),
          subtotal: po.total,
        });
      } catch (expenseErr) {
        captureError(expenseErr, { feature: 'pembelian', action: 'kasir_expense_insert' });
        showToast('PO lunas. Gagal catat di kasir: ' + (expenseErr instanceof Error ? expenseErr.message : 'unknown'), 'warning');
      }
      showToast(`${po.po_number} ditandai Lunas.`, 'success');
      onPaid();
      onClose();
    } catch (e) {
      captureError(e, { feature: 'pembelian', action: 'mark_paid' });
      showToast(e instanceof Error ? e.message : 'Gagal menandai PO sebagai lunas.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded border border-gray-200 shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200">
          <h2 className="text-sm font-bold text-gray-900">Tandai Lunas — {po.po_number}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-4 py-4 space-y-3">
          <div className="bg-gray-50 rounded px-3 py-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-500">Supplier</span>
              <span className="font-semibold text-gray-800">{po.supplier?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Total</span>
              <span className="font-bold text-gray-800">{formatIDR(po.total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Jatuh Tempo</span>
              <span className="font-semibold text-amber-600">
                {po.payment_due_at ? new Date(po.payment_due_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
              </span>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Upload Bukti Pembayaran</label>
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded px-4 py-4 text-xs text-gray-400 hover:border-indigo-300 cursor-pointer">
              <Upload className="w-6 h-6 mb-1 text-gray-300" />
              {proofFile ? proofFile.name : 'Klik atau drag bukti transfer (PDF / JPG)'}
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
