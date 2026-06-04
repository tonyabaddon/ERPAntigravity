import React, { useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import { DbPurchaseOrder, DbSupplier, StockItem } from '../../types';
import { purchaseOrderService, PoItemDraft } from '../../lib/pembelianService';

interface PurchaseOrderModalProps {
  po?: DbPurchaseOrder;
  suppliers: DbSupplier[];
  stockList: StockItem[];
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function formatRupiah(n: number): string {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

export default function PurchaseOrderModal({ po, suppliers, stockList, onClose, onSaved, showToast }: PurchaseOrderModalProps) {
  const [supplierId, setSupplierId] = useState(po?.supplier_id ?? '');
  const [notes, setNotes] = useState(po?.notes ?? '');
  const [taxEnabled, setTaxEnabled] = useState((po?.tax_rate ?? 0) > 0);
  const [taxRate, setTaxRate] = useState(String(((po?.tax_rate ?? 0) * 100) || 11));
  const [items, setItems] = useState<PoItemDraft[]>(
    po?.items?.map(i => ({ sku: i.sku, product_name: i.product_name, qty: i.qty, unit_cost: i.unit_cost, subtotal: i.subtotal })) ?? []
  );
  const [skuSearch, setSkuSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const supplier = suppliers.find(s => s.id === supplierId);
  const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const taxAmount = taxEnabled ? subtotal * (parseFloat(taxRate) / 100 || 0) : 0;
  const total = subtotal + taxAmount;

  const skuSuggestions = skuSearch.length > 0
    ? stockList.filter(s =>
        s.sku.toLowerCase().includes(skuSearch.toLowerCase()) ||
        s.name.toLowerCase().includes(skuSearch.toLowerCase())
      ).slice(0, 6)
    : [];

  function addItem(stock: StockItem) {
    setItems(prev => [...prev, { sku: stock.sku, product_name: stock.name, qty: 1, unit_cost: 0, subtotal: 0 }]);
    setSkuSearch('');
  }

  function updateItem(index: number, field: keyof PoItemDraft, value: string) {
    setItems(prev => prev.map((item, i) => {
      if (i !== index) return item;
      const updated = { ...item, [field]: field === 'qty' || field === 'unit_cost' ? parseFloat(value) || 0 : value };
      updated.subtotal = updated.qty * updated.unit_cost;
      return updated;
    }));
  }

  function removeItem(index: number) {
    setItems(prev => prev.filter((_, i) => i !== index));
  }

  async function handleSave(status: 'DRAFT' | 'ORDERED') {
    if (!supplierId) { showToast('Pilih supplier terlebih dahulu.', 'warning'); return; }
    if (items.length === 0) { showToast('Tambahkan minimal satu item.', 'warning'); return; }
    if (items.some(i => i.qty <= 0 || i.unit_cost <= 0)) {
      showToast('Qty dan harga beli harus lebih dari 0.', 'warning'); return;
    }
    setSaving(true);
    try {
      const payload = {
        supplier_id: supplierId,
        notes: notes.trim() || undefined,
        tax_rate: taxEnabled ? (parseFloat(taxRate) / 100 || 0) : 0,
        tax_amount: taxAmount,
        subtotal,
        total,
        status,
        items,
      };
      if (po) {
        await purchaseOrderService.update(po.id, payload);
        if (status === 'ORDERED' && po.status === 'DRAFT') {
          await purchaseOrderService.markOrdered(po.id);
        }
      } else {
        await purchaseOrderService.create({ ...payload, status });
      }
      showToast(po ? 'PO diperbarui.' : `PO dibuat — status: ${status === 'DRAFT' ? 'Draft' : 'Dipesan'}.`, 'success');
      onSaved();
      onClose();
    } catch (e: any) {
      showToast(e.message ?? 'Gagal menyimpan PO.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 sticky top-0 bg-white z-10">
          <h2 className="text-sm font-bold text-gray-900">{po ? `Edit PO — ${po.po_number}` : 'Buat Purchase Order'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Supplier <span className="text-rose-500">*</span></label>
              <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                <option value="">Pilih supplier...</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {supplier && <p className="text-[10px] text-gray-400 mt-1">Term: {supplier.payment_term_days === 0 ? 'Cash' : `Net ${supplier.payment_term_days} hari`}</p>}
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Catatan</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="Catatan untuk supplier..." />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-600">Item Pembelian</label>
            </div>

            <div className="relative mb-3">
              <input
                value={skuSearch}
                onChange={e => setSkuSearch(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="Ketik nama produk atau SKU untuk menambah item..."
              />
              {skuSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-20 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 overflow-hidden">
                  {skuSuggestions.map(s => (
                    <button key={s.sku} onClick={() => addItem(s)} className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-indigo-50 text-left">
                      <span className="font-semibold text-gray-800">{s.name}</span>
                      <span className="font-mono text-gray-400">{s.sku}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-12 px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                <span className="col-span-1">SKU</span>
                <span className="col-span-4">Nama Produk</span>
                <span className="col-span-2 text-center">Qty</span>
                <span className="col-span-2 text-right">Harga Beli</span>
                <span className="col-span-2 text-right">Subtotal</span>
                <span className="col-span-1"></span>
              </div>
              {items.length === 0 ? (
                <div className="py-6 text-center text-xs text-gray-400">Belum ada item. Cari produk di atas.</div>
              ) : (
                items.map((item, i) => (
                  <div key={i} className="grid grid-cols-12 px-3 py-2.5 border-b border-gray-100 items-center">
                    <span className="col-span-1 font-mono text-[10px] text-gray-400">{item.sku}</span>
                    <span className="col-span-4 text-xs font-semibold text-gray-800">{item.product_name}</span>
                    <div className="col-span-2 flex justify-center">
                      <input type="number" min="1" value={item.qty} onChange={e => updateItem(i, 'qty', e.target.value)} className="w-16 text-center text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                    </div>
                    <div className="col-span-2 flex justify-end">
                      <input type="number" min="0" value={item.unit_cost || ''} onChange={e => updateItem(i, 'unit_cost', e.target.value)} className="w-28 text-right text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300" placeholder="0" />
                    </div>
                    <span className="col-span-2 text-right text-sm font-bold text-gray-800">{formatRupiah(item.subtotal)}</span>
                    <div className="col-span-1 flex justify-end">
                      <button onClick={() => removeItem(i)} className="text-rose-400 hover:text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))
              )}
              <div className="flex justify-end gap-8 px-3 py-2.5 border-t-2 border-gray-200 bg-gray-50 text-[11px]">
                <div className="text-right text-gray-400 leading-relaxed">
                  Subtotal<br />
                  <span className="flex items-center gap-1 justify-end">
                    PPN <input type="checkbox" checked={taxEnabled} onChange={e => setTaxEnabled(e.target.checked)} className="accent-indigo-600" />
                    <input type="number" value={taxRate} onChange={e => setTaxRate(e.target.value)} disabled={!taxEnabled} className="w-10 text-right text-[11px] border border-gray-200 rounded px-1 py-0.5 disabled:opacity-40" />%
                  </span>
                  <strong className="text-gray-700">Total</strong>
                </div>
                <div className="text-right text-gray-600 leading-relaxed min-w-[120px]">
                  {formatRupiah(subtotal)}<br />
                  {taxEnabled ? formatRupiah(taxAmount) : '—'}<br />
                  <strong className="text-gray-800">{formatRupiah(total)}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 sticky bottom-0 bg-white">
          <button onClick={onClose} className="text-sm font-medium text-gray-600 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Batal</button>
          <button onClick={() => handleSave('DRAFT')} disabled={saving} className="text-sm font-semibold text-gray-700 px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-50">Simpan Draft</button>
          <button onClick={() => handleSave('ORDERED')} disabled={saving} className="text-sm font-semibold text-white bg-indigo-600 px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Menyimpan...' : 'Simpan & Pesan'}
          </button>
        </div>
      </div>
    </div>
  );
}
