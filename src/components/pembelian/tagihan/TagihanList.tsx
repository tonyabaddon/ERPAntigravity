// Tagihan List — purchase_invoices filtered by type='STOCK'.
// Columns: TGH number, Supplier, Pesanan link, Total, paid/outstanding bar,
// Status badge (BELUM amber / SEBAGIAN sky / LUNAS green / TERLAMBAT red),
// JT, Aksi (Bayar shortcut for non-LUNAS, Detail).
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { purchaseInvoiceService } from '../../../lib/purchaseInvoiceService';
import type { DbPurchaseInvoice, TagihanStatus } from '../../../types';
import { wibDateString } from '../../../lib/format';
import { formatIDR } from '../../../lib/formatIDR';
import { captureError } from '../../../lib/captureError';

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onCreate: () => void;
  onOpenDetail: (tghNumber: string) => void;
  onOpenPembayaran?: (supplierId: string) => void;
}

const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

type Row = DbPurchaseInvoice & {
  pesanan_id?: string | null;
  paid_amount?: number;
  pesanan?: { pesanan_number: string } | null;
};

function effectiveStatus(t: Row, today = wibDateString()): TagihanStatus | 'TERLAMBAT' | 'VOID' {
  if (t.voided_at) return 'VOID';
  const s = t.status as TagihanStatus;
  if (s === 'LUNAS') return 'LUNAS';
  if (t.payment_due_at && t.payment_due_at < today) return 'TERLAMBAT';
  return s;
}

function statusBadge(label: string): string {
  switch (label) {
    case 'LUNAS': return 'bg-green-100 text-green-800';
    case 'DIBAYAR_SEBAGIAN': return 'bg-sky-100 text-sky-800';
    case 'TERLAMBAT': return 'bg-red-100 text-red-800';
    case 'BELUM_LUNAS': return 'bg-amber-100 text-amber-800';
    case 'VOID': return 'bg-gray-200 text-gray-600';
    default: return 'bg-gray-100 text-gray-700';
  }
}

function statusLabel(label: string): string {
  switch (label) {
    case 'LUNAS': return '● Lunas';
    case 'DIBAYAR_SEBAGIAN': return '◐ Sebagian';
    case 'TERLAMBAT': return '⚠ Terlambat';
    case 'BELUM_LUNAS': return '○ Belum Lunas';
    case 'VOID': return 'VOID';
    default: return label;
  }
}

export default function TagihanList({ showToast, onCreate, onOpenDetail, onOpenPembayaran }: Props) {
  const [list, setList] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'ALL' | TagihanStatus | 'TERLAMBAT'>('ALL');
  const [search, setSearch] = useState('');

  async function reload() {
    setLoading(true);
    try {
      const data = await purchaseInvoiceService.fetchAll({ type: 'STOCK' });
      setList(data as unknown as Row[]);
    } catch (e: unknown) {
      captureError(e, { feature: 'tagihan', action: 'fetch_all' });
      showToast((e as { message?: string })?.message ?? 'Gagal load Tagihan', 'warning');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); }, []);

  const filtered = useMemo(() => {
    const today = wibDateString();
    return list.filter(t => {
      const eff = effectiveStatus(t, today);
      if (statusFilter !== 'ALL') {
        if (statusFilter === 'TERLAMBAT' && eff !== 'TERLAMBAT') return false;
        if (statusFilter !== 'TERLAMBAT' && eff !== statusFilter) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const hits =
          t.pi_number.toLowerCase().includes(q) ||
          t.supplier?.name?.toLowerCase().includes(q) ||
          (t.pesanan?.pesanan_number ?? '').toLowerCase().includes(q);
        if (!hits) return false;
      }
      return true;
    });
  }, [list, statusFilter, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold" style={{ color: '#012749' }}>Tagihan (Faktur Beli Stok)</h2>
          <div className="text-xs text-gray-500">Step 2: catat saat barang datang + faktur diterima. Otomatis nambah stok.</div>
        </div>
        <button onClick={onCreate} className="inline-flex items-center gap-2 text-sm font-bold text-white px-4 py-2 rounded-lg" style={{ background: '#012749' }}>
          <Plus className="w-4 h-4" /> Buat Tagihan
        </button>
      </div>

      <div className="flex justify-end gap-2">
        <div className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-full pl-3 pr-1 py-1">
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <input className="text-xs outline-none w-44" placeholder="Cari TGH / supplier / PSN..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg" value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
          <option value="ALL">Semua status</option>
          <option value="BELUM_LUNAS">Belum Lunas</option>
          <option value="DIBAYAR_SEBAGIAN">Dibayar Sebagian</option>
          <option value="LUNAS">Lunas</option>
          <option value="TERLAMBAT">Terlambat</option>
        </select>
      </div>

      <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? <div className="p-8 text-center text-sm text-gray-500">Memuat...</div>
         : filtered.length === 0 ? <div className="p-8 text-center text-sm text-gray-500">Belum ada Tagihan.</div>
         : (
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-200">
              <tr>
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase">Tagihan</th>
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase">Supplier</th>
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase">Pesanan</th>
                <th className="text-right px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase">Total</th>
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase w-48">Dibayar</th>
                <th className="text-center px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase">Status</th>
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase">JT</th>
                <th className="text-right px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => {
                const paid = Number(t.paid_amount ?? 0);
                const outstanding = Math.max(0, t.total - paid);
                const pct = t.total > 0 ? Math.min(100, (paid / t.total) * 100) : 0;
                const eff = effectiveStatus(t);
                return (
                  <tr key={t.id} className="hover:bg-slate-50 border-b border-gray-100">
                    <td className="px-5 py-4">
                      <div className="font-bold text-sm" style={{ color: '#012749' }}>{t.pi_number}</div>
                      <div className="text-xs text-gray-500">{fmtDate(t.purchase_date)}</div>
                    </td>
                    <td className="px-5 py-4 text-sm font-semibold">{t.supplier?.name ?? '—'}</td>
                    <td className="px-5 py-4 text-sm">
                      <span className="text-indigo-700 font-semibold">
                        {t.pesanan?.pesanan_number ?? (t.pesanan_id ? `PSN-${t.pesanan_id.slice(0, 8).toUpperCase()}` : '—')}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right text-sm font-bold">{formatIDR(t.total)}</td>
                    <td className="px-5 py-4">
                      <div className="text-[11px] text-gray-600 mb-1">
                        <span className="font-semibold text-green-700">{formatIDR(paid)}</span>
                        <span className="text-gray-400"> / </span>
                        <span className="text-gray-600">{formatIDR(t.total)}</span>
                      </div>
                      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full ${paid >= t.total ? 'bg-green-500' : paid > 0 ? 'bg-sky-500' : 'bg-amber-400'}`} style={{ width: `${pct}%` }} />
                      </div>
                      {outstanding > 0 && <div className="text-[10px] text-gray-400 mt-0.5">Sisa {formatIDR(outstanding)}</div>}
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${statusBadge(eff)}`}>{statusLabel(eff)}</span>
                    </td>
                    <td className="px-5 py-4 text-xs text-gray-600">{fmtDate(t.payment_due_at)}</td>
                    <td className="px-5 py-4 text-right">
                      <div className="inline-flex gap-1">
                        {eff !== 'LUNAS' && eff !== 'VOID' && onOpenPembayaran && (
                          <button onClick={() => onOpenPembayaran(t.supplier_id)}
                            className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-green-50 text-green-700 border border-green-200 hover:bg-green-100">
                            Bayar
                          </button>
                        )}
                        <button onClick={() => onOpenDetail(t.pi_number)}
                          className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-white border border-gray-200 text-gray-700 hover:bg-gray-50">
                          Detail
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
