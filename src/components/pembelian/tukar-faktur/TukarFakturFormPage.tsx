// Tukar Faktur Form (create-only).
// Search-and-add UX per spec §8 + mockup Layar 1-2:
//   1. Pick supplier → JT auto-fill Net N
//   2. Search Faktur Pembelian outstanding (supplier-scoped) → click to add
//   3. "Tidak ada? Buat Tagihan baru" → opens TfQuickAddTagihanModal
//   4. Selected items table with × remove per row
//   5. 2-tile Ringkasan
// Edit-header lives on Detail page (Q3 split actions).
import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Plus, X, Search, Layers, Sparkles } from 'lucide-react';
import { tukarFakturService } from '../../../lib/tukarFakturService';
import { supplierService } from '../../../lib/pembelianService';
import type {
  DbSupplier,
  RecordTukarFakturPayload,
  TfQuickAddTagihanDraft,
} from '../../../types';
import TfQuickAddTagihanModal from './TfQuickAddTagihanModal';
import { wibDateString } from '../../../lib/format';
import { formatIDR } from '../../../lib/formatIDR';

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onCancel: () => void;
  onSaved: (tf_number: string) => void;
  /** Pre-fill supplier picker (from secondary entry on Tagihan Detail). */
  prefillSupplierId?: string;
  /** Pre-select an outstanding Tagihan (from `?prefill_tagihan=<id>`). */
  prefillTagihanId?: string;
}

interface SelectedRow {
  /** Existing Tagihan id (uuid) or synthetic local id for quick-add drafts. */
  id: string;
  pi_number: string;
  supplier_invoice_number: string | null;
  purchase_date: string;
  payment_due_at: string;
  total: number;
  isQuickAdd: boolean;
  /** Only set when isQuickAdd=true; preserved so we can serialize payload. */
  quickAddDraft?: TfQuickAddTagihanDraft;
}

interface OutstandingTagihanRow {
  id: string;
  pi_number: string;
  supplier_invoice_number: string | null;
  purchase_date: string;
  payment_due_at: string;
  total: number;
  paid_amount: number;
}

const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function TukarFakturFormPage({
  showToast,
  onCancel,
  onSaved,
  prefillSupplierId,
  prefillTagihanId,
}: Props) {
  const today = wibDateString();

  const [supplier, setSupplier] = useState<DbSupplier | null>(null);
  const [supplierQuery, setSupplierQuery] = useState('');
  const [supplierResults, setSupplierResults] = useState<DbSupplier[]>([]);
  const [tukarDate, setTukarDate] = useState(today);
  const [paymentDueAt, setPaymentDueAt] = useState('');
  const [notes, setNotes] = useState('');
  const [selected, setSelected] = useState<SelectedRow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [outstanding, setOutstanding] = useState<OutstandingTagihanRow[]>([]);
  const [outstandingLoading, setOutstandingLoading] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prefillApplied, setPrefillApplied] = useState(false);

  // Auto-fill JT when supplier picked
  useEffect(() => {
    if (!supplier) {
      setPaymentDueAt('');
      return;
    }
    const due = new Date();
    due.setDate(due.getDate() + (supplier.payment_term_days || 30));
    setPaymentDueAt(wibDateString(due));
  }, [supplier]);

  // Reload outstanding list whenever supplier or selected ids change
  useEffect(() => {
    if (!supplier) {
      setOutstanding([]);
      return;
    }
    let cancelled = false;
    setOutstandingLoading(true);
    const excludeIds = selected.filter(s => !s.isQuickAdd).map(s => s.id);
    tukarFakturService
      .fetchOutstandingTagihansForTf(supplier.id, excludeIds)
      .then(rows => {
        if (!cancelled) setOutstanding(rows as OutstandingTagihanRow[]);
      })
      .catch(e => {
        if (!cancelled) showToast(e instanceof Error ? e.message : 'Gagal load outstanding Tagihan', 'warning');
      })
      .finally(() => {
        if (!cancelled) setOutstandingLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier?.id, selected.length]);

  // Supplier search debounce
  useEffect(() => {
    if (!supplierQuery || supplierQuery.length < 2) {
      setSupplierResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const all = await supplierService.fetchAll();
      setSupplierResults(
        all.filter(s => s.name.toLowerCase().includes(supplierQuery.toLowerCase())).slice(0, 10),
      );
    }, 200);
    return () => clearTimeout(t);
  }, [supplierQuery]);

  // Apply prefill once
  useEffect(() => {
    if (prefillApplied) return;
    if (!prefillSupplierId && !prefillTagihanId) {
      setPrefillApplied(true);
      return;
    }
    (async () => {
      try {
        if (prefillSupplierId) {
          const all = await supplierService.fetchAll();
          const s = all.find(x => x.id === prefillSupplierId);
          if (s) setSupplier(s);
        }
        if (prefillTagihanId) {
          // Will be added once supplier is set; need to fetch the tagihan first
          // to figure out which supplier it belongs to.
          const { supabase } = await import('../../../lib/supabaseClient');
          if (!supabase) throw new Error('Supabase not configured');
          const { data } = await supabase
            .from('purchase_invoices')
            .select(
              'id, pi_number, supplier_invoice_number, purchase_date, payment_due_at, total, supplier_id, tukar_faktur_id, status, voided_at',
            )
            .eq('id', prefillTagihanId)
            .maybeSingle();
          if (!data) {
            showToast('Tagihan tidak ditemukan untuk prefill', 'warning');
          } else if (data.tukar_faktur_id) {
            showToast('Tagihan sudah ter-bundle di TF lain', 'warning');
          } else if (data.voided_at) {
            showToast('Tagihan sudah di-void', 'warning');
          } else if (data.status === 'LUNAS') {
            showToast('Tagihan sudah LUNAS', 'warning');
          } else {
            const all = await supplierService.fetchAll();
            const s = all.find(x => x.id === data.supplier_id);
            if (s && !prefillSupplierId) setSupplier(s);
            setSelected([
              {
                id: data.id,
                pi_number: data.pi_number,
                supplier_invoice_number: data.supplier_invoice_number,
                purchase_date: data.purchase_date,
                payment_due_at: data.payment_due_at,
                total: Number(data.total),
                isQuickAdd: false,
              },
            ]);
          }
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Gagal apply prefill', 'warning');
      } finally {
        setPrefillApplied(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillSupplierId, prefillTagihanId]);

  const searchMatches = useMemo(() => {
    if (!supplier) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return outstanding.slice(0, 8);
    return outstanding
      .filter(t => {
        return (
          t.pi_number.toLowerCase().includes(q) ||
          (t.supplier_invoice_number ?? '').toLowerCase().includes(q)
        );
      })
      .slice(0, 8);
  }, [supplier, searchQuery, outstanding]);

  const totalBundle = useMemo(
    () => selected.reduce((a, r) => a + Number(r.total || 0), 0),
    [selected],
  );

  function handleAddOutstanding(row: OutstandingTagihanRow) {
    setSelected(prev => {
      if (prev.some(s => s.id === row.id)) return prev;
      return [
        ...prev,
        {
          id: row.id,
          pi_number: row.pi_number,
          supplier_invoice_number: row.supplier_invoice_number,
          purchase_date: row.purchase_date,
          payment_due_at: row.payment_due_at,
          total: Number(row.total),
          isQuickAdd: false,
        },
      ];
    });
    setSearchQuery('');
  }

  function handleQuickAddSave(draft: TfQuickAddTagihanDraft) {
    const localId = 'quick-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    setSelected(prev => [
      ...prev,
      {
        id: localId,
        pi_number: '(baru)',
        supplier_invoice_number: draft.supplier_invoice_number,
        purchase_date: draft.purchase_date,
        payment_due_at: draft.payment_due_at,
        total: draft.total,
        isQuickAdd: true,
        quickAddDraft: draft,
      },
    ]);
    setShowQuickAdd(false);
    setSearchQuery('');
  }

  function handleRemove(id: string) {
    setSelected(prev => prev.filter(s => s.id !== id));
  }

  function handleResetSupplier() {
    setSupplier(null);
    setSelected([]);
    setSearchQuery('');
    setOutstanding([]);
  }

  async function handleSubmit() {
    if (!supplier) {
      showToast('Pilih supplier dulu', 'warning');
      return;
    }
    if (selected.length === 0) {
      showToast('Tambah minimal 1 Faktur ke bundle', 'warning');
      return;
    }
    if (!tukarDate || !paymentDueAt) {
      showToast('Tanggal & JT wajib di-isi', 'warning');
      return;
    }
    setSaving(true);
    try {
      const payload: RecordTukarFakturPayload = {
        supplier_id: supplier.id,
        tukar_date: tukarDate,
        payment_due_at: paymentDueAt,
        tagihan_ids: selected.filter(s => !s.isQuickAdd).map(s => s.id),
        quick_add_tagihans: selected
          .filter(s => s.isQuickAdd && s.quickAddDraft)
          .map(s => s.quickAddDraft as TfQuickAddTagihanDraft),
        notes: notes.trim() || undefined,
      };
      const result = await tukarFakturService.record(payload);
      showToast(`${result.tf_number} dibuat (${selected.length} Faktur).`, 'success');
      onSaved(result.tf_number);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : 'Gagal simpan Tukar Faktur');
      if (msg.includes('same_supplier_violation')) {
        showToast('Ada Faktur dari supplier lain — tidak bisa di-bundle.', 'warning');
      } else if (msg.includes('tagihan_already_bundled')) {
        showToast('Ada Faktur yang sudah ter-bundle di TF lain.', 'warning');
      } else {
        showToast(msg, 'warning');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span>Pembelian</span>
        <ChevronRight className="w-3 h-3" />
        <span>Tukar Faktur</span>
        <ChevronRight className="w-3 h-3" />
        <span className="text-gray-800 font-semibold">Buat Baru</span>
      </div>

      <h1 className="text-xl font-extrabold" style={{ color: 'var(--color-caleo-primary)' }}>
        Buat Tukar Faktur
      </h1>
      <p className="text-xs text-gray-500">
        Bundle beberapa Tagihan dari 1 supplier untuk ritual tukar faktur fisik + pembayaran kolektif.
      </p>

      {/* 1. Header */}
      <div className="bg-white/78 backdrop-blur-xl rounded-sm border border-gray-200 shadow-sm p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">1. Header</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">
              Supplier <span className="text-red-500">*</span>
            </label>
            {supplier ? (
              <div className="border-2 border-gray-300 rounded-sm p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm">{supplier.name}</div>
                  <div className="text-[11px] text-gray-500">
                    Net {supplier.payment_term_days ?? 0} hari
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleResetSupplier}
                  className="text-xs text-indigo-600 font-semibold hover:underline"
                >
                  Ganti
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  value={supplierQuery}
                  onChange={e => setSupplierQuery(e.target.value)}
                  placeholder="Cari supplier..."
                  className="w-full text-sm py-2 px-3 rounded-sm border border-gray-300 focus:outline-none focus:border-indigo-500"
                />
                {supplierResults.length > 0 && (
                  <div className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-auto bg-white rounded-sm border border-gray-200 shadow-lg">
                    {supplierResults.map(s => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setSupplier(s);
                          setSupplierQuery('');
                          setSupplierResults([]);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-gray-100 last:border-0"
                      >
                        <div className="font-semibold text-sm">{s.name}</div>
                        <div className="text-[11px] text-gray-500">
                          Net {s.payment_term_days} hari
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">
              Tanggal Tukar Faktur <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={tukarDate}
              onChange={e => setTukarDate(e.target.value)}
              className="w-full text-sm py-2 px-3 rounded-sm border border-gray-300 focus:outline-none focus:border-indigo-500"
            />
            <div className="text-[11px] text-gray-500 mt-1">
              Tanggal sales rep datang & serahkan faktur fisik.
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">
              JT Pembayaran Bundle <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={paymentDueAt}
              onChange={e => setPaymentDueAt(e.target.value)}
              className="w-full text-sm py-2 px-3 rounded-sm border border-gray-300 focus:outline-none focus:border-indigo-500"
            />
            <div className="text-[11px] text-gray-500 mt-1">
              {supplier
                ? `Auto-fill Net ${supplier.payment_term_days ?? 0} hari dari tanggal hari ini. JT TF meng-override JT asli per-Faktur.`
                : 'Pilih supplier dulu untuk auto-fill.'}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Catatan (opsional)</label>
            <input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Misal: ritual Rabu PT Eterna"
              className="w-full text-sm py-2 px-3 rounded-sm border border-gray-300 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
      </div>

      {/* 2. Daftar Faktur */}
      <div className="bg-white/78 backdrop-blur-xl rounded-sm border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500">
            2. Daftar Faktur Pembelian
          </div>
          <div className="text-[11px] text-gray-500">
            {selected.length} Faktur ter-pilih
          </div>
        </div>

        {!supplier ? (
          <div className="p-6 text-center text-sm text-gray-400 border border-dashed border-gray-200 rounded-sm">
            Pilih supplier dulu untuk mulai cari Faktur outstanding.
          </div>
        ) : (
          <>
            <div className="relative">
              <div className="flex items-center gap-2 bg-white border border-gray-300 rounded-sm px-3 py-2">
                <Search className="w-4 h-4 text-gray-400" />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Cari nomor faktur (PI atau dari supplier)..."
                  className="flex-1 text-sm outline-none"
                />
                {outstandingLoading && (
                  <span className="text-[10px] text-gray-400">Memuat...</span>
                )}
              </div>
              {(searchQuery.length > 0 || searchMatches.length > 0) && (
                <div className="absolute z-20 left-0 right-0 mt-1 bg-white rounded-sm border border-gray-200 shadow-lg max-h-80 overflow-auto">
                  {searchMatches.length === 0 ? (
                    <div className="p-3 text-xs text-gray-500">
                      Tidak ada Faktur outstanding cocok.
                    </div>
                  ) : (
                    searchMatches.map(t => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => handleAddOutstanding(t)}
                        className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-gray-100 last:border-0"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-semibold text-sm" style={{ color: 'var(--color-caleo-primary)' }}>
                              {t.pi_number}
                              {t.supplier_invoice_number && (
                                <span className="text-gray-500 font-normal ml-2">
                                  · {t.supplier_invoice_number}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-gray-500">
                              Tgl {fmtDate(t.purchase_date)} · JT {fmtDate(t.payment_due_at)}
                            </div>
                          </div>
                          <div className="text-sm font-bold" style={{ color: 'var(--color-caleo-primary)' }}>
                            {formatIDR(Number(t.total))}
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                  <button
                    type="button"
                    onClick={() => setShowQuickAdd(true)}
                    className="w-full text-left px-3 py-2.5 bg-sky-50 hover:bg-sky-100 border-t border-sky-200 text-sm font-semibold text-sky-800 flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" /> Tidak ada? Buat Tagihan baru
                  </button>
                </div>
              )}
            </div>

            {selected.length > 0 && (
              <div className="mt-4 border border-gray-200 rounded-sm overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-2 text-[11px] font-semibold text-gray-500 uppercase">
                        Faktur
                      </th>
                      <th className="text-center px-4 py-2 text-[11px] font-semibold text-gray-500 uppercase">
                        Tgl
                      </th>
                      <th className="text-center px-4 py-2 text-[11px] font-semibold text-gray-500 uppercase">
                        JT Asli
                      </th>
                      <th className="text-right px-4 py-2 text-[11px] font-semibold text-gray-500 uppercase">
                        Nominal
                      </th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.map(s => (
                      <tr key={s.id} className="border-b border-gray-100 last:border-0">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="font-semibold text-sm" style={{ color: 'var(--color-caleo-primary)' }}>
                              {s.isQuickAdd ? s.supplier_invoice_number : s.pi_number}
                            </div>
                            {!s.isQuickAdd && s.supplier_invoice_number && (
                              <span className="text-[11px] text-gray-500">
                                · {s.supplier_invoice_number}
                              </span>
                            )}
                            {s.isQuickAdd && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 inline-flex items-center gap-1">
                                <Sparkles className="w-3 h-3" /> Baru
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center text-xs text-gray-600">
                          {fmtDate(s.purchase_date)}
                        </td>
                        <td className="px-4 py-3 text-center text-xs text-gray-600">
                          {fmtDate(s.payment_due_at)}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-bold">
                          {formatIDR(s.total)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemove(s.id)}
                            className="text-gray-400 hover:text-red-500"
                            title="Lepas dari bundle"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* 3. Ringkasan */}
      <div className="bg-white/78 backdrop-blur-xl rounded-sm border border-gray-200 shadow-sm p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">3. Ringkasan</div>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-amber-50 rounded-sm p-4 border border-amber-100">
            <div className="text-[11px] text-amber-700 uppercase font-semibold flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" /> JT Bayar Bundle
            </div>
            <div className="text-xl font-extrabold mt-1 text-amber-700">
              {paymentDueAt ? fmtDate(paymentDueAt) : '—'}
            </div>
            <div className="text-[11px] text-amber-700/80 mt-1">
              Override JT asli semua Faktur dalam bundle.
            </div>
          </div>
          <div className="bg-indigo-50 rounded-sm p-4 border border-indigo-100">
            <div className="text-[11px] text-indigo-600 uppercase font-semibold">Total Bundle</div>
            <div className="text-xl font-extrabold mt-1 text-indigo-700">{formatIDR(totalBundle)}</div>
            <div className="text-[11px] text-indigo-700/80 mt-1">
              {selected.length} Faktur
              {selected.some(s => s.isQuickAdd)
                ? ` (${selected.filter(s => s.isQuickAdd).length} quick-add)`
                : ''}
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="text-sm font-semibold text-gray-600 px-4 py-2 rounded-sm border border-gray-200 hover:bg-gray-50"
        >
          Batal
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving || !supplier || selected.length === 0}
          className="text-sm font-semibold text-white px-4 py-2 rounded-sm disabled:opacity-50"
          style={{ background: 'var(--color-caleo-primary)' }}
        >
          {saving ? 'Menyimpan...' : 'Simpan Tukar Faktur'}
        </button>
      </div>

      {showQuickAdd && supplier && (
        <TfQuickAddTagihanModal
          prefillSupplierInvoice={searchQuery}
          defaultPaymentTermDays={supplier.payment_term_days ?? 30}
          onCancel={() => setShowQuickAdd(false)}
          onSave={handleQuickAddSave}
        />
      )}
    </div>
  );
}
