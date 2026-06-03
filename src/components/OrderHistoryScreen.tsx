import React, { useState, useEffect } from 'react';
import { ClipboardList, Search, ChevronDown } from 'lucide-react';
import { DbOrder } from '../types';
import { orderService, isSupabaseConfigured } from '../lib/supabaseClient';

interface OrderHistoryScreenProps {
  currentUser: { name: string; role: string; avatarUrl: string; storeName: string } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type FilterTab = 'all' | 'pending' | 'waiting' | 'uploaded' | 'done' | 'cancelled';

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  PENDING_ADMIN_CONFIRMATION: { label: '🔔 Perlu Konfirmasi', className: 'bg-purple-100 text-purple-800' },
  PENDING_PRICE_NEGO:         { label: '💬 Nego Harga',       className: 'bg-orange-100 text-orange-800' },
  PENDING_STOCK_CHECK:        { label: '📦 Cek Stok',         className: 'bg-orange-100 text-orange-800' },
  PENDING_CUSTOM_QUOTE:       { label: '📐 Custom Quote',     className: 'bg-orange-100 text-orange-800' },
  PENDING_WIRING_QUOTE:       { label: '🔌 Wiring Quote',     className: 'bg-orange-100 text-orange-800' },
  APPROVED:                   { label: '✓ Disetujui',         className: 'bg-teal-100 text-teal-800' },
  WAITING_PAYMENT:            { label: '⏳ Menunggu Bayar',   className: 'bg-yellow-100 text-yellow-800' },
  PAYMENT_UPLOADED:           { label: '📎 Bukti Dikirim',    className: 'bg-blue-100 text-blue-800' },
  PAYMENT_VERIFIED:           { label: '✓ Selesai',           className: 'bg-green-100 text-green-800' },
  COMPLETED:                  { label: '✓ Selesai',           className: 'bg-green-100 text-green-800' },
  PAYMENT_REJECTED:           { label: '✕ Bayar Ditolak',     className: 'bg-rose-100 text-rose-800' },
  CANCELLED:                  { label: '✕ Dibatalkan',        className: 'bg-red-100 text-red-800' },
};

const TOTAL_COLOR: Record<string, string> = {
  PENDING_ADMIN_CONFIRMATION: 'text-purple-700',
  WAITING_PAYMENT:            'text-yellow-700',
  PAYMENT_UPLOADED:           'text-blue-700',
  PAYMENT_VERIFIED:           'text-green-700',
  COMPLETED:                  'text-green-700',
  PAYMENT_REJECTED:           'text-gray-400',
  CANCELLED:                  'text-gray-400',
};

const LEFT_BORDER: Record<string, string> = {
  PENDING_ADMIN_CONFIRMATION: 'border-l-4 border-l-purple-500',
  PAYMENT_UPLOADED:           'border-l-4 border-l-blue-500',
};

function filterOrders(orders: DbOrder[], tab: FilterTab, search: string): DbOrder[] {
  let filtered = orders;
  if (tab === 'pending')   filtered = orders.filter(o => o.status === 'PENDING_ADMIN_CONFIRMATION');
  if (tab === 'waiting')   filtered = orders.filter(o => o.status === 'WAITING_PAYMENT');
  if (tab === 'uploaded')  filtered = orders.filter(o => o.status === 'PAYMENT_UPLOADED');
  if (tab === 'done')      filtered = orders.filter(o => o.status === 'PAYMENT_VERIFIED' || o.status === 'COMPLETED');
  if (tab === 'cancelled') filtered = orders.filter(o => o.status === 'CANCELLED' || o.status === 'PAYMENT_REJECTED');
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter(o =>
      o.customer_name.toLowerCase().includes(q) ||
      (o.gjp_order_id ?? '').toLowerCase().includes(q) ||
      o.customer_phone.includes(q)
    );
  }
  return filtered;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function ItemPill({ items }: { items: DbOrder['items'] }) {
  if (!items || items.length === 0) return null;
  return (
    <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full text-xs">
      {items[0].name}{items.length > 1 ? <strong> +{items.length - 1}</strong> : null}
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
      <ClipboardList className="w-10 h-10 text-gray-200 mx-auto mb-3" />
      <p className="text-sm font-semibold text-gray-400">{message}</p>
    </div>
  );
}

const EMPTY_MESSAGES: Record<FilterTab, string> = {
  all:       'Belum ada pesanan.',
  pending:   'Tidak ada pesanan yang perlu dikonfirmasi.',
  waiting:   'Tidak ada pesanan yang menunggu pembayaran.',
  uploaded:  'Tidak ada bukti bayar menunggu verifikasi.',
  done:      'Belum ada pesanan yang selesai.',
  cancelled: 'Tidak ada pesanan yang dibatalkan.',
};

export default function OrderHistoryScreen({ currentUser, showToast }: OrderHistoryScreenProps) {
  const [orders, setOrders] = useState<DbOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    orderService.fetchAll()
      .then(setOrders)
      .catch(() => showToast('Gagal memuat pesanan.', 'warning'))
      .finally(() => setLoading(false));
  }, []);

  const pendingCount   = orders.filter(o => o.status === 'PENDING_ADMIN_CONFIRMATION').length;
  const uploadedCount  = orders.filter(o => o.status === 'PAYMENT_UPLOADED').length;
  const waitingCount   = orders.filter(o => o.status === 'WAITING_PAYMENT').length;
  const doneCount      = orders.filter(o => o.status === 'PAYMENT_VERIFIED' || o.status === 'COMPLETED').length;
  const cancelledCount = orders.filter(o => o.status === 'CANCELLED' || o.status === 'PAYMENT_REJECTED').length;

  const visible = filterOrders(orders, tab, search);

  const tabs: { id: FilterTab; label: string; count: number; dot?: boolean }[] = [
    { id: 'all',       label: 'Semua',            count: orders.length },
    { id: 'pending',   label: 'Perlu Konfirmasi', count: pendingCount },
    { id: 'waiting',   label: 'Menunggu Bayar',   count: waitingCount },
    { id: 'uploaded',  label: 'Bukti Dikirim',    count: uploadedCount, dot: uploadedCount > 0 },
    { id: 'done',      label: 'Selesai',           count: doneCount },
    { id: 'cancelled', label: 'Dibatalkan',        count: cancelledCount },
  ];

  if (!isSupabaseConfigured) {
    return (
      <div className="space-y-6 animate-fadeIn">
        <div className="flex items-center gap-3">
          <ClipboardList className="w-6 h-6 text-gray-700" />
          <h1 className="text-2xl font-bold text-gray-800">Riwayat Pesanan</h1>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-yellow-800 text-sm font-medium">
          Supabase belum dikonfigurasi.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <ClipboardList className="w-6 h-6 text-gray-700 shrink-0" />
        <h1 className="text-2xl font-bold text-gray-800">Riwayat Pesanan</h1>
        <div className="ml-auto flex gap-2 flex-wrap">
          {pendingCount > 0 && (
            <span className="bg-purple-100 text-purple-800 border border-purple-200 px-3 py-1 rounded-full text-xs font-bold">
              🔔 {pendingCount} pesanan perlu konfirmasi
            </span>
          )}
          {uploadedCount > 0 && (
            <span className="bg-blue-100 text-blue-800 border border-blue-200 px-3 py-1 rounded-full text-xs font-bold">
              📎 {uploadedCount} bukti bayar menunggu verifikasi
            </span>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold border transition-all ${
              tab === t.id
                ? 'bg-[#012749] text-white border-[#012749]'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
            }`}
          >
            {t.label} ({t.count})
            {t.dot && (
              <span className="bg-amber-400 text-amber-900 rounded-full px-1.5 text-[9px] font-black">!</span>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-400">
        <Search className="w-4 h-4 shrink-0" />
        <input
          className="flex-1 bg-transparent outline-none text-gray-700 placeholder:text-gray-400"
          placeholder="Cari nama pelanggan, GJP Order ID, nomor WA..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">Memuat...</div>
      ) : visible.length === 0 ? (
        <EmptyState message={EMPTY_MESSAGES[tab]} />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {visible.map(order => {
            const badge   = STATUS_BADGE[order.status] ?? { label: order.status, className: 'bg-gray-100 text-gray-600' };
            const totalCl = TOTAL_COLOR[order.status] ?? 'text-gray-700';
            const borderCl = LEFT_BORDER[order.status] ?? 'border-l-4 border-l-transparent';
            const isDimmed = order.status === 'CANCELLED' || order.status === 'PAYMENT_REJECTED';
            const isExpanded = expandedId === order.id;

            return (
              <div key={order.id} className={`border-b border-gray-100 last:border-0 ${borderCl} ${isDimmed ? 'opacity-55' : ''}`}>
                {/* Collapsed row */}
                <div
                  className={`flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${isExpanded ? 'bg-gray-50' : ''}`}
                  onClick={() => setExpandedId(isExpanded ? null : order.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm text-gray-800">{order.customer_name}</div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      <span className="text-xs text-gray-400 font-mono">{order.gjp_order_id ?? order.id.slice(0, 8)}</span>
                      <span className="text-gray-300 text-xs">·</span>
                      <span className="text-xs text-gray-400">{formatDate(order.created_at)}</span>
                      <span className="text-gray-300 text-xs">·</span>
                      <ItemPill items={order.items} />
                    </div>
                  </div>
                  <div className={`text-sm font-extrabold shrink-0 ${totalCl}`}>
                    Rp {order.total.toLocaleString('id-ID')}
                  </div>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${badge.className}`}>
                    {badge.label}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </div>

                {/* Expanded body placeholder — filled in Tasks 5–7 */}
                {isExpanded && (
                  <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 text-xs text-gray-400">
                    [expanded row — {order.status}]
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
