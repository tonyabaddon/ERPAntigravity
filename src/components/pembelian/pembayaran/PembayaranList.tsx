// Pembayaran List — list of Pembayaran rows.
// Columns: PMB number, Supplier, Tanggal, Method, Amount, Status, Aksi.
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { pembayaranService } from '../../../lib/pembayaranService';
import type { DbPembayaran, PembayaranStatus } from '../../../types';
import { formatIDR } from '../../../lib/formatIDR';

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onCreate: () => void;
  onOpenDetail: (pmbNumber: string) => void;
}

const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const STATUS_BADGE: Record<PembayaranStatus, string> = {
  LUNAS: 'bg-green-100 text-green-800',
  VOIDED: 'bg-gray-200 text-gray-600',
};

export default function PembayaranList({ showToast, onCreate, onOpenDetail }: Props) {
  const [list, setList] = useState<DbPembayaran[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'ALL' | PembayaranStatus>('ALL');
  const [search, setSearch] = useState('');

  async function reload() {
    setLoading(true);
    try { setList(await pembayaranService.fetchAll()); }
    catch (e) { showToast(e instanceof Error ? e.message : 'Gagal load Pembayaran', 'warning'); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  const filtered = useMemo(() => list.filter(p => {
    if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const hits =
        p.pembayaran_number.toLowerCase().includes(q) ||
        (p.supplier?.name ?? '').toLowerCase().includes(q);
      if (!hits) return false;
    }
    return true;
  }), [list, statusFilter, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold" style={{ color: 'var(--color-caleo-primary)' }}>Pembayaran ke Supplier</h2>
          <div className="text-xs text-gray-500">Step 3: bayar Tagihan ke supplier. Bisa 1 Pembayaran untuk banyak Tagihan.</div>
        </div>
        <button onClick={onCreate} className="inline-flex items-center gap-2 text-sm font-bold text-white px-4 py-2 rounded" style={{ background: 'var(--color-caleo-primary)' }}>
          <Plus className="w-4 h-4" /> Catat Pembayaran
        </button>
      </div>

      <div className="flex justify-end gap-2">
        <div className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-full pl-3 pr-1 py-1">
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <input className="text-xs outline-none w-44" placeholder="Cari PMB / supplier..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="text-xs px-2 py-1.5 border border-gray-200 rounded" value={statusFilter} onChange={e => setStatusFilter(e.target.value as Parameters<typeof setStatusFilter>[0])}>
          <option value="ALL">Semua status</option>
          <option value="LUNAS">Lunas</option>
          <option value="VOIDED">Voided</option>
        </select>
      </div>

      <div className="bg-white/78 backdrop-blur-xl rounded border border-gray-200 shadow-sm overflow-hidden">
        {loading ? <div className="p-8 text-center text-sm text-gray-500">Memuat...</div>
         : filtered.length === 0 ? <div className="p-8 text-center text-sm text-gray-500">Belum ada Pembayaran.</div>
         : (
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-caleo-11 font-semibold text-gray-500 uppercase">Pembayaran</th>
                <th className="text-left px-4 py-3 text-caleo-11 font-semibold text-gray-500 uppercase">Supplier</th>
                <th className="text-left px-4 py-3 text-caleo-11 font-semibold text-gray-500 uppercase">Tanggal</th>
                <th className="text-left px-4 py-3 text-caleo-11 font-semibold text-gray-500 uppercase">Metode</th>
                <th className="text-right px-4 py-3 text-caleo-11 font-semibold text-gray-500 uppercase">Total</th>
                <th className="text-center px-4 py-3 text-caleo-11 font-semibold text-gray-500 uppercase">Status</th>
                <th className="text-right px-4 py-3 text-caleo-11 font-semibold text-gray-500 uppercase">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="hover:bg-slate-50 border-b border-gray-100">
                  <td className="px-4 py-4">
                    <div className="font-bold text-sm" style={{ color: 'var(--color-caleo-primary)' }}>{p.pembayaran_number}</div>
                    {(p.items?.length ?? 0) > 1 && (
                      <div className="text-caleo-11 text-indigo-600 mt-0.5">⚡ {p.items?.length} Tagihan</div>
                    )}
                  </td>
                  <td className="px-4 py-4 text-sm font-semibold">{p.supplier?.name ?? '—'}</td>
                  <td className="px-4 py-4 text-sm text-gray-600">{fmtDate(p.paid_at)}</td>
                  <td className="px-4 py-4 text-sm">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700">{p.payment_method}</span>
                    {p.account_label && <div className="text-caleo-11 text-gray-500 mt-1">{p.account_label}</div>}
                  </td>
                  <td className="px-4 py-4 text-right text-sm font-bold">{formatIDR(p.amount_total)}</td>
                  <td className="px-4 py-4 text-center">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[p.status]}`}>
                      {p.status === 'LUNAS' ? '● Lunas' : 'VOIDED'}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <button onClick={() => onOpenDetail(p.pembayaran_number)}
                      className="px-2.5 py-1.5 text-caleo-11 font-semibold rounded bg-white border border-gray-200 text-gray-700 hover:bg-gray-50">
                      Detail
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
