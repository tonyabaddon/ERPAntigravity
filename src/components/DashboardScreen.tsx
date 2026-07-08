/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  ShoppingBag,
  Zap,
  AlertTriangle,
  ArrowUpRight,
  MessageSquare,
  CheckCircle2,
} from 'lucide-react';
import { useRealtimeConversations } from '../hooks/useRealtimeConversations';
import { statsService, reportsService, isSupabaseConfigured } from '../lib/supabaseClient';
import PreOrderFulfillmentsCard from './dashboard/PreOrderFulfillmentsCard';
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';

type Period = '7d' | '30d' | '90d';

function periodStart(p: Period): string {
  const d = new Date();
  d.setDate(d.getDate() - (p === '7d' ? 6 : p === '30d' ? 29 : 89));
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }) + 'T00:00:00+07:00';
}

function periodDays(p: Period): number {
  return p === '7d' ? 7 : p === '30d' ? 30 : 90;
}

function periodLabel(p: Period): string {
  return p === '7d' ? '7 Hari' : p === '30d' ? '30 Hari' : '90 Hari';
}

interface DashboardScreenProps {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onNavigate: (page: import('../types').ActivePage) => void;
  lowStockCount: number;
  storeName?: string;
}

export default function DashboardScreen({ showToast, onNavigate, lowStockCount, storeName }: DashboardScreenProps) {

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(val);
  };

  const { orders, paymentUploadedOrders } = useRealtimeConversations();

  const [period, setPeriod] = useState<Period>('7d');

  const [summary, setSummary] = useState<{
    revenue: number;
    orderCount: number;
    avgOrderValue: number;
    convCount: number;
    aiConvCount: number;
  } | null>(null);

  const [revenueByChannel, setRevenueByChannel] = useState<Array<{
    Day: string; 'Walk-in': number; Tokopedia: number; Grosir: number; 'WA AI': number;
  }>>([]);
  const [dailyConvs, setDailyConvs] = useState<Array<{ Day: string; 'Dijawab AI': number; 'Respon Manual': number }>>([]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const since = periodStart(period);
    const days = periodDays(period);
    setSummary(null);
    Promise.allSettled([
      reportsService.fetchSummary(since),
      reportsService.fetchDailyRevenueByChannel(since, days),
      reportsService.fetchDailyConversations(since, days),
    ]).then(([sumRes, revRes, convsRes]) => {
      if (sumRes.status === 'fulfilled') setSummary(sumRes.value);
      else console.error('fetchSummary failed:', sumRes.reason);
      if (revRes.status === 'fulfilled') setRevenueByChannel(revRes.value);
      else console.error('fetchDailyRevenueByChannel failed:', revRes.reason);
      if (convsRes.status === 'fulfilled') setDailyConvs(convsRes.value);
      else console.error('fetchDailyConversations failed:', convsRes.reason);
    });
  }, [period]);

  const [recentActivity, setRecentActivity] = useState<Array<{ text: string; sender: string; created_at: string }>>([]);

  useEffect(() => {
    if (isSupabaseConfigured) {
      statsService.fetchRecentActivity().then(setRecentActivity).catch(console.error);
    }
  }, []);

  const aiRate = summary
    ? Math.round((summary.aiConvCount / Math.max(summary.convCount, 1)) * 100)
    : 0;

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Top Welcome + Period Selector */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white/60 backdrop-blur-xl p-8 rounded-3xl border border-white/60 shadow-sm">
        <div>
          <span className="text-xs font-bold text-[#2d8a4e] uppercase bg-emerald-50 border border-emerald-100 px-3 py-1 rounded-full select-none">
            ⚡ Sistem Integrasi Aktif
          </span>
          <h2 className="text-[#012749] font-extrabold text-2xl tracking-tight mt-2">
            Selamat Datang di Hub Kendali {storeName || 'Toko Anda'}
          </h2>
          <p className="text-[#43474e] text-sm mt-1">
            Pantau ringkasan performa penjualan, otomasi chatbot WhatsApp, dan status inventaris Anda secara real-time.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {/* Period filter */}
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
                {periodLabel(p)}
              </button>
            ))}
          </div>
          <button
            onClick={() => onNavigate('sales-inbox')}
            className="px-6 py-3 bg-[#2d8a4e] text-white rounded-full text-xs font-bold shadow-lg shadow-[#2d8a4e]/20 hover:scale-105 transition-all cursor-pointer flex items-center gap-2"
          >
            <MessageSquare className="w-4 h-4" /> Buka Inbox Chat
          </button>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Stat 1: Revenue */}
        <div className="bg-white rounded-3xl p-6 border border-[#e5eeff] shadow-lg shadow-primary/5 hover:translate-y-[-4px] transition-all duration-300">
          <div className="flex justify-between items-start mb-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-[#1e3d60]">
              <TrendingUp className="w-6 h-6" />
            </div>
            <span className="text-xs font-bold text-[#2d8a4e] bg-emerald-50 px-2.5 py-1 rounded-full flex items-center gap-0.5">
              {summary ? 'Live' : '...'} <ArrowUpRight className="w-3.5 h-3.5" />
            </span>
          </div>
          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest block">Total Omset</span>
          <h3 className="text-[#012749] font-extrabold text-2xl tracking-tight mt-1">
            {summary ? formatRupiah(summary.revenue) : '...'}
          </h3>
          <p className="text-xs text-[#43474e] mt-2">Semua channel — {periodLabel(period)} terakhir</p>
        </div>

        {/* Stat 2: Orders */}
        <div className="bg-white rounded-3xl p-6 border border-[#e5eeff] shadow-lg shadow-primary/5 hover:translate-y-[-4px] transition-all duration-300">
          <div className="flex justify-between items-start mb-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center text-[#2d8a4e]">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full">
              Sukses
            </span>
          </div>
          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest block">Pesanan Terproses</span>
          <h3 className="text-[#012749] font-extrabold text-2xl tracking-tight mt-1">
            {summary ? `${summary.orderCount} Transaksi` : '...'}
          </h3>
          <p className="text-xs text-[#43474e] mt-2">{periodLabel(period)} terakhir (Kasir + WA AI)</p>
        </div>

        {/* Stat 3: Bot Efficiency */}
        <div className="bg-white rounded-3xl p-6 border border-[#e5eeff] shadow-lg shadow-primary/5 hover:translate-y-[-4px] transition-all duration-300">
          <div className="flex justify-between items-start mb-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600">
              <Zap className="w-6 h-6" />
            </div>
            <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full">
              Sangat Cerdas
            </span>
          </div>
          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest block">Otomasi Balasan AI</span>
          <h3 className="text-[#012749] font-extrabold text-2xl tracking-tight mt-1">
            {summary ? `${aiRate}% Efisiensi` : '... Efisiensi'}
          </h3>
          <p className="text-xs text-[#43474e] mt-2">
            {summary
              ? `${summary.aiConvCount} dari ${summary.convCount} chat ditangani AI`
              : 'Memuat data...'}
          </p>
        </div>

        {/* Stat 4: Low Stock Warnings */}
        <div className={`rounded-3xl p-6 border shadow-lg transition-all duration-300 hover:translate-y-[-4px] ${
          lowStockCount > 0
            ? 'bg-rose-50/50 border-rose-100 shadow-rose-50'
            : 'bg-white border-[#e5eeff] shadow-primary/5'
        }`}>
          <div className="flex justify-between items-start mb-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
              lowStockCount > 0 ? 'bg-rose-100 text-rose-700' : 'bg-gray-50 text-gray-400'
            }`}>
              <AlertTriangle className="w-6 h-6" />
            </div>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
              lowStockCount > 0 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-50 text-[#2d8a4e]'
            }`}>
              {lowStockCount > 0 ? 'Butuh Stok' : 'Aman'}
            </span>
          </div>
          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest block">Komoditas Stok Tipis</span>
          <h3 className="text-[#012749] font-extrabold text-2xl tracking-tight mt-1">
            {lowStockCount} Barang
          </h3>
          <p className="text-xs text-[#43474e] mt-2">
            {lowStockCount > 0 ? 'Picu reorder otomatis ke produsen sekarang' : 'Seluruh SKU berada di atas batas aman'}
          </p>
        </div>
      </div>

      {/* Recharts Graphical Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Panel 1: Revenue by Channel */}
        <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-[#e5eeff] shadow-xl hover:shadow-2xl transition-all duration-300">
          <div className="mb-6">
            <h4 className="text-lg font-bold text-[#012749]">Revenue per Channel — {periodLabel(period)}</h4>
            <p className="text-xs text-[#43474e] mt-0.5">Walk-in, Tokopedia, Grosir, dan WA AI digabungkan.</p>
          </div>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueByChannel} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="Day" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => v >= 1000000 ? `${(v/1000000).toFixed(0)}jt` : v >= 1000 ? `${(v/1000).toFixed(0)}rb` : v} />
                <Tooltip formatter={(value: any, name: string) => [formatRupiah(Number(value)), name]} />
                <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
                <Bar dataKey="Walk-in" stackId="a" fill="#2d8a4e" />
                <Bar dataKey="Tokopedia" stackId="a" fill="#f97316" />
                <Bar dataKey="Grosir" stackId="a" fill="#1e3d60" />
                <Bar dataKey="WA AI" stackId="a" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Panel 2: AI Chat Performance */}
        <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-[#e5eeff] shadow-xl hover:shadow-2xl transition-all duration-300">
          <div className="mb-6">
            <h4 className="text-lg font-bold text-[#012749]">Interaksi Balasan Chat Otomatis</h4>
            <p className="text-xs text-[#43474e] mt-0.5">Grafik volume chat yang dikelola AI Bot secara otomatis versus admin manual.</p>
          </div>
          <div className="h-[320px]">
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
      </div>

      {/* Pre-order fulfillments — last 7 days */}
      <PreOrderFulfillmentsCard showToast={showToast} />

      {/* Recent Activity Log */}
      <div className="bg-white p-8 rounded-[2.5rem] border border-[#e5eeff] shadow-xl">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h4 className="text-lg font-bold text-[#012749]">Detak Jantung Log Aktivitas AI</h4>
            <p className="text-xs text-[#43474e]">Aktivitas asisten AI dan status sinkronisasi e-commerce terkini.</p>
          </div>
          <span className="text-xs font-bold text-[#2d8a4e] flex items-center gap-1.5 bg-emerald-50 px-3 py-1 rounded-full">
            <span className="w-2 h-2 rounded-full bg-[#2d8a4e] animate-ping" />
            Sistem Sinkron
          </span>
        </div>

        <div className="space-y-4">
          {recentActivity.length === 0 ? (
            <div className="flex items-center gap-4 p-4 text-sm text-gray-400 italic">
              Belum ada aktivitas hari ini.
            </div>
          ) : recentActivity.map((item, i) => (
            <div key={i} className="flex items-center gap-4 p-4 hover:bg-[#f8f9ff] rounded-2xl transition-colors border border-transparent hover:border-blue-100">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 text-[#2d8a4e]">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-[#012749]">
                  {item.sender === 'ai' ? 'Pesan AI' : 'Sistem'}
                </p>
                <p className="text-xs text-[#43474e] line-clamp-2">{item.text}</p>
              </div>
              <span className="text-xs text-slate-400 font-medium shrink-0">
                {new Date(item.created_at).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
              </span>
            </div>
          ))}
        </div>
      </div>

      {(orders.length > 0 || paymentUploadedOrders.length > 0) && (
        <div className="flex gap-3 flex-wrap">
          {orders.length > 0 && (
            <button
              onClick={() => onNavigate('order-history')}
              className="flex items-center gap-2 bg-purple-100 text-purple-800 border border-purple-200 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-purple-200 transition-colors"
            >
              🔔 {orders.length} pesanan perlu konfirmasi
              <span className="text-purple-400 text-xs">→ Riwayat Pesanan</span>
            </button>
          )}
          {paymentUploadedOrders.length > 0 && (
            <button
              onClick={() => onNavigate('order-history')}
              className="flex items-center gap-2 bg-blue-100 text-blue-800 border border-blue-200 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-200 transition-colors"
            >
              📎 {paymentUploadedOrders.length} bukti bayar menunggu verifikasi
              <span className="text-blue-400 text-xs">→ Riwayat Pesanan</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
