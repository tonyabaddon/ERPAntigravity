import React, { useState, useEffect } from 'react';
import { TrendingUp, ShoppingBag, Receipt, DollarSign, BarChart2 } from 'lucide-react';
import KpiCard from './ui/KpiCard';
import AkuntansiLaporanTab from './laporan/akuntansi/AkuntansiLaporanTab';
import SlowMoverTable from './laporan/SlowMoverTable';
import TopCustomerTable from './laporan/TopCustomerTable';
import LayananSection from './laporan/LayananSection';
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { reportsService, isSupabaseConfigured } from '../lib/supabaseClient';
import { CHANNEL_VISUAL } from '../lib/salesChannels';
import {
  getPerformaSummaryWithDelta,
  getProfitPerChannel,
} from '../lib/dashboardReports/api';
import { computeDelta } from '../lib/dashboardReports/types';
import type { PerformaSummaryWithDelta, ChannelProfitRow, PeriodDays, DeltaResult } from '../lib/dashboardReports/types';
import type { SalesChannel } from '../types';
import { captureError } from '../lib/captureError';

function colorForChannel(name: string): string {
  const code = (Object.keys(CHANNEL_VISUAL) as SalesChannel[]).find(
    c => CHANNEL_VISUAL[c].label === name,
  );
  return code ? CHANNEL_VISUAL[code].brandColor : '#94a3b8';
}

type Period = '7d' | '30d' | '90d';
type LaporanTab = 'performa' | 'akuntansi';

function periodStart(p: Period): string {
  const d = new Date();
  d.setDate(d.getDate() - (p === '7d' ? 6 : p === '30d' ? 29 : 89));
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }) + 'T00:00:00+07:00';
}

function periodDays(p: Period): number {
  return p === '7d' ? 7 : p === '30d' ? 30 : 90;
}

function formatRupiah(val: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  }).format(val);
}

function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  const d: DeltaResult = computeDelta(current, previous);
  if (d.pct == null) {
    return <span className="text-[11px] text-slate-400">— tidak ada data periode sebelumnya</span>;
  }
  const arrow = d.direction === 'up' ? '▲' : d.direction === 'down' ? '▼' : '—';
  const cls = d.direction === 'up' ? 'text-emerald-600' : d.direction === 'down' ? 'text-rose-600' : 'text-slate-500';
  return (
    <span className={`text-[11px] font-semibold ${cls}`}>
      {arrow} {d.pct > 0 ? '+' : ''}{d.pct}% vs periode sebelumnya
    </span>
  );
}

interface LaporanScreenProps {
  showToast?: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  /** Navigate to another app page (forwarded from App.tsx for inter-screen navigation). */
  onNavigate?: (page: string) => void;
}

export default function LaporanScreen(props: LaporanScreenProps) {
  const showToast = props.showToast ?? (() => {});
  const [activeTab, setActiveTab] = useState<LaporanTab>('performa');
  // F-8: match the Dashboard default of 7d for consistency across surfaces.
  const [period, setPeriod] = useState<Period>('7d');
  const [dailyRevenueByChannel, setDailyRevenueByChannel] = useState<Array<{
    Day: string; 'Walk-in': number; Tokopedia: number; Grosir: number; 'WA AI': number;
  }>>([]);
  const [topProducts, setTopProducts] = useState<Array<{ name: string; qty: number; revenue: number }>>([]);

  // New: performa summary with delta + profit per channel
  // null = loading, false = fetch error, value = success
  const [perfSummary, setPerfSummary] = useState<PerformaSummaryWithDelta | null | false>(null);
  const [profitPerChannel, setProfitPerChannel] = useState<ChannelProfitRow[] | false>([]);
  const [revenueChartError, setRevenueChartError] = useState(false);

  // Convert string period to numeric PeriodDays for API calls
  const days = (period === '7d' ? 7 : period === '30d' ? 30 : 90) as PeriodDays;

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const since = periodStart(period);
    const numDays = periodDays(period);
    setPerfSummary(null);
    setProfitPerChannel([]);
    setRevenueChartError(false);
    Promise.allSettled([
      getPerformaSummaryWithDelta(days),
      getProfitPerChannel(days),
      reportsService.fetchDailyRevenueByChannel(since, numDays),
      reportsService.fetchTopProducts(since),
    ]).then((results) => {
      const [perfRes, profitRes, revRes, prodsRes] = results;
      if (perfRes.status === 'fulfilled') setPerfSummary(perfRes.value);
      else { captureError(perfRes.reason, { feature: 'laporan', action: 'fetch_performa_summary' }); setPerfSummary(false); }
      if (profitRes.status === 'fulfilled') setProfitPerChannel(profitRes.value);
      else { captureError(profitRes.reason, { feature: 'laporan', action: 'fetch_profit_per_channel' }); setProfitPerChannel(false); }
      if (revRes.status === 'fulfilled') setDailyRevenueByChannel(revRes.value);
      else { captureError(revRes.reason, { feature: 'laporan', action: 'fetch_daily_revenue_by_channel' }); setRevenueChartError(true); }
      if (prodsRes.status === 'fulfilled') setTopProducts(prodsRes.value);
      else captureError(prodsRes.reason, { feature: 'laporan', action: 'fetch_top_products' });

      const anyFailed = results.some((r) => r.status === 'rejected');
      if (anyFailed) {
        showToast('Sebagian data laporan gagal dimuat. Coba pilih periode lagi.', 'warning');
      }
    });
  }, [period]);

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Top tab strip */}
      <div className="flex gap-2 bg-white p-2 rounded-sm border border-[var(--color-caleo-mist-dark)] w-fit">
        <button
          onClick={() => setActiveTab('performa')}
          className={`px-4 py-2 rounded-full text-xs font-bold inline-flex items-center gap-1.5 transition-colors ${
            activeTab === 'performa' ? 'bg-[var(--color-caleo-primary)] text-white' : 'text-[#1e3d60] hover:bg-[var(--color-caleo-cloud)]'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5" /> Performa
        </button>
        <button
          onClick={() => setActiveTab('akuntansi')}
          className={`px-4 py-2 rounded-full text-xs font-bold inline-flex items-center gap-1.5 transition-colors ${
            activeTab === 'akuntansi' ? 'bg-[var(--color-caleo-primary)] text-white' : 'text-[#1e3d60] hover:bg-[var(--color-caleo-cloud)]'
          }`}
        >
          <BarChart2 className="w-3.5 h-3.5" /> Akuntansi
        </button>
      </div>

      {/* Performa Tab */}
      {activeTab === 'performa' && (
      <div className="space-y-6">
        {/* Header + period selector */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/60 backdrop-blur-xl p-8 rounded-sm border border-white/60 shadow-sm">
          <div>
            <h2 className="text-[var(--color-caleo-primary)] font-extrabold text-2xl tracking-tight">Laporan Performa</h2>
            <p className="text-xs text-gray-500 mt-0.5">Analisis pendapatan, gross profit, pesanan, dan pergerakan stok</p>
          </div>
          <div className="flex gap-2">
            {(['7d', '30d', '90d'] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${
                  period === p
                    ? 'bg-[var(--color-caleo-primary)] text-white shadow'
                    : 'bg-white border border-gray-200 text-gray-600 hover:border-[var(--color-caleo-primary)]'
                }`}
              >
                {p === '7d' ? '7 Hari' : p === '30d' ? '30 Hari' : '90 Hari'}
              </button>
            ))}
          </div>
        </div>

      {!isSupabaseConfigured && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-sm p-4 text-sm text-yellow-800">
          ⚠️ Supabase belum dikonfigurasi. Tambahkan <code>VITE_SUPABASE_URL</code> dan <code>VITE_SUPABASE_ANON_KEY</code> ke file <code>.env</code>.
        </div>
      )}

      {/* KPI cards */}
      {perfSummary === false ? (
        <div className="bg-red-50 border border-red-200 rounded-sm p-4 text-sm text-red-700" role="alert">
          Gagal memuat ringkasan performa. Coba pilih periode lagi atau periksa koneksi.
        </div>
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <KpiCard
          icon={<TrendingUp className="w-6 h-6" />}
          iconBg="bg-blue-50"
          iconColor="text-[#1e3d60]"
          badge="Revenue"
          badgeClass="text-[#2d8a4e] bg-emerald-50"
          label="Total Omset"
          value={perfSummary ? formatRupiah(perfSummary.revenue) : '...'}
          sub={perfSummary
            ? <DeltaBadge current={perfSummary.revenue} previous={perfSummary.prev_revenue} />
            : 'Memuat...'}
        />
        <KpiCard
          icon={<DollarSign className="w-6 h-6" />}
          iconBg="bg-emerald-50"
          iconColor="text-emerald-700"
          badge={perfSummary && perfSummary.revenue > 0
            ? `${Math.round((perfSummary.gross_profit / perfSummary.revenue) * 100)}% margin`
            : 'Margin'}
          badgeClass="text-emerald-700 bg-emerald-50"
          label="Gross Profit"
          value={perfSummary ? formatRupiah(perfSummary.gross_profit) : '...'}
          sub={perfSummary
            ? <DeltaBadge current={perfSummary.gross_profit} previous={perfSummary.prev_gross_profit} />
            : 'Memuat...'}
        />
        <KpiCard
          icon={<ShoppingBag className="w-6 h-6" />}
          iconBg="bg-amber-50"
          iconColor="text-amber-600"
          badge="Selesai"
          badgeClass="text-blue-600 bg-blue-50"
          label="Pesanan Terproses"
          value={perfSummary ? `${perfSummary.order_count} Transaksi` : '...'}
          sub={perfSummary
            ? <DeltaBadge current={perfSummary.order_count} previous={perfSummary.prev_order_count} />
            : 'Memuat...'}
        />
        <KpiCard
          icon={<Receipt className="w-6 h-6" />}
          iconBg="bg-violet-50"
          iconColor="text-violet-600"
          badge="Rata-rata"
          badgeClass="text-violet-700 bg-violet-50"
          label="Nilai Rata-rata Pesanan"
          value={perfSummary ? formatRupiah(perfSummary.avg_order_value) : '...'}
          sub={perfSummary
            ? <DeltaBadge current={perfSummary.avg_order_value} previous={perfSummary.prev_avg_order_value} />
            : 'Memuat...'}
        />
      </div>
      )}

      {/* Revenue by channel: stacked bar (left) + Profit per Channel list (right) */}
      <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-[var(--color-caleo-mist)] shadow-xl hover:shadow-2xl transition-all duration-300">
        <h4 className="text-lg font-bold text-[var(--color-caleo-primary)] mb-1">Revenue per Channel</h4>
        <p className="text-xs text-gray-400 mb-6">Breakdown harian dan profit margin per channel</p>
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Stacked bar — daily trend */}
          <div className="flex-1 h-[280px]">
            {revenueChartError ? (
              <div className="h-full flex items-center justify-center">
                <p className="text-sm text-red-600 italic" role="alert">Gagal memuat grafik revenue. Coba pilih periode lagi.</p>
              </div>
            ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyRevenueByChannel} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="Day" stroke="#94a3b8" fontSize={10} />
                <YAxis stroke="#94a3b8" fontSize={10} tickFormatter={(v) => v >= 1000000 ? `${(v/1000000).toFixed(0)}jt` : v >= 1000 ? `${(v/1000).toFixed(0)}rb` : v} />
                <Tooltip formatter={(value: unknown, name: string) => [formatRupiah(Number(value)), name]} />
                <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Bar dataKey="Walk-in" stackId="a" fill={colorForChannel('Walk-in')} />
                <Bar dataKey="Tokopedia" stackId="a" fill={colorForChannel('Tokopedia')} />
                <Bar dataKey="Grosir" stackId="a" fill={colorForChannel('Grosir')} />
                <Bar dataKey="WA AI" stackId="a" fill={colorForChannel('WA AI')} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            )}
          </div>

          {/* Right: Profit per Channel (replaces old channel-total donut) */}
          <div className="lg:w-64 flex flex-col">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Profit per Channel</p>
            {profitPerChannel === false ? (
              <p className="text-xs text-red-600 italic" role="alert">Gagal memuat data channel.</p>
            ) : profitPerChannel.length === 0 ? (
              <p className="text-xs text-gray-300 italic">Belum ada data</p>
            ) : (
              <div className="space-y-2">
                {profitPerChannel.map((row) => (
                  <div key={row.channel} className="border border-slate-100 rounded-sm p-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700">{row.channel}</span>
                      <span className="font-bold text-emerald-700">{Math.round(row.margin_pct)}%</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {formatRupiah(row.revenue)} · Profit {formatRupiah(row.gross_profit)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

        {/* Top products */}
        <div className="bg-white rounded-sm p-6 md:p-8 border border-[var(--color-caleo-mist)] shadow-xl">
          <h4 className="text-lg font-bold text-[var(--color-caleo-primary)] mb-4">Produk Terlaris</h4>
          {topProducts.length === 0 ? (
            <p className="text-sm text-gray-400 italic">
              {isSupabaseConfigured ? 'Belum ada data produk untuk periode ini.' : '—'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 uppercase border-b border-gray-100">
                  <th className="text-left pb-3 font-bold">#</th>
                  <th className="text-left pb-3 font-bold">Produk</th>
                  <th className="text-right pb-3 font-bold">Qty</th>
                  <th className="text-right pb-3 font-bold">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((p, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-[#f8f9ff] transition-colors">
                    <td className="py-3 text-gray-300 font-bold w-8">{i + 1}</td>
                    <td className="py-3 text-[var(--color-caleo-primary)] font-semibold">{p.name}</td>
                    <td className="py-3 text-right text-gray-600">{p.qty}</td>
                    <td className="py-3 text-right font-bold text-[#2d8a4e]">{formatRupiah(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Slow-moving stock */}
        <div className="bg-white rounded-sm p-6 md:p-8 border border-[var(--color-caleo-mist)] shadow-xl">
          <h4 className="text-lg font-bold text-[var(--color-caleo-primary)] mb-4">Produk Slow-Moving</h4>
          <p className="text-xs text-slate-500 mb-4">SKU dengan penjualan rendah dalam periode. Pertimbangkan bundling, diskon, atau retur ke supplier.</p>
          <SlowMoverTable days={days} />
        </div>

        {/* Top Customer */}
        <div className="bg-white rounded-sm p-6 md:p-8 border border-[var(--color-caleo-mist)] shadow-xl">
          <h4 className="text-lg font-bold text-[var(--color-caleo-primary)] mb-4">Top 10 Customer</h4>
          <p className="text-xs text-slate-500 mb-4">Customer dengan total belanja tertinggi dalam periode.</p>
          <TopCustomerTable days={days} />
        </div>

        {/* Layanan / Service Catalog performance */}
        <LayananSection days={days} />
      </div>
      )}

      {/* Akuntansi Tab */}
      {activeTab === 'akuntansi' && <AkuntansiLaporanTab showToast={showToast} onNavigate={props.onNavigate} />}
    </div>
  );
}
