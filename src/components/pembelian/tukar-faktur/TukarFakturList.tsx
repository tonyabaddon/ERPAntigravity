// Tukar Faktur List — Phase 2b.
// Mirrors PesananList structure with status pill filter, due-soon highlighting,
// and footer Outstanding subtotal per spec §8.
import React, { useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { tukarFakturService } from '../../../lib/tukarFakturService';
import type { DbTukarFaktur, TukarFakturStatus } from '../../../types';
import { formatIDR } from '../../../lib/formatIDR';
import LoadingState from '../../ui/LoadingState';
import EmptyState from '../../ui/EmptyState';

const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const daysFromToday = (s?: string | null): number | null => {
  if (!s) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(s + 'T00:00:00').getTime() - today.getTime()) / 86400000);
};

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onCreate: () => void;
  onOpenDetail: (tf_number: string) => void;
}

const STATUS_BADGE: Record<TukarFakturStatus, string> = {
  BELUM_LUNAS: 'bg-amber-100 text-amber-800',
  DIBAYAR_SEBAGIAN: 'bg-sky-100 text-sky-800',
  LUNAS: 'bg-green-100 text-green-800',
  VOIDED: 'bg-gray-200 text-gray-600',
};

const STATUS_LABEL: Record<TukarFakturStatus, string> = {
  BELUM_LUNAS: 'Belum Lunas',
  DIBAYAR_SEBAGIAN: 'Dibayar Sebagian',
  LUNAS: 'Lunas',
  VOIDED: 'Dihapus',
};

export default function TukarFakturList({ showToast, onCreate, onOpenDetail }: Props) {
  const [list, setList] = useState<DbTukarFaktur[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'ALL' | TukarFakturStatus>('ALL');
  const [search, setSearch] = useState('');

  async function reload() {
    setLoading(true);
    try {
      setList(await tukarFakturService.fetchAll());
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal load Tukar Faktur', 'warning');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); }, []);

  const filtered = list.filter(tf => {
    if (statusFilter !== 'ALL' && tf.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const matchTf = tf.tf_number.toLowerCase().includes(q);
      const matchSupplier = tf.supplier?.name?.toLowerCase().includes(q) ?? false;
      if (!matchTf && !matchSupplier) return false;
    }
    return true;
  });

  const outstandingList = filtered.filter(tf => tf.status !== 'LUNAS' && tf.status !== 'VOIDED');
  const totalOutstanding = outstandingList.reduce(
    (a, tf) => a + (Number(tf.total_amount) - Number(tf.paid_amount)),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold" style={{ color: 'var(--color-caleo-primary)' }}>
            Tukar Faktur Pembelian
          </h2>
          <div className="text-xs text-gray-500">
            Bundle Tagihan supplier untuk ritual tukar faktur fisik & pembayaran kolektif
          </div>
        </div>
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-2 text-sm font-bold text-white px-4 py-2 rounded"
          style={{ background: 'var(--color-caleo-primary)' }}
        >
          <Plus className="w-4 h-4" /> Buat Tukar Faktur
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {(['ALL', 'BELUM_LUNAS', 'DIBAYAR_SEBAGIAN', 'LUNAS'] as const).map(key => {
            const active = statusFilter === key;
            const label = key === 'ALL' ? 'Semua' : STATUS_LABEL[key as TukarFakturStatus];
            return (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${
                  active
                    ? 'text-white border-transparent'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
                style={active ? { background: 'var(--color-caleo-primary)' } : undefined}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-full pl-3 pr-3 py-1">
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <input
            className="text-xs outline-none w-52"
            placeholder="Cari TF / supplier..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white/78 backdrop-blur-xl rounded border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <LoadingState label="Memuat..." />
        ) : filtered.length === 0 ? (
          <EmptyState message="Belum ada Tukar Faktur — semua Tagihan dibayar langsung." />
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-caleo-11 font-semibold text-gray-500 uppercase">TF</th>
                <th className="text-left px-4 py-3 text-caleo-11 font-semibold text-gray-500 uppercase">Supplier</th>
                <th className="text-center px-4 py-3 text-caleo-11 font-semibold text-gray-500 uppercase">Faktur</th>
                <th className="text-right px-4 py-3 text-caleo-11 font-semibold text-gray-500 uppercase">Total</th>
                <th className="text-right px-4 py-3 text-caleo-11 font-semibold text-gray-500 uppercase">Dibayar</th>
                <th className="text-center px-4 py-3 text-caleo-11 font-semibold text-gray-500 uppercase">JT</th>
                <th className="text-center px-4 py-3 text-caleo-11 font-semibold text-gray-500 uppercase">Status</th>
                <th className="text-right px-4 py-3 text-caleo-11 font-semibold text-gray-500 uppercase">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(tf => {
                const days = daysFromToday(tf.payment_due_at);
                const dueSoon =
                  tf.status !== 'LUNAS' && tf.status !== 'VOIDED' && days !== null && days <= 7;
                return (
                  <tr
                    key={tf.id}
                    className={`hover:bg-slate-50 border-b border-gray-100 ${
                      dueSoon ? 'border-l-4 border-l-amber-400' : ''
                    }`}
                  >
                    <td className="px-4 py-4">
                      <div className="font-bold text-sm" style={{ color: 'var(--color-caleo-primary)' }}>
                        {tf.tf_number}
                      </div>
                      <div className="text-xs text-gray-500">{fmtDate(tf.tukar_date)}</div>
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold">{tf.supplier?.name ?? '—'}</td>
                    <td className="px-4 py-4 text-center text-sm">{tf.tagihans?.length ?? 0}</td>
                    <td className="px-4 py-4 text-right text-sm font-bold">{formatIDR(tf.total_amount)}</td>
                    <td
                      className={`px-4 py-4 text-right text-sm ${
                        Number(tf.paid_amount) > 0 ? 'font-bold text-sky-700' : 'text-gray-400'
                      }`}
                    >
                      {formatIDR(tf.paid_amount)}
                    </td>
                    <td className="px-4 py-4 text-center">
                      <div className={`text-xs font-bold ${dueSoon ? 'text-amber-700' : 'text-gray-700'}`}>
                        {fmtDate(tf.payment_due_at)}
                      </div>
                      {days !== null && tf.status !== 'LUNAS' && tf.status !== 'VOIDED' && (
                        <div
                          className={`text-caleo-10 ${
                            days < 0
                              ? 'text-caleo-danger font-bold'
                              : dueSoon
                              ? 'text-amber-600 font-semibold'
                              : 'text-gray-500'
                          }`}
                        >
                          {days < 0
                            ? `Terlambat ${Math.abs(days)} hari`
                            : days === 0
                            ? 'Hari ini'
                            : `${days} hari lagi`}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[tf.status]}`}
                      >
                        {STATUS_LABEL[tf.status]}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right whitespace-nowrap">
                      <button
                        onClick={() => onOpenDetail(tf.tf_number)}
                        className="px-2.5 py-1.5 text-caleo-11 font-semibold rounded bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
                      >
                        Detail
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {outstandingList.length > 0 && (
              <tfoot className="bg-gray-50/80 border-t-2 border-gray-300">
                <tr>
                  <td
                    className="px-4 py-3 text-caleo-11 font-bold uppercase text-gray-500"
                    colSpan={3}
                  >
                    Subtotal Outstanding ({outstandingList.length} TF)
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-extrabold" style={{ color: 'var(--color-caleo-primary)' }}>
                    {formatIDR(totalOutstanding)}
                  </td>
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </div>
  );
}
