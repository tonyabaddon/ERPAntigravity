import React, { useState, useEffect, useRef } from 'react';
import { ShoppingCart, Calendar, AlertTriangle, FileText, CalendarRange, ChevronDown, SearchX, Plus } from 'lucide-react';
import { StockItem, PermissionSet } from '../types';
import { purchaseOrderService, supplierService } from '../lib/pembelianService';
import type { DbPurchaseOrder, DbSupplier } from '../types';
import { isSupabaseConfigured } from '../lib/supabaseClient';
import { wibDateString } from '../lib/format';
import { type FilterState, resolveRange, periodLabel, resolvedRangeShort, inRange } from '../lib/dateRange';
import KpiCard from './ui/KpiCard';
import SupplierModal from './pembelian/SupplierModal';
import ReceiveGoodsModal from './pembelian/ReceiveGoodsModal';
import MarkAsPaidModal from './pembelian/MarkAsPaidModal';
import PurchaseOrderFormPage from './pembelian/PurchaseOrderFormPage';
import PembelianDetailPage from './pembelian/PembelianDetailPage';

interface PembelianScreenProps {
  stockList: StockItem[];
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onStockRefresh: () => void;
  currentUserId?: string;
  currentUserPermissions?: PermissionSet;
  initialDetailPoNumber?: string | null;
  onDetailConsumed?: () => void;
}

type Tab = 'orders' | 'suppliers';
type ViewMode =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; po: DbPurchaseOrder }
  | { kind: 'detail'; poNumber: string };

function formatRupiah(n: number): string {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  DRAFT:    { label: 'Draft',    className: 'bg-gray-100 text-gray-600' },
  ORDERED:  { label: 'Dipesan',  className: 'bg-blue-100 text-blue-800' },
  RECEIVED: { label: 'Diterima', className: 'bg-amber-100 text-amber-800' },
  PAID:     { label: 'Lunas',    className: 'bg-green-100 text-green-800' },
};

const LEFT_BORDER: Record<string, string> = {
  ORDERED:  'border-l-4 border-l-blue-400',
  RECEIVED: 'border-l-4 border-l-amber-400',
  OVERDUE:  'border-l-4 border-l-rose-500',
};

export default function PembelianScreen({
  stockList, showToast, onStockRefresh, currentUserId, currentUserPermissions,
  initialDetailPoNumber, onDetailConsumed,
}: PembelianScreenProps) {
  const [tab, setTab] = useState<Tab>('orders');
  const [orders, setOrders] = useState<DbPurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<DbSupplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>({ kind: 'list' });
  const [filter, setFilter] = useState<FilterState>({ preset: 'bulan_ini' });
  const [customPopoverOpen, setCustomPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  async function reload() {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    try {
      const [ords, sups] = await Promise.all([
        purchaseOrderService.fetchAll(),
        supplierService.fetchAll(),
      ]);
      setOrders(ords);
      setSuppliers(sups);
    } catch (e: any) {
      console.error('Load pembelian error:', e);
      showToast(e?.message ?? 'Gagal memuat data pembelian.', 'warning');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  // Open detail directly if invoked via deep-link (?po=...)
  useEffect(() => {
    if (initialDetailPoNumber) {
      setViewMode({ kind: 'detail', poNumber: initialDetailPoNumber });
      onDetailConsumed?.();
    }
  }, [initialDetailPoNumber, onDetailConsumed]);

  // Tab-sync: when the list tab regains focus (e.g., after the user took an action
  // in a detail tab), re-fetch so the list reflects the latest state.
  useEffect(() => {
    if (viewMode.kind !== 'list') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [viewMode.kind]);

  // Click-outside closes the Custom popover.
  useEffect(() => {
    if (!customPopoverOpen) return;
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setCustomPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [customPopoverOpen]);

  const range = resolveRange(filter);
  const pLabel = periodLabel(filter);
  const rangeLabel = resolvedRangeShort(filter);

  function poDateAnchor(po: DbPurchaseOrder): string | null {
    return po.ordered_at ?? po.created_at ?? null;
  }
  function inListPeriod(po: DbPurchaseOrder): boolean {
    return inRange(poDateAnchor(po) ?? undefined, range);
  }

  // Cards 1 + 4: filtered by coalesce(ordered_at, created_at) — "what did I buy?"
  const inWindow = orders.filter(inListPeriod);
  const total = inWindow.reduce((s, p) => s + Number(p.total), 0);
  const count = inWindow.length;

  // Card 2: filtered by payment_due_at AND status === 'RECEIVED' — "what do I owe in this window?"
  const dueInWindow = orders.filter(p =>
    p.status === 'RECEIVED' && p.payment_due_at && inRange(p.payment_due_at, range)
  );
  const dueAmount = dueInWindow.reduce((s, p) => s + Number(p.total), 0);
  const dueCount = dueInWindow.length;

  // Card 3: ALWAYS "right now" — ignores filter (see spec §5.2 Card 3 row).
  const todayWib = wibDateString();
  const overdueNow = orders.filter(p =>
    p.status === 'RECEIVED' && p.payment_due_at && p.payment_due_at < todayWib
  );
  const overdueAmount = overdueNow.reduce((s, p) => s + Number(p.total), 0);
  const overdueCount = overdueNow.length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3 flex-shrink-0">
        <div className="bg-indigo-100 p-2 rounded-lg">
          <ShoppingCart className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-base font-bold text-gray-900">Pembelian</h1>
          <p className="text-xs text-gray-500">Manajemen Supplier &amp; Purchase Order</p>
        </div>
      </div>

      {/* Filter bar — only visible in list view-mode */}
      {viewMode.kind === 'list' && (
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between gap-4 flex-wrap flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest mr-1">Periode</span>
            {(['bulan_ini', '30_hari', '90_hari'] as const).map(key => {
              const active = filter.preset === key;
              const text = key === 'bulan_ini' ? 'Bulan Ini' : key === '30_hari' ? '30 Hari' : '90 Hari';
              return (
                <button
                  key={key}
                  onClick={() => { setFilter({ preset: key }); setCustomPopoverOpen(false); }}
                  className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
                    active
                      ? 'bg-[#012749] text-white shadow'
                      : 'bg-white border border-gray-200 text-gray-600 hover:border-[#012749] hover:text-[#012749]'
                  }`}
                >
                  {text}
                </button>
              );
            })}
            <div className="relative" ref={popoverRef}>
              <button
                onClick={() => setCustomPopoverOpen(v => !v)}
                aria-label="Pilih rentang tanggal custom"
                className={`px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-1.5 transition ${
                  filter.preset === 'custom'
                    ? 'bg-[#012749] text-white shadow'
                    : 'bg-white border border-gray-200 text-gray-600 hover:border-[#012749] hover:text-[#012749]'
                }`}
              >
                <Calendar className="w-4 h-4" /> Custom <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {customPopoverOpen && (
                <CustomPopover
                  initial={filter.preset === 'custom' ? { from: filter.customFrom, to: filter.customTo } : {}}
                  onCancel={() => setCustomPopoverOpen(false)}
                  onApply={(from, to) => {
                    setFilter({ preset: 'custom', customFrom: from, customTo: to });
                    setCustomPopoverOpen(false);
                  }}
                />
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <CalendarRange className="w-4 h-4" />
            <span className="font-semibold text-gray-700">{pLabel}</span>
            <span className="text-gray-400">·</span>
            <span>{rangeLabel}</span>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {viewMode.kind === 'create' || viewMode.kind === 'edit' ? (
          <PurchaseOrderFormPage
            po={viewMode.kind === 'edit' ? viewMode.po : undefined}
            suppliers={suppliers}
            orders={orders}
            stockList={stockList}
            currentUserId={currentUserId}
            currentUserPermissions={currentUserPermissions}
            onBack={() => setViewMode({ kind: 'list' })}
            onSaved={(status) => {
              reload();
              if (status === 'ORDERED') setViewMode({ kind: 'list' });
            }}
            onSupplierAdded={reload}
            showToast={showToast}
          />
        ) : viewMode.kind === 'detail' ? (
          <PembelianDetailPage
            poNumber={viewMode.poNumber}
            stockList={stockList}
            suppliers={suppliers}
            orders={orders}
            currentUserId={currentUserId}
            currentUserPermissions={currentUserPermissions}
            showToast={showToast}
            onStockRefresh={onStockRefresh}
            onBackToList={() => setViewMode({ kind: 'list' })}
          />
        ) : (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <KpiCard
                icon={<ShoppingCart className="w-6 h-6" />}
                iconBg="bg-blue-50" iconColor="text-[#1e3d60]"
                badge={pLabel} badgeClass="bg-blue-50 text-[#1e3d60]"
                label="Total PO" value={formatRupiah(total)}
                sub={count > 0 ? `${count} purchase order dibuat di ${pLabel.toLowerCase()}` : 'Belum ada PO di periode ini'}
              />
              <KpiCard
                icon={<Calendar className="w-6 h-6" />}
                iconBg="bg-amber-50" iconColor="text-amber-600"
                badge={`${dueCount} PO`} badgeClass="bg-amber-50 text-amber-700"
                label="Jatuh Tempo" value={formatRupiah(dueAmount)}
                sub={dueCount > 0 ? `Belum dibayar, jatuh tempo di ${pLabel.toLowerCase()}` : 'Tidak ada PO jatuh tempo di periode ini'}
              />
              <KpiCard
                icon={<AlertTriangle className="w-6 h-6" />}
                iconBg={overdueAmount > 0 ? 'bg-rose-100' : 'bg-gray-50'}
                iconColor={overdueAmount > 0 ? 'text-rose-700' : 'text-gray-400'}
                badge={overdueAmount > 0 ? 'Tindakan!' : 'Aman'}
                badgeClass={overdueAmount > 0 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-50 text-[#2d8a4e]'}
                label="Terlambat Bayar" value={formatRupiah(overdueAmount)}
                sub={overdueAmount > 0
                  ? `${overdueCount} PO melewati jatuh tempo — selalu hari ini, tidak ikut filter`
                  : 'Semua PO dilunasi tepat waktu'}
                alarming={overdueAmount > 0}
              />
              <KpiCard
                icon={<FileText className="w-6 h-6" />}
                iconBg="bg-emerald-50" iconColor="text-[#2d8a4e]"
                badge={pLabel} badgeClass="bg-emerald-50 text-[#2d8a4e]"
                label="Jumlah PO" value={`${count}`}
                sub={count > 0 ? `Purchase order dibuat di ${pLabel.toLowerCase()}` : 'Belum ada PO di periode ini'}
              />
            </div>

            {/* Tabs (unchanged structure) */}
            <div className="flex gap-1 border-b border-gray-200">
              <button
                onClick={() => setTab('orders')}
                className={`px-4 py-2.5 text-sm font-semibold -mb-px ${tab === 'orders' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Purchase Orders
              </button>
              <button
                onClick={() => setTab('suppliers')}
                className={`px-4 py-2.5 text-sm font-medium -mb-px ${tab === 'suppliers' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Supplier
              </button>
            </div>

            {loading ? (
              <div className="text-center py-12 text-sm text-gray-400">Memuat data...</div>
            ) : tab === 'orders' ? (
              <OrdersTab
                orders={orders}
                suppliers={suppliers}
                stockList={stockList}
                showToast={showToast}
                onRefresh={reload}
                onStockRefresh={onStockRefresh}
                onCreate={() => setViewMode({ kind: 'create' })}
                onEdit={(po) => setViewMode({ kind: 'edit', po })}
                inListPeriod={inListPeriod}
                periodLabel={pLabel}
                buildDetailUrl={(poNumber) => `${window.location.origin}/?screen=pembelian&po=${encodeURIComponent(poNumber)}`}
              />
            ) : (
              <SuppliersTab
                suppliers={suppliers}
                showToast={showToast}
                onRefresh={reload}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface OrdersTabProps {
  orders: DbPurchaseOrder[];
  suppliers: DbSupplier[];
  stockList: StockItem[];
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onRefresh: () => void;
  onStockRefresh: () => void;
  onCreate: () => void;
  onEdit: (po: DbPurchaseOrder) => void;
  inListPeriod: (po: DbPurchaseOrder) => boolean;
  periodLabel: string;
  buildDetailUrl: (poNumber: string) => string;
}

function OrdersTab({
  orders, suppliers, stockList, showToast, onRefresh, onStockRefresh, onCreate, onEdit,
  inListPeriod, periodLabel, buildDetailUrl,
}: OrdersTabProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [receivePo, setReceivePo] = useState<DbPurchaseOrder | null>(null);
  const [payPo, setPayPo] = useState<DbPurchaseOrder | null>(null);

  const today = wibDateString();

  function isOverdue(po: DbPurchaseOrder): boolean {
    return po.status === 'RECEIVED' && !!po.payment_due_at && po.payment_due_at < today;
  }

  function isReceiveOverdue(po: DbPurchaseOrder): boolean {
    if (po.status !== 'ORDERED' || !po.expected_receive_date) return false;
    return po.expected_receive_date < today;
  }

  function daysReceiveOverdue(po: DbPurchaseOrder): number {
    if (!po.expected_receive_date) return 0;
    const ms = new Date(today).getTime() - new Date(po.expected_receive_date).getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  }

  const filtered = orders
    .filter(inListPeriod)
    .filter(o => {
      const matchSearch = o.po_number.toLowerCase().includes(search.toLowerCase()) ||
        (o.supplier?.name ?? '').toLowerCase().includes(search.toLowerCase());
      const matchStatus = !statusFilter || o.status === statusFilter;
      return matchSearch && matchStatus;
    })
    .sort((a, b) => {
      const aReceiveLate = isReceiveOverdue(a);
      const bReceiveLate = isReceiveOverdue(b);
      const aPaymentLate = isOverdue(a);
      const bPaymentLate = isOverdue(b);
      // Payment overdue (RECEIVED + past due) bubbles to top
      if (aPaymentLate && !bPaymentLate) return -1;
      if (!aPaymentLate && bPaymentLate) return 1;
      // Then receive overdue (ORDERED + past expected_receive_date)
      if (aReceiveLate && !bReceiveLate) return -1;
      if (!aReceiveLate && bReceiveLate) return 1;
      return 0;
    });

  async function handleMarkOrdered(po: DbPurchaseOrder) {
    try {
      await purchaseOrderService.markOrdered(po.id);
      showToast(`${po.po_number} ditandai Dipesan.`, 'success');
      onRefresh();
    } catch (e: any) {
      console.error('Mark ordered error:', e);
      showToast(e?.message ?? 'Gagal mengubah status PO.', 'warning');
    }
  }

  async function handleDelete(po: DbPurchaseOrder) {
    if (!confirm(`Hapus PO "${po.po_number}"? Tindakan ini tidak bisa dibatalkan.`)) return;
    try {
      await purchaseOrderService.delete(po.id);
      showToast(`${po.po_number} dihapus.`, 'success');
      onRefresh();
    } catch (e: any) {
      console.error('Delete PO error:', e);
      showToast(e?.message ?? 'Gagal menghapus PO.', 'warning');
    }
  }

  function formatDate(iso?: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1">
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              className="flex-1 max-w-sm text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              placeholder="Cari no. PO atau supplier..."
            />
            <select
              value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="">Semua Status</option>
              <option value="DRAFT">Draft</option>
              <option value="ORDERED">Dipesan</option>
              <option value="RECEIVED">Diterima</option>
              <option value="PAID">Lunas</option>
            </select>
          </div>
          <button
            onClick={onCreate}
            className="flex items-center gap-2 bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-indigo-700"
          >
            <Plus className="w-4 h-4" /> Buat PO Baru
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="grid grid-cols-8 px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-[10px] font-bold uppercase tracking-wide text-gray-500">
            <span className="col-span-1">No. PO</span>
            <span className="col-span-1">Supplier</span>
            <span className="col-span-1 text-center">Tgl Pesan</span>
            <span className="col-span-1 text-center">Tgl Diterima</span>
            <span className="col-span-1 text-center">Jatuh Tempo Bayar</span>
            <span className="col-span-1 text-right">Total</span>
            <span className="col-span-1 text-center">Status</span>
            <span className="col-span-1 text-center">Aksi</span>
          </div>

          {filtered.length === 0 ? (
            <div className="py-16 text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-gray-100 text-gray-400 mb-3">
                <SearchX className="w-6 h-6" />
              </div>
              <p className="text-sm text-gray-500">
                Tidak ada purchase order di periode <span className="font-semibold">{periodLabel}</span>.
              </p>
              <p className="text-xs text-gray-400 mt-1">Coba periode lain, atau buat PO baru.</p>
            </div>
          ) : (
            filtered.map(po => (
              <div key={po.id} className={`grid grid-cols-8 px-4 py-3 border-b border-gray-100 items-center hover:bg-gray-50 ${
                isOverdue(po) ? LEFT_BORDER.OVERDUE :
                isReceiveOverdue(po) ? LEFT_BORDER.OVERDUE :
                (LEFT_BORDER[po.status] ?? '')
              }`}>
                <span className="col-span-1 text-xs font-mono font-semibold text-gray-800">{po.po_number}</span>
                <div className="col-span-1">
                  <div className="text-sm font-semibold text-gray-800 truncate">{po.supplier?.name ?? '—'}</div>
                  <div className="text-[10px] text-gray-400">{po.supplier?.payment_term_days === 0 ? 'Cash' : `Net ${po.supplier?.payment_term_days}`}</div>
                </div>
                <span className="col-span-1 text-xs text-gray-500 text-center">{formatDate(po.ordered_at)}</span>
                <div className="col-span-1 flex flex-col items-center gap-0.5">
                  {po.expected_receive_date ? (
                    <>
                      <span className={`text-xs font-semibold ${isReceiveOverdue(po) ? 'text-rose-600' : 'text-gray-700'}`}>
                        {formatDate(po.expected_receive_date)}
                      </span>
                      {isReceiveOverdue(po) && (
                        <span className="text-[9px] font-bold text-white bg-rose-500 px-1.5 py-0.5 rounded-full leading-tight">
                          Telat {daysReceiveOverdue(po)} hari
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-gray-400">—</span>
                  )}
                </div>
                <div className="col-span-1 flex flex-col items-center gap-0.5">
                  <span className={`text-xs font-semibold ${isOverdue(po) ? 'text-rose-600' : po.payment_due_at ? 'text-amber-600' : 'text-gray-400'}`}>
                    {po.payment_due_at ? formatDate(po.payment_due_at) : '—'}
                  </span>
                  {isOverdue(po) && (
                    <span className="text-[9px] font-bold text-white bg-rose-500 px-1.5 py-0.5 rounded-full leading-tight">Terlambat</span>
                  )}
                </div>
                <span className={`col-span-1 text-sm font-bold text-right ${po.status === 'PAID' ? 'text-green-700' : 'text-gray-800'}`}>
                  {formatRupiah(po.total)}
                </span>
                <div className="col-span-1 flex justify-center">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[po.status]?.className}`}>
                    {STATUS_BADGE[po.status]?.label}
                  </span>
                </div>
                <div className="col-span-1 flex justify-center gap-1">
                  <button
                    onClick={() => {
                      const url = buildDetailUrl(po.po_number);
                      const win = window.open(url, '_blank');
                      if (!win) {
                        showToast('Aktifkan popup untuk membuka PO di tab baru.', 'warning');
                      }
                    }}
                    className="text-xs text-gray-500 px-2 py-1 rounded border border-gray-200 hover:bg-gray-50"
                  >
                    Detail
                  </button>
                  {po.status === 'DRAFT' && (
                    <>
                      <button onClick={() => onEdit(po)} className="text-xs text-gray-600 px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">Edit</button>
                      <button onClick={() => handleMarkOrdered(po)} className="text-xs text-indigo-700 px-2 py-1 rounded border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 font-semibold">Pesan</button>
                      <button onClick={() => handleDelete(po)} className="text-xs text-rose-600 px-2 py-1 rounded border border-rose-200 hover:bg-rose-50">Hapus</button>
                    </>
                  )}
                  {po.status === 'ORDERED' && (
                    <button onClick={() => setReceivePo(po)} className="text-xs text-indigo-700 px-2 py-1 rounded border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 font-semibold">Terima</button>
                  )}
                  {po.status === 'RECEIVED' && (
                    <button onClick={() => setPayPo(po)} className="text-xs text-green-700 px-2 py-1 rounded border border-green-200 bg-green-50 hover:bg-green-100 font-semibold">Bayar</button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {receivePo && (
        <ReceiveGoodsModal
          po={receivePo}
          onClose={() => setReceivePo(null)}
          onReceived={() => { onRefresh(); onStockRefresh(); }}
          showToast={showToast}
        />
      )}
      {payPo && (
        <MarkAsPaidModal
          po={payPo}
          onClose={() => setPayPo(null)}
          onPaid={onRefresh}
          showToast={showToast}
        />
      )}
    </>
  );
}

interface SuppliersTabProps {
  suppliers: DbSupplier[];
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onRefresh: () => void;
}

function SuppliersTab({ suppliers, showToast, onRefresh }: SuppliersTabProps) {
  const [search, setSearch] = useState('');
  const [modalSupplier, setModalSupplier] = useState<DbSupplier | null | undefined>(undefined);

  const filtered = suppliers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.contact_name ?? '').toLowerCase().includes(search.toLowerCase())
  );

  async function handleDelete(s: DbSupplier) {
    if (!confirm(`Hapus supplier "${s.name}"?`)) return;
    try {
      await supplierService.remove(s.id);
      showToast('Supplier dihapus.', 'success');
      onRefresh();
    } catch (e: any) {
      console.error('Delete supplier error:', e);
      showToast(e?.message ?? 'Gagal menghapus supplier.', 'warning');
    }
  }

  function termLabel(days: number): string {
    if (days === 0) return 'Cash';
    return `Net ${days}`;
  }

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="relative">
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              className="pl-3 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
              placeholder="Cari supplier..."
            />
          </div>
          <button
            onClick={() => setModalSupplier(null)}
            className="flex items-center gap-2 bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-indigo-700"
          >
            Tambah Supplier
          </button>
        </div>
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">Belum ada supplier.</div>
        ) : (
          <>
            <div className="grid grid-cols-5 px-4 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-bold uppercase tracking-wide text-gray-500">
              <span className="col-span-2">Nama Supplier</span>
              <span className="col-span-1">Kontak</span>
              <span className="col-span-1 text-center">Term Bayar</span>
              <span className="col-span-1 text-center">Aksi</span>
            </div>
            {filtered.map(s => (
              <div key={s.id} className="grid grid-cols-5 px-4 py-3 border-b border-gray-100 items-center hover:bg-gray-50">
                <div className="col-span-2">
                  <div className="text-sm font-semibold text-gray-800">{s.name}</div>
                  {s.contact_name && <div className="text-[10px] text-gray-400">{s.contact_name}</div>}
                </div>
                <span className="text-xs text-gray-600">{s.phone ?? '—'}</span>
                <div className="flex justify-center">
                  <span className="bg-blue-100 text-blue-700 text-[10px] font-semibold px-2 py-0.5 rounded-full">{termLabel(s.payment_term_days)}</span>
                </div>
                <div className="flex justify-center gap-1">
                  <button onClick={() => setModalSupplier(s)} className="text-xs text-gray-500 px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">Edit</button>
                  <button onClick={() => handleDelete(s)} className="text-xs text-rose-500 px-2 py-1 rounded border border-rose-100 hover:bg-rose-50">Hapus</button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
      {modalSupplier !== undefined && (
        <SupplierModal
          supplier={modalSupplier ?? undefined}
          onClose={() => setModalSupplier(undefined)}
          onSaved={onRefresh}
          showToast={showToast}
        />
      )}
    </>
  );
}

interface CustomPopoverProps {
  initial: { from?: string; to?: string };
  onCancel: () => void;
  onApply: (from: string, to: string) => void;
}
function CustomPopover({ initial, onCancel, onApply }: CustomPopoverProps) {
  const [from, setFrom] = useState(initial.from ?? '');
  const [to, setTo] = useState(initial.to ?? '');
  const invalid = !!from && !!to && from > to;
  const canApply = !!from && !!to && !invalid;
  return (
    <div className="absolute top-full mt-2 right-0 z-50 bg-white border border-gray-200 rounded-2xl shadow-2xl p-5 w-[360px]">
      <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Rentang Tanggal Custom</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1">Dari</label>
          <input
            type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1">Sampai</label>
          <input
            type="date" value={to} onChange={e => setTo(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
          />
        </div>
      </div>
      {invalid && (
        <p className="text-xs text-rose-600 mt-2">Tanggal 'Sampai' harus setelah 'Dari'.</p>
      )}
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="text-sm font-semibold text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-50">Batal</button>
        <button
          onClick={() => canApply && onApply(from, to)}
          disabled={!canApply}
          className="text-sm font-semibold text-white bg-[#012749] hover:bg-[#013865] disabled:opacity-40 disabled:cursor-not-allowed px-4 py-1.5 rounded-lg"
        >
          Terapkan
        </button>
      </div>
    </div>
  );
}
