import React, { useState, useEffect } from 'react';
import { ShoppingCart } from 'lucide-react';
import { StockItem } from '../types';
import { purchaseOrderService, supplierService } from '../lib/pembelianService';
import type { DbPurchaseOrder, DbPurchaseOrderItem, DbSupplier } from '../types';
import { isSupabaseConfigured } from '../lib/supabaseClient';
import SupplierModal from './pembelian/SupplierModal';
import PurchaseOrderModal from './pembelian/PurchaseOrderModal';
import ReceiveGoodsModal from './pembelian/ReceiveGoodsModal';
import PoDetailView from './pembelian/PoDetailView';
import MarkAsPaidModal from './pembelian/MarkAsPaidModal';
import ReceiveReplacementModal from './pembelian/ReceiveReplacementModal';

interface PembelianScreenProps {
  stockList: StockItem[];
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type Tab = 'orders' | 'suppliers';

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
};

export default function PembelianScreen({ stockList, showToast }: PembelianScreenProps) {
  const [tab, setTab] = useState<Tab>('orders');
  const [orders, setOrders] = useState<DbPurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<DbSupplier[]>([]);
  const [summary, setSummary] = useState({ totalMtd: 0, dueMtd: 0, totalUnpaid: 0, countMtd: 0 });
  const [loading, setLoading] = useState(true);

  async function reload() {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    try {
      const [ords, sups, sum] = await Promise.all([
        purchaseOrderService.fetchAll(),
        supplierService.fetchAll(),
        purchaseOrderService.fetchSummary(),
      ]);
      setOrders(ords);
      setSuppliers(sups);
      setSummary(sum);
    } catch (e: any) {
      console.error('Load pembelian error:', e);
      showToast(e?.message ?? 'Gagal memuat data pembelian.', 'warning');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3 flex-shrink-0">
        <div className="bg-indigo-100 p-2 rounded-lg">
          <ShoppingCart className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-base font-bold text-gray-900">Pembelian</h1>
          <p className="text-xs text-gray-500">Manajemen Supplier & Purchase Order</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Total PO Bulan Ini</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{formatRupiah(summary.totalMtd)}</p>
            <p className="text-xs text-gray-400 mt-1">{summary.countMtd} purchase order</p>
          </div>
          <div className="bg-white rounded-xl border border-amber-200 p-4">
            <p className="text-xs text-amber-600 font-medium uppercase tracking-wide">Jatuh Tempo Bulan Ini</p>
            <p className="text-2xl font-bold text-amber-700 mt-1">{formatRupiah(summary.dueMtd)}</p>
            <p className="text-xs text-amber-400 mt-1">belum dibayar, jatuh tempo bulan ini</p>
          </div>
          <div className="bg-white rounded-xl border border-rose-200 p-4">
            <p className="text-xs text-rose-600 font-medium uppercase tracking-wide">Total Belum Dibayar</p>
            <p className="text-2xl font-bold text-rose-700 mt-1">{formatRupiah(summary.totalUnpaid)}</p>
            <p className="text-xs text-rose-400 mt-1">semua PO outstanding</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Jumlah PO Bulan Ini</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{summary.countMtd}</p>
            <p className="text-xs text-gray-400 mt-1">purchase order dibuat</p>
          </div>
        </div>

        {/* Tabs */}
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
          />
        ) : (
          <SuppliersTab
            suppliers={suppliers}
            showToast={showToast}
            onRefresh={reload}
          />
        )}
      </div>
    </div>
  );
}

// Placeholder sub-components — implemented in Tasks 6 and 7
interface OrdersTabProps {
  orders: DbPurchaseOrder[];
  suppliers: DbSupplier[];
  stockList: StockItem[];
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onRefresh: () => void;
}

function OrdersTab({ orders, suppliers, stockList, showToast, onRefresh }: OrdersTabProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editPo, setEditPo] = useState<DbPurchaseOrder | null>(null);
  const [receivePo, setReceivePo] = useState<DbPurchaseOrder | null>(null);
  const [payPo, setPayPo] = useState<DbPurchaseOrder | null>(null);
  const [detailPo, setDetailPo] = useState<DbPurchaseOrder | null>(null);
  const [replaceItem, setReplaceItem] = useState<DbPurchaseOrderItem | null>(null);

  const filtered = orders.filter(o => {
    const matchSearch = o.po_number.toLowerCase().includes(search.toLowerCase()) ||
      (o.supplier?.name ?? '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || o.status === statusFilter;
    return matchSearch && matchStatus;
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
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-indigo-700"
          >
            Buat PO Baru
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="grid grid-cols-7 px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-[10px] font-bold uppercase tracking-wide text-gray-500">
            <span className="col-span-1">No. PO</span>
            <span className="col-span-1">Supplier</span>
            <span className="col-span-1 text-center">Tgl Pesan</span>
            <span className="col-span-1 text-center">Jatuh Tempo</span>
            <span className="col-span-1 text-right">Total</span>
            <span className="col-span-1 text-center">Status</span>
            <span className="col-span-1 text-center">Aksi</span>
          </div>

          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">Belum ada purchase order.</div>
          ) : (
            filtered.map(po => (
              <div key={po.id} className={`grid grid-cols-7 px-4 py-3 border-b border-gray-100 items-center hover:bg-gray-50 ${LEFT_BORDER[po.status] ?? ''}`}>
                <span className="col-span-1 text-xs font-mono font-semibold text-gray-800">{po.po_number}</span>
                <div className="col-span-1">
                  <div className="text-sm font-semibold text-gray-800 truncate">{po.supplier?.name ?? '—'}</div>
                  <div className="text-[10px] text-gray-400">{po.supplier?.payment_term_days === 0 ? 'Cash' : `Net ${po.supplier?.payment_term_days}`}</div>
                </div>
                <span className="col-span-1 text-xs text-gray-500 text-center">{formatDate(po.ordered_at)}</span>
                <span className={`col-span-1 text-xs text-center font-semibold ${po.payment_due_at ? 'text-amber-600' : 'text-gray-400'}`}>
                  {po.payment_due_at ? formatDate(po.payment_due_at) : '—'}
                </span>
                <span className={`col-span-1 text-sm font-bold text-right ${po.status === 'PAID' ? 'text-green-700' : 'text-gray-800'}`}>
                  {formatRupiah(po.total)}
                </span>
                <div className="col-span-1 flex justify-center">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[po.status]?.className}`}>
                    {STATUS_BADGE[po.status]?.label}
                  </span>
                </div>
                <div className="col-span-1 flex justify-center gap-1">
                  <button onClick={() => setDetailPo(po)} className="text-xs text-gray-500 px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">Detail</button>
                  {po.status === 'DRAFT' && (
                    <>
                      <button onClick={() => setEditPo(po)} className="text-xs text-gray-600 px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">Edit</button>
                      <button onClick={() => handleMarkOrdered(po)} className="text-xs text-indigo-700 px-2 py-1 rounded border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 font-semibold">Pesan</button>
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

      {/* Modals — wired in Tasks 8-11 */}
      {(showCreateModal || editPo) && (
        <PurchaseOrderModal
          po={editPo ?? undefined}
          suppliers={suppliers}
          stockList={stockList}
          onClose={() => { setShowCreateModal(false); setEditPo(null); }}
          onSaved={onRefresh}
          showToast={showToast}
        />
      )}
      {receivePo && (
        <ReceiveGoodsModal
          po={receivePo}
          onClose={() => setReceivePo(null)}
          onReceived={onRefresh}
          showToast={showToast}
        />
      )}
      {detailPo && (
        <PoDetailView
          po={detailPo}
          stockList={stockList}
          onClose={() => setDetailPo(null)}
          onRefresh={() => { onRefresh(); setDetailPo(null); }}
          showToast={showToast}
          onReceiveReplacement={item => setReplaceItem(item)}
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
      {replaceItem && (
        <ReceiveReplacementModal
          item={replaceItem}
          onClose={() => setReplaceItem(null)}
          onReplaced={() => { setReplaceItem(null); setDetailPo(null); onRefresh(); }}
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
