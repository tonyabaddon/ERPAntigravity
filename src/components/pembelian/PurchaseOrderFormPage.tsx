import React, { useState, useEffect } from 'react';
import { ArrowLeft, FileText } from 'lucide-react';
import { DbPurchaseOrder, DbSupplier, StockItem, PermissionSet } from '../../types';
import { purchaseOrderService, PoItemDraft } from '../../lib/pembelianService';
import { wibDateString } from '../../lib/format';
import SupplierPicker from './form/SupplierPicker';
import InlineSupplierForm from './form/InlineSupplierForm';
import StockPicker from './form/StockPicker';
import ItemRow from './form/ItemRow';
import { formatIDR } from '../../lib/formatIDR';
import { captureError } from '../../lib/captureError';

interface PurchaseOrderFormPageProps {
  po?: DbPurchaseOrder;                     // undefined = create, defined = edit
  suppliers: DbSupplier[];
  orders: DbPurchaseOrder[];                // for SupplierPicker usage-count sort
  stockList: StockItem[];
  currentUserId?: string;                   // for created_by/updated_by audit
  currentUserPermissions?: PermissionSet;
  onBack: () => void;
  onSaved: (status: 'DRAFT' | 'ORDERED') => void;
  onSupplierAdded: () => void;              // trigger PembelianScreen.reload() after inline create
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}


function isPastDate(iso: string): boolean {
  if (!iso) return false;
  return iso < wibDateString();
}

export default function PurchaseOrderFormPage({
  po, suppliers, orders, stockList,
  currentUserId, currentUserPermissions,
  onBack, onSaved, onSupplierAdded, showToast,
}: PurchaseOrderFormPageProps) {
  const isEdit = !!po;
  const canAct = isEdit
    ? currentUserPermissions?.can_edit_po !== false
    : currentUserPermissions?.can_create_po !== false;

  // Permission gate: redirect if denied
  useEffect(() => {
    if (!canAct) {
      showToast(`Anda tidak punya akses untuk ${isEdit ? 'edit' : 'membuat'} PO.`, 'warning');
      onBack();
    }
  }, [canAct, isEdit]);

  const [supplierId, setSupplierId] = useState(po?.supplier_id ?? '');
  const [expectedReceiveDate, setExpectedReceiveDate] = useState(po?.expected_receive_date ?? '');
  const [notes, setNotes] = useState(po?.notes ?? '');
  const [taxEnabled, setTaxEnabled] = useState((po?.tax_rate ?? 0) > 0);
  const [taxRate, setTaxRate] = useState(String(((po?.tax_rate ?? 0) * 100) || 11));
  const [items, setItems] = useState<PoItemDraft[]>(
    po?.items?.map(i => ({
      sku: i.sku, product_name: i.product_name,
      qty: i.qty, unit_cost: i.unit_cost, subtotal: i.subtotal,
    })) ?? []
  );
  const [showInlineSupplier, setShowInlineSupplier] = useState(false);
  const [inlineSupplierPrefill, setInlineSupplierPrefill] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedSupplier = suppliers.find(s => s.id === supplierId);
  const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const taxAmount = taxEnabled ? subtotal * (parseFloat(taxRate) / 100 || 0) : 0;
  const total = subtotal + taxAmount;

  function markDirty() { if (!isDirty) setIsDirty(true); }

  function handleSupplierSelect(s: DbSupplier) {
    setSupplierId(s.id);
    markDirty();
  }

  function handleSupplierCreateNew(prefilledName: string) {
    setInlineSupplierPrefill(prefilledName);
    setShowInlineSupplier(true);
  }

  function handleSupplierInlineSaved(newSupplier: DbSupplier) {
    setSupplierId(newSupplier.id);
    setShowInlineSupplier(false);
    setInlineSupplierPrefill('');
    onSupplierAdded();
    markDirty();
  }

  function handleAddItem(stock: StockItem) {
    if (items.some(i => i.sku === stock.sku)) {
      showToast(`Produk ${stock.sku} sudah ada di list. Update qty-nya.`, 'info');
      return;
    }
    setItems(prev => [...prev, { sku: stock.sku, product_name: stock.name, qty: 1, unit_cost: 0, subtotal: 0 }]);
    markDirty();
  }

  function handleItemChange(index: number, patch: Partial<PoItemDraft>) {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, ...patch } : item));
    markDirty();
  }

  function handleItemRemove(index: number) {
    setItems(prev => prev.filter((_, i) => i !== index));
    markDirty();
  }

  function validate(): string | null {
    if (!supplierId) return 'Pilih supplier terlebih dahulu.';
    if (items.length === 0) return 'Tambahkan minimal satu item.';
    if (items.some(i => i.qty <= 0 || i.unit_cost <= 0)) return 'Qty dan harga beli harus lebih dari 0.';
    return null;
  }

  async function handleSave(status: 'DRAFT' | 'ORDERED') {
    const err = validate();
    if (err) { showToast(err, 'warning'); return; }
    setSaving(true);
    try {
      const payload = {
        supplier_id: supplierId,
        expected_receive_date: expectedReceiveDate || null,
        notes: notes.trim() || undefined,
        tax_rate: taxEnabled ? (parseFloat(taxRate) / 100 || 0) : 0,
        tax_amount: taxAmount,
        subtotal,
        total,
        items,
      };
      if (po) {
        await purchaseOrderService.update(po.id, {
          ...payload,
          updated_by_user_id: currentUserId || null,
        });
        if (status === 'ORDERED' && po.status === 'DRAFT') {
          await purchaseOrderService.markOrdered(po.id);
        }
      } else {
        await purchaseOrderService.create({
          ...payload,
          status,
          created_by_user_id: currentUserId || null,
        });
      }
      setIsDirty(false);
      showToast(
        po ? 'PO diperbarui.' : `PO dibuat — status: ${status === 'DRAFT' ? 'Draft' : 'Dipesan'}.`,
        'success'
      );
      onSaved(status);
    } catch (e: any) {
      captureError(e, { feature: 'pembelian', action: 'save_po' });
      showToast(e?.message ?? 'Gagal menyimpan PO.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  function handleBack() {
    if (isDirty && !confirm('Perubahan belum disimpan. Yakin keluar?')) return;
    onBack();
  }

  return (
    <div className="space-y-5">
      {/* Sub-page header */}
      <div className="bg-white border border-gray-200 rounded-xl px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-indigo-600 -ml-2 px-2 py-1 rounded-lg hover:bg-gray-50"
          >
            <ArrowLeft className="w-4 h-4" />
            Kembali
          </button>
          <div className="h-5 w-px bg-gray-200" />
          <h2 className="text-base font-bold text-gray-900">
            {isEdit ? `Edit ${po!.po_number}` : 'Buat Purchase Order'}
          </h2>
        </div>
        {isDirty && (
          <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
            ● Belum disimpan
          </span>
        )}
      </div>

      {/* Section: Detail PO */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-4 bg-indigo-500 rounded-full" />
          <h3 className="text-sm font-bold text-gray-900">Detail PO</h3>
        </div>
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-5">
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">
              Supplier <span className="text-rose-500">*</span>
            </label>
            {showInlineSupplier ? (
              <InlineSupplierForm
                prefillName={inlineSupplierPrefill}
                onSaved={handleSupplierInlineSaved}
                onCancel={() => { setShowInlineSupplier(false); setInlineSupplierPrefill(''); }}
                showToast={showToast}
              />
            ) : (
              <SupplierPicker
                suppliers={suppliers}
                orders={orders}
                selectedSupplierId={supplierId}
                onSelect={handleSupplierSelect}
                onCreateNew={handleSupplierCreateNew}
              />
            )}
          </div>
          <div className="col-span-3">
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Tgl Diterima Diharapkan</label>
            <div className="relative">
              <input
                type="date"
                value={expectedReceiveDate}
                onChange={(e) => { setExpectedReceiveDate(e.target.value); markDirty(); }}
                className={`w-full text-sm border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 ${
                  isPastDate(expectedReceiveDate)
                    ? 'border-amber-300 bg-amber-50/30 focus:ring-amber-300'
                    : expectedReceiveDate
                      ? 'border-emerald-300 bg-emerald-50/30 focus:ring-emerald-300'
                      : 'border-gray-200 focus:ring-indigo-300'
                }`}
              />
            </div>
            {expectedReceiveDate && isPastDate(expectedReceiveDate) ? (
              <p className="text-[10px] text-amber-700 font-semibold mt-1">⚠ Tanggal sudah lewat. Boleh disimpan, jadi acuan delay.</p>
            ) : (
              <p className="text-[10px] text-gray-400 mt-1">Optional · Kosongkan jika belum pasti</p>
            )}
          </div>
          <div className="col-span-4">
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Catatan untuk Supplier</label>
            <input
              value={notes}
              onChange={(e) => { setNotes(e.target.value); markDirty(); }}
              placeholder="(opsional)"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder-gray-400"
            />
          </div>
        </div>
      </section>

      {/* Section: Items */}
      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 bg-indigo-500 rounded-full" />
            <h3 className="text-sm font-bold text-gray-900">Items Pembelian</h3>
            <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">
              {items.length} item
            </span>
          </div>
          <div className="w-72">
            <StockPicker stockList={stockList} onPick={handleAddItem} />
          </div>
        </div>

        <div className="grid grid-cols-12 px-5 py-2.5 bg-gray-50 border-b border-gray-200 text-[10px] font-bold uppercase tracking-wide text-gray-500">
          <span className="col-span-2">SKU</span>
          <span className="col-span-4">Nama Produk</span>
          <span className="col-span-2 text-center">Qty</span>
          <span className="col-span-2 text-right">Harga Beli</span>
          <span className="col-span-1 text-right">Subtotal</span>
          <span className="col-span-1" />
        </div>

        {items.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">
            Cari produk di kolom atas untuk mulai menambah item.
          </div>
        ) : (
          items.map((item, i) => (
            <ItemRow
              key={`${item.sku}-${i}`}
              item={item}
              onChange={(patch) => handleItemChange(i, patch)}
              onRemove={() => handleItemRemove(i)}
            />
          ))
        )}
      </section>

      {/* Section: Totals */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-4 bg-indigo-500 rounded-full" />
          <h3 className="text-sm font-bold text-gray-900">Ringkasan Biaya</h3>
        </div>
        <div className="flex justify-end">
          <div className="w-80 space-y-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span className="font-semibold text-gray-800">{formatIDR(subtotal)}</span>
            </div>
            <div className="flex justify-between text-gray-600 items-center">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={taxEnabled}
                  onChange={(e) => { setTaxEnabled(e.target.checked); markDirty(); }}
                  className="accent-indigo-600 w-3.5 h-3.5"
                />
                PPN
                <input
                  type="number"
                  value={taxRate}
                  onChange={(e) => { setTaxRate(e.target.value); markDirty(); }}
                  disabled={!taxEnabled}
                  className="w-10 text-center text-xs border border-gray-200 rounded px-1 py-0.5 disabled:opacity-40"
                />%
              </span>
              <span className="font-semibold text-gray-800">{taxEnabled ? formatIDR(taxAmount) : '—'}</span>
            </div>
            <div className="border-t-2 border-gray-200 pt-2 flex justify-between items-baseline">
              <span className="text-sm font-bold text-gray-900">Total</span>
              <span className="text-xl font-extrabold text-indigo-600">{formatIDR(total)}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Sticky footer actions */}
      <div className="bg-white border border-gray-200 rounded-xl px-6 py-4 flex items-center justify-between sticky bottom-0 shadow-lg shadow-gray-200/40">
        <p className="text-xs text-gray-400">
          Total <span className="font-bold text-gray-700">{items.length} item</span>
          {' · '}
          <span className="font-bold text-gray-700">{formatIDR(total)}</span>
        </p>
        <div className="flex gap-2">
          {/* PDF button only available after PO is ORDERED (in detail view) */}
          {isEdit && po!.status !== 'DRAFT' && (
            <span className="text-[11px] text-gray-400 self-center mr-2">
              <FileText className="w-3 h-3 inline mr-1" />
              Download PDF di halaman detail PO
            </span>
          )}
          <button
            type="button"
            onClick={() => handleSave('DRAFT')}
            disabled={saving}
            className="text-sm font-semibold text-gray-700 px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-50"
          >
            Simpan Draft
          </button>
          <button
            type="button"
            onClick={() => handleSave('ORDERED')}
            disabled={saving}
            className="text-sm font-semibold text-white bg-indigo-600 px-5 py-2 rounded-lg hover:bg-indigo-700 shadow-sm shadow-indigo-200 disabled:opacity-50"
          >
            {saving ? 'Menyimpan...' : 'Simpan & Pesan'}
          </button>
        </div>
      </div>
    </div>
  );
}
