// Tagihan Form — receive-goods + invoice for type='STOCK'.
// Required: Pesanan picker (filter status='ORDERED'). When picked, items
// are pre-filled from pesanan_items with qty: 0 (operator enters Diterima).
// Each row preserves pesanan_item_id for the RPC trigger to bump
// qty_received_total. Payment section: method + due date + Bayar Sekarang
// (LUNAS) / Bayar Nanti (BELUM_LUNAS) radio.
import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Upload, ArrowLeft } from 'lucide-react';
import { purchaseInvoiceService } from '../../../lib/purchaseInvoiceService';
import { pesananService } from '../../../lib/pesananService';
import { warehousesService } from '../../../lib/supabaseClient';
import type { DbPesanan, PiPaymentMethod, Warehouse } from '../../../types';
import PaymentMethodPicker from '../bnl/PaymentMethodPicker';

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onCancel: () => void;
  onSaved: (tghNumber: string) => void;
  prefillPesanan?: DbPesanan;
}

interface ItemRow {
  pesanan_item_id: string;
  sku: string;
  product_name: string;
  qty_ordered: number;
  qty_received_already: number;
  qty: number;          // Diterima this Tagihan
  unit_cost: number;
  warehouse_id: string;
}

const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function TagihanFormPage({ showToast, onCancel, onSaved, prefillPesanan }: Props) {
  const [pesanan, setPesanan] = useState<DbPesanan | null>(prefillPesanan ?? null);
  const [pesananQuery, setPesananQuery] = useState('');
  const [pesananResults, setPesananResults] = useState<DbPesanan[]>([]);
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [supplierInvNum, setSupplierInvNum] = useState('');
  const [supplierInvoicePhoto, setSupplierInvoicePhoto] = useState<File | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PiPaymentMethod>('TEMPO');
  const [paymentDueAt, setPaymentDueAt] = useState('');
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const [initialStatus, setInitialStatus] = useState<'BELUM_LUNAS' | 'LUNAS'>('BELUM_LUNAS');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<ItemRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [defaultWh, setDefaultWh] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Load warehouses on mount
  useEffect(() => {
    (async () => {
      try {
        const whs = await warehousesService.fetchActive();
        setWarehouses(whs);
        const def = whs.find(w => w.is_default) ?? whs[0];
        if (def) setDefaultWh(def.id);
      } catch (e: any) {
        showToast(e?.message ?? 'Gagal load gudang', 'warning');
      }
    })();
  }, []);

  // Pesanan picker — search ORDERED only
  useEffect(() => {
    if (!pesananQuery || pesananQuery.length < 2) { setPesananResults([]); return; }
    const t = setTimeout(async () => {
      const all = await pesananService.fetchAll({ status: 'ORDERED' });
      const q = pesananQuery.toLowerCase();
      setPesananResults(
        all.filter(p =>
          p.pesanan_number.toLowerCase().includes(q) ||
          (p.supplier?.name ?? '').toLowerCase().includes(q),
        ).slice(0, 10),
      );
    }, 200);
    return () => clearTimeout(t);
  }, [pesananQuery]);

  // When Pesanan is picked (or prefill), populate items + payment defaults
  useEffect(() => {
    if (!pesanan || !defaultWh) return;
    const rows: ItemRow[] = (pesanan.items ?? []).map(i => ({
      pesanan_item_id: i.id,
      sku: i.sku,
      product_name: i.product_name,
      qty_ordered: i.qty,
      qty_received_already: i.qty_received_total,
      qty: Math.max(0, i.qty - i.qty_received_total),
      unit_cost: i.unit_cost,
      warehouse_id: defaultWh,
    }));
    setItems(rows);
    // payment due auto-fill from supplier
    if (pesanan.supplier?.payment_term_days != null) {
      const d = new Date(purchaseDate);
      d.setDate(d.getDate() + (pesanan.supplier.payment_term_days ?? 0));
      setPaymentDueAt(d.toISOString().slice(0, 10));
    }
  }, [pesanan, defaultWh]);

  const subtotal = useMemo(() => items.reduce((a, i) => a + i.qty * i.unit_cost, 0), [items]);

  async function handleSubmit() {
    if (!pesanan) { showToast('Pilih Pesanan dulu', 'warning'); return; }
    if (items.length === 0) { showToast('Pesanan ini tidak punya item', 'warning'); return; }
    if (items.every(i => i.qty <= 0)) { showToast('Isi qty diterima minimal 1 item', 'warning'); return; }
    if (items.some(i => i.qty < 0)) { showToast('Qty tidak boleh negatif', 'warning'); return; }
    if (initialStatus === 'BELUM_LUNAS' && !paymentDueAt) {
      showToast('Tanggal jatuh tempo wajib untuk Belum Lunas', 'warning');
      return;
    }
    // validate over-receive vs Pesanan
    for (const it of items) {
      const remaining = it.qty_ordered - it.qty_received_already;
      if (it.qty > remaining) {
        showToast(`Qty diterima ${it.sku} (${it.qty}) lebih besar dari sisa pesanan (${remaining})`, 'warning');
        return;
      }
    }

    setSaving(true);
    try {
      let invoicePhoto: string | undefined;
      if (supplierInvoicePhoto) {
        invoicePhoto = await purchaseInvoiceService.uploadAttachment(supplierInvoicePhoto, `supplier-invoices/${pesanan.supplier_id}`);
      }
      let payProof: string | undefined;
      if (paymentProofFile) {
        payProof = await purchaseInvoiceService.uploadAttachment(paymentProofFile, `payment-proofs/${pesanan.supplier_id}`);
      }

      const payload: any = {
        type: 'STOCK',
        supplier_id: pesanan.supplier_id,
        pesanan_id: pesanan.id,
        purchase_date: purchaseDate,
        supplier_invoice_number: supplierInvNum || undefined,
        supplier_invoice_photo_url: invoicePhoto,
        payment_method: paymentMethod,
        payment_due_at: initialStatus === 'BELUM_LUNAS' ? paymentDueAt : undefined,
        initial_status: initialStatus,
        payment_proof_url: payProof,
        notes: notes || undefined,
        items: items
          .filter(i => i.qty > 0)
          .map(i => ({
            sku: i.sku,
            product_name: i.product_name,
            qty: i.qty,
            unit_cost: i.unit_cost,
            sell_price: 0,
            pesanan_item_id: i.pesanan_item_id,
            warehouse_id: i.warehouse_id || undefined,
          })),
      };
      const result = await purchaseInvoiceService.record(payload);
      if (result.kind === 'duplicate_warning') {
        showToast(`Faktur supplier sudah pernah dicatat di ${result.existing_pi}`, 'warning');
        return;
      }
      showToast(`${result.pi_number} dibuat. Stok bertambah.`, 'success');
      onSaved(result.pi_number);
    } catch (e: any) {
      showToast(e?.message ?? 'Gagal simpan Tagihan', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <button onClick={onCancel} className="inline-flex items-center gap-1 hover:text-gray-800"><ArrowLeft className="w-3 h-3" /> Pembelian</button>
        <ChevronRight className="w-3 h-3" /><span>Tagihan</span>
        <ChevronRight className="w-3 h-3" /><span className="text-gray-800 font-semibold">Buat Baru</span>
      </div>

      <h1 className="text-xl font-extrabold" style={{ color: '#012749' }}>Buat Tagihan (Terima Barang + Faktur)</h1>
      <p className="text-xs text-gray-500">Step 2 dari alur Pembelian Stok: catat barang datang & faktur supplier. Stok otomatis bertambah.</p>

      {/* 1. Pesanan picker */}
      <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">1. Pilih Pesanan</div>
        {pesanan ? (
          <div className="border-2 border-indigo-200 bg-indigo-50/40 rounded-xl p-4 flex items-start justify-between">
            <div>
              <div className="font-bold text-sm text-indigo-800">{pesanan.pesanan_number}</div>
              <div className="text-xs text-gray-700 mt-1">{pesanan.supplier?.name} • Net {pesanan.supplier?.payment_term_days ?? 0} hari</div>
              <div className="text-[11px] text-gray-500 mt-1">
                {(pesanan.items ?? []).length} item • Total {fmtRp(pesanan.total)} • Estimasi datang {fmtDate(pesanan.expected_receive_at)}
              </div>
            </div>
            {!prefillPesanan && (
              <button type="button" onClick={() => { setPesanan(null); setItems([]); }} className="text-xs text-indigo-600 font-semibold hover:underline">Ganti</button>
            )}
          </div>
        ) : (
          <div className="relative">
            <input value={pesananQuery} onChange={e => setPesananQuery(e.target.value)}
              placeholder="Cari Pesanan (PSN-... atau nama supplier) — hanya yang status ORDERED"
              className="w-full text-sm py-2 px-3 rounded-xl border border-gray-300 focus:outline-none focus:border-indigo-500" />
            {pesananResults.length > 0 && (
              <div className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-auto bg-white rounded-xl border border-gray-200 shadow-lg">
                {pesananResults.map(p => (
                  <button key={p.id} type="button"
                    onClick={async () => {
                      // re-fetch with items
                      const full = await pesananService.fetchByNumber(p.pesanan_number);
                      if (full) setPesanan(full);
                      setPesananQuery('');
                      setPesananResults([]);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-gray-100 last:border-0">
                    <div className="font-semibold text-sm text-indigo-800">{p.pesanan_number}</div>
                    <div className="text-[11px] text-gray-500">{p.supplier?.name} • {fmtRp(p.total)}</div>
                  </button>
                ))}
              </div>
            )}
            <div className="text-[11px] text-gray-500 mt-2">Tagihan stok wajib link ke Pesanan. Belum ada Pesanan? Buat Pesanan dulu.</div>
          </div>
        )}
      </div>

      {/* 2. Barang yang Diterima */}
      {pesanan && (
        <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-bold uppercase tracking-wide text-gray-500">2. Barang yang Diterima</div>
            <div className="text-[11px] text-gray-500">Isi qty Diterima per item (boleh 0 kalau belum datang)</div>
          </div>
          <table className="w-full">
            <thead className="border-b border-gray-200">
              <tr>
                <th className="text-left py-2 text-[11px] font-semibold text-gray-500 uppercase">SKU / Nama</th>
                <th className="text-center py-2 w-20 text-[11px] font-semibold text-gray-500 uppercase">Dipesan</th>
                <th className="text-center py-2 w-20 text-[11px] font-semibold text-gray-500 uppercase">Sudah</th>
                <th className="text-center py-2 w-24 text-[11px] font-semibold text-gray-500 uppercase">Diterima *</th>
                <th className="text-right py-2 w-32 text-[11px] font-semibold text-gray-500 uppercase">Harga Beli</th>
                <th className="text-left py-2 w-40 text-[11px] font-semibold text-gray-500 uppercase">Gudang</th>
                <th className="text-right py-2 w-32 text-[11px] font-semibold text-gray-500 uppercase">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => {
                const remaining = it.qty_ordered - it.qty_received_already;
                const overReceive = it.qty > remaining;
                return (
                  <tr key={it.pesanan_item_id} className="border-b border-gray-100">
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded">{it.sku}</span>
                        <span className="text-sm">{it.product_name}</span>
                      </div>
                    </td>
                    <td className="py-3 text-center font-semibold">{it.qty_ordered}</td>
                    <td className="py-3 text-center text-gray-500">{it.qty_received_already}</td>
                    <td className="py-3">
                      <input type="number" min="0" max={remaining} value={it.qty}
                        onChange={e => setItems(prev => prev.map((p, i) => i === idx ? { ...p, qty: Number(e.target.value) || 0 } : p))}
                        className={`w-full text-sm text-center py-1 px-2 rounded-lg border ${overReceive ? 'border-red-400 bg-red-50' : 'border-gray-200'}`} />
                      <div className="text-[10px] text-gray-400 text-center mt-0.5">Sisa: {remaining}</div>
                    </td>
                    <td className="py-3">
                      <input type="number" min="0" value={it.unit_cost}
                        onChange={e => setItems(prev => prev.map((p, i) => i === idx ? { ...p, unit_cost: Number(e.target.value) || 0 } : p))}
                        className="w-full text-sm text-right py-1 px-2 rounded-lg border border-gray-200" />
                    </td>
                    <td className="py-3">
                      <select value={it.warehouse_id}
                        onChange={e => setItems(prev => prev.map((p, i) => i === idx ? { ...p, warehouse_id: e.target.value } : p))}
                        className="w-full text-xs py-1 px-2 rounded-lg border border-gray-200">
                        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                    </td>
                    <td className="py-3 text-right text-sm font-bold" style={{ color: '#012749' }}>{fmtRp(it.qty * it.unit_cost)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} className="py-3 text-right text-xs font-semibold text-gray-500">SUBTOTAL TAGIHAN</td>
                <td className="py-3 text-right text-xl font-extrabold" style={{ color: '#012749' }}>{fmtRp(subtotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* 3. Faktur & Pembayaran */}
      {pesanan && (
        <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">3. Faktur & Pembayaran</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Tanggal Faktur</label>
              <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)}
                className="w-full text-sm py-2 px-3 rounded-xl border border-gray-300" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Nomor Faktur Supplier</label>
              <input value={supplierInvNum} onChange={e => setSupplierInvNum(e.target.value)}
                placeholder="INV-0123 / nota"
                className="w-full text-sm py-2 px-3 rounded-xl border border-gray-300" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Foto Faktur (Recommended)</label>
              <label className="flex items-center gap-2 px-3 py-2.5 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer text-xs text-gray-500 hover:border-indigo-300">
                <Upload className="w-4 h-4" />
                {supplierInvoicePhoto ? supplierInvoicePhoto.name : 'Klik atau drag foto faktur (JPG/PNG/PDF, max 5MB)'}
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setSupplierInvoicePhoto(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-600 mb-2">Status Bayar</div>
              <div className="grid grid-cols-2 gap-2">
                <label className={`flex items-center gap-2 p-3 rounded-xl border-2 cursor-pointer ${initialStatus === 'LUNAS' ? 'border-green-500 bg-green-50/50' : 'border-gray-200 bg-white'}`}>
                  <input type="radio" checked={initialStatus === 'LUNAS'} onChange={() => setInitialStatus('LUNAS')} className="accent-green-600" />
                  <span className="text-xs font-bold">Bayar Sekarang</span>
                </label>
                <label className={`flex items-center gap-2 p-3 rounded-xl border-2 cursor-pointer ${initialStatus === 'BELUM_LUNAS' ? 'border-amber-500 bg-amber-50/50' : 'border-gray-200 bg-white'}`}>
                  <input type="radio" checked={initialStatus === 'BELUM_LUNAS'} onChange={() => setInitialStatus('BELUM_LUNAS')} className="accent-amber-600" />
                  <span className="text-xs font-bold">Bayar Nanti</span>
                </label>
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-600 mb-2">Metode</div>
              <PaymentMethodPicker value={paymentMethod} onChange={setPaymentMethod} />
            </div>
            {initialStatus === 'BELUM_LUNAS' && (
              <div className="col-span-2 p-3 rounded-xl border border-fuchsia-200 bg-fuchsia-50/40">
                <label className="text-xs font-semibold text-fuchsia-700 block mb-1.5">Jatuh Tempo Bayar *</label>
                <input type="date" value={paymentDueAt} onChange={e => setPaymentDueAt(e.target.value)}
                  className="w-full text-sm py-2 px-3 rounded-xl border border-fuchsia-200" />
                <div className="text-[11px] text-fuchsia-700 mt-2">Auto-fill dari supplier Net {pesanan.supplier?.payment_term_days ?? 0} hari.</div>
              </div>
            )}
            {initialStatus === 'LUNAS' && (
              <div className="col-span-2">
                <label className="text-xs font-semibold text-gray-600 block mb-1.5">Bukti Bayar (opsional)</label>
                <label className="flex items-center gap-2 px-3 py-2.5 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer text-xs text-gray-400 hover:border-indigo-300">
                  <Upload className="w-4 h-4" />
                  {paymentProofFile ? paymentProofFile.name : 'Klik untuk upload'}
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setPaymentProofFile(e.target.files?.[0] ?? null)} />
                </label>
              </div>
            )}
            <div className="col-span-2">
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Catatan (opsional)</label>
              <input value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Misal: ada barang rusak X qty, retur ke supplier"
                className="w-full text-sm py-2 px-3 rounded-xl border border-gray-300" />
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm font-semibold text-gray-600 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Batal</button>
        <button onClick={handleSubmit} disabled={saving || !pesanan}
          className="text-sm font-semibold text-white px-4 py-2 rounded-lg disabled:opacity-50"
          style={{ background: '#012749' }}>
          {saving ? 'Menyimpan...' : 'Simpan Tagihan'}
        </button>
      </div>
    </div>
  );
}
