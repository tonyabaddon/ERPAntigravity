import React, { useState } from 'react';
import { X } from 'lucide-react';
import { DbSupplier } from '../../types';
import { supplierService } from '../../lib/pembelianService';
import { captureError } from '../../lib/captureError';

interface SupplierModalProps {
  supplier?: DbSupplier;
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function SupplierModal({ supplier, onClose, onSaved, showToast }: SupplierModalProps) {
  const [name, setName] = useState(supplier?.name ?? '');
  const [contactName, setContactName] = useState(supplier?.contact_name ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [termDays, setTermDays] = useState(String(supplier?.payment_term_days ?? 0));
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) { showToast('Nama supplier wajib diisi.', 'warning'); return; }
    setSaving(true);
    try {
      await supplierService.upsert({
        id: supplier?.id,
        name: name.trim(),
        contact_name: contactName.trim() || undefined,
        phone: phone.trim() || undefined,
        payment_term_days: parseInt(termDays) || 0,
      });
      showToast(supplier ? 'Supplier diperbarui.' : 'Supplier ditambahkan.', 'success');
      onSaved();
      onClose();
    } catch (e) {
      captureError(e, { feature: 'pembelian', action: 'save_supplier' });
      showToast(e instanceof Error ? e.message : 'Gagal menyimpan supplier.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-bold text-gray-900">{supplier ? 'Edit Supplier' : 'Tambah Supplier'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Nama Supplier <span className="text-rose-500">*</span></label>
            <input value={name} onChange={e => setName(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="PT Schneider Elektrik" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Nama Kontak</label>
              <input value={contactName} onChange={e => setContactName(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="Budi Santoso" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Nomor HP</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="0812-xxxx-xxxx" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Term Pembayaran (hari)</label>
            <input type="number" min="0" value={termDays} onChange={e => setTermDays(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="30" />
            <p className="text-[10px] text-gray-400 mt-1">0 = Cash. 30 = Net 30, dst.</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={onClose} className="text-sm font-medium text-gray-600 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Batal</button>
          <button onClick={handleSave} disabled={saving} className="text-sm font-semibold text-white bg-indigo-600 px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}
