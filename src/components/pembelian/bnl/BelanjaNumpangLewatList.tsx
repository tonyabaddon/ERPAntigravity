// BNL List — KPI strip + filter + table.
// Reads from purchase_invoices WHERE type='PASSTHROUGH'.
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, FileText, ShoppingBag, Clock, AlertTriangle } from 'lucide-react';
import { purchaseInvoiceService, isTerlambat, shortOrderRef } from '../../../lib/purchaseInvoiceService';
import type { DbPurchaseInvoice } from '../../../types';
import { type FilterState, resolveRange, inRange } from '../../../lib/dateRange';
import KpiCard from '../../ui/KpiCard';
import PiStatusBadge from './PiStatusBadge';
import MarkPaidModal from './MarkPaidModal';

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onCreate: () => void;
  onOpenDetail: (piNumber: string) => void;
}

const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const fmtRpShort = (n: number) =>
  n >= 1_000_000 ? `Rp ${(n / 1_000_000).toFixed(1).replace('.', ',')}jt` :
    n >= 1_000 ? `Rp ${Math.round(n / 1_000)}rb` : `Rp ${n}`;
const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function BelanjaNumpangLewatList({ showToast, onCreate, onOpenDetail }: Props) {
  const [list, setList] = useState<DbPurchaseInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterState>({ preset: 'bulan_ini' });
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'BELUM_LUNAS' | 'LUNAS' | 'TERLAMBAT'>('ALL');
  const [search, setSearch] = useState('');
  const [payTarget, setPayTarget] = useState<DbPurchaseInvoice | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const data = await purchaseInvoiceService.fetchAll({ type: 'PASSTHROUGH' });
      setList(data);
    } catch (e: any) {
      showToast(e?.message ?? 'Gagal load BNL', 'warning');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); }, []);

  const filtered = useMemo(() => {
    const range = resolveRange(filter);
    return list.filter(pi => {
      if (!inRange(pi.purchase_date, range)) return false;
      if (statusFilter === 'TERLAMBAT' && !isTerlambat(pi)) return false;
      if (statusFilter === 'BELUM_LUNAS' && (pi.status !== 'BELUM_LUNAS' || isTerlambat(pi))) return false;
      if (statusFilter === 'LUNAS' && pi.status !== 'LUNAS') return false;
      if (search) {
        const q = search.toLowerCase();
        const hits =
          pi.pi_number.toLowerCase().includes(q) ||
          pi.supplier?.name?.toLowerCase().includes(q) ||
          (pi.order_id ?? '').toLowerCase().includes(q);
        if (!hits) return false;
      }
      return true;
    });
  }, [list, filter, statusFilter, search]);

  const kpi = useMemo(() => {
    const total = filtered.length;
    const totalBeli = filtered.reduce((a, p) => a + p.total, 0);
    const belumLunas = filtered.filter(p => p.status === 'BELUM_LUNAS' && !p.voided_at);
    const terlambat = filtered.filter(p => isTerlambat(p) && !p.voided_at);
    return {
      total, totalBeli,
      belumCount: belumLunas.length, belumTotal: belumLunas.reduce((a, p) => a + p.total, 0),
      terlambatCount: terlambat.length, terlambatTotal: terlambat.reduce((a, p) => a + p.total, 0),
    };
  }, [filtered]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold" style={{ color: '#012749' }}>Belanja Numpang Lewat</h2>
          <div className="text-xs text-gray-500">Pembelian pass-through wajib link Order — tidak nambah stok</div>
        </div>
        <button onClick={onCreate} className="inline-flex items-center gap-2 text-sm font-bold text-white px-4 py-2 rounded-lg" style={{ background: '#012749' }}>
          <Plus className="w-4 h-4" /> Buat PI Baru
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <KpiCard icon={<FileText className="w-5 h-5" />} iconBg="bg-indigo-50" iconColor="text-indigo-700" badge="Total PI" badgeClass="bg-indigo-50 text-indigo-700" label="Total PI" value={`${kpi.total} invoice`} sub="dalam periode" />
        <KpiCard icon={<ShoppingBag className="w-5 h-5" />} iconBg="bg-sky-50" iconColor="text-sky-700" badge="Belanja" badgeClass="bg-sky-50 text-sky-700" label="Total Belanja" value={fmtRpShort(kpi.totalBeli)} sub="dalam periode" />
        <KpiCard icon={<Clock className="w-5 h-5" />} iconBg="bg-amber-50" iconColor="text-amber-700" badge="Belum" badgeClass="bg-amber-50 text-amber-700" label="Belum Lunas" value={fmtRpShort(kpi.belumTotal)} sub={`${kpi.belumCount} invoice`} />
        <KpiCard icon={<AlertTriangle className="w-5 h-5" />} iconBg="bg-rose-50" iconColor="text-rose-700" badge="Terlambat" badgeClass="bg-rose-50 text-rose-700" label="Terlambat" value={fmtRpShort(kpi.terlambatTotal)} sub={`${kpi.terlambatCount} invoice`} alarming={kpi.terlambatCount > 0} />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(['bulan_ini', '30_hari', '90_hari'] as const).map(p => (
            <button key={p} onClick={() => setFilter({ preset: p })}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold ${filter.preset === p ? 'text-white' : 'bg-white border border-gray-200 text-gray-600'}`}
              style={filter.preset === p ? { background: '#012749' } : {}}>
              {p === 'bulan_ini' ? 'Bulan Ini' : p === '30_hari' ? '30 Hari' : '90 Hari'}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-full pl-3 pr-1 py-1">
            <Search className="w-3.5 h-3.5 text-gray-400" />
            <input className="text-xs outline-none w-44" placeholder="Cari PI / supplier / order..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg" value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
            <option value="ALL">Semua status</option>
            <option value="BELUM_LUNAS">Belum Lunas</option>
            <option value="LUNAS">Lunas</option>
            <option value="TERLAMBAT">Terlambat</option>
          </select>
        </div>
      </div>

      <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Memuat...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">Belum ada PI dalam periode ini.</div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-200">
              <tr>
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">PI / Tanggal</th>
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Supplier (Grosir)</th>
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Order Terkait</th>
                <th className="text-right px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Total Beli</th>
                <th className="text-center px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="text-right px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(pi => (
                <tr key={pi.id} className="hover:bg-slate-50 border-b border-gray-100">
                  <td className="px-5 py-4">
                    <div className="font-bold text-sm" style={{ color: '#012749' }}>{pi.pi_number}</div>
                    <div className="text-xs text-gray-500">{fmtDate(pi.purchase_date)}</div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="font-semibold text-sm">{pi.supplier?.name ?? '—'}</div>
                    {pi.supplier_invoice_number && <div className="text-[11px] text-gray-500 mt-0.5">Faktur: {pi.supplier_invoice_number}</div>}
                  </td>
                  <td className="px-5 py-4">
                    <div className="text-sm font-semibold text-indigo-700">{shortOrderRef(pi.order_id)}</div>
                  </td>
                  <td className="px-5 py-4 text-right text-sm font-bold">{fmtRp(pi.total)}</td>
                  <td className="px-5 py-4 text-center"><PiStatusBadge pi={pi} /></td>
                  <td className="px-5 py-4 text-right">
                    <div className="inline-flex gap-1">
                      {pi.status === 'BELUM_LUNAS' && !pi.voided_at && (
                        <button onClick={() => setPayTarget(pi)}
                          className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-green-50 text-green-700 border border-green-200 hover:bg-green-100">
                          Tandai Lunas
                        </button>
                      )}
                      <button onClick={() => onOpenDetail(pi.pi_number)}
                        className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-white border border-gray-200 text-gray-700 hover:bg-gray-50">
                        Detail
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {payTarget && <MarkPaidModal pi={payTarget} onClose={() => setPayTarget(null)} onPaid={reload} showToast={showToast} />}
    </div>
  );
}
