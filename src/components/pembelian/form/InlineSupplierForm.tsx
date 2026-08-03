import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { DbSupplier } from '../../../types';
import { supplierService } from '../../../lib/pembelianService';
import { captureError } from '../../../lib/captureError';

interface InlineSupplierFormProps {
  prefillName?: string;
  onSaved: (newSupplier: DbSupplier) => void;
  onCancel: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function InlineSupplierForm({
  prefillName, onSaved, onCancel, showToast,
}: InlineSupplierFormProps) {
  const [name, setName] = useState(prefillName ?? '');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [termDays, setTermDays] = useState('0');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) {
      showToast('Nama supplier wajib diisi.', 'warning');
      return;
    }
    setSaving(true);
    try {
      await supplierService.upsert({
        name: name.trim(),
        contact_name: contactName.trim() || undefined,
        phone: phone.trim() || undefined,
        payment_term_days: parseInt(termDays) || 0,
      });
      // Re-fetch list to retrieve the just-created supplier with its id
      const updated = await supplierService.fetchAll();
      const created = updated.find(s => s.name === name.trim());
      if (created) {
        onSaved(created);
        showToast('Supplier ditambahkan & dipakai untuk PO ini.', 'success');
      } else {
        showToast('Supplier disimpan tapi tidak ditemukan. Refresh halaman.', 'warning');
      }
    } catch (e) {
      captureError(e, { feature: 'pembelian', action: 'inline_supplier_save' });
      showToast(e instanceof Error ? e.message : 'Gagal menyimpan supplier.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded border-2 border-dashed border-indigo-300 bg-indigo-50/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm">
            <Plus className="w-4 h-4" />
          </div>
          <h4 className="text-sm font-bold text-indigo-700">Tambah Supplier Baru</h4>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-white"
        >
          <X className="w-3.5 h-3.5" /> Batal
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">
            Nama Supplier <span className="text-caleo-danger">*</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="PT Schneider Elektrik"
            className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2 bg-white placeholder-gray-400"
          />
          {prefillName && (
            <p className="text-caleo-10 text-caleo-success mt-0.5">✓ Diisi dari pencarian</p>
          )}
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">Nama Kontak</label>
          <input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="Budi Santoso"
            className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2 bg-white placeholder-gray-400"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">Nomor HP / WA</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0812-xxxx-xxxx"
            className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2 bg-white placeholder-gray-400"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">Term Pembayaran (hari)</label>
          <input
            type="number"
            min="0"
            value={termDays}
            onChange={(e) => setTermDays(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2 bg-white"
          />
          <p className="text-caleo-10 text-gray-500 mt-0.5">0 = Cash. 30 = Net 30 hari.</p>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-indigo-100">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-sm font-semibold text-gray-600 px-3 py-1.5 rounded hover:bg-white disabled:opacity-50"
        >
          Batal
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="text-sm font-semibold text-white bg-indigo-600 px-4 py-1.5 rounded hover:bg-indigo-700 shadow-sm shadow-indigo-200 disabled:opacity-50"
        >
          {saving ? 'Menyimpan...' : 'Simpan & Pakai'}
        </button>
      </div>
    </div>
  );
}
