import React, { useState, useEffect, useMemo } from 'react';
import { ClipboardList, Search, ChevronDown } from 'lucide-react';
import { DbOrder, KasirTransaction, SalesEntry, SalesChannel } from '../types';
import OrderBnlSection from './pembelian/bnl/OrderBnlSection';
import { orderService, salesEntriesService, isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { mergeSalesEntries, CHANNEL_LABEL, CHANNEL_BADGE_CLASS } from '../lib/salesEntries';
import { CHANNEL_GROUPS, CHANNEL_VISUAL, getChannelDef } from '../lib/salesChannels';
import { useSalesChannels } from '../contexts/SalesChannelsContext';
import { useTenant } from '../contexts/TenantContext';
import InvoiceModal from './InvoiceModal';
import { StorageLink } from './ui/StorageLink';
import { StorageImage } from './ui/StorageImage';
import { formatIDR } from '../lib/formatIDR';

type ChannelFilterGroup = 'all' | 'offline' | 'marketplace' | 'direct';
type ChannelFilter = ChannelFilterGroup | SalesChannel;

interface OrderHistoryScreenProps {
  currentUser: { name: string; role: string; avatarUrl: string; storeName: string; gender?: 'M' | 'F' | 'N' } | null;
  onOpenCustomer: (customerId: string) => void;
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
  WAITING_DP:                 { label: '⏳ Menunggu DP',      className: 'bg-yellow-100 text-yellow-800' },
  DP_UPLOADED:                { label: '📎 Bukti DP Dikirim', className: 'bg-indigo-100 text-indigo-800' },
  DP_VERIFIED:                { label: '✓ DP Lunas',          className: 'bg-teal-100 text-teal-800' },
  DP_PROOF_REJECTED:          { label: '✕ DP Ditolak',        className: 'bg-red-100 text-red-800' },
  PAYMENT_UPLOADED:           { label: '📎 Bukti Dikirim',    className: 'bg-blue-100 text-blue-800' },
  PAYMENT_VERIFIED:           { label: '✓ Selesai',           className: 'bg-green-100 text-green-800' },
  COMPLETED:                  { label: '✓ Selesai',           className: 'bg-green-100 text-green-800' },
  PAYMENT_REJECTED:           { label: '✕ Bayar Ditolak',     className: 'bg-rose-100 text-rose-800' },
  CANCELLED:                  { label: '✕ Dibatalkan',        className: 'bg-red-100 text-red-800' },
};

const TOTAL_COLOR: Record<string, string> = {
  PENDING_ADMIN_CONFIRMATION: 'text-purple-700',
  WAITING_PAYMENT:            'text-yellow-700',
  WAITING_DP:                 'text-yellow-700',
  DP_UPLOADED:                'text-indigo-700',
  DP_VERIFIED:                'text-teal-700',
  DP_PROOF_REJECTED:          'text-red-700',
  PAYMENT_UPLOADED:           'text-blue-700',
  PAYMENT_VERIFIED:           'text-green-700',
  COMPLETED:                  'text-green-700',
  PAYMENT_REJECTED:           'text-gray-400',
  CANCELLED:                  'text-gray-400',
};

const LEFT_BORDER: Record<string, string> = {
  PENDING_ADMIN_CONFIRMATION: 'border-l-4 border-l-purple-500',
  PAYMENT_UPLOADED:           'border-l-4 border-l-blue-500',
  DP_UPLOADED:                'border-l-4 border-l-indigo-500',
};

function matchesChannel(
  orderChannel: SalesChannel,
  channelFilter: ChannelFilter,
  specificChannel: SalesChannel | '',
): boolean {
  if (specificChannel) return orderChannel === specificChannel;
  if (channelFilter === 'all') return true;
  return CHANNEL_GROUPS[channelFilter].includes(orderChannel);
}

function filterEntries(
  entries: SalesEntry[],
  tab: FilterTab,
  search: string,
  channelFilter: ChannelFilter,
  specificChannel: SalesChannel | '',
): SalesEntry[] {
  let filtered = entries;
  filtered = filtered.filter(e => matchesChannel(e.channel, channelFilter, specificChannel));
  if (tab === 'pending')   filtered = filtered.filter(e => e.status === 'PENDING_ADMIN_CONFIRMATION');
  if (tab === 'waiting')   filtered = filtered.filter(e => e.status === 'WAITING_PAYMENT' || e.status === 'WAITING_DP' || e.status === 'DP_VERIFIED');
  if (tab === 'uploaded')  filtered = filtered.filter(e => e.status === 'PAYMENT_UPLOADED' || e.status === 'DP_UPLOADED');
  if (tab === 'done')      filtered = filtered.filter(e => e.status === 'PAYMENT_VERIFIED' || e.status === 'COMPLETED' || e.status === 'PAID');
  if (tab === 'cancelled') filtered = filtered.filter(e => e.status === 'CANCELLED' || e.status === 'PAYMENT_REJECTED' || e.status === 'DP_PROOF_REJECTED');
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter(e =>
      e.customer_name.toLowerCase().includes(q) ||
      e.display_id.toLowerCase().includes(q) ||
      (e.customer_phone ?? '').includes(q)
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

function EmptyState({ message }: { message: string }) {
  return (
    <div className="bg-white rounded-sm border border-gray-200 p-12 text-center">
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
    <div className="border border-gray-200 rounded-sm overflow-hidden text-xs mb-3">
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
          <div className="text-right text-gray-500">{formatIDR(item.unit_price)}</div>
          <div className="text-right font-bold text-gray-800">{formatIDR(item.subtotal)}</div>
        </div>
      ))}
      <div className="flex justify-end gap-6 px-3 py-2 border-t-2 border-gray-200 bg-gray-50 text-[11px]">
        <div className="text-right text-gray-400 leading-relaxed">
          Subtotal<br />Ongkir<br /><strong className="text-gray-700">Total</strong>
        </div>
        <div className="text-right text-gray-600 leading-relaxed min-w-[90px]">
          {formatIDR(items.reduce((s, i) => s + i.subtotal, 0))}
          <br />—
          <br /><strong className="text-gray-800">{formatIDR(items.reduce((s, i) => s + i.subtotal, 0))} + ongkir</strong>
        </div>
      </div>
    </div>
  );
}

interface RejectProofModalProps {
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  loading: boolean;
}
function RejectProofModal({ onConfirm, onCancel, loading }: RejectProofModalProps) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel]);
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-sm shadow-xl p-6 w-full max-w-sm mx-4"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-gray-800 mb-1">Tolak Bukti Transfer</h3>
        <p className="text-xs text-gray-400 mb-4">Customer akan dinotifikasi via WhatsApp untuk kirim ulang.</p>
        <textarea
          className="w-full border border-gray-200 rounded-sm p-3 text-xs resize-none outline-none focus:border-red-300"
          rows={3}
          placeholder="Alasan penolakan (opsional)"
          value={reason}
          onChange={e => setReason(e.target.value)}
        />
        <div className="flex gap-2 mt-4 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs text-gray-600 border border-gray-200 rounded-sm hover:bg-gray-50"
          >
            Batal
          </button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={loading}
            className="px-4 py-2 text-xs font-bold bg-red-500 text-white rounded-sm hover:bg-red-600 disabled:opacity-40"
          >
            {loading ? 'Memproses...' : 'Tolak & Notifikasi'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OrderHistoryScreen({ currentUser, onOpenCustomer, showToast }: OrderHistoryScreenProps) {
  const [orders, setOrders] = useState<DbOrder[]>([]);
  const [kasir, setKasir] = useState<KasirTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [tab, setTab] = useState<FilterTab>('all');
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');
  const [specificChannel, setSpecificChannel] = useState<SalesChannel | ''>('');
  const { settings } = useSalesChannels();
  const tenant = useTenant();
  const tenantId = tenant?.tenant_id;
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [shippingFees, setShippingFees] = useState<Record<string, string>>({});
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [rejectingPaymentId, setRejectingPaymentId] = useState<string | null>(null);
  const [invoiceOrder, setInvoiceOrder] = useState<DbOrder | null>(null);
  const [paymentTypes, setPaymentTypes] = useState<Record<string, 'FULL' | 'DP'>>({});
  const [dpInputTypes, setDpInputTypes] = useState<Record<string, 'AMOUNT' | 'PERCENTAGE'>>({});
  const [dpValues, setDpValues] = useState<Record<string, string>>({});
  const [verifyingDPId, setVerifyingDPId] = useState<string | null>(null);
  const [rejectDPModalOrderId, setRejectDPModalOrderId] = useState<string | null>(null);
  const [rejectingDPId, setRejectingDPId] = useState<string | null>(null);

  const handleApprove = async (orderId: string, deliveryType: string | undefined, orderTotal: number) => {
    const fee = deliveryType === 'PICKUP' ? 0 : parseFloat(shippingFees[orderId] ?? '0');
    const paymentType = paymentTypes[orderId] ?? 'FULL';
    const dpInputType = dpInputTypes[orderId] ?? 'AMOUNT';
    const dpVal = parseFloat(dpValues[orderId] ?? '0');
    if (paymentType === 'DP' && isNaN(dpVal)) {
      showToast('Masukkan nominal DP yang valid.', 'warning');
      return;
    }
    const dpAmount = paymentType === 'DP'
      ? (dpInputType === 'PERCENTAGE' ? (orderTotal + fee) * dpVal / 100 : dpVal)
      : 0;

    if (paymentType === 'DP' && (dpAmount <= 0 || dpAmount >= orderTotal + fee)) {
      showToast('Nominal DP harus lebih dari 0 dan kurang dari total order.', 'warning');
      return;
    }

    setApprovingId(orderId);
    try {
      await orderService.approveOrder(orderId, fee, paymentType, dpInputType, dpVal, dpAmount);
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'APPROVED', shipping_fee: fee } : o));
      setExpandedId(null);
      setPaymentTypes(prev => { const n = { ...prev }; delete n[orderId]; return n; });
      setDpInputTypes(prev => { const n = { ...prev }; delete n[orderId]; return n; });
      setDpValues(prev => { const n = { ...prev }; delete n[orderId]; return n; });
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

  const handleVerifyDP = async (orderId: string) => {
    setVerifyingDPId(orderId);
    try {
      await orderService.verifyDPPayment(orderId, currentUser?.name ?? '');
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'DP_VERIFIED' } : o));
      setExpandedId(null);
      showToast('DP berhasil diverifikasi. Customer dinotifikasi untuk lunasi.', 'success');
    } catch {
      showToast('Gagal verifikasi DP.', 'warning');
    } finally {
      setVerifyingDPId(null);
    }
  };

  const handleRejectDP = async (orderId: string, reason: string) => {
    setRejectingDPId(orderId);
    try {
      await orderService.rejectDPProof(orderId, reason);
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'DP_PROOF_REJECTED', dp_proof_url: null } : o));
      setRejectDPModalOrderId(null);
      setExpandedId(null);
      showToast('Bukti DP ditolak. Customer dinotifikasi.', 'info');
    } catch {
      showToast('Gagal menolak bukti DP.', 'warning');
    } finally {
      setRejectingDPId(null);
    }
  };

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    let cancelled = false;
    setFetchError(null);
    salesEntriesService.fetchAll()
      .then(({ orders: o, kasir: k }) => {
        if (cancelled) return;
        setOrders(o);
        setKasir(k);
      })
      .catch((err) => {
        if (cancelled) return;
        setFetchError('Gagal memuat riwayat pesanan.');
        showToast('Gagal memuat riwayat pesanan.', 'warning');
        console.error(err);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    if (!supabase) return () => { cancelled = true; };
    if (!tenantId) return () => { cancelled = true; };
    // tenant_id filter is REQUIRED. Realtime bandwidth is billed per-connection;
    // unfiltered subscriptions receive all-tenant events + RLS-drop client-side.
    // Server-side filter cuts inbound bytes and enforces isolation belt-and-suspenders.
    const sub = supabase
      .channel('order-history-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          setOrders(prev => [payload.new as DbOrder, ...prev]);
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          setOrders(prev => prev.map(o => o.id === (payload.new as DbOrder).id ? payload.new as DbOrder : o));
        })
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(sub);
    };
  }, [tenantId]);

  const entries = useMemo(() => mergeSalesEntries(orders, kasir), [orders, kasir]);

  const pendingCount   = entries.filter(e => e.status === 'PENDING_ADMIN_CONFIRMATION').length;
  const uploadedCount  = entries.filter(e => e.status === 'PAYMENT_UPLOADED' || e.status === 'DP_UPLOADED').length;
  const waitingCount   = entries.filter(e => e.status === 'WAITING_PAYMENT' || e.status === 'WAITING_DP' || e.status === 'DP_VERIFIED').length;
  const doneCount      = entries.filter(e => e.status === 'PAYMENT_VERIFIED' || e.status === 'COMPLETED' || e.status === 'PAID').length;
  const cancelledCount = entries.filter(e => e.status === 'CANCELLED' || e.status === 'PAYMENT_REJECTED' || e.status === 'DP_PROOF_REJECTED').length;

  const visible = filterEntries(entries, tab, search, channelFilter, specificChannel);

  const tabs: { id: FilterTab; label: string; count: number; dot?: boolean }[] = [
    { id: 'all',       label: 'Semua',            count: entries.length },
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
        <div className="bg-yellow-50 border border-yellow-200 rounded-sm p-6 text-yellow-800 text-sm font-medium">
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

      {/* Search + channel filter */}
      <div className="flex items-stretch gap-2 flex-wrap">
        <div className="flex-1 min-w-[240px] flex items-center gap-2 bg-white border border-gray-200 rounded-sm px-4 py-2.5 text-sm text-gray-400">
          <Search className="w-4 h-4 shrink-0" />
          <input
            className="flex-1 bg-transparent outline-none text-gray-700 placeholder:text-gray-400"
            placeholder="Cari nama pelanggan, ID pesanan, nomor WA..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {/* Group dropdown */}
        <select
          value={channelFilter}
          onChange={e => { setChannelFilter(e.target.value as ChannelFilter); setSpecificChannel(''); }}
          className="bg-white border border-gray-200 rounded-sm px-3 py-2.5 text-xs font-bold text-gray-700 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
        >
          <option value="all">Semua</option>
          <option value="offline">📋 Semua Offline</option>
          <option value="marketplace">🛍️ Semua Marketplace</option>
          <option value="direct">💬 Semua Direct</option>
        </select>

        {/* Specific dropdown with optgroup for hidden channels */}
        <select
          value={specificChannel}
          onChange={e => { setSpecificChannel(e.target.value as SalesChannel | ''); }}
          className="bg-white border border-gray-200 rounded-sm px-3 py-2.5 text-xs font-bold text-gray-700 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
        >
          <option value="">— pilih kanal spesifik —</option>
          {(['offline', 'marketplace', 'direct'] as const).map(group => {
            const visible = CHANNEL_GROUPS[group].filter(c => settings[c]?.isVisible);
            if (visible.length === 0) return null;
            return (
              <optgroup
                key={group}
                label={`${group === 'offline' ? 'Offline' : group === 'marketplace' ? 'Marketplace' : 'Direct'} (aktif)`}
              >
                {visible.map(code => (
                  <option key={code} value={code}>{getChannelDef(code).label}</option>
                ))}
              </optgroup>
            );
          })}
          <optgroup label="Dinonaktifkan (untuk historical)">
            {(Object.keys(CHANNEL_VISUAL) as SalesChannel[])
              .filter(c => !settings[c]?.isVisible)
              .map(code => (
                <option key={code} value={code}>{getChannelDef(code).label} (non-aktif)</option>
              ))}
          </optgroup>
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="bg-white rounded-sm border border-gray-200 p-8 text-center text-sm text-gray-400">Memuat...</div>
      ) : fetchError ? (
        <div className="bg-white rounded-sm border border-red-100 p-8 text-center">
          <p className="text-sm font-semibold text-red-600 mb-3">{fetchError}</p>
          <button
            onClick={() => { setFetchError(null); setLoading(true); salesEntriesService.fetchAll().then(({ orders: o, kasir: k }) => { setOrders(o); setKasir(k); }).catch((err) => { setFetchError('Gagal memuat riwayat pesanan.'); showToast('Gagal memuat riwayat pesanan.', 'warning'); console.error(err); }).finally(() => setLoading(false)); }}
            className="px-4 py-2 bg-[#012749] text-white text-xs font-bold rounded-sm hover:opacity-90"
          >
            Coba Lagi
          </button>
        </div>
      ) : visible.length === 0 ? (
        <EmptyState message={EMPTY_MESSAGES[tab]} />
      ) : (
        <div className="bg-white rounded-sm border border-gray-200 overflow-hidden">
          {visible.map(entry => {
            // Look up the underlying DbOrder when this entry comes from `orders`;
            // kasir entries have no order row and stay collapse-only by design.
            const order: DbOrder | undefined = entry.source === 'order'
              ? orders.find(o => `order:${o.id}` === entry.id)
              : undefined;
            const badge   = STATUS_BADGE[entry.status] ??
              (entry.status === 'PAID'
                ? { label: '✓ Lunas (Kasir)', className: 'bg-green-100 text-green-800' }
                : { label: entry.status, className: 'bg-gray-100 text-gray-600' });
            const totalCl = TOTAL_COLOR[entry.status] ?? (entry.status === 'PAID' ? 'text-green-700' : 'text-gray-700');
            const borderCl = LEFT_BORDER[entry.status] ?? 'border-l-4 border-l-transparent';
            const isDimmed = entry.status === 'CANCELLED' || entry.status === 'PAYMENT_REJECTED' || entry.status === 'DP_PROOF_REJECTED';
            const isExpanded = expandedId === entry.id;

            return (
              <div key={entry.id} className={`border-b border-gray-100 last:border-0 ${borderCl} ${isDimmed ? 'opacity-55' : ''}`}>
                {/* Collapsed row */}
                <div
                  className={`flex items-center gap-3 px-5 py-3 transition-colors ${
                    entry.source === 'order' ? 'cursor-pointer hover:bg-gray-50' : 'cursor-default'
                  } ${isExpanded ? 'bg-gray-50' : ''}`}
                  onClick={() => { if (entry.source === 'order') setExpandedId(isExpanded ? null : entry.id); }}
                >
                  <div className="flex-1 min-w-0">
                    <div
                      className="font-bold text-sm text-[#012749] underline underline-offset-2 cursor-pointer hover:opacity-80 inline-block"
                      onClick={e => { e.stopPropagation(); if (entry.customer_id) onOpenCustomer(entry.customer_id); }}
                    >
                      {entry.customer_name}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      <span className="text-xs text-gray-400 font-mono">{entry.display_id}</span>
                      <span className="text-gray-300 text-xs">·</span>
                      <span className="text-xs text-gray-400">{formatDate(entry.created_at)}</span>
                      {entry.items && entry.items.length > 0 && (
                        <>
                          <span className="text-gray-300 text-xs">·</span>
                          <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full text-xs">
                            {entry.items[0].name}
                            {entry.items.length > 1 ? <strong> +{entry.items.length - 1}</strong> : null}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className={`text-sm font-extrabold shrink-0 ${totalCl}`}>
                    {formatIDR(entry.total)}
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${CHANNEL_BADGE_CLASS[entry.channel]}`}>
                    {CHANNEL_LABEL[entry.channel]}
                  </span>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${badge.className}`}>
                    {badge.label}
                  </span>
                  {entry.source === 'order' && (
                    <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  )}
                </div>

                {isExpanded && order && order.status === 'PENDING_ADMIN_CONFIRMATION' && (
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
                        <OrderBnlSection orderId={order.id} customerName={order.customer_name} />
                        <div className="text-[10px] text-gray-400">⏱ Booking berakhir: {formatDate(order.booking_expires_at)}</div>
                      </div>
                      {/* Right: action */}
                      <div className="flex flex-col gap-2 min-w-[140px]">
                        <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 text-center">Tetapkan Ongkir</div>
                        {order.delivery_type === 'PICKUP' ? (
                          <div className="text-xs text-gray-500 bg-gray-100 rounded-sm px-3 py-2 text-center">Rp 0 (Pickup)</div>
                        ) : (
                          <div className="flex items-center gap-1.5 bg-gray-50 border border-purple-200 rounded-sm px-3 py-2">
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
                        {/* Payment type selector */}
                        <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 text-center mt-2">Tipe Pembayaran</div>
                        <div className="flex gap-2 justify-center">
                          {(['FULL', 'DP'] as const).map(t => (
                            <button
                              key={t}
                              onClick={() => setPaymentTypes(prev => ({ ...prev, [order.id]: t }))}
                              className={`text-xs px-3 py-1 rounded-full border font-bold transition-all ${
                                (paymentTypes[order.id] ?? 'FULL') === t
                                  ? 'bg-purple-600 text-white border-purple-600'
                                  : 'bg-white text-gray-600 border-gray-300 hover:border-purple-400'
                              }`}
                            >
                              {t === 'FULL' ? 'Full' : 'DP'}
                            </button>
                          ))}
                        </div>

                        {/* DP input — shown only when DP selected */}
                        {(paymentTypes[order.id] ?? 'FULL') === 'DP' && (
                          <div className="mt-1">
                            <div className="flex gap-1 mb-1 justify-center">
                              {(['AMOUNT', 'PERCENTAGE'] as const).map(t => (
                                <button
                                  key={t}
                                  onClick={() => {
                                    setDpInputTypes(prev => ({ ...prev, [order.id]: t }));
                                    setDpValues(prev => ({ ...prev, [order.id]: '' }));
                                  }}
                                  className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${
                                    (dpInputTypes[order.id] ?? 'AMOUNT') === t
                                      ? 'bg-indigo-600 text-white border-indigo-600'
                                      : 'bg-white text-gray-500 border-gray-200'
                                  }`}
                                >
                                  {t === 'AMOUNT' ? 'Nominal' : '%'}
                                </button>
                              ))}
                            </div>
                            <div className="flex items-center gap-1 bg-gray-50 border border-purple-200 rounded-sm px-2 py-1">
                              {(dpInputTypes[order.id] ?? 'AMOUNT') === 'AMOUNT' && <span className="text-gray-400 text-xs">Rp</span>}
                              <input
                                type="number"
                                min="0"
                                className="flex-1 bg-transparent text-sm font-bold text-gray-700 outline-none w-20"
                                placeholder={dpInputTypes[order.id] === 'PERCENTAGE' ? '50' : '500000'}
                                value={dpValues[order.id] ?? ''}
                                onChange={e => setDpValues(prev => ({ ...prev, [order.id]: e.target.value }))}
                              />
                              {(dpInputTypes[order.id] ?? 'AMOUNT') === 'PERCENTAGE' && <span className="text-gray-400 text-xs">%</span>}
                            </div>
                            {/* Preview computed IDR amount when % selected */}
                            {(dpInputTypes[order.id] ?? 'AMOUNT') === 'PERCENTAGE' && dpValues[order.id] && !isNaN(parseFloat(dpValues[order.id])) && (
                              <div className="text-[9px] text-indigo-600 font-semibold mt-0.5 text-center">
                                = {formatIDR(Math.round(
                                  ((order.total ?? 0) + (order.delivery_type === 'PICKUP' ? 0 : parseFloat(shippingFees[order.id] ?? '0')))
                                  * parseFloat(dpValues[order.id]) / 100
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        <button
                          onClick={() => handleApprove(order.id, order.delivery_type, order.total ?? 0)}
                          disabled={
                            approvingId === order.id ||
                            (order.delivery_type !== 'PICKUP' && (!shippingFees[order.id] || shippingFees[order.id] === '')) ||
                            ((paymentTypes[order.id] ?? 'FULL') === 'DP' && !dpValues[order.id])
                          }
                          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-purple-600 text-white text-xs font-bold rounded-sm hover:bg-purple-700 disabled:opacity-40"
                        >
                          {approvingId === order.id ? 'Memproses...' : '✓ Approve'}
                        </button>
                        <button
                          onClick={() => handleRejectOrder(order.id)}
                          disabled={rejectingId === order.id}
                          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-white text-red-600 text-xs font-bold rounded-sm border-2 border-red-200 hover:bg-red-50 disabled:opacity-40"
                        >
                          ✕ Tolak
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {isExpanded && order && order.status === 'PAYMENT_UPLOADED' && (
                  <div className="px-5 py-4 border-t border-blue-200 bg-blue-50">
                    <div className="grid grid-cols-[1fr_auto] gap-5 items-start">
                      <div>
                        <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
                          <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pelanggan</div><div className="font-semibold text-gray-700">{order.customer_name}</div></div>
                          <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">No. WA</div><div className="font-mono font-semibold text-gray-700">{order.customer_phone}</div></div>
                          <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pengiriman</div><div className="font-semibold text-gray-700">{order.delivery_type === 'PICKUP' ? '🏪 Pickup' : '🚚 Delivery'}</div></div>
                        </div>
                        <ItemsTable items={order.items} headerClass="bg-blue-100 text-blue-700" />
                        <OrderBnlSection orderId={order.id} customerName={order.customer_name} />
                        {/* Payment proof */}
                        <div>
                          {/* DP proof summary — shown for DP orders above full proof */}
                          {order.payment_type === 'DP' && (
                            <div className="mb-4 p-3 bg-teal-50 rounded-sm border border-teal-200">
                              <div className="text-[9px] font-bold uppercase tracking-wide text-teal-600 mb-1">
                                ✓ DP Terverifikasi — {formatIDR(Number(order.dp_amount ?? 0))}
                              </div>
                              {order.dp_proof_url && (
                                <StorageLink bucket="payment-proofs" storageRef={order.dp_proof_url}
                                  className="text-xs text-teal-700 underline font-semibold">Lihat Bukti DP ↗</StorageLink>
                              )}
                            </div>
                          )}
                          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-2">
                            {order.payment_type === 'DP' ? 'Bukti Pelunasan' : 'Bukti Transfer'}
                          </div>
                          <div className="flex items-start gap-3">
                            {order.full_proof_url ? (
                              <StorageImage
                                bucket="payment-proofs"
                                path={order.full_proof_url}
                                alt="Bukti Transfer"
                                className="w-16 h-20 flex-shrink-0 border-2 border-blue-200"
                                aspectRatio="4/5"
                              />
                            ) : (
                              <div className="w-16 h-20 bg-indigo-100 border-2 border-indigo-200 rounded-sm flex flex-col items-center justify-center gap-1 flex-shrink-0">
                                <span className="text-indigo-400 text-lg">🖼</span>
                                <span className="text-[9px] text-indigo-400 font-semibold">Foto Bukti</span>
                              </div>
                            )}
                            <div>
                              {order.full_proof_url && (
                                <StorageLink
                                  bucket="payment-proofs"
                                  storageRef={order.full_proof_url}
                                  className="text-xs text-blue-600 font-semibold underline"
                                >
                                  Lihat Ukuran Penuh ↗
                                </StorageLink>
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
                          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-green-600 text-white text-xs font-bold rounded-sm hover:bg-green-700 disabled:opacity-40"
                        >
                          {verifyingId === order.id ? 'Memproses...' : '✓ Verifikasi'}
                        </button>
                        <button
                          onClick={() => handleRejectPayment(order.id)}
                          disabled={rejectingPaymentId === order.id}
                          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-white text-red-600 text-xs font-bold rounded-sm border-2 border-red-200 hover:bg-red-50 disabled:opacity-40"
                        >
                          ✕ Tolak
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {isExpanded && order && order.status === 'DP_UPLOADED' && (
                  <div className="px-5 py-4 border-t border-indigo-200 bg-indigo-50">
                    <div className="grid grid-cols-[1fr_auto] gap-5 items-start">
                      <div>
                        <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
                          <div>
                            <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pelanggan</div>
                            <div className="font-semibold text-gray-700">{order.customer_name}</div>
                          </div>
                          <div>
                            <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">No. WA</div>
                            <div className="font-mono font-semibold text-gray-700">{order.customer_phone}</div>
                          </div>
                          <div>
                            <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pengiriman</div>
                            <div className="font-semibold text-gray-700">{order.delivery_type === 'PICKUP' ? '🏪 Pickup' : '🚚 Delivery'}</div>
                          </div>
                        </div>
                        <ItemsTable items={order.items} headerClass="bg-indigo-100 text-indigo-700" />
                        <OrderBnlSection orderId={order.id} customerName={order.customer_name} />
                        {/* DP Proof */}
                        <div className="mt-3">
                          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-2">
                            Bukti DP {order.dp_amount ? `(${formatIDR(Number(order.dp_amount))})` : ''}
                          </div>
                          <div className="flex items-start gap-3">
                            {order.dp_proof_url ? (
                              <StorageImage
                                bucket="payment-proofs"
                                path={order.dp_proof_url}
                                alt="Bukti DP"
                                className="w-16 h-20 flex-shrink-0 border-2 border-indigo-200"
                                aspectRatio="4/5"
                              />
                            ) : (
                              <div className="w-16 h-20 bg-indigo-100 border-2 border-indigo-200 rounded-sm flex flex-col items-center justify-center gap-1 flex-shrink-0">
                                <span className="text-indigo-400 text-lg">🖼</span>
                                <span className="text-[9px] text-indigo-400 font-semibold">Foto DP</span>
                              </div>
                            )}
                            <div>
                              {order.dp_proof_url && (
                                <StorageLink bucket="payment-proofs" storageRef={order.dp_proof_url}
                                  className="text-xs text-blue-600 font-semibold underline">Lihat Ukuran Penuh ↗</StorageLink>
                              )}
                              <p className="text-[10px] text-gray-400 mt-1">Dikirim {formatDate(order.updated_at)}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 min-w-[120px]">
                        <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 text-center">Tindakan</div>
                        <button
                          onClick={() => handleVerifyDP(order.id)}
                          disabled={verifyingDPId === order.id}
                          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-teal-600 text-white text-xs font-bold rounded-sm hover:bg-teal-700 disabled:opacity-40"
                        >
                          {verifyingDPId === order.id ? 'Memproses...' : '✓ Verifikasi DP'}
                        </button>
                        <button
                          onClick={() => setRejectDPModalOrderId(order.id)}
                          disabled={rejectingDPId === order.id}
                          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-white text-red-600 text-xs font-bold rounded-sm border-2 border-red-200 hover:bg-red-50 disabled:opacity-40"
                        >
                          ✕ Tolak
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {isExpanded && order && order.status === 'DP_VERIFIED' && (
                  <div className="px-5 py-4 border-t border-teal-200 bg-teal-50">
                    <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pelanggan</div>
                        <div className="font-semibold text-gray-700">{order.customer_name}</div>
                      </div>
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">No. WA</div>
                        <div className="font-mono font-semibold text-gray-700">{order.customer_phone}</div>
                      </div>
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">DP Terverifikasi</div>
                        <div className="font-semibold text-teal-700">{formatIDR(Number(order.dp_amount ?? 0))}</div>
                      </div>
                    </div>
                    <ItemsTable items={order.items} headerClass="bg-teal-100 text-teal-700" />
                    <OrderBnlSection orderId={order.id} customerName={order.customer_name} />
                    <div className="flex items-center gap-2 mt-2 bg-teal-100 rounded-sm px-3 py-2">
                      <span className="text-teal-600 text-sm">⏳</span>
                      <span className="text-xs text-teal-700 font-semibold">Menunggu bukti pelunasan dari customer</span>
                    </div>
                  </div>
                )}
                {isExpanded && order && order.status === 'WAITING_PAYMENT' && (
                  <div className="px-5 py-4 border-t border-gray-100 bg-gray-50">
                    <div className="grid grid-cols-4 gap-3 mb-3 text-xs">
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pelanggan</div><div className="font-semibold text-gray-700">{order.customer_name}</div></div>
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">No. WA</div><div className="font-mono font-semibold text-gray-700">{order.customer_phone}</div></div>
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pengiriman</div><div className="font-semibold text-gray-700">{order.delivery_type === 'PICKUP' ? '🏪 Pickup' : '🚚 Delivery'}</div></div>
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Total</div><div className="font-bold text-gray-800">{formatIDR(order.total)}</div></div>
                    </div>
                    <ItemsTable items={order.items} headerClass="bg-gray-100 text-gray-600" />
                    <OrderBnlSection orderId={order.id} customerName={order.customer_name} />
                  </div>
                )}
                {isExpanded && order && (order.status === 'PAYMENT_VERIFIED' || order.status === 'COMPLETED') && (
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
                    <OrderBnlSection orderId={order.id} customerName={order.customer_name} />
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <span className="text-xs text-gray-500">
                        ✅ Diverifikasi oleh {order.verified_by ?? '—'} · {order.payment_verified_at ? formatDate(order.payment_verified_at) : '—'}
                      </span>
                      <button
                        onClick={() => setInvoiceOrder(order)}
                        className="flex items-center gap-1.5 px-4 py-2 bg-white text-[#012749] text-xs font-bold rounded-sm border border-[#c7d7f5] hover:bg-blue-50"
                      >
                        📄 Lihat Invoice
                      </button>
                    </div>
                  </div>
                )}
                {isExpanded && order && (order.status === 'CANCELLED' || order.status === 'PAYMENT_REJECTED' || order.status === 'DP_PROOF_REJECTED') && (
                  <div className="px-5 py-4 border-t border-gray-100 bg-gray-50">
                    <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pelanggan</div><div className="font-semibold text-gray-700">{order.customer_name}</div></div>
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">No. WA</div><div className="font-mono font-semibold text-gray-700">{order.customer_phone}</div></div>
                      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Total</div><div className="font-bold text-gray-400">{formatIDR(order.total)}</div></div>
                    </div>
                    <ItemsTable items={order.items} headerClass="bg-gray-100 text-gray-600" />
                    <OrderBnlSection orderId={order.id} customerName={order.customer_name} />
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
      {rejectDPModalOrderId && (
        <RejectProofModal
          loading={rejectingDPId === rejectDPModalOrderId}
          onConfirm={(reason) => handleRejectDP(rejectDPModalOrderId, reason)}
          onCancel={() => setRejectDPModalOrderId(null)}
        />
      )}
    </div>
  );
}
