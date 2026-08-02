import { useEffect, useMemo, useState } from 'react';
import type { DbSalesOrder, KasirTransaction } from '../../types';
import { formatRp } from '../../lib/format';
import { navigate } from '../../lib/urlRoute';
import { fetchSalesOrders, closeSalesOrder } from '../../lib/salesOrderService';
import SalesInvoicePDF, { type InvoicePrintMode } from './SalesInvoicePDF';
import { captureError } from '../../lib/captureError';
import { extractErrorMessage } from '../../lib/extractErrorMessage';

// Adapt DbSalesOrder → the KasirTransaction shape SalesInvoicePDF expects.
// Only fields used by variant='quotation' need to be populated; the rest are
// harmlessly undefined (SalesInvoicePDF gates on `isQuotation` before touching
// payment/DP/lunas fields).
function soToTransaction(so: DbSalesOrder): KasirTransaction {
  return {
    id: so.id,
    date: so.date,
    type: 'income',
    channel: so.channel as KasirTransaction['channel'],
    items: so.items,
    subtotal: Number(so.subtotal),
    hpp_total: 0,
    total_amount: Number(so.subtotal),
    invoice_number: so.so_number,
    customer_id: so.customer_id ?? null,
    customer_name: so.customer_name,
    customer_phone: so.customer_phone ?? null,
    customer_company: so.customer_company ?? null,
    notes: so.notes ?? null,
    created_at: so.created_at,
  };
}

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type StatusFilter = 'all' | 'OPEN' | 'CONVERTED' | 'CLOSED';

export default function DaftarPenawaranScreen({ showToast }: Props) {
  const [rows, setRows] = useState<DbSalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [closeModal, setCloseModal] = useState<{ so: DbSalesOrder; reason: string } | null>(null);
  const [closing, setClosing] = useState(false);
  const [viewSo, setViewSo] = useState<DbSalesOrder | null>(null);
  const [printSo, setPrintSo] = useState<{ so: DbSalesOrder; mode: InvoicePrintMode; autoPrint: boolean } | null>(null);

  const openPrintSo = (so: DbSalesOrder, mode: InvoicePrintMode) => {
    setPrintSo({ so, mode, autoPrint: true });
  };

  const reload = async () => {
    setLoading(true);
    try {
      const data = await fetchSalesOrders();
      setRows(data);
    } catch (err) {
      captureError(err, { feature: 'daftar_penawaran', action: 'fetch_sales_orders' });
      showToast(`Gagal load: ${extractErrorMessage(err)}`, 'warning');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); }, []);

  const counts = useMemo(() => {
    const open = rows.filter((r) => r.status === 'OPEN');
    const converted = rows.filter((r) => r.status === 'CONVERTED');
    const closed = rows.filter((r) => r.status === 'CLOSED');
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentConv = converted.filter((r) => new Date(r.created_at).getTime() >= sevenDaysAgo);
    const recentClosed = closed.filter((r) => new Date(r.created_at).getTime() >= sevenDaysAgo);
    const decided = recentConv.length + recentClosed.length;
    const rate = decided > 0 ? Math.round((recentConv.length / decided) * 100) : 0;
    return {
      open: open.length,
      openTotal: open.reduce((s, r) => s + Number(r.subtotal), 0),
      convertedTotal: recentConv.reduce((s, r) => s + Number(r.subtotal), 0),
      converted: recentConv.length,
      closed: recentClosed.length,
      rate,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rows;
    if (tab !== 'all') out = out.filter((r) => r.status === tab);
    if (search.trim().length > 0) {
      const q = search.toLowerCase();
      out = out.filter((r) =>
        r.so_number.toLowerCase().includes(q)
        || r.customer_name.toLowerCase().includes(q)
        || (r.customer_phone ?? '').toLowerCase().includes(q)
      );
    }
    return out;
  }, [rows, tab, search]);

  const onConvert = (so: DbSalesOrder) => {
    if (so.status !== 'OPEN') {
      showToast(`SO sudah ${so.status}. Tidak bisa di-convert.`, 'warning');
      return;
    }
    navigate('penjualanBaru', { fromSo: so.id });
  };

  const onCloseSubmit = async () => {
    if (!closeModal || closeModal.reason.trim().length === 0) return;
    setClosing(true);
    try {
      await closeSalesOrder(closeModal.so.id, closeModal.reason);
      showToast(`SO ${closeModal.so.so_number} ditutup`, 'success');
      setCloseModal(null);
      await reload();
    } catch (err) {
      captureError(err, { feature: 'daftar_penawaran', action: 'close_sales_order', soId: closeModal.so.id });
      showToast(`Gagal tutup: ${extractErrorMessage(err)}`, 'warning');
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6">
      <div className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-extrabold text-[var(--color-caleo-primary)]">Daftar Penawaran</h1>
            <p className="text-xs text-slate-500 mt-0.5">Sales Order ke customer. Belum commit · stok belum bergerak.</p>
          </div>
          <button onClick={() => navigate('penjualanBaru', { mode: 'quote' })}
            className="px-4 py-1.5 text-xs font-bold rounded bg-[var(--color-caleo-primary)] text-white hover:opacity-90">
            + Sales Order Baru
          </button>
        </div>

        {/* Summary cards */}
        <div className="px-6 pt-5 grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="bg-amber-50 border border-amber-200 rounded p-3">
            <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">SO Open</div>
            <div className="text-lg font-extrabold text-amber-900 mt-1">{counts.open}</div>
            <div className="text-[11px] text-amber-700">{formatRp(counts.openTotal)} total</div>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
            <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Converted (7 hari)</div>
            <div className="text-lg font-extrabold text-emerald-900 mt-1">{counts.converted}</div>
            <div className="text-[11px] text-emerald-700">{formatRp(counts.convertedTotal)} menjadi SI</div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded p-3">
            <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Closed (7 hari)</div>
            <div className="text-lg font-extrabold text-slate-700 mt-1">{counts.closed}</div>
            <div className="text-[11px] text-slate-500">Lost deal</div>
          </div>
          <div className="bg-white border border-slate-200 rounded p-3">
            <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Conversion Rate</div>
            <div className="text-lg font-extrabold text-[var(--color-caleo-primary)] mt-1">{counts.rate}%</div>
            <div className="text-[11px] text-slate-500">{counts.converted} dari {counts.converted + counts.closed} decided</div>
          </div>
        </div>

        {/* Tabs + search */}
        <div className="px-6 pt-5 flex items-center justify-between flex-wrap gap-2">
          <div className="flex gap-1 bg-slate-100 p-1 rounded">
            {(['all', 'OPEN', 'CONVERTED', 'CLOSED'] as const).map((t) => {
              const label = t === 'all' ? 'Semua' : t === 'OPEN' ? 'Open' : t === 'CONVERTED' ? 'Converted' : 'Closed';
              const count = t === 'all' ? rows.length : rows.filter((r) => r.status === t).length;
              return (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-3 py-1.5 text-xs font-bold rounded ${tab === t ? 'bg-white text-[var(--color-caleo-primary)] shadow-sm' : 'text-slate-600 hover:bg-white/50'}`}>
                  {label} ({count})
                </button>
              );
            })}
          </div>
          <input type="text" placeholder="Cari nomor SO / customer / HP..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="text-xs px-3 py-1.5 border border-slate-300 rounded w-64" />
        </div>

        {/* Table */}
        <div className="px-6 py-4">
          {loading ? (
            <p className="text-center text-slate-400 py-8 text-sm">Memuat...</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-slate-400 py-8 text-sm">Tidak ada Sales Order.</p>
          ) : (
            <div className="border border-slate-200 rounded overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-left">SO Number</th>
                    <th className="px-4 py-2 text-left">Customer</th>
                    <th className="px-4 py-2 text-right">Total</th>
                    <th className="px-4 py-2 text-left">Tanggal</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-left">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className={`border-t border-slate-100 ${r.status === 'CONVERTED' ? 'bg-emerald-50/30' : r.status === 'CLOSED' ? 'bg-slate-50/50' : ''}`}>
                      <td className="px-4 py-3 font-bold text-[var(--color-caleo-primary)]">{r.so_number}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold">{r.customer_name}</div>
                        <div className="text-[11px] text-slate-500">{r.customer_phone ?? '—'} · {r.channel}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-[var(--color-caleo-primary)]">{formatRp(Number(r.subtotal))}</td>
                      <td className="px-4 py-3 text-slate-500">{new Date(r.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          r.status === 'OPEN' ? 'bg-amber-100 text-amber-800'
                          : r.status === 'CONVERTED' ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-200 text-slate-600'
                        }`}>{r.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          <button onClick={() => setViewSo(r)}
                            className="px-2.5 py-1 text-[10px] font-bold rounded bg-slate-100 border border-slate-300 text-slate-700 hover:bg-slate-200">
                            Lihat
                          </button>
                          {r.status === 'OPEN' && (
                            <>
                              <button onClick={() => onConvert(r)}
                                className="px-2.5 py-1 text-[10px] font-bold rounded bg-[#2d8a4e] text-white hover:bg-[#236b3d]">
                                → Jadi Sales Invoice
                              </button>
                              {/* Spacer prevents accidental clicks between the primary green Convert
                                  button and the destructive Batal (Lost Deal) button — same row,
                                  opposite intents. Button label is explicit about outcome ("Lost") to
                                  distinguish from "Tutup" which readers may misread as "close the modal". */}
                              <span className="w-3" aria-hidden="true" />
                              <button onClick={() => setCloseModal({ so: r, reason: '' })}
                                title="Tandai SO sebagai LOST — customer batal / pilih supplier lain. Tidak bisa di-reopen."
                                className="px-2.5 py-1 text-[10px] font-bold rounded bg-white border border-rose-300 text-rose-700 hover:bg-rose-50">
                                ✕ Batal (Lost)
                              </button>
                            </>
                          )}
                          {r.status === 'CLOSED' && r.closed_reason && (
                            <span className="text-[10px] text-slate-500 italic">Lost: {r.closed_reason}</span>
                          )}
                          {r.status === 'CONVERTED' && r.converted_to_kasir_tx_id && (
                            <span className="text-[10px] font-bold text-emerald-700">→ {r.converted_to_kasir_tx_id.slice(0, 8)}</span>
                          )}
                          {r.status === 'CONVERTED' && r.converted_to_order_id && (
                            <span className="text-[10px] font-bold text-emerald-700">→ TEMPO {r.converted_to_order_id.slice(0, 8)}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-slate-500 mt-3 italic">
            💡 SO yang sudah CLOSED tidak bisa di-reopen — bikin SO baru kalau customer berubah pikiran.
          </p>
        </div>
      </div>

      {/* SO summary modal (Lihat) */}
      {viewSo && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            {/* Modal header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-base font-extrabold text-[var(--color-caleo-primary)]">{viewSo.so_number}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  viewSo.status === 'OPEN' ? 'bg-amber-100 text-amber-800'
                  : viewSo.status === 'CONVERTED' ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-200 text-slate-600'
                }`}>{viewSo.status}</span>
              </div>
              <button onClick={() => setViewSo(null)} className="text-slate-400 hover:text-slate-600 text-lg font-bold">✕</button>
            </div>

            {/* Modal body */}
            <div className="px-6 py-4 space-y-4">
              {/* Channel + customer */}
              <div className="bg-slate-50 rounded p-3 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 font-semibold">Channel</span>
                  <span className="font-bold text-slate-700">{viewSo.channel}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 font-semibold">Customer</span>
                  <span className="font-bold text-slate-700">{viewSo.customer_name}</span>
                </div>
                {viewSo.customer_phone && (
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 font-semibold">HP</span>
                    <span className="text-slate-700">{viewSo.customer_phone}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 font-semibold">Tanggal</span>
                  <span className="text-slate-700">{new Date(viewSo.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                </div>
              </div>

              {/* Items table */}
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Item</div>
                <div className="border border-slate-200 rounded overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-3 py-1.5 text-left">SKU</th>
                        <th className="px-3 py-1.5 text-left">Nama</th>
                        <th className="px-3 py-1.5 text-right">Qty</th>
                        <th className="px-3 py-1.5 text-right">Harga</th>
                        <th className="px-3 py-1.5 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewSo.items.map((item, idx) => (
                        <tr key={idx} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-slate-400">{item.sku ?? '—'}</td>
                          <td className="px-3 py-2 font-semibold text-slate-700">{item.name}</td>
                          <td className="px-3 py-2 text-right text-slate-600">{item.qty}</td>
                          <td className="px-3 py-2 text-right text-slate-600">{formatRp(item.unit_price)}</td>
                          <td className="px-3 py-2 text-right font-bold text-[var(--color-caleo-primary)]">{formatRp(item.subtotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Subtotal row */}
                <div className="flex justify-between text-xs font-bold text-[var(--color-caleo-primary)] px-1 mt-2">
                  <span>TOTAL PENAWARAN</span>
                  <span>{formatRp(Number(viewSo.subtotal))}</span>
                </div>
                <div className="text-[10px] text-slate-400 italic px-1 mt-0.5">Belum termasuk ongkir</div>
              </div>

              {/* Notes */}
              {viewSo.notes && (
                <div className="bg-slate-50 rounded p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Catatan</div>
                  <p className="text-xs text-slate-700 whitespace-pre-wrap">{viewSo.notes}</p>
                </div>
              )}

              {/* CONVERTED info */}
              {viewSo.status === 'CONVERTED' && (viewSo.converted_to_kasir_tx_id || viewSo.converted_to_order_id) && (
                <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 mb-1">Konversi ke</div>
                  {viewSo.converted_to_kasir_tx_id && (
                    <p className="text-xs font-bold text-emerald-800">{viewSo.converted_to_kasir_tx_id}</p>
                  )}
                  {viewSo.converted_to_order_id && (
                    <p className="text-xs font-bold text-emerald-800">TEMPO: {viewSo.converted_to_order_id}</p>
                  )}
                </div>
              )}

              {/* CLOSED info */}
              {viewSo.status === 'CLOSED' && viewSo.closed_reason && (
                <div className="bg-slate-100 border border-slate-200 rounded p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Alasan Tutup</div>
                  <p className="text-xs text-slate-700">{viewSo.closed_reason}</p>
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="px-6 py-4 border-t border-slate-200 flex justify-between items-center gap-2 flex-wrap">
              <div className="flex gap-2">
                <button
                  onClick={() => openPrintSo(viewSo, 'normal')}
                  className="px-3 py-1.5 text-xs font-bold rounded bg-[var(--color-caleo-primary)] text-white hover:opacity-90"
                >
                  🖨️ Cetak A4
                </button>
                <button
                  onClick={() => openPrintSo(viewSo, 'dot_matrix')}
                  className="px-3 py-1.5 text-xs font-bold rounded bg-slate-700 text-white hover:bg-slate-800"
                >
                  🖨️ Dot Matrix
                </button>
              </div>
              <button onClick={() => setViewSo(null)}
                className="px-4 py-1.5 text-xs font-semibold rounded bg-slate-100 text-slate-700 hover:bg-slate-200">
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close modal — labelled as "Batalkan (Lost)" because "Tutup" is
          ambiguous with the modal-close semantic. This action marks the SO
          as a lost deal — customer walked away, and the record stays for
          conversion-rate reporting. Different from "Converted" which means
          the SO became a Sales Invoice; different from deletion (SOs never
          get deleted — audit trail). */}
      {closeModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl p-6 max-w-md w-full">
            <div className="text-lg font-extrabold text-rose-700 mb-1">Batalkan Sales Order (Lost Deal)</div>
            <div className="text-[11px] text-slate-500 mb-3">
              Bukan sama dengan &ldquo;Jadi Sales Invoice&rdquo; — pastikan Anda memilih yang benar.
            </div>
            <div className="text-xs text-slate-700 mb-4 bg-rose-50 border border-rose-200 rounded p-3">
              SO <strong>{closeModal.so.so_number}</strong> akan ditandai <strong>CLOSED (Lost)</strong>.
              Customer dianggap batal / pilih supplier lain. Operasi ini <strong>tidak bisa di-undo</strong>;
              kalau customer berubah pikiran, bikin SO baru.
            </div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Alasan Lost <span className="text-red-500">*</span></label>
            <textarea rows={3}
              value={closeModal.reason}
              onChange={(e) => setCloseModal({ ...closeModal, reason: e.target.value })}
              placeholder="Mis: customer pilih supplier lain, harga tidak match, scope berubah, dll."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded" />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setCloseModal(null)} disabled={closing}
                className="px-3 py-1.5 text-xs font-semibold rounded text-slate-600 hover:bg-slate-100 disabled:opacity-50">Kembali</button>
              <button onClick={onCloseSubmit}
                disabled={closing || closeModal.reason.trim().length === 0}
                className="px-4 py-1.5 text-xs font-bold rounded bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
                {closing ? 'Membatalkan…' : '✕ Batalkan SO (Lost)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print SO preview modal */}
      {printSo && (
        <SalesInvoicePDF
          transaction={soToTransaction(printSo.so)}
          variant="quotation"
          autoPrint={printSo.autoPrint}
          printMode={printSo.mode}
          onClose={() => setPrintSo(null)}
        />
      )}
    </div>
  );
}
