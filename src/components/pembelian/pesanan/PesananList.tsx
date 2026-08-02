import React, { useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { pesananService } from '../../../lib/pesananService';
import type { DbPesanan, PesananStatus } from '../../../types';
import { formatIDR } from '../../../lib/formatIDR';

const fmtDate = (s?: string|null) => s ? new Date(s).toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' }) : '—';

interface Props {
  showToast: (msg: string, type?: 'success'|'info'|'warning') => void;
  onCreate: () => void;
  onOpenDetail: (psn: string) => void;
}

const STATUS_BADGE: Record<PesananStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  ORDERED: 'bg-blue-100 text-blue-800',
  CLOSED: 'bg-green-100 text-green-800',
};

export default function PesananList({ showToast, onCreate, onOpenDetail }: Props) {
  const [list, setList] = useState<DbPesanan[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'ALL'|PesananStatus>('ALL');
  const [search, setSearch] = useState('');

  async function reload() {
    setLoading(true);
    try { setList(await pesananService.fetchAll()); }
    catch (e) { showToast(e instanceof Error ? e.message : 'Gagal load Pesanan', 'warning'); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  const filtered = list.filter(p => {
    if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
    if (search && !p.pesanan_number.toLowerCase().includes(search.toLowerCase()) && !p.supplier?.name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold" style={{ color: 'var(--color-caleo-primary)' }}>Pesanan (Purchase Order)</h2>
          <div className="text-xs text-gray-500">Step 1: pesan ke supplier sebelum barang datang</div>
        </div>
        <button onClick={onCreate} className="inline-flex items-center gap-2 text-sm font-bold text-white px-4 py-2 rounded" style={{ background:'var(--color-caleo-primary)' }}>
          <Plus className="w-4 h-4" /> Buat Pesanan
        </button>
      </div>

      <div className="flex justify-end gap-2">
        <div className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-full pl-3 pr-1 py-1">
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <input className="text-xs outline-none w-44" placeholder="Cari PSN / supplier..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="text-xs px-2 py-1.5 border border-gray-200 rounded" value={statusFilter} onChange={e => setStatusFilter(e.target.value as Parameters<typeof setStatusFilter>[0])}>
          <option value="ALL">Semua status</option>
          <option value="DRAFT">Draft</option>
          <option value="ORDERED">Ordered</option>
          <option value="CLOSED">Closed</option>
        </select>
      </div>

      <div className="bg-white/78 backdrop-blur-xl rounded border border-gray-200 shadow-sm overflow-hidden">
        {loading ? <div className="p-8 text-center text-sm text-gray-500">Memuat...</div>
         : filtered.length === 0 ? <div className="p-8 text-center text-sm text-gray-500">Belum ada Pesanan.</div>
         : (
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase">Pesanan</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase">Supplier</th>
                <th className="text-center px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase">Items</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase">Total</th>
                <th className="text-center px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase">Status</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="hover:bg-slate-50 border-b border-gray-100">
                  <td className="px-4 py-4">
                    <div className="font-bold text-sm" style={{ color:'var(--color-caleo-primary)' }}>{p.pesanan_number}</div>
                    <div className="text-xs text-gray-500">{fmtDate(p.created_at)}</div>
                  </td>
                  <td className="px-4 py-4 text-sm font-semibold">{p.supplier?.name ?? '—'}</td>
                  <td className="px-4 py-4 text-center text-sm">{p.items?.length ?? 0}</td>
                  <td className="px-4 py-4 text-right text-sm font-bold">{formatIDR(p.total)}</td>
                  <td className="px-4 py-4 text-center">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[p.status]}`}>{p.status}</span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <button onClick={() => onOpenDetail(p.pesanan_number)} className="px-2.5 py-1.5 text-[11px] font-semibold rounded bg-white border border-gray-200 text-gray-700 hover:bg-gray-50">Detail</button>
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
