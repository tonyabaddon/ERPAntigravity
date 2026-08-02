// BerandaPembelian (lite) — Phase 2a snapshot of supplier AP.
// 4-card KPI strip (Total Outstanding / JT Bulan Ini / 7 Hari ke Depan / Terlambat)
// + per-supplier outstanding table with "Bayar" shortcut.
// No aging chart / cash-flow forecast (Phase 2c).
// Refetches on tab refocus (visibilitychange).
import React, { useEffect, useState } from 'react';
import {
  Wallet, CalendarClock, AlarmClock, AlertTriangle, ChevronRight, RefreshCw,
} from 'lucide-react';
import { pembayaranService } from '../../../lib/pembayaranService';
import type { ApDashboardLite } from '../../../types';
import KpiCard from '../../ui/KpiCard';
import { formatIDR } from '../../../lib/formatIDR';

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onOpenPembayaran: (supplierId: string) => void;
}

const fmtRpShort = (n: number) =>
  n >= 1_000_000_000 ? `Rp ${(n / 1_000_000_000).toFixed(2).replace('.', ',')}M`
    : n >= 1_000_000 ? `Rp ${(n / 1_000_000).toFixed(1).replace('.', ',')}jt`
      : n >= 1_000 ? `Rp ${Math.round(n / 1_000)}rb` : `Rp ${n}`;
const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

function daysFromToday(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export default function BerandaPembelian({ showToast, onOpenPembayaran }: Props) {
  const [data, setData] = useState<ApDashboardLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function reload() {
    setLoading(true);
    setFetchError(null);
    try {
      const d = await pembayaranService.fetchDashboardLite();
      setData(d);
      setLastUpdated(new Date());
    } catch (e) {
      setFetchError(e?.message ?? 'Gagal memuat dashboard pembelian.');
      showToast(e instanceof Error ? e.message : 'Gagal load dashboard', 'warning');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  // Refetch on tab refocus
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  if (loading && !data) {
    return <div className="p-8 text-center text-sm text-gray-500">Memuat dashboard...</div>;
  }
  if (fetchError && !data) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-sm font-semibold text-red-600">{fetchError}</p>
        <button
          onClick={reload}
          className="px-4 py-2 bg-[var(--color-caleo-primary)] text-white text-xs font-bold rounded-sm hover:opacity-90"
        >
          Coba Lagi
        </button>
      </div>
    );
  }
  if (!data) {
    return <div className="p-8 text-center text-sm text-gray-500">Tidak ada data.</div>;
  }

  const { kpi, per_supplier } = data;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold" style={{ color: 'var(--color-caleo-primary)' }}>Beranda Pembelian</h2>
          <div className="text-xs text-gray-500">
            Snapshot utang ke supplier
            {lastUpdated && <span className="ml-2 text-gray-400">• Update {lastUpdated.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>}
          </div>
        </div>
        <button onClick={reload} disabled={loading}
          className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700 px-3 py-2 rounded-sm border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          icon={<Wallet className="w-5 h-5" />}
          iconBg="bg-indigo-50" iconColor="text-indigo-700"
          badge="Total" badgeClass="bg-indigo-50 text-indigo-700"
          label="Total Outstanding"
          value={fmtRpShort(kpi.total_outstanding)}
          sub="seluruh supplier"
        />
        <KpiCard
          icon={<CalendarClock className="w-5 h-5" />}
          iconBg="bg-sky-50" iconColor="text-sky-700"
          badge="Bulan Ini" badgeClass="bg-sky-50 text-sky-700"
          label="JT Bulan Ini"
          value={fmtRpShort(kpi.due_this_month)}
          sub="jatuh tempo dalam bulan ini"
        />
        <KpiCard
          icon={<AlarmClock className="w-5 h-5" />}
          iconBg="bg-amber-50" iconColor="text-amber-700"
          badge="≤7 Hari" badgeClass="bg-amber-50 text-amber-700"
          label="7 Hari ke Depan"
          value={fmtRpShort(kpi.next_7_days)}
          sub="JT dalam minggu ini"
        />
        <KpiCard
          icon={<AlertTriangle className="w-5 h-5" />}
          iconBg="bg-rose-50" iconColor="text-rose-700"
          badge="Terlambat" badgeClass="bg-rose-50 text-rose-700"
          label="Terlambat"
          value={fmtRpShort(kpi.overdue.amount)}
          sub={`${kpi.overdue.count} tagihan lewat JT`}
          alarming={kpi.overdue.count > 0}
        />
      </div>

      {/* Per-supplier table */}
      <div className="bg-white/78 backdrop-blur-xl rounded-sm border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50/80 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold" style={{ color: 'var(--color-caleo-primary)' }}>Outstanding per Supplier</div>
            <div className="text-[11px] text-gray-500">Diurutkan berdasarkan total outstanding terbesar</div>
          </div>
          <div className="text-[11px] text-gray-500">{per_supplier.length} supplier</div>
        </div>
        {per_supplier.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">Tidak ada outstanding — semua sudah lunas! ✨</div>
        ) : (
          <table className="w-full">
            <thead className="border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase">Supplier</th>
                <th className="text-center px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase">Tagihan</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase">JT Terdekat</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase">Outstanding</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {per_supplier.map(s => {
                const days = daysFromToday(s.due_soonest);
                const overdueRow = days !== null && days < 0;
                const dueSoonRow = days !== null && days >= 0 && days <= 7;
                return (
                  <tr key={s.supplier_id} className={`hover:bg-slate-50 border-b border-gray-100 ${overdueRow ? 'bg-rose-50/30' : ''}`}>
                    <td className="px-4 py-4">
                      <div className="font-bold text-sm" style={{ color: 'var(--color-caleo-primary)' }}>{s.supplier_name}</div>
                    </td>
                    <td className="px-4 py-4 text-center text-sm">{s.tagihan_count}</td>
                    <td className="px-4 py-4">
                      <div className="text-xs text-gray-600">{fmtDate(s.due_soonest)}</div>
                      {overdueRow && (
                        <div className="text-[11px] font-bold text-rose-700 mt-0.5">⚠ Terlambat {Math.abs(days!)} hari</div>
                      )}
                      {dueSoonRow && (
                        <div className="text-[11px] font-bold text-amber-700 mt-0.5">⏰ {days === 0 ? 'Jatuh tempo hari ini' : `${days} hari lagi`}</div>
                      )}
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-extrabold" style={{ color: overdueRow ? '#b91c1c' : 'var(--color-caleo-primary)' }}>
                      {formatIDR(s.outstanding)}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <button onClick={() => onOpenPembayaran(s.supplier_id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold rounded-sm text-white hover:opacity-90"
                        style={{ background: 'var(--color-caleo-primary)' }}>
                        Bayar <ChevronRight className="w-3 h-3" />
                      </button>
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
