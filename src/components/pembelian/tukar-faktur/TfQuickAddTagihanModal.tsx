// TF Quick-Add Tagihan Modal — foreign-faktur escape per spec §4.2 + mockup Layar 3.
// Creates a Tagihan with `is_tf_quick_add=true` (no Pesanan, no items) which the
// outer record_tukar_faktur RPC persists when the operator saves the bundle.
import React, { useState } from 'react';
import { X, Check, Info } from 'lucide-react';
import type { TfQuickAddTagihanDraft } from '../../../types';
import { wibDateString } from '../../../lib/format';

interface Props {
  prefillSupplierInvoice?: string;
  defaultPaymentTermDays: number;
  onCancel: () => void;
  onSave: (draft: TfQuickAddTagihanDraft) => void;
}

export default function TfQuickAddTagihanModal({
  prefillSupplierInvoice,
  defaultPaymentTermDays,
  onCancel,
  onSave,
}: Props) {
  const today = wibDateString();
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + (defaultPaymentTermDays || 30));

  const [supplierInv, setSupplierInv] = useState(prefillSupplierInvoice ?? '');
  const [purchaseDate, setPurchaseDate] = useState(today);
  const [total, setTotal] = useState('');
  const [dueAt, setDueAt] = useState(wibDateString(dueDate));

  function handleSave() {
    const totalNum = parseFloat(total.replace(/[^0-9.-]/g, ''));
    if (!supplierInv.trim()) {
      alert('Nomor faktur supplier wajib di-isi');
      return;
    }
    if (!totalNum || totalNum <= 0) {
      alert('Nominal total wajib > 0');
      return;
    }
    if (!purchaseDate) {
      alert('Tanggal faktur wajib di-isi');
      return;
    }
    onSave({
      supplier_invoice_number: supplierInv.trim(),
      purchase_date: purchaseDate,
      total: totalNum,
      payment_due_at: dueAt,
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded shadow-2xl w-full max-w-2xl border border-gray-200">
        <div className="px-4 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-extrabold" style={{ color: 'var(--color-caleo-primary)' }}>
              Tambah Tagihan Cepat
            </h3>
            <div className="text-[11px] text-gray-500 mt-0.5">
              Faktur yang belum ada di sistem. Item barang bisa di-isi nanti dari Tagihan Detail.
            </div>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">
                Nomor Faktur Supplier <span className="text-red-500">*</span>
              </label>
              <input
                value={supplierInv}
                onChange={e => setSupplierInv(e.target.value)}
                placeholder="Misal: INV-3501"
                className="w-full text-sm py-2 px-3 rounded border border-gray-300 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">
                Tanggal Faktur <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={purchaseDate}
                onChange={e => setPurchaseDate(e.target.value)}
                className="w-full text-sm py-2 px-3 rounded border border-gray-300 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="p-3 rounded bg-sky-50 border border-sky-200 text-[11px] text-sky-900 flex gap-2">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              <b>Quick-add tanpa Pesanan.</b> Tagihan ini dicatat{' '}
              <code className="text-[10px] bg-white px-1 rounded">is_tf_quick_add=true</code>, tanpa
              stock_lots / items. Hapus TF = hapus juga Tagihan ini (cascade).
            </span>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">
              Nominal Total <span className="text-red-500">*</span>
            </label>
            <input
              value={total}
              onChange={e => setTotal(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              className="w-full text-sm py-2 px-3 rounded border border-gray-300 font-bold text-right focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Jatuh Tempo</label>
            <input
              type="date"
              value={dueAt}
              onChange={e => setDueAt(e.target.value)}
              className="w-full text-sm py-2 px-3 rounded border border-gray-300 focus:outline-none focus:border-indigo-500"
            />
            <div className="text-[11px] text-gray-500 mt-1">
              Auto-fill Net {defaultPaymentTermDays} hari dari supplier. JT TF (di form luar) akan
              meng-override saat di-bundle.
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50/80 rounded-b-3xl">
          <div className="text-[11px] text-gray-500">Tagihan baru langsung ter-add ke bundle TF.</div>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="text-sm font-semibold text-gray-600 px-4 py-2 rounded border border-gray-200 hover:bg-gray-50"
            >
              Batal
            </button>
            <button
              onClick={handleSave}
              className="inline-flex items-center gap-1 text-sm font-semibold text-white px-4 py-2 rounded"
              style={{ background: 'var(--color-caleo-primary)' }}
            >
              <Check className="w-4 h-4" /> Simpan & Add ke TF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
