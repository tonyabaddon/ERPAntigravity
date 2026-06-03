import React, { useState, useEffect } from 'react';
import { ClipboardList, Search, ChevronDown } from 'lucide-react';
import { DbOrder } from '../types';
import { orderService, isSupabaseConfigured } from '../lib/supabaseClient';
import InvoiceModal from './InvoiceModal';

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

function ItemsTable({ items, headerClass }: { items: DbOrder['items']; headerClass: string }) {
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden text-xs mb-3">
      <div className={`grid grid-cols-4 px-3 py-2 font-bold uppercase tracking-wide text-[10px] ${headerClass}`}>
        <span>Produk</span>
        <span className="text-center">Qty</span>
        <span className="text-right">Harga</span>
        <span className="text-right">Subtotal</span>
      </div>
      {items.map((item, i) => (
        <div key={i} className="grid grid-cols-4 px-3 py-2 border-t border-gray-100 bg-white">
          <div>
            <div className="font-semibold text-gray-800">{item.name}</div>
            <div className="font-mono text-[9px] text-gray-400">{item.sku}</div>
          </div>
          <div className="text-center font-semibold">{item.qty}</div>
          <div className="text-right text-gray-500">Rp {item.unit_price.toLocaleString('id-ID')}</div>
          <div className="text-right font-bold text-gray-800">Rp {item.subtotal.toLocaleString('id-ID')}</div>
        </div>
      ))}
      <div className="flex justify-end gap-6 px-3 py-2 border-t-2 border-gray-200 bg-gray-50 text-[11px]">
        <div className="text-right text-gray-400 leading-relaxed">
          Subtotal<br />Ongkir<br /><strong className="text-gray-700">Total</strong>
        </div>
        <div className="text-right text-gray-600 leading-relaxed min-w-[90px]">
          Rp {items.reduce((s, i) => s + i.subtotal, 0).toLocaleString('id-ID')}
          <br />—
          <br /><strong className="text-gray-800">Rp {items.reduce((s, i) => s + i.subtotal, 0).toLocaleString('id-ID')} + ongkir</strong>
        </div>
      </div>
    </div>
  );
}

export default function OrderHistoryScreen({ currentUser, showToast }: OrderHistoryScreenProps) {
  const [orders, setOrders] = useState<DbOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [shippingFees, setShippingFees] = useState<Record<string, string>>({});
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [rejectingPaymentId, setRejectingPaymentId] = useState<string | null>(null);
  const [invoiceOrder, setInvoiceOrder] = useState<DbOrder | null>(null);

  const handleApprove = async (orderId: string, deliveryType: string | undefined) => {
    const fee = deliveryType === 'PICKUP' ? 0 : parseFloat(shippingFees[orderId] ?? '0');
    setApprovingId(orderId);
    try {
      await orderService.approveOrder(orderId, fee);
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'APPROVED', shipping_fee: fee } : o));
      setExpandedId(null);
      showToast('Pesanan berhasil disetujui.', 'success');
    } catch {
      showToast('Gagal menyetujui pesanan.', 'warning');
    } finally {
      setApprovingId(null);
    }
  };

  const handleRejectOrder = async (orderId: string) => {
    if (!window.confirm('Yakin tolak pesanan ini?')) return;
    setRejectingId(orderId);
    try {
      await orderService.rejectOrder(orderId);
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'CANCELLED' } : o));
      setExpandedId(null);
      showToast('Pesanan ditolak.', 'info');
    } catch {
      showToast('Gagal menolak pesanan.', 'warning');
    } finally {
      setRejectingId(null);
    }
  };

  const handleVerifyPayment = async (orderId: string) => {
    setVerifyingId(orderId);
    try {
      await orderService.verifyPayment(orderId, currentUser?.name ?? '');
      setOrders(prev => prev.map(o =>
        o.id === orderId
          ? { ...o, status: 'PAYMENT_VERIFIED', verified_by: currentUser?.name ?? '', payment_verified_at: new Date().toISOString() }
          : o
      ));
      setExpandedId(null);
      showToast('Pembayaran berhasil diverifikasi.', 'success');
    } catch {
      showToast('Gagal memverifikasi pembayaran.', 'warning');
    } finally {
      setVerifyingId(null);
    }
  };

  const handleRejectPayment = async (orderId: string) => {
    if (!window.confirm('Yakin tolak bukti bayar ini?')) return;
    setRejectingPaymentId(orderId);
    try {
      await orderService.rejectPayment(orderId);
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'PAYMENT_REJECTED' } : o));
      setExpandedId(null);
      showToast('Bukti bayar ditolak.', 'info');
    } catch {
      showToast('Gagal menolak bukti bayar.', 'warning');
    } finally {
      setRejectingPaymentId(null);
    }
  };

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

                {isExpanded && order.status === 'PENDING_ADMIN_CONFIRMATION' && (
                  <div className="px-5 py-4 border-t border-purple-200 bg-purple-50">
                    <div className="grid grid-cols-[1fr_auto] gap-5 items-start">
                      {/* Left: detail */}
                      <div>
                        <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
                          <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pelanggan</div><div className="font-semibold text-gray-700">{order.customer_name}</div></div>
                          <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">No. WA</div><div className="font-mono font-semibold text-gray-700">{order.customer_phone}</div></div>
                          <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pengiriman</div><div className="font-semibold text-gray-700">{order.delivery_type === 'PICKUP' ? '🏪 Pickup' : '🚚 Delivery'}</div></div>
                        </div>
                        <ItemsTable items={order.items} headerClass="bg-purple-100 text-purple-700" />
                        <div className="text-[10px] text-gray-400">⏱ Booking berakhir: {formatDate(order.booking_expires_at)}</div>
                      </div>
                      {/* Right: action */}
                      <div className="flex flex-col gap-2 min-w-[140px]">
                        <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 text-center">Tetapkan Ongkir</div>
                        {order.delivery_type === 'PICKUP' ? (
                          <div className="text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-2 text-center">Rp 0 (Pickup)</div>
                        ) : (
                          <div className="flex items-center gap-1.5 bg-gray-50 border border-purple-200 rounded-lg px-3 py-2">
                            <span className="text-gray-400 text-xs">Rp</span>
                            <input
                              type="number"
                              min="0"
                              className="flex-1 bg-transparent text-sm font-bold text-gray-700 outline-none w-20"
                              placeholder="0"
                              value={shippingFees[order.id] ?? ''}
                              onChange={e => setShippingFees(prev => ({ ...prev, [order.id]: e.target.value }))}
                            />
                          </div>
                        )}
                        <button
                          onClick={() => handleApprove(order.id, order.delivery_type)}
                          disabled={
                            approvingId === order.id ||
                            (order.delivery_type !== 'PICKUP' && (!shippingFees[order.id] || shippingFees[order.id] === ''))
                          }
                          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-purple-600 text-white text-xs font-bold rounded-lg hover:bg-purple-700 disabled:opacity-40"
                        >
                          {approvingId === order.id ? 'Memproses...' : '✓ Approve'}
                        </button>
                        <button
                          onClick={() => handleRejectOrder(order.id)}
                          disabled={rejectingId === order.id}
                          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-white text-red-600 text-xs font-bold rounded-lg border-2 border-red-200 hover:bg-red-50 disabled:opacity-40"
                        >
                          ✕ Tolak
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {isExpanded && order.status === 'PAYMENT_UPLOADED' && (
                  <div className="px-5 py-4 border-t border-blue-200 bg-blue-50">
                    <div className="grid grid-cols-[1fr_auto] gap-5 items-start">
                      <div>
                        <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
                          <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pelanggan</div><div className="font-semibold text-gray-700">{order.customer_name}</div></div>
                          <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">No. WA</div><div className="font-mono font-semibold text-gray-700">{order.customer_phone}</div></div>
                          <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pengiriman</div><div className="font-semibold text-gray-700">{order.delivery_type === 'PICKUP' ? '🏪 Pickup' : '🚚 Delivery'}</div></div>
                        </div>
                        <ItemsTable items={order.items} headerClass="bg-blue-100 text-blue-700" />
                        {/* Payment proof */}
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-2">Bukti Transfer</div>
                          <div className="flex items-start gap-3">
                            {order.payment_proof_url ? (
                              <img
                                src={order.payment_proof_url}
                                alt="Bukti bayar"
                                className="w-16 h-20 object-cover rounded-lg border-2 border-blue-200 cursor-pointer"
                                onClick={() => window.open(order.payment_proof_url!, '_blank')}
                              />
                            ) : (
                              <div className="w-16 h-20 bg-indigo-100 border-2 border-indigo-200 rounded-lg flex flex-col items-center justify-center gap-1">
                                <span className="text-indigo-400 text-lg">🖼</span>
                                <span className="text-[9px] text-indigo-400 font-semibold">Foto Bukti</span>
                              </div>
                            )}
                            <div>
                              {order.payment_proof_url && (
                                <a
                                  href={order.payment_proof_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-blue-600 font-semibold underline"
                                >
                                  Lihat Ukuran Penuh ↗
                                </a>
                              )}
                              <p className="text-[10px] text-gray-400 mt-1">
                                Dikirim {formatDate(order.updated_at)}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                      {/* Action */}
                      <div className="flex flex-col gap-2 min-w-[120px]">
                        <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 text-center">Tindakan</div>
                        <button
                          onClick={() => handleVerifyPayment(order.id)}
                          disabled={verifyingId === order.id}
                          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 disabled:opacity-40"
                        >
                          {verifyingId === order.id ? 'Memproses...' : '✓ Verifikasi'}
                        </button>
                        <button
                          onClick={() => handleRejectPayment(order.id)}
                          disabled={rejectingPaymentId === order.id}
                          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-white text-red-600 text-xs font-bold rounded-lg border-2 border-red-200 hover:bg-red-50 disabled:opacity-40"
                        >
                          ✕ Tolak
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {isExpanded && order.status === 'WAITING_PAYMENT' && (
                  <div className="px-5 py-4 border-t border-gray-100 bg-gray-50">
                    <div className="grid grid-cols-4 gap-3 mb-3 text-xs">
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pelanggan</div><div className="font-semibold text-gray-700">{order.customer_name}</div></div>
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">No. WA</div><div className="font-mono font-semibold text-gray-700">{order.customer_phone}</div></div>
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pengiriman</div><div className="font-semibold text-gray-700">{order.delivery_type === 'PICKUP' ? '🏪 Pickup' : '🚚 Delivery'}</div></div>
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Total</div><div className="font-bold text-gray-800">Rp {order.total.toLocaleString('id-ID')}</div></div>
                    </div>
                    <ItemsTable items={order.items} headerClass="bg-gray-100 text-gray-600" />
                  </div>
                )}
                {isExpanded && (order.status === 'PAYMENT_VERIFIED' || order.status === 'COMPLETED') && (
                  <div className="px-5 py-4 border-t border-gray-100 bg-gray-50">
                    <div className="grid grid-cols-4 gap-3 mb-3 text-xs">
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pelanggan</div><div className="font-semibold text-gray-700">{order.customer_name}</div></div>
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">No. WA</div><div className="font-mono font-semibold text-gray-700">{order.customer_phone}</div></div>
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pengiriman</div><div className="font-semibold text-gray-700">{order.delivery_type === 'PICKUP' ? '🏪 Pickup' : '🚚 Delivery'}</div></div>
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Diverifikasi Oleh</div>
                        <div className="font-semibold text-gray-700">
                          {order.verified_by ?? '—'}{order.payment_verified_at ? ` · ${formatDate(order.payment_verified_at)}` : ''}
                        </div>
                      </div>
                    </div>
                    <ItemsTable items={order.items} headerClass="bg-gray-100 text-gray-600" />
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <span className="text-xs text-gray-500">
                        ✅ Diverifikasi oleh {order.verified_by ?? '—'} · {order.payment_verified_at ? formatDate(order.payment_verified_at) : '—'}
                      </span>
                      <button
                        onClick={() => setInvoiceOrder(order)}
                        className="flex items-center gap-1.5 px-4 py-2 bg-white text-[#012749] text-xs font-bold rounded-lg border border-[#c7d7f5] hover:bg-blue-50"
                      >
                        📄 Lihat Invoice
                      </button>
                    </div>
                  </div>
                )}
                {isExpanded && (order.status === 'CANCELLED' || order.status === 'PAYMENT_REJECTED') && (
                  <div className="px-5 py-4 border-t border-gray-100 bg-gray-50">
                    <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pelanggan</div><div className="font-semibold text-gray-700">{order.customer_name}</div></div>
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">No. WA</div><div className="font-mono font-semibold text-gray-700">{order.customer_phone}</div></div>
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Total</div><div className="font-bold text-gray-400">Rp {order.total.toLocaleString('id-ID')}</div></div>
                    </div>
                    <ItemsTable items={order.items} headerClass="bg-gray-100 text-gray-600" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {invoiceOrder && (
        <InvoiceModal order={invoiceOrder} onClose={() => setInvoiceOrder(null)} />
      )}
    </div>
  );
}
