// Pesanan Form (create + edit). Sections: Header (Supplier + dates + notes)
// / Items (SKU picker with inline create) / Summary.
// No Order picker (Pesanan tidak link ke Sales Order — itu BNL).
// No payment section (Pesanan tidak punya field bayar — itu Tagihan).
import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Plus, X } from 'lucide-react';
import { pesananService } from '../../../lib/pesananService';
import { supplierService } from '../../../lib/pembelianService';
import type { DbPesanan, DbSupplier, PesananItemDraft, RecordPesananPayload } from '../../../types';
import SkuPickerWithInlineCreate from '../bnl/SkuPickerWithInlineCreate';
import { NumberInput } from '../../ui/NumberInput';
import { formatIDR } from '../../../lib/formatIDR';

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onCancel: () => void;
  onSaved: (pesananNumber: string) => void;
  editing?: DbPesanan;
}

interface ItemRow {
  sku: string;
  product_name: string;
  qty: number;
  unit_cost: number;
}


export default function PesananFormPage({ showToast, onCancel, onSaved, editing }: Props) {
  const [supplier, setSupplier] = useState<DbSupplier | null>(editing?.supplier ?? null);
  const [supplierQuery, setSupplierQuery] = useState('');
  const [supplierResults, setSupplierResults] = useState<DbSupplier[]>([]);
  const [expectedReceiveAt, setExpectedReceiveAt] = useState(editing?.expected_receive_at ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [taxRate, setTaxRate] = useState<number>(editing?.tax_rate ?? 0);
  // (initialStatus state removed alongside dead radios — handleSubmit
  // receives status directly from the button click below.)
  const [items, setItems] = useState<ItemRow[]>(
    editing?.items?.map(i => ({
      sku: i.sku, product_name: i.product_name, qty: i.qty, unit_cost: i.unit_cost,
    })) ?? []
  );
  const [draftSku, setDraftSku] = useState<{ sku: string; name: string; sell_price?: number } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supplierQuery || supplierQuery.length < 2) { setSupplierResults([]); return; }
    const t = setTimeout(async () => {
      const all = await supplierService.fetchAll();
      setSupplierResults(all.filter(s => s.name.toLowerCase().includes(supplierQuery.toLowerCase())).slice(0, 10));
    }, 200);
    return () => clearTimeout(t);
  }, [supplierQuery]);

  const subtotal = useMemo(() => items.reduce((a, i) => a + i.qty * i.unit_cost, 0), [items]);
  const taxAmount = useMemo(() => subtotal * taxRate, [subtotal, taxRate]);
  const total = subtotal + taxAmount;

  function addItemFromSku() {
    if (!draftSku) return;
    setItems(prev => [...prev, {
      sku: draftSku.sku, product_name: draftSku.name,
      qty: 1, unit_cost: 0,
    }]);
    setDraftSku(null);
  }

  async function handleSubmit(submitStatus: 'DRAFT' | 'ORDERED') {
    if (!supplier) { showToast('Pilih supplier dulu', 'warning'); return; }
    if (items.length === 0) { showToast('Tambah minimal 1 item', 'warning'); return; }
    if (items.some(i => !i.qty || i.qty <= 0)) { showToast('Qty harus > 0 untuk semua item', 'warning'); return; }
    setSaving(true);
    try {
      const draftItems: PesananItemDraft[] = items.map(i => ({
        sku: i.sku, product_name: i.product_name, qty: i.qty, unit_cost: i.unit_cost,
      }));

      if (editing) {
        await pesananService.update(editing.id, {
          supplier_id: supplier.id,
          notes: notes || undefined,
          expected_receive_at: expectedReceiveAt || undefined,
          tax_rate: taxRate,
          items: draftItems,
        });
        showToast(`${editing.pesanan_number} di-update.`, 'success');
        onSaved(editing.pesanan_number);
        return;
      }

      const payload: RecordPesananPayload = {
        supplier_id: supplier.id,
        initial_status: submitStatus,
        notes: notes || undefined,
        expected_receive_at: expectedReceiveAt || undefined,
        tax_rate: taxRate,
        items: draftItems,
      };
      const result = await pesananService.record(payload);
      const msg = submitStatus === 'ORDERED'
        ? `${result.pesanan_number} dibuat & dikirim ke supplier.`
        : `${result.pesanan_number} disimpan sebagai DRAFT.`;
      showToast(msg, 'success');
      onSaved(result.pesanan_number);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal simpan Pesanan', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span>Pembelian</span><ChevronRight className="w-3 h-3" />
        <span>Pesanan</span><ChevronRight className="w-3 h-3" />
        <span className="text-gray-800 font-semibold">{editing ? `Edit ${editing.pesanan_number}` : 'Buat Baru'}</span>
      </div>

      <h1 className="text-xl font-extrabold" style={{ color: 'var(--color-caleo-primary)' }}>
        {editing ? `Edit ${editing.pesanan_number}` : 'Buat Pesanan'}
      </h1>
      <p className="text-xs text-gray-500">Step 1 dari alur Pembelian Stok: pesan ke supplier sebelum barang datang.</p>

      {/* 1. Header */}
      <div className="bg-white/78 backdrop-blur-xl rounded border border-gray-200 shadow-sm p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">1. Header</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Supplier <span className="text-red-500">*</span></label>
            {supplier ? (
              <div className="border-2 border-gray-300 rounded p-3 flex items-center justify-between">
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
                  className="w-full text-sm py-2 px-3 rounded border border-gray-300 focus:outline-none focus:border-indigo-500" />
                {supplierResults.length > 0 && (
                  <div className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-auto bg-white rounded border border-gray-200 shadow-lg">
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
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Estimasi Barang Datang</label>
            <input type="date" value={expectedReceiveAt} onChange={e => setExpectedReceiveAt(e.target.value)}
              className="w-full text-sm py-2 px-3 rounded border border-gray-300" />
            <div className="text-[11px] text-gray-500 mt-1">Opsional — bantu monitor JT pesanan.</div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Pajak (%)</label>
            <NumberInput value={taxRate}
              onChange={n => {
                // Enforce 0 ≤ rate ≤ 1 so pasting `11` doesn't yield 1100% tax.
                setTaxRate(Math.min(1, Math.max(0, n)));
              }}
              className="w-full text-sm py-2 px-3 rounded border border-gray-300" />
            <div className="text-[11px] text-gray-500 mt-1">Format decimal — 0.11 untuk 11%. Maks 1 (=100%).</div>
          </div>
          {/* "Status Awal" radios removed 2026-07-11 audit — the two buttons
              at the bottom ("Simpan Draft" / "Terbitkan Ordered") pass the
              status directly to handleSubmit, so this radio state was never
              read. It looked like a control, but selecting Ordered here then
              clicking Simpan Draft still saved as DRAFT. Confusing dead UI. */}
          <div className="col-span-2">
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Catatan (opsional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Misal: kirim ke gudang A, pesan via WA tanggal X"
              className="w-full text-sm py-2 px-3 rounded border border-gray-300" />
          </div>
        </div>
      </div>

      {/* 2. Items */}
      <div className="bg-white/78 backdrop-blur-xl rounded border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500">2. Barang yang Dipesan</div>
        </div>
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left py-2 pr-2 text-[11px] font-semibold text-gray-500 uppercase">SKU / Nama</th>
              <th className="text-center py-2 px-2 w-20 text-[11px] font-semibold text-gray-500 uppercase">Qty</th>
              <th className="text-right py-2 px-2 w-32 text-[11px] font-semibold text-gray-500 uppercase">Harga Beli</th>
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
                <td className="py-3 px-2"><NumberInput allowDecimal={false} value={it.qty}
                  onChange={n => setItems(prev => prev.map((p, i) => i === idx ? { ...p, qty: n } : p))}
                  className="w-full text-sm text-center py-1 px-2 rounded border border-gray-200" /></td>
                <td className="py-3 px-2"><NumberInput value={it.unit_cost}
                  onChange={n => setItems(prev => prev.map((p, i) => i === idx ? { ...p, unit_cost: n } : p))}
                  className="w-full text-sm text-right py-1 px-2 rounded border border-gray-200" /></td>
                <td className="py-3 px-2 text-right text-sm font-bold" style={{ color: 'var(--color-caleo-primary)' }}>{formatIDR(it.qty * it.unit_cost)}</td>
                <td className="py-3 text-center">
                  <button type="button" onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))} className="text-gray-400 hover:text-red-500">
                    <X className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={5} className="py-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <SkuPickerWithInlineCreate value={draftSku} unitCostHint={0} onChange={(v) => setDraftSku(v)} />
                  </div>
                  <button type="button" onClick={addItemFromSku} disabled={!draftSku}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-white px-3 py-2 rounded disabled:opacity-50"
                    style={{ background: 'var(--color-caleo-primary)' }}>
                    <Plus className="w-4 h-4" /> Tambah
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 3. Summary */}
      <div className="bg-white/78 backdrop-blur-xl rounded border border-gray-200 shadow-sm p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">3. Ringkasan</div>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-50 rounded p-4">
            <div className="text-[11px] text-gray-500 uppercase font-semibold">Subtotal</div>
            <div className="text-xl font-extrabold mt-1" style={{ color: 'var(--color-caleo-primary)' }}>{formatIDR(subtotal)}</div>
          </div>
          <div className="bg-amber-50 rounded p-4">
            <div className="text-[11px] text-amber-700 uppercase font-semibold">Pajak ({(taxRate * 100).toFixed(1)}%)</div>
            <div className="text-xl font-extrabold mt-1 text-amber-700">{formatIDR(taxAmount)}</div>
          </div>
          <div className="bg-indigo-50 rounded p-4">
            <div className="text-[11px] text-indigo-600 uppercase font-semibold">Total</div>
            <div className="text-xl font-extrabold mt-1 text-indigo-700">{formatIDR(total)}</div>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm font-semibold text-gray-600 px-4 py-2 rounded border border-gray-200 hover:bg-gray-50">Batal</button>
        {editing ? (
          <button onClick={() => handleSubmit('DRAFT')} disabled={saving}
            className="text-sm font-semibold text-white px-4 py-2 rounded disabled:opacity-50"
            style={{ background: 'var(--color-caleo-primary)' }}>
            {saving ? 'Menyimpan...' : 'Update Pesanan'}
          </button>
        ) : (
          <>
            <button onClick={() => handleSubmit('DRAFT')} disabled={saving}
              className="text-sm font-semibold text-gray-700 px-4 py-2 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
              {saving ? 'Menyimpan...' : 'Simpan Draft'}
            </button>
            <button onClick={() => handleSubmit('ORDERED')} disabled={saving}
              className="text-sm font-semibold text-white px-4 py-2 rounded disabled:opacity-50"
              style={{ background: 'var(--color-caleo-primary)' }}>
              {saving ? 'Menyimpan...' : 'Simpan & Kirim ke Supplier'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
