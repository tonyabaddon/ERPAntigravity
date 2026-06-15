// BNL Form (create + edit). Sections: Header (Order + Supplier + Invoice fields)
// / Items (SKU picker with inline create) / Payment / Summary.
// Supports duplicate-supplier-invoice soft warning (BR6).
import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Plus, Upload, X, Info } from 'lucide-react';
import { purchaseInvoiceService } from '../../../lib/purchaseInvoiceService';
import { supplierService } from '../../../lib/pembelianService';
import type { DbSupplier, PiPaymentMethod, RecordPiPayload, DbPurchaseInvoice } from '../../../types';
import OrderPicker from './OrderPicker';
import SkuPickerWithInlineCreate from './SkuPickerWithInlineCreate';
import PaymentMethodPicker from './PaymentMethodPicker';

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onCancel: () => void;
  onSaved: (piNumber: string) => void;
  prefill?: { orderId?: string; customerName?: string };
  editing?: DbPurchaseInvoice;
}

interface ItemRow {
  sku: string;
  product_name: string;
  qty: number;
  unit_cost: number;
  sell_price: number;
}

const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');

export default function BelanjaNumpangLewatFormPage({ showToast, onCancel, onSaved, prefill, editing }: Props) {
  const [order, setOrder] = useState<{ id: string; customer_name?: string } | null>(
    editing?.order_id ? { id: editing.order_id, customer_name: editing.order?.customer_name }
      : prefill?.orderId ? { id: prefill.orderId, customer_name: prefill.customerName }
        : null
  );
  const [supplier, setSupplier] = useState<DbSupplier | null>(editing?.supplier ?? null);
  const [supplierQuery, setSupplierQuery] = useState('');
  const [supplierResults, setSupplierResults] = useState<DbSupplier[]>([]);
  const [purchaseDate, setPurchaseDate] = useState(editing?.purchase_date ?? new Date().toISOString().slice(0, 10));
  const [supplierInvNum, setSupplierInvNum] = useState(editing?.supplier_invoice_number ?? '');
  const [supplierInvoicePhoto, setSupplierInvoicePhoto] = useState<File | null>(null);
  const [supplierInvoicePhotoUrl, setSupplierInvoicePhotoUrl] = useState(editing?.supplier_invoice_photo_url ?? '');
  const [paymentMethod, setPaymentMethod] = useState<PiPaymentMethod>(editing?.payment_method ?? 'CASH');
  const [paymentDueAt, setPaymentDueAt] = useState(editing?.payment_due_at ?? '');
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [initialStatus, setInitialStatus] = useState<'BELUM_LUNAS' | 'LUNAS'>(editing?.status ?? 'LUNAS');
  const [items, setItems] = useState<ItemRow[]>(
    editing?.items?.map(i => ({
      sku: i.sku, product_name: i.product_name, qty: i.qty, unit_cost: i.unit_cost, sell_price: i.sell_price,
    })) ?? []
  );
  const [draftSku, setDraftSku] = useState<{ sku: string; name: string; sell_price?: number } | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{ existingPi: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supplierQuery || supplierQuery.length < 2) { setSupplierResults([]); return; }
    const t = setTimeout(async () => {
      const all = await supplierService.fetchAll();
      setSupplierResults(all.filter(s => s.name.toLowerCase().includes(supplierQuery.toLowerCase())).slice(0, 10));
    }, 200);
    return () => clearTimeout(t);
  }, [supplierQuery]);

  useEffect(() => {
    if (!supplier) return;
    if ((paymentMethod === 'TEMPO' || initialStatus === 'BELUM_LUNAS') && !paymentDueAt) {
      const term = supplier.payment_term_days ?? 0;
      const d = new Date(purchaseDate);
      d.setDate(d.getDate() + term);
      setPaymentDueAt(d.toISOString().slice(0, 10));
    }
  }, [supplier, paymentMethod, initialStatus, purchaseDate]);

  const subtotal = useMemo(() => items.reduce((a, i) => a + i.qty * i.unit_cost, 0), [items]);
  const projectedRevenue = useMemo(() => items.reduce((a, i) => a + i.qty * i.sell_price, 0), [items]);
  const profit = projectedRevenue - subtotal;
  const margin = projectedRevenue > 0 ? (profit / projectedRevenue * 100) : 0;

  function addItemFromSku() {
    if (!draftSku) return;
    setItems(prev => [...prev, {
      sku: draftSku.sku, product_name: draftSku.name,
      qty: 1, unit_cost: 0, sell_price: draftSku.sell_price ?? 0,
    }]);
    setDraftSku(null);
  }

  async function handleSubmit(forceIgnoreDup = false) {
    if (!order) { showToast('Pilih Order tujuan dulu', 'warning'); return; }
    if (!supplier) { showToast('Pilih supplier dulu', 'warning'); return; }
    if (items.length === 0) { showToast('Tambah minimal 1 item', 'warning'); return; }
    if (initialStatus === 'BELUM_LUNAS' && !paymentDueAt) {
      showToast('Tanggal jatuh tempo wajib untuk Belum Lunas', 'warning'); return;
    }
    setSaving(true);
    try {
      let invoicePhoto = supplierInvoicePhotoUrl;
      if (supplierInvoicePhoto) {
        invoicePhoto = await purchaseInvoiceService.uploadAttachment(supplierInvoicePhoto, `supplier-invoices/${supplier.id}`);
      }
      let payProof = editing?.payment_proof_url ?? undefined;
      if (paymentProofFile) {
        payProof = await purchaseInvoiceService.uploadAttachment(paymentProofFile, `payment-proofs/${supplier.id}`);
      }

      if (editing) {
        await purchaseInvoiceService.update(editing.id, {
          supplier_id: supplier.id,
          order_id: order.id,
          purchase_date: purchaseDate,
          supplier_invoice_number: supplierInvNum || undefined,
          supplier_invoice_photo_url: invoicePhoto || undefined,
          payment_method: paymentMethod,
          payment_due_at: paymentDueAt || undefined,
          payment_proof_url: payProof,
          notes: notes || undefined,
          items: items.map(i => ({
            sku: i.sku, product_name: i.product_name, qty: i.qty,
            unit_cost: i.unit_cost, sell_price: i.sell_price,
          })),
        });
        showToast(`${editing.pi_number} di-update.`, 'success');
        onSaved(editing.pi_number);
        return;
      }

      const payload: RecordPiPayload = {
        supplier_id: supplier.id,
        order_id: order.id,
        purchase_date: purchaseDate,
        supplier_invoice_number: supplierInvNum || undefined,
        supplier_invoice_photo_url: invoicePhoto || undefined,
        payment_method: paymentMethod,
        payment_due_at: initialStatus === 'BELUM_LUNAS' ? paymentDueAt : undefined,
        initial_status: initialStatus,
        payment_proof_url: payProof,
        notes: notes || undefined,
        items: items.map(i => ({
          sku: i.sku, product_name: i.product_name, qty: i.qty,
          unit_cost: i.unit_cost, sell_price: i.sell_price,
        })),
        ignore_duplicate_warning: forceIgnoreDup,
      };
      const result = await purchaseInvoiceService.record(payload);
      if (result.kind === 'duplicate_warning') {
        setDuplicateWarning({ existingPi: result.existing_pi });
      } else {
        showToast(`${result.pi_number} dibuat.`, 'success');
        onSaved(result.pi_number);
      }
    } catch (e: any) {
      showToast(e?.message ?? 'Gagal simpan PI', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span>Pembelian</span><ChevronRight className="w-3 h-3" />
        <span>Belanja Numpang Lewat</span><ChevronRight className="w-3 h-3" />
        <span className="text-gray-800 font-semibold">{editing ? `Edit ${editing.pi_number}` : 'Buat Baru'}</span>
      </div>

      <h1 className="text-xl font-extrabold" style={{ color: '#012749' }}>
        {editing ? `Edit ${editing.pi_number}` : 'Buat Belanja Numpang Lewat'}
      </h1>
      <p className="text-xs text-gray-500">Pembelian pass-through — barang langsung jual ke customer, tidak nambah stok.</p>

      {/* 1. Header */}
      <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">1. Header</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Order Terkait <span className="text-red-500">*</span></label>
            <OrderPicker value={order} onChange={setOrder} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Supplier (Toko Grosir) <span className="text-red-500">*</span></label>
            {supplier ? (
              <div className="border-2 border-gray-300 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm">{supplier.name}</div>
                  <div className="text-[11px] text-gray-500">Net {supplier.payment_term_days ?? 0} hari</div>
                </div>
                <button type="button" onClick={() => setSupplier(null)} className="text-xs text-indigo-600 font-semibold hover:underline">Ganti</button>
              </div>
            ) : (
              <div className="relative">
                <input value={supplierQuery} onChange={e => setSupplierQuery(e.target.value)}
                  placeholder="Cari supplier..."
                  className="w-full text-sm py-2 px-3 rounded-xl border border-gray-300 focus:outline-none focus:border-indigo-500" />
                {supplierResults.length > 0 && (
                  <div className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-auto bg-white rounded-xl border border-gray-200 shadow-lg">
                    {supplierResults.map(s => (
                      <button key={s.id} type="button" onClick={() => { setSupplier(s); setSupplierQuery(''); setSupplierResults([]); }}
                        className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-gray-100 last:border-0">
                        <div className="font-semibold text-sm">{s.name}</div>
                        <div className="text-[11px] text-gray-500">Net {s.payment_term_days} hari</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Tanggal Beli</label>
            <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)}
              className="w-full text-sm py-2 px-3 rounded-xl border border-gray-300" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Nomor Faktur Supplier</label>
            <input value={supplierInvNum} onChange={e => setSupplierInvNum(e.target.value)}
              placeholder="INV-0123 / nota tulis tangan"
              className="w-full text-sm py-2 px-3 rounded-xl border border-gray-300" />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Foto Faktur Supplier <span className="text-[11px] font-normal text-amber-700 ml-2">(Recommended — bukti dispute)</span></label>
            <label className="flex items-center gap-2 px-3 py-2.5 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer text-xs text-gray-500 hover:border-indigo-300">
              <Upload className="w-4 h-4" />
              {supplierInvoicePhoto ? supplierInvoicePhoto.name : (supplierInvoicePhotoUrl ? 'Sudah ada foto (klik untuk ganti)' : 'Klik atau drag foto faktur (JPG/PNG/PDF, max 5MB)')}
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setSupplierInvoicePhoto(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          <div className="col-span-2">
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Catatan (opsional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Misal: nota grosir terlampir, atau pesan khusus"
              className="w-full text-sm py-2 px-3 rounded-xl border border-gray-300" />
          </div>
        </div>
      </div>

      {/* 2. Items */}
      <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500">2. Barang yang Dibeli</div>
          <div className="text-[11px] text-violet-700 bg-violet-50 px-2 py-1 rounded-full font-semibold inline-flex items-center gap-1">
            <Info className="w-3 h-3" /> Stok tidak berubah — barang langsung jual ke customer
          </div>
        </div>
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left py-2 pr-2 text-[11px] font-semibold text-gray-500 uppercase">SKU / Nama</th>
              <th className="text-center py-2 px-2 w-20 text-[11px] font-semibold text-gray-500 uppercase">Qty</th>
              <th className="text-right py-2 px-2 w-32 text-[11px] font-semibold text-gray-500 uppercase">Harga Beli</th>
              <th className="text-right py-2 px-2 w-32 text-[11px] font-semibold text-gray-500 uppercase">Harga Jual</th>
              <th className="text-right py-2 px-2 w-32 text-[11px] font-semibold text-gray-500 uppercase">Subtotal</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx} className="border-b border-gray-100">
                <td className="py-3 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded">{it.sku}</span>
                    <span className="text-sm">{it.product_name}</span>
                  </div>
                </td>
                <td className="py-3 px-2"><input type="number" min="1" value={it.qty}
                  onChange={e => setItems(prev => prev.map((p, i) => i === idx ? { ...p, qty: Number(e.target.value) || 0 } : p))}
                  className="w-full text-sm text-center py-1 px-2 rounded-lg border border-gray-200" /></td>
                <td className="py-3 px-2"><input type="number" min="0" value={it.unit_cost}
                  onChange={e => setItems(prev => prev.map((p, i) => i === idx ? { ...p, unit_cost: Number(e.target.value) || 0 } : p))}
                  className="w-full text-sm text-right py-1 px-2 rounded-lg border border-gray-200" /></td>
                <td className="py-3 px-2"><input type="number" min="0" value={it.sell_price}
                  onChange={e => setItems(prev => prev.map((p, i) => i === idx ? { ...p, sell_price: Number(e.target.value) || 0 } : p))}
                  className="w-full text-sm text-right py-1 px-2 rounded-lg border border-gray-200" /></td>
                <td className="py-3 px-2 text-right text-sm font-bold" style={{ color: '#012749' }}>{fmtRp(it.qty * it.unit_cost)}</td>
                <td className="py-3 text-center">
                  <button type="button" onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))} className="text-gray-400 hover:text-red-500">
                    <X className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={6} className="py-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <SkuPickerWithInlineCreate value={draftSku} unitCostHint={0} onChange={(v) => setDraftSku(v)} />
                  </div>
                  <button type="button" onClick={addItemFromSku} disabled={!draftSku}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-white px-3 py-2 rounded-lg disabled:opacity-50"
                    style={{ background: '#012749' }}>
                    <Plus className="w-4 h-4" /> Tambah
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 3. Payment */}
      <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">3. Pembayaran ke Supplier</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-semibold text-gray-600 mb-2">Metode</div>
            <PaymentMethodPicker value={paymentMethod} onChange={setPaymentMethod} />
            {(paymentMethod === 'TEMPO' || initialStatus === 'BELUM_LUNAS') && (
              <div className="mt-3 p-3 rounded-xl border border-fuchsia-200 bg-fuchsia-50/40">
                <label className="text-xs font-semibold text-fuchsia-700 block mb-1.5">Jatuh Tempo Bayar *</label>
                <input type="date" value={paymentDueAt} onChange={e => setPaymentDueAt(e.target.value)}
                  className="w-full text-sm py-2 px-3 rounded-xl border border-fuchsia-200" />
                <div className="text-[11px] text-fuchsia-700 mt-2">Auto-fill dari supplier Net {supplier?.payment_term_days ?? 0} hari.</div>
              </div>
            )}
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-600 mb-2">Status</div>
            <div className="grid grid-cols-2 gap-2">
              <label className={`flex items-center gap-2 p-3 rounded-xl border-2 cursor-pointer ${initialStatus === 'LUNAS' ? 'border-green-500 bg-green-50/50' : 'border-gray-200 bg-white'}`}>
                <input type="radio" checked={initialStatus === 'LUNAS'} onChange={() => setInitialStatus('LUNAS')} className="accent-green-600" />
                <span className="text-xs font-bold">Sudah Lunas</span>
              </label>
              <label className={`flex items-center gap-2 p-3 rounded-xl border-2 cursor-pointer ${initialStatus === 'BELUM_LUNAS' ? 'border-amber-500 bg-amber-50/50' : 'border-gray-200 bg-white'}`}>
                <input type="radio" checked={initialStatus === 'BELUM_LUNAS'} onChange={() => setInitialStatus('BELUM_LUNAS')} className="accent-amber-600" />
                <span className="text-xs font-bold">Belum Lunas</span>
              </label>
            </div>
            <div className="mt-3">
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Bukti Bayar (opsional)</label>
              <label className="flex items-center gap-2 px-3 py-2.5 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer text-xs text-gray-400 hover:border-indigo-300">
                <Upload className="w-4 h-4" />
                {paymentProofFile ? paymentProofFile.name : 'Klik untuk upload'}
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setPaymentProofFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Summary */}
      <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">4. Ringkasan</div>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-50 rounded-2xl p-4">
            <div className="text-[11px] text-gray-500 uppercase font-semibold">Total Beli</div>
            <div className="text-xl font-extrabold mt-1" style={{ color: '#012749' }}>{fmtRp(subtotal)}</div>
          </div>
          <div className="bg-indigo-50 rounded-2xl p-4">
            <div className="text-[11px] text-indigo-600 uppercase font-semibold">Estimasi Jual</div>
            <div className="text-xl font-extrabold mt-1 text-indigo-700">{fmtRp(projectedRevenue)}</div>
          </div>
          <div className="bg-green-50 rounded-2xl p-4">
            <div className="text-[11px] text-green-700 uppercase font-semibold">Estimasi Profit ({margin.toFixed(1)}%)</div>
            <div className="text-xl font-extrabold mt-1 text-green-700">{fmtRp(profit)}</div>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm font-semibold text-gray-600 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Batal</button>
        <button onClick={() => handleSubmit(false)} disabled={saving}
          className="text-sm font-semibold text-white px-4 py-2 rounded-lg disabled:opacity-50"
          style={{ background: '#012749' }}>
          {saving ? 'Menyimpan...' : (editing ? 'Update PI' : 'Simpan')}
        </button>
      </div>

      {duplicateWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDuplicateWarning(null)}>
          <div className="bg-white rounded-xl border border-amber-200 shadow-xl max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-sm text-amber-800 mb-2">⚠ Nomor Faktur Sudah Pernah</h3>
            <p className="text-xs text-gray-600">
              Faktur <strong>{supplierInvNum}</strong> dari supplier ini sudah pernah dicatat di <strong>{duplicateWarning.existingPi}</strong>. Apakah kamu yakin mau lanjut?
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setDuplicateWarning(null)} className="text-sm px-3 py-2 rounded-lg border border-gray-200">Batal</button>
              <button onClick={() => { setDuplicateWarning(null); handleSubmit(true); }}
                className="text-sm px-3 py-2 rounded-lg text-white font-semibold" style={{ background: '#012749' }}>Lanjut</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
