// Pembayaran Form — consolidated payment for 1 supplier covering N Tagihan.
// Flow:
//  1. Pick Supplier
//  2. suggestOutstanding fetches outstanding Tagihan rows (BELUM/SEBAGIAN).
//     Per row: checkbox + amount input (default = outstanding). Validation:
//     each amount > 0 and ≤ row.outstanding.
//     Smart buttons: Pilih semua outstanding / Pilih JT ≤ 7 hari.
//  3. Payment method + account_label + discount + proof upload
//  4. Running total = sum(selected amounts). Submit via pembayaranService.record.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Upload, ArrowLeft, Layers } from 'lucide-react';
import { pembayaranService } from '../../../lib/pembayaranService';
import { supplierService } from '../../../lib/pembelianService';
import { purchaseInvoiceService } from '../../../lib/purchaseInvoiceService';
import { supabase } from '../../../lib/supabaseClient';
import CashAccountPicker from '../../akuntansi/CashAccountPicker';
import { NumberInput } from '../../ui/NumberInput';
import type {
  DbSupplier,
  RecordPembayaranPayload,
  SuggestOutstandingTagihanRow,
  SuggestOutstandingTukarFakturRow,
} from '../../../types';
import { wibDateString } from '../../../lib/format';

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onCancel: () => void;
  onSaved: (pembayaranNumber: string) => void;
  prefillSupplierId?: string;
  /** Phase 2b: pre-check a TF outstanding row + scroll to it (set when navigating from TF Detail). */
  prefillTfId?: string;
}

/**
 * Phase 2b: rows can represent either a Tagihan (loose) or a Tukar Faktur (bundle).
 * Submit serializes to `tagihan_id` OR `tukar_faktur_id` (XOR enforced by DB CHECK).
 */
interface SelectedRow {
  kind: 'TAGIHAN' | 'TF';
  /** uuid of the underlying row — Tagihan id when kind=TAGIHAN, TF id when kind=TF. */
  ref_id: string;
  /** Display label — `pi_number` for Tagihan, `tf_number` for TF. */
  display_number: string;
  outstanding: number;
  payment_due_at: string | null;
  selected: boolean;
  amount: number;
  /** Only for TF rows — number of Tagihans bundled, shown as badge. */
  tagihan_count?: number;
}

const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

type Method = 'CASH' | 'TRANSFER' | 'CHEQUE' | 'EDC';
const METHODS: Method[] = ['CASH', 'TRANSFER', 'CHEQUE', 'EDC'];

export default function PembayaranFormPage({ showToast, onCancel, onSaved, prefillSupplierId, prefillTfId }: Props) {
  const [supplier, setSupplier] = useState<DbSupplier | null>(null);
  const [supplierQuery, setSupplierQuery] = useState('');
  const [supplierResults, setSupplierResults] = useState<DbSupplier[]>([]);
  const [outstandingTagihan, setOutstandingTagihan] = useState<SuggestOutstandingTagihanRow[]>([]);
  const [outstandingTf, setOutstandingTf] = useState<SuggestOutstandingTukarFakturRow[]>([]);
  const [rows, setRows] = useState<SelectedRow[]>([]);
  const [loadingOutstanding, setLoadingOutstanding] = useState(false);
  // After prefillTfId-driven supplier resolution + outstanding load, we apply the
  // pre-check + scroll-into-view exactly once. Tracked via ref to survive re-renders
  // without retriggering.
  const prefillTfAppliedRef = useRef(false);
  const tfRowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  const [paidAt, setPaidAt] = useState(wibDateString());
  const [paymentMethod, setPaymentMethod] = useState<Method>('TRANSFER');
  const [accountLabel, setAccountLabel] = useState('');
  // Phase 0b dual-write: cash_accounts.id where the payment leaves from.
  // Required for GL post — passed as payload.account_id to record_pembayaran RPC.
  const [cashAccountId, setCashAccountId] = useState<string | null>(null);
  const [discount, setDiscount] = useState<number>(0);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Supplier search
  useEffect(() => {
    if (!supplierQuery || supplierQuery.length < 2) { setSupplierResults([]); return; }
    const t = setTimeout(async () => {
      const all = await supplierService.fetchAll();
      setSupplierResults(all.filter(s => s.name.toLowerCase().includes(supplierQuery.toLowerCase())).slice(0, 10));
    }, 200);
    return () => clearTimeout(t);
  }, [supplierQuery]);

  // Prefill supplier when supplierId provided
  useEffect(() => {
    if (!prefillSupplierId) return;
    (async () => {
      const all = await supplierService.fetchAll();
      const found = all.find(s => s.id === prefillSupplierId);
      if (found) setSupplier(found);
    })();
  }, [prefillSupplierId]);

  // Phase 2b: prefillTfId — resolve supplier from TF, then load outstanding.
  // The actual pre-check + scroll happens in a separate effect once `rows` settle.
  useEffect(() => {
    if (!prefillTfId || supplier || !supabase) return;
    (async () => {
      const { data, error } = await supabase
        .from('tukar_faktur')
        .select('supplier_id')
        .eq('id', prefillTfId)
        .maybeSingle();
      if (error || !data) {
        showToast('Tukar Faktur tidak ditemukan untuk pre-fill.', 'warning');
        return;
      }
      const all = await supplierService.fetchAll();
      const found = all.find(s => s.id === (data as { supplier_id: string }).supplier_id);
      if (found) setSupplier(found);
    })();
  }, [prefillTfId, supplier]);

  // Load outstanding (Tagihan + TF) when supplier changes
  useEffect(() => {
    if (!supplier) {
      setOutstandingTagihan([]);
      setOutstandingTf([]);
      setRows([]);
      return;
    }
    setLoadingOutstanding(true);
    (async () => {
      try {
        const data = await pembayaranService.suggestOutstanding(supplier.id);
        setOutstandingTagihan(data.tagihan);
        setOutstandingTf(data.tukar_faktur);
        const tagihanRows: SelectedRow[] = data.tagihan.map(t => ({
          kind: 'TAGIHAN',
          ref_id: t.id,
          display_number: t.pi_number,
          outstanding: t.outstanding,
          payment_due_at: t.payment_due_at,
          selected: false,
          amount: t.outstanding,
        }));
        const tfRows: SelectedRow[] = data.tukar_faktur.map(t => ({
          kind: 'TF',
          ref_id: t.id,
          display_number: t.tf_number,
          outstanding: t.outstanding,
          payment_due_at: t.payment_due_at,
          selected: false,
          amount: t.outstanding,
          tagihan_count: t.tagihan_count,
        }));
        setRows([...tagihanRows, ...tfRows]);
      } catch (e: any) {
        showToast(e?.message ?? 'Gagal load outstanding', 'warning');
      } finally {
        setLoadingOutstanding(false);
      }
    })();
  }, [supplier]);

  // Apply prefillTfId pre-check + scroll once rows are loaded.
  useEffect(() => {
    if (!prefillTfId || prefillTfAppliedRef.current) return;
    if (rows.length === 0) return;
    const idx = rows.findIndex(r => r.kind === 'TF' && r.ref_id === prefillTfId);
    if (idx === -1) return;
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, selected: true, amount: r.outstanding } : r));
    prefillTfAppliedRef.current = true;
    // Defer scroll until DOM updates with the highlighted row.
    setTimeout(() => {
      const node = tfRowRefs.current.get(prefillTfId);
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }, [rows, prefillTfId]);

  const runningTotal = useMemo(
    () => rows.filter(r => r.selected).reduce((a, r) => a + (Number(r.amount) || 0), 0),
    [rows],
  );
  const selectedCount = rows.filter(r => r.selected).length;
  const netTotal = Math.max(0, runningTotal - (Number(discount) || 0));

  function selectAll() {
    setRows(prev => prev.map(r => ({ ...r, selected: true, amount: r.outstanding })));
  }
  function selectJtThisWeek() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const cutoff = new Date(today.getTime() + 7 * 86400000);
    setRows(prev => prev.map(r => {
      if (!r.payment_due_at) return { ...r, selected: false };
      const d = new Date(r.payment_due_at + 'T00:00:00');
      const within = d.getTime() <= cutoff.getTime();
      return { ...r, selected: within, amount: within ? r.outstanding : r.amount };
    }));
  }
  function clearAll() {
    setRows(prev => prev.map(r => ({ ...r, selected: false })));
  }

  function updateRow(idx: number, patch: Partial<SelectedRow>) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  async function handleSubmit() {
    if (!supplier) { showToast('Pilih supplier dulu', 'warning'); return; }
    if (!cashAccountId) { showToast('Pilih akun sumber pembayaran (Kas/Bank)', 'warning'); return; }
    const selectedRows = rows.filter(r => r.selected);
    if (selectedRows.length === 0) { showToast('Pilih minimal 1 Tagihan / Tukar Faktur', 'warning'); return; }
    for (const r of selectedRows) {
      if (!r.amount || r.amount <= 0) {
        showToast(`Jumlah ${r.display_number} harus > 0`, 'warning');
        return;
      }
      if (r.amount > r.outstanding + 0.01) {
        showToast(`Jumlah ${r.display_number} (${fmtRp(r.amount)}) lebih dari sisa (${fmtRp(r.outstanding)})`, 'warning');
        return;
      }
    }
    // Discount validation — was silently accepting > running total or negative,
    // corrupting supplier ledger + GL posting on typo (e.g. 50000000 instead of
    // 50000). Cap at runningTotal and reject negative.
    const discountNum = Number(discount) || 0;
    if (discountNum < 0) {
      showToast('Diskon tidak boleh negatif', 'warning');
      return;
    }
    if (discountNum > runningTotal) {
      showToast(`Diskon (${fmtRp(discountNum)}) melebihi total bayar (${fmtRp(runningTotal)})`, 'warning');
      return;
    }

    setSaving(true);
    try {
      let proofUrl: string | undefined;
      if (proofFile) {
        proofUrl = await purchaseInvoiceService.uploadAttachment(proofFile, `payment-proofs/${supplier.id}`);
      }
      const payload: RecordPembayaranPayload = {
        supplier_id: supplier.id,
        paid_at: paidAt,
        payment_method: paymentMethod,
        account_id: cashAccountId ?? undefined,
        account_label: accountLabel || undefined,
        discount_amount: discount || 0,
        proof_url: proofUrl,
        notes: notes || undefined,
        // Each item is either a Tagihan or TF row — XOR enforced by DB CHECK.
        items: selectedRows.map(r => r.kind === 'TAGIHAN'
          ? { tagihan_id: r.ref_id, amount: r.amount }
          : { tukar_faktur_id: r.ref_id, amount: r.amount }),
      };
      const result = await pembayaranService.record(payload);
      showToast(`${result.pembayaran_number} dicatat. ${selectedRows.length} baris ter-update.`, 'success');
      onSaved(result.pembayaran_number);
    } catch (e: any) {
      showToast(e?.message ?? 'Gagal simpan Pembayaran', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <button onClick={onCancel} className="inline-flex items-center gap-1 hover:text-gray-800"><ArrowLeft className="w-3 h-3" /> Pembelian</button>
        <ChevronRight className="w-3 h-3" /><span>Pembayaran</span>
        <ChevronRight className="w-3 h-3" /><span className="text-gray-800 font-semibold">Catat Baru</span>
      </div>

      <h1 className="text-xl font-extrabold" style={{ color: '#012749' }}>Catat Pembayaran ke Supplier</h1>
      <p className="text-xs text-gray-500">1 Pembayaran bisa nutup banyak Tagihan sekaligus. Boleh bayar sebagian (partial).</p>

      {/* 1. Supplier */}
      <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">1. Supplier</div>
        {supplier ? (
          <div className="border-2 border-indigo-200 bg-indigo-50/40 rounded-xl p-3 flex items-center justify-between">
            <div>
              <div className="font-bold text-sm text-indigo-800">{supplier.name}</div>
              <div className="text-[11px] text-gray-600">Net {supplier.payment_term_days ?? 0} hari</div>
            </div>
            {!prefillSupplierId && (
              <button type="button" onClick={() => { setSupplier(null); setRows([]); }} className="text-xs text-indigo-600 font-semibold hover:underline">Ganti</button>
            )}
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

      {/* 2. Outstanding picker — Tagihan + Tukar Faktur sections (Phase 2b) */}
      {supplier && (
        <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-bold uppercase tracking-wide text-gray-500">2. Yang Dibayar</div>
            <div className="flex gap-2">
              <button type="button" onClick={selectAll}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100">
                Pilih Semua Outstanding
              </button>
              <button type="button" onClick={selectJtThisWeek}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100">
                Pilih JT ≤ 7 Hari
              </button>
              <button type="button" onClick={clearAll}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-white text-gray-600 border border-gray-200 hover:bg-gray-50">
                Reset
              </button>
            </div>
          </div>
          {loadingOutstanding ? (
            <div className="p-6 text-center text-sm text-gray-500">Memuat outstanding...</div>
          ) : (rows.length === 0) ? (
            <div className="p-6 text-center text-sm text-gray-500">Supplier ini tidak punya Tagihan / Tukar Faktur outstanding.</div>
          ) : (
            <div className="space-y-5">
              {/* --- Tagihan section --- */}
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-gray-600 mb-2">
                  Tagihan Outstanding <span className="text-gray-400 font-semibold">({outstandingTagihan.length})</span>
                </div>
                {outstandingTagihan.length === 0 ? (
                  <div className="text-xs text-gray-400 italic py-2">Tidak ada Tagihan loose (semua sudah ter-bundle ke TF atau lunas).</div>
                ) : (
                  <table className="w-full">
                    <thead className="border-b border-gray-200">
                      <tr>
                        <th className="w-8"></th>
                        <th className="text-left py-2 text-[11px] font-semibold text-gray-500 uppercase">Tagihan</th>
                        <th className="text-left py-2 text-[11px] font-semibold text-gray-500 uppercase">JT</th>
                        <th className="text-right py-2 text-[11px] font-semibold text-gray-500 uppercase">Sisa</th>
                        <th className="text-right py-2 w-40 text-[11px] font-semibold text-gray-500 uppercase">Bayar *</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, idx) => {
                        if (r.kind !== 'TAGIHAN') return null;
                        const overpay = r.selected && r.amount > r.outstanding + 0.01;
                        return (
                          <tr key={`tag-${r.ref_id}`} className={`border-b border-gray-100 ${r.selected ? 'bg-indigo-50/30' : ''}`}>
                            <td className="py-2 pl-2">
                              <input type="checkbox" checked={r.selected}
                                onChange={e => updateRow(idx, { selected: e.target.checked })}
                                className="w-4 h-4 accent-indigo-600" />
                            </td>
                            <td className="py-2">
                              <a
                                href={`${window.location.pathname}?tagihan=${encodeURIComponent(r.display_number)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Buka detail Tagihan di tab baru untuk final check"
                                className="font-bold text-sm text-indigo-800 hover:text-indigo-950 hover:underline decoration-dotted underline-offset-2"
                              >
                                {r.display_number}
                              </a>
                            </td>
                            <td className="py-2 text-xs text-gray-600">{fmtDate(r.payment_due_at)}</td>
                            <td className="py-2 text-right text-sm font-bold text-amber-700">{fmtRp(r.outstanding)}</td>
                            <td className="py-2">
                              <NumberInput disabled={!r.selected} value={r.amount}
                                onChange={n => updateRow(idx, { amount: n })}
                                className={`w-full text-sm text-right py-1 px-2 rounded-lg border ${overpay ? 'border-red-400 bg-red-50' : 'border-gray-200'} disabled:bg-gray-50 disabled:text-gray-400`} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* --- Tukar Faktur section --- */}
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-gray-600 mb-2 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-amber-700" />
                  Tukar Faktur Outstanding <span className="text-gray-400 font-semibold">({outstandingTf.length})</span>
                </div>
                {outstandingTf.length === 0 ? (
                  <div className="text-xs text-gray-400 italic py-2">Tidak ada Tukar Faktur outstanding untuk supplier ini.</div>
                ) : (
                  <table className="w-full">
                    <thead className="border-b border-gray-200">
                      <tr>
                        <th className="w-8"></th>
                        <th className="text-left py-2 text-[11px] font-semibold text-gray-500 uppercase">Tukar Faktur</th>
                        <th className="text-left py-2 text-[11px] font-semibold text-gray-500 uppercase">JT</th>
                        <th className="text-right py-2 text-[11px] font-semibold text-gray-500 uppercase">Sisa</th>
                        <th className="text-right py-2 w-40 text-[11px] font-semibold text-gray-500 uppercase">Bayar *</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, idx) => {
                        if (r.kind !== 'TF') return null;
                        const overpay = r.selected && r.amount > r.outstanding + 0.01;
                        const highlighted = prefillTfId === r.ref_id;
                        return (
                          <tr
                            key={`tf-${r.ref_id}`}
                            ref={node => {
                              if (node) tfRowRefs.current.set(r.ref_id, node);
                              else tfRowRefs.current.delete(r.ref_id);
                            }}
                            className={`border-b border-gray-100 ${r.selected ? 'bg-amber-50/40' : ''} ${highlighted ? 'ring-2 ring-amber-300 rounded' : ''}`}
                          >
                            <td className="py-2 pl-2">
                              <input type="checkbox" checked={r.selected}
                                onChange={e => updateRow(idx, { selected: e.target.checked })}
                                className="w-4 h-4 accent-amber-600" />
                            </td>
                            <td className="py-2">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-sm text-amber-800">{r.display_number}</span>
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                  {r.tagihan_count ?? 0} faktur
                                </span>
                              </div>
                            </td>
                            <td className="py-2 text-xs text-gray-600">{fmtDate(r.payment_due_at)}</td>
                            <td className="py-2 text-right text-sm font-bold text-amber-700">{fmtRp(r.outstanding)}</td>
                            <td className="py-2">
                              <NumberInput disabled={!r.selected} value={r.amount}
                                onChange={n => updateRow(idx, { amount: n })}
                                className={`w-full text-sm text-right py-1 px-2 rounded-lg border ${overpay ? 'border-red-400 bg-red-50' : 'border-gray-200'} disabled:bg-gray-50 disabled:text-gray-400`} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="flex justify-end pt-2 border-t border-gray-200">
                <div className="text-right">
                  <div className="text-[11px] font-semibold text-gray-500">SUBTOTAL ({selectedCount} baris)</div>
                  <div className="text-xl font-extrabold" style={{ color: '#012749' }}>{fmtRp(runningTotal)}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. Pembayaran */}
      {supplier && (
        <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">3. Detail Pembayaran</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Tanggal Bayar</label>
              <input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)}
                className="w-full text-sm py-2 px-3 rounded-xl border border-gray-300" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Metode Bayar</label>
              <div className="grid grid-cols-4 gap-2">
                {METHODS.map(m => (
                  <button key={m} type="button" onClick={() => setPaymentMethod(m)}
                    className={`text-xs font-bold py-2 rounded-lg border-2 ${
                      paymentMethod === m ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-600'
                    }`}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <CashAccountPicker
                value={cashAccountId}
                onChange={(id) => {
                  setCashAccountId(id);
                  // Backward-compat: keep account_label text in sync from picker selection.
                  // (Existing reports/exports may read account_label as display string.)
                  if (!id) setAccountLabel('');
                }}
                paymentMethod={paymentMethod === 'CASH' ? 'cash' : paymentMethod === 'TRANSFER' ? 'transfer' : paymentMethod === 'EDC' ? 'edc' : undefined}
                purposeFilter="business-only"
                label="Akun Sumber *"
              />
              <input
                value={accountLabel}
                onChange={e => setAccountLabel(e.target.value)}
                placeholder="Catatan tambahan akun (opsional)"
                className="mt-2 w-full text-[11px] py-1.5 px-2 rounded-lg border border-gray-200 text-gray-600"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Diskon (opsional)</label>
              <NumberInput value={discount} onChange={setDiscount}
                className="w-full text-sm py-2 px-3 rounded-xl border border-gray-300" />
              <div className="text-[11px] text-gray-500 mt-1">Misal supplier kasih potongan, isi di sini.</div>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Bukti Bayar (opsional)</label>
              <label className="flex items-center gap-2 px-3 py-2.5 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer text-xs text-gray-400 hover:border-indigo-300">
                <Upload className="w-4 h-4" />
                {proofFile ? proofFile.name : 'Klik untuk upload bukti transfer / nota'}
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setProofFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Catatan (opsional)</label>
              <input value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Misal: bayar 50% dulu, sisanya minggu depan"
                className="w-full text-sm py-2 px-3 rounded-xl border border-gray-300" />
            </div>
          </div>
        </div>
      )}

      {/* 4. Summary */}
      {supplier && selectedCount > 0 && (
        <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">4. Ringkasan</div>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-50 rounded-2xl p-4">
              <div className="text-[11px] text-gray-500 uppercase font-semibold">Subtotal ({selectedCount} baris)</div>
              <div className="text-xl font-extrabold mt-1" style={{ color: '#012749' }}>{fmtRp(runningTotal)}</div>
            </div>
            <div className="bg-amber-50 rounded-2xl p-4">
              <div className="text-[11px] text-amber-700 uppercase font-semibold">Diskon</div>
              <div className="text-xl font-extrabold mt-1 text-amber-700">{fmtRp(discount)}</div>
            </div>
            <div className="bg-indigo-50 rounded-2xl p-4">
              <div className="text-[11px] text-indigo-700 uppercase font-semibold">Net Dibayar</div>
              <div className="text-xl font-extrabold mt-1 text-indigo-700">{fmtRp(netTotal)}</div>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm font-semibold text-gray-600 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Batal</button>
        <button onClick={handleSubmit} disabled={saving || !supplier || selectedCount === 0}
          className="text-sm font-semibold text-white px-4 py-2 rounded-lg disabled:opacity-50"
          style={{ background: '#012749' }}>
          {saving ? 'Menyimpan...' : 'Catat Pembayaran'}
        </button>
      </div>
    </div>
  );
}
