// Tagihan Form — receive-goods + invoice for type='STOCK'.
// Required: Pesanan picker (filter status='ORDERED'). When picked, items
// are pre-filled from pesanan_items with qty: 0 (operator enters Diterima).
// Each row preserves pesanan_item_id for the RPC trigger to bump
// qty_received_total. Payment section: method + due date + Bayar Sekarang
// (LUNAS) / Bayar Nanti (BELUM_LUNAS) radio.
// Task 16: per-item Diskon column + order-level DiscountRow in total bar;
// gated by tenant_settings.modul_diskon_tagihan.
import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Upload, ArrowLeft } from 'lucide-react';
import { purchaseInvoiceService } from '../../../lib/purchaseInvoiceService';
import { pesananService } from '../../../lib/pesananService';
import { warehousesService } from '../../../lib/supabaseClient';
import { tenantSettingsService } from '../../../lib/pengaturan/pengaturanServices';
import { NumberInput } from '../../ui/NumberInput';
import type { DbPesanan, PiPaymentMethod, Warehouse, DiscountType } from '../../../types';
import PaymentMethodPicker from '../bnl/PaymentMethodPicker';
import { DiscountInlineInput, DiscountRow, useDiscountBinding, computeDiscountAmount } from '../../ui/discount';
import { wibDateString } from '../../../lib/format';
import { formatIDR } from '../../../lib/formatIDR';

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
  master_unit_cost: number;  // original pesanan unit_cost (List price)
  warehouse_id: string;
  discount_type: DiscountType;
  discount_value: number | null;
  discount_amount_rp: number;
}

const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

// ── Per-row sub-component (isolates useDiscountBinding hook) ────────────────
interface TagihanItemRowProps {
  it: ItemRow;
  idx: number;
  warehouses: Warehouse[];
  modulOn: boolean;
  onChange: (idx: number, patch: Partial<ItemRow>) => void;
}

function TagihanItemRow({ it, idx, warehouses, modulOn, onChange }: TagihanItemRowProps) {
  const binding = useDiscountBinding(it.master_unit_cost, it.qty, {
    discount_type: it.discount_type ?? null,
    discount_value: it.discount_value ?? null,
    discount_amount_rp: it.discount_amount_rp ?? 0,
  });

  const remaining = it.qty_ordered - it.qty_received_already;
  const overReceive = it.qty > remaining;

  // When user edits the unit_cost input directly (Path B: typed price → infer discount)
  const handleUnitCostChange = (typed: number) => {
    if (modulOn) {
      binding.setTypedPrice(typed);
      const perUnitOff = it.master_unit_cost - typed;
      const lineTotal = perUnitOff * it.qty;
      if (!Number.isFinite(typed) || typed < 0 || typed > it.master_unit_cost) {
        // Out of range — just update unit_cost, clear discount
        onChange(idx, { unit_cost: typed, discount_type: null, discount_value: null, discount_amount_rp: 0 });
        return;
      }
      if (lineTotal <= 0) {
        onChange(idx, { unit_cost: typed, discount_type: null, discount_value: null, discount_amount_rp: 0 });
      } else {
        onChange(idx, { unit_cost: typed, discount_type: 'AMOUNT', discount_value: lineTotal, discount_amount_rp: lineTotal });
      }
    } else {
      onChange(idx, { unit_cost: typed });
    }
  };

  // When user edits discount inline
  const handleDiscountChange = (value: number | null, type: DiscountType) => {
    binding.setDiscountFromInput(value, type);
    let amount = 0;
    if (type !== null && value != null && Number.isFinite(value) && value > 0) {
      const base = it.master_unit_cost * it.qty;
      if (type === 'AMOUNT') amount = Math.min(value, base);
      else amount = Math.min(Math.round((base * value) / 100), base);
    }
    // Derive effective unit_cost = master - (discount_amount_rp / qty)
    const perUnitOff = it.qty > 0 ? Math.round(amount / it.qty) : 0;
    const newUnitCost = it.master_unit_cost - perUnitOff;
    onChange(idx, { unit_cost: newUnitCost, discount_type: type, discount_value: value, discount_amount_rp: amount });
  };

  const handleQtyChange = (newQty: number) => {
    // Recompute discount amount for new qty
    const newBase = it.master_unit_cost * newQty;
    const newAmount = computeDiscountAmount(it.discount_value, it.discount_type, newBase);
    const perUnitOff = newQty > 0 ? Math.round(newAmount / newQty) : 0;
    const newUnitCost = it.master_unit_cost - perUnitOff;
    onChange(idx, { qty: newQty, unit_cost: newUnitCost, discount_amount_rp: newAmount });
  };

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
        <NumberInput allowDecimal={false} value={it.qty}
          onChange={handleQtyChange}
          className={`w-full text-sm text-center py-1 px-2 rounded-sm border ${overReceive ? 'border-red-400 bg-red-50' : 'border-gray-200'}`} />
        <div className="text-[10px] text-gray-400 text-center mt-0.5">Sisa: {remaining}</div>
      </td>
      <td className="py-3">
        {modulOn && it.master_unit_cost > 0 && (
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">
            List {formatIDR(it.master_unit_cost)}
          </div>
        )}
        <NumberInput
          value={modulOn ? (it.master_unit_cost - Math.round((it.discount_amount_rp ?? 0) / Math.max(1, it.qty))) : it.unit_cost}
          onChange={handleUnitCostChange}
          className="w-full text-sm text-right py-1 px-2 rounded-sm border border-gray-200" />
      </td>
      {modulOn && (
        <td className="py-3">
          <DiscountInlineInput
            value={it.discount_value ?? null}
            type={it.discount_type ?? null}
            base={it.master_unit_cost * it.qty}
            onChange={handleDiscountChange}
          />
        </td>
      )}
      <td className="py-3">
        <select value={it.warehouse_id}
          onChange={e => onChange(idx, { warehouse_id: e.target.value })}
          className="w-full text-xs py-1 px-2 rounded-sm border border-gray-200">
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </td>
      <td className="py-3 text-right text-sm font-bold" style={{ color: 'var(--color-caleo-primary)' }}>
        {formatIDR((it.qty * it.master_unit_cost) - (it.discount_amount_rp ?? 0))}
      </td>
    </tr>
  );
}

export default function TagihanFormPage({ showToast, onCancel, onSaved, prefillPesanan }: Props) {
  const [pesanan, setPesanan] = useState<DbPesanan | null>(prefillPesanan ?? null);
  const [pesananQuery, setPesananQuery] = useState('');
  const [pesananResults, setPesananResults] = useState<DbPesanan[]>([]);
  const [purchaseDate, setPurchaseDate] = useState(wibDateString());
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
  // Task 16: order-level discount state
  const [orderDiscountValue, setOrderDiscountValue] = useState<number | null>(null);
  const [orderDiscountType, setOrderDiscountType] = useState<DiscountType>(null);
  // Task 16: modul gate
  const [modulOn, setModulOn] = useState(true);

  // Load warehouses + tenant settings on mount
  useEffect(() => {
    (async () => {
      try {
        const whs = await warehousesService.fetchActive();
        setWarehouses(whs);
        const def = whs.find(w => w.is_default) ?? whs[0];
        if (def) setDefaultWh(def.id);
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Gagal load gudang', 'warning');
      }
    })();
    // Fetch modul gate (soft-fail: default true)
    tenantSettingsService.fetch()
      .then(s => setModulOn(s?.modul_diskon_tagihan ?? true))
      .catch(() => { /* default true */ });
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

  // When Pesanan is picked (or prefill), populate items.
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
      master_unit_cost: i.unit_cost,  // pesanan price = list price
      warehouse_id: defaultWh,
      discount_type: null,
      discount_value: null,
      discount_amount_rp: 0,
    }));
    setItems(rows);
  }, [pesanan, defaultWh]);

  // Payment due auto-fill — separate effect keyed on purchaseDate too, so
  // adjusting purchaseDate AFTER Pesanan pick correctly recomputes JT.
  // Was baked into the effect above with only [pesanan, defaultWh] deps,
  // giving a stale JT after any purchaseDate edit.
  useEffect(() => {
    if (!pesanan || pesanan.supplier?.payment_term_days == null) return;
    const d = new Date(purchaseDate);
    d.setDate(d.getDate() + (pesanan.supplier.payment_term_days ?? 0));
    setPaymentDueAt(wibDateString(d));
  }, [pesanan, purchaseDate]);

  const updateItem = (idx: number, patch: Partial<ItemRow>) => {
    setItems(prev => prev.map((p, i) => i === idx ? { ...p, ...patch } : p));
  };

  // Subtotals
  const subtotalAfterLine = useMemo(
    () => items.reduce((a, it) => a + (it.qty * it.master_unit_cost) - (it.discount_amount_rp ?? 0), 0),
    [items],
  );
  const orderDiscountAmountRp = useMemo(
    () => computeDiscountAmount(orderDiscountValue, orderDiscountType, subtotalAfterLine),
    [orderDiscountValue, orderDiscountType, subtotalAfterLine],
  );
  const totalFinal = subtotalAfterLine - orderDiscountAmountRp;

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

      const payload = {
        type: 'STOCK' as const,
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
        // Task 16: order-level discount triple
        discount_type: orderDiscountType ?? undefined,
        discount_value: orderDiscountValue ?? undefined,
        discount_amount_rp: orderDiscountAmountRp > 0 ? orderDiscountAmountRp : undefined,
        items: items
          .filter(i => i.qty > 0)
          .map(i => ({
            sku: i.sku,
            product_name: i.product_name,
            qty: i.qty,
            unit_cost: i.master_unit_cost,
            sell_price: 0,
            pesanan_item_id: i.pesanan_item_id,
            warehouse_id: i.warehouse_id || undefined,
            // Task 16: per-item discount fields
            master_unit_cost: i.master_unit_cost,
            discount_type: i.discount_type ?? undefined,
            discount_value: i.discount_value ?? undefined,
            discount_amount_rp: i.discount_amount_rp > 0 ? i.discount_amount_rp : undefined,
          })),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await purchaseInvoiceService.record(payload as any);
      if (result.kind === 'duplicate_warning') {
        showToast(`Faktur supplier sudah pernah dicatat di ${result.existing_pi}`, 'warning');
        return;
      }
      showToast(`${result.pi_number} dibuat. Stok bertambah.`, 'success');
      onSaved(result.pi_number);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal simpan Tagihan', 'warning');
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

      <h1 className="text-xl font-extrabold" style={{ color: 'var(--color-caleo-primary)' }}>Buat Tagihan (Terima Barang + Faktur)</h1>
      <p className="text-xs text-gray-500">Step 2 dari alur Pembelian Stok: catat barang datang &amp; faktur supplier. Stok otomatis bertambah.</p>

      {/* 1. Pesanan picker */}
      <div className="bg-white/78 backdrop-blur-xl rounded-sm border border-gray-200 shadow-sm p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">1. Pilih Pesanan</div>
        {pesanan ? (
          <div className="border-2 border-indigo-200 bg-indigo-50/40 rounded-sm p-4 flex items-start justify-between">
            <div>
              <div className="font-bold text-sm text-indigo-800">{pesanan.pesanan_number}</div>
              <div className="text-xs text-gray-700 mt-1">{pesanan.supplier?.name} • Net {pesanan.supplier?.payment_term_days ?? 0} hari</div>
              <div className="text-[11px] text-gray-500 mt-1">
                {(pesanan.items ?? []).length} item • Total {formatIDR(pesanan.total)} • Estimasi datang {fmtDate(pesanan.expected_receive_at)}
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
              className="w-full text-sm py-2 px-3 rounded-sm border border-gray-300 focus:outline-none focus:border-indigo-500" />
            {pesananResults.length > 0 && (
              <div className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-auto bg-white rounded-sm border border-gray-200 shadow-lg">
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
                    <div className="text-[11px] text-gray-500">{p.supplier?.name} • {formatIDR(p.total)}</div>
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
        <div className="bg-white/78 backdrop-blur-xl rounded-sm border border-gray-200 shadow-sm p-5">
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
                {modulOn && (
                  <th className="text-right py-2 w-36 text-[11px] font-semibold text-gray-500 uppercase">Diskon</th>
                )}
                <th className="text-left py-2 w-40 text-[11px] font-semibold text-gray-500 uppercase">Gudang</th>
                <th className="text-right py-2 w-32 text-[11px] font-semibold text-gray-500 uppercase">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <TagihanItemRow
                  key={it.pesanan_item_id}
                  it={it}
                  idx={idx}
                  warehouses={warehouses}
                  modulOn={modulOn}
                  onChange={updateItem}
                />
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={modulOn ? 7 : 6} className="py-2 text-right text-xs font-semibold text-gray-500">
                  SUBTOTAL (setelah diskon item)
                </td>
                <td className="py-2 text-right text-sm font-bold" style={{ color: 'var(--color-caleo-primary)' }}>{formatIDR(subtotalAfterLine)}</td>
              </tr>
              {modulOn && (
                <tr>
                  <td colSpan={8} className="py-2">
                    <DiscountRow
                      label="Diskon Tagihan"
                      value={orderDiscountValue}
                      type={orderDiscountType}
                      base={subtotalAfterLine}
                      onChange={(v, t) => { setOrderDiscountValue(v); setOrderDiscountType(t); }}
                    />
                  </td>
                </tr>
              )}
              <tr>
                <td colSpan={modulOn ? 7 : 6} className="py-3 text-right text-xs font-semibold text-gray-500">TOTAL TAGIHAN</td>
                <td className="py-3 text-right text-xl font-extrabold" style={{ color: 'var(--color-caleo-primary)' }}>{formatIDR(totalFinal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* 3. Faktur & Pembayaran */}
      {pesanan && (
        <div className="bg-white/78 backdrop-blur-xl rounded-sm border border-gray-200 shadow-sm p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">3. Faktur &amp; Pembayaran</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Tanggal Faktur</label>
              <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)}
                className="w-full text-sm py-2 px-3 rounded-sm border border-gray-300" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Nomor Faktur Supplier</label>
              <input value={supplierInvNum} onChange={e => setSupplierInvNum(e.target.value)}
                placeholder="INV-0123 / nota"
                className="w-full text-sm py-2 px-3 rounded-sm border border-gray-300" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Foto Faktur (Recommended)</label>
              <label className="flex items-center gap-2 px-3 py-2.5 border-2 border-dashed border-gray-200 rounded-sm cursor-pointer text-xs text-gray-500 hover:border-indigo-300">
                <Upload className="w-4 h-4" />
                {supplierInvoicePhoto ? supplierInvoicePhoto.name : 'Klik atau drag foto faktur (JPG/PNG/PDF, max 5MB)'}
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setSupplierInvoicePhoto(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-600 mb-2">Status Bayar</div>
              <div className="grid grid-cols-2 gap-2">
                <label className={`flex items-center gap-2 p-3 rounded-sm border-2 cursor-pointer ${initialStatus === 'LUNAS' ? 'border-green-500 bg-green-50/50' : 'border-gray-200 bg-white'}`}>
                  <input type="radio" checked={initialStatus === 'LUNAS'} onChange={() => setInitialStatus('LUNAS')} className="accent-green-600" />
                  <span className="text-xs font-bold">Bayar Sekarang</span>
                </label>
                <label className={`flex items-center gap-2 p-3 rounded-sm border-2 cursor-pointer ${initialStatus === 'BELUM_LUNAS' ? 'border-amber-500 bg-amber-50/50' : 'border-gray-200 bg-white'}`}>
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
              <div className="col-span-2 p-3 rounded-sm border border-fuchsia-200 bg-fuchsia-50/40">
                <label className="text-xs font-semibold text-fuchsia-700 block mb-1.5">Jatuh Tempo Bayar *</label>
                <input type="date" value={paymentDueAt} onChange={e => setPaymentDueAt(e.target.value)}
                  className="w-full text-sm py-2 px-3 rounded-sm border border-fuchsia-200" />
                <div className="text-[11px] text-fuchsia-700 mt-2">Auto-fill dari supplier Net {pesanan.supplier?.payment_term_days ?? 0} hari.</div>
              </div>
            )}
            {initialStatus === 'LUNAS' && (
              <div className="col-span-2">
                <label className="text-xs font-semibold text-gray-600 block mb-1.5">Bukti Bayar (opsional)</label>
                <label className="flex items-center gap-2 px-3 py-2.5 border-2 border-dashed border-gray-200 rounded-sm cursor-pointer text-xs text-gray-400 hover:border-indigo-300">
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
                className="w-full text-sm py-2 px-3 rounded-sm border border-gray-300" />
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm font-semibold text-gray-600 px-4 py-2 rounded-sm border border-gray-200 hover:bg-gray-50">Batal</button>
        <button onClick={handleSubmit} disabled={saving || !pesanan}
          className="text-sm font-semibold text-white px-4 py-2 rounded-sm disabled:opacity-50"
          style={{ background: 'var(--color-caleo-primary)' }}>
          {saving ? 'Menyimpan...' : 'Simpan Tagihan'}
        </button>
      </div>
    </div>
  );
}
