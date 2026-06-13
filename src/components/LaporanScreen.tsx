import React, { useState, useEffect } from 'react';
import { TrendingUp, ShoppingBag, Receipt, Zap } from 'lucide-react';
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { reportsService, isSupabaseConfigured } from '../lib/supabaseClient';
import { CHANNEL_VISUAL } from '../lib/salesChannels';
import type { SalesChannel } from '../types';

function colorForChannel(name: string): string {
  const code = (Object.keys(CHANNEL_VISUAL) as SalesChannel[]).find(
    c => CHANNEL_VISUAL[c].label === name,
  );
  return code ? CHANNEL_VISUAL[code].brandColor : '#94a3b8';
}

type Period = '7d' | '30d' | '90d';

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

interface Summary {
  revenue: number;
  orderCount: number;
  avgOrderValue: number;
  convCount: number;
  aiConvCount: number;
}

export default function LaporanScreen() {
  const [period, setPeriod] = useState<Period>('30d');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [dailyRevenueByChannel, setDailyRevenueByChannel] = useState<Array<{
    Day: string; 'Walk-in': number; Tokopedia: number; Grosir: number; 'WA AI': number;
  }>>([]);
  const [channelTotals, setChannelTotals] = useState<Array<{ name: string; value: number }>>([]);
  const [dailyConvs, setDailyConvs] = useState<Array<{ Day: string; 'Dijawab AI': number; 'Respon Manual': number }>>([]);
  const [topProducts, setTopProducts] = useState<Array<{ name: string; qty: number; revenue: number }>>([]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const since = periodStart(period);
    const days = periodDays(period);
    setSummary(null);
    Promise.allSettled([
      reportsService.fetchSummary(since),
      reportsService.fetchDailyRevenueByChannel(since, days),
      reportsService.fetchChannelTotals(since),
      reportsService.fetchDailyConversations(since, days),
      reportsService.fetchTopProducts(since),
    ]).then(([sRes, revRes, chRes, convsRes, prodsRes]) => {
      if (sRes.status === 'fulfilled') setSummary(sRes.value);
      else console.error('fetchSummary failed:', sRes.reason);
      if (revRes.status === 'fulfilled') setDailyRevenueByChannel(revRes.value);
      else console.error('fetchDailyRevenueByChannel failed:', revRes.reason);
      if (chRes.status === 'fulfilled') setChannelTotals(chRes.value);
      else console.error('fetchChannelTotals failed:', chRes.reason);
      if (convsRes.status === 'fulfilled') setDailyConvs(convsRes.value);
      else console.error('fetchDailyConversations failed:', convsRes.reason);
      if (prodsRes.status === 'fulfilled') setTopProducts(prodsRes.value);
      else console.error('fetchTopProducts failed:', prodsRes.reason);
    });
  }, [period]);

  const aiRate = summary
    ? Math.round((summary.aiConvCount / Math.max(summary.convCount, 1)) * 100)
    : 0;

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header + period selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/60 backdrop-blur-xl p-8 rounded-3xl border border-white/60 shadow-sm">
        <div>
          <h2 className="text-[#012749] font-extrabold text-2xl tracking-tight">Laporan Performa</h2>
          <p className="text-xs text-gray-500 mt-0.5">Analisis pendapatan, pesanan, dan efisiensi AI</p>
        </div>
        <div className="flex gap-2">
          {(['7d', '30d', '90d'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${
                period === p
                  ? 'bg-[#012749] text-white shadow'
                  : 'bg-white border border-gray-200 text-gray-600 hover:border-[#012749]'
              }`}
            >
              {p === '7d' ? '7 Hari' : p === '30d' ? '30 Hari' : '90 Hari'}
            </button>
          ))}
        </div>
      </div>

      {!isSupabaseConfigured && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 text-sm text-yellow-800">
          ⚠️ Supabase belum dikonfigurasi. Tambahkan <code>VITE_SUPABASE_URL</code> dan <code>VITE_SUPABASE_ANON_KEY</code> ke file <code>.env</code>.
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <KpiCard
          icon={<TrendingUp className="w-6 h-6" />}
          iconBg="bg-blue-50 text-[#1e3d60]"
          badge="Revenue"
          badgeClass="text-[#2d8a4e] bg-emerald-50"
          label="Total Omset"
          value={summary ? formatRupiah(summary.revenue) : '...'}
          sub={`Pesanan terverifikasi`}
        />
        <KpiCard
          icon={<ShoppingBag className="w-6 h-6" />}
          iconBg="bg-emerald-50 text-[#2d8a4e]"
          badge="Selesai"
          badgeClass="text-blue-600 bg-blue-50"
          label="Pesanan Terproses"
          value={summary ? `${summary.orderCount} Transaksi` : '...'}
          sub="PAYMENT_VERIFIED"
        />
        <KpiCard
          icon={<Receipt className="w-6 h-6" />}
          iconBg="bg-amber-50 text-amber-600"
          badge="Rata-rata"
          badgeClass="text-amber-700 bg-amber-50"
          label="Nilai Rata-rata Pesanan"
          value={summary ? formatRupiah(summary.avgOrderValue) : '...'}
          sub="Per transaksi selesai"
        />
        <KpiCard
          icon={<Zap className="w-6 h-6" />}
          iconBg="bg-violet-50 text-violet-600"
          badge="AI"
          badgeClass="text-violet-700 bg-violet-50"
          label="Tingkat Otomasi AI"
          value={summary ? `${aiRate}%` : '...'}
          sub={summary ? `${summary.aiConvCount} dari ${summary.convCount} chat` : 'Memuat...'}
        />
      </div>

      {/* Top 3 Kanal */}
      {channelTotals.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          {channelTotals.slice(0, 3).map((c, idx) => (
            <div key={c.name} className="bg-white border border-slate-200 rounded-xl p-3">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">#{idx + 1} Kanal</div>
              <div className="mt-1 font-extrabold text-sm text-slate-800">{c.name}</div>
              <div className="text-xs font-semibold text-slate-600">Rp {c.value.toLocaleString('id-ID')}</div>
            </div>
          ))}
        </div>
      )}

      {/* Revenue by channel: stacked bar (left) + donut (right) */}
      <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-[#e5eeff] shadow-xl hover:shadow-2xl transition-all duration-300">
        <h4 className="text-lg font-bold text-[#012749] mb-1">Revenue per Channel</h4>
        <p className="text-xs text-gray-400 mb-6">Breakdown harian dan proporsi total periode</p>
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Stacked bar — daily trend */}
          <div className="flex-1 h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyRevenueByChannel} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="Day" stroke="#94a3b8" fontSize={10} />
                <YAxis stroke="#94a3b8" fontSize={10} tickFormatter={(v) => v >= 1000000 ? `${(v/1000000).toFixed(0)}jt` : v >= 1000 ? `${(v/1000).toFixed(0)}rb` : v} />
                <Tooltip formatter={(value: any, name: string) => [formatRupiah(Number(value)), name]} />
                <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Bar dataKey="Walk-in" stackId="a" fill="#2d8a4e" />
                <Bar dataKey="Tokopedia" stackId="a" fill="#f97316" />
                <Bar dataKey="Grosir" stackId="a" fill="#1e3d60" />
                <Bar dataKey="WA AI" stackId="a" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Donut — period totals */}
          <div className="lg:w-52 flex flex-col items-center justify-center">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Total Periode</p>
            {channelTotals.length === 0 ? (
              <p className="text-xs text-gray-300 italic">Belum ada data</p>
            ) : (
              <>
                <PieChart width={160} height={160}>
                  <Pie data={channelTotals} cx={80} cy={80} innerRadius={48} outerRadius={72} dataKey="value" paddingAngle={3}>
                    {channelTotals.map((c, i) => (
                      <Cell key={i} fill={colorForChannel(c.name)} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: any) => formatRupiah(Number(value))} />
                </PieChart>
                <div className="space-y-1.5 mt-2 w-full">
                  {channelTotals.map(c => (
                    <div key={c.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorForChannel(c.name) }} />
                        <span className="text-gray-600 font-medium">{c.name}</span>
                      </div>
                      <span className="font-bold text-gray-800">{formatRupiah(c.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* AI Chat chart */}
      <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-[#e5eeff] shadow-xl hover:shadow-2xl transition-all duration-300">
        <div className="mb-6">
          <h4 className="text-lg font-bold text-[#012749]">Interaksi Chat — AI vs Manual</h4>
          <p className="text-xs text-gray-400 mt-0.5">Volume percakapan harian berdasarkan mode penanganan</p>
        </div>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyConvs} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="Day" stroke="#94a3b8" fontSize={11} />
              <YAxis stroke="#94a3b8" fontSize={11} />
              <Tooltip />
              <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
              <Bar dataKey="Dijawab AI" fill="#2d8a4e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Respon Manual" fill="#abc9f3" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top products */}
      <div className="bg-white rounded-3xl p-6 md:p-8 border border-[#e5eeff] shadow-xl">
        <h4 className="text-lg font-bold text-[#012749] mb-4">Produk Terlaris</h4>
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
                  <td className="py-3 text-[#012749] font-semibold">{p.name}</td>
                  <td className="py-3 text-right text-gray-600">{p.qty}</td>
                  <td className="py-3 text-right font-bold text-[#2d8a4e]">{formatRupiah(p.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── KPI card helper ──────────────────────────────────────────────────────────

interface KpiCardProps {
  icon: React.ReactNode;
  iconBg: string;
  badge: string;
  badgeClass: string;
  label: string;
  value: string;
  sub: string;
}
function KpiCard({ icon, iconBg, badge, badgeClass, label, value, sub }: KpiCardProps) {
  return (
    <div className="bg-white rounded-3xl p-6 border border-[#e5eeff] shadow-lg shadow-primary/5 hover:translate-y-[-4px] transition-all duration-300">
      <div className="flex justify-between items-start mb-4">
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${iconBg}`}>
          {icon}
        </div>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${badgeClass}`}>{badge}</span>
      </div>
      <span className="text-xs font-bold text-gray-400 uppercase tracking-widest block">{label}</span>
      <h3 className="text-[#012749] font-extrabold text-2xl tracking-tight mt-1">{value}</h3>
      <p className="text-xs text-[#43474e] mt-2">{sub}</p>
    </div>
  );
}
