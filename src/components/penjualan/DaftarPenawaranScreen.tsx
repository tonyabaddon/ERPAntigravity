import { useEffect, useMemo, useState } from 'react';
import type { DbSalesOrder } from '../../types';
import { formatRp } from '../../lib/format';
import { navigate } from '../../lib/urlRoute';
import { fetchSalesOrders, closeSalesOrder } from '../../lib/salesOrderService';

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

  const reload = async () => {
    setLoading(true);
    try {
      const data = await fetchSalesOrders();
      setRows(data);
    } catch (err) {
      showToast(`Gagal load: ${err instanceof Error ? err.message : String(err)}`, 'warning');
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
      showToast(`Gagal tutup: ${err instanceof Error ? err.message : String(err)}`, 'warning');
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-extrabold text-[#012749]">Daftar Penawaran</h1>
            <p className="text-xs text-slate-500 mt-0.5">Sales Order ke customer. Belum commit · stok belum bergerak.</p>
          </div>
          <button onClick={() => navigate('penjualanBaru', { mode: 'quote' })}
            className="px-4 py-1.5 text-xs font-bold rounded-lg bg-[#012749] text-white hover:opacity-90">
            + Sales Order Baru
          </button>
        </div>

        {/* Summary cards */}
        <div className="px-6 pt-5 grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">SO Open</div>
            <div className="text-lg font-extrabold text-amber-900 mt-1">{counts.open}</div>
            <div className="text-[11px] text-amber-700">{formatRp(counts.openTotal)} total</div>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
            <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Converted (7 hari)</div>
            <div className="text-lg font-extrabold text-emerald-900 mt-1">{counts.converted}</div>
            <div className="text-[11px] text-emerald-700">{formatRp(counts.convertedTotal)} menjadi SI</div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Closed (7 hari)</div>
            <div className="text-lg font-extrabold text-slate-700 mt-1">{counts.closed}</div>
            <div className="text-[11px] text-slate-500">Lost deal</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3">
            <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Conversion Rate</div>
            <div className="text-lg font-extrabold text-[#012749] mt-1">{counts.rate}%</div>
            <div className="text-[11px] text-slate-500">{counts.converted} dari {counts.converted + counts.closed} decided</div>
          </div>
        </div>

        {/* Tabs + search */}
        <div className="px-6 pt-5 flex items-center justify-between flex-wrap gap-2">
          <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
            {(['all', 'OPEN', 'CONVERTED', 'CLOSED'] as const).map((t) => {
              const label = t === 'all' ? 'Semua' : t === 'OPEN' ? 'Open' : t === 'CONVERTED' ? 'Converted' : 'Closed';
              const count = t === 'all' ? rows.length : rows.filter((r) => r.status === t).length;
              return (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-md ${tab === t ? 'bg-white text-[#012749] shadow-sm' : 'text-slate-600 hover:bg-white/50'}`}>
                  {label} ({count})
                </button>
              );
            })}
          </div>
          <input type="text" placeholder="Cari nomor SO / customer / HP..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="text-xs px-3 py-1.5 border border-slate-300 rounded-lg w-64" />
        </div>

        {/* Table */}
        <div className="px-6 py-4">
          {loading ? (
            <p className="text-center text-slate-400 py-8 text-sm">Memuat...</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-slate-400 py-8 text-sm">Tidak ada Sales Order.</p>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
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
                      <td className="px-4 py-3 font-bold text-[#012749]">{r.so_number}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold">{r.customer_name}</div>
                        <div className="text-[11px] text-slate-500">{r.customer_phone ?? '—'} · {r.channel}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-[#012749]">{formatRp(Number(r.subtotal))}</td>
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
                          {r.status === 'OPEN' && (
                            <>
                              <button onClick={() => onConvert(r)}
                                className="px-2.5 py-1 text-[10px] font-bold rounded bg-[#2d8a4e] text-white hover:bg-[#236b3d]">
                                → Jadi Sales Invoice
                              </button>
                              <button onClick={() => setCloseModal({ so: r, reason: '' })}
                                className="px-2.5 py-1 text-[10px] font-bold rounded bg-white border border-rose-300 text-rose-700 hover:bg-rose-50">
                                Tutup
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

      {/* Close modal */}
      {closeModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
            <div className="text-lg font-extrabold text-[#012749] mb-2">Tutup Sales Order</div>
            <div className="text-xs text-slate-600 mb-4">
              SO <strong>{closeModal.so.so_number}</strong> akan ditandai CLOSED. Operasi ini tidak bisa di-undo.
            </div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Alasan <span className="text-red-500">*</span></label>
            <textarea rows={3}
              value={closeModal.reason}
              onChange={(e) => setCloseModal({ ...closeModal, reason: e.target.value })}
              placeholder="Mis: customer pilih supplier lain, harga tidak match, scope berubah, dll."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setCloseModal(null)} disabled={closing}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50">Batal</button>
              <button onClick={onCloseSubmit}
                disabled={closing || closeModal.reason.trim().length === 0}
                className="px-4 py-1.5 text-xs font-bold rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
                {closing ? 'Menutup…' : 'Tutup SO'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
