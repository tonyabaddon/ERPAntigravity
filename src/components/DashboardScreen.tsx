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
  Clock,
  MessageSquare,
  CheckCircle2,
  Image,
} from 'lucide-react';
import { useRealtimeConversations } from '../hooks/useRealtimeConversations';
import { DbOrder } from '../types';
import { statsService, isSupabaseConfigured } from '../lib/supabaseClient';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend
} from 'recharts';

interface DashboardScreenProps {
  onPageChange: (page: any) => void;
  lowStockCount: number;
}

const WEEKLY_REVENUE_DATA = [
  { Day: 'Sen', Revenue: 1850000, Orders: 8 },
  { Day: 'Sel', Revenue: 2100000, Orders: 11 },
  { Day: 'Rab', Revenue: 2450000, Orders: 14 },
  { Day: 'Kam', Revenue: 1950000, Orders: 9 },
  { Day: 'Jum', Revenue: 3100000, Orders: 15 },
  { Day: 'Sab', Revenue: 3840000, Orders: 18 },
  { Day: 'Min', Revenue: 4200000, Orders: 22 },
];

const BOT_PERFORMANCE_DATA = [
  { Day: 'Sen', 'Dijawab AI': 45, 'Respon Manual': 12 },
  { Day: 'Sel', 'Dijawab AI': 58, 'Respon Manual': 8 },
  { Day: 'Rab', 'Dijawab AI': 62, 'Respon Manual': 15 },
  { Day: 'Kam', 'Dijawab AI': 49, 'Respon Manual': 10 },
  { Day: 'Jum', 'Dijawab AI': 78, 'Respon Manual': 22 },
  { Day: 'Sab', 'Dijawab AI': 92, 'Respon Manual': 16 },
  { Day: 'Min', 'Dijawab AI': 105, 'Respon Manual': 5 },
];

export default function DashboardScreen({ onPageChange, lowStockCount }: DashboardScreenProps) {
  
  // Format numeric Rupiah
  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(val);
  };

  const { orders, paymentUploadedOrders: rawPaymentOrders, approveOrder, verifyPayment: verifyPaymentFn, rejectPayment: rejectPaymentFn } = useRealtimeConversations();
  const [paymentUploadedOrders, setPaymentUploadedOrders] = React.useState<typeof rawPaymentOrders>([]);

  React.useEffect(() => {
    setPaymentUploadedOrders(rawPaymentOrders);
  }, [rawPaymentOrders]);

  const [shippingFees, setShippingFees] = useState<Record<string, string>>({});
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const [stats, setStats] = useState<{
    verifiedOrdersTotal: number;
    verifiedOrdersCount: number;
    totalConversationsToday: number;
    aiConversationsToday: number;
  } | null>(null);

  useEffect(() => {
    if (isSupabaseConfigured) {
      statsService.fetchTodayStats().then(setStats).catch(console.error);
    }
  }, []);

  const [recentActivity, setRecentActivity] = useState<Array<{ text: string; sender: string; created_at: string }>>([]);

  useEffect(() => {
    if (isSupabaseConfigured) {
      statsService.fetchRecentActivity().then(setRecentActivity).catch(console.error);
    }
  }, []);

  useEffect(() => {
    orders.forEach(order => {
      if (order.delivery_type === 'PICKUP') {
        setShippingFees(prev => {
          if (prev[order.id] !== undefined) return prev;
          return { ...prev, [order.id]: '0' };
        });
      }
    });
  }, [orders]);

  const handleApprove = async (orderId: string) => {
    const fee = parseFloat(shippingFees[orderId] ?? '0');
    setApprovingId(orderId);
    try {
      await approveOrder(orderId, fee);
    } finally {
      setApprovingId(null);
    }
  };

  const handleVerify = async (orderId: string) => {
    const order = paymentUploadedOrders.find(o => o.id === orderId);
    setPaymentUploadedOrders(prev => prev.filter(o => o.id !== orderId));
    try {
      await verifyPaymentFn(orderId);
    } catch (err) {
      console.error('verifyPayment failed:', err);
      if (order) setPaymentUploadedOrders(prev => [...prev, order]);
    }
  };

  const handleReject = async (orderId: string) => {
    const order = paymentUploadedOrders.find(o => o.id === orderId);
    setPaymentUploadedOrders(prev => prev.filter(o => o.id !== orderId));
    try {
      await rejectPaymentFn(orderId);
    } catch (err) {
      console.error('rejectPayment failed:', err);
      if (order) setPaymentUploadedOrders(prev => [...prev, order]);
    }
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Top Welcome Action Bar */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white/60 backdrop-blur-xl p-8 rounded-3xl border border-white/60 shadow-sm">
        <div>
          <span className="text-xs font-bold text-[#2d8a4e] uppercase bg-emerald-50 border border-emerald-100 px-3 py-1 rounded-full select-none">
            ⚡ Sistem Integrasi Aktif
          </span>
          <h2 className="text-[#012749] font-extrabold text-2xl tracking-tight mt-2">
            Selamat Datang di Hub Kendali Sinar Elektrik
          </h2>
          <p className="text-[#43474e] text-sm mt-1">
            Pantau ringkasan performa penjualan, otomasi chatbot WhatsApp, dan status inventaris Anda secara real-time.
          </p>
        </div>

        <div className="flex gap-3">
          <button 
            onClick={() => onPageChange('sales-inbox')}
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
              {stats ? 'Live' : '...'} <ArrowUpRight className="w-3.5 h-3.5" />
            </span>
          </div>
          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest block">Total Omset (Hari Ini)</span>
          <h3 className="text-[#012749] font-extrabold text-2xl tracking-tight mt-1">
            {formatRupiah(stats?.verifiedOrdersTotal ?? 0)}
          </h3>
          <p className="text-xs text-[#43474e] mt-2">Pesanan PAYMENT_VERIFIED hari ini</p>
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
            {(stats?.verifiedOrdersCount ?? 0)} Transaksi
          </h3>
          <p className="text-xs text-[#43474e] mt-2">Diverifikasi &amp; dipack otomatis oleh AI</p>
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
            {stats
              ? Math.round((stats.aiConversationsToday / Math.max(stats.totalConversationsToday, 1)) * 100) + '% Efisiensi'
              : '... Efisiensi'}
          </h3>
          <p className="text-xs text-[#43474e] mt-2">
            {stats
              ? `${stats.aiConversationsToday} dari ${stats.totalConversationsToday} chat ditangani AI hari ini`
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
        {/* Panel 1: Revenue Area Chart */}
        <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-[#e5eeff] shadow-xl hover:shadow-2xl transition-all duration-300">
          <div className="mb-6">
            <h4 className="text-lg font-bold text-[#012749]">Tren Omset &amp; Jumlah Pesanan Mingguan</h4>
            <p className="text-xs text-[#43474e] mt-0.5">Menunjukkan perbandingan pendapatan harian dari Senin s.d S Minggu ini.</p>
          </div>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={WEEKLY_REVENUE_DATA} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1e3d60" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#1e3d60" stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="Day" stroke="#94a3b8" fontSize={11} fontStyle="bold" />
                <YAxis stroke="#94a3b8" fontSize={11} />
                <Tooltip formatter={(value: any) => [formatRupiah(Number(value)), 'Omset']} />
                <Area type="monotone" dataKey="Revenue" stroke="#1e3d60" strokeWidth={3} fillOpacity={1} fill="url(#colorRevenue)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Panel 2: Bot Performance Comparison */}
        <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-[#e5eeff] shadow-xl hover:shadow-2xl transition-all duration-300">
          <div className="mb-6">
            <h4 className="text-lg font-bold text-[#012749]">Interaksi Balasan Chat Otomatis</h4>
            <p className="text-xs text-[#43474e] mt-0.5">Grafik volume chat yang dikelola AI Bot secara otomatis versus admin manual.</p>
          </div>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={BOT_PERFORMANCE_DATA} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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

      {/* Real-time System Audit Trails */}
      <div className="bg-white p-8 rounded-[2.5rem] border border-[#e5eeff] shadow-xl">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h4 className="text-lg font-bold text-[#012749]">Detak Jantung Log Aktivitas AI</h4>
            <p className="text-xs text-[#43474e]">Aktivas asisten AI dan status sinkronisasi e-commerce terkini.</p>
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

      {/* Pending Orders Panel */}
      {orders.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-500" />
            Pesanan Menunggu Persetujuan ({orders.length})
          </h2>
          <div className="space-y-3">
            {orders.map(order => (
              <div key={order.id} className="bg-white rounded-xl border border-amber-200 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-800">{order.customer_name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs font-mono text-gray-400">
                        {order.gjp_order_id ?? order.id.slice(0, 8)}
                      </p>
                      {order.delivery_type && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          order.delivery_type === 'PICKUP'
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-amber-50 text-amber-700'
                        }`}>
                          {order.delivery_type === 'PICKUP' ? 'Ambil Sendiri' : 'Pengiriman'}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">{order.customer_company} · {order.customer_address}</p>
                    <p className="text-sm text-gray-500">{order.customer_phone}</p>
                    <div className="mt-2 space-y-0.5">
                      {order.items.map((item, i) => (
                        <p key={i} className="text-sm text-gray-700">
                          {item.name} × {item.qty} @ Rp {item.unit_price.toLocaleString('id-ID')} = Rp {item.subtotal.toLocaleString('id-ID')}
                        </p>
                      ))}
                    </div>
                    <p className="mt-1 text-sm font-medium text-gray-800">
                      Subtotal: Rp {order.subtotal.toLocaleString('id-ID')}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      Berakhir: {new Date(order.booking_expires_at).toLocaleString('id-ID')}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">Ongkir (Rp):</span>
                      {order.delivery_type === 'PICKUP' ? (
                        <span className="w-28 text-sm font-semibold text-gray-500 px-2 py-1">Rp 0 (Pickup)</span>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          className="w-28 border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                          placeholder="0"
                          value={shippingFees[order.id] ?? ''}
                          onChange={e => setShippingFees(prev => ({ ...prev, [order.id]: e.target.value }))}
                        />
                      )}
                    </div>
                    <button
                      onClick={() => handleApprove(order.id)}
                      disabled={approvingId === order.id || shippingFees[order.id] === undefined || shippingFees[order.id] === ''}
                      className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-40"
                    >
                      {approvingId === order.id ? 'Memproses...' : '✓ Setujui'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payment Verification Panel */}
      {paymentUploadedOrders.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
            <Image className="w-5 h-5 text-emerald-600" />
            Bukti Pembayaran Menunggu Verifikasi ({paymentUploadedOrders.length})
          </h2>
          <div className="space-y-3">
            {paymentUploadedOrders.map(order => (
              <PaymentVerificationCard
                key={order.id}
                order={order}
                onVerify={() => handleVerify(order.id)}
                onReject={() => handleReject(order.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface PaymentVerificationCardProps {
  order: DbOrder;
  onVerify: () => Promise<void>;
  onReject: () => Promise<void>;
}

function PaymentVerificationCard({ order, onVerify, onReject }: PaymentVerificationCardProps) {
  const [verifying, setVerifying] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);

  const handleVerify = async () => {
    setVerifying(true);
    try { await onVerify(); } finally { setVerifying(false); }
  };

  const handleReject = async () => {
    setRejecting(true);
    try { await onReject(); } finally { setRejecting(false); }
  };

  return (
    <div className="bg-white rounded-xl border border-emerald-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-gray-800">{order.customer_name}</p>
            <p className="text-xs font-mono text-gray-400">{order.gjp_order_id ?? order.id.slice(0, 8)}</p>
          </div>
          <p className="text-sm text-gray-500">{order.customer_company} · {order.customer_phone}</p>
          <p className="mt-1 text-sm font-semibold text-gray-800">
            Total: Rp {order.total.toLocaleString('id-ID')}
          </p>

          {/* Payment proof */}
          <div className="mt-3">
            {order.payment_proof_url ? (
              <div className="space-y-1">
                <a
                  href={order.payment_proof_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-600 underline font-medium"
                >
                  Lihat Bukti Transfer ↗
                </a>
                <img
                  src={order.payment_proof_url}
                  alt="Bukti pembayaran"
                  className="max-h-32 rounded object-contain border border-gray-100"
                />
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">Belum ada foto bukti transfer</p>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2 shrink-0">
          <button
            onClick={handleVerify}
            disabled={verifying || rejecting}
            className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-40"
          >
            {verifying ? 'Memproses...' : '✓ Verifikasi'}
          </button>
          <button
            onClick={handleReject}
            disabled={verifying || rejecting}
            className="px-4 py-2 bg-red-500 text-white text-sm font-semibold rounded-lg hover:bg-red-600 disabled:opacity-40"
          >
            {rejecting ? 'Memproses...' : '✕ Tolak'}
          </button>
        </div>
      </div>
    </div>
  );
}
