/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  MessageSquare,
  CheckCircle2,
} from 'lucide-react';
import { useRealtimeConversations } from '../hooks/useRealtimeConversations';
import { statsService, isSupabaseConfigured } from '../lib/supabaseClient';
import PreOrderFulfillmentsCard from './dashboard/PreOrderFulfillmentsCard';
import PromoProdukCard from './dashboard/PromoProdukCard';
import TodayStripCard from './dashboard/TodayStripCard';
import DashboardMaintenanceSection from './dashboard/DashboardMaintenanceSection';
import MaintenanceCard from './dashboard/MaintenanceCard';

interface DashboardScreenProps {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onNavigate: (page: import('../types').ActivePage) => void;
  lowStockCount: number;
  /**
   * Store display name. `null` = still loading (bootstrap_tenant_context
   * RPC hasn't resolved); render an nbsp placeholder to avoid the
   * `'Toko Anda'` fallback flash on post-login reload.
   */
  storeName?: string | null;
}

export default function DashboardScreen({ showToast, onNavigate, lowStockCount, storeName }: DashboardScreenProps) {

  const { orders, paymentUploadedOrders } = useRealtimeConversations();

  const [recentActivity, setRecentActivity] = useState<Array<{ text: string; sender: string; created_at: string }>>([]);

  useEffect(() => {
    if (isSupabaseConfigured) {
      statsService.fetchRecentActivity().then(setRecentActivity).catch(console.error);
    }
  }, []);

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Top Welcome */}
      <div className="bg-white/60 backdrop-blur-xl p-8 rounded-3xl border border-white/60 shadow-sm">
        <div>
          <span className="text-xs font-bold text-[#2d8a4e] uppercase bg-emerald-50 border border-emerald-100 px-3 py-1 rounded-full select-none">
            Sistem Integrasi Aktif
          </span>
          <h2 className="text-[#012749] font-extrabold text-2xl tracking-tight mt-2">
            {/* `storeName === null` = loading (bootstrap RPC in flight);
                render nbsp to keep layout height stable without flashing
                the 'Toko Anda' fallback. */}
            Selamat Datang di Hub Kendali {storeName === null ? ' ' : (storeName || 'Toko Anda')}
          </h2>
          <p className="text-[#43474e] text-sm mt-1">
            Pantau tindakan yang perlu Anda ambil dan status inventaris.
          </p>
          <div className="mt-3">
            <TodayStripCard />
          </div>
        </div>
        <div className="mt-4">
          <button
            onClick={() => onNavigate('sales-inbox')}
            className="px-6 py-3 bg-[#2d8a4e] text-white rounded-full text-xs font-bold shadow-lg shadow-[#2d8a4e]/20 hover:scale-105 transition-all cursor-pointer flex items-center gap-2"
          >
            <MessageSquare className="w-4 h-4" /> Buka Inbox Chat
          </button>
        </div>
      </div>

      {/* Perlu Perhatian: maintenance action cards */}
      <section>
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Perlu Perhatian</h3>
        <DashboardMaintenanceSection onNavigate={(s) => onNavigate(s as import('../types').ActivePage)} />
      </section>

      {/* Antrean Kerja */}
      <section>
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Antrean Kerja</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <PromoProdukCard onNavigateToPengaturan={() => onNavigate('settings')} />
          <PreOrderFulfillmentsCard showToast={showToast} />
          <MaintenanceCard
            icon={<AlertTriangle className="w-5 h-5" />}
            title="Stok tipis"
            count={lowStockCount}
            detail={`${lowStockCount} SKU perlu reorder`}
            ctaLabel="Buka Produk & Stok"
            onCta={() => onNavigate('ai-stock')}
            badgeVariant={lowStockCount > 20 ? 'rose' : 'amber'}
          />
        </div>
      </section>

      {/* Aktivitas Sistem */}
      <section>
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
      </section>

      {(orders.length > 0 || paymentUploadedOrders.length > 0) && (
        <div className="flex gap-3 flex-wrap">
          {orders.length > 0 && (
            <button
              onClick={() => onNavigate('order-history')}
              className="flex items-center gap-2 bg-purple-100 text-purple-800 border border-purple-200 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-purple-200 transition-colors"
            >
              {orders.length} pesanan perlu konfirmasi
              <span className="text-purple-400 text-xs">Riwayat Pesanan</span>
            </button>
          )}
          {paymentUploadedOrders.length > 0 && (
            <button
              onClick={() => onNavigate('order-history')}
              className="flex items-center gap-2 bg-blue-100 text-blue-800 border border-blue-200 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-200 transition-colors"
            >
              {paymentUploadedOrders.length} bukti bayar menunggu verifikasi
              <span className="text-blue-400 text-xs">Riwayat Pesanan</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
